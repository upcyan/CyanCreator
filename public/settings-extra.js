const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function secretUsage(state){
  const usage={};
  const add=(n,label)=>{if(n){(usage[n]??=[]).push(label);}};
  for(const p of (state.settings?.text?.profiles||[]))if(p.keyEnv)add(p.keyEnv,p.name||'文本连接');
  const v=state.settings?.video;if(v?.keyEnv)add(v.keyEnv,'视频');if(v?.secretEnv)add(v.secretEnv,'视频密钥');
  if(state.settings?.image?.keyEnv)add(state.settings.image.keyEnv,'图像');
  const sp=state.settings?.speech;
  if(sp&&sp.keyEnv&&sp.provider!=='piper')add(sp.keyEnv,'语音配音');
  return usage;
}
export const KEY_PROVIDERS={'ARK_API_KEY':'火山方舟','GEMINI_API_KEY':'Google Gemini','ZHIPU_API_KEY':'智谱 BigModel','MIMO_KEY':'小米 MiMo','AGNES_API_KEY':'Agnes','SILICONFLOW_API_KEY':'SiliconFlow','MINIMAX_API_KEY':'MiniMax','ELEVENLABS_API_KEY':'ElevenLabs','OPENAI_API_KEY':'OpenAI','TTS_API_KEY':'通用 TTS（未指定厂商）'};
function keyProvider(name){
  if(KEY_PROVIDERS[name])return KEY_PROVIDERS[name];
  const hit=Object.keys(KEY_PROVIDERS).find(k=>name.startsWith(k.replace('_API_KEY','')+'_'));
  return hit?KEY_PROVIDERS[hit]:'自定义引用';
}
export function secretRowsHtml(state,usage,search,sort,editName=null){
  const all=[...(state.secrets||[])].sort((a,b)=>{
    if(sort==='time-desc'||sort==='time-asc'){const av=a.createdAt?Date.parse(a.createdAt):0,bv=b.createdAt?Date.parse(b.createdAt):0;return sort==='time-desc'?bv-av:av-bv;}
    return sort==='desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name);});
  const shown=all.filter(x=>x.name.toLowerCase().includes(search.toLowerCase()));
  const ts=x=>x.createdAt?new Date(x.createdAt).toLocaleString():'—';
  return {rows:shown.map(x=>{const refs=usage[x.name]||[];const vendor=keyProvider(x.name);const editing=editName===x.name;
    return `<div class="secret-row"><span class="secret-name">${esc(x.name)}</span><span class="model-tag plain">${esc(vendor)}</span><span class="secret-time" title="添加时间">${ts(x)}</span>${refs.length?`<span class="model-tag local" title="被引用：${esc(refs.join('、'))}">引用中 · ${refs.length}</span>`:'<span class="model-tag plain">未引用</span>'}${editing?`<input type="password" data-edit-key="${x.name}" data-transient autocomplete="new-password" placeholder="输入新 KEY"><button class="small primary" data-action="secret-edit-save" data-name="${x.name}">保存</button><button class="small ghost" data-action="secret-edit-cancel" data-name="${x.name}">取消</button>`:`<button class="small ghost" data-action="secret-edit" data-name="${x.name}">修改 KEY</button>`}<button class="small ghost" data-action="secret-delete" data-name="${esc(x.name)}">移除</button></div>`;}).join('')||'<p class="hint">没有匹配的密钥</p>',shown:shown.length,total:all.length};
}
export function settingsExtras(state,search='',sort='time-desc',editName=null){
  const have=new Set((state.secrets||[]).map(x=>x.name));
  const need=new Set();
  for(const p of (state.settings?.text?.profiles||[]))if(p.keyEnv)need.add(p.keyEnv);
  if(state.settings?.video?.keyEnv)need.add(state.settings.video.keyEnv);
  if(state.settings?.video?.secretEnv)need.add(state.settings.video.secretEnv);
  if(state.settings?.image?.keyEnv)need.add(state.settings.image.keyEnv);
  if(state.settings?.speech?.keyEnv)need.add(state.settings.speech.keyEnv);
  const missing=[...need].filter(n=>!have.has(n));
  const sealed=!!state.vault?.sealed;
  const sealedWarn=sealed?`<div class="warning"><b>密钥保险库已锁定：</b>${esc(state.vault.error||'密文无法在本机解密')}。此前保存的密钥在本机不可读；同名环境变量不受影响。<br>出路一：回到原来的 Windows 账户 / 机器，把各 Key 复制出来；再在本机重置保险库并重新录入（推荐）。<br>出路二：若无法取回旧 Key，可直接重置保险库——旧密文会改名保留在 data/secrets/ 目录，密钥需重新获取并录入。<div class="actions" style="margin-top:10px"><button class="small" data-action="vault-reset-open">重置保险库…</button></div></div>`:'';
  const entryControls=sealed?'':`<div class="warning" id="secret-missing" ${missing.length?'':'hidden'}>⚠ 有 ${missing.length} 个引用密钥尚未录入，在各待补全行粘贴 KEY 后，点下方「加密保存密钥」一次保存：</div><div id="secret-pending">${secretPendingHtml(missing)}</div><div class="cols"><label>引用名称<input id="secret-name" data-transient placeholder="其他新密钥的引用名，如 ARK_API_KEY" autocomplete="off"></label><label>API Key / Secret Key<input id="secret-value" data-transient type="password" autocomplete="new-password" placeholder="仅输入需要保存的新密钥"></label></div><button data-action="secret-save">加密保存密钥</button>`;
  return `<section class="panel"><h2>密钥保险库</h2><p class="hint" id="vault-backend-hint">密钥加密后保存在本机（Windows 使用 DPAPI 当前账户加密；Linux / macOS 优先使用系统钥匙串保管主密钥，服务器可用环境变量 CYANCREATOR_VAULT_KEY 作为主密钥，≥32 字符）。保存后不回显，不写入浏览器存储或项目文件。密钥引用名可供多个模型共用；与已有密钥同名时，保存会更新其内容。</p>${sealedWarn}${entryControls}<div class="secret-toolbar"><h3 class="secret-title">已保存密钥</h3><input id="secret-search" data-transient placeholder="搜索密钥名称…" value="${search}"><select id="secret-sort" data-transient><option value="time-desc" ${sort==='time-desc'?'selected':''}>添加时间 从新到旧</option><option value="time-asc" ${sort==='time-asc'?'selected':''}>添加时间 从早到晚</option><option value="asc" ${sort==='asc'?'selected':''}>名称 A→Z</option><option value="desc" ${sort==='desc'?'selected':''}>名称 Z→A</option></select><span class="hint" id="secret-count"></span></div><div id="secret-rows"></div><p class="hint">同一系统账户下运行的恶意软件仍可能访问解密能力；不要共享系统账户或保险库备份。环境变量仍可使用。</p></section>`;}
// Agnes 是跨文本 / 图像 / 视频的多模态服务，属于"服务商级"配置：固定展示在设置中心顶部，不归属任何单一环节分类。
export function agnesBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · AGNES</div><h2>Agnes · 多模态一键配置 <span class="model-tag free">免费</span></h2><p>使用同一把 AGNES_API_KEY 同时配置文本（agnes-2.0-flash）、角色图像（agnes-image-2.1-flash）与视频（agnes-video-v2.0），三个环节立即打通。</p><p class="hint">点击后合并到当前配置，需保存才生效；密钥在「密钥管理」录入一次即可复用。只想配置单一环节时，使用下方各分类。</p></div><div class="mm-apply"><button class="primary" data-action="agnes-apply">一键配置</button><span class="mm-name">Agnes</span></div></div></section>`;}
export function cloudTemplatesView(state){return `<section class="panel"><h2>云端视频模板</h2><p class="hint">仅覆盖视频环节的单模态模板；跨文本 / 图像 / 视频的多模态服务见页面顶部。</p><div class="shared-model-grid">${state.cloudTemplates.map(c=>`<article class="writer-card"><h3>${esc(c.name)}</h3><p>${esc(c.model)}</p><p class="hint">模型可用性以你的账户为准。文生视频模板；切换后保存配置。</p><button data-action="cloud-preset" data-id="${c.id}">载入模板</button> <a href="${c.source}" target="_blank" rel="noreferrer">官方文档</a></article>`).join('')}</div></section>`;}
export function cloudSettings(c){return `<section class="panel"><h2>${esc(c.profile||c.provider)} · 云视频</h2><p class="hint">提交时将当前镜头提示词及引用的角色设定发送到此服务。密钥仅由本机服务读取。</p><label>服务地址<input id="cloud-url" value="${esc(c.baseUrl)}"></label><label>模型 ID<input id="cloud-model" value="${esc(c.model)}"></label><label>API Key 引用名<input id="cloud-key" value="${esc(c.keyEnv)}"></label>${c.provider==='kling'?`<label>Secret Key 引用名<input id="cloud-secret" value="${esc(c.secretEnv)}"></label>`:''}<div class="cols"><label>画幅<select id="cloud-ratio">${['16:9','9:16',...(c.provider==='veo'?[]:['1:1'])].map(v=>`<option ${v===c.params.ratio?'selected':''}>${v}</option>`).join('')}</select></label>${c.provider==='kling'?`<label>模式<select id="cloud-quality"><option ${c.params.mode==='std'?'selected':''}>std</option><option ${c.params.mode==='pro'?'selected':''}>pro</option></select></label>`:`<label>分辨率<select id="cloud-quality">${['480p','720p','1080p'].filter(v=>c.provider!=='veo'||v!=='480p').map(v=>`<option ${v===c.params.resolution?'selected':''}>${v}</option>`).join('')}</select></label>`}</div><p class="hint">${c.provider==='kling'?'可灵模板：5 或 10 秒':c.provider==='veo'?'Veo：4、6、8 秒；高分辨率等组合受模型限制':c.provider==='agnes'?'Agnes 模板：4、6、8、10 秒':'Seedance 模板：4–30 秒（2.5 支持 4K 与 30 秒直出）'}。错误会显示在任务记录；不会自动重新提交付费任务。</p><button data-action="save-settings" class="primary">保存全部配置</button></section>`;}
export function readCloud(c){const val=id=>document.querySelector(id).value.trim();return {...c,baseUrl:val('#cloud-url'),model:val('#cloud-model'),keyEnv:val('#cloud-key'),...(c.provider==='kling'?{secretEnv:val('#cloud-secret')}:{ }),params:{...c.params,ratio:val('#cloud-ratio'),[c.provider==='kling'?'mode':'resolution']:val('#cloud-quality')}};}

export function geminiBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · GOOGLE GEMINI</div><h2>Gemini · 文本 + 视频一键配置</h2><p>使用同一把 GEMINI_API_KEY 同时配置文本（gemini-2.5-flash，覆盖大纲 / 剧本 / 审校三阶段）与视频（Veo 3.1）。</p><p class="hint">点击后合并到当前配置，需保存才生效；密钥在「密钥管理」录入一次即可复用。</p></div><div class="mm-apply"><button class="primary" data-action="gemini-apply">一键配置</button><span class="mm-name">Gemini</span></div></div></section>`;}

export function mimoBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · XIAOMI MIMO</div><h2>MiMo · 文本三阶段 + 语音配音一键配置</h2><p>将大纲 / 剧本 / 审校三阶段一键指向 MiMo（mimo-v2.5），使用 MIMO_KEY 密钥。视觉理解等多模态能力经由文本接口使用。</p><p class="hint">自动识别已存在的 MiMo 连接；点击后合并到当前配置，需保存才生效。</p><div class="actions"><button class="small" data-action="mimo-tts-apply">语音配音切到 MiMo TTS（限时免费）</button></div></div><div class="mm-apply"><button class="primary" data-action="mimo-apply">一键配置</button><span class="mm-name">MiMo</span></div></div></section>`;}

export function secretPendingHtml(missing){
  return missing.map(name=>`<div class="cols" style="align-items:end"><label>引用名称<span class="model-tag plain">${esc(keyProvider(name))}</span><input value="${name}" readonly data-transient></label><label>KEY<input type="password" data-pending-key="${name}" data-transient autocomplete="new-password" placeholder="粘贴 KEY"></label></div>`).join('');
}
export function secretListHtml(secrets){
  return (secrets||[]).map(x=>`<p>${esc(x.name)} · 已配置 <button class="small ghost" data-action="secret-delete" data-name="${esc(x.name)}">移除</button></p>`).join('');
}

export function arkBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · BYTEDANCE ARK · 推荐</div><h2>火山方舟 ARK · 文本 + 图像 + 视频一键配置</h2><p>使用同一把 ARK_API_KEY 打通三个环节：文本（doubao-seed-1-6-flash，覆盖大纲 / 剧本 / 审校）、图像（doubao-seedream-4-0，角色立绘）、视频（Seedance，镜头生成）。</p><p class="hint">点击后合并到当前配置，需保存才生效；密钥在「密钥管理」录入一次即可复用。视频参数（画幅 / 分辨率 / 时长）沿用 Seedance 模板规则。</p></div><div class="mm-apply"><button class="primary" data-action="ark-apply">一键配置</button><span class="mm-name">火山方舟 ARK</span></div></div></section>`;}

