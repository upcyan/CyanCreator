import test from 'node:test';
import assert from 'node:assert/strict';
import {coachMessages, coachContext, parseCoachReply, validateCoach, COACH_TARGETS, COACH_TOURS} from '../lib/coach.js';

const state = () => ({
  onboarded: true,
  settings: {
    text: {profiles: [{id: 'p1', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen'}], roles: {}},
    video: {provider: 'comfy', baseUrl: 'http://127.0.0.1:8188'}
  },
  projects: [], jobs: [], assets: []
});

test('引导模式返回建议与白名单动作，expert 模式剔除动作', () => {
  const ok = validateCoach({reply: '好的，我带你打开设置。', suggestions: ['下一步呢？'], actions: [
    {type: 'navigate', page: 'models'},
    {type: 'settings-tab', id: 'text'},
    {type: 'highlight', target: 'text-profile-base', tip: '填服务地址'},
    {type: 'tour', id: 'workbench'},
    {type: 'fill', target: 'text-base-url', value: 'http://127.0.0.1:1234/v1'},
    {type: 'create-project', name: '  我的故事 '}
  ]}, 'guide');
  assert.equal(ok.actions.length, 2, '动作应截断为最多 2 项');
  assert.deepEqual(ok.suggestions, ['下一步呢？']);
  assert.ok(validateCoach({reply: '直接回答。', actions: [{type: 'navigate', page: 'outline'}]}, 'expert').actions.length === 0, 'expert 模式不应保留动作');
  assert.deepEqual(ok.actions[1], {type: 'settings-tab', id: 'text'});
});

test('非法动作、未知目标与超长内容被拒绝', () => {
  assert.throws(() => validateCoach({reply: ''}, 'guide'), /回复格式无效/);
  assert.throws(() => validateCoach({reply: 'x'.repeat(8001)}, 'guide'), /回复格式无效/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'self-destruct'}]}, 'guide'), /未知的助手动作/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'navigate', page: 'admin'}]}, 'guide'), /导航目标无效/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'highlight', target: '#delete-project-confirm'}]}, 'guide'), /高亮目标无效/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'tour', id: 'hack'}]}, 'guide'), /引导路线无效/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'fill', target: 'text-model', value: 'x'.repeat(2001)}]}, 'guide'), /代填内容过长/);
  assert.throws(() => validateCoach({reply: '好', suggestions: ['a', 'b', 'c', 'd', 'e']}, 'guide'), /引导建议格式无效/);
  assert.throws(() => validateCoach({reply: '好', actions: 'navigate'}, 'guide'), /动作格式无效/);
  assert.throws(() => validateCoach({reply: '好', actions: [{type: 'open-project', name: '  '}]}, 'guide'), /项目名称/);
  assert.deepEqual(validateCoach({reply: '好', actions: [{type: 'open-project', name: ' 我的故事 '}]}, 'guide').actions, [{type: 'open-project', name: '我的故事'}]);
  // 目录本身必须非空且代码稳定，供提示词引用
  assert.ok(Object.keys(COACH_TARGETS).length > 20 && Object.keys(COACH_TOURS).length >= 5);
});

test('coachMessages 注入目录、上下文，历史按对话顺序排列', () => {
  const context = coachContext(state(), null, 'models', 'guide');
  assert.equal(context.textConfigured, true);
  assert.equal(context.project, null);
  const history = [{message: '第二问', reply: '第二答'}, {message: '第一问', reply: '第一答'}];
  const messages = coachMessages(context, {mode: 'guide', message: '带我配置模型'}, history);
  assert.equal(messages.at(-1).content, '带我配置模型');
  // history 按最新在前存放（与服务端一致），进入提示词前应反转为对话顺序
  assert.equal(messages.at(-2).content, '第二答');
  assert.equal(messages.at(-3).content, '第二问');
  assert.ok(messages[0].content.includes('引导模式') && messages[0].content.includes('text-profile-base'));
  assert.ok(messages[1].content.includes('"page":"models"'));
  const expert = coachMessages(context, {mode: 'expert', message: '问'}, []);
  assert.ok(expert[0].content.includes('老手模式'), 'expert 提示词应声明模式');
});

test('coachTurn 的回复解析：剥离围栏并校验，非字符串输入被拒绝', () => {
  const fenced = '```json\n{"reply":"ok","suggestions":["继续"],"actions":[{"type":"tour","id":"workbench"}]}\n```';
  const parsed = parseCoachReply(fenced, 'guide');
  assert.equal(parsed.reply, 'ok');
  assert.deepEqual(parsed.actions, [{type: 'tour', id: 'workbench'}]);
  assert.throws(() => parseCoachReply(null, 'guide'), /没有返回引导内容/);
  assert.throws(() => parseCoachReply('{"reply":123}', 'guide'), /回复格式无效/);
});
