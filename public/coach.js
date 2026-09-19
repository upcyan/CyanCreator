// 创作助手：可收起的右侧对话侧边栏。引导模式提供预设对话、代为操作与聚光引导；老手模式仅保留答疑对话。
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PAGE_NAMES={outline:'故事大纲',script:'剧本与分镜',video:'视频生成',edit:'后期剪辑',models:'设置中心',jobs:'任务记录',projects:'项目管理',assets:'素材库'};
const TAB_NAMES={text:'文本模型',video:'视频模型',image:'角色图像',speech:'语音配音',local:'本地部署',security:'密钥管理',updates:'平台更新'};
// 高亮 / 填写目标目录（key 与服务端 lib/coach.js 保持一致；选择器可超出服务端目录）
const TARGETS={
 'nav-outline':'.nav [data-page="outline"]','nav-script':'.nav [data-page="script"]','nav-video':'.nav [data-page="video"]','nav-edit':'.nav [data-page="edit"]',
 'nav-models':'.nav [data-page="models"]','nav-jobs':'.nav [data-page="jobs"]','nav-assets':'.nav [data-page="assets"]',
 'steps':'.steps','project-select':'#project-select','new-project':'[data-action="new-project"]','project-name':'#new-name',
 'tab-text':'[data-action="settings-tab"][data-id="text"]','tab-video':'[data-action="settings-tab"][data-id="video"]','tab-image':'[data-action="settings-tab"][data-id="image"]',
 'tab-speech':'[data-action="settings-tab"][data-id="speech"]','tab-local':'[data-action="settings-tab"][data-id="local"]','tab-security':'[data-action="settings-tab"][data-id="security"]','tab-updates':'[data-action="settings-tab"][data-id="updates"]',
 'settings-save':'[data-action="save-settings"]','text-profile-base':'input[data-profile][data-field="baseUrl"]','text-profile-model':'input[data-profile][data-field="model"]',
 'text-profile-key':'input[data-profile][data-field="keyEnv"]','text-probe':'[data-action="probe"]',
 'secret-name':'#secret-name','secret-value':'#secret-value','secret-save':'[data-action="secret-save"]','agnes-apply':'[data-action="agnes-apply"]',
 'brief':'#brief','bible':'#bible','save-brief':'[data-action="save-brief"]','chapter-select':'#chapter-select',
 'outline-add':'[data-action="creation-add"]','creation-save':'[data-action="creation-save"]','creation-import':'#creation-import',
 'assist-mode':'#assist-mode','assist-instruction':'#assist-instruction','creation-assist':'[data-action="creation-assist"]',
 'review-run':'[data-action="generate"][data-kind="review"]','video-generate':'[data-action="video-generate"]','video-save':'[data-action="video-save"]',
 'video-batch':'[data-action="video-batch"]','shot-prompt':'#shot-prompt','shot-duration':'#shot-duration',
 'add-clip':'[data-action="add-clip"]','timeline':'.timeline-strip','save-timeline':'[data-action="save-timeline"]',
 'export-preset':'#export-preset','export-run':'[data-action="generate"][data-kind="export"]','subtitle-input':'#subtitle-input','upload':'#upload'
};
const FILL_SELECTORS={'text-base-url':'input[data-profile][data-field="baseUrl"]','text-model':'input[data-profile][data-field="model"]','brief':'#brief'};
const FILL_LABELS={'text-base-url':'文本模型服务地址','text-model':'文本模型名称','brief':'创作简报','project-name':'项目名称'};
const PRESETS={
 guide:[{text:'带我熟悉工作台',tour:'workbench'},{text:'如何配置文本模型？',tour:'text-model'},{text:'帮我创建第一个项目',tour:'first-story'},{text:'怎么从分镜到成片？',tour:'make-video'}],
 expert:['大纲和剧本模型有什么区别？','原生 Wan 和 ComfyUI 方案怎么选？','导出成片支持哪些档位？','密钥保险库是如何加密的？']};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ctx=null,mounted=false,onboardingBusy=false,waitCleanup=null,waitTimer=null,spotRaf=0,logSig='';
