import {coachRender,coachHandle,coachBoot} from './coach.js';
import {imageSettings,readImage} from './character-images.js';
import {audioPanel,speechSettings,readSpeech,speechTemplate,readTracks,setDialogue} from './audio-panel.js';
import {creationEditor,proposalPreview,captureDocument,editStructure,replaceDraft,libraryRow,readLibrary,readRelations,appendPhaseRow,removePhaseRow,addRelationRow,removeRelationRow,addOutfitRow,setCharFilter,toggleCanvas,storyboardCanvas,moveStoryboardShot} from './creation-editor.js';
import {settingsExtras,cloudTemplatesView,cloudSettings,readCloud,agnesBannerView,geminiBannerView,mimoBannerView,arkBannerView,zhipuBannerView,sfBannerView,secretPendingHtml,secretUsage,secretRowsHtml} from './settings-extra.js';
import {updatePanel,handleUpdate} from './updates.js';
import {videoWorkbench, shotProgress, readShot, flatShots, pickedShots, comparePick, compareList, compareClear} from './video-workbench.js';
import {canvasActive, toggleCanvas as toggleShotCanvas, canvasView, mountCanvas} from './shot-canvas.js'; import {nativeSettings, readNative} from './native-settings.js'; import {modelHubView, deploymentProgress, runtimeStatus, readDeploymentConfig, mossHubCard} from './model-hub.js'; import {textModelsView, readTextSettings, updateTextProfiles, resolvedModelName} from './text-models.js';
import {assetLibraryView} from './asset-library.js';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages = ['outline', 'script', 'video', 'edit'];
const names = {coach:'引导助手',outline:'故事大纲', script:'剧本分镜', video:'视频生成', edit:'后期剪辑', models:'设置中心', jobs:'任务记录', projects:'项目管理', assets:'素材库', review:'一致性审校', assist:'AI 伴写', 'character-image':'角色立绘',speech:'AI 配音', 'speech-deploy':'本地语音部署', export:'导出成片'};
const statuses = {queued:'排队中', running:'执行中', succeeded:'已完成', failed:'失败', cancelled:'已取消', interrupted:'执行中断'};
const voiceDrafts=new Map();
const countLabel = n => n > 99 ? '99+' : String(n);
let videoKey='0-0'; let deploymentDirty=false; let state, projectId = localStorage.getItem('projectId'), page = 'outline', editor = false, dirty = false, previewId = '', timer, canvasMode = false;
function toast(message) {$('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(timer); timer = setTimeout(() => $('#toast').style.display = 'none', 6000);}
async function api(url, method = 'GET', data) {
  let r;try{r = await fetch(url, {method, headers: {'Content-Type':'application/json', 'X-Workspace-Token':state?.token || ''}, ...(data === undefined ? {} : {body: JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('工作台服务未响应，请检查服务是否仍在运行。取消尚未确认；恢复连接后可再次取消，勿重复提交生成任务。');}
  const result = await r.json(); if (!r.ok) throw new Error(result.error || '请求失败'); return result;
}
function project() {return state.projects.find(p => p.id === projectId);}
async function refresh(draw = true) {state = await api('/api/state'); if (!project()) projectId = state.projects[0]?.id; if (draw) render();}
const button = (label, action, cls = '', attrs = '') => `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const empty = (title, text) => `<div class="empty"><div class="symbol">◇</div><h3>${title}</h3><p>${text}</p></div>`;
function openModalEl(wide=false){const m=$('#modal');m.classList.toggle('wide',wide);m.showModal();return m;}
function showModal(title, text, wide=false) {const m=$('#modal');m.classList.toggle('wide',wide);$('#modal-body').innerHTML = `<h2>${esc(title)}</h2><pre>${esc(text)}</pre>`; m.showModal();}
function render() {
  const p = project(), pending = state.jobs.filter(j => ['queued','running'].includes(j.status)).length;
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="mark"><img src="/assets/cyancreator-icon.png" alt="CyanCreator"></div><div><b>CyanCreator</b><small>YOUR LOCAL AI STUDIO</small></div></div><div class="eyebrow">创作工作空间</div><nav class="nav">${stages.map((s,i) => button(`<span>0${i+1}</span>${names[s]}`, 'navigate', page === s ? 'active' : '', `data-page="${s}"`)).join('')}${button('<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m10 3-.6 2.3-2 .9-2.1-.6-2 3.4 1.6 1.7v2.5L3.3 15l2 3.4 2.2-.6 2 .9.5 2.3h4l.6-2.3 2-.9 2.1.6 2-3.4-1.6-1.8v-2.4l1.6-1.8-2-3.4-2.2.6-2-.9L14 3Z"/><circle cx="12" cy="12" r="3.2"/></svg></span>设置中心','navigate',page==='models'?'active':'','data-page="models"')}${button(`<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V12l4 2"/></svg></span>任务记录 ${pending ? `· ${countLabel(pending)}` : ''}`,'navigate',page==='jobs'?'active':'','data-page="jobs"')}${button(`<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M2.5 9.5h5M2.5 14.5h5M16.5 9.5h5M16.5 14.5h5M7.5 7h4.5M7.5 12h4.5M7.5 17h4.5"/></svg></span>素材库 ${state.assets.length ? `· ${countLabel(state.assets.length)}` : ''}`,'navigate',page==='assets'?'active':'','data-page="assets"')}</nav><div class="sidefoot"><span class="status-dot"></span>本地工作空间<br>项目与素材保存在此机器<br><br>CYANCREATOR / 0.4.4</div></aside><main class="main"><header class="topbar"><div class="actions"><span class="muted">项目 /</span><select id="project-select" aria-label="当前项目"><option value="">选择项目</option>${state.projects.map(x => `<option value="${x.id}" ${x.id===projectId?'selected':''}>${esc(x.name)}</option>`).join('')}</select>${button('＋ 新建','new-project','small ghost')}${p?button('管理','manage-project','small ghost','data-id="'+p.id+'"'):''}</div><div class="right"><span class="tag">LOCAL FIRST</span><span class="muted">${p?`修订 ${p.revision}`:'准备创作'}</span></div></header><div class="workspace">${state.storageError?'<p class="warning">工作区保存受阻，修改暂存在内存，请检查磁盘与文件占用后重试保存。取消任务仍可操作。</p>':''}${stages.includes(page)?`<div class="steps">${stages.map((s,i)=>button(`<span class="num">0${i+1}</span><span>${names[s]}<small>${['构思 · 世界观 · 节拍','场景 · 对白 · 镜头','本地推理 · 素材入库','时间线 · 剪辑 · 导出'][i]}</small></span>`,'navigate',`step ${s===page?'active':''}`,`data-page="${s}"`)).join('')}</div>`:''}<div class="heading"><div><div class="eyebrow">${page==='models'?'MODEL WORKBENCH':page==='jobs'||page==='projects'?'PRODUCTION LOG':'FROM IDEA TO FILM'}</div><h1>${names[page]}</h1><p class="subtitle">${{outline:'让一个想法，长成一个值得讲述的故事。',script:'从故事节拍到台词，再到每一个可执行的镜头。',video:'选择视频模型，把分镜变成画面。',edit:'挑选、裁剪、排序，把镜头连成作品。',models:'让每一个创作环节，连接合适的模型。',jobs:'查看真实执行状态、生成结果与耗时。',projects:'重命名、复制、导出或删除你的项目。',assets:'所有项目生成的视频、音频与图像，集中管理。'}[page]}</p></div><div class="heading-actions">${page==='models'&&dirty?button('保存设置','save-settings','primary'):''}<span class="form-status">${dirty?'有未保存修改':''}</span></div></div>${page==='models'?modelsView():page==='jobs'?jobsView():page==='projects'?projectsView():page==='assets'?assetLibraryView(state):!p?`<div class="hero"><div class="eyebrow">A SPACE FOR YOUR NEXT STORY</div><h2>从灵感的第一行，<br>到成片的最后一帧。</h2><p>大纲、剧本、生成与剪辑，在同一个工作空间。</p><div class="orb"></div></div><div class="panel">${empty('开始你的第一个项目','为故事起一个名字。接入模型前，也可以手动编写、导入素材和完成剪辑。')}<div class="actions">${button('＋ 创建项目','new-project','primary')}${button('配置模型','navigate','','data-page="models"')}</div></div>`:page==='outline'||page==='script'?writingView(p):page==='video'?videoView(p):editView(p)}</div></main></div>`;
  coachRender(state);
  if(page==='models'&&document.querySelector('[data-settings-section="security"]')){
  {const vh=document.getElementById('vault-backend-hint');if(vh&&state.vault?.label)vh.textContent='当前密钥加密方式：'+state.vault.label+(state.vault.note?'（'+state.vault.note+'）':'')+'。保存后不回显，不写入浏览器存储或项目文件。';}
  if(document.getElementById('assist-pop-models')&&!document.getElementById('assist-pop-models').hasChildNodes()){
    const profiles=state.settings?.text?.profiles||[];
    document.getElementById('assist-pop-models').innerHTML=profiles.map(p=>'<label class="assist-model-check"><input type="checkbox" value="'+esc(p.id)+'" checked> '+esc(p.name)+' &middot; '+esc(p.model)+'</label>').join('');
  }const u=secretUsage(state);const all=[...state.secrets].sort((a,b)=>{if(secretSort==='time-desc'||secretSort==='time-asc'){const av=a.createdAt?Date.parse(a.createdAt):0,bv=b.createdAt?Date.parse(b.createdAt):0;return secretSort==='time-desc'?bv-av:av-bv;}return secretSort==='desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name);});const shown=all.filter(x=>x.name.toLowerCase().includes(secretSearch.toLowerCase()));const host=document.getElementById('secret-rows');if(host)host.innerHTML=secretRowsHtml(state,u,secretSearch,secretSort,secretEdit).rows;const cnt=document.getElementById('secret-count');if(cnt)cnt.textContent=`显示 ${shown.length} / 共 ${all.length} 个密钥`;}
  hideAssistPop();
  {const fl=$('#assist-float');if(fl)fl.hidden=true;}
  if(canvasActive()&&page==='video'&&project())mountCanvas(project(),state);
  document.querySelectorAll('[data-voice-text]').forEach(t=>{const d=voiceDrafts.get(t.dataset.voiceText);if(d)t.value=d;});
}
function schemeSelectHtml(){
  const schemes=state.settings.schemes||[],bind=localStorage.getItem('modelScheme:'+projectId);
  const opts=schemes.map(sc=>({id:sc.id,name:sc.name,sel:bind===sc.id}));
  return `<label class="stage-model">方案<select data-scheme data-transient><option value="" ${bind?'':'selected'}>当前配置</option>${opts.map(o=>`<option value="${o.id}" ${o.sel?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label>`;
}
function modelTag(baseUrl,model){
  const host=(baseUrl||'').replace(/^https?:\/\//,'').split(/[/:?#]/)[0];
  if(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host))return 'local';
  const m=(model||'').toLowerCase();
  if(/glm-\d+(\.\d+)?-flash|glm-4v-flash|qwen2\.5-7b-instruct|kolors/.test(m)||/agnes\.ai/.test(baseUrl||'')||/^agnes-/.test(m))return 'free';
  return '';
}
function tagBadge(baseUrl,model){const t=modelTag(baseUrl,model);return t?`<span class="model-tag ${t}">${t==='local'?'本地部署':'免费'}</span>`:'';}
function writingView(p) {return (page==='outline'?'<div class="hero"><div class="eyebrow">A SPACE FOR YOUR NEXT STORY</div><h2>从灵感的第一行，<br>到成片的最后一帧。</h2><p>先写故事与人物，再组织分镜；模型连接统一在设置中心管理。</p><div class="orb"></div></div>':'')+creationEditor(p,page,state);}
function videoView(p) {
  return (canvasActive()?canvasView(p,state):videoWorkbench(p,state,videoKey))+`<div class="panel"><div class="panel-head"><h2>项目素材库</h2><label>导入视频<input id="upload" type="file" accept="video/*"></label></div>${assetsView(p)}</div>`;
}
function assetsView(p) {
  const assets = state.assets.filter(a=>a.projectId===p.id&&!['audio','image'].includes(a.kind));
  return assets.length?`<div class="shot-grid">${assets.map(a=>`<article class="shot"><div class="shot-frame"><video src="${a.url}" controls preload="metadata"></video></div><div class="shot-body"><h3>${esc(a.name)}</h3><p>${a.width} × ${a.height} · ${a.duration.toFixed(2)}s ${a.exported?'· 成片':''}</p><div class="actions">${button('加入时间线','add-clip','small',`data-id="${a.id}"`)}<a href="${a.url}" download="${esc(a.name)}.${a.extension || 'mp4'}">下载</a></div></div></article>`).join('')}</div>`:empty('还没有素材','生成镜头或导入本地视频，素材会保存在当前项目。');
}
function editView(p) {
  const a = state.assets.find(a=>a.id===previewId && a.projectId===p.id) || state.assets.filter(a=>a.projectId===p.id&&!['audio','image'].includes(a.kind)).at(-1);
  const duration = p.timeline.reduce((sum,c)=>sum+c.end-c.start,0);
  const total = Math.max(duration, ...(p.audioTracks||[]).map(t=>(t.offset||0)+((t.end||0)-(t.start||0))), 1);
  const videoBlocks = p.timeline.map((c,i)=>{const ta=state.assets.find(a=>a.id===c.assetId);return `<div class="timeline-block" data-tl-block="${i}" style="flex-basis:${Math.max((c.end-c.start)/total*100,5)}%" title="${esc(ta?.name||'')}">${ta?`<video class="tl-thumb" src="${ta.url}#t=${c.start.toFixed(1)}" muted preload="metadata" tabindex="-1"></video>`:''}<span class="tl-idx">${String(i+1).padStart(2,'0')}</span><span class="tl-dur">${(c.end-c.start).toFixed(2)} s</span>${c.transition?'<span class="tl-fade">⇋</span>':''}</div>`;}).join('');
  const audioRows = (p.audioTracks||[]).map(t=>{const ta=state.assets.find(a=>a.id===t.assetId);const left=Math.min((t.offset||0)/total*100,92),w=Math.max(((t.end||0)-(t.start||0))/total*100,3);return `<div class="nle-audio-row"><span class="nle-audio-label">${t.role==='music'?'♪ 配乐':'🎙 配音'} · ${esc(ta?.name||'')}</span><div class="nle-audio-lane"><div class="nle-audio-block ${t.role==='music'?'music':''}" style="left:${left}%;width:${w}%"></div></div></div>`;}).join('');
  return `<div class="nle">
  <section class="panel nle-monitor">
    <div class="panel-head"><h2>节目监视器</h2><span class="tag">${p.timeline.length} 片段 · ${duration.toFixed(2)} 秒</span></div>
    ${a?`<video class="preview" id="preview" src="${a.url}" controls preload="metadata"></video><p class="hint">${esc(a.name)} · 预览原素材；裁剪结果以导出成片为准。</p>`:empty('等待画面','先从素材库或镜头版本把片段加入时间线。')}
  </section>
  <aside class="nle-inspector">
    <div class="panel"><h3>片段检查器</h3><p class="hint">调整入点、出点与音量；↑↓ 调整顺序，可为每处衔接选择转场（各衔接处可不同）。</p><div id="clips">${p.timeline.map((c,i)=>{const a=state.assets.find(a=>a.id===c.assetId);return `<div class="clip" draggable="true" data-tl-clip="${i}" data-index="${i}">${a?`<video class="tl-thumb" src="${a.url}#t=${c.start.toFixed(1)}" muted preload="metadata" tabindex="-1"></video>`:''}<b>${esc(a?.name)}</b><label>入点 / 秒<input type="number" step="0.01" min="0" max="${a?.duration}" data-field="start" value="${c.start}"></label><label>出点 / 秒<input type="number" step="0.01" min="0" data-field="end" max="${a?.duration}" value="${c.end}"></label><label>音量 / 倍<input type="number" step="0.1" min="0" max="2" data-field="volume" value="${c.volume}"></label>${i<p.timeline.length-1?`<label class="transition-toggle">与下段转场<select data-field="transition">${['',...(state.transitions||[]).map(t=>t.name)].map(v=>{const o=(state.transitions||[]).find(t=>t.name===v);return `<option value="${v}" ${(c.transition||'')===v?'selected':''}>${v?esc(o?.label||v):'硬切（无转场）'}</option>`;}).join('')}</select></label>`:""}<div class="actions">${button('↑','move-up','small',`data-index="${i}" aria-label="上移片段"`)}${button('↓','move-down','small',`data-index="${i}" aria-label="下移片段"`)}${button('移除','remove-clip','small',`data-index="${i}"`)}</div></div>`;}).join('')||empty('把镜头连成故事','加入素材后可以调整片段顺序、入点、出点和音量。')}</div></div>
    <details class="panel"><summary>项目素材与导入</summary><label>导入视频<input id="upload" type="file" accept="video/*"></label>${state.assets.filter(x=>x.projectId===p.id&&!['audio','image'].includes(x.kind)).map(x=>`<div class="asset-row"><h3>${esc(x.name)}</h3><p>${x.duration.toFixed(2)} 秒 · ${x.width} × ${x.height}</p><div class="actions">${button('预览','preview','small',`data-id="${x.id}"`)}${button('＋ 时间线','add-clip','small',`data-id="${x.id}"`)}</div></div>`).join('')}</details>
    <details class="panel"><summary>音轨与配音编排</summary>${audioPanel(p,state,true)}</details>
    <details class="panel"><summary>字幕（导出时烧录）</summary><label for="subtitle-input">粘贴 SRT 或「开始 结束 文本」行（结束可省略，默认 +3 秒）</label><textarea id="subtitle-input" data-transient style="min-height:90px">${p.subtitles?.length?srtText(p.subtitles):""}</textarea><div class="actions">${button("解析并保存字幕","subtitles-save","small")}${p.subtitles?.length?button("下载 SRT","subtitles-export","small ghost"):""}${p.subtitles?.length?button("清空字幕","subtitles-clear","small ghost"):""}</div><p class="hint">${p.subtitles?.length?`已保存 ${p.subtitles.length} 条，导出时烧录到画面。`:"支持标准 SRT；纯文本行按「秒 开始 结束 文本」解析。"}</p></details>
    <details class="panel"><summary>导出方式</summary><label for="export-preset">导出档位</label><select id="export-preset" data-transient><option value="720p" ${!p.exportPreset||p.exportPreset==='720p'?'selected':''}>720p 横屏 · 1280×720</option><option value="1080p" ${p.exportPreset==='1080p'?'selected':''}>1080p 横屏 · 1920×1080</option><option value="720-vertical" ${p.exportPreset==='720-vertical'?'selected':''}>720p 竖屏 · 720×1280（9:16）</option><option value="1080-vertical" ${p.exportPreset==='1080-vertical'?'selected':''}>1080p 竖屏 · 1080×1920（9:16）</option></select><p class="hint">FFmpeg 按时间线顺序拼接，24fps；不同画幅补边，无音轨的片段补静音。竖屏适合抖音 / Shorts / Reels。</p></details>
  </aside>
  <section class="panel nle-timeline">
    <div class="panel-head"><h3>时间线</h3><p class="hint">总时长 ${duration.toFixed(2)} 秒（0–${Math.ceil(total)}s 刻度）· 点击片段在检查器中定位</p></div>
    <div class="nle-track">${videoBlocks||'<p class="hint">时间线为空：在项目素材或镜头版本里点「＋ 时间线」。</p>'}</div>
    <div class="nle-audio">${audioRows||'<p class="hint">暂无音轨；在「音轨与配音编排」中把音频加入成片音轨。</p>'}</div>
  </section>
</div>`;
}
document.addEventListener('click',e=>{
  const blk=e.target.closest&&e.target.closest('[data-tl-block]');
  if(!blk||e.target.closest('[data-action]'))return;
  const card=document.querySelectorAll('#clips .clip')[Number(blk.dataset.tlBlock)];
  if(card){card.scrollIntoView({behavior:'smooth',block:'center'});card.classList.add('clip-flash');setTimeout(()=>card.classList.remove('clip-flash'),1400);}
});

function profileLabel(id){const pr=state.settings.text.profiles.find(x=>x.id===id);return pr?pr.model+' @ '+pr.baseUrl.replace(/^https?:\/\//,'').slice(0,28):'（已删除）';}
function profileBadge(id){const pr=state.settings.text.profiles.find(x=>x.id===id);return pr?tagBadge(pr.baseUrl,pr.model):'';}
function schemesView(){
  const schemes=state.settings.schemes||[];
  const rows=schemes.map(sc=>`<div class="row" style="padding:11px 0;border-bottom:1px solid var(--line)"><div><h3>${esc(sc.name)}</h3><p class="hint">大纲 ${esc(profileLabel(sc.routes.outline))}${profileBadge(sc.routes.outline)} · 剧本 ${esc(profileLabel(sc.routes.script))}${profileBadge(sc.routes.script)} · 审校 ${esc(profileLabel(sc.routes.review))}${profileBadge(sc.routes.review)} · 视频 ${esc(sc.video?(sc.video.model||sc.video.provider):'—')}</p></div><div class="actions">${button('应用','scheme-apply','small primary',`data-id="${sc.id}"`)}${button('删除','scheme-delete','small ghost',`data-id="${sc.id}"`)}</div></div>`).join('');
  return `<div class="panel"><div class="panel-head"><div><h2>模型方案</h2><p class="hint">一套方案 = 大纲 / 剧本 / 审校模型组合 + 视频模型。应用立即生效；流程页可临时单独切换。</p></div>${button('将当前配置存为方案','scheme-save-current','primary')}</div>${rows||empty('还没有方案','把当前配置保存为方案，之后一键切换整套搭配。')}</div>`;
}
async function applySchemeById(id,silent){
  const sc=(state.settings.schemes||[]).find(x=>x.id===id);if(!sc)return;
  const s=structuredClone(state.settings);
  for(const role of ['outline','script','review'])if(s.text.profiles.some(pf=>pf.id===sc.routes[role]))s.text.roles[role].profileId=sc.routes[role];
  if(sc.video)s.video=structuredClone(sc.video);
  await api('/api/settings','PUT',s);state.settings=s;await refresh();if(!silent)toast('已应用方案「'+sc.name+'」');
}
let settingsTab='models';
let modelsSubTab='text';
function modelsView(){
 const groups=[['schemes','模型方案','预设整套搭配，一键应用',schemesView(state)],['multimodal','组合接入','一次部署 / 一套密钥，组合打通多个创作环节',arkBannerView()+zhipuBannerView()+sfBannerView()+agnesBannerView()+geminiBannerView()+mimoBannerView()],['local','本地部署','下载权重、管理运行环境与部署任务',modelHubView(state)+mossHubCard(state)],['models','模型参数','各环节模型连接与参数配置',modelsParamsView()],['security','密钥管理','集中保存模型密钥并通过引用名复用',settingsExtras(state,secretSearch,secretSort)],['updates','平台更新','检查版本与应用更新',updatePanel()]];
 return '<div class="settings-layout"><nav class="settings-sections" aria-label="设置分类">'+groups.map(([id,title,description])=>'<button data-action="settings-tab" data-id="'+id+'" class="'+(settingsTab===id?'active':'')+'" aria-pressed="'+(settingsTab===id)+'"><b>'+title+'</b><small>'+description+'</small></button>').join('')+'</nav><div class="settings-content">'+groups.map(([id,title,description,content])=>'<section data-settings-section="'+id+'" '+(settingsTab===id?'':'hidden')+'><header class="settings-section-heading"><div><h2>'+title+'</h2><p class="hint">'+description+'</p></div>'+'</header>'+content.replace(/<button\b[^>]*data-action="save-settings"[^>]*>[\s\S]*?<\/button>/g,'')+'</section>').join('')+'</div></div>';
}
function modelsParamsView(){
  const tabs=[
    {id:'text',label:'文本模型',desc:'模型连接与参数配置；在各创作流程页选择当前使用的模型',html:textModelsView(state.settings.text)},
    {id:'video',label:'视频模型',desc:'连接与生成参数配置；在视频生成页切换当前模型',html:cloudTemplatesView(state)+videoSettingsView()},
    {id:'image',label:'图像模型',desc:'立绘与参考图生成服务',html:imageSettings(state.settings)},
    {id:'speech',label:'音频模型',desc:'语音合成（TTS）模型配置',html:speechSettings(state.settings)}
  ];
  return `<div class="models-sub-tabs">${tabs.map(t=>`<button class="sub-tab${modelsSubTab===t.id?' active':''}" data-action="models-sub-tab" data-id="${t.id}">${t.label}</button>`).join('')}</div>${tabs.map(t=>`<div class="models-sub-pane" data-sub="${t.id}" ${modelsSubTab===t.id?'':'hidden'}>${t.html}</div>`).join('')}`;
}
function videoSettingsView() {
  if(['seedance','kling','veo','agnes'].includes(state.settings.video.provider))return `${cloudSettings(state.settings.video)}`;
  const c=state.settings.video; if(c.provider==='native')return `<div class="panel"><h2>视频后端</h2><div class="actions">${button('原生 Wan','video-preset','small','data-id="wan21-native"')}${button('ComfyUI Wan','video-preset','small','data-id="wan21"')}${button('ComfyUI H3','video-preset','small','data-id="minimax-h3"')}</div></div>${nativeSettings(c)}`;
  return `<div class="panel"><div class="row"><div><h3>统一模型路由 · 本地 / 云端</h3><p class="hint">文本用兼容接口切换服务；密钥通过本机加密保险库或环境变量读取。</p></div>${button('保存全部配置','save-settings','primary')}</div></div><div class="grid"><section><div class="panel"><div class="panel-head"><h2>视频模型 · 通用工作流</h2><div class="actions">${button('原生 Wan · 无需 ComfyUI','video-preset','small','data-id="wan21-native"')}${button('Wan 1.3B 方案','video-preset','small','data-id="wan21"')}${button('H3 方案','video-preset','small','data-id="minimax-h3"')}${button('启动并检查本地部署','probe-comfy','small')}</div></div><div class="cols"><div><label>接入方式</label><select id="video-provider"><option value="comfy" ${c.provider==='comfy'?'selected':''}>ComfyUI / 通用视频工作流</option><option value="minimax" ${c.provider==='minimax'?'selected':''}>云端 MiniMax V1 / Hailuo</option></select></div><div><label>服务地址</label><input id="video-url" value="${esc(c.baseUrl)}"></div></div><div class="cols"><div><label>云模型名称 · 本地以工作流权重为准</label><input id="video-model" value="${esc(c.model)}"></div><div><label>云密钥环境变量名称</label><input id="video-key" value="${esc(c.keyEnv)}"></div></div><p class="hint">云适配器当前使用 V1 Hailuo API（768P、6/10 秒）。H3 云端 V2 尚未接入。远程服务需要 HTTPS。</p></div><div class="panel"><div class="panel-head"><h2>本地推理工作流</h2><input type="file" id="workflow-file" accept="application/json,.json" aria-label="导入工作流" style="max-width:260px"></div><p class="hint">在 ComfyUI 跑通所选模型后导出 API 格式 JSON。量化通过实际权重加载节点或运行环境节点指定，修改此处会修改提交的工作流。</p><label>镜头时长策略</label><select id="duration-mode"><option value="h3" ${c.durationMode==='h3'?'selected':''}>按镜头时长对齐 H3 的 17k+5 帧网格</option><option value="wan" ${c.durationMode==='wan'?'selected':''}>按镜头时长对齐 Wan 的 4k+1 帧网格（16fps）</option><option value="workflow" ${!['h3','wan'].includes(c.durationMode)?'selected':''}>固定使用工作流帧数</option></select><label>参数方案名称</label><input id="profile" value="${esc(c.profile)}"><label>工作流 API JSON</label><textarea id="workflow" class="mono code">${esc(JSON.stringify(c.workflow,null,2))}</textarea><div class="cols"><div><label>参数到节点的绑定 JSON</label><textarea id="bindings" class="mono code">${esc(JSON.stringify(c.bindings,null,2))}</textarea></div><div><label>实际参数 JSON</label><textarea id="params" class="mono code">${esc(JSON.stringify(c.params,null,2))}</textarea></div></div><label>唯一视频输出节点 ID（只有一个视频输出时可留空）</label><input id="output-node" value="${esc(c.outputNode)}"><p class="hint">绑定示意：{"prompt":{"node":"12","input":"text"},"steps":{"node":"8","input":"steps"}}。节点 ID 以导入文件为准。每个参数必须绑定；可绑定 checkpoint、量化模式等实际节点输入。H3 自动模式会按当前镜头秒数换算 frames（24fps，17k+5 网格），实际帧数记录在任务参数中。</p><div class="actions" style="margin-top:16px">${button('校验并保存配置','save-settings','primary')}${button('导出当前方案','download-profile')}</div></div></section><aside><div class="panel side-card"><h3>大纲与剧本怎么选</h3><p>先用一个本地 Qwen 指令模型承担三个角色，分别配置提示词与随机性。8B 量级作为待实测起点，量化后留出上下文显存。</p><p>长篇先拆章，再按场景扩写。当前按章节独立写作，共享角色与世界书；长篇可分集组织。</p><p>需要更强的结构推理时，只把大纲或审校切换到云端。切换云端会发送当前创作上下文。</p></div><div class="panel side-card"><h3>优化的验证标准</h3><p>固定提示词与 seed，对比权重、步数和分辨率方案；任务记录保存实际参数和耗时。显存峰值、质量评分与权重转换工具尚未集成。</p><a href="https://docs.comfy.org/tutorials/video/minimax/minimax-h3" target="_blank" rel="noreferrer">H3 官方部署文档 ↗</a></div></aside></div>`;
}
function projectsView() {
  const counts = {};
  for (const a of state.assets) counts[a.projectId] = (counts[a.projectId] || 0) + 1;
  return state.projects.length ? `<div class="panel">${state.projects.map(x => `<div class="row" style="padding:13px 0;border-bottom:1px solid var(--line)"><div><h3>${esc(x.name)}${x.id === projectId ? ' <span class="tag">当前</span>' : ''}</h3><p>修订 ${x.revision} · ${counts[x.id] || 0} 个素材 · ${new Date(x.updatedAt).toLocaleString()}</p></div><div class="actions">${button('打开','open-project','small',`data-id="${x.id}"`)}${button('重命名','rename-project','small',`data-id="${x.id}"`)}${button('复制','duplicate-project','small',`data-id="${x.id}"`)}${button('导出','export-project','small',`data-id="${x.id}"`)}${button('删除','delete-project','small danger',`data-id="${x.id}"`)}</div></div>`).join('')}</div>` : empty('还没有项目','点击右上角「＋ 新建」开始你的第一个故事。');
}
function jobsView() {
  return `${page==='jobs'?projectsView():''}<div class="panel"><div class="panel-head"><h2>生产任务</h2><div class="actions">${button('项目管理','manage-projects','small')}${button('导入项目','import-project','small')}${button('刷新','refresh','small')}</div></div><p class="hint">同一工作台串行执行。取消会停止本地等待，已提交的远端任务可能继续执行；远端 ID 可用于检查。重启后不自动重复提交。</p>${state.jobs.map(j=>`<div class="job"><div class="row"><div><h3>${names[j.kind]}${j.shotLabel?' · '+esc(j.shotLabel):''} <span class="tag ${j.status}">${statuses[j.status]}</span></h3><p>${esc(state.projects.find(p=>p.id===j.projectId)?.name)} · ${new Date(j.createdAt).toLocaleString()} ${j.elapsedMs?`· ${(j.elapsedMs/1000).toFixed(1)}s`:''}</p></div><div class="actions">${['queued','running'].includes(j.status)?button('取消本地任务','cancel','small',`data-id="${j.id}"`):''}${j.result?button('查看结果','job-result','small',`data-id="${j.id}"`):''}${j.result&&!j.applied&&j.status==='succeeded'?button('应用结果','apply-result','small',`data-id="${j.id}"`):''}${j.assetId?`<a href="/media/${j.assetId}" download="${j.assetId}.${state.assets.find(a=>a.id===j.assetId)?.extension||'mp4'}">下载素材</a>`:''}</div></div>${j.progress?.message?`<p>${esc(j.progress.message)}</p>`:''}${j.remoteId?`<p>远端 ID：<span class="mono">${esc(j.remoteId)}</span></p>`:''}${j.error?`<p class="warning">${esc(j.error)}</p>`:''}${j.note?`<p>${esc(j.note)}</p>`:''}${button('执行详情','job-detail','small ghost',`data-id="${j.id}"`)}</div>`).join('')||empty('暂无任务','开始生成大纲、镜头或导出成片后，在这里查看进度。')}</div>`;
}
function readTimeline() {const p=project(); document.querySelectorAll('.clip').forEach(row=>{const i=Number(row.dataset.index);for(const input of row.querySelectorAll('[data-field]')) p.timeline[i][input.dataset.field]=Number(input.value);if(p.timeline[i])p.timeline[i].transition=row.querySelector('[data-field=transition]')?.value||'';});}
async function saveProject(data) {const p=project(); await api(`/api/projects/${p.id}`,'PUT',{revision:p.revision,...data}); dirty=false; await refresh();}
function readSettings() {
  const s=structuredClone(state.settings);
  s.text = readTextSettings(s.text);s.speech=readSpeech(s.speech);s.image=readImage(s.image);
  if(['seedance','kling','veo','agnes'].includes(s.video.provider)){s.video=readCloud(s.video);return s;}
  if(s.video.provider==='native'){s.video=readNative(s.video);return s;} s.video={...s.video,durationMode:$('#duration-mode').value,provider:$('#video-provider').value,baseUrl:$('#video-url').value.trim(),model:$('#video-model').value.trim(),keyEnv:$('#video-key').value.trim(),workflow:JSON.parse($('#workflow').value),bindings:JSON.parse($('#bindings').value),params:JSON.parse($('#params').value),profile:$('#profile').value,outputNode:$('#output-node').value.trim()}; return s;
}
async function handle(action, el) {
 if(action==='asset-filter'){assetFilter=el.dataset.kind;render();return;}
  if(action==='asset-rename'){const a=state.assets.find(x=>x.id===el.dataset.id);$('#modal-body').innerHTML=`<h2>重命名素材</h2><label>名称<input id="asset-new-name" maxlength="120" value="${esc(a.name)}"></label><div class="actions" style="margin-top:16px">${button('保存','asset-rename-confirm','primary','data-id="'+a.id+'"')}</div>`;openModalEl();$('#asset-new-name').focus();return;}
  if(action==='asset-rename-confirm'){await api('/api/assets/'+el.dataset.id,'PUT',{name:$('#asset-new-name').value.trim()});$('#modal').close();await refresh();toast('素材已重命名');return;}
  if(action==='asset-delete'){const a=state.assets.find(x=>x.id===el.dataset.id);$('#modal-body').innerHTML=`<h2>删除素材</h2><p style="margin:8px 0">确定删除「${esc(a.name)}」？文件会一并删除，且无法撤销。</p><div class="actions" style="margin-top:16px">${button('确认删除','asset-delete-confirm','primary','data-id="'+a.id+'"')}<button data-action="asset-cancel" class="ghost">取消</button></div>`;openModalEl();return;}
  if(action==='asset-delete-confirm'){await api('/api/assets/'+el.dataset.id,'DELETE');$('#modal').close();await refresh();toast('素材已删除');return;}
  if(action==='asset-cancel'){$('#modal').close();return;}
  else if(action==='manage-projects'||action==='manage-project'){if(dirty)throw new Error('请先保存当前修改');page='projects';render();return;}
  else if(action==='open-project'){if(dirty)throw new Error('请先保存当前修改');projectId=el.dataset.id;localStorage.setItem('projectId',projectId);editor=false;await refresh();page='outline';render();return;}
  else if(action==='rename-project'){const x=state.projects.find(x=>x.id===el.dataset.id);$('#modal-body').innerHTML='<h2>重命名项目</h2><label for="rename-name">项目名称</label><input id="rename-name" maxlength="100" value="'+esc(x.name).replace(/&quot;/g,'&amp;quot;')+'"><div class="actions" style="margin-top:16px">'+button('保存','rename-project-confirm','primary','data-id="'+x.id+'"')+'</div>';openModalEl();$('#rename-name').focus();return;}
  else if(action==='rename-project-confirm'){await api('/api/projects/'+el.dataset.id,'POST',{action:'rename',name:$('#rename-name').value.trim()});$('#modal').close();await refresh();toast('项目已重命名');return;}
  else if(action==='duplicate-project'){if(dirty)throw new Error('请先保存当前修改');await api('/api/projects/'+el.dataset.id,'POST',{action:'duplicate'});await refresh();toast('已创建项目副本');return;}
  else if(action==='export-project'){if(dirty)throw new Error('请先保存当前修改');toast('正在打包工程档案…');const data=await api('/api/projects/'+el.dataset.id,'POST',{action:'export'});const x=state.projects.find(x=>x.id===el.dataset.id);download((x?x.name:'project')+'.cyancreator.json',JSON.stringify(data));return;}
  else if(action==='import-project'){if(dirty)throw new Error('请先保存当前修改');let input=document.getElementById('project-import-file');if(!input){input=document.createElement('input');input.type='file';input.id='project-import-file';input.accept='.json,application/json';input.style.display='none';document.body.appendChild(input);input.addEventListener('change',async ev=>{const file=ev.target.files[0];if(!file)return;try{if(file.size>4*1024*1024)throw new Error('工程档案超过 4MB，请先在原工作台删除大素材后重试');toast('正在导入工程档案…');const r=await api('/api/projects/import','POST',{project:JSON.parse(await file.text())});projectId=r.project.id;localStorage.setItem('projectId',projectId);await refresh();render();toast(r.missing?`导入完成，${r.missing} 个素材文件缺失（文本内容完整）`:'工程档案导入完成');}catch(err){toast(err.message);}finally{input.value='';}});}
  input.click();return;}
  else if(action==='delete-project'){const x=state.projects.find(x=>x.id===el.dataset.id);const n=state.assets.filter(a=>a.projectId===x.id).length;showModal('删除项目',`将删除项目「${x.name}」${n?`及其 ${n} 个素材文件`:''}，不可恢复。此操作不影响其他项目。`);$('#modal-body').innerHTML+='<div class="actions" style="margin-top:16px">'+button('确认删除','delete-project-confirm','danger','data-id="'+x.id+'"')+'</div>';return;}
  else if(action==='delete-project-confirm'){await api('/api/projects/'+el.dataset.id,'DELETE');$('#modal').close();if(projectId===el.dataset.id){projectId=state.projects[0]?.id||'';localStorage.setItem('projectId',projectId);page=state.projects.length?'outline':'projects';}await refresh();render();toast('项目已删除');return;}
 if(await coachHandle(action,el,coachCtx))return;
 if(action==='assist-float-close'){hideAssistPop();return;}
 if(action==='assist-float-generate'){
   if(!['outline','script'].includes(page))throw new Error('AI 伴写仅支持大纲与剧本阶段');
   const instr=$('#assist-pop-text').value.trim();if(!instr)throw new Error('请填写你的要求');
   const checkedModels=[...document.querySelectorAll('#assist-pop-models input:checked')].map(c=>c.value);
   if(!checkedModels.length)throw new Error('请勾选至少一个模型');
   if(dirty)await saveCreation();
   for(const pid of checkedModels){
     const profile=state.settings.text.profiles.find(p=>p.id===pid);
     await api('/api/jobs','POST',{projectId,kind:'assist',stage:page,instruction:instr,...(profile?{profileId:pid}:{})});
   }
   $('#assist-pop').hidden=true;$('#assist-float').hidden=true;assistField=null;assistPopOpen=false;assistPopSuspended=false;
   await refresh();toast(`已提交 ${checkedModels.length} 个模型的生成任务`);return;}
 if(action==='version-reject'){const a=state.assets.find(x=>x.id===el.dataset.id);if(!a)throw new Error('素材不存在');await api('/api/assets/'+a.id,'PUT',{rejected:!a.rejected});await refresh();toast(a.rejected?'该版本已恢复为候选':'已标记为弃用版本，可在素材库清理');return;}
 if(action==='ab-compare'){const [x,y]=compareList().map(id=>state.assets.find(a=>a.id===id));if(!x||!y)throw new Error('请先勾选两个版本');$('#modal-body').innerHTML=`<h2>A / B 对比</h2><div class="ab-grid"><div><h3>A · ${esc(x.name)}</h3><video controls autoplay muted loop src="${x.url}"></video></div><div><h3>B · ${esc(y.name)}</h3><video controls autoplay muted loop src="${y.url}"></video></div></div>`;openModalEl(true);return;}
 if(action==='assets-cleanup'){
   const referenced=new Set();
   for(const pr of state.projects){for(const c of pr.timeline||[])referenced.add(c.assetId);for(const t of pr.audioTracks||[])referenced.add(t.assetId);for(const v of Object.values(pr.selectedShots||{}))referenced.add(v);for(const v of Object.values(pr.characterReferences||{}))referenced.add(v);for(const sc of pr.script?.scenes||[])for(const sh of sc.shots||[]){if(sh.firstFrameId)referenced.add(sh.firstFrameId);if(sh.lastFrameId)referenced.add(sh.lastFrameId);}}
   const unused=state.assets.filter(a=>!referenced.has(a.id));
   if(!unused.length){toast('没有可清理的素材：所有素材都仍被引用');return;}
$('#modal-body').innerHTML=`<h2>清理未引用素材</h2><p style="margin:8px 0">将永久删除 ${unused.length} 个未被任何项目时间线、音轨、选片、角色参考或镜头首尾帧引用的素材：</p><pre style="max-height:200px;overflow:auto">${esc(unused.slice(0,20).map(a=>'· '+a.name).join('\n'))}${unused.length>20?'\n… 等共 '+unused.length+' 个':''}</pre><div class="actions" style="margin-top:14px">${button('确认清理','assets-cleanup-confirm','danger')}</div>`;openModalEl();return;}
 if(action==='assets-cleanup-confirm'){
   const referenced=new Set();
   for(const pr of state.projects){for(const c of pr.timeline||[])referenced.add(c.assetId);for(const t of pr.audioTracks||[])referenced.add(t.assetId);for(const v of Object.values(pr.selectedShots||{}))referenced.add(v);for(const v of Object.values(pr.characterReferences||{}))referenced.add(v);for(const sc of pr.script?.scenes||[])for(const sh of sc.shots||[]){if(sh.firstFrameId)referenced.add(sh.firstFrameId);if(sh.lastFrameId)referenced.add(sh.lastFrameId);}}
   const unused=state.assets.filter(a=>!referenced.has(a.id));
   let removed=0;
   for(const a of unused){try{await api('/api/assets/'+a.id,'DELETE');removed++;}catch(err){/* 被引用的跳过 */}}
   $('#modal').close();await refresh();toast(`已清理 ${removed} 个未引用素材`);return;}
 if(action==='ark-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='ark-default'))s.text.profiles.push({id:'ark-default',name:'豆包 · 文本模型',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'doubao-seed-1-6-flash-250615',keyEnv:'ARK_API_KEY',temperature:0.7,maxTokens:8192});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='ark-default';
   s.image={...s.image,provider:'compatible',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'doubao-seedream-4-0-250828',keyEnv:'ARK_API_KEY'};
   s.video=await api('/api/cloud-presets/seedance');
   state.settings=s;dirty=true;render();
   const needKeys=['ARK_API_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));
   toast('ARK 一键配置已合并：豆包文本 + Seedream 图像 + Seedance 视频均引用 ARK_API_KEY'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存');return;}
 if(action==='zhipu-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='zhipu-default'))s.text.profiles.push({id:'zhipu-default',name:'智谱 · 文本模型（免费）',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-4.7-flash',keyEnv:'ZHIPU_API_KEY',temperature:0.7,maxTokens:6000});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='zhipu-default';
   s.image={...s.image,provider:'compatible',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'cogview-4-250304',keyEnv:'ZHIPU_API_KEY'};
   s.video=await api('/api/cloud-presets/zhipu');
   state.settings=s;dirty=true;render();
   const needKeys=['ZHIPU_API_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));
   toast('智谱一键配置已合并：GLM-4-Flash（免费）文本 + CogView-4 图像 + 清影视频均引用 ZHIPU_API_KEY'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存');return;}
 if(action==='sf-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='sf-default'))s.text.profiles.push({id:'sf-default',name:'SiliconFlow · 文本模型（免费）',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen2.5-7B-Instruct',keyEnv:'SILICONFLOW_API_KEY',temperature:0.7,maxTokens:6000});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='sf-default';
   s.image={...s.image,provider:'compatible',baseUrl:'https://api.siliconflow.cn/v1',model:'Kwai-Kolors/Kolors',keyEnv:'SILICONFLOW_API_KEY',size:'576x1024'};
   state.settings=s;dirty=true;render();
   const needKeys=['SILICONFLOW_API_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));
   toast('SiliconFlow 一键配置已合并：Qwen2.5-7B（免费）文本 + Kolors（免费）图像均引用 SILICONFLOW_API_KEY'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存；SF 视频暂未接入');return;}
 if(action==='mimo-tts-apply'){
   if(dirty)throw new Error('请先保存当前修改');
   const s=structuredClone(state.settings);
   const prof=s.text.profiles.find(p=>/xiaomimimo/.test(p.baseUrl)||/^mimo/i.test(p.model));
   s.speech={...s.speech,provider:'compatible',baseUrl:prof?.baseUrl||'https://token-plan-cn.xiaomimimo.com/v1',model:'MiMo-V2.5-TTS',keyEnv:prof?.keyEnv||'MIMO_KEY',voice:'default'};
   await api('/api/settings','PUT',s);state.settings=s;await refresh();
   toast('语音配音已切到 MiMo TTS（限时免费）：生成配音后可在任务记录试听');return;}
 if(action==='moss-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const tUrl=($('#moss-text-url')?.value||'').trim(),tModel=($('#moss-text-model')?.value||'').trim(),vUrl=($('#moss-tts-url')?.value||'').trim(),vModel=($('#moss-tts-model')?.value||'').trim(),key=($('#moss-key')?.value||'').trim();
   if(!tUrl||!tModel)throw new Error('请填写文本服务地址与模型名');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='moss-default'))s.text.profiles.push({id:'moss-default',name:'MOSS · 文本模型',baseUrl:tUrl,model:tModel,keyEnv:key,temperature:0.7,maxTokens:8192});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='moss-default';
   if(vUrl&&vModel)s.speech={...s.speech,provider:'compatible',baseUrl:vUrl,model:vModel,keyEnv:key,voice:s.speech.voice||'default'};
   await api('/api/settings','PUT',s);state.settings=s;await refresh();
   toast('MOSS 一键配置已应用：文本三阶段 + 语音配音（本地部署，免费离线）');return;}
 if(action==='mimo-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const s=structuredClone(state.settings);
   let pid=s.text.profiles.find(p=>/xiaomimimo/.test(p.baseUrl)||/^mimo/i.test(p.model))?.id;
   if(!pid){pid='mimo-default';s.text.profiles.push({id:pid,name:'MiMo · 文本模型',baseUrl:'https://token-plan-cn.xiaomimimo.com/v1',model:'mimo-v2.5',keyEnv:'MIMO_KEY',temperature:0.7,maxTokens:6000});}
   for(const r of ['outline','script','review'])s.text.roles[r].profileId=pid;
   state.settings=s;dirty=true;render();
   const needKeys=['MIMO_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));toast('MiMo 一键配置已合并：大纲 / 剧本 / 审校三阶段已指向 MiMo'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存');return;}
 if(action==='gemini-apply'){
   if(dirty||deploymentDirty)throw new Error('请先保存当前配置');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='gemini-default'))s.text.profiles.push({id:'gemini-default',name:'Gemini · 文本模型',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',model:'gemini-2.5-flash',keyEnv:'GEMINI_API_KEY',temperature:0.7,maxTokens:8192});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='gemini-default';
   s.video=await api('/api/cloud-presets/veo');
   state.settings=s;dirty=true;render();
   const needKeys=['GEMINI_API_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));toast('Gemini 一键配置已合并：文本三阶段 + Veo 视频均引用 GEMINI_API_KEY'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存并在密钥保险库录入密钥');return;}
 if(action==='agnes-apply'){if(dirty||deploymentDirty)throw new Error('请先保存当前配置');const next=await api('/api/agnes-preset');state.settings=next;dirty=true;render();const needKeys=['AGNES_API_KEY'].filter(k=>!(state.secrets||[]).some(x=>x.name===k));toast('Agnes 一键配置已合并：文本 / 图像 / 视频均引用 AGNES_API_KEY'+(needKeys.length?'，请在密钥管理补全：'+needKeys.join('、'):'，密钥已就绪')+'，请保存并到密钥保险库录入密钥');return;}

if(action==='canvas-add-timeline'){
  if(dirty)throw new Error('请先保存当前修改');
  readTimeline();
  const p=project(),prefix=p.id+':'+p.scriptVersion+':',clips=[];
  for(const k of pickedShots){
    if(!k.startsWith(prefix))continue;
    const [si,i]=k.slice(prefix.length).split('-').map(Number);
    const sel=p.selectedShots?.[`${si}-${i}`];
    const a=(sel&&state.assets.find(x=>x.id===sel&&x.projectId===p.id))||state.assets.filter(x=>x.projectId===p.id&&x.scriptVersion===p.scriptVersion&&x.scene===si&&x.shot===i).at(-1);
    if(a)clips.push({assetId:a.id,start:0,end:a.duration,volume:1});
  }
  if(!clips.length)throw new Error('所选镜头还没有生成结果，先批量生成');
  await saveProject({audioTracks:readTracks(project()),timeline:[...p.timeline,...clips]});
  toast(`已把 ${clips.length} 个镜头按选择顺序加入时间线`);
  return;
 }
if(action==='video-preview-preset'){for(const [key,value] of Object.entries({steps:8,width:480,height:272}))document.querySelector('[data-shot-param="'+key+'"]').value=value;$('#shot-duration').value=4;dirty=true;toast('已填入 480×272、8 步、4 秒预览参数，保存并生成后生效；画质会降低。');return;}
 if(action==='prompt-preview'){const data=await api('/api/prompt-preview','POST',{projectId,scene:Number(el.dataset.scene),shot:Number(el.dataset.shot),prompt:$('#shot-prompt').value});showModal('实际视频提示词 · 无额外文本模型调用',data.prompt+'\n\n共 '+data.characters+' 字符；仅发送当前镜头。');return;}
 if(action==='settings-tab'){settingsTab=el.dataset.id;document.querySelectorAll('[data-settings-section]').forEach(section=>section.hidden=section.dataset.settingsSection!==settingsTab);document.querySelectorAll('[data-action="settings-tab"]').forEach(button=>{button.classList.toggle('active',button.dataset.id===settingsTab);button.setAttribute('aria-pressed',String(button.dataset.id===settingsTab));});return;}
  if(action==='character-generate-row'){if(dirty)throw new Error('请先保存角色设定，再生成角色图');const cid=el.dataset.id;const mode=document.querySelector(`[data-image-mode="${cid}"]`)?.value||'portrait';let instruction=document.querySelector(`[data-image-instruction="${cid}"]`)?.value||'';const outId=document.querySelector(`[data-image-outfit="${cid}"]`)?.value;const out=(project().characters.find(c=>c.id===cid)?.outfits||[]).find(o=>o.id===outId);if(out&&out.desc)instruction=`穿着${out.name}（${out.desc}）。`+instruction;await api('/api/jobs','POST',{projectId,kind:'character-image',characterId:cid,mode,instruction,...(outId?{outfitId:outId}:{})});await refresh();toast('角色图任务已排队，完成后在角色卡片中选择参考');return;}
  if(action==='character-select'){if(dirty)throw new Error('请先保存稿件');await saveProject({characterReference:{characterId:el.dataset.character,assetId:el.dataset.id}});toast('角色参考图已选定');return;}
  if(action==='job-result'){const j=state.jobs.find(j=>j.id===el.dataset.id);if(j.kind==='coach'){showModal('创作助手',j.result?.reply||'暂无回复');return;}if(j.kind==='guide'){showModal('创作向导',j.result?.reply||'暂无回复');return;}if(j.kind==='assist'){const p=state.projects.find(p=>p.id===j.projectId);$('#modal-body').innerHTML=proposalPreview(j,p);openModalEl(true);return;}}
  if(action==='speech-template'){if(dirty)throw new Error('请先保存配置');state.settings.speech=speechTemplate(el.dataset.id);dirty=true;render();return;}
  if(action==='speech-deploy'){if(dirty||deploymentDirty)throw new Error('请先保存设置');if(!projectId)throw new Error('请先创建项目');await api('/api/jobs','POST',{projectId,kind:'speech-deploy'});toast('语音部署已排队，可在任务记录查看');return;}
  if(action.startsWith('audio-')){
    if(action==='audio-dialogue'){setDialogue(project().script?.scenes.map(s=>s.dialogue||'').join('\n')||'');return;}
    if(action==='audio-generate'){if(dirty)throw new Error('请先保存稿件或音轨');await api('/api/jobs','POST',{projectId,kind:'speech',text:$('#voice-text').value,characterId:$('#voice-character').value,voice:$('#voice-override').value.trim()||((project().characters.find(c=>c.id===$('#voice-character').value)||{}).voiceId||'')});await refresh();toast('配音任务已排队');return;}
    const tracks=readTracks(project());if(page==='script'&&dirty)await saveCreation();if(page==='edit')readTimeline();if(action==='audio-track-add'){if(dirty&&page!=='edit')throw new Error('请先保存当前编辑');const a=state.assets.find(a=>a.id===el.dataset.id);tracks.push({assetId:a.id,role:el.dataset.role,start:0,end:a.duration,offset:0,volume:el.dataset.role==='music'?0.25:1,fadeIn:0,fadeOut:0});}else if(action==='audio-track-remove')tracks.splice(Number(el.dataset.index),1);await saveProject({audioTracks:tracks,...(page==='edit'?{timeline:project().timeline}:{})});toast('音轨已保存，可在后期剪辑中调整位置与混音');return;
  }

  if(action==='canvas-toggle'){toggleShotCanvas();render();return;}
  if(action==='canvas-open-shot'){videoKey=el.dataset.key;if(canvasActive())toggleShotCanvas();render();return;}
  if(action.startsWith('creation-')||action==='storyboard-mode'||action==='sb-generate'||action==='rel-add'||action==='rel-remove'){
 if(action==='char-avatar'){const card=el.closest('[data-library-row]');const hidden=card?.querySelector('[data-avatar-asset]');if(!hidden)throw new Error('未找到头像位');hidden.value=el.dataset.id;dirty=true;toast('头像已选择，保存稿件后生效并更新关系图谱');return;}
 if(action==='outfit-add'){addOutfitRow(el.dataset.char);dirty=true;return;}
 if(action==='outfit-remove'){el.closest('[data-outfit-row]')?.remove();dirty=true;return;}
 if(action==='creation-phase-add'){appendPhaseRow(el.dataset.char,project());dirty=true;return;}
 if(action==='creation-phase-remove'){el.closest('.phase-row')?.remove();dirty=true;return;}
 if(action==='rel-add'){addRelationRow(project());dirty=true;return;}
 if(action==='rel-remove'){el.closest('[data-rel-row]')?.remove();dirty=true;return;}
 if(action==='char-filter'){if(dirty){toast('请先保存修改，再筛选');return;}setCharFilter(el.dataset.group);render();return;}
    if(action==='storyboard-mode'){const active=toggleCanvas(project());canvasMode=active;render();toast(active?'已进入画布模式：拖拽卡片编排分镜':'已切换到列表模式');return;}
    if(action==='sb-generate'){if(dirty){await saveCreation();toast('草稿已先保存');}const si=Number(el.dataset.scene),sj=Number(el.dataset.shot);await api('/api/jobs','POST',{projectId,kind:'video',scene:si,shot:sj});await refresh();toast(`镜头 ${si+1}.${sj+1} 已加入生成队列`);return;}
    if(['creation-add','creation-remove','creation-move','creation-shot-add','creation-shot-remove','creation-shot-move'].includes(action)){editStructure(action,el,project());dirty=true;return;}
    if(action==='creation-library-add'){document.querySelector('[data-library="'+el.dataset.kind+'"]').insertAdjacentHTML('beforeend',libraryRow({},el.dataset.kind,project(),state));dirty=true;return;}
    if(action==='creation-library-remove'){el.closest('[data-library-row]').remove();dirty=true;return;}
    if(action==='creation-save'||action==='creation-library-save'){await saveCreation();return;}
    if(action==='creation-export'){download(page+'.json',JSON.stringify(captureDocument(),null,2));return;}
    if(action==='creation-confirm'){await api('/api/projects/'+projectId+'/structure','POST',{revision:project().revision,action:el.dataset.kind,title:$('#chapter-title').value,episodeId:el.dataset.episode,id:el.dataset.id});$('#modal').close();await refresh();return;}
    if(action==='structure-organizer'){if(dirty)throw new Error('请先保存当前章节草稿');$('#modal-body').innerHTML=structureOrganizerHtml(project());openModalEl(true);wireOrganizer(project());return;}
    if(action==='novel-import-open'){if(dirty)throw new Error('请先保存当前章节草稿');const p=project();$('#modal-body').innerHTML=`<h2>导入小说原本</h2><p class="hint">支持 TXT / Markdown；自动识别「第N章/回/节」或 Markdown 标题分章，无章头时按 6000 字切分。一次最多 60 章。</p><label>选择文件（≤4MB）<input id="novel-file" type="file" accept=".txt,.md,.markdown,text/plain" style="max-width:320px"></label><label>或粘贴正文<textarea id="novel-text" data-transient style="min-height:140px" placeholder="第一章 雨夜\n正文……"></textarea></label><label>导入方式<select id="novel-mode"><option value="chapters-in-episode">全部章节并入一个剧集（推荐：之后再拖动分流到各集）</option><option value="chapter-per-episode">每章拆成一个剧集（一章一集）</option><option value="current">原文附加到当前章节（不新建章节，仅替换本章转换素材）</option></select></label><label id="novel-episode-row">目标剧集（并入模式）<select id="novel-episode">${p.episodes.map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select></label><div class="actions" style="margin-top:12px"><button class="primary" data-action="org-novel">导入并建章</button></div><p class="hint">导入只建章节并保存原文素材；每个新章节进「剧本分镜」页点「✦ AI 转剧本」逐章生成剧本（消耗文本模型调用）。导入会先保存项目并切换到首个新章节。</p>`;openModalEl();return;}
    if(action==='org-apply'){await applyOrganizer(project());await refresh();$('#modal').close();toast('目录编排已保存');return;}
    if(action==='org-novel'){const file=$('#novel-file')?.files?.[0];const text=($('#novel-text')?.value||'').trim();const raw=file?await file.text():text;const mode=$('#novel-mode')?.value||'chapters-in-episode';const episodeId=$('#novel-episode')?.value||'';if(!raw.trim())throw new Error('请选择小说文件或粘贴正文');if(file&&file.size>4*1024*1024)throw new Error('文件不能超过 4MB');const r=await api('/api/novel-import','POST',{revision:project().revision,mode,episodeId,text:raw});projectId=state.projects.find(x=>x.id===projectId).activeChapterId;localStorage.setItem('projectId',projectId);await refresh();$('#modal').close();toast(`已导入 ${r.queue.length} 章${r.truncated?'（部分超长章节已截断）':''}；每章可用「AI 转剧本」生成剧本`);return;}
    if(action==='novel-convert-open'){if(dirty)throw new Error('请先保存当前章节草稿');const ch=project().episodes.flatMap(e=>e.chapters).find(c=>c.id===project().activeChapterId);if(!ch?.novelSource)throw new Error('当前章节没有小说原文：请先在「✦ 小说导入」导入，或把原文粘贴到转换窗');$('#modal-body').innerHTML=`<h2>AI 转剧本 · ${esc(ch.title)}</h2><p class="hint">原文 ${ch.novelSource.length} 字，将按当前剧本模型生成场景与镜头，完成后在任务记录确认应用。</p><label>附加要求（可选）<textarea id="novel-instruction" data-transient style="min-height:80px" placeholder="例如：只保留主线场景；对白用口语；每场最多 3 个镜头"></textarea></label><div class="actions" style="margin-top:12px"><button class="primary" data-action="novel-convert-start">开始转换</button><button class="ghost" data-action="novel-convert-preview">只看提示词结构</button></div>`;openModalEl();return;}
    if(action==='novel-convert-start'){const instruction=($('#novel-instruction')?.value||'').trim();const ch=project().episodes.flatMap(e=>e.chapters).find(c=>c.id===project().activeChapterId);await api('/api/jobs','POST',{projectId,kind:'novel-convert',source:ch.novelSource,chapterTitle:ch.title,instruction});$('#modal').close();await refresh();toast('小说转剧本已入队，完成后在任务记录「应用结果」');return;}
    if(action==='novel-convert-preview'){const ch=project().episodes.flatMap(e=>e.chapters).find(c=>c.id===project().activeChapterId);const sys='你是编剧与分镜导演。把小说原文忠实改编为剧本分镜……（完整结构：{scenes:[{title,action,dialogue,shots:[{prompt,duration}]}]}）';showModal('转换提示词结构',`模型角色：${sys}\n\n上下文：创作简报 + 故事设定 + 角色与世界书 + 章节名 + 小说原文（${ch?.novelSource?.length||0} 字）+ 附加要求`);return;}
    if(dirty)throw new Error('请先保存当前章节草稿');
    if(action==='creation-open-shot'){videoKey=el.dataset.key;page='video';render();return;}
    if(action==='creation-characters'){if(dirty)throw new Error('请先保存当前章节草稿');const instruction=($('#char-gen-instruction')?.value||'').trim()||'依据创作简报、故事设定与当前稿件，生成主要人物设定（含声音特征）';await api('/api/jobs','POST',{projectId,kind:'assist',stage:'characters',mode:'人物设定',instruction});await refresh();toast('人物设定生成中，完成后在「伴写候选」应用');return;}
    const kind=action.replace('creation-','');$('#modal-body').innerHTML=`<h2>${kind==='episode'?'新建剧集':kind==='chapter'?'新建章节':'重命名'}</h2><label>标题<input id="chapter-title" maxlength="120"></label><button data-action="creation-confirm" data-kind="${kind}" data-id="${el.dataset.id||project().activeChapterId}" data-episode="${el.dataset.episode||''}">保存</button>`;openModalEl();$('#chapter-title').focus();return;
  }
  if(action==='cloud-preset'){if(dirty||deploymentDirty)throw new Error('请先保存配置');state.settings.video=await api('/api/cloud-presets/'+el.dataset.id);dirty=true;render();return;}
   if(action==='stage-image-apply'){
   if(dirty)throw new Error('请先保存当前修改');
   const s=structuredClone(state.settings);
   s.image={...s.image,provider:document.getElementById('stage-image-provider').value,baseUrl:document.getElementById('stage-image-base').value.trim(),model:document.getElementById('stage-image-model2').value.trim(),keyEnv:document.getElementById('stage-image-key').value.trim(),size:document.getElementById('stage-image-size').value};
   await api('/api/settings','PUT',s);state.settings=s;await refresh();toast('图像模型已更新，立即可生成角色图');return;}
 if(action==='scheme-save-current'){$('#modal-body').innerHTML='<h2>保存为模型方案</h2><label>方案名称<input id="scheme-name" maxlength="60" placeholder="如：云端高质量 / 本地轻量"></label><div class="actions" style="margin-top:14px">'+button('保存方案','scheme-save-confirm','primary')+'</div>';openModalEl();$('#scheme-name').focus();return;}
 if(action==='scheme-save-confirm'){
   const name=($('#scheme-name')?.value||'').trim();if(!name)throw new Error('请填写方案名称');
   const t=state.settings.text;
   const sc={id:crypto.randomUUID(),name:name.slice(0,60),routes:{outline:t.roles.outline.profileId,script:t.roles.script.profileId,review:t.roles.review.profileId},video:structuredClone(state.settings.video)};
   const s=structuredClone(state.settings);s.schemes=[...(s.schemes||[]).filter(x=>x.name!==name),sc];
   await api('/api/settings','PUT',s);state.settings=s;$('#modal').close();await refresh();toast('方案「'+name+'」已保存，可在各流程页一键应用');return;}
 if(action==='scheme-apply'){await applySchemeById(el.dataset.id);localStorage.setItem('modelScheme:'+projectId,el.dataset.id);return;}
 if(action==='scheme-delete'){const s=structuredClone(state.settings);s.schemes=(s.schemes||[]).filter(x=>x.id!==el.dataset.id);await api('/api/settings','PUT',s);state.settings=s;await refresh();toast('方案已删除');return;}
 if(action==='moss-modal'){
   const prof=(state.settings.text.profiles||[]).find(p=>p.id==='moss-default')||{};
   const sp=(state.settings.speech&&state.settings.speech.provider==='compatible')?state.settings.speech:{};
   $('#modal-body').innerHTML=`<h2>接入 MOSS 本地服务</h2><p class="hint">前提：你已自行启动 MOSS 推理服务（vLLM / Ollama / 推理脚本均可，提供 OpenAI 兼容接口），本工作台负责连接与调用，不自动下载权重。</p><label>文本服务地址（OpenAI 兼容）<input id="moss-text-url" data-transient value="${esc(prof.baseUrl||'http://127.0.0.1:8000/v1')}"></label><label>文本模型名<input id="moss-text-model" data-transient value="${esc(prof.model||'moss')}"></label><label>语音服务地址（OpenAI 兼容 TTS）<input id="moss-tts-url" data-transient value="${esc((state.settings.speech&&state.settings.speech.baseUrl)||'http://127.0.0.1:8001/v1')}"></label><label>语音模型名<input id="moss-tts-model" data-transient value="${esc((state.settings.speech&&state.settings.speech.model)||'MOSS-TTS-Nano')}"></label><label>密钥引用名（本地可空）<input id="moss-key" data-transient value="${esc(prof.keyEnv||'')}"></label><div class="actions" style="margin-top:14px">${button('保存并接入','moss-apply-save','primary')}</div>`;
   openModalEl();$('#moss-text-url').focus();return;}
 if(action==='moss-apply-save'){
   const tUrl=($('#moss-text-url')?.value||'').trim(),tModel=($('#moss-text-model')?.value||'').trim(),vUrl=($('#moss-tts-url')?.value||'').trim(),vModel=($('#moss-tts-model')?.value||'').trim(),key=($('#moss-key')?.value||'').trim();
   if(!tUrl||!tModel)throw new Error('请填写文本服务地址与模型名');
   const s=structuredClone(state.settings);
   if(!s.text.profiles.some(p=>p.id==='moss-default'))s.text.profiles.push({id:'moss-default',name:'MOSS · 文本模型',baseUrl:tUrl,model:tModel,keyEnv:key,temperature:0.7,maxTokens:8192});
   for(const r of ['outline','script','review'])s.text.roles[r].profileId='moss-default';
   if(vUrl&&vModel)s.speech={...s.speech,provider:'compatible',baseUrl:vUrl,model:vModel,keyEnv:key,voice:s.speech.voice||'default'};
   await api('/api/settings','PUT',s);state.settings=s;await refresh();
   toast('MOSS 已接入：文本三阶段 + 语音配音（本地部署，免费离线）');return;}
 if(action==='model-select-popup'){
   const kind=el.dataset.modelKind||'image';
   const items=kind==='image'?state.settings.image:{...state.settings.speech};
   const providers={'image':[['compatible','兼容 Images API · 云端/本地'],['agnes','Agnes 图像'],['automatic1111','本地 AUTOMATIC1111']],'speech':[['compatible','云端兼容接口'],['elevenlabs','ElevenLabs']]};
   const opts=(providers[kind]||[]).map(([v,l])=>`<option value="${v}" ${state.settings[kind]?.provider===v?'selected':''}>${l}</option>`).join('');
   const curModel=state.settings[kind]?.model||'';
   $('#modal-body').innerHTML=`<h2>选择${kind==='image'?'图像':kind==='speech'?'语音':'模型'}模型</h2><label>服务商<select id="popup-provider">${opts}</select></label><label>模型 ID<input id="popup-model" data-transient value="${esc(state.settings[kind]?.model||'')}"></label><label>服务地址<input id="popup-url" data-transient value="${esc(state.settings[kind]?.baseUrl||'')}"></label><label>密钥引用名<input id="popup-key" data-transient value="${esc(state.settings[kind]?.keyEnv||'')}"></label><div class="actions" style="margin-top:14px"><button class="primary" data-action="model-select-save" data-model-kind="${kind}">保存</button></div>`;
   openModalEl();return;}
 if(action==='model-select-save'){
   const kind=el.dataset.modelKind;const s=structuredClone(state.settings);
   s[kind].provider=$('#popup-provider').value;s[kind].model=$('#popup-model').value.trim();
   s[kind].baseUrl=$('#popup-url').value.trim();s[kind].keyEnv=$('#popup-key').value.trim();
   await api('/api/settings','PUT',s);state.settings=s;await refresh();$('#modal').close();
   toast('模型已更新');return;}
 if(action==='vault-reset-open'){$('#modal-body').innerHTML=`<h2>重置密钥保险库</h2><p class="hint">当前保险库密文无法在本机解密。重置后：已保存的密钥清空，需要重新录入；旧密文文件会改名保留在 data/secrets/，带回原 Windows 账户/机器仍可能恢复；环境变量不受影响。</p><div class="actions" style="margin-top:14px">${button('确认重置','vault-reset-confirm','primary')}<button data-action="modal-dismiss" class="ghost">取消</button></div>`;openModalEl();return;}
 if(action==='vault-reset-confirm'){await api('/api/vault/reset','POST',{confirm:true});$('#modal').close();await refresh();toast('保险库已重置，请重新录入密钥');return;}
 if(action==='modal-dismiss'){$('#modal').close();return;}
 if(action==='secret-save'){
   const freeName=$('#secret-name').value.trim(),freeValue=$('#secret-value').value;
   const saves=new Map();
   if(freeName&&freeValue)saves.set(freeName,{name:freeName,value:freeValue});
   document.querySelectorAll('[data-pending-key]').forEach(inp=>{const v=inp.value.trim();const n=inp.dataset.pendingKey;if(v&&!saves.has(n))saves.set(n,{name:n,value:v});});
   if(!saves.size)throw new Error(freeName?'请填写 KEY':'请填写引用名称与 KEY，或在待补全条目粘贴 KEY');
   const have=new Set((state.secrets||[]).map(x=>x.name));
   let added=0,updated=0;
   for(const it of saves.values()){have.has(it.name)?updated++:added++;await api('/api/secrets','PUT',it);}
   if($('#secret-value'))$('#secret-value').value='';
   await renderSecretUI();
   toast(`已加密保存 ${saves.size} 个密钥（新增 ${added} · 更新 ${updated}）`);return;}
 if(action==='secret-edit'){secretEdit=el.dataset.name;renderSecretList();return;}
 if(action==='secret-edit-save'){const value=document.querySelector(`[data-edit-key="${el.dataset.name}"]`)?.value||'';if(!value.trim())throw new Error('请输入新 KEY');await api('/api/secrets','PUT',{name:el.dataset.name,value});secretEdit=null;await renderSecretUI();toast('密钥 KEY 已更新');return;}
 if(action==='secret-edit-cancel'){secretEdit=null;renderSecretList();return;}
 if(action==='secret-delete'){const name=el.dataset.name;await api('/api/secrets','PUT',{name,value:''});await renderSecretUI();toast('密钥已移除');return;}

  if(action==='update-check'||action==='update-apply'){if(dirty||deploymentDirty)throw new Error('请先保存当前编辑');return handleUpdate(action,api);}
  if (action==='navigate') {if(dirty||deploymentDirty) {toast('请先保存修改，再切换页面');return;} page=el.dataset.page;if(el.dataset.settingsTab)settingsTab=el.dataset.settingsTab;editor=false;render();}
  else if(action==='new-project') {if(dirty) throw new Error('请先保存当前修改'); $('#modal-body').innerHTML='<h2>创建项目</h2><label for="new-name">项目名称</label><input id="new-name" placeholder="未命名的故事" maxlength="100"><div class="actions" style="margin-top:16px">'+button('创建项目','create-project','primary')+'</div>'; openModalEl(); $('#new-name').focus();}
  else if(action==='create-project') {const p=await api('/api/projects','POST',{name:$('#new-name').value.trim()});projectId=p.id;localStorage.setItem('projectId',projectId);page='outline';$('#modal').close();await refresh();}
  else if(action==='save-brief') {await saveCreation();}
  else if(action==='toggle-editor') {if(dirty) throw new Error('请先保存修改');editor=!editor;render();}
  else if(action==='save-document') {await saveProject({stage:page,value:JSON.parse($('#document-json').value)});toast('稿件已保存');}
  else if(action==='generate'||action==='shot') {
    if(dirty) throw new Error('请先保存修改，再执行任务');
    const presetSelect=$('#export-preset');
    const data={projectId,kind:action==='shot'?'video':el.dataset.kind,...(action==='shot'?{scene:Number(el.dataset.scene),shot:Number(el.dataset.shot)}:{}),...(el.dataset.kind==='export'&&presetSelect&&presetSelect.value?{preset:presetSelect.value}:{})};
    await api('/api/jobs','POST',data);page='jobs';await refresh();toast('任务已加入队列');
  }
  else if(action==='save-settings') {if(deploymentDirty)throw new Error('请先保存部署设置');const draft=readSettings(),latest=await api('/api/state');for(const p of latest.settings.text.profiles)if(p.id.startsWith('deployed-')&&!state.settings.text.profiles.some(x=>x.id===p.id)&&!draft.text.profiles.some(x=>x.id===p.id))draft.text.profiles.push(p);await api('/api/settings','PUT',draft);dirty=false;await refresh();toast('模型配置已保存');}
  else if(['add-profile','copy-profile','delete-profile','share-profile'].includes(action)) {const draft=readSettings();draft.text=updateTextProfiles(draft.text,action,el.dataset.id);state.settings=draft;dirty=true;render();toast(action==='share-profile'?'三个阶段已引用此配置，独立参数保留；请保存':'配置草稿已更新，请保存');}
  else if(action==='video-preset') {const s=readSettings();s.video=await api('/api/video-presets/'+el.dataset.id);if(s.video.provider==='comfy')s.video.baseUrl=state.deploymentConfig.comfyUrl;state.settings=s;dirty=true;render();toast('视频方案已载入，请保存后检查部署');} else if(action==='save-deployment') {await api('/api/deployment/config','PUT',readDeploymentConfig());state.deploymentConfig=readDeploymentConfig();deploymentDirty=false;toast('部署设置已保存');} else if(action==='deploy-model') {if(dirty)throw new Error('请先保存模型配置');await api('/api/deployment/config','PUT',readDeploymentConfig());deploymentDirty=false;await api('/api/deployments','POST',{modelId:el.dataset.id});await refresh();toast('已加入部署队列');} else if(action==='cancel-deployment') {await api('/api/deployments/'+el.dataset.id+'/cancel','POST',{});toast('正在取消部署');} else if(action==='stop-runtime') {await api('/api/runtimes/'+el.dataset.id+'/stop','POST',{});toast('已请求停止服务');}
  else if(action==='probe-native') {if(dirty||deploymentDirty)throw new Error('请先保存配置');toast('检查独立环境与权重…');const result=await api('/api/probe','POST',{kind:'native'});showModal(result.ready?'原生环境与文件就绪':'原生环境可用，权重未齐',JSON.stringify(result,null,2));  } else if(action==='first-frame-clear'){await saveProject({__clearFirstFrame:{scene:Number(el.dataset.scene),shot:Number(el.dataset.shot)}});toast('已清除首帧，恢复文生视频');return;} else if(action==='last-frame-clear'){await saveProject({__clearLastFrame:{scene:Number(el.dataset.scene),shot:Number(el.dataset.shot)}});toast('已清除尾帧');return;}
  else if(action==='video-focus'){if(dirty)throw new Error('请先保存当前镜头');videoKey=el.dataset.key;render();} else if(action==='video-select-all'){if(dirty)throw new Error('请先保存当前镜头');const p=project(),keys=flatShots(p).map(s=>p.id+':'+p.scriptVersion+':'+s.key),all=keys.every(k=>pickedShots.has(k));keys.forEach(k=>all?pickedShots.delete(k):pickedShots.add(k));render();} else if(action==='video-save'||action==='video-generate'){const scene=Number(el.dataset.scene),shot=Number(el.dataset.shot);await api('/api/projects/'+projectId+'/shots/'+scene+'/'+shot+'/edit','POST',{revision:project().revision,...readShot()});dirty=false;await refresh();if(action==='video-generate'){await api('/api/jobs','POST',{projectId,kind:'video',scene,shot});await refresh();toast('镜头已保存并加入队列');}else toast('镜头已保存');} else if(action==='video-batch'){if(dirty)throw new Error('请先保存当前镜头');const p=project(),shots=flatShots(p).filter(s=>pickedShots.has(p.id+':'+p.scriptVersion+':'+s.key)).map(s=>({scene:s.si,shot:s.i}));await api('/api/video/batch','POST',{projectId,revision:p.revision,shots});await refresh();toast('所选镜头已加入队列');} else if(action==='video-batch-continue'){if(dirty)throw new Error('请先保存当前镜头');const p=project(),shots=flatShots(p).filter(s=>pickedShots.has(p.id+':'+p.scriptVersion+':'+s.key)).map(s=>({scene:s.si,shot:s.i}));if(!shots.length)throw new Error('请先选择镜头');await api('/api/video/batch','POST',{projectId,revision:p.revision,shots,seedMode:'continue'});await refresh();toast('已按连续 Seed 加入队列（相邻镜头画面更稳定）');} else if(action==='video-select-version'){if(dirty)throw new Error('请先保存当前镜头');await api('/api/projects/'+projectId+'/shots/'+el.dataset.scene+'/'+el.dataset.shot+'/select','POST',{revision:project().revision,assetId:el.dataset.id});await refresh();toast('已选定镜头版本');} else if(action==='video-log'){if(dirty)throw new Error('请先保存当前镜头');page='jobs';render();} else if(action==='download-profile') {download('cyancreator-model-profile.json',JSON.stringify(readSettings(),null,2));}
  else if(action==='probe'||action==='probe-comfy') {if(dirty) throw new Error('请先保存配置再测试');toast('正在测试模型服务…');const result=await api('/api/probe','POST',{kind:action==='probe'?'text':'comfy',start:action==='probe-comfy',profileId:el.dataset.id});showModal(result.ready===false?'服务已连接，但部署不完整':'服务连接成功',JSON.stringify(result,null,2));}
  else if(action==='refresh') {if(dirty) throw new Error('请先保存修改');await refresh();}
  else if(action==='cancel') {await api(`/api/jobs/${el.dataset.id}/cancel`,'POST',{});await refresh();}
  else if(action==='job-result'||action==='job-detail') {const j=action==='job-detail'?await api(`/api/jobs/${el.dataset.id}/details`):state.jobs.find(j=>j.id===el.dataset.id);showModal(action==='job-result'?'生成结果':'执行详情',JSON.stringify(action==='job-result'?j.result:j,null,2),true);}
  else if(action==='apply-result') {const j=state.jobs.find(j=>j.id===el.dataset.id),p=state.projects.find(p=>p.id===j.projectId);await api(`/api/jobs/${j.id}/apply`,'POST',{revision:p.revision});$('#modal').close();await refresh();toast('生成结果已应用，旧稿保留在版本记录');}
  else if(action==='history') {const h=project().history.find(h=>h.id===el.dataset.id);showModal(`${names[h.stage]} · 修订 ${h.revision}`,JSON.stringify(h.value,null,2));}
  else if(action==='add-clip') {readTimeline();const a=state.assets.find(a=>a.id===el.dataset.id);await saveProject({audioTracks:readTracks(project()),timeline:[...project().timeline,{assetId:a.id,start:0,end:a.duration,volume:1}]});toast('已加入时间线');}
  else if(action==='subtitles-save'){const p=project(),raw=$('#subtitle-input').value;const subs=parseSubtitles(raw);await saveProject({subtitles:subs});toast(`已保存 ${subs.length} 条字幕`);return;}
  else if(action==='subtitles-clear'){await saveProject({subtitles:[]});toast('字幕已清空');return;}
  else if(action==='subtitles-export'){download((project().name||'subtitles')+'.srt',toSRT(project().subtitles||[]));return;}
  else if(action==='save-timeline') {readTimeline();await saveProject({audioTracks:readTracks(project()),timeline:project().timeline});toast('剪辑已保存');}
  else if(['move-up','move-down','remove-clip'].includes(action)) {readTimeline();const arr=project().timeline,i=Number(el.dataset.index);if(action==='remove-clip')arr.splice(i,1);else {const next=i+(action==='move-up'?-1:1);if(next>=0&&next<arr.length)[arr[i],arr[next]]=[arr[next],arr[i]];}await saveProject({audioTracks:readTracks(project()),timeline:arr});}
  else if(action==='preview') {readTimeline();previewId=el.dataset.id;render();}
}
async function saveCreation(){const value=captureDocument(),empty=page==='outline'?!value.logline&&!value.beats.some(b=>b.title||b.summary):!value.scenes.some(s=>s.title||s.action||s.dialogue||s.shots.some(x=>x.prompt));const libChars=document.querySelector('[data-library="characters"] [data-library-row]');await api('/api/projects/'+projectId+'/draft','POST',{revision:project().revision,stage:page,value:empty?null:value,brief:$('#brief')?.value??project().brief,bible:$('#bible')?.value??project().bible,characters:libChars?readLibrary('characters'):project().characters,worldbook:libChars?readLibrary('worldbook'):project().worldbook,...(page==='outline'&&document.getElementById('rel-rows')?{relations:readRelations()}:{}),...(libChars?{}:{})});dirty=false;await refresh();toast('章节与共享设定已保存');}
function fmtSRT(t){const h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=Math.floor(t%60),ms=Math.round(t%1*1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}
function srtText(subs){return subs.map(s=>`${s.start} ${s.end} ${s.text.replace(/\n/g,' ')}`).join('\n');}
function toSRT(subs){return subs.map((s,i)=>`${i+1}\n${fmtSRT(s.start)} --> ${fmtSRT(s.end)}\n${s.text}`).join('\n\n')+'\n';}
function parseSubtitles(raw){
  const text=raw.replace(/^\uFEFF/,'').trim();if(!text)return [];
  if(text.includes('-->')){
    const blocks=text.replace(/\r/g,'').split(/\n\s*\n/);const out=[];
    for(const b of blocks){const lines=b.split('\n').filter(l=>l.trim());if(!lines.length)continue;
      const mi=lines.findIndex(l=>l.includes('-->'));if(mi<0)continue;
      const parts=lines[mi].split('-->');const sec=x=>{const m=x.trim().replace(',','.').split(':').map(Number);return m.length===3?m[0]*3600+m[1]*60+m[2]:m[0]*60+m[1];};
      const start=sec(parts[0]),end=parts[1]?sec(parts[1]):start+3;
      out.push({start,end,text:lines.slice(mi+1).join(' ').slice(0,200)});}
    return out;
  }
  const out=[];
  for(const line of text.split('\n')){const t=line.trim();if(!t)continue;
    const m=t.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.+)$/);
    if(m)out.push({start:Number(m[1]),end:Number(m[2]),text:m[3].slice(0,200)});
    else{const i=out.length;out.push({start:i*3,end:i*3+3,text:t.slice(0,200)});}}
  return out;
}
function download(name,text) {const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// ---------- 目录编排（章节↔剧集灵活重排）----------
let orgPlan=null;
function structureOrganizerHtml(p){
  const flat=p.episodes.flatMap(e=>e.chapters);
  orgPlan=p.episodes.map((e,ei)=>({title:e.title,ids:e.chapters.map(c=>c.id)}));
  return `<h2>目录编排</h2><p class="hint">拖动章节卡片调整顺序或拖入其他剧集分组；映射不必一章对一集。保存后按此结构重建剧集与章节。</p>
  <div id="org-board" style="display:flex;gap:14px;flex-wrap:wrap;margin:14px 0">${orgPlan.map((g,gi)=>`<div class="org-group" data-org-group="${gi}" style="min-width:220px;flex:1;border:1px dashed var(--line);border-radius:10px;padding:12px"><b>${esc(g.title)}</b><small class="hint">第 ${gi+1} 集</small><div class="org-list" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${g.ids.map(id=>{const c=flat.find(x=>x.id===id);return `<div class="org-chip" draggable="true" data-org-chip="${id}" style="border:1px solid var(--line);background:#202820;border-radius:8px;padding:8px 10px;cursor:grab"><span>${esc(c?.title||id.slice(0,8))}</span><button class="small ghost" data-action="org-remove-chip" data-chip="${id}" title="删除该章节" style="margin-left:8px;padding:0 6px">×</button></div>`;}).join('')}</div></div>`).join('')}</div>
  <div class="actions"><button class="ghost small" data-action="org-add-group">＋ 新增剧集分组</button><button class="ghost small" data-action="org-merge-visible">合并为单集连播</button><span style="flex:1"></span><button class="primary" data-action="org-apply">保存编排</button></div>
  <p class="hint">「合并为单集连播」把全部章节并入一个剧集；也可以在「章节管理」里用合并 / 拆分处理章节内部结构。</p>`;
}
function wireOrganizer(p){
  const board=document.getElementById('org-board');if(!board)return;
  let dragging=null;
  board.addEventListener('dragstart',e=>{const chip=e.target.closest('[data-org-chip]');if(!chip)return;dragging=chip.dataset.orgChip;chip.style.opacity='.4';});
  board.addEventListener('dragend',e=>{const chip=e.target.closest('[data-org-chip]');if(chip)chip.style.opacity='';});
  board.addEventListener('dragover',e=>{const list=e.target.closest('.org-list');if(list){e.preventDefault();list.style.outline='2px solid var(--accent)';}});
  board.addEventListener('dragleave',e=>{const list=e.target.closest('.org-list');if(list)list.style.outline='';});
  board.addEventListener('drop',e=>{
    const list=e.target.closest('.org-list');if(!list||!dragging)return;e.preventDefault();list.style.outline='';
    const chip=list.querySelector(`[data-org-chip="${dragging}"]`);
    if(chip&&chip.parentElement!==list)list.appendChild(chip);
    else if(chip){const after=[...list.querySelectorAll('[data-org-chip]')].find(x=>x!==chip&&x.getBoundingClientRect().top>e.clientY);list.insertBefore(chip,after||null);}
    dragging=null;
  });
  board.addEventListener('click',async e=>{
    const act=e.target.closest('[data-action]')?.dataset.action;
    if(act==='org-remove-chip'){const chip=e.target.closest('[data-org-chip]');if(chip)chip.remove();return;}
    if(act==='org-add-group'){const gi=orgPlan.length;orgPlan.push({title:`第 ${gi+1} 集`,ids:[]});board.insertAdjacentHTML('beforeend',`<div class="org-group" data-org-group="${gi}" style="min-width:220px;flex:1;border:1px dashed var(--line);border-radius:10px;padding:12px"><b>第 ${gi+1} 集</b><small class="hint">新分组</small><div class="org-list" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"></div></div>`);}
  });
}
async function applyOrganizer(p){
  const board=document.getElementById('org-board');if(!board)throw new Error('编排面板未打开');
  const groups=[...board.querySelectorAll('.org-group')].filter(g=>g.querySelector('[data-org-chip]'));
  const order=groups.map(g=>[...g.querySelectorAll('[data-org-chip]')].map(x=>x.dataset.orgChip));
  const flatCount=p.episodes.flatMap(e=>e.chapters).length;
  const total=order.reduce((a,b)=>a+b.length,0);
  if(total!==flatCount)throw new Error(`有 ${flatCount-total} 个章节未放入任何剧集`);
  await api('/api/projects/'+projectId+'/structure','POST',{revision:p.revision,action:'chapter-reorder',order});
}
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;el.disabled=true;try{await handle(el.dataset.action,el);}catch(err){toast(err.message);}finally{el.disabled=false;}});
let sbDrag=null;
let tlDrag=null;
document.addEventListener('dragstart',e=>{const el=e.target.closest&&e.target.closest('[data-tl-block],[data-tl-clip]');if(el){tlDrag=el.dataset.tlBlock??el.dataset.tlClip;el.classList.add('sb-dragging');e.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragover',e=>{
  if(tlDrag===null||sbDrag!==null)return;
  const el=e.target.closest&&e.target.closest('[data-tl-block],[data-tl-clip]');
  if(el){e.preventDefault();document.querySelectorAll('.tl-over').forEach(x=>x.classList.remove('tl-over'));el.classList.add('tl-over');}
});
document.addEventListener('drop',async e=>{
  if(tlDrag===null||sbDrag!==null)return;
  const el=e.target.closest&&e.target.closest('[data-tl-block],[data-tl-clip]');
  if(!el)return;e.preventDefault();
  const to=Number(el.dataset.tlBlock??el.dataset.tlClip),from=Number(tlDrag);
  if(from===to)return;
  const p=project();if(!p.timeline[to])return;
  const item=p.timeline.splice(from,1)[0];
  p.timeline.splice(to,0,item);
  dirty=true;render();toast(`片段 ${from+1} 已移动到位置 ${to+1}，保存剪辑后生效`);
});
document.addEventListener('dragend',e=>{document.querySelectorAll('.tl-over').forEach(x=>x.classList.remove('tl-over'));tlDrag=null;});

document.addEventListener('dragstart',e=>{if(e.target.closest&&e.target.closest('select,input,textarea,button,video'))return;const card=e.target.closest&&e.target.closest('[data-sb-shot]');if(card){sbDrag=card.dataset.sbShot;card.classList.add('sb-dragging');e.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragend',e=>{document.querySelectorAll('.sb-dragging,.sb-over').forEach(x=>x.classList.remove('sb-dragging','sb-over'));sbDrag=null;});
document.addEventListener('dragover',e=>{
  if(!sbDrag)return;e.preventDefault();e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.sb-card.sb-over,.sb-scene.sb-over').forEach(x=>x.classList.remove('sb-over'));
  const card=e.target.closest&&e.target.closest('[data-sb-shot]');
  if(card&&card.dataset.sbShot!==sbDrag)card.classList.add('sb-over');
  else{const zone=e.target.closest&&e.target.closest('[data-sb-scene]');if(zone&&![...zone.querySelectorAll('[data-sb-shot]')].some(x=>x.dataset.sbShot===sbDrag))zone.classList.add('sb-over');}
});
document.addEventListener('drop',e=>{
  if(!sbDrag)return;e.preventDefault();
  const card=e.target.closest&&e.target.closest('[data-sb-shot]');
  if(card&&card.dataset.sbShot!==sbDrag){
    const [fi,fj]=sbDrag.split('.').map(Number),[ti,tj]=card.dataset.sbShot.split('.').map(Number);
    const rect=card.getBoundingClientRect(),before=(e.clientY<rect.top+rect.height/2)||(fi===ti&&fj<tj);
    moveStoryboardShot(sbDrag,ti+'.'+(before?tj:tj+1),project());dirty=true;render();toast(`镜头 ${fi+1}.${fj+1} 已移动`);
    return;
  }
  const zone=e.target.closest&&e.target.closest('[data-sb-scene]');
  if(zone&&Number(zone.dataset.sbScene)!==Number(sbDrag.split('.')[0])){moveStoryboardShot(sbDrag,Number(zone.dataset.sbScene)+':end',project());dirty=true;render();toast('镜头已移动到场景 '+(Number(zone.dataset.sbScene)+1)+' 末尾');}
});
document.addEventListener('input',e=>{if(e.target.id==='secret-search'){secretSearch=e.target.value;renderSecretList();}if(e.target.dataset.voiceText!==undefined)voiceDrafts.set(e.target.dataset.voiceText,e.target.value);if(e.target.matches('[data-deploy-config]'))deploymentDirty=true;if(e.target.closest('#app')&&e.target.id!=='project-select'&&!e.target.matches('[data-transient],[data-editor-nav]')&&e.target.type!=='file'&&!e.target.matches('[data-shot-pick]')&&!e.target.matches('[data-deploy-config]')){dirty=true;const status=$('.form-status');if(status)status.textContent='有未保存修改';if(page==='models'){const ha=$('.heading-actions');if(ha&&!ha.querySelector('[data-action="save-settings"]'))ha.insertAdjacentHTML('afterbegin',button('保存设置','save-settings','primary'));}}});
document.addEventListener('change',async e=>{
  try {
    if(e.target.dataset.characterImport){if(dirty)throw new Error('请先保存角色');const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('参考图不能超过 20MB');const r=await fetch('/api/assets?'+new URLSearchParams({projectId,characterId:e.target.dataset.characterImport,name:file.name,kind:'image'}),{method:'POST',headers:{'X-Workspace-Token':state.token},body:file});const result=await r.json();if(!r.ok)throw new Error(result.error);e.target.value='';await refresh();toast('参考图已导入，请在角色卡片中选为参考');return;}
    if(e.target.id==='chapter-select'){if(dirty){e.target.value=project().activeChapterId;throw new Error('请先保存当前章节');}await api('/api/projects/'+projectId+'/structure','POST',{revision:project().revision,action:'switch',id:e.target.value});await refresh();return;}
    if(e.target.id==='creation-import'){const file=e.target.files[0];if(!file)return;if(dirty)throw new Error('请先保存当前草稿再导入');if(file.size>1024*1024)throw new Error('文件不能超过 1MB');const value=await api('/api/import-document','POST',{stage:page,text:await file.text(),format:file.name.toLowerCase().endsWith('.json')?'json':'text'});replaceDraft(value,project());dirty=true;toast('已导入预览，请检查后保存');return;}
    if(e.target.id==='stage-image-provider'){const base=document.getElementById('stage-image-base');if(e.target.value==='automatic1111')base.value='http://127.0.0.1:7860';else if(e.target.value==='agnes')base.value='https://api.agnes.ai/v1';return;}
    if(e.target.id==='secret-sort'){secretSort=e.target.value;renderSecretList();return;}
    if(e.target.matches('[data-scheme]')){const id=e.target.value;if(!id){localStorage.removeItem('modelScheme:'+projectId);return;}e.target.value='';localStorage.setItem('modelScheme:'+projectId,id);await applySchemeById(id);return;}
    if(e.target.matches('[data-stage-role]')){const role=e.target.dataset.stageRole;const s=structuredClone(state.settings);s.text.roles[role].profileId=e.target.value;
      try{await api('/api/settings','PUT',s);await refresh();toast('已切换'+(role==='outline'?'大纲':role==='script'?'剧本':'审校')+'模型，立即生效');}catch(err){e.target.value=state.settings.text.roles[role].profileId;throw err;}return;}
    if(e.target.id==='stage-video-model'){const id=e.target.value;if(!id)return;e.target.value='';const s=structuredClone(state.settings);s.video=/^(seedance|kling|veo|agnes|zhipu)$/.test(id)?await api('/api/cloud-presets/'+id):await api('/api/video-presets/'+id);if(s.video.provider==='comfy')s.video.baseUrl=state.deploymentConfig.comfyUrl||s.video.baseUrl;
      try{await api('/api/settings','PUT',s);await refresh();toast('已切换视频模型：'+(s.video.model||s.video.provider)+'，立即生效');}catch(err){throw err;}return;}
    if(e.target.matches('[data-compare]')){const n=comparePick(e.target.dataset.compare,e.target.checked);if(n>2){comparePick(e.target.dataset.compare,false);e.target.checked=false;toast('最多选择两个版本进行 A/B 对比');return;}render();return;}
    if(e.target.matches('[data-shot-pick]')){e.target.checked?pickedShots.add(e.target.dataset.shotPick):pickedShots.delete(e.target.dataset.shotPick);} if(e.target.matches('[data-route], [data-override]')) {state.settings=readSettings();dirty=true;render();}
    if(e.target.id==='asset-project-filter'){assetProject=e.target.value;render();return;}
    if(e.target.id==='project-select'){if(dirty){e.target.value=projectId;throw new Error('请先保存当前修改');}projectId=e.target.value;localStorage.setItem('projectId',projectId);editor=false;render();}
    if(e.target.id==='workflow-file'){const file=e.target.files[0];if(!file)return;const graph=JSON.parse(await file.text());if(graph.nodes)throw new Error('这是界面工作流，请从 ComfyUI 导出 API 格式');$('#workflow').value=JSON.stringify(graph,null,2);dirty=true;toast('已导入，请配置参数绑定后保存');}
    if(e.target.dataset.sbFrame){if(dirty)throw new Error('画布上有未保存修改，请先保存稿件再设置首尾帧');const si=Number(e.target.dataset.scene),sj=Number(e.target.dataset.shot),kind=e.target.dataset.sbFrame,v=e.target.value;await saveProject(v?{[kind==='first'?'__firstFrame':'__lastFrame']:{scene:si,shot:sj,assetId:v}}:{[kind==='first'?'__clearFirstFrame':'__clearLastFrame']:{scene:si,shot:sj}});toast(kind==='first'?(v?'首帧已保存':'已清除首帧'):(v?'尾帧已保存':'已清除尾帧'));return;}
    if(e.target.id==='shot-first-frame'){if(dirty)throw new Error('请先保存当前修改');const key=videoKey,si=Number(key.split('-')[0]),i=Number(key.split('-')[1]||0);await saveProject(e.target.value?{__firstFrame:{scene:si,shot:i,assetId:e.target.value}}:{__clearFirstFrame:{scene:si,shot:i}});toast(e.target.value?'首帧已保存，生成时将作为视频第一帧':'已清除首帧');return;}
    if(e.target.id==='shot-last-frame'){if(dirty)throw new Error('请先保存当前修改');const key=videoKey,si=Number(key.split('-')[0]),i=Number(key.split('-')[1]||0);await saveProject(e.target.value?{__lastFrame:{scene:si,shot:i,assetId:e.target.value}}:{__clearLastFrame:{scene:si,shot:i}});toast(e.target.value?'尾帧已保存，生成时将作为视频最后一帧':'已清除尾帧');return;}
    if(e.target.id==='export-preset'){if(dirty)throw new Error('请先保存当前修改');await saveProject({exportPreset:e.target.value});toast('导出档位已保存');return;}
    if(e.target.id==='video-provider'){ $('#video-url').value=e.target.value==='comfy'?'http://127.0.0.1:8188':'https://api.minimax.io/v1';$('#video-model').value=e.target.value==='comfy'?'自定义视频工作流':'MiniMax-Hailuo-2.3';$('#video-key').value=e.target.value==='comfy'?'':'MINIMAX_API_KEY';dirty=true;}
    if(e.target.id==='upload'||e.target.id==='audio-import'){if(dirty)throw new Error('请先保存当前修改');const file=e.target.files[0];if(!file)return;if(file.size>512*1024*1024)throw new Error('素材不能超过 512MB');toast('正在导入并分析视频…');const r=await fetch(`/api/assets?${new URLSearchParams({projectId,name:file.name,kind:e.target.id==='audio-import'?'audio':'video'})}`,{method:'POST',headers:{'X-Workspace-Token':state.token},body:file});const result=await r.json();if(!r.ok)throw new Error(result.error);await refresh();toast('素材已导入');}
  }catch(err){toast(err.message);}
});
$('#close-modal').onclick=()=>$('#modal').close();
window.addEventListener('beforeunload',e=>{if(dirty||deploymentDirty){e.preventDefault();e.returnValue='';}});
const coachCtx={
 api,toast,
 get state(){return state},
 projectId:()=>projectId,page:()=>page,
 refresh:async()=>await refresh(),
 showPage(target){if(![...stages,'models','jobs','projects','assets'].includes(target))return false;if(dirty||deploymentDirty){toast('请先保存修改，再切换页面');return false;}page=target;editor=false;render();return true;},
 setSettingsTab(id){settingsTab=id;render();},
 async createProject(name){name=String(name||'').trim();if(!name)throw new Error('请提供项目名称');if(dirty)throw new Error('请先保存当前修改，再创建项目');const p=await api('/api/projects','POST',{name:name.slice(0,100)});projectId=p.id;localStorage.setItem('projectId',projectId);page='outline';await refresh();return p;},
 async openProject(name){name=String(name||'').trim();if(dirty)throw new Error('请先保存当前修改，再切换项目');const p=state.projects.find(x=>x.name===name)||(name.length>=2&&state.projects.find(x=>x.name.includes(name)));if(!p)throw new Error('没有找到名为「'+name+'」的项目');projectId=p.id;localStorage.setItem('projectId',projectId);page='outline';editor=false;await refresh();return p;},
 openCanvas(){if(!canvasActive()){toggleCanvas();render();}}
};
async function openWorkspace(){const started=performance.now();try{await refresh();await new Promise(resolve=>setTimeout(resolve,Math.max(0,1800-(performance.now()-started))));$('#app').hidden=false;coachBoot(state,coachCtx);const welcome=$('#welcome-screen');welcome.classList.add('welcome-leaving');await new Promise(resolve=>setTimeout(resolve,300));welcome.remove();}catch(error){$('#welcome-status').textContent=error.message;$('#welcome-screen').classList.add('welcome-failed');$('#welcome-retry').hidden=false;}}
$('#welcome-retry').onclick=()=>location.reload();
// AI 伴写悬浮入口：聚焦可伴写字段（大纲/剧本/分镜画布的文本框）时出现在旁侧
const assistTargets='textarea[data-doc-path]';
document.addEventListener('focusin',e=>{
  const t=e.target.closest&&e.target.closest(assistTargets);
  const fl=$('#assist-float');
  if(!t||!['outline','script'].includes(page)){
    // 焦点在弹层自身控件内、或弹层仍打开时，不隐藏按钮（滚动同步会持续保持锚定）
    const inAssistUI=e.target.closest&&e.target.closest('#assist-pop,#assist-float');
    if(fl&&!inAssistUI&&!assistPopOpen)fl.hidden=true;
    return;
  }
  if(t!==assistField&&assistPopSuspended)hideAssistPop();
  assistField=t;window.__af=t;
  fl.hidden=false;
  positionAssistFloat();
});
// 悬浮按钮与弹层跟随字段滚动：页面滚动、容器滚动、窗口尺寸变化时重新定位
function positionAssistFloat(){
  const fl=$('#assist-float');if(!fl)return;
  const t=assistField;if(!t||!t.isConnected){fl.hidden=true;return;}
  const pop=$('#assist-pop');
  // 仅当字段仍在焦点内、或伴写弹层仍打开时显示；失焦/关闭后滚动不应复现按钮
  const focusInField=t===document.activeElement||t.contains(document.activeElement);
  const popOpen=assistPopOpen;
  if(!focusInField&&!popOpen){fl.hidden=true;return;}
  const r=t.getBoundingClientRect();
  // 字段已滚出视口 → 隐藏按钮与弹层
  if(r.bottom<40||r.top>innerHeight-8){
    // 字段滚出视口：弹层打开时先挂起（保留输入内容），滚回后原样恢复，而不是直接销毁
    if(pop&&!pop.hidden&&assistPopOpen)assistPopSuspended=true;
    fl.hidden=true;if(pop)pop.hidden=true;return;
  }
  // 字段在视口内 → 确保显示并贴回字段旁（即使此前因滚出被隐藏）
  fl.hidden=false;
  // 字段回到视口：恢复被挂起的弹层（含未发送的输入内容）
  if(assistPopSuspended){assistPopSuspended=false;if(pop&&assistPopOpen)pop.hidden=false;}
  // fixed 定位：直接用视口坐标；底部放不下时贴到字段上方；左右钳制在视口内
  const fh=fl.offsetHeight||34,fw=fl.offsetWidth||110;
  let top=r.bottom+8;if(top+fh>innerHeight-8)top=Math.max(8,r.top-fh-8);
  fl.style.top=top+'px';
  fl.style.left=Math.min(Math.max(r.left,10),Math.max(10,innerWidth-fw-10))+'px';
  if(pop&&!pop.hidden)positionAssistPop();
}

function scheduleAssistSync(){positionAssistFloat();}

window.addEventListener('resize',scheduleAssistSync,{passive:true});
document.addEventListener('scroll',e=>{if(e.target&&e.target.closest&&e.target.closest('#assist-pop'))return;scheduleAssistSync();},{capture:true,passive:true});

document.addEventListener('focusout',()=>{setTimeout(()=>{if(assistPopOpen)return;const fl=$('#assist-float');if(!fl||fl.contains(document.activeElement)||$('#assist-pop').contains(document.activeElement))return;if(assistField&&document.activeElement===assistField)return;fl.hidden=true;},200);});
document.body.insertAdjacentHTML('beforeend',`<div id="assist-float" hidden><button class="primary small" id="assist-float-btn" type="button">✧ AI 伴写</button></div><div id="assist-pop" hidden><label>模型<div class="assist-model-checks" id="assist-pop-models"></div></label><label>写作方式<select id="assist-pop-mode" data-transient><option>续写</option><option>润色</option><option>扩写</option><option>重新构思</option><option>拆解分镜</option></select></label><label>你的要求<textarea id="assist-pop-text" data-transient></textarea></label><div class="actions">${'<button class="primary small" data-action="assist-float-generate">生成候选</button>'}${'<button class="small ghost" data-action="assist-float-close">收起</button>'}</div><p class="hint">候选生成后在「伴写候选」或任务记录中预览应用。</p></div>`);
let assistField=null,assistPopOpen=false,assistPopSuspended=false;
function hideAssistPop(){assistPopOpen=false;assistPopSuspended=false;const pop=$('#assist-pop');if(pop)pop.hidden=true;}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){const pop=$('#assist-pop');if(pop&&!pop.hidden||assistPopSuspended){hideAssistPop();return;}}
  if(e.key==='Enter'&&e.target&&e.target.id==='assist-float-btn'){e.preventDefault();openAssistPop();}
});
document.addEventListener('click',e=>{
  const tab=e.target.closest('.models-sub-tabs .sub-tab');
  if(!tab)return;
  modelsSubTab=tab.dataset.id;
  document.querySelectorAll('.models-sub-pane').forEach(p=>p.hidden=p.dataset.sub!==modelsSubTab);
  document.querySelectorAll('.models-sub-tabs .sub-tab').forEach(x=>x.classList.toggle('active',x===tab));
});
let secretSearch='',secretSort='time-desc',secretEdit=null;
function secretMissing(){
  const have=new Set(state.secrets.map(x=>x.name));
  const need=new Set();
  for(const p of state.settings.text.profiles)if(p.keyEnv)need.add(p.keyEnv);
  for(const k of ['keyEnv','secretEnv'])if(state.settings.video[k])need.add(state.settings.video[k]);
  if(state.settings.image.keyEnv)need.add(state.settings.image.keyEnv);
  if(state.settings.speech.keyEnv&&state.settings.speech.provider!=='piper')need.add(state.settings.speech.keyEnv);
  return [...need].filter(n=>!have.has(n));
}
async function renderSecretUI(){
  const latest=await api('/api/state');state.secrets=latest.secrets;
  const missing=secretMissing();
  const banner=document.getElementById('secret-missing');
  if(banner){if(missing.length){banner.hidden=false;banner.textContent='⚠ 有 '+missing.length+' 个引用密钥尚未录入，在下方各行粘贴 KEY 后，点「加密保存密钥」一次保存：';}else banner.hidden=true;}
  const pending=document.getElementById('secret-pending');if(pending)pending.innerHTML=secretPendingHtml(missing);
  renderSecretList();
}
function renderSecretList(){
  const usage=secretUsage(state);
  const {rows,shown,total}=secretRowsHtml(state,usage,secretSearch,secretSort,secretEdit);
  const host=document.getElementById('secret-rows');if(host)host.innerHTML=rows;
  const cnt=document.getElementById('secret-count');if(cnt)cnt.textContent=`显示 ${shown} / 共 ${total} 个密钥`;
}
function updateSecretBanner(){renderSecretUI();}
function openAssistPop(){
  const pop=$('#assist-pop'),fl=$('#assist-float');
  const path=assistField?.dataset.docPath||'';
  const label={title:'标题',summary:'内容概要',action:'动作与叙述',dialogue:'对白',prompt:'镜头提示词',logline:'一句话故事'}[path.split('.').pop()]||'当前字段';
  // 先填充内容再测量定位（填充会改变高度）；最后统一钳制，保证任何窗口尺寸下四边不出屏
  const checks=document.getElementById('assist-pop-models');
  if(checks&&!checks.hasChildNodes()){
    const profiles=state.settings?.text?.profiles||[];
    checks.innerHTML=profiles.length?profiles.map(pr=>'<label class="assist-model-check"><input type="checkbox" value="'+esc(pr.id)+'" checked> '+esc(pr.name)+' &middot; '+esc(pr.model)+'</label>').join(''):'<span class="hint">尚未配置文本模型，请先到设置中心添加。</span>';
  }
  $('#assist-pop-text').value=`请针对「${label}」${$('#assist-pop-mode').value}：`;
  pop.hidden=false;assistPopOpen=true;assistPopSuspended=false;
  positionAssistPop();
}
// 弹层跟随：以悬浮按钮为锚点重新定位（打开与滚动同步共用同一套钳制）
function positionAssistPop(){
  const pop=$('#assist-pop'),fl=$('#assist-float');
  if(!pop||pop.hidden)return;
  // 先清除高度约束测自然高度；再按按钮上下空间选边：能放下就放，
  // 放不下就限制高度紧贴按钮（内部滚动），保证弹层始终出现在按钮旁而不是被钳到视口角落
  pop.style.maxHeight='';pop.style.overflowY='';
  // 锚点取按钮可视矩形；按钮不可见时回退到字段矩形，避免拿到全零矩形把弹层放到视口角落
  let br=fl.getBoundingClientRect();
  if(fl.hidden||(!br.width&&!br.height)){const f=assistField&&assistField.getBoundingClientRect?assistField.getBoundingClientRect():null;if(f)br=f;else br={top:innerHeight/2,bottom:innerHeight/2,left:innerWidth/2};}
  const popH=pop.getBoundingClientRect().height||Math.min(400,innerHeight*.6);
  const roomBelow=innerHeight-8-(br.bottom+10);
  const roomAbove=(br.top-10)-8;
  let top,room;
  if(roomBelow>=popH){top=br.bottom+10;room=roomBelow;}
  else if(roomAbove>=popH){top=br.top-popH-10;room=roomAbove;}
  else if(roomBelow>=roomAbove){top=br.bottom+10;room=roomBelow;}
  else{room=roomAbove;top=Math.max(8,br.top-10-Math.min(popH,room));}
  if(room<popH){pop.style.maxHeight=Math.max(80,room)+'px';pop.style.overflowY='auto';}
  pop.style.top=Math.max(8,top)+'px';
  const pr=pop.getBoundingClientRect();
  let left=br.left;if(left+pr.width>innerWidth-10)left=innerWidth-pr.width-10;if(left<10)left=10;
  pop.style.left=left+'px';
  // 兜底：极端窗口下只收缩高度，不移动起点（避免弹层跳到视口边缘）
  const box=pop.getBoundingClientRect();
  if(box.bottom>innerHeight-4&&box.top>4)pop.style.maxHeight=Math.max(60,innerHeight-8-box.top)+'px';
  if(pop.scrollHeight>pop.offsetHeight+2)pop.style.overflowY='auto';
}
// mousedown + preventDefault：避免按钮抢走文本框焦点引发的隐藏竞态
document.addEventListener('mousedown',e=>{
  if(e.target.closest&&e.target.closest('#assist-float button')){e.preventDefault();openAssistPop();requestAnimationFrame(positionAssistPop);return;}
  if(e.target.closest&&e.target.closest('#assist-pop'))return;
  if(assistField&&e.target===assistField)return;
  hideAssistPop();
  {const fl=$('#assist-float');if(fl&&!fl.contains(e.target))fl.hidden=true;}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target&&e.target.id==='assist-float-btn'){e.preventDefault();openAssistPop();}
});
try{coachBoot(state,coachCtx);}catch(e){console.warn('coach boot failed',e);}
await openWorkspace();
setInterval(async()=>{if(!state)return;try{const next=await api('/api/state');const coachSig=js=>js.map(j=>j.kind==='coach'?j.id+j.status+(j.progress?.message||''):'').join();if(coachSig(next.jobs)!==coachSig(state.jobs)&&!$('#modal').open){state=next;coachRender(state);if(!dirty)render();return;}if(page==='models'){const added=next.settings.text.profiles.some(p=>!state.settings.text.profiles.some(x=>x.id===p.id));if(added&&!dirty&&!deploymentDirty&&!document.activeElement?.matches('input,textarea,select')){state=next;render();return;}for(const key of ['deployments','runtimes'])state[key]=next[key];if($('#deployment-progress'))$('#deployment-progress').innerHTML=deploymentProgress(next);if($('#runtime-status'))$('#runtime-status').innerHTML=runtimeStatus(next);return;}if(page==='video'&&$('#shot-task-progress'))$('#shot-task-progress').innerHTML=shotProgress(project(),next,videoKey);if(!dirty&&!$('#modal').open&&next.jobs.map(j=>j.status+(page==='jobs'?j.progress?.message||'':'')).join()!==state.jobs.map(j=>j.status+(page==='jobs'?j.progress?.message||'':'')).join()){state=next;render();}}catch{/* Keep drafts during temporary disconnects. */}},2500);
