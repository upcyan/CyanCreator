import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// 画布工作流组 HTTP 集成：创建/校验/随项目持久化/镜头变更后失效清理
test('canvasGroups：经项目 PUT 持久化、校验非法输入、剧本重置后清空', {timeout: 60000}, async t => {
  await mkdir('test-output', {recursive: true});
  const folder = await mkdtemp(path.resolve('test-output/canvas-wf-'));
  const fixture = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({logline: '画布工作流', beats: [{title: '节拍', summary: '内容'}]})}}]})); });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); t.after(() => fixture.close());
  const child = spawn(process.execPath, ['server.js'], {cwd: process.cwd(), env: {...process.env, PORT: '0', CYANCREATOR_DATA: path.join(folder, 'data')}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => child.kill());
  let errors = ''; child.stderr.on('data', x => errors += x);
  const base = await new Promise((resolve, reject) => { child.stdout.on('data', d => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); }); child.once('exit', code => reject(Error('startup ' + code + errors))); child.once('error', reject); });
  let state = await (await fetch(base + '/api/state')).json();
  async function call(url, method = 'GET', body, status = 200) {
    const headers = {'Content-Type': 'application/json'}; headers['X-Workspace-' + 'Token'] = state.token; headers.origin = base;
    const r = await fetch(base + url, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const d = await r.json().catch(() => ({}));
    assert.equal(r.status, status, JSON.stringify(d));
    return d;
  }
  let p = await call('/api/projects', 'POST', {name: '画布组'}, 201);
  // 生成并应用大纲（让项目有 revision 变更链）
  // 直接手写剧本草稿，避免依赖文本模型
  const script = {scenes: [{title: '场景A', action: '动作', dialogue: '', shots: [{prompt: 's1', duration: 5}, {prompt: 's2', duration: 5}, {prompt: 's3', duration: 5}]}]};
  await call('/api/projects/' + p.id + '/draft', 'POST', {revision: p.revision, stage: 'script', value: script, brief: '简报', bible: '设定', characters: [], worldbook: [], sets: [], props: []});
  p = await (await fetch(base + '/api/state')).json().then(s => s.projects.find(x => x.id === p.id));
  assert.ok(p.script?.scenes?.length === 1, '剧本已保存');
  // 保存一个工作流组
  const group = {id: 'wg-test1', title: '第一场批量', shots: [{scene: 0, shot: 2}, {scene: 0, shot: 0}], createdAt: new Date().toISOString()};
  await call('/api/projects/' + p.id, 'PUT', {revision: p.revision, __canvasGroups: [group]});
  p = await (await fetch(base + '/api/state')).json().then(s => s.projects.find(x => x.id === p.id));
  assert.equal(p.canvasGroups.length, 1);
  assert.deepEqual(p.canvasGroups[0].shots.map(s => s.shot), [2, 0], '组内镜头顺序保持用户框选顺序');
  // 非法：重复镜头
  await call('/api/projects/' + p.id, 'PUT', {revision: p.revision, __canvasGroups: [{id: 'wg-bad', title: '重复', shots: [{scene: 0, shot: 0}, {scene: 0, shot: 0}]}]}, 400);
  // 非法：越界镜头
  await call('/api/projects/' + p.id, 'PUT', {revision: p.revision, __canvasGroups: [{id: 'wg-bad', title: '越界', shots: [{scene: 9, shot: 9}]}]}, 400);
  // 非法：空名称
  await call('/api/projects/' + p.id, 'PUT', {revision: p.revision, __canvasGroups: [{id: 'wg-bad', title: '', shots: [{scene: 0, shot: 0}]}]}, 400);
  // 重新确认剧本（applyDocument script 阶段会重置 scriptVersion 并清空组）
  await call('/api/projects/' + p.id, 'PUT', {revision: p.revision, stage: 'script', value: script});
  p = await (await fetch(base + '/api/state')).json().then(s => s.projects.find(x => x.id === p.id));
  assert.deepEqual(p.canvasGroups, [], '剧本重新确认后工作流组清空（镜头索引已不可信）');
  assert.equal(errors, '');
});