const executedActions=new Set();
let tour=null,spot=null;const notes=[];
const coach={open:false,mode:localStorage.getItem('coach:mode')==='expert'?'expert':'guide',draft:'',wizard:false,welcome:false};
const TOURS={
 workbench:{title:'认识工作台',steps:[
  {target:'nav-outline',title:'创作主线',body:'左侧是创作主线：故事大纲 → 剧本与分镜 → 视频生成 → 后期剪辑，按顺序推进。下方还有设置中心、任务记录与素材库。'},
  {page:'outline',target:'steps',title:'阶段进度条',body:'顶部是当前项目的四个阶段，可随时跳转；切换章节后进度按章节独立记录。'},
  {target:'new-project',title:'项目',body:'所有创作都保存在「项目」里。右上角「＋ 新建」创建项目，左侧选择器随时切换。'},
  {page:'models',target:'tab-text',title:'设置中心',body:'模型接入集中在这里：文本、视频、图像、语音、本地部署与密钥管理。'},
  {target:'nav-jobs',title:'任务记录',body:'生成、导出与部署任务都在这里显示真实状态与耗时。'},
  {target:'nav-assets',title:'素材库',body:'生成的视频、音频、图像集中管理，可查看引用关系与磁盘占用。'}]},
 'text-model':{title:'连接文本模型',steps:[
  {page:'models',target:'tab-text',title:'文本模型',body:'大纲、剧本与一致性审校共用这里的连接配置。若使用 Agnes 多模态服务，页面顶部的「一键配置」可以同时配好文本、图像与视频。'},
  {tab:'text',target:'text-profile-base',title:'服务地址',body:'填 OpenAI 兼容接口地址：LM Studio 默认 http://127.0.0.1:1234/v1；Ollama 为 http://127.0.0.1:11434/v1；云端服务用官方地址。',wait:{input:'input[data-profile][data-field="baseUrl"]'}},
  {tab:'text',target:'text-profile-model',title:'模型名称',body:'填服务端已加载的模型 ID，需与模型列表一致。',wait:{input:'input[data-profile][data-field="model"]'}},
  {tab:'text',target:'text-probe',title:'测试连接',body:'保存前先测试连通性。',wait:{click:'[data-action="probe"]'}},
  {tab:'text',target:'settings-save',title:'保存',body:'保存后所有创作阶段立即使用新配置。',wait:{click:'[data-action="save-settings"]'}}]},
 'video-model':{title:'配置视频模型',steps:[
  {page:'models',target:'agnes-apply',title:'多模态最快路径',body:'设置中心顶部的「一键配置 Agnes」会同时配好文本、图像与视频，适合想一步到位的用户；只想配置视频环节时忽略它，看下一步。'},
  {page:'models',tab:'video',target:'tab-video',title:'仅配置视频',body:'先选后端：云端模板（Seedance / 可灵 / Veo / MiniMax）或本地部署（原生 Wan / ComfyUI）。'},
  {tab:'video',target:'settings-save',title:'保存并录密钥',body:'保存配置后，到「密钥管理」录入引用名对应的密钥。'}]},
 'first-story':{title:'创建第一个项目',steps:[
  {target:'new-project',title:'新建项目',body:'点击右上角「＋ 新建」。',wait:{click:'[data-action="new-project"]'}},
  {target:'project-name',title:'项目名称',body:'给故事起个名字，然后点击「创建项目」。',wait:{click:'[data-action="create-project"]'}},
  {page:'outline',target:'brief',title:'创作简报',body:'展开「项目简报与共享设定」，用一两句话写下题材、主角与想讲的故事。'},
  {target:'save-brief',title:'保存设定',body:'保存简报后，就可以生成或撰写大纲了。',wait:{click:'[data-action="save-brief"]'}}]},
 'make-video':{title:'从分镜到成片',steps:[
  {page:'script',target:'creation-assist',title:'剧本与分镜',body:'剧本页先保存稿件，再用 AI 伴写生成候选稿或拆解分镜（需要已有剧本）。'},
  {page:'video',target:'video-generate',title:'生成镜头',body:'视频页选中镜头，调整提示词与参数后「保存并生成」；先在剧本页完成分镜。'},
  {page:'jobs',target:'nav-jobs',title:'任务进度',body:'任务记录显示排队、执行与耗时；生成完成后回到视频页选片。'},
  {page:'edit',target:'export-run',title:'剪辑与导出',body:'把满意的镜头加入时间线，调整顺序、入出点与音量，最后导出成片。'}]}};
