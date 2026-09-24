// 端到端：真实服务 → 上传 3 段 → 时间线 3 种不同转场 → 导出 → ffprobe 校验 → 抽帧证明转场生效
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, readdir, writeFile, rm, stat, copyFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.CYAN_OUT || path.join(ROOT, 'test-output', 'e2e');
const FF = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FP = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = r => r.json().catch(() => ({}));
const run = (exe, args) => new Promise((res, rej) => { let o = '', e = ''; const c = spawn(exe, args, {stdio: ['ignore', 'pipe', 'pipe']}); c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d); c.on('exit', code => code === 0 ? res(o) : rej(new Error(exe + ' ' + code + ' ' + e.slice(0, 200)))); });
const sha256 = async f => createHash('sha256').update(await readFile(f)).digest('hex');
// 按导出任务解析产物：优先 job.assetId 对应文件，缺失时回退 media/ 下最大 mp4
const resolveProduced = async (assetId, exclude) => {
  const mediaDir = path.join(dataDir, 'media');
  const direct = path.join(mediaDir, assetId + '.mp4');
  if (assetId) { try { await stat(direct); return direct; } catch {} }
  let best = null, size = -1;
  for (const f of await readdir(mediaDir)) { if (!f.endsWith('.mp4')) continue; const full = path.join(mediaDir, f); if (exclude && full === exclude) continue; const s = await stat(full); if (s.size > size) { size = s.size; best = full; } }
  return best;
};
const exportAndWait = async (projectId, preset, auth) => {
  const ex = await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId, kind: 'export', preset})});
  const ej = await j(ex);
  let job = null;
  for (let i = 0; i < 120; i++) { await sleep(500); const s = await j(await fetch(`${BASE}/api/state`)); job = s.jobs.find(x => x.id === ej.id); if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) break; }
  return {enqueueStatus: ex.status, job};
};

const workDir = await mkdtemp(path.join(tmpdir(), 'cyan-e2e-'));
const dataDir = path.join(workDir, 'data');
const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, PORT: '0', CYANCREATOR_DATA: dataDir, FFMPEG_PATH: FF, FFPROBE_PATH: FP}, stdio: ['ignore', 'pipe', 'pipe']});
const port = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no port')), 10000); child.stdout.on('data', d => { const m = String(d).match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } }); });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/state`)).ok) break; } catch {} await sleep(200); }

