import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {TRANSITIONS, TRANSITION_LABELS, DEFAULT_TRANSITION, isTransition, normalizeTransition, publicTransitions} from '../lib/transitions.js';

test('转场清单：数量、唯一性与默认值', () => {
  assert.ok(TRANSITIONS.length >= 20, '至少 20 种转场');
  assert.equal(new Set(TRANSITIONS).size, TRANSITIONS.length, '转场名不得重复');
  assert.equal(DEFAULT_TRANSITION, 'fade');
  assert.ok(TRANSITIONS.includes('fade'));
  for (const name of TRANSITIONS) {
    assert.match(name, /^[a-z]+$/, `转场名应为小写字母：${name}`);
    assert.ok(TRANSITION_LABELS[name], `缺少中文标签：${name}`);
  }
});

test('isTransition / normalizeTransition 边界', () => {
  assert.equal(isTransition('fade'), true);
  assert.equal(isTransition('wipeleft'), true);
  assert.equal(isTransition('wipe'), false, '简写 wipe 不是合法名');
  assert.equal(isTransition(''), false);
  assert.equal(isTransition(null), false);
  assert.equal(isTransition(123), false);
  assert.equal(normalizeTransition(undefined), '');
  assert.equal(normalizeTransition(null), '');
  assert.equal(normalizeTransition(''), '');
  assert.equal(normalizeTransition('radial'), 'radial');
  const err = (() => {try {normalizeTransition('nope');} catch (e) {return e;}})();
  assert.ok(err instanceof Error);
  assert.equal(err.status, 400);
});

test('publicTransitions 结构可直接给前端下拉', () => {
  const list = publicTransitions();
  assert.equal(list.length, TRANSITIONS.length);
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['label', 'name']);
    assert.ok(item.label && item.name);
  }
});

test('转场名与当前 FFmpeg xfade 支持集一致', t => {
  let out;
  try {
    out = execFileSync('ffmpeg', ['-hide_banner', '-h', 'filter=xfade'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  } catch {
    try {
      out = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-h', 'filter=xfade'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    } catch {t.skip('当前环境没有可用的 ffmpeg，跳过一致性检查'); return;}
  }
  const names = new Set(out.split('\n').map(l => l.trim().split(/ +/)[0]).filter(n => /^[a-z]+$/.test(n) && !['custom', 'transition', 'xfade', 'slice', 'duration', 'offset', 'expr'].includes(n)));
  const missing = TRANSITIONS.filter(n => !names.has(n));
  assert.deepEqual(missing, [], `这些转场本机 ffmpeg 不支持：${missing.join(', ')}`);
});