export function zhipuBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · ZHIPU BIGMODEL</div><h2>智谱 BigModel · 文本 + 图像 + 视频一键配置 <span class="model-tag free">免费</span></h2><p>使用同一把 ZHIPU_API_KEY 打通三个环节：文本（GLM-4.7-Flash【免费】，覆盖大纲 / 剧本 / 审校）、图像（CogView-4-250304，角色立绘）、视频（清影 CogVideoX-3，5/10 秒）。</p><p class="hint">点击后合并到当前配置，需保存才生效；密钥在「密钥管理」录入一次即可复用。</p></div><div class="mm-apply"><button class="primary" data-action="zhipu-apply">一键配置</button><span class="mm-name">智谱 BigModel</span></div></div></section>`;}

export function sfBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">MULTIMODAL · SILICONFLOW</div><h2>SiliconFlow · 文本 + 图像一键配置 <span class="model-tag free">免费</span></h2><p>使用同一把 SILICONFLOW_API_KEY 配置文本（Qwen2.5-7B-Instruct【免费】，覆盖大纲 / 剧本 / 审校）与图像（Kolors【免费】，角色立绘）。视频暂未接入。</p><p class="hint">点击后合并到当前配置，需保存才生效；密钥在「密钥管理」录入一次即可复用。</p></div><div class="mm-apply"><button class="primary" data-action="sf-apply">一键配置</button><span class="mm-name">SiliconFlow</span></div></div></section>`;}

export function mossBannerView(){return `<section class="panel agnes-banner"><div class="row"><div><div class="eyebrow">SELF-HOSTED · OPENMOSS</div><h2>MOSS · 本地部署组合（文本 + 语音）</h2><p>自部署 MOSS 系列开源模型（vLLM / Ollama 等提供 OpenAI 兼容接口）：文本对话覆盖大纲 / 剧本 / 审校，MOSS-TTS-Nano 负责语音配音。本机运行、免费离线。</p><p class="hint">填写你部署服务的地址与模型名；本地无鉴权时密钥留空。</p></div><div class="moss-fields"><label>文本服务地址<input id="moss-text-url" data-transient value="http://127.0.0.1:8000/v1"></label><label>文本模型名<input id="moss-text-model" data-transient value="moss"></label><label>语音服务地址<input id="moss-tts-url" data-transient value="http://127.0.0.1:8001/v1"></label><label>语音模型名<input id="moss-tts-model" data-transient value="MOSS-TTS-Nano"></label><label>密钥引用名（可空）<input id="moss-key" data-transient placeholder="本地可留空"></label><button class="primary" data-action="moss-apply">一键配置 MOSS</button></div></div></section>`;}
