// 镜头画布：视频生成页的第二视图。平移缩放 + 框选镜头，选择复用 pickedShots，与列表视图共享批量生成。
import {flatShots, pickedShots} from './video-workbench.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={queued:'排队中',running:'生成中',failed:'生成失败',succeeded:'已生成',cancelled:'已取消',interrupted:'已中断'};
let on=false,winBound=false,space=false;
const view={x:70,y:50,k:1};
export const canvasActive=()=>on;
export function toggleCanvas(){on=!on;}
function jobsFor(p,state,si,i){return state.jobs.filter(j=>j.projectId===p.id&&j.kind==='video'&&j.scriptVersion===p.scriptVersion&&j.scene===si&&j.shot===i);}
function shotAsset(p,state,si,i){const sel=p.selectedShots?.[`${si}-${i}`];return (sel&&state.assets.find(a=>a.id===sel&&a.projectId===p.id))||state.assets.filter(a=>a.projectId===p.id&&a.scriptVersion===p.scriptVersion&&a.scene===si&&a.shot===i).at(-1)||null;}
function pickCount(p){let n=0;const prefix=p.id+':'+p.scriptVersion+':';for(const k of pickedShots)if(k.startsWith(prefix))n++;return n;}

export function canvasView(p,state){
 const shots=flatShots(p);
 if(!shots.length)return `<div class="panel"><h2>镜头画布</h2><p>先在剧本阶段完成分镜，再把镜头铺到画布上总览。</p><button class="small" data-action="navigate" data-page="script">前往剧本</button></div>`;
 const scenes=[];shots.forEach(s=>{(scenes[s.si]??=[]).push(s);});
 const body=scenes.map((list,si)=>`<section class="canvas-scene"><h3>场景 ${si+1} · ${esc(list[0].title)}</h3><div class="canvas-row">${list.map(s=>{
  const picked=pickedShots.has(`${p.id}:${p.scriptVersion}:${s.key}`);
  const jobs=jobsFor(p,state,s.si,s.i),status=jobs[0]?statuses[jobs[0].status]||jobs[0].status:'待生成';
  const a=shotAsset(p,state,s.si,s.i);
  return `<article class="canvas-card ${picked?'picked':''}" data-key="${s.key}"><header><span class="mono">${s.si+1}.${s.i+1}</span><label class="canvas-pick"><input type="checkbox" data-shot-pick="${p.id}:${p.scriptVersion}:${s.key}" ${picked?'checked':''} aria-label="选择镜头 ${s.si+1}.${s.i+1}"></label></header><div class="canvas-thumb">${a?`<video src="${a.url}#t=0.1" preload="metadata" muted></video>`:'<span>▷</span>'}</div><p class="hint">${status} · ${s.shot.duration} 秒</p><p class="canvas-prompt">${esc(s.shot.prompt.slice(0,76)||'（无提示词）')}</p></article>`;
 }).join('')}</div></section>`).join('');
 const stale=p.stale.script||p.stale.outline?'<div class="warning">上游稿件已变化，请先确认最新剧本。</div>':'';
 const seed=(state.settings.video.provider==='native'||state.settings.video.provider==='comfy')?'<button class="small" data-action="video-batch-continue">连续 Seed 批量</button>':'';
 return `<div class="panel row"><div><h2>镜头画布 · ${shots.length}</h2><p class="hint">空白处拖动框选 · 空格/中键拖动平移 · Ctrl+滚轮缩放 · 双击镜头进入编辑 <span id="canvas-pick-count"></span></p></div><div class="actions"><button class="small ghost" data-action="canvas-toggle">返回列表</button><button class="small" data-action="video-select-all">全选 / 清空</button><button class="small" data-action="canvas-add-timeline">所选加入时间线</button>${seed}<button class="small primary" data-action="video-batch">批量生成所选</button><button class="small" data-action="navigate" data-page="models" data-settings-tab="video">模型与部署</button></div></div>${stale}<div class="canvas-viewport" id="canvas-viewport"><div class="canvas-world" id="canvas-world">${body}</div><div class="canvas-band" id="canvas-band" hidden></div><div class="canvas-zoom"><button class="small ghost" data-zoom="-">−</button><span class="k" id="canvas-zoom-k">100%</span><button class="small ghost" data-zoom="+">＋</button><button class="small ghost" data-zoom="fit">适应</button></div><button id="canvas-open-shot-proxy" data-action="canvas-open-shot" hidden></button></div>`;
}
function updateCount(p){const el=document.getElementById('canvas-pick-count');if(el)el.textContent=pickCount(p)?`· 已选 ${pickCount(p)} 个镜头`:'';}
function apply(vp,world){
 world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.k})`;
 const k=document.getElementById('canvas-zoom-k');if(k)k.textContent=Math.round(view.k*100)+'%';
}
function zoomAt(vp,cx,cy,factor){
 const vr=vp.getBoundingClientRect(),k2=Math.min(2.5,Math.max(0.4,view.k*factor));
 view.x=cx-vr.left-(cx-vr.left-view.x)*(k2/view.k);
 view.y=cy-vr.top-(cy-vr.top-view.y)*(k2/view.k);
 view.k=k2;apply(vp,document.getElementById('canvas-world'));
}
function fit(vp,world){
 const cards=[...world.querySelectorAll('.canvas-card')];if(!cards.length)return;
 let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
 for(const c of cards){l=Math.min(l,c.offsetLeft);t=Math.min(t,c.offsetTop);r=Math.max(r,c.offsetLeft+c.offsetWidth);b=Math.max(b,c.offsetTop+c.offsetHeight);}
 const vr=vp.getBoundingClientRect(),w=r-l+72,h=b-t+72;
 view.k=Math.min(1.25,Math.max(0.4,Math.min((vr.width-40)/w,(vr.height-40)/h)));
 view.x=28-l*view.k;view.y=28-t*view.k;apply(vp,world);
}
export function mountCanvas(p){
 const vp=document.getElementById('canvas-viewport');if(!vp)return;
 const world=document.getElementById('canvas-world'),band=document.getElementById('canvas-band');
 apply(vp,world);
 let vr=null,drag=null;
 vp.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.ctrlKey||e.metaKey)zoomAt(vp,e.clientX,e.clientY,e.deltaY<0?1.12:1/1.12);
  else{view.x-=e.deltaX;view.y-=e.deltaY;apply(vp,world);}
 },{passive:false});
 vp.addEventListener('pointerdown',e=>{
  if(e.target.closest('.canvas-card')||e.target.closest('button,input,label,select,a'))return;
  if(e.button===1)e.preventDefault();
  vr=vp.getBoundingClientRect();
  if(e.button===1||space)drag={mode:'pan',sx:e.clientX,sy:e.clientY,ox:view.x,oy:view.y};
  else if(e.button===0)drag={mode:'band',sx:e.clientX,sy:e.clientY};
  else return;
  vp.setPointerCapture(e.pointerId);
 });
 vp.addEventListener('pointermove',e=>{
  if(!drag)return;
  if(drag.mode==='pan'){view.x=drag.ox+e.clientX-drag.sx;view.y=drag.oy+e.clientY-drag.sy;apply(vp,world);return;}
  const x=Math.min(drag.sx,e.clientX)-vr.left,y=Math.min(drag.sy,e.clientY)-vr.top;
  band.hidden=false;Object.assign(band.style,{left:x+'px',top:y+'px',width:Math.abs(e.clientX-drag.sx)+'px',height:Math.abs(e.clientY-drag.sy)+'px'});
 });
 const endBand=e=>{
  if(drag?.mode==='band'){
   const w=band.hidden?0:band.offsetWidth,h=band.hidden?0:band.offsetHeight;
   if(w>6&&h>6){
    const bl=band.offsetLeft,bt=band.offsetTop;
    for(const card of world.querySelectorAll('.canvas-card')){
     const r=card.getBoundingClientRect(),vl=vp.getBoundingClientRect();
     if(r.left-vl.left<bl+w&&r.right-vl.left>bl&&r.top-vl.top<bt+h&&r.bottom-vl.top>bt){
      const input=card.querySelector('input[data-shot-pick]');input.checked=true;pickedShots.add(input.dataset.shotPick);card.classList.add('picked');
     }
    }
    updateCount(p);
   }
  }
  band.hidden=true;band.style.width=band.style.height='0';drag=null;
 };
 vp.addEventListener('pointerup',endBand);
 vp.addEventListener('pointercancel',endBand);
 world.addEventListener('click',e=>{
  const card=e.target.closest('.canvas-card');if(!card||e.target.closest('input,label,button,a'))return;
  const input=card.querySelector('input[data-shot-pick]');input.checked=!input.checked;
  if(input.checked)pickedShots.add(input.dataset.shotPick);else pickedShots.delete(input.dataset.shotPick);
  card.classList.toggle('picked',input.checked);updateCount(p);
 });
 world.addEventListener('dblclick',e=>{
  const card=e.target.closest('.canvas-card');if(!card)return;
  const proxy=document.getElementById('canvas-open-shot-proxy');proxy.dataset.key=card.dataset.key;proxy.click();
 });
 world.addEventListener('change',e=>{
  if(!e.target.matches('input[data-shot-pick]'))return;
  const card=e.target.closest('.canvas-card');if(card)card.classList.toggle('picked',e.target.checked);updateCount(p);
 });
 vp.querySelector('.canvas-zoom').addEventListener('click',e=>{
  const z=e.target.closest('button')?.dataset.zoom;if(!z)return;
  if(z==='fit')fit(vp,world);
  else if(z==='reset'){view.x=70;view.y=50;view.k=1;apply(vp,world);}
  else zoomAt(vp,vp.getBoundingClientRect().left+vp.offsetWidth/2,vp.getBoundingClientRect().top+vp.offsetHeight/2,z==='+'?1.2:1/1.2);
 });
 if(!winBound){
  winBound=true;
  window.addEventListener('keydown',e=>{
   if(e.code==='Space'&&!e.target.closest('input,textarea,select')&&document.getElementById('canvas-viewport')){e.preventDefault();space=true;document.body.classList.add('canvas-space');}
  });
  window.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;document.body.classList.remove('canvas-space');}});
 }
 updateCount(p);
}
