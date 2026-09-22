// 端到端：真实服务 → 上传 3 段 → 时间线 3 种不同转场 → 导出 → ffprobe 校验 → 抽帧证明转场生效
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, readdir, writeFile, rm, stat, copyFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.CYAN_OUT || path.join(ROOT, 'test-output', 'e2e');
const FF = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FP = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = r => r.json().catch(() => ({}));
const run = (exe, args) => new Promise((res, rej) => { let o = '', e = ''; const c = spawn(exe, args, {stdio: ['ignore', 'pipe', 'pipe']}); c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d); c.on('exit', code => code === 0 ? res(o) : rej(new Error(exe + ' ' + code + ' ' + e.slice(0, 200)))); });

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
  const frames = [];
  for (const [t, nm] of [[0.5, 'e2e-plain-1'], [1.5, 'e2e-join1-wipeleft'], [3.0, 'e2e-join2-circleopen'], [4.3, 'e2e-plain-3']]) {
    const png = path.join(OUT, nm + '.png');
    await run(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', produced, '-frames:v', '1', png]);
    frames.push(png);
  }
  console.log('抽帧: ' + frames.map(f => path.basename(f)).join(', '));

  const summary = {serverTransitions: Object.keys(st.transitions || {}).length, defaultTransition: st.defaultTransition, illegalNameStatus: bad.status, mixedStatus: mixed.status, exportStatus: job.status, output: {w: v.width, h: v.height, duration: +dur.toFixed(2), codec: v.codec_name, bytes: (await stat(produced)).size}};
  await writeFile(path.join(OUT, 'e2e-report.json'), JSON.stringify(summary, null, 1));
  console.log('\n端到端结论: ' + JSON.stringify(summary));
  if (summary.illegalNameStatus !== 400 || summary.mixedStatus !== 400 || summary.exportStatus !== 'succeeded' || summary.output.w !== 1280 || summary.output.h !== 720) { console.error('端到端断言失败'); process.exitCode = 1; }
} finally {
  child.kill('SIGKILL');
  await sleep(300);
  await rm(workDir, {recursive: true, force: true}).catch(() => {});
}
