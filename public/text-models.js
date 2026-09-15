const roles = ['outline', 'script', 'review'];
const labels = {outline:'故事大纲', script:'剧本与分镜', review:'一致性审校'};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = (name, action, id, disabled = false) => `<button class="small" data-action="${action}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${name}</button>`;
export function resolvedModelName(text, role) {return text.profiles.find(p => p.id === text.roles[role].profileId)?.model || '尚未配置模型';}

function profileCard(p, text) {
  const users = roles.filter(r => text.roles[r].profileId === p.id);
  const field = (key, label, type = 'text', attrs = '') => `<label for="${p.id}-${key}">${label}</label><input id="${p.id}-${key}" data-profile="${esc(p.id)}" data-field="${key}" type="${type}" value="${esc(p[key])}" ${attrs}>`;
  return `<article class="panel shared-model"><div class="panel-head"><div><h3>${esc(p.name)}</h3><p class="hint">${users.length ? '用于 ' + users.map(r => labels[r]).join('、') : '尚未被阶段使用'}</p></div><span class="tag">可复用配置</span></div>
    ${field('name','配置名称')}
    <div class="cols"><div>${field('baseUrl','服务地址 · 本地或云端')}</div><div>${field('model','模型名称 · 与服务端一致')}</div></div>
    ${field('keyEnv','密钥环境变量名 · 本地可留空')}
    <div class="cols"><div>${field('temperature','默认 Temperature','number','step="0.1" min="0" max="2"')}</div><div>${field('maxTokens','默认最大输出 tokens','number','min="128" max="32768" step="1"')}</div></div>
    <div class="actions model-actions">${btn('测试连接','probe',p.id)}${btn('三个阶段共用','share-profile',p.id)}${btn('复制配置','copy-profile',p.id)}${btn('删除','delete-profile',p.id,users.length > 0 || text.profiles.length === 1)}</div>
    ${users.length ? '<p class="hint">修改此配置会影响所有引用阶段的新任务。删除前请先切换这些阶段的配置。</p>' : ''}</article>`;
}

function roleCard(role, text) {
  const route = text.roles[role], p = text.profiles.find(p => p.id === route.profileId), c = {...p, ...(route.overrides || {})};
  return `<article class="panel"><h3>${labels[role]}</h3><label for="route-${role}">使用模型配置</label><select id="route-${role}" data-route="${role}">${text.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === route.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label class="override-toggle" for="override-${role}"><input id="override-${role}" type="checkbox" data-override="${role}" ${route.overrides ? 'checked' : ''}> 独立调整生成参数</label>
    ${route.overrides ? `<div class="cols"><div><label for="temperature-${role}">Temperature</label><input id="temperature-${role}" data-role="${role}" data-field="temperature" type="number" min="0" max="2" step="0.1" value="${c.temperature}"></div><div><label for="tokens-${role}">最大输出 tokens</label><input id="tokens-${role}" data-role="${role}" data-field="maxTokens" type="number" min="128" max="32768" step="1" value="${c.maxTokens}"></div></div>` : `<p class="hint">跟随共享配置：温度 ${c.temperature} · 输出 ${c.maxTokens} tokens</p>`}
    <p class="hint">${esc(p?.model || '模型名称尚未填写')}<br>${route.overrides ? '服务与模型共享；本阶段参数独立。' : '服务、模型和参数均跟随共享配置。'}</p></article>`;
}

export function textModelsView(text) {
  return `<section><div class="panel-head"><div><h2>共享文本模型</h2><p class="hint">配置一次，多阶段复用。可保存本地、云端等多套配置。</p></div>${btn('＋ 新增配置','add-profile','')}</div><div class="shared-model-grid">${text.profiles.map(p => profileCard(p,text)).join('')}</div>
    <div class="panel-head"><div><h2>阶段分配</h2><p class="hint">选择同一配置即可共用；每个阶段仍保留各自的写作职责。</p></div></div><div class="role-grid">${roles.map(r => roleCard(r,text)).join('')}</div></section>`;
}

export function readTextSettings(text) {
  const next = structuredClone(text);
  document.querySelectorAll('input[data-profile]').forEach(el => {
    next.profiles.find(p => p.id === el.dataset.profile)[el.dataset.field] = el.type === 'number' ? Number(el.value) : el.value.trim();
  });
  for (const role of roles) {
    const id = document.querySelector(`[data-route="${role}"]`).value;
    const p = next.profiles.find(p => p.id === id);
    const independent = document.querySelector(`[data-override="${role}"]`).checked;
    const get = key => {const el = document.querySelector(`input[data-role="${role}"][data-field="${key}"]`); return el ? Number(el.value) : p[key];};
    next.roles[role] = {profileId:id, overrides:independent ? {temperature:get('temperature'), maxTokens:get('maxTokens')} : null};
  }
  return next;
}

export function updateTextProfiles(text, action, id) {
  const next = structuredClone(text), p = next.profiles.find(p => p.id === id);
  if (action === 'add-profile' || action === 'copy-profile') {
    if (next.profiles.length >= 50) throw new Error('最多保存 50 个模型配置');
    if (action === 'copy-profile' && !p) throw new Error('模型配置不存在');
    next.profiles.push({... (p || {baseUrl:'http://127.0.0.1:1234/v1',model:'',keyEnv:'',temperature:0.7,maxTokens:6000}), id:crypto.randomUUID(), name:p ? `${p.name} 副本` : '新模型配置'});
  } else if (action === 'delete-profile') {
    if (roles.some(r => next.roles[r].profileId === id)) throw new Error('请先切换引用该配置的阶段');
    if (next.profiles.length === 1) throw new Error('至少保留一个模型配置');
    next.profiles = next.profiles.filter(p => p.id !== id);
  } else if (action === 'share-profile') {
    if (!p) throw new Error('模型配置不存在');
    for (const role of roles) next.roles[role].profileId = id;
  }
  return next;
}
