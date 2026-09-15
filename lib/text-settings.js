const roles = ['outline', 'script', 'review'];
const labels = {outline: '故事大纲', script: '剧本与分镜', review: '一致性审校'};

export function defaultTextSettings() {
  return {
    profiles: [{id: 'local-default', name: '本地共享模型', baseUrl: 'http://127.0.0.1:1234/v1', model: '', keyEnv: '', temperature: 0.7, maxTokens: 6000}],
    roles: Object.fromEntries(roles.map(role => [role, {profileId: 'local-default', overrides: role === 'review' ? {temperature: 0.2, maxTokens: 6000} : null}]))
  };
}

// Deduplicate old connection records, preserving each stage's effective parameters.
export function migrateTextSettings(text) {
  if (text?.profiles || text?.roles) return text;
  if (!text) return defaultTextSettings();
  const migrated = {profiles: [], roles: {}};
  for (const role of roles) {
    const c = text[role];
    if (!c) throw new Error('旧版文本模型配置不完整');
    let profile = migrated.profiles.find(p => p.baseUrl === c.baseUrl && p.model === c.model && p.keyEnv === c.keyEnv);
    if (!profile) {
      profile = {id: `migrated-${migrated.profiles.length + 1}`, name: `${labels[role]}模型`, baseUrl: c.baseUrl, model: c.model, keyEnv: c.keyEnv, temperature: c.temperature, maxTokens: c.maxTokens};
      migrated.profiles.push(profile);
    }
    migrated.roles[role] = {profileId: profile.id, overrides: profile.temperature === c.temperature && profile.maxTokens === c.maxTokens ? null : {temperature: c.temperature, maxTokens: c.maxTokens}};
  }
  if (migrated.profiles.length === 1) migrated.profiles[0].name = '共享文本模型';
  return migrated;
}

export function resolveTextConfig(text, role) {
  const route = text?.roles?.[role];
  const profile = text?.profiles?.find(p => p.id === route?.profileId);
  if (!profile) throw new Error('阶段引用的模型配置不存在');
  return {...profile, ...(route.overrides || {}), profileId: profile.id};
}

export function validateTextSettings(text, requireValue, number, validateEndpoint, validateEnv) {
  requireValue(Array.isArray(text?.profiles) && text.profiles.length > 0 && text.profiles.length <= 50 && text.roles, '需要 1–50 个共享模型配置和完整阶段引用');
  const ids = new Set();
  const string = (v, label, allowEmpty = false) => requireValue(typeof v === 'string' && v.length <= 2000 && (allowEmpty || v.trim()), `${label}格式错误`);
  for (const p of text.profiles) {
    string(p.id, '配置 ID'); requireValue(/^[\w-]{1,80}$/.test(p.id) && !ids.has(p.id), '配置 ID 无效或重复'); ids.add(p.id);
    string(p.name, '配置名称'); string(p.model, '模型名称', true); string(p.baseUrl, '服务地址');
    validateEndpoint(p.baseUrl); validateEnv(p.keyEnv);
    number(p.temperature, 0, 2, 'temperature'); number(p.maxTokens, 128, 32768, 'maxTokens');
    requireValue(Number.isInteger(p.maxTokens), 'maxTokens 必须是整数');
  }
  for (const role of roles) {
    const route = text.roles[role]; requireValue(route && ids.has(route.profileId), `${labels[role]}引用的模型配置不存在`);
    if (route.overrides != null) {
      requireValue(typeof route.overrides === 'object' && !Array.isArray(route.overrides) && Object.keys(route.overrides).every(k => ['temperature', 'maxTokens'].includes(k)), '阶段只允许覆盖温度与输出长度');
      number(route.overrides.temperature, 0, 2, 'temperature'); number(route.overrides.maxTokens, 128, 32768, 'maxTokens');
      requireValue(Number.isInteger(route.overrides.maxTokens), 'maxTokens 必须是整数');
    }
  }
  // Persist only the supported fields; never retain a supplied literal API key.
  return {
    profiles: text.profiles.map(({id, name, baseUrl, model, keyEnv, temperature, maxTokens}) => ({id, name, baseUrl, model, keyEnv, temperature, maxTokens})),
    roles: Object.fromEntries(roles.map(role => [role, {profileId: text.roles[role].profileId, overrides: text.roles[role].overrides ? {...text.roles[role].overrides} : null}]))
  };
}
