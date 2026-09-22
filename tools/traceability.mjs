// 数据可追踪性抽样：持久化结构、审计字段、引用完整性、原子写入、重启存活
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, readdir, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {fileURLToPath} from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = r => r.json().catch(() => ({}));
const out = [];
const rec = (t, ok, d = '') => { out.push({t, ok, detail: String(d)}); console.log((ok ? 'PASS' : 'FAIL') + ' ' + t + (d ? ' · ' + d : '')); };

async function start(dataDir) {
  const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, PORT: '0', CYANCREATOR_DATA: dataDir, FFMPEG_PATH: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'}, stdio: ['ignore', 'pipe', 'pipe']});
  const port = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no port')), 10000); child.stdout.on('data', d => { const m = String(d).match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } }); });
  const BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/state`)).ok) break; } catch {} await sleep(200); }
  return {child, BASE};
}
const workDir = await mkdtemp(path.join(tmpdir(), 'cyan-trace-'));
const dataDir = path.join(workDir, 'data');
let {child, BASE} = await start(dataDir);

try {
  const st = await j(await fetch(`${BASE}/api/state`));
  const auth = {'content-type': 'application/json', 'x-workspace-token': st.token, origin: BASE};

  const p1 = await j(await fetch(`${BASE}/api/projects`, {method: 'POST', headers: auth, body: JSON.stringify({name: '台账抽样 A'})}));
  const p2 = await j(await fetch(`${BASE}/api/projects`, {method: 'POST', headers: auth, body: JSON.stringify({name: '台账抽样 B'})}));
  const clip = path.join(workDir, 'c.mp4');
  await new Promise((res, rej) => { const c = spawn(process.env.FFMPEG_PATH || '/usr/bin/ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], {stdio: 'ignore'}); c.on('exit', c2 => c2 === 0 ? res() : rej(new Error('ffmpeg'))); });
  const buf = await readFile(clip);
  const a1 = await j(await fetch(`${BASE}/api/assets?projectId=${p1.id}&name=a.mp4`, {method: 'POST', headers: {origin: BASE, 'x-workspace-token': st.token}, body: buf}));
  const a2 = await j(await fetch(`${BASE}/api/assets?projectId=${p2.id}&name=b.mp4`, {method: 'POST', headers: {origin: BASE, 'x-workspace-token': st.token}, body: buf}));
  await fetch(`${BASE}/api/projects/${p1.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: p1.revision, timeline: [{assetId: a1.id, start: 0, end: 1, volume: 1}]})});
  await fetch(`${BASE}/api/projects/${p2.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: p2.revision, timeline: [{assetId: a2.id, start: 0, end: 1, volume: 1}]})});

  // ---- 字段完备性（真实数据模型）----
  const P = (await j(await fetch(`${BASE}/api/state`))).projects;
  const pp = P.find(x => x.id === p1.id);
  rec('schema:project-id-name-revision', !!(pp.id && pp.name && Number.isFinite(pp.revision)), `id=${pp.id.slice(0, 8)} name=${pp.name} rev=${pp.revision}`);
  rec('schema:project-timeline-array', Array.isArray(pp.timeline) && pp.timeline.length === 1, `len=${pp.timeline.length}`);
  const aa = (await j(await fetch(`${BASE}/api/state`))).assets.find(x => x.id === a1.id);
  rec('schema:asset-provenance', !!(aa.id && aa.name && aa.projectId === p1.id && aa.createdAt && aa.url), `name=${aa.name} url=${aa.url} createdAt=${aa.createdAt ? 'yes' : 'no'}`);
  rec('schema:asset-media-metadata', Number.isFinite(aa.duration) && aa.width === 320 && aa.height === 180 && aa.mime === 'video/mp4', `dur=${aa.duration}s ${aa.width}x${aa.height} ${aa.mime} ext=${aa.extension}`);
  rec('schema:asset-linkable-to-project', aa.projectId === p1.id, 'projectId=' + aa.projectId.slice(0, 8));

  // ---- 引用完整性：删除仍被时间线引用的素材应被拒绝 ----
  const del = await fetch(`${BASE}/api/assets/${a1.id}`, {method: 'DELETE', headers: auth});
  const delBody = await j(del);
  rec('ref-integrity:delete-referenced-blocked', del.status === 400, 'status=' + del.status + ' msg=' + (delBody.error || '').slice(0, 40));
  const stillThere = (await j(await fetch(`${BASE}/api/state`))).assets.find(x => x.id === a1.id);
  rec('ref-integrity:asset-preserved', !!stillThere, 'still exists=' + !!stillThere);

  // ---- 作业台账字段 ----
  const jj = await j(await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: p2.id, kind: 'export', preset: '720p'})}));
  rec('schema:job-enqueue-returns-id', !!jj.id, `id=${(jj.id || '').slice(0, 8)}（POST /api/jobs 契约=202 {id}）`);
  const job = (await j(await fetch(`${BASE}/api/state`))).jobs.find(x => x.id === jj.id);
  rec('schema:job-linkable-to-project', !!job && job.projectId === p2.id, 'projectId=' + ((job && job.projectId) || '').slice(0, 8));
  rec('schema:job-has-kind-and-createdAt', !!job && job.kind === 'export' && !!job.createdAt, `kind=${job && job.kind} createdAt=${job && (job.createdAt ? 'yes' : 'no')}`);

  // ---- workspace.json 持久化 + 原子性 ----
  const ws = JSON.parse(await readFile(path.join(dataDir, 'workspace.json'), 'utf8'));
  rec('persist:workspace-json-keys', ['settings', 'projects', 'jobs', 'assets'].every(k => k in ws), Object.keys(ws).join(','));
  rec('persist:two-projects-stored', ws.projects.length >= 2, 'projects=' + ws.projects.length);
  rec('persist:media-files-on-disk', (await readdir(path.join(dataDir, 'media'))).length >= 2, 'media files=' + (await readdir(path.join(dataDir, 'media'))).length);
  const stray = (await readdir(dataDir)).filter(f => /\.tmp$/i.test(f));
  rec('persist:no-tmp-leftover', stray.length === 0, 'tmp files=' + JSON.stringify(stray));
  rec('persist:no-raw-bytes-in-workspace-json', !JSON.stringify(ws).includes('data:video'), 'workspace.json 只存元数据与文件引用');

  // ---- 重启后数据仍在 ----
  child.kill('SIGKILL');
  await sleep(600);
  ({child, BASE} = await start(dataDir));
  const st2 = await j(await fetch(`${BASE}/api/state`));
  rec('persist:survives-restart', st2.projects.some(x => x.id === p1.id) && st2.assets.some(x => x.id === a1.id), `projects=${st2.projects.length} assets=${st2.assets.length}`);
  const p1b = st2.projects.find(x => x.id === p1.id);
  rec('persist:revision-monotonic', p1b.revision >= pp.revision, `before=${pp.revision} after=${p1b.revision}`);
  rec('persist:job-history-kept', st2.jobs.some(x => x.id === jj.id), 'jobs=' + st2.jobs.length);

  const pass = out.filter(o => o.ok).length;
  console.log(`\n数据可追踪性抽样：${pass}/${out.length} ${pass === out.length ? 'ALL-PASS' : 'HAS-FAIL'}`);
  if (pass !== out.length) process.exitCode = 1;
  const rp = process.env.CYAN_REPORT || path.join(ROOT, 'test-output', 'traceability-report.json');
  await mkdir(path.dirname(rp), {recursive: true});
  await writeFile(rp, JSON.stringify({total: out.length, pass, results: out}, null, 1));
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await sleep(300);
  await rm(workDir, {recursive: true, force: true}).catch(() => {});
}
