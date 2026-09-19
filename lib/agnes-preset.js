// Agnes 一键预设：一个 AGNES_API_KEY 同时覆盖文本、图像与视频三类服务。
// 文本：兼容 OpenAI /chat/completions，模型 agnes-2.0-flash
// 图像：兼容 OpenAI /images/generations，模型 agnes-image-2.1-flash
// 视频：Agnes 异步任务协议，模型 agnes-video-v2.0
export const AGNES_BASE_URL = 'https://api.agnes.ai/v1';
export const AGNES_KEY_ENV = 'AGNES_API_KEY';
export const AGNES_TEXT_MODEL = 'agnes-2.0-flash';
export const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';
export const AGNES_VIDEO_MODEL = 'agnes-video-v2.0';
export const AGNES_SOURCE = 'https://agnes.ai/docs';

// 视频预设（与 cloudPreset('agnes') 等价，供一键配置直接合并使用）
export function agnesVideoPreset() {
  return {
    provider: 'agnes',
    baseUrl: AGNES_BASE_URL,
    model: AGNES_VIDEO_MODEL,
    keyEnv: AGNES_KEY_ENV,
    source: AGNES_SOURCE + '/video',
    profile: 'Agnes · 文生图生视频',
    params: {ratio: '16:9', resolution: '720p'},
    workflow: {},
    bindings: {},
    outputNode: '',
    durationMode: 'workflow'
  };
}

// 图像预设
export function agnesImagePreset() {
  return {
    provider: 'agnes',
    baseUrl: AGNES_BASE_URL,
    model: AGNES_IMAGE_MODEL,
    keyEnv: AGNES_KEY_ENV,
    size: '1024x1536'
  };
}

// 文本 profile（供合并进 settings.text.profiles）
export function agnesTextProfile(id = 'agnes-default') {
  return {
    id,
    name: 'Agnes · 文本模型',
    baseUrl: AGNES_BASE_URL,
    model: AGNES_TEXT_MODEL,
    keyEnv: AGNES_KEY_ENV,
    temperature: 0.7,
    maxTokens: 6000
  };
}

// 一键预设：合并到当前 settings 后，三类服务统一引用 AGNES_API_KEY
// 不直接修改 settings，返回新对象供调用方使用并 dirty 标记
export function applyAgnesPreset(settings) {
  const next = structuredClone(settings);
  // 文本：复用现有 agnes profile（按 baseUrl+model+keyEnv 去重），不存在则新增
  next.text ||= {profiles: [], roles: {}};
  const profileId = 'agnes-default';
  if (!next.text.profiles) next.text.profiles = [];
  let profile = next.text.profiles.find(p => p.id === profileId);
  if (!profile) {
    profile = agnesTextProfile(profileId);
    next.text.profiles.push(profile);
  } else {
    Object.assign(profile, agnesTextProfile(profileId));
  }
  // 三个写作阶段都指向 Agnes profile，保留各自的 overrides（如有）
  for (const role of ['outline', 'script', 'review']) {
    next.text.roles[role] ||= {profileId, overrides: null};
    next.text.roles[role].profileId = profileId;
  }
  // 图像：切换为 Agnes 兼容接口
  next.image = agnesImagePreset();
  // 视频：切换为 Agnes 云视频模板
  next.video = agnesVideoPreset();
  return next;
}
