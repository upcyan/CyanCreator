import {WorkspaceStore} from './lib/workspace-store.js';
import {compileShot} from './lib/prompt-compiler.js';
import {imageDefaults,validateImage,inspectImage,portraitPrompt,generateImage} from './lib/images.js';
import {SpeechRuntime,speechDefaults,validateSpeech,cloudSpeech} from './lib/speech.js';
import {inspectAudio,validateTracks} from './lib/audio.js';
import http from 'node:http';
import {initCreation,stashChapter,invalidateChapters,mutateStructure,importDocument,validateLibrary,shotPrompt,validateDirection} from './lib/creation.js';
import {assistText} from './lib/assist.js';
import {guideTurn} from './lib/guide.js';
import {coachTurn, coachContext} from './lib/coach.js';
import {cloudTemplates,cloudPreset,cloudVideo} from './lib/cloud-video.js';
import {applyAgnesPreset} from './lib/agnes-preset.js';
import {SecretVault,secretStatus,safeError} from './lib/secrets.js';
import {spawn} from 'node:child_process';
import {inspectUpdate} from './lib/updates.js';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, createReadStream, createWriteStream, statSync} from 'node:fs';
import {unlink, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
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
import {editShot, shotConfig, videoCapabilities} from './lib/shots.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.CYANCREATOR_DATA || process.env.LOCALCREATOR_DATA || path.join(ROOT, 'data'));
const MEDIA = path.join(DATA, 'media'); mkdirSync(MEDIA, {recursive: true});
const dbPath = path.join(DATA, 'workspace.json');
const state = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {settings: defaults(), projects: [], jobs: [], assets: []};
state.settings.text = migrateTextSettings(state.settings.text);
state.settings.image??=imageDefaults();state.settings.speech??=speechDefaults();const speechRuntime=new SpeechRuntime(DATA);
for(const p of state.projects){p.scriptVersion??=randomUUID();initCreation(p);}
const vault=new SecretVault(DATA);await vault.load();
// Rebase managed media after the workspace folder is renamed.
for (const asset of state.assets) {
  if (/^[\w-]+$/.test(asset.id) && !existsSync(asset.file)) {
    const fallback = asset.kind==='audio'?'wav':asset.kind==='image'?'png':'mp4';
    const moved = path.join(MEDIA, `${asset.id}.${asset.extension || fallback}`);
    if (existsSync(moved)) asset.file = moved;
  }
}
const token = randomBytes(32).toString('hex');
const controllers = new Map();
let updateBusy=false,checkedUpdate;
const updateFile=path.join(DATA,'update-status.json');
function updateStatus(){try{return JSON.parse(readFileSync(updateFile,'utf8'));}catch{return {phase:'idle'};}}
if(updateStatus().phase==='restarting')writeFileSync(updateFile,JSON.stringify({...updateStatus(),phase:'succeeded'}));
const workspaceStore=new WorkspaceStore(dbPath);
function persist() {for(const p of state.projects)stashChapter(p);workspaceStore.schedule(state);}
const deployments = new Deployments(state, DATA, persist);
function shutdown(){for(const controller of controllers.values())controller.abort();deployments.close();process.exit(0);}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const job of state.jobs) if (['queued', 'running'].includes(job.status)) {job.status = 'interrupted'; job.error = '工作台已重启；远端任务可能仍在执行，请用任务 ID 检查后再提交。';}
persist();
const projectById = id => {const p = state.projects.find(p => p.id === id); requireValue(p, '项目不存在', 404); return p;};
const chapterDirectory=p=>p.episodes.map(e=>({id:e.id,title:e.title,chapters:e.chapters.map(c=>({id:c.id,title:c.title}))}));
// Minimal snapshot: queued jobs only consume writing context, timeline and audio plans.
// Cloning the full project here used to multiply workspace.json by every queued task.
const taskSnapshot=p=>structuredClone({name:p.name,activeChapterId:p.activeChapterId,brief:p.brief,bible:p.bible,characters:p.characters,worldbook:p.worldbook,outline:p.outline,script:p.script,review:p.review,timeline:p.timeline||[],audioTracks:p.audioTracks||[],subtitles:p.subtitles||[],episodes:chapterDirectory(p)});
const publicState = () => ({...state,projects:state.projects.map(p=>({...p,episodes:chapterDirectory(p)})),storageError:workspaceStore.error,onboarded:!!state.onboarded,cloudTemplates,secrets:secretStatus(), videoCapabilities:videoCapabilities(state.settings.video), catalog: publicCatalog(), runtimes: deployments.runtime.status(), deployments: state.deployments.map(({config,...j})=>j), assets: state.assets.map(({file, ...a}) => a), assetUsage: assetUsage(), jobs: state.jobs.map(({snapshot, config, runtimeConfig, guideHistory, ...j}) => j)});
function assetUsage() {
  const usage = {counts: {}, bytes: {}, totalBytes: 0, perAsset: []};
  for (const a of state.assets) {
    let size = 0; try {size = statSync(a.file).size;} catch {}
    usage.counts[a.kind] = (usage.counts[a.kind] || 0) + 1;
    usage.bytes[a.kind] = (usage.bytes[a.kind] || 0) + size;
    usage.totalBytes += size;
    usage.perAsset.push({id: a.id, bytes: size});
  }
  return usage;
}
function revise(p) {p.revision++; p.updatedAt = new Date().toISOString();}
function applyDocument(p, stage, result) {
  p.history.unshift({id: randomUUID(), stage, value: p[stage], revision: p.revision, at: new Date().toISOString()});
  p.history = p.history.slice(0, 50); p[stage] = result;
  if (stage === 'outline') {p.stale.script = !!p.script; p.stale.review = !!p.review;}
  if (stage === 'script') {p.stale.review = !!p.review;p.scriptVersion=randomUUID();p.selectedShots={};}
  p.stale[stage] = false; revise(p);
}
async function body(req) {
  let size = 0, chunks = [];
  for await (const c of req) {size += c.length; requireValue(size <= 4 * 1024 * 1024, '请求超过 4MB', 413); chunks.push(c);}
  try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');} catch {throw Object.assign(new Error('无效 JSON'), {status: 400});}
}
async function json(res, data, code = 200) {if(!['GET','HEAD'].includes(res.req.method)){try{await workspaceStore.flush();}catch(e){data={error:e.message};code=503;}}res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data));}
async function saveAsset(stream, name, projectId, signal, kind) {
  const id = randomUUID(), file = path.join(MEDIA, `${id}.${kind==='audio'?'wav':kind==='image'?'png':'mp4'}`);
  let bytes = 0, stored = file;
  const limit = kind==='image'?20:512;
  const limiter = new Transform({transform(chunk, _, cb) {bytes += chunk.length; cb(bytes > limit * 1024 * 1024 ? new Error(`素材超过 ${limit}MB`) : null, chunk);}});
  try {
    await pipeline(stream, limiter, createWriteStream(file), {signal});
    const metadata = await (kind==='audio'?inspectAudio(file,signal):kind==='image'?inspectImage(file,signal):inspect(file,signal));
    // Keep the on-disk extension aligned with the detected container (mp3, jpg, webm, m4a...).
    if (metadata.extension && !file.endsWith('.'+metadata.extension)) {stored = path.join(MEDIA, `${id}.${metadata.extension}`); renameSync(file, stored);}
    const asset = {id, name: String(name).slice(0, 120), projectId, file: stored, ...metadata, createdAt: new Date().toISOString(), url: `/media/${id}`};
    state.assets.push(asset); persist(); return asset;
  } catch (e) {await unlink(stored).catch(() => {}); throw e;}
}
let pumping = false;
// 引导助手历史按时间倒序存放（最新在前），coachMessages 内部会反转回对话顺序。
const coachHistory = () => state.jobs.filter(j => j.kind === 'coach' && j.status === 'succeeded' && j.result?.reply).slice(0, 10).map(j => ({message: j.coach.message, reply: j.result.reply}));
function videoJob(p,b){
  requireValue(p.script&&!p.stale.script&&!p.stale.outline,'剧本已过期，请先确认最新稿');
  requireValue(Number.isInteger(b.scene)&&Number.isInteger(b.shot),'镜头索引无效');
  const shot=p.script.scenes[b.scene]?.shots[b.shot];requireValue(shot,'镜头不存在');
  validateDirection(shot);requireValue((shot.characterIds||[]).every(id=>p.characters.some(c=>c.id===id)),'镜头引用了已移除角色，请重新关联');const config=shotConfig(state.settings.video,shot);
  let firstFrameAssetId;
  if(shot.firstFrameId){const ff=state.assets.find(a=>a.id===shot.firstFrameId&&a.projectId===p.id&&a.kind==='image');requireValue(ff,'首帧图不存在或已被删除，请重新选择');requireValue(['seedance','kling','veo','minimax','agnes'].includes(config.provider),'首帧图生视频当前仅支持云端模型（Seedance / 可灵 / Veo / MiniMax / Agnes）');firstFrameAssetId=ff.id;}
  return {prompt:compileShot(shot,p,p.script.scenes[b.scene]),chapterId:p.activeChapterId,duration:shot.duration,shotLabel:`${b.scene+1}-${b.shot+1}`,scene:b.scene,shot:b.shot,scriptVersion:p.scriptVersion,config,runtimeConfig:structuredClone(state.deploymentConfig),...(firstFrameAssetId?{firstFrameAssetId}:{})};
}
async function pump() {
  if (pumping) return; pumping = true;
  try {
    let j;
    while ((j = state.jobs.findLast(j => j.status === 'queued'))) {
      const job = j, controller = new AbortController(); controllers.set(job.id, controller);
      job.status = 'running'; job.startedAt = new Date().toISOString(); persist();
      try {
        const p = job.projectId ? projectById(job.projectId) : null;
        const remote = id => {job.remoteId = id; persist();};
        if(job.kind==='speech-deploy'){await speechRuntime.prepare(job.runtimeConfig,controller.signal,event=>{job.progress=event;persist();});job.note='本地语音运行环境与权重已验证，可生成配音。';}
        else if(job.kind==='speech'){
          let asset;
          if(job.config.provider==='piper'){const folder=path.join(DATA,'speech-jobs',job.id);await mkdir(folder,{recursive:true});const output=path.join(folder,'speech.wav');try{await speechRuntime.generate(job.config,job.text,output,controller.signal);asset=await saveAsset(createReadStream(output),'配音 · '+job.text.slice(0,30),p.id,controller.signal,'audio');}finally{await unlink(output).catch(()=>{});}}
          else{const response=await cloudSpeech(job.config,job.text,controller.signal);asset=await saveAsset(Readable.fromWeb(response.body),'配音 · '+job.text.slice(0,30),p.id,controller.signal,'audio');}
          Object.assign(asset,{chapterId:job.chapterId,characterId:job.characterId,text:job.text});job.assetId=asset.id;
        }
        else if(job.kind==='character-image'){const stream=await generateImage(job.config,job.prompt,controller.signal);const asset=await saveAsset(stream,job.characterName+(job.imageMode==='sheet'?' · 三视图':' · 立绘'),p.id,controller.signal,'image');Object.assign(asset,{characterId:job.characterId,chapterId:job.chapterId,imageMode:job.imageMode,jobId:job.id});job.assetId=asset.id;job.note='图片已入库，请预览后选为角色参考。';}
        else if(job.kind==='guide'){job.result=await guideTurn(job.snapshot,job.config,job.guide,job.guideHistory,controller.signal,event=>{job.progress=event;persist();});controller.signal.throwIfAborted();}
        else if(job.kind==='coach'){job.result=await coachTurn(job.config,job.coach,coachContext(state,job.projectId?projectById(job.projectId):null,job.coach.page,job.coach.mode),coachHistory(),controller.signal,event=>{job.progress=event;persist();});controller.signal.throwIfAborted();}
        else if(job.kind==='assist'){job.result=await assistText(job.snapshot,job.config,job.assist,controller.signal,event=>{job.progress=event;persist();});job.note='伴写候选已保留，确认后应用。';}
        else if (['outline', 'script', 'review'].includes(job.kind)) {
          job.result = await generateText(job.kind, job.snapshot, job.config, controller.signal,event=>{job.progress=event;persist();});
          controller.signal.throwIfAborted();
          if (p.revision === job.baseRevision) {applyDocument(p, job.kind, job.result); job.applied = true;}
          else job.note = '生成期间项目发生修改，结果已保留，未覆盖当前稿。';
        } else if (job.kind === 'video') {
          let asset;
          let firstFrame=null;
          if(job.firstFrameAssetId){const fa=state.assets.find(a=>a.id===job.firstFrameAssetId);requireValue(fa,'首帧图素材已被删除');const bytes=readFileSync(fa.file);requireValue(bytes.length<=10*1024*1024,'首帧图片超过 10MB，请压缩后重新导入');firstFrame={bytes,mime:fa.mime||'image/png'};}
          if(job.config.provider==='native'){
            const output=await deployments.native.generate(job.config,job.runtimeConfig,job.prompt,controller.signal,event=>{job.progress=event;persist();});
            try{asset=await saveAsset(createReadStream(output.file),`镜头 ${job.shotLabel}`,p.id,controller.signal);}finally{await output.cleanup();}
          }else{
            job.progress={phase:'remote',message:'等待远端推理结果'};persist();
            const response = job.config.provider === 'comfy' ? await comfyVideo(job.config, job.prompt, controller.signal, remote) : ['seedance','kling','veo','agnes'].includes(job.config.provider)?await cloudVideo(job.config,job.prompt,job.duration,controller.signal,remote,delay,firstFrame):await minimaxVideo(job.config, job.prompt, job.duration, controller.signal, remote, firstFrame);
            asset=await saveAsset(Readable.fromWeb(response.body),`镜头 ${job.shotLabel}`,p.id,controller.signal);
          }
          Object.assign(asset,{scene:job.scene,shot:job.shot,scriptVersion:job.scriptVersion,jobId:job.id});job.assetId=asset.id;job.progress={phase:'complete'};
        } else {
          const folder = path.join(DATA, 'renders', job.id); await mkdir(folder, {recursive: true});
          const file = path.join(MEDIA, `${job.id}.mp4`);
          const preset = job.exportPreset==='1080p'?{width:1920,height:1080}:job.exportPreset==='720-vertical'?{width:720,height:1280}:job.exportPreset==='1080-vertical'?{width:1080,height:1920}:{width:1280,height:720};
          const info = await render(job.snapshot.timeline, state.assets.filter(a => a.projectId === p.id), folder, file, controller.signal, job.snapshot.audioTracks||[], preset, job.snapshot.subtitles||[]);
          controller.signal.throwIfAborted();
          const asset = {id: job.id, file, name: `${job.snapshot.name} · 成片`, projectId: p.id, ...info, url: `/media/${job.id}`, exported: true, createdAt: new Date().toISOString()};
          state.assets.push(asset); job.assetId = asset.id;
        }
        job.status = 'succeeded';
      } catch (e) {job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = controller.signal.aborted ? job.config?.provider==='native'?'原生推理已停止，未完成视频不会入库。':'已停止本地等待；已提交的远端任务可能继续执行。' : safeError(e);}
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
      requireValue(!updateBusy,'平台正在更新，暂时不能修改数据',503);
    }
    if(u.pathname==='/api/updates/status'&&method==='GET')return json(res,updateStatus());
    if(u.pathname==='/api/updates/check'&&method==='POST'){checkedUpdate=await inspectUpdate(ROOT);if(updateStatus().phase==='failed'){checkedUpdate.available=true;checkedUpdate.commits+='\n上次更新失败，可重新应用以修复依赖。';}return json(res,checkedUpdate);}
    if(u.pathname==='/api/updates/apply'&&method==='POST'){
      const request=await body(req);requireValue(checkedUpdate?.available&&request.target===checkedUpdate.target,'请先检查更新');
      requireValue(![...state.jobs,...state.deployments].some(j=>['queued','running'].includes(j.status)),'请等待生成、下载和导出任务结束');
      requireValue(!updateBusy,'已有更新正在应用',409);updateBusy=true;
      try{
        const fresh=await inspectUpdate(ROOT,false);requireValue(fresh.current===checkedUpdate.current&&fresh.target===request.target,'仓库已变化，请重新检查');
        const worker=path.join(DATA,'update-worker.mjs');writeFileSync(worker,readFileSync(path.join(ROOT,'lib','update-worker.js')));
        writeFileSync(updateFile,JSON.stringify({phase:'starting',target:fresh.target}));
        const child=spawn(process.execPath,[worker,ROOT,DATA,fresh.target,String(process.pid)],{cwd:ROOT,detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,PORT:String(server.address().port)}});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
        json(res,{ok:true});setTimeout(shutdown,300);return;
      }catch(error){updateBusy=false;throw error;}
    }
    if(u.pathname==='/updates.js'&&['GET','HEAD'].includes(method)){res.setHeader('Cache-Control','no-store');return serveFile(req,res,path.join(ROOT,'public','updates.js'),'text/javascript; charset=utf-8');}

    if(u.pathname==='/api/secrets'&&method==='PUT'){const b=await body(req);await vault.set(b.name,b.value);return json(res,{ok:true,secrets:secretStatus()});}
    if(u.pathname.startsWith('/api/cloud-presets/')&&method==='GET')return json(res,cloudPreset(u.pathname.split('/').at(-1)));
    if(u.pathname==='/api/agnes-preset'&&method==='GET')return json(res,applyAgnesPreset(state.settings));
    if(u.pathname==='/api/import-document'&&method==='POST'){const b=await body(req);return json(res,importDocument(b.stage,b.text,b.format));}
    const creation=u.pathname.match(/^\/api\/projects\/([\w-]+)\/(structure|draft)$/);
    if(creation&&method==='POST'){
      const original=projectById(creation[1]),b=await body(req),p=structuredClone(original);requireValue(b.revision===p.revision,'项目已变化，请刷新后重试',409);
      if(creation[2]==='structure')mutateStructure(p,b);
      else {
        for(const key of ['brief','bible']){requireValue(typeof b[key]==='string'&&b[key].length<=50000,'设定文字过长');if(b[key]!==p[key])invalidateChapters(p);p[key]=b[key];}
        const characters=validateLibrary(b.characters,'characters'),worldbook=validateLibrary(b.worldbook,'worldbook');
        if(JSON.stringify(characters)!==JSON.stringify(p.characters)||JSON.stringify(worldbook)!==JSON.stringify(p.worldbook))invalidateChapters(p);
        p.characters=characters;p.worldbook=worldbook;
        if(b.value){requireValue(['outline','script'].includes(b.stage),'无效阶段');if(b.stage==='script')for(const scene of b.value.scenes||[])for(const shot of scene.shots||[])validateDirection(shot);if(JSON.stringify(b.value)!==JSON.stringify(p[b.stage])||p.stale[b.stage])applyDocument(p,b.stage,validateDocument(b.stage,b.value));}
      }
      revise(p);Object.assign(original,p);persist();return json(res,p);
    }
    const extraFiles={'/coach.js':'text/javascript','/shot-canvas.js':'text/javascript','/character-images.js':'text/javascript','/audio-panel.js':'text/javascript','/creation-editor.js':'text/javascript','/settings-extra.js':'text/javascript','/creation.css':'text/css','/assets/cyancreator-icon.png':'image/png'};
    if(extraFiles[u.pathname]&&['GET','HEAD'].includes(method)){res.setHeader('Cache-Control','no-store');return serveFile(req,res,path.join(ROOT,'public',u.pathname.slice(1)),extraFiles[u.pathname]);}
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
    if (u.pathname === '/api/onboarding' && method === 'POST') {const b = await body(req); requireValue(typeof b.done === 'boolean', '参数无效'); state.onboarded = b.done; persist(); return json(res, {ok: true, onboarded: state.onboarded});}
    if (u.pathname === '/api/probe' && method === 'POST') {
      const {kind, role, profileId, start} = await body(req); requireValue(['text', 'comfy','native'].includes(kind), '不支持的检查类型');
      if(kind==='native')return json(res,await deployments.native.check(state.deploymentConfig,AbortSignal.timeout(60000)));
      const config = kind === 'comfy' ? state.settings.video : profileId ? state.settings.text.profiles.find(p => p.id === profileId) : resolveTextConfig(state.settings.text, role || 'outline');
      requireValue(config, '模型配置不存在');
      if(kind==='comfy'&&start){
        requireValue(config.baseUrl.replace(/\/$/,'')===state.deploymentConfig.comfyUrl.replace(/\/$/,''), '自动启动地址须与部署设置中的 ComfyUI 本机地址一致');
        requireValue(!state.deployments.some(j=>['queued','running'].includes(j.status)), '请等待当前部署任务结束后再检查');
        await deployments.runtime.ensureVideo(state.deploymentConfig,AbortSignal.timeout(180000));
      }
      return json(res, await probe(config, kind));
    }
    if (u.pathname === '/api/projects/import' && method === 'POST') {
      const b = await body(req); const m = b && b.project;
      requireValue(m && typeof m === 'object' && !Array.isArray(m), '无效的工程档案');
      requireValue(typeof m.name === 'string' && m.name.trim() && m.name.length <= 100, '工程档案缺少有效的项目名称');
      requireValue(Array.isArray(m.files) && m.files.length <= 2000, '工程档案素材清单无效');
      requireValue(state.projects.length < 100, '项目数量已达上限（100）');
      const entries = new Map();
      const isBytes = v => Buffer.isBuffer(v) || (v && v.type === 'Buffer' && Array.isArray(v.data));
      for (const f of m.files) {
        requireValue(f && typeof f.id === 'string' && /^[\w-]{1,100}$/.test(f.id) && !entries.has(f.id), '素材 ID 无效或重复：' + (f && f.id));
        requireValue(f.bytes === null || f.bytes === undefined || isBytes(f.bytes), '素材内容无效：' + f.id);
        entries.set(f.id, f);
      }
      const p = structuredClone(m);
      p.id = randomUUID(); p.scriptVersion = randomUUID(); p.revision = 1; p.updatedAt = new Date().toISOString();
      p.history = Array.isArray(p.history) ? p.history.slice(0, 50) : [];
      p.episodes = Array.isArray(p.episodes) ? p.episodes : [];
      delete p.files;
      initCreation(p);
      // 素材 ID 全工作台唯一：导入时全部换新 ID，并重映射项目内引用，避免与现有项目冲突。
      const idMap = new Map([...entries.keys()].map(id => [id, randomUUID()]));
      const remap = id => idMap.get(id) || id;
      p.selectedShots = {};
      for (const chapter of p.episodes.flatMap(e => e.chapters || [])) if (chapter.selectedShots) chapter.selectedShots = {};
      if (Array.isArray(p.timeline)) p.timeline = p.timeline.map(c => ({...c, assetId: remap(c.assetId)}));
      if (Array.isArray(p.audioTracks)) p.audioTracks = p.audioTracks.map(t => ({...t, assetId: remap(t.assetId)}));
      if (p.characterReferences && typeof p.characterReferences === 'object') p.characterReferences = Object.fromEntries(Object.entries(p.characterReferences).map(([k, v]) => [k, remap(v)]));
      const imported = [];
      for (const [id, f] of entries) {
        if (f.bytes === null || f.bytes === undefined) continue;
        const content = Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes.data);
        const ext = (typeof f.name === 'string' && f.name.includes('.')) ? f.name.split('.').pop().toLowerCase().replace(/[\w-]/g, '') : '';
        const safeExt = ['mp4', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'bin';
        const newId = idMap.get(id);
        const file = path.join(MEDIA, `${newId}.${safeExt}`);
        writeFileSync(file, content);
        const a = {id: newId, name: String(f.name ?? '素材').slice(0, 120), kind: ['video', 'audio', 'image'].includes(f.kind) ? f.kind : 'video', projectId: p.id, file, createdAt: f.createdAt || new Date().toISOString(), url: `/media/${newId}`};
        if (f.scriptVersion) a.scriptVersion = f.scriptVersion;
        if (f.scene !== null && f.scene !== undefined) a.scene = f.scene;
        if (f.shot !== null && f.shot !== undefined) a.shot = f.shot;
        if (f.characterId) a.characterId = f.characterId;
        if (f.chapterId) a.chapterId = f.chapterId;
        if (f.imageMode) a.imageMode = f.imageMode;
        if (f.jobId) a.jobId = f.jobId;
        if (f.duration !== null && f.duration !== undefined) a.duration = f.duration;
        if (f.audio !== null && f.audio !== undefined) a.audio = f.audio;
        state.assets.push(a); imported.push(id);
      }
      state.projects.unshift(p); persist();
      return json(res, {project: p, imported: imported.length, missing: entries.size - imported.length}, 201);
    }
    if (u.pathname === '/api/projects' && method === 'POST') {
      const b = await body(req); requireValue(typeof b.name === 'string' && b.name.trim(), '请填写项目名称');
      const p = {id: randomUUID(),scriptVersion:randomUUID(), name: b.name.slice(0, 100), brief: '', bible: '', outline: null, script: null, review: null, stale: {}, timeline: [], history: [], revision: 1, updatedAt: new Date().toISOString()};
      initCreation(p);state.projects.unshift(p); persist(); return json(res, p, 201);
    }
    if(u.pathname==='/api/prompt-preview'&&method==='POST'){const b=await body(req),p=projectById(b.projectId),scene=p.script?.scenes[b.scene],shot=scene?.shots[b.shot];requireValue(shot,'镜头不存在');const prompt=compileShot({...shot,prompt:typeof b.prompt==='string'?b.prompt:shot.prompt},p,scene);return json(res,{prompt,characters:prompt.length,extraTextModelCalls:0});}
    const shotRoute=u.pathname.match(/^\/api\/projects\/([\w-]+)\/shots\/(\d+)\/(\d+)\/(edit|select)$/);
    if(shotRoute&&method==='POST'){
      const p=projectById(shotRoute[1]),b=await body(req),si=Number(shotRoute[2]),i=Number(shotRoute[3]);
      requireValue(b.revision===p.revision,'项目已变化，请刷新后重试',409);
      const shot=p.script?.scenes[si]?.shots[i];requireValue(shot,'镜头不存在');
      if(shotRoute[4]==='edit'){
        const updated=editShot(shot,b,state.settings.video);
        p.history.unshift({id:randomUUID(),stage:'script',value:structuredClone(p.script),revision:p.revision,at:new Date().toISOString()});p.history=p.history.slice(0,50);
        p.script.scenes[si].shots[i]=updated;p.stale.review=!!p.review;
      }else{
        const asset=state.assets.find(a=>a.id===b.assetId&&a.projectId===p.id&&a.scriptVersion===p.scriptVersion&&a.scene===si&&a.shot===i);
        requireValue(asset,'只能选定当前剧本该镜头的生成版本');p.selectedShots??={};p.selectedShots[`${si}-${i}`]=asset.id;
      }
      revise(p);persist();return json(res,p);
    }
    if(u.pathname==='/api/video/batch'&&method==='POST'){
      const b=await body(req),p=projectById(b.projectId);requireValue(b.revision===p.revision,'项目已变化，请刷新后重试',409);
      requireValue(Array.isArray(b.shots)&&b.shots.length>0&&b.shots.length<=20,'请选择 1–20 个镜头');
      requireValue(new Set(b.shots.map(s=>`${s.scene}-${s.shot}`)).size===b.shots.length,'镜头重复');
      requireValue(state.jobs.filter(j=>['queued','running'].includes(j.status)).length+b.shots.length<=20,'队列容量不足，请减少批量镜头');
      const continueSeed=b.seedMode==='continue';
      if(continueSeed)requireValue(['native','comfy'].includes(state.settings.video.provider),'Seed 延续仅支持本地模型（原生 Diffusers / ComfyUI）');
      // 按镜头时间序推进：baseSeed + 序号，同批次内每个镜头获得稳定且递增的 seed。
      let baseSeed=continueSeed?Number(state.settings.video.params?.seed)||0:null;
      const jobs=b.shots.map(s=>{
        const spec=videoJob(p,s);
        if(continueSeed){spec.config.params.seed=(baseSeed+spec.scene*1000+spec.shot)>>>0;spec.seedContinued=true;}
        return {id:randomUUID(),projectId:p.id,kind:'video',status:'queued',baseRevision:p.revision,snapshot:taskSnapshot(p),createdAt:new Date().toISOString(),...spec};
      });
      state.jobs.unshift(...jobs.reverse());persist();json(res,{ids:jobs.map(j=>j.id)},202);void pump();return;
    }
    const manageRoute = u.pathname.match(/^\/api\/projects\/([\w-]+)$/);
    if (manageRoute && method === 'POST') {
      const p = projectById(manageRoute[1]), b = await body(req), action = b.action;
      if (action === 'rename') {
        requireValue(typeof b.name === 'string' && b.name.trim() && b.name.length <= 100, '项目名称须为 1–100 字符');
        p.name = b.name.trim(); revise(p); persist(); return json(res, p);
      }
      if (action === 'duplicate') {
        requireValue(state.projects.length < 100, '项目数量已达上限（100）');
        requireValue(![...state.jobs, ...state.deployments].some(j => ['queued', 'running'].includes(j.status) && j.projectId === p.id), '请等待该项目任务结束后再复制');
        const copy = structuredClone(p); copy.id = randomUUID(); copy.scriptVersion = randomUUID(); copy.selectedShots = {};
        copy.name = (p.name + ' · 副本').slice(0, 100); copy.revision = 1; copy.updatedAt = new Date().toISOString();
        initCreation(copy); state.projects.unshift(copy); persist(); return json(res, copy, 201);
      }
      if (action === 'export') {
        requireValue(![...state.jobs, ...state.deployments].some(j => ['queued', 'running'].includes(j.status) && j.projectId === p.id), '请等待该项目任务结束后再导出');
        stashChapter(p);
        const manifest = structuredClone(p); manifest.files = [];
        for (const a of state.assets.filter(a => a.projectId === p.id)) {
          let bytes = null; try {bytes = readFileSync(a.file);} catch {}
          manifest.files.push({id: a.id, name: a.name, kind: a.kind, projectId: a.projectId, scriptVersion: a.scriptVersion ?? null, scene: a.scene ?? null, shot: a.shot ?? null, characterId: a.characterId ?? null, chapterId: a.chapterId ?? null, imageMode: a.imageMode ?? null, jobId: a.jobId ?? null, duration: a.duration ?? null, audio: a.audio ?? null, createdAt: a.createdAt, bytes});
        }
        return json(res, manifest);
      }
      requireValue(false, '未知的操作');
    }
    const match = u.pathname.match(/^\/api\/projects\/([\w-]+)$/);
    if (match && method === 'PUT') {
      const original = projectById(match[1]), p = structuredClone(original), b = await body(req);
      requireValue(b.revision === p.revision, '项目已变化，请刷新后重试', 409);
      if ('stage' in b) {requireValue(['outline', 'script', 'review'].includes(b.stage), '无效阶段'); applyDocument(p, b.stage, validateDocument(b.stage, b.value));}
      else {
        for (const key of ['name', 'brief', 'bible']) if (key in b) {requireValue(typeof b[key] === 'string' && b[key].length <= 50000, '文本长度无效'); if (b[key] !== p[key] && key !== 'name') invalidateChapters(p); p[key] = b[key];}
        if ('exportPreset' in b) {requireValue([null, '720p', '1080p', '720-vertical', '1080-vertical'].includes(b.exportPreset), '导出档位无效'); p.exportPreset = b.exportPreset || null; revise(p);}
        if('__firstFrame' in b){const {scene,shot,assetId}=b.__firstFrame;requireValue(Number.isInteger(scene)&&Number.isInteger(shot),'镜头索引无效');const target=p.script?.scenes[scene]?.shots[shot];requireValue(target,'镜头不存在');requireValue(typeof assetId==='string'&&assetId.length<=100,'首帧素材引用无效');requireValue(state.assets.some(a=>a.id===assetId&&a.kind==='image'),'首帧必须是图片素材');target.firstFrameId=assetId;revise(p);}
        if('__clearFirstFrame' in b){const {scene,shot}=b.__clearFirstFrame;requireValue(Number.isInteger(scene)&&Number.isInteger(shot),'镜头索引无效');const target=p.script?.scenes[scene]?.shots[shot];requireValue(target,'镜头不存在');delete target.firstFrameId;revise(p);}
        if('characterReference' in b){const {characterId,assetId}=b.characterReference;requireValue(p.characters.some(c=>c.id===characterId),'角色不存在');requireValue(state.assets.some(a=>a.id===assetId&&a.kind==='image'&&a.projectId===p.id&&a.characterId===characterId),'图片不属于此角色');p.characterReferences??={};p.characterReferences[characterId]=assetId;}
        if('audioTracks' in b)p.audioTracks=validateTracks(b.audioTracks,state.assets.filter(a=>a.projectId===p.id));
        if ('subtitles' in b) {
          requireValue(Array.isArray(b.subtitles) && b.subtitles.length <= 500, '字幕条目无效（最多 500）');
          p.subtitles = b.subtitles.map(st => {requireValue(typeof st.text === 'string' && st.text.trim() && st.text.length <= 200, '字幕文本须为 1–200 字'); return {start: number(st.start, 0, 86400, '字幕起点'), end: number(st.end, st.start + 0.1, 86400, '字幕终点'), text: st.text.trim()};});
          revise(p);
        }
        if ('timeline' in b) {
          requireValue(Array.isArray(b.timeline) && b.timeline.length <= 200, '时间线格式错误');
          for (const [i,clip] of b.timeline.entries()) {const a = state.assets.find(a => a.id === clip.assetId && a.projectId === p.id); requireValue(a&&!['audio','image'].includes(a.kind), '视频素材不属于本项目'); number(clip.start, 0, a.duration, '入点'); number(clip.end, clip.start + 0.04, a.duration + 0.02, '出点'); number(clip.volume, 0, 2, '音量'); if(clip.transition!==undefined&&clip.transition!==null&&clip.transition!==''&&clip.transition!=='fade')throw Object.assign(new Error('转场仅支持交叉溶解（fade）'),{status:400}); if(clip.transition==='fade'&&i===b.timeline.length-1)throw Object.assign(new Error('转场不能用于最后一个片段'),{status:400}); if(!clip.transition)delete clip.transition;}
          p.timeline = b.timeline;
        }
        revise(p);
      }
      Object.assign(original, p); persist(); return json(res, p);
    }
    if (u.pathname === '/api/assets' && method === 'POST') {
      const p = projectById(u.searchParams.get('projectId'));
      const characterId=u.searchParams.get('characterId');if(u.searchParams.get('kind')==='image')requireValue(p.characters.some(c=>c.id===characterId),'请选择本项目角色');
      const a = await saveAsset(req, u.searchParams.get('name') || '导入素材', p.id,undefined,['audio','image'].includes(u.searchParams.get('kind'))?u.searchParams.get('kind'):undefined); if(a.kind==='image'){a.characterId=characterId;persist();}const {file, ...safe} = a; return json(res, safe, 201);
    }
    if (u.pathname === '/api/assets/usage' && method === 'GET') return json(res, assetUsage());
    const assetRoute = u.pathname.match(/^\/api\/assets\/([\w-]+)$/);
    if (assetRoute && method === 'PUT') {
      const a = state.assets.find(x => x.id === assetRoute[1]); requireValue(a, '素材不存在', 404);
      const b = await body(req); requireValue(typeof b.name === 'string' && b.name.trim() && b.name.length <= 120, '名称须为 1–120 字符');
      a.name = b.name.trim(); persist(); const {file, ...safe} = a; return json(res, safe);
    }
    if (assetRoute && method === 'DELETE') {
      const a = state.assets.find(x => x.id === assetRoute[1]); requireValue(a, '素材不存在', 404);
      const usedIn = [];
      for (const p of state.projects) {
        if (p.timeline?.some(c => c.assetId === a.id)) usedIn.push('时间线 · ' + p.name);
        if (p.audioTracks?.some(t => t.assetId === a.id)) usedIn.push('音轨 · ' + p.name);
        if (Object.values(p.selectedShots || {}).includes(a.id)) usedIn.push('选定镜头版本 · ' + p.name);
        if (p.characterReferences && Object.values(p.characterReferences).includes(a.id)) usedIn.push('角色参考图 · ' + p.name);
      }
      requireValue(!usedIn.length, '素材仍被引用（' + usedIn.slice(0, 3).join('、') + (usedIn.length > 3 ? ' 等' : '') + '），请先移除引用');
      state.assets = state.assets.filter(x => x.id !== a.id); persist();
      await unlink(a.file).catch(() => {});
      return json(res, {ok: true});
    }
    if (manageRoute && method === 'DELETE') {
      const p = projectById(manageRoute[1]);
      requireValue(![...state.jobs, ...state.deployments].some(j => ['queued', 'running'].includes(j.status) && j.projectId === p.id), '请等待该项目任务结束后再删除');
      const linked = state.assets.filter(a => a.projectId === p.id);
      const linkedIds = new Set(linked.map(a => a.id));
      const shared = [];
      for (const x of state.projects) {
        if (x.id === p.id) continue;
        if (x.timeline?.some(c => linkedIds.has(c.assetId))) shared.push('时间线 · ' + x.name);
        if (x.audioTracks?.some(t => linkedIds.has(t.assetId))) shared.push('音轨 · ' + x.name);
        if (Object.values(x.selectedShots || {}).some(id => linkedIds.has(id))) shared.push('选定镜头版本 · ' + x.name);
        if (x.characterReferences && Object.values(x.characterReferences).some(id => linkedIds.has(id))) shared.push('角色参考图 · ' + x.name);
      }
      requireValue(!shared.length, '素材仍被其他项目引用，请先处理：' + shared.slice(0, 3).join('、') + (shared.length > 3 ? ' 等' : ''));
      state.projects = state.projects.filter(x => x.id !== p.id);
      state.assets = state.assets.filter(a => a.projectId !== p.id);
      persist();
      for (const a of linked) await unlink(a.file).catch(() => {});
      return json(res, {ok: true, removed: linked.length});
    }
    if (u.pathname === '/api/jobs' && method === 'POST') {
      const b = await body(req);
      if (b.kind === 'coach') {
        requireValue(typeof b.message === 'string' && b.message.trim() && b.message.length <= 4000, '请输入 1–4000 字的助手消息');
        requireValue(['guide', 'expert'].includes(b.mode), '助手模式无效');
        requireValue(!state.jobs.some(j => j.kind === 'coach' && ['queued', 'running'].includes(j.status)), '请等待当前回复完成或先取消');
        const p = b.projectId ? projectById(b.projectId) : null;
        const job = {id: randomUUID(), kind: 'coach', status: 'queued', createdAt: new Date().toISOString(), ...(p ? {projectId: p.id, chapterId: p.activeChapterId} : {})};
        job.coach = {message: b.message.trim(), mode: b.mode, page: String(b.page || '').slice(0, 40)};
        job.config = structuredClone(resolveTextConfig(state.settings.text, 'outline'));
        state.jobs.unshift(job); persist(); json(res, {id: job.id}, 202); void pump(); return;
      }
      const p = projectById(b.projectId);
      requireValue(['outline', 'script', 'review', 'video', 'export','assist','guide','speech','speech-deploy','character-image'].includes(b.kind), '无效任务类型');
      requireValue(state.jobs.filter(j => ['queued', 'running'].includes(j.status)).length < 20, '队列已满');
      if (b.kind === 'outline') requireValue(p.brief.trim(), '请先保存创作简报');
      if (b.kind === 'script') requireValue(p.outline && !p.stale.outline, '请先生成或确认最新大纲');
      if (b.kind === 'review') requireValue(p.script && !p.stale.script && !p.stale.outline, '请先完成最新剧本');
      if (b.kind === 'export') {requireValue(p.timeline.length, '请先添加时间线片段'); requireValue([undefined,'720p','1080p','720-vertical','1080-vertical'].includes(b.preset), '导出档位无效');}
      const job = {id: randomUUID(), projectId: p.id, chapterId:p.activeChapterId, kind: b.kind, status: 'queued', baseRevision: p.revision, snapshot: taskSnapshot(p), createdAt: new Date().toISOString()};
      if (b.kind === 'export' && b.preset) job.exportPreset = b.preset;
      if (['outline', 'script', 'review'].includes(b.kind)) job.config = structuredClone(resolveTextConfig(state.settings.text, b.kind));
      if(b.kind==='speech-deploy'){requireValue(!state.jobs.some(j=>j.kind==='speech-deploy'&&['queued','running'].includes(j.status)),'语音部署已排队');job.runtimeConfig=structuredClone(state.deploymentConfig);}
      if(b.kind==='speech'){requireValue(typeof b.text==='string'&&b.text.trim()&&b.text.length<=10000,'配音文字须为 1–10000 字符');job.text=b.text;job.characterId=b.characterId||'';requireValue(!job.characterId||p.characters.some(c=>c.id===job.characterId),'角色不存在');job.config=structuredClone(state.settings.speech);if(b.voice){requireValue(job.config.provider!=='piper','本地 Piper 当前使用已部署中文音色');job.config.voice=b.voice;}validateSpeech(job.config);}
      if(b.kind==='character-image'){const c=p.characters.find(c=>c.id===b.characterId);requireValue(c,'请先保存角色');Object.assign(job,{characterId:c.id,characterName:c.name,imageMode:b.mode,prompt:portraitPrompt(c,b.mode,b.instruction||'',p.worldbook),config:structuredClone(validateImage(state.settings.image))});}
      if(b.kind==='guide'){
requireValue(['outline','script','production'].includes(b.stage)&&typeof b.message==='string'&&b.message.trim()&&b.message.length<=6000,'请填写 1–6000 字的引导消息并选择阶段');
requireValue(!state.jobs.some(j=>j.kind==='guide'&&j.projectId===p.id&&j.chapterId===p.activeChapterId&&['queued','running'].includes(j.status)),'请等待当前回复完成或先取消');
job.guide={stage:b.stage,message:b.message.trim()};job.guideHistory=state.jobs.filter(j=>j.kind==='guide'&&j.projectId===p.id&&j.chapterId===p.activeChapterId&&j.status==='succeeded').slice(0,8).map(j=>({status:j.status,guide:j.guide,result:{reply:j.result.reply}}));
job.config=structuredClone(resolveTextConfig(state.settings.text,b.stage==='outline'?'outline':'script'));
}
if(b.kind==='assist'){requireValue(['outline','script','characters'].includes(b.stage)&&typeof b.instruction==='string'&&b.instruction.length<=10000,'伴写要求无效');job.assist={stage:b.stage,mode:String(b.mode||'续写').slice(0,100),instruction:b.instruction};job.config=structuredClone(resolveTextConfig(state.settings.text,b.stage==='outline'?'outline':'script'));}
      if (b.kind === 'video') {
        Object.assign(job,videoJob(p,b));
      }
      state.jobs.unshift(job); persist(); json(res, {id: job.id}, 202); void pump(); return;
    }
    const jm = u.pathname.match(/^\/api\/jobs\/([\w-]+)\/(cancel|apply)$/);
    if (jm && method === 'POST') {
      const job = state.jobs.find(j => j.id === jm[1]); requireValue(job, '任务不存在', 404);
      if (jm[2] === 'cancel') {
        requireValue(['queued', 'running'].includes(job.status), '任务已结束，无法取消');
        if (job.status === 'queued') job.status = 'cancelled'; else {job.progress={phase:'cancelling',message:'正在取消本地执行 / 断开远端等待'};controllers.get(job.id)?.abort();}
      } else {
        const b = await body(req), p = projectById(job.projectId);
        requireValue(job.status === 'succeeded' && job.result && !job.applied, '没有可应用的结果');
        requireValue(b.revision === p.revision, '项目已变化，请刷新后重试', 409);
        requireValue(!job.chapterId||job.chapterId===p.activeChapterId,'请先切换到任务所属章节');
        if(job.kind==='guide'){requireValue(job.result.candidate&&['outline','script'].includes(job.guide.stage),'此回复没有可应用的稿件');requireValue(p.revision===job.baseRevision,'生成后稿件已修改，请基于最新稿件重新整理候选',409);applyDocument(p,job.guide.stage,job.result.candidate);}else if(job.kind==='assist'&&job.assist.stage==='characters'){p.characters=validateLibrary([...p.characters,...job.result.characters],'characters');invalidateChapters(p);revise(p);}else applyDocument(p,job.kind==='assist'?job.assist.stage:job.kind,job.result);job.applied=true;
      }
      persist(); return json(res, {ok: true});
    }
    const mm = u.pathname.match(/^\/media\/([\w-]+)$/);
    if (mm && ['GET', 'HEAD'].includes(method)) {const a = state.assets.find(a => a.id === mm[1]); requireValue(a, '素材不存在', 404); return serveFile(req, res, a.file, a.mime || 'video/mp4');}
    const files = {'/video-workbench.js':['video-workbench.js','text/javascript; charset=utf-8'],'/native-settings.js':['native-settings.js','text/javascript; charset=utf-8'],'/model-hub.js':['model-hub.js','text/javascript; charset=utf-8'], '/text-models.js': ['text-models.js', 'text/javascript; charset=utf-8'], '/asset-library.js':['asset-library.js','text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
    if (files[u.pathname] && ['GET', 'HEAD'].includes(method)) {res.setHeader('Cache-Control','no-store');return serveFile(req, res, path.join(ROOT, 'public', files[u.pathname][0]), files[u.pathname][1]);}
    json(res, {error: '接口不存在'}, 404);
  } catch (e) {if (!res.headersSent) json(res, {error: safeError(e)}, e.status || 400); else res.destroy();}
});
server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`CyanCreator 0.4.1 · http://127.0.0.1:${server.address().port}`));
