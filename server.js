import http from 'node:http';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, createReadStream, createWriteStream, statSync} from 'node:fs';
import {unlink, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform, Readable} from 'node:stream';
import {defaults, requireValue, validateDocument, validateSettings, number} from './lib/core.js';
import {generateText, comfyVideo, minimaxVideo, probe} from './lib/providers.js';
import {inspect, render} from './lib/media.js';
import {h3Preset} from './lib/h3.js';
import {videoPreset, videoFrames} from './lib/video-presets.js';
import {publicCatalog} from './lib/model-catalog.js';
import {Deployments} from './lib/deployments.js';
import {validateDeploymentConfig} from './lib/local-runtime.js';
import {migrateTextSettings, resolveTextConfig} from './lib/text-settings.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.CYANCREATOR_DATA || process.env.LOCALCREATOR_DATA || path.join(ROOT, 'data'));
const MEDIA = path.join(DATA, 'media'); mkdirSync(MEDIA, {recursive: true});
const dbPath = path.join(DATA, 'workspace.json');
const state = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {settings: defaults(), projects: [], jobs: [], assets: []};
state.settings.text = migrateTextSettings(state.settings.text);
// Rebase managed media after the workspace folder is renamed.
for (const asset of state.assets) {
  if (/^[\w-]+$/.test(asset.id) && !existsSync(asset.file)) {
    const moved = path.join(MEDIA, `${asset.id}.mp4`);
    if (existsSync(moved)) asset.file = moved;
  }
}
const token = randomBytes(32).toString('hex');
const controllers = new Map();
function persist() {writeFileSync(dbPath + '.tmp', JSON.stringify(state, null, 2)); renameSync(dbPath + '.tmp', dbPath);}
const deployments = new Deployments(state, DATA, persist);
process.on('SIGINT', () => {deployments.close();process.exit(0);});
process.on('SIGTERM', () => {deployments.close();process.exit(0);});
for (const job of state.jobs) if (['queued', 'running'].includes(job.status)) {job.status = 'interrupted'; job.error = '工作台已重启；远端任务可能仍在执行，请用任务 ID 检查后再提交。';}
persist();
const projectById = id => {const p = state.projects.find(p => p.id === id); requireValue(p, '项目不存在', 404); return p;};
const publicState = () => ({...state, catalog: publicCatalog(), runtimes: deployments.runtime.status(), deployments: state.deployments.map(({config,...j})=>j), assets: state.assets.map(({file, ...a}) => a), jobs: state.jobs.map(({snapshot, config, ...j}) => j)});
function revise(p) {p.revision++; p.updatedAt = new Date().toISOString();}
function applyDocument(p, stage, result) {
  p.history.unshift({id: randomUUID(), stage, value: p[stage], revision: p.revision, at: new Date().toISOString()});
  p.history = p.history.slice(0, 50); p[stage] = result;
  if (stage === 'outline') {p.stale.script = !!p.script; p.stale.review = !!p.review;}
  if (stage === 'script') p.stale.review = !!p.review;
  p.stale[stage] = false; revise(p);
}
async function body(req) {
  let size = 0, chunks = [];
  for await (const c of req) {size += c.length; requireValue(size <= 4 * 1024 * 1024, '请求超过 4MB', 413); chunks.push(c);}
  try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');} catch {throw Object.assign(new Error('无效 JSON'), {status: 400});}
}
function json(res, data, code = 200) {res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data));}
async function saveAsset(stream, name, projectId, signal) {
  const id = randomUUID(), file = path.join(MEDIA, `${id}.mp4`);
  let bytes = 0;
  const limiter = new Transform({transform(chunk, _, cb) {bytes += chunk.length; cb(bytes > 512 * 1024 * 1024 ? new Error('素材超过 512MB') : null, chunk);}});
  try {
    await pipeline(stream, limiter, createWriteStream(file), {signal});
    const metadata = await inspect(file, signal);
    const asset = {id, name: String(name).slice(0, 120), projectId, file, ...metadata, createdAt: new Date().toISOString(), url: `/media/${id}`};
    state.assets.push(asset); persist(); return asset;
  } catch (e) {await unlink(file).catch(() => {}); throw e;}
}
let pumping = false;
async function pump() {
  if (pumping) return; pumping = true;
  try {
    let j;
    while ((j = state.jobs.findLast(j => j.status === 'queued'))) {
      const job = j, controller = new AbortController(); controllers.set(job.id, controller);
      job.status = 'running'; job.startedAt = new Date().toISOString(); persist();
      try {
        const p = projectById(job.projectId);
        const remote = id => {job.remoteId = id; persist();};
        if (['outline', 'script', 'review'].includes(job.kind)) {
          job.result = await generateText(job.kind, job.snapshot, job.config, controller.signal);
          controller.signal.throwIfAborted();
          if (p.revision === job.baseRevision) {applyDocument(p, job.kind, job.result); job.applied = true;}
          else job.note = '生成期间项目发生修改，结果已保留，未覆盖当前稿。';
        } else if (job.kind === 'video') {
          const response = job.config.provider === 'comfy' ? await comfyVideo(job.config, job.prompt, controller.signal, remote) : await minimaxVideo(job.config, job.prompt, job.duration, controller.signal, remote);
          const asset = await saveAsset(Readable.fromWeb(response.body), `镜头 ${job.shotLabel}`, p.id, controller.signal);
          job.assetId = asset.id;
        } else {
          const folder = path.join(DATA, 'renders', job.id); await mkdir(folder, {recursive: true});
          const file = path.join(MEDIA, `${job.id}.mp4`);
          const info = await render(job.snapshot.timeline, state.assets.filter(a => a.projectId === p.id), folder, file, controller.signal);
          controller.signal.throwIfAborted();
          const asset = {id: job.id, file, name: `${job.snapshot.name} · 成片`, projectId: p.id, ...info, url: `/media/${job.id}`, exported: true, createdAt: new Date().toISOString()};
          state.assets.push(asset); job.assetId = asset.id;
        }
        job.status = 'succeeded';
      } catch (e) {job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = controller.signal.aborted ? '已停止本地等待；已提交的远端任务可能继续执行。' : e.message;}
      finally {job.finishedAt = new Date().toISOString(); job.elapsedMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt); controllers.delete(job.id); persist();}
    }
  } finally {pumping = false;}
}
function serveFile(req, res, file, type) {
  const size = statSync(file).size;
  let start = 0, end = size - 1, code = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) {res.writeHead(416, {'Content-Range': `bytes */${size}`}); return res.end();}
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else {start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end);}
    if (start > end || start >= size) {res.writeHead(416, {'Content-Range': `bytes */${size}`}); return res.end();}
    code = 206;
  }
  res.writeHead(code, {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(code === 206 ? {'Content-Range': `bytes ${start}-${end}/${size}`} : {})});
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, {start, end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; connect-src 'self'");
  try {
    const host = req.headers.host;
    requireValue(host && /^(127\.0\.0\.1|localhost):\d+$/.test(host), '不允许的 Host', 403);
    const u = new URL(req.url, `http://${host}`), method = req.method;
    if (!['GET', 'HEAD'].includes(method)) {
      requireValue(req.headers['x-workspace-token'] === token, '请求认证失败，请刷新工作台', 403);
      requireValue(!req.headers.origin || req.headers.origin === `http://${host}`, '跨站请求被拒绝', 403);
    }
    if (u.pathname === '/api/state' && method === 'GET') return json(res, {...publicState(), token});
    if (u.pathname === '/api/h3-preset' && method === 'GET') return json(res, h3Preset());
    const preset = u.pathname.match(/^\/api\/video-presets\/([\w-]+)$/);
    if (preset && method === 'GET') return json(res, videoPreset(preset[1]));
    if (u.pathname === '/api/deployment/config' && method === 'PUT') {state.deploymentConfig=validateDeploymentConfig(await body(req));persist();return json(res,{ok:true});}
    if (u.pathname === '/api/deployments' && method === 'POST') {const j=deployments.enqueue((await body(req)).modelId);return json(res,{id:j.id},202);}
    const deployment = u.pathname.match(/^\/api\/deployments\/([\w-]+)\/cancel$/);
    if (deployment && method === 'POST') {deployments.cancel(deployment[1]);return json(res,{ok:true});}
    const runtime = u.pathname.match(/^\/api\/runtimes\/([\w-]+)\/stop$/);
    if (runtime && method === 'POST') {
      requireValue(!state.jobs.some(j=>['queued','running'].includes(j.status))&&!state.deployments.some(j=>['queued','running'].includes(j.status)), '请等待生成和部署任务结束再停止服务');
      deployments.runtime.stop(runtime[1]);return json(res,{ok:true});
    }
    const details = u.pathname.match(/^\/api\/jobs\/([\w-]+)\/details$/);
    if (details && method === 'GET') {const j = state.jobs.find(j => j.id === details[1]); requireValue(j, '任务不存在', 404); const {snapshot, ...safe} = j; return json(res, safe);}
    if (u.pathname === '/api/settings' && method === 'PUT') {state.settings = validateSettings(await body(req)); persist(); return json(res, {ok: true});}
    if (u.pathname === '/api/probe' && method === 'POST') {
      const {kind, role, profileId} = await body(req); requireValue(['text', 'comfy'].includes(kind), '只支持文本或 ComfyUI 探测');
      const config = kind === 'comfy' ? state.settings.video : profileId ? state.settings.text.profiles.find(p => p.id === profileId) : resolveTextConfig(state.settings.text, role || 'outline');
      requireValue(config, '模型配置不存在'); return json(res, await probe(config, kind));
    }
    if (u.pathname === '/api/projects' && method === 'POST') {
      const b = await body(req); requireValue(typeof b.name === 'string' && b.name.trim(), '请填写项目名称');
      const p = {id: randomUUID(), name: b.name.slice(0, 100), brief: '', bible: '', outline: null, script: null, review: null, stale: {}, timeline: [], history: [], revision: 1, updatedAt: new Date().toISOString()};
      state.projects.unshift(p); persist(); return json(res, p, 201);
    }
    const match = u.pathname.match(/^\/api\/projects\/([\w-]+)$/);
    if (match && method === 'PUT') {
      const original = projectById(match[1]), p = structuredClone(original), b = await body(req);
      requireValue(b.revision === p.revision, '项目已变化，请刷新后重试', 409);
      if ('stage' in b) {requireValue(['outline', 'script', 'review'].includes(b.stage), '无效阶段'); applyDocument(p, b.stage, validateDocument(b.stage, b.value));}
      else {
        for (const key of ['name', 'brief', 'bible']) if (key in b) {requireValue(typeof b[key] === 'string' && b[key].length <= 50000, '文本长度无效'); if (b[key] !== p[key] && key !== 'name') for (const stage of ['outline', 'script', 'review']) p.stale[stage] = !!p[stage]; p[key] = b[key];}
        if ('timeline' in b) {
          requireValue(Array.isArray(b.timeline) && b.timeline.length <= 200, '时间线格式错误');
          for (const clip of b.timeline) {const a = state.assets.find(a => a.id === clip.assetId && a.projectId === p.id); requireValue(a, '素材不属于本项目'); number(clip.start, 0, a.duration, '入点'); number(clip.end, clip.start + 0.04, a.duration + 0.02, '出点'); number(clip.volume, 0, 2, '音量');}
          p.timeline = b.timeline;
        }
        revise(p);
      }
      Object.assign(original, p); persist(); return json(res, p);
    }
    if (u.pathname === '/api/assets' && method === 'POST') {
      const p = projectById(u.searchParams.get('projectId'));
      const a = await saveAsset(req, u.searchParams.get('name') || '导入素材', p.id); const {file, ...safe} = a; return json(res, safe, 201);
    }
    if (u.pathname === '/api/jobs' && method === 'POST') {
      const b = await body(req), p = projectById(b.projectId);
      requireValue(['outline', 'script', 'review', 'video', 'export'].includes(b.kind), '无效任务类型');
      requireValue(state.jobs.filter(j => ['queued', 'running'].includes(j.status)).length < 20, '队列已满');
      if (b.kind === 'outline') requireValue(p.brief.trim(), '请先保存创作简报');
      if (b.kind === 'script') requireValue(p.outline && !p.stale.outline, '请先生成或确认最新大纲');
      if (b.kind === 'review') requireValue(p.script && !p.stale.script && !p.stale.outline, '请先完成最新剧本');
      if (b.kind === 'export') requireValue(p.timeline.length, '请先添加时间线片段');
      const job = {id: randomUUID(), projectId: p.id, kind: b.kind, status: 'queued', baseRevision: p.revision, snapshot: structuredClone(p), createdAt: new Date().toISOString()};
      if (['outline', 'script', 'review'].includes(b.kind)) job.config = structuredClone(resolveTextConfig(state.settings.text, b.kind));
      if (b.kind === 'video') {
        requireValue(p.script && !p.stale.script && !p.stale.outline, '剧本已过期，请先确认最新稿');
        const shot = p.script.scenes[b.scene]?.shots[b.shot]; requireValue(shot, '镜头不存在');
        job.prompt = shot.prompt; job.duration = shot.duration; job.shotLabel = `${b.scene + 1}-${b.shot + 1}`; job.config = structuredClone(state.settings.video);
        if (job.config.provider === 'comfy' && ['h3','wan'].includes(job.config.durationMode)) {requireValue(job.config.bindings.frames, '自动时长需要 frames 绑定'); job.config.params.frames = videoFrames(job.config.durationMode, shot.duration);}
        if (job.config.provider === 'comfy') requireValue(Object.keys(job.config.workflow).length, '请先在模型中心导入视频工作流');
      }
      state.jobs.unshift(job); persist(); json(res, {id: job.id}, 202); void pump(); return;
    }
    const jm = u.pathname.match(/^\/api\/jobs\/([\w-]+)\/(cancel|apply)$/);
    if (jm && method === 'POST') {
      const job = state.jobs.find(j => j.id === jm[1]); requireValue(job, '任务不存在', 404);
      if (jm[2] === 'cancel') {
        requireValue(['queued', 'running'].includes(job.status), '任务已结束');
        if (job.status === 'queued') job.status = 'cancelled'; else controllers.get(job.id)?.abort();
      } else {
        const b = await body(req), p = projectById(job.projectId);
        requireValue(job.status === 'succeeded' && job.result && !job.applied, '没有可应用的结果');
        requireValue(b.revision === p.revision, '项目已变化，请刷新后重试', 409);
        applyDocument(p, job.kind, job.result); job.applied = true;
      }
      persist(); return json(res, {ok: true});
    }
    const mm = u.pathname.match(/^\/media\/([\w-]+)$/);
    if (mm && ['GET', 'HEAD'].includes(method)) {const a = state.assets.find(a => a.id === mm[1]); requireValue(a, '素材不存在', 404); return serveFile(req, res, a.file, a.mime || 'video/mp4');}
    const files = {'/model-hub.js':['model-hub.js','text/javascript; charset=utf-8'], '/text-models.js': ['text-models.js', 'text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
    if (files[u.pathname] && ['GET', 'HEAD'].includes(method)) return serveFile(req, res, path.join(ROOT, 'public', files[u.pathname][0]), files[u.pathname][1]);
    json(res, {error: '接口不存在'}, 404);
  } catch (e) {if (!res.headersSent) json(res, {error: e.message}, e.status || 400); else res.destroy();}
});
server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`CyanCreator 0.2.0 · http://127.0.0.1:${server.address().port}`));