try {
  const st = await j(await fetch(`${BASE}/api/state`));
  const auth = {'content-type': 'application/json', 'x-workspace-token': st.token, origin: BASE};
  console.log('转场目录（服务端下发）: ' + Object.keys(st.transitions || {}).length + ' 种，默认=' + st.defaultTransition);

  const p = await j(await fetch(`${BASE}/api/projects`, {method: 'POST', headers: auth, body: JSON.stringify({name: '端到端多转场'})}));
  // 3 段不同颜色的源片，便于肉眼区分转场
  const specs = [['red', '0xFF3B30'], ['green', '0x34C759'], ['blue', '0x007AFF']];
  const ids = [];
  for (const [nm, col] of specs) {
    const f = path.join(workDir, nm + '.mp4');
    await run(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${col}:s=1280x720:r=25`, '-t', '2.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    const up = await j(await fetch(`${BASE}/api/assets?projectId=${p.id}&name=${nm}.mp4`, {method: 'POST', headers: {origin: BASE, 'x-workspace-token': st.token}, body: await readFile(f)}));
    ids.push(up.id);
  }
  console.log('素材: ' + ids.map(x => x.slice(0, 8)).join(', '));

  // 时间线：join1=wipeleft，join2=circleopen（末段不带转场）
  const timeline = [
    {assetId: ids[0], start: 0, end: 1.5, volume: 1, transition: 'wipeleft'},
    {assetId: ids[1], start: 0, end: 1.5, volume: 1, transition: 'circleopen'},
    {assetId: ids[2], start: 0, end: 1.5, volume: 1},
  ];
  const put = await j(await fetch(`${BASE}/api/projects/${p.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: p.revision, timeline})}));
  console.log('时间线已保存 revision=' + put.revision);
  const bad = await fetch(`${BASE}/api/projects/${p.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: put.revision, timeline: [{assetId: ids[0], start: 0, end: 1, volume: 1, transition: 'wipex'}]})});
  console.log('非法转场名 → HTTP ' + bad.status + '（期望 400）');
  const mixed = await fetch(`${BASE}/api/projects/${p.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: put.revision, timeline: [{assetId: ids[0], start: 0, end: 1, volume: 1}, {assetId: ids[1], start: 0, end: 1, volume: 1, transition: 'fade'}]})});
  console.log('混合（部分硬切）→ HTTP ' + mixed.status + '（期望 400）');

  const ex = await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: p.id, kind: 'export', preset: '720p'})});
  const ej = await j(ex); console.log('导出入队 HTTP ' + ex.status + ' id=' + (ej.id || '').slice(0, 8));
  let job = null;
  for (let i = 0; i < 120; i++) { await sleep(500); const s = await j(await fetch(`${BASE}/api/state`)); job = s.jobs.find(x => x.id === ej.id); if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) break; }
  console.log('导出结果: ' + (job && job.status) + (job && job.error ? ' err=' + job.error.slice(0, 80) : ''));
  if (!job || job.status !== 'succeeded') throw new Error('导出未成功');

  // 导出产物是 media/ 下最大的 mp4（源素材为纯色小文件）
  const mediaDir = path.join(dataDir, 'media');
  let produced = null, best = -1;
  for (const f of await readdir(mediaDir)) { if (!f.endsWith('.mp4')) continue; const s = await stat(path.join(mediaDir, f)); if (s.size > best) { best = s.size; produced = path.join(mediaDir, f); } }
  if (!produced) throw new Error('未找到导出产物');
  console.log('导出产物: ' + path.basename(produced) + ' (' + best + ' B)');

  const probe = JSON.parse(await run(FP, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', produced]));
  const v = probe.streams.find(s => s.codec_type === 'video');
  const dur = Number(probe.format.duration);
  console.log(`ffprobe: ${v.width}x${v.height} · ${dur.toFixed(2)}s · ${v.codec_name}`);

  // 抽帧证明两个转场处各不同（时间线 1.25–1.75 是 join1，2.75–3.25 是 join2）
  await mkdir(OUT, {recursive: true});
  await copyFile(produced, path.join(OUT, 'e2e-multi-transition.mp4'));
  const frameHash = async (file) => sha256(file);
  const grab = async (srcFile, times, suffix) => {
    const out = [];
    for (const [t, nm] of times) {
      const png = path.join(OUT, `${nm}${suffix}.png`);
      await run(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', srcFile, '-frames:v', '1', png]);
      out.push({t, name: nm, hash: await frameHash(png)});
    }
    return out;
  };
  // 转场覆盖 offset..offset+0.5s（join1=1.5–2.0s、join2=3.0–3.5s），
  // 故必须取衔接中段抽样；起点帧与纯色片段内容相同，不能作为转场证据。
  const TIMES = [[0.5, 'e2e-plain-1'], [1.75, 'e2e-join1-wipeleft'], [3.25, 'e2e-join2-circleopen'], [4.3, 'e2e-plain-3']];
  const firstFrames = await grab(produced, TIMES, '');
  const distinctFrames = new Set(firstFrames.map(f => f.hash)).size === firstFrames.length;
  console.log('抽帧: ' + TIMES.map(([, nm]) => nm).join(', ') + '（4 帧内容哈希互异=' + distinctFrames + '）');

  // 第二次导出：验证渲染确定性（同源同参数 → 抽帧内容哈希一致）
  const second = await exportAndWait(p.id, '720p', auth);
  const produced2 = second.job?.status === 'succeeded' ? await resolveProduced(second.job.assetId, produced) : null;
  let deterministic = false, secondFrames = [];
  if (produced2) {
    secondFrames = await grab(produced2, TIMES, '-run2');
    deterministic = firstFrames.every((f, i) => f.hash === secondFrames[i].hash);
  }

  // 时长数学：parts 各 (end-start)+(转场?0.5:0) = 2.0/2.0/1.5 → 5.5s；两次 0.5s 交叉 → 4.5s
  const expectedDuration = timeline.reduce((s, c, i) => s + (c.end - c.start) + (i < timeline.length - 1 && c.transition ? 0.5 : 0), 0) - 0.5 * (timeline.length - 1);
  const durationOk = Math.abs(dur - expectedDuration) < 0.15;

  const summary = {serverTransitions: Object.keys(st.transitions || {}).length, defaultTransition: st.defaultTransition, illegalNameStatus: bad.status, mixedStatus: mixed.status, exportStatus: job.status, output: {w: v.width, h: v.height, duration: +dur.toFixed(2), expectedDuration: +expectedDuration.toFixed(2), durationOk, codec: v.codec_name, bytes: (await stat(produced)).size, sha256: await sha256(produced)}, frames: firstFrames.map(f => ({t: f.t, name: f.name, sha256: f.hash.slice(0, 16)})), framesAllDistinct: distinctFrames, reexport: {status: second.job?.status, deterministic, sha256: produced2 ? await sha256(produced2) : null}};
  await writeFile(path.join(OUT, 'e2e-report.json'), JSON.stringify(summary, null, 1));
  console.log('产物 SHA-256: ' + summary.output.sha256);
  console.log('抽帧哈希(前16位): ' + summary.frames.map(f => f.t + 's=' + f.sha256).join(' '));
  console.log('二次导出一致: ' + deterministic);
  console.log('\n端到端结论: ' + JSON.stringify(summary));
  const ok = summary.illegalNameStatus === 400 && summary.mixedStatus === 400 && summary.exportStatus === 'succeeded' && summary.output.w === 1280 && summary.output.h === 720 && summary.output.durationOk && summary.framesAllDistinct && summary.reexport.status === 'succeeded' && summary.reexport.deterministic;
  if (!ok) { console.error('端到端断言失败'); process.exitCode = 1; }
} finally {
  child.kill('SIGKILL');
  await sleep(300);
  await rm(workDir, {recursive: true, force: true}).catch(() => {});
}
