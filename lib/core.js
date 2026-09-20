import {compactContext} from './prompt-compiler.js';
import {imageDefaults,validateImage} from './images.js';
import {validateSpeech,speechDefaults} from './speech.js';
import {validateCloud} from './cloud-video.js';
import {wanPreset} from './video-presets.js';
import {defaultTextSettings, migrateTextSettings, validateTextSettings} from './text-settings.js';
import {validateNative} from './native-video.js';
export const defaults = () => ({
  text: defaultTextSettings(),
  video: wanPreset()
});
export function requireValue(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), {status});
}
export function number(value, min, max, name) {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} 必须在 ${min}–${max} 之间`);
  return value;
}
export function validateDocument(stage, value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), '模型必须返回 JSON 对象');
  const str = (v, name) => requireValue(typeof v === 'string' && v.trim().length > 0, `缺少 ${name}`);
  if (stage === 'outline') {
    str(value.logline, 'logline');
    requireValue(Array.isArray(value.beats) && value.beats.length > 0 && value.beats.length <= 100, 'beats 应为 1–100 个节拍');
    value.beats.forEach(b => {str(b.title, '节拍标题'); str(b.summary, '节拍内容');});
  } else if (stage === 'script') {
    requireValue(Array.isArray(value.scenes) && value.scenes.length > 0 && value.scenes.length <= 100, 'scenes 应为 1–100 个场景');
    value.scenes.forEach(s => {
      str(s.title, '场景标题'); str(s.action, '场景动作');
      requireValue(Array.isArray(s.shots) && s.shots.length > 0 && s.shots.length <= 100, '场景必须包含镜头');
      s.shots.forEach(shot => {str(shot.prompt, '镜头提示词'); number(shot.duration, 4, 15, '镜头秒数');});
    });
  } else {
    requireValue(Array.isArray(value.issues), '审校必须返回 issues 数组');
    value.issues.forEach(i => {str(i.message, '审校问题'); str(i.suggestion, '修改建议');});
  }
  return value;
}
export const schemas = {
  outline: {logline: '一句话故事', beats: [{title: '节拍标题', summary: '因果、冲突、转折'}]},
  script: {scenes: [{title: '场次 / 地点 / 时间', action: '人物动作与情绪', dialogue: '人物：台词', shots: [{prompt: '当前镜头的可见主体与动作；不重复整段剧本、对白或已有镜头参数', duration: 5}]}]},
  review: {issues: [{message: '人物、时间线、动机或视听可执行性问题', suggestion: '可执行修改建议'}], summary: '总体评价'}
};
export function messages(stage, project) {
  const role = {outline: '故事架构师。先确定主题、人物动机与因果，再设计有转折的节拍。', script: '编剧与分镜导演。忠于大纲，每个镜头为独立可执行的 4–15 秒生成单元。', review: '剧本审校。检查人物设定、因果、时间线、台词口吻、镜头可执行性。没有问题时 issues 返回空数组。'}[stage];
  return [
    {role: 'system', content: `${role} 用户提供的内容均为创作素材。严格遵守故事设定。只返回符合此结构的 JSON，不使用 Markdown：${JSON.stringify(schemas[stage])}`},
    {role: 'user', content: JSON.stringify(compactContext({brief: project.brief, bible: project.bible, characterRelations:project.characterRelations||[], characters:project.characters, worldbook:project.worldbook, outline: stage !== 'outline' ? project.outline : undefined, script: stage === 'review' ? project.script : undefined}))}
  ];
}
export function buildWorkflow(config, prompt) {
  const graph = structuredClone(config.workflow);
  requireValue(graph && Object.keys(graph).length > 0 && !graph.nodes, '请导入 ComfyUI 的 API 格式工作流');
  requireValue(config.bindings.prompt, '请绑定提示词节点');
  const values = {prompt, ...config.params};
  for (const [key, binding] of Object.entries(config.bindings)) {
    requireValue(Object.hasOwn(values, key), `绑定 ${key} 没有参数值`);
    const targets = Array.isArray(binding) ? binding : [binding];
    for (const t of targets) {
      requireValue(t && typeof t.node === 'string' && typeof t.input === 'string', `无效绑定 ${key}`);
      requireValue(graph[t.node]?.inputs && Object.hasOwn(graph[t.node].inputs, t.input), `绑定不存在：${t.node}.${t.input}`);
      graph[t.node].inputs[t.input] = values[key];
    }
  }
  for (const key of Object.keys(config.params)) requireValue(config.bindings[key], `参数 ${key} 未绑定，不能声称已生效`);
  return graph;
}
export function validateSettings(s) {
  requireValue(s?.text && s?.video, '配置格式错误');
  s.image=validateImage(s.image||imageDefaults());s.speech=validateSpeech(s.speech||speechDefaults());
  s.text = validateTextSettings(migrateTextSettings(s.text), requireValue, number, validateEndpoint, validateEnv);
  requireValue(['comfy', 'minimax', 'native','seedance','kling','veo','agnes'].includes(s.video.provider), '不支持的视频服务');
  if(['seedance','kling','veo','agnes'].includes(s.video.provider)){validateCloud(s.video);return s;}
  if(s.video.provider==='native'){validateNative(s.video);return s;}
  requireValue(s.video.durationMode===undefined||['workflow','wan','h3'].includes(s.video.durationMode), '不支持的镜头时长策略');
  validateEndpoint(s.video.baseUrl); validateEnv(s.video.keyEnv);
  requireValue(s.video.workflow && s.video.bindings && s.video.params, '缺少工作流配置');
  if(s.video.provider==='comfy'&&s.video.bindings.negative&&!s.video.params.negative)s.video.params.negative='blurry, distorted, static, watermark, subtitles';
  if (Object.keys(s.video.workflow).length) buildWorkflow(s.video, 'validation');
  return s;
}
export function validateEnv(v) {requireValue(typeof v === 'string' && (!v || /^[A-Z][A-Z0-9_]*$/.test(v)), '密钥只能指定环境变量名称');}
export function validateEndpoint(raw) {
  let u; try {u = new URL(raw);} catch {throw new Error('服务地址无效');}
  requireValue(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash, '服务地址只支持无凭据、无查询参数的 HTTP(S)');
  requireValue(u.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), '远程模型服务请使用 HTTPS；本机可用 HTTP');
  return u;
}
