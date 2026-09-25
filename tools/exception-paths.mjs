// 异常路径回归（node --test 集成，零 npm 依赖）
//
// 覆盖 Goal Brief 的「异常路径已覆盖」标准：权限不足 / 空数据 / 重复提交 / 失败 / 取消 / 依赖不可用。
// 手法：拉起隔离实例（随机端口 + 临时数据目录），用真实 HTTP 断言，不依赖内部实现细节。
// 运行：node --test tools/exception-paths.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = r => r.json().catch(() => ({}));

async function startServer(dataDir, extraEnv = {}) {
  const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, PORT: '0', CYANCREATOR_DATA: dataDir, ...extraEnv}, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', d => { stderr += String(d); });
  const port = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('10s 未报告端口: ' + stderr)), 10000);
    child.stdout.on('data', d => { const m = String(d).match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } });
    child.on('exit', c => { clearTimeout(t); rej(new Error('服务退出 code=' + c + ' ' + stderr)); });
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return {child, port}; } catch {} await sleep(200); }
  throw new Error('服务未就绪');
}

test('异常路径：权限 / 空数据 / 重复提交 / 失败 / 取消 / 依赖不可用', {timeout: 240000}, async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'cyan-exp-'));
  const dataDir = path.join(workDir, 'data');
  const {child: server, port} = await startServer(dataDir);
  const BASE = `http://127.0.0.1:${port}`;
  try {
    const st = await j(await fetch(`${BASE}/api/state`));
    const token = st.token;
    const auth = {'content-type': 'application/json', 'x-workspace-token': token, origin: BASE};

    // 1) 权限不足
    assert.equal((await fetch(`${BASE}/api/projects`, {method: 'POST', headers: {'content-type': 'application/json', origin: BASE}, body: '{"name":"x"}'})).status, 403, '缺少令牌须 403');
    assert.equal((await fetch(`${BASE}/api/projects`, {method: 'POST', headers: {'content-type': 'application/json', 'x-workspace-token': 'bad', origin: BASE}, body: '{"name":"x"}'})).status, 403, '错误令牌须 403');
    assert.equal((await fetch(`${BASE}/api/projects`, {method: 'POST', headers: {'content-type': 'application/json', 'x-workspace-token': token, origin: 'https://evil.example'}, body: '{"name":"x"}'})).status, 403, '跨源须 403');
    assert.equal(typeof token, 'string');
    assert.ok(!JSON.stringify(await j(await fetch(`${BASE}/api/state`))).includes('secretValue'), '状态不得泄露密钥原文');

    // 2) 空数据
    assert.ok((await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: 'nope', kind: 'export'})})).status >= 400, '无时间线导出须失败');
    assert.equal((await fetch(`${BASE}/api/projects/missing`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: 1, timeline: []})})).status, 404, '项目不存在须 404');
    const proj = await j(await fetch(`${BASE}/api/projects`, {method: 'POST', headers: auth, body: JSON.stringify({name: '异常路径'})}));
    assert.equal((await fetch(`${BASE}/api/projects/${proj.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: proj.revision, timeline: 'not-an-array'})})).status, 400, '时间线类型错误须 400');

    // 素材（真实 ffmpeg 产物）
    const clipPath = path.join(workDir, 'c.mp4');
    const exe = process.env.FFMPEG_PATH || 'ffmpeg';
    await new Promise((res, rej) => { const c = spawn(exe, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath], {stdio: 'ignore'}); c.on('exit', code => code === 0 ? res() : rej(new Error('ffmpeg 失败'))); });
    const clipBuf = await readFile(clipPath);
    const up = await j(await fetch(`${BASE}/api/assets?projectId=${proj.id}&name=clip.mp4`, {method: 'POST', headers: {origin: BASE, 'x-workspace-token': token}, body: clipBuf}));
    assert.ok(up.id, '素材上传成功');

    // 3) 重复提交（过期 revision）
    let cur = await j(await fetch(`${BASE}/api/state`));
    let P = cur.projects.find(x => x.id === proj.id);
    await fetch(`${BASE}/api/projects/${proj.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: P.revision, timeline: [{assetId: up.id, start: 0, end: 1, volume: 1}]})});
    cur = await j(await fetch(`${BASE}/api/state`)); P = cur.projects.find(x => x.id === proj.id);
    assert.equal((await fetch(`${BASE}/api/projects/${proj.id}`, {method: 'PUT', headers: auth, body: JSON.stringify({revision: P.revision - 1, timeline: [{assetId: up.id, start: 0, end: 1, volume: 1}]})})).status, 409, '过期修订须 409');
    assert.ok([200, 201, 202].includes((await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: proj.id, kind: 'export', preset: '720p'})})).status), '导出入队应被受理');
    assert.equal((await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: proj.id, kind: 'export', preset: '4k'})})).status, 400, '非法档位须 400');

    // 4) 失败路径（端点不可达）
    const settings = await j(await fetch(`${BASE}/api/state`));
    const s2 = structuredClone(settings.settings);
    s2.text = {...s2.text, provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9', model: 'x', keyEnv: 'NOPE_KEY'};
    await fetch(`${BASE}/api/settings`, {method: 'PUT', headers: auth, body: JSON.stringify(s2)});
    const failJob = await j(await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: proj.id, kind: 'assist', stage: 'outline', mode: '构思', instruction: '写一句'})}));
    let failed = null;
    for (let i = 0; i < 40; i++) { await sleep(500); const s = await j(await fetch(`${BASE}/api/state`)); failed = s.jobs.find(x => x.id === failJob.id); if (failed && ['failed', 'succeeded', 'cancelled'].includes(failed.status)) break; }
    assert.ok(failed && failed.status === 'failed', '不可达端点须落到 failed');
    assert.ok(typeof failed.error === 'string' && failed.error.length > 0, '失败须带可读错误');

    // 5) 取消与未知任务
    const cJob = await j(await fetch(`${BASE}/api/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({projectId: proj.id, kind: 'assist', stage: 'outline', mode: '构思', instruction: '再写一句'})}));
    const cancelRes = await fetch(`${BASE}/api/jobs/${cJob.id}/cancel`, {method: 'POST', headers: auth, body: '{}'});
    const cancelBody = await j(cancelRes);
    assert.ok([200, 202, 204].includes(cancelRes.status) || (cancelRes.status === 400 && /结束|完成|取消|不存在|已/.test(cancelBody.error || '')), '取消须受理，或对已结束任务给出受保护提示');
    assert.equal((await fetch(`${BASE}/api/jobs/no-such-job/cancel`, {method: 'POST', headers: auth, body: '{}'})).status, 404, '未知任务取消须 404');

    // 6) 依赖不可用（ffmpeg 路径不存在）
    const noff = await startServer(path.join(workDir, 'data-noff'), {FFMPEG_PATH: '/nonexistent/ffmpeg'});
    try {
      const NB = `http://127.0.0.1:${noff.port}`;
      const ns = await j(await fetch(`${NB}/api/state`));
      const nauth = {'content-type': 'application/json', 'x-workspace-token': ns.token, origin: NB};
      const np = await j(await fetch(`${NB}/api/projects`, {method: 'POST', headers: nauth, body: JSON.stringify({name: '无 ffmpeg'})}));
      const nup = await j(await fetch(`${NB}/api/assets?projectId=${np.id}&name=c.mp4`, {method: 'POST', headers: {origin: NB, 'x-workspace-token': ns.token}, body: clipBuf}));
      assert.ok(nup.id, '依赖缺失时上传仍受理（延迟到使用时失败）');
      await fetch(`${NB}/api/projects/${np.id}`, {method: 'PUT', headers: nauth, body: JSON.stringify({revision: np.revision, timeline: [{assetId: nup.id, start: 0, end: 1, volume: 1}]})});
      const nj = await j(await fetch(`${NB}/api/jobs`, {method: 'POST', headers: nauth, body: JSON.stringify({projectId: np.id, kind: 'export', preset: '720p'})}));
      let nd = null;
      for (let i = 0; i < 40; i++) { await sleep(400); const s = await j(await fetch(`${NB}/api/state`)); nd = s.jobs.find(x => x.id === nj.id); if (nd && ['failed', 'succeeded', 'cancelled'].includes(nd.status)) break; }
      assert.ok(nd && nd.status === 'failed' && /媒体|ffmpeg|ENOENT|失败/i.test(nd.error || ''), '缺依赖导出须失败且错误可读');
      assert.equal((await fetch(`${NB}/api/state`)).status, 200, '依赖缺失时服务须存活可回应');
    } finally { noff.child.kill('SIGKILL'); }

    // 6b) 密钥保险库锁定（密文不可解密）与重置保护
    const sealedDir = await mkdtemp(path.join(tmpdir(), 'cyan-sealed-'));
    let sealedChild = null;
    try {
      if(process.platform==='win32'){
        const folder=path.join(sealedDir,'secrets');await mkdir(folder,{recursive:true});
        await writeFile(path.join(folder,'vault.dpapi'),Buffer.from('unreadable-dpapi-fixture'));
      }else{
        const s1 = await startServer(sealedDir, {CYANCREATOR_VAULT_KEY: 'unit-test-master-key-0123456789abcdef'});
        sealedChild = s1.child;
        const t1 = (await j(await fetch(`http://127.0.0.1:${s1.port}/api/state`))).token;
        const put1 = await fetch(`http://127.0.0.1:${s1.port}/api/secrets`, {method: 'PUT', headers: {'content-type': 'application/json', 'x-workspace-token': t1, origin: `http://127.0.0.1:${s1.port}`}, body: JSON.stringify({name: 'LOCKED_PROBE', value: 'fixture'})});
        assert.equal(put1.status, 200, '正常主密钥下保存密钥须成功');
        s1.child.kill('SIGKILL'); sealedChild = null;
        await sleep(300);
      }
      // Windows 用损坏密文，其他平台更换主密钥；服务都必须存活并报告 sealed。
      const s2 = await startServer(sealedDir, process.platform==='win32'?{}:{CYANCREATOR_VAULT_KEY: 'zz-wrong-master-key-0123456789abcdef-0123'});
      sealedChild = s2.child;
      const st2 = await j(await fetch(`http://127.0.0.1:${s2.port}/api/state`));
      assert.equal(st2.vault?.sealed, true, '不可解密时 /api/state 须报告 vault.sealed=true');
      assert.ok(st2.vault?.error, 'sealed 须带原因文案');
      const a2 = {'content-type': 'application/json', 'x-workspace-token': st2.token, origin: `http://127.0.0.1:${s2.port}`};
      const badPut = await fetch(`http://127.0.0.1:${s2.port}/api/secrets`, {method: 'PUT', headers: a2, body: JSON.stringify({name: 'LOCKED_PROBE', value: 'abc'})});
      assert.equal(badPut.status, 400, '锁定时保存密钥须 400');
      assert.match((await badPut.json()).error || '', /拒绝保存/, '错误文案须可操作');
      const noConfirm = await fetch(`http://127.0.0.1:${s2.port}/api/vault/reset`, {method: 'POST', headers: a2, body: '{}'});
      assert.equal(noConfirm.status, 400, '重置缺 confirm 须 400');
      const doReset = await fetch(`http://127.0.0.1:${s2.port}/api/vault/reset`, {method: 'POST', headers: a2, body: JSON.stringify({confirm: true})});
      assert.equal(doReset.status, 200, 'confirm:true 重置须成功');
      assert.equal((await j(doReset)).vault?.sealed, false, '重置后 sealed=false');
      if(process.platform!=='win32'){
        const after = await fetch(`http://127.0.0.1:${s2.port}/api/secrets`, {method: 'PUT', headers: a2, body: JSON.stringify({name: 'LOCKED_PROBE', value: 'abc'})});
        assert.equal(after.status, 200, '重置后保存须恢复可用');
      }
      const names = await (await import('node:fs/promises')).readdir(path.join(sealedDir, 'secrets'));
      assert.ok(names.some(n => n.includes('.unreadable-')), '重置后旧密文须改名保留');
      s2.child.kill('SIGKILL'); sealedChild = null;
    } finally { if (sealedChild) sealedChild.kill('SIGKILL'); await sleep(200); await rm(sealedDir, {recursive: true, force: true}).catch(() => {}); }

    // 7) 持久化
    const ws = JSON.parse(await readFile(path.join(dataDir, 'workspace.json'), 'utf8'));
    for (const k of ['settings', 'projects', 'jobs', 'assets']) assert.ok(k in ws, `workspace.json 须含 ${k}`);
    await writeFile(path.join(workDir, 'ok'), 'done');
  } finally {
    server.kill('SIGKILL');
    await sleep(300);
    await rm(workDir, {recursive: true, force: true}).catch(() => {});
  }
});
