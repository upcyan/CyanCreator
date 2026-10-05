// 画布工作流组：借鉴 LocalMiniDrama 的 workflow_groups 思路——
// 框选镜头存成可命名分组，持久化到项目（canvasGroups），整组按顺序重跑、失败即停。
// 本项目不做轮询：视频生成走既有串行 job 队列（server 端 pump），此处只负责按序投递。
import {flatShots} from './video-workbench.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeGroupId='';

export const getActiveGroup=()=>activeGroupId;
export function setActiveGroup(id){activeGroupId=id||'';}

export function groupsOf(p){return Array.isArray(p.canvasGroups)?p.canvasGroups:[];}

export function activeGroupOf(p){return groupsOf(p).find(g=>g.id===activeGroupId)||null;}

/** 把画布当前勾选的镜头（pickedShots 的本项目键）转成组内 shots 数组，按画布/剧本顺序排序 */
export function shotsFromPicked(p,picked){
  const prefix=p.id+':'+p.scriptVersion+':';
  const order=new Map(flatShots(p).map(s=>[s.key,{scene:s.si,shot:s.i}]));
  const out=[];
  for(const k of picked){
    if(!k.startsWith(prefix))continue;
    const key=k.slice(prefix.length);
    const s=order.get(key);
    if(s)out.push(s);
  }
  out.sort((a,b)=>a.scene-b.scene||a.shot-b.shot);
  return out;
}

/** 构造合法的组对象（前端侧校验与服务端一致，fail fast） */
export function buildGroup(title,shots,existing=[]){
  const name=String(title||'').trim();
  if(!name)throw new Error('请给工作流起个名字');
  if(name.length>60)throw new Error('工作流名称须为 1–60 字');
  if(!Array.isArray(shots)||!shots.length)throw new Error('请先在画布勾选要编组的镜头');
  if(shots.length>20)throw new Error('一组最多 20 个镜头');
  if(existing.length>=50)throw new Error('工作流最多 50 组');
  const keys=new Set(shots.map(s=>`${s.scene}-${s.shot}`));
  if(keys.size!==shots.length)throw new Error('组内镜头重复');
  return {id:'wg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),title:name,shots,createdAt:new Date().toISOString()};
}

export function groupsBarHtml(p){
  const groups=groupsOf(p);
  const active=activeGroupOf(p);
  const opts=groups.map(g=>`<option value="${esc(g.id)}" ${g.id===activeGroupId?'selected':''}>${esc(g.title)} · ${g.shots.length} 镜</option>`).join('');
  return `<div class="canvas-wf" id="canvas-wf"><label class="canvas-wf-select">工作流<select id="canvas-wf-select" data-transient ${groups.length?'':'disabled'}><option value="">${groups.length?'选择工作流':'暂无工作流'}</option>${opts}</select></label><button class="small" data-action="canvas-wf-create" title="把画布勾选的镜头存成一组">存所选为组</button>${active?`<button class="small primary" data-action="canvas-wf-run">整组重跑 · ${esc(active.title)}</button><button class="small ghost" data-action="canvas-wf-delete">删除该组</button>`:''}</div>`;
}

/**
 * 整组重跑：按组内镜头顺序逐个投递视频生成任务（复用服务端 /api/video/batch 的串行队列）。
 * 借鉴 LocalMiniDrama runWorkflowGroup 的顺序语义：逐镜执行、失败即停、返回 ok/failed 汇总。
 * 与它的差异：本项目服务端本身串行，所以这里按「逐镜投递并确认 202」推进，单镜被拒即停止后续投递。
 */
export async function runGroup(api,p,group){
  const summary={groupId:group.id,ok:[],failed:[]};
  // 分批投递：每批 1 镜，成功即继续；被拒（如队列满、剧本过期）则停止并记录
  for(const s of group.shots){
    try{
      await api('/api/video/batch','POST',{projectId:p.id,revision:p.revision,shots:[{scene:s.scene,shot:s.shot}]});
      summary.ok.push(`${s.scene+1}.${s.shot+1}`);
    }catch(err){
      summary.failed.push({shot:`${s.scene+1}.${s.shot+1}`,error:String(err.message||err)});
      break; // 失败即停：不继续投递后续镜头
    }
  }
  return summary;
}
