import {strict as assert} from 'node:assert';

// 画布工作流组（借鉴 LocalMiniDrama workflow_groups）：组构建校验、顺序执行语义、就地面板结构
const wf = await import('../public/canvas-workflow.js');

const p = {
  id: 'proj1',
  scriptVersion: 'v1',
  script: {scenes: [
    {title: 'A', shots: [{prompt: 'a1', duration: 5}, {prompt: 'a2', duration: 5}]},
    {title: 'B', shots: [{prompt: 'b1', duration: 5}]},
  ]},
  canvasGroups: [],
};

// shotsFromPicked：只取本项目键、按场景/镜头序排序
const picked = new Set(['proj1:v1:1-0', 'proj1:v1:0-1', 'proj1:v1:0-0', 'other:vx:0-0']);
const shots = wf.shotsFromPicked(p, picked);
assert.deepEqual(shots, [{scene: 0, shot: 0}, {scene: 0, shot: 1}, {scene: 1, shot: 0}], '跨项目键被过滤且按场景镜头排序');

// buildGroup：命名与容量校验
assert.throws(() => wf.buildGroup('', shots), /请给工作流起个名字/);
assert.throws(() => wf.buildGroup('x'.repeat(61), shots), /1–60 字/);
assert.throws(() => wf.buildGroup('g', []), /先在画布勾选/);
const g = wf.buildGroup('第一场批量', shots, []);
assert.equal(g.title, '第一场批量');
assert.equal(g.shots.length, 3);
assert.ok(/^wg-[0-9a-z-]+$/.test(g.id), '组 ID 形如 wg-xxx');
assert.throws(() => wf.buildGroup('g', shots, Array.from({length: 50}, (_, i) => ({id: 'x' + i, shots: [{scene: 0, shot: 0}]}))), /最多 50 组/);

// runGroup：顺序投递、失败即停、返回 ok/failed 汇总
const calls = [];
const apiOk = async (url, method, body) => { calls.push(body.shots[0]); return {ids: ['j' + calls.length]}; };
const s1 = await wf.runGroup(apiOk, p, g);
assert.deepEqual(s1.ok, ['1.1', '1.2', '2.1'], '全部按序投递');
assert.equal(s1.failed.length, 0);
assert.deepEqual(calls[0], {scene: 0, shot: 0}, '第一镜先投');

calls.length = 0;
let n = 0;
const apiFail2nd = async (url, method, body) => {
  calls.push(body.shots[0]);
  n++;
  if (n === 2) throw new Error('队列已满');
  return {ids: ['j' + n]};
};
const s2 = await wf.runGroup(apiFail2nd, p, g);
assert.deepEqual(s2.ok, ['1.1'], '第一镜成功');
assert.equal(s2.failed.length, 1, '第二镜失败');
assert.equal(s2.failed[0].shot, '1.2');
assert.match(s2.failed[0].error, /队列已满/);
assert.equal(calls.length, 2, '失败后停止投递（第三镜未投）');

// groupsBarHtml：下拉与按钮结构
p.canvasGroups = [g];
wf.setActiveGroup(g.id);
const bar = wf.groupsBarHtml(p);
assert.ok(bar.includes('canvas-wf-select'), '有选择下拉');
assert.ok(bar.includes('整组重跑'), '有整组重跑按钮');
assert.ok(bar.includes('删除该组'), '有删除按钮');
wf.setActiveGroup('');
const bar2 = wf.groupsBarHtml(p);
assert.ok(!bar2.includes('整组重跑'), '未选组时不显示重跑');

// 就地面板：shot-canvas 导出与面板结构
const sc = await import('../public/shot-canvas.js');
assert.equal(typeof sc.canvasActive, 'function');
assert.equal(sc.canvasActive(), false);
sc.toggleCanvas();
assert.equal(sc.canvasActive(), true, '画布开启');
sc.openCanvasPanel('0-0');
assert.ok(true, 'openCanvasPanel 可调用');

console.log('canvas-workflow tests: all assertions passed');