const WIZARD=[
 {id:'workbench',label:'认识工作台布局',hint:'一分钟的界面导览',run:()=>runTour('workbench'),done:s=>localStorage.getItem('coach:tour-workbench')==='1'},
 {id:'text',label:'连接文本模型',hint:'大纲与剧本共用的本地或云端服务',run:()=>runTour('text-model'),done:s=>s.settings.text.profiles.some(p=>p.baseUrl&&p.model)},
 {id:'video',label:'配置视频模型（可选）',hint:'云端模板一键接入，或本地部署 Wan',optional:true,run:()=>runTour('video-model'),done:s=>videoReady(s)},
 {id:'project',label:'创建第一个项目',hint:'起一个故事名，写下创作简报',run:()=>runTour('first-story'),done:s=>s.projects.length>0}];
function videoReady(s){const v=s.settings.video;return ['seedance','kling','veo','agnes','minimax'].includes(v.provider)?!!v.keyEnv:v.provider==='native';}
const busy=s=>s.jobs.some(j=>j.kind==='coach'&&['queued','running'].includes(j.status));

export function coachShell(){return `<button id="coach-toggle" data-action="coach-toggle" aria-label="展开创作助手"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></svg><span>引导助手</span></button><aside id="coach" hidden aria-label="创作助手"><header class="coach-head"><div><b>创作助手</b><span class="tag" id="coach-mode-tag"></span></div><div class="actions"><button class="small ghost" data-action="coach-mode" id="coach-mode-btn"></button><button class="small ghost" data-action="coach-wizard-open">新手引导</button><button class="small ghost" data-action="coach-close">收起 ›</button></div></header><div id="coach-wizard" hidden></div><div class="coach-log" id="coach-log" role="log" aria-live="polite"></div><div class="coach-chips" id="coach-chips"></div><footer class="coach-composer"><textarea id="coach-input" data-transient maxlength="4000" rows="3" placeholder=""></textarea><div class="actions"><button class="primary small" data-action="coach-send" id="coach-send">发送</button><span class="hint">对话保存在任务记录；生成类操作仍需你在页面确认。</span></div></footer></aside><div id="coach-spot" hidden></div><div id="coach-welcome" hidden><div class="coach-welcome-card"><div class="eyebrow">WELCOME TO CYANCREATOR</div><h2>首次使用，要配置一下吗？</h2><p>第一次使用需要连接文本模型（大纲 / 剧本）与视频模型。可以跟着助手花两分钟完成；也可以跳过，之后随时从侧边栏的「新手引导」开始。</p><div class="actions"><button class="primary" data-action="coach-onboard-start">开始新手引导</button><button class="ghost" data-action="coach-onboard-skip">跳过，我自己探索</button></div></div></div>`;}
function actionLabel(a){return {navigate:()=>`切换到「${PAGE_NAMES[a.page]||a.page}」`,'settings-tab':()=>`打开设置 · ${TAB_NAMES[a.id]||a.id}`,highlight:()=>'高亮了下一步位置',tour:()=>`开始引导：${TOURS[a.id]?.title||a.id}`,fill:()=>`代填${FILL_LABELS[a.target]||a.target}`,'create-project':()=>`创建项目「${a.name}」`,'open-project':()=>`切换到项目「${a.name}」`}[a.type]?.()||a.type;}
function bubble(j,s){
 const head=`<article class="coach-msg user"><strong>你 · ${j.coach.mode==='expert'?'老手模式':'引导模式'}</strong><p>${esc(j.coach.message)}</p></article>`;
 let bot;
 if(j.status==='succeeded'&&j.result)bot=`<article class="coach-msg bot"><strong>创作助手</strong><p>${esc(j.result.reply)}</p>${j.result.actions?.length?`<p class="coach-hint">已执行：${j.result.actions.map(actionLabel).join('；')}</p>`:''}</article>`;
 else if(['queued','running'].includes(j.status))bot=`<article class="coach-msg bot"><strong>创作助手</strong><p>${esc(j.progress?.message||'正在思考…')}</p><button class="small ghost" data-action="cancel" data-id="${j.id}">取消</button></article>`;
 else{
  const configured=s&&s.settings.text.profiles.some(p=>p.baseUrl&&p.model);
  const hint=configured?'文本模型连接失败：请确认服务已启动、地址与模型名称正确。':'对话指令需要先连接文本模型；配置好后我就能听懂指令，代你操作工作台。';
  bot=`<article class="coach-msg bot"><strong>创作助手</strong><p class="warning">${esc(j.error||({cancelled:'已取消，可重新发送。',interrupted:'任务已中断，请重新发送。'}[j.status]||'回复失败。'))}</p><p class="coach-hint">${esc(hint)}</p><button class="small ghost" data-action="coach-fix-model">去检查文本模型配置</button></article>`;
 }
 return head+bot;
}
function wizardHtml(s){
 return `<section class="coach-wizard"><b>首次初始化</b><p class="hint">完成基本配置即可开始创作；全部可跳过。</p>${WIZARD.map(w=>{const d=w.done(s);return `<div class="coach-wizard-item ${d?'done':''}"><span>${d?'✓':'·'}</span><div><b>${esc(w.label)}</b><small>${esc(w.hint)}</small></div><button class="small ghost" data-action="coach-wizard-run" data-id="${w.id}">${d?'再看':'开始'}</button></div>`;}).join('')}<div class="actions"><button class="primary small" data-action="coach-wizard-done">完成初始化</button></div></section>`;
}
function ui(s){
 if(!mounted)return;
 s=s||ctx.state;
 const aside=document.getElementById('coach'),toggle=document.getElementById('coach-toggle');
 aside.hidden=!coach.open;toggle.hidden=coach.open;
 document.body.classList.toggle('coach-open',coach.open);
 document.getElementById('coach-mode-tag').textContent=coach.mode==='expert'?'老手模式':'引导模式';
 document.getElementById('coach-mode-btn').textContent=coach.mode==='expert'?'切到引导模式':'切到老手模式';
 const input=document.getElementById('coach-input');
 input.placeholder=coach.mode==='expert'?'向助手提问…':'下达指令或提问，例如「带我配置模型」';
 if(input.value!==coach.draft&&document.activeElement!==input)input.value=coach.draft;
 const wiz=document.getElementById('coach-wizard');
 const showWizard=coach.wizard&&coach.mode!=='expert';
 wiz.hidden=!showWizard;if(showWizard)wiz.innerHTML=wizardHtml(s);
 const jobs=s.jobs.filter(j=>j.kind==='coach').slice(0,50).reverse(),busyJob=busy(s);
 const sig=jobs.map(j=>j.id+j.status+(j.progress?.message||'')).join()+coach.mode+notes.length+showWizard;
 const log=document.getElementById('coach-log');
 if(log.dataset.sig!==sig){
  const near=log.scrollHeight-log.scrollTop-log.clientHeight<90;
  log.dataset.sig=sig;
  log.innerHTML=(jobs.length?'':`<article class="coach-msg bot"><strong>创作助手</strong><p>你好，我是内置在左侧工作台里的创作助手。${coach.mode==='expert'?'直接提问即可，我只负责答疑。':'可以让我代为操作工作台、高亮下一步位置；下方的预设引导不需要连接模型，点击就能开始。'}</p></article>`)+notes.map(n=>`<div class="coach-note">${esc(n)}</div>`).join('')+jobs.map(j=>bubble(j,s)).join('');
  if(near)log.scrollTop=log.scrollHeight;
 }
 const last=jobs.filter(j=>j.status==='succeeded'&&j.result?.suggestions?.length).at(-1);
 const list=busyJob?[]:(last?.result.suggestions||PRESETS[coach.mode]);
 document.getElementById('coach-chips').innerHTML=list.map(t=>{const text=typeof t==='string'?t:t.text,tour=typeof t==='string'?'':t.tour;return `<button class="small ghost" data-action="coach-chip" data-text="${esc(text)}"${tour?` data-tour="${tour}"`:''} ${busyJob?'disabled':''}>${esc(text)}</button>`;}).join('');
 document.getElementById('coach-send').disabled=!!busyJob;
 // 执行新完成回复里的代操作动作（启动时已把历史任务全部标记为已执行，刷新页面不会重放）
 for(const j of jobs)if(j.status==='succeeded'&&j.result?.actions?.length&&!executedActions.has(j.id)){executedActions.add(j.id);executeActions(j.result.actions);}
}
export const coachIsOpen=()=>coach.open;
export function coachRender(state){ui(state);}
function openCoach(){coach.open=true;ui();}
function closeCoach(){coach.open=false;clearSpot();endTour(false);ui();}
async function sendCoach(text){
 text=(text||'').trim();if(!text)return;
 const s=ctx.state;
 if(busy(s))throw new Error('助手正在回复，请稍候或先取消');
 await ctx.api('/api/jobs','POST',{...(s.projects.some(p=>p.id===ctx.projectId())?{projectId:ctx.projectId()}:{}),kind:'coach',mode:coach.mode,page:ctx.page(),message:text.slice(0,4000)});
 coach.draft='';const input=document.getElementById('coach-input');if(input)input.value='';
 const log=document.getElementById('coach-log');if(log)log.dataset.sig='';
 await ctx.refresh();ui();
}
async function finishOnboarding(){
 coach.welcome=false;coach.wizard=false;document.getElementById('coach-welcome').hidden=true;
 if(!ctx.state.onboarded&&!onboardingBusy){onboardingBusy=true;try{await ctx.api('/api/onboarding','POST',{done:true});}finally{onboardingBusy=false;}}
 await ctx.refresh();ui();ctx.toast('已记录：首次初始化向导完成，之后可随时从侧边栏「新手引导」重新运行');
}
function showWelcome(){coach.welcome=true;const w=document.getElementById('coach-welcome');if(w)w.hidden=false;}

// —— 聚光引导：目标高亮 + 其余区域遮罩 + 指向箭头 + 说明卡片（遮罩不拦截点击，避免困住用户）——
function clearSpot(){spot=null;const root=document.getElementById('coach-spot');if(root){root.hidden=true;root.innerHTML='';}}
function endTour(done){
 clearWait();
 if(tour){if(done&&tour.id==='workbench')localStorage.setItem('coach:tour-workbench','1');if(done){notes.push(`引导「${TOURS[tour.id]?.title||tour.id}」完成`);if(notes.length>6)notes.shift();ui();}}
 tour=null;clearSpot();
}
function showCard(el,{title,body,tip,buttons}){
 spot={el,buttons:buttons||[{label:'知道了',action:'coach-spot-dismiss',primary:true}]};
 const root=document.getElementById('coach-spot');
 root.hidden=false;
 root.innerHTML=`<div class="coach-spot-hole"></div><div class="coach-spot-ring"></div><div class="coach-arrow" hidden><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M12 4l8 12H4Z"/></svg></div><div class="coach-spot-card"><b>${esc(title||'引导')}</b><p>${esc(body||tip||'')}</p><div class="actions">${spot.buttons.map(b=>`<button class="${b.primary?'primary':'ghost'} small" data-action="${b.action}">${esc(b.label)}</button>`).join('')}</div></div>`;
 spotLoop();
}
function spotLoop(){
 cancelAnimationFrame(spotRaf);spotRaf=requestAnimationFrame(spotLoop);
 if(!spot)return;
 const root=document.getElementById('coach-spot');if(!root||root.hidden)return;
 const hole=root.querySelector('.coach-spot-hole'),ring=root.querySelector('.coach-spot-ring'),arrow=root.querySelector('.coach-arrow'),card=root.querySelector('.coach-spot-card');
 const el=spot.el&&spot.el.isConnected&&!spot.el.closest('[hidden]')?spot.el:null;
 const r=el?el.getBoundingClientRect():null;
 if(!el||r.width<4||r.height<4||r.bottom<0||r.top>innerHeight){
  if(spot._sig==='lost')return;spot._sig='lost';
  hole.style.cssText='display:none';ring.style.cssText='display:none';arrow.hidden=true;
  card.style.cssText='position:fixed;left:50%;top:38%;transform:translate(-50%,-50%)';
  return;
 }
 const pad=7;
 const holeCss=`display:block;left:${r.left-pad}px;top:${r.top-pad}px;width:${r.width+pad*2}px;height:${r.height+pad*2}px`;
 const ringCss=holeCss;
 const cw=card.offsetWidth||300,chh=card.offsetHeight||130;
 const cx0=Math.min(Math.max(10,r.left),Math.max(10,innerWidth-cw-10));
 let cx,cy,ax,ay,rot,bx,by;
 if(r.right+cw+70<innerWidth){cx=r.right+40;cy=r.top+r.height/2-chh/2;ax=r.right+6;ay=r.top+r.height/2-15;rot=270;bx=-7;by=0;}
 else if(r.left>cw+70){cx=r.left-cw-40;cy=r.top+r.height/2-chh/2;ax=r.left-36;ay=r.top+r.height/2-15;rot=90;bx=7;by=0;}
 else if(r.bottom+chh+84<innerHeight){cx=cx0;cy=r.bottom+44;ax=r.left+r.width/2-15;ay=r.bottom+6;rot=0;bx=0;by=-7;}
 else{cx=cx0;cy=Math.max(10,r.top-chh-44);ax=r.left+r.width/2-15;ay=Math.max(32,r.top-36);rot=180;bx=0;by=7;}
 cx=Math.min(Math.max(10,cx),Math.max(10,innerWidth-cw-10));cy=Math.min(Math.max(10,cy),Math.max(10,innerHeight-chh-10));
 const sig=[holeCss,cx,cy,ax,ay,rot].join('|');
 if(spot._sig===sig)return;spot._sig=sig;
 hole.style.cssText=holeCss;ring.style.cssText=ringCss;
 card.style.cssText=`position:fixed;left:${cx}px;top:${cy}px;transform:none`;
 arrow.hidden=false;arrow.style.left=`${ax}px`;arrow.style.top=`${ay}px`;
 arrow.style.setProperty('--bx',`${bx}px`);arrow.style.setProperty('--by',`${by}px`);
 arrow.querySelector('svg').style.transform=`rotate(${rot}deg)`;
}
function clearWait(){
 if(waitCleanup){waitCleanup();waitCleanup=null;}
 if(waitTimer){clearTimeout(waitTimer);waitTimer=null;}
}
function armWait(step){
 clearWait();
 if(!step?.wait)return;
 const sel=step.wait.click||step.wait.input,type=step.wait.click?'click':'change';
 const h=e=>{if(!e.target.closest?.(sel))return;clearWait();waitTimer=setTimeout(()=>{waitTimer=null;if(tour)nextTourStep();},550);};
 document.addEventListener(type,h,true);
 waitCleanup=()=>document.removeEventListener(type,h,true);
}
function runTour(id){
 const t=TOURS[id];if(!t)return;
 endTour(false);openCoach();
 tour={id,i:-1};
 nextTourStep();
}
function nextTourStep(){
 if(!tour)return;
 tour.i++;
 if(tour.i>=TOURS[tour.id].steps.length)return endTour(true);
 const s=TOURS[tour.id].steps[tour.i];
 const go=()=>{
  if(!tour||tour.i<0||TOURS[tour.id].steps[tour.i]!==s)return;
  if(s.tab)ctx.setSettingsTab(s.tab);
  const el=s.target?document.querySelector(TARGETS[s.target]||s.target):null;
  if(el){const d=el.closest('details');if(d)d.open=true;el.scrollIntoView({block:'center',behavior:'smooth'});}
  showCard(el,{title:`${s.title} · ${tour.i+1}/${TOURS[tour.id].steps.length}`,body:s.body,buttons:[{label:tour.i===TOURS[tour.id].steps.length-1?'完成':'下一步',action:'coach-tour-next',primary:true},{label:'结束引导',action:'coach-tour-skip'}]});
  armWait(s);
 };
 s.page?ctx.showPage(s.page)&&setTimeout(go,180):setTimeout(go,30);
}
async function fillField(target,value){
 if(target==='project-name'){const input=document.querySelector('#new-name');if(!input)return false;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));return true;}
 const sel=FILL_SELECTORS[target];if(!sel)return false;
 const input=document.querySelector(sel);if(!input)return false;
 if(input.closest('details'))input.closest('details').open=true;
 input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
 return true;
}
function note(text){notes.push(text);if(notes.length>6)notes.shift();ui();}
async function executeActions(actions){
 for(const a of actions||[]){
  try{
   if(a.type==='navigate'){if(ctx.showPage(a.page))await wait(160);}
   else if(a.type==='settings-tab'){if(ctx.showPage('models')){ctx.setSettingsTab(a.id);await wait(120);}}
   else if(a.type==='highlight'){openCoach();setTimeout(()=>{const el=a.target?document.querySelector(TARGETS[a.target]||a.target):null;if(el)el.scrollIntoView({block:'center',behavior:'smooth'});showCard(el,{title:'引导',body:a.tip||'操作这里就可以继续。'});},150);break;}
   else if(a.type==='tour'){if(TOURS[a.id])runTour(a.id);break;}
   else if(a.type==='fill'){note(await fillField(a.target,a.value)?`已代填「${FILL_LABELS[a.target]||a.target}」，请检查后自行保存`:`没有找到可代填的「${FILL_LABELS[a.target]||a.target}」，请先打开对应页面`);}
   else if(a.type==='create-project'){try{await ctx.createProject(a.name);note(`已创建项目「${a.name}」`);}catch(e){note('创建项目未完成：'+e.message);}}
   else if(a.type==='open-project'){try{await ctx.openProject(a.name);note(`已切换到项目「${a.name}」`);}catch(e){note('切换项目未完成：'+e.message);}}
  }catch(e){note('动作未执行：'+e.message);}
 }
}
export function coachHandle(action,el,context){
 if(!action.startsWith('coach-'))return false;
 ctx=ctx||context;
 const s=()=>ctx.state;
 if(action==='coach-toggle'){coach.open?closeCoach():openCoach();}
 else if(action==='coach-close')closeCoach();
 else if(action==='coach-mode'){coach.mode=coach.mode==='expert'?'guide':'expert';localStorage.setItem('coach:mode',coach.mode);if(coach.mode==='expert'){endTour(false);clearSpot();}ui();ctx.toast(coach.mode==='expert'?'已切换到老手模式：保留对话答疑，不再提供操作引导':'已切换到引导模式');}
 else if(action==='coach-send')return sendCoach(document.getElementById('coach-input').value).then(()=>true);
 else if(action==='coach-chip'){
  const tour=el.dataset.tour;
  if(tour&&TOURS[tour]){openCoach();note(`已开始本地引导「${TOURS[tour].title}」，无需连接模型`);runTour(tour);return true;}
  return sendCoach(el.dataset.text).then(()=>true);
 }
 else if(action==='coach-wizard-open'){coach.wizard=true;if(coach.mode==='expert'){coach.mode='guide';localStorage.setItem('coach:mode','guide');}openCoach();}
 else if(action==='coach-wizard-run'){const w=WIZARD.find(w=>w.id===el.dataset.id);if(w)w.run();}
 else if(action==='coach-wizard-done')return finishOnboarding().then(()=>true);
 else if(action==='coach-onboard-start'){document.getElementById('coach-welcome').hidden=true;coach.welcome=false;coach.wizard=true;coach.mode='guide';localStorage.setItem('coach:mode','guide');openCoach();}
 else if(action==='coach-onboard-skip')return finishOnboarding().then(()=>true);
 else if(action==='coach-fix-model'){
  if(ctx.showPage('models')){
   ctx.setSettingsTab('text');
   setTimeout(()=>{
    const el=document.querySelector(TARGETS['text-profile-base']);
    if(el){el.scrollIntoView({block:'center',behavior:'smooth'});showCard(el,{title:'连接文本模型',body:'填好服务地址与模型名称 → 点「测试连接」→ 点「保存模型设置」。保存后回到对话发指令，我就能代你操作工作台了。'});}
   },180);
  }
 }
 else if(action==='coach-tour-next'){clearWait();nextTourStep();}
 else if(action==='coach-tour-skip')endTour(false);
 else if(action==='coach-spot-dismiss')clearSpot();
 else return false;
 ui();
 return true;
}
export function coachBoot(state,context){
 if(mounted){ctx=context;ui(state);return;}
 ctx=context;
 document.body.insertAdjacentHTML('beforeend',coachShell());
 mounted=true;
 document.addEventListener('input',e=>{if(e.target.id==='coach-input')coach.draft=e.target.value;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&spot&&!tour&&!document.querySelector('dialog[open]'))clearSpot();});
 spotRaf=requestAnimationFrame(spotLoop);
 state.jobs.filter(j=>j.kind==='coach').forEach(j=>executedActions.add(j.id));
 if(!state.onboarded)showWelcome();
 ui(state);
}
