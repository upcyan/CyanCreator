import {randomUUID} from 'node:crypto';
import {requireValue,validateDocument} from './core.js';
const chapterFields=['outline','script','review','stale','history','scriptVersion','selectedShots'];
export function initCreation(p){
  p.characters??=[];p.worldbook??=[];
  if(!p.episodes?.length){const chapter={id:randomUUID(),title:'第一章'};p.episodes=[{id:randomUUID(),title:'第 1 集',chapters:[chapter]}];p.activeChapterId=chapter.id;stashChapter(p);}
  return p;
}
export function stashChapter(p){const chapter=p.episodes?.flatMap(e=>e.chapters).find(c=>c.id===p.activeChapterId);if(chapter)for(const k of chapterFields)chapter[k]=structuredClone(p[k]??(k==='stale'||k==='selectedShots'?{}:k==='history'?[]:null));}
export function invalidateChapters(p){for(const stage of ['outline','script','review'])p.stale[stage]=!!p[stage];for(const chapter of p.episodes.flatMap(e=>e.chapters)){chapter.stale??={};for(const stage of ['outline','script','review'])chapter.stale[stage]=!!chapter[stage];}}
export function switchChapter(p,id){const chapter=p.episodes.flatMap(e=>e.chapters).find(c=>c.id===id);requireValue(chapter,'章节不存在');stashChapter(p);p.activeChapterId=id;for(const k of chapterFields)p[k]=structuredClone(chapter[k]??(k==='stale'||k==='selectedShots'?{}:k==='history'?[]:k==='scriptVersion'?randomUUID():null));}
export function mutateStructure(p,b){
  const title=String(b.title||'').trim();
  if(b.action==='switch')return switchChapter(p,b.id);
  requireValue(title&&title.length<=120,'请填写 1–120 字的标题');
  if(b.action==='episode'){requireValue(p.episodes.length<100,'最多 100 集');const chapter={id:randomUUID(),title:'第一章'};p.episodes.push({id:randomUUID(),title,chapters:[chapter]});switchChapter(p,chapter.id);}
  else if(b.action==='chapter'){const episode=p.episodes.find(e=>e.id===b.episodeId);requireValue(episode&&episode.chapters.length<100,'剧集不存在或章节已满');const chapter={id:randomUUID(),title};episode.chapters.push(chapter);switchChapter(p,chapter.id);}
  else if(b.action==='rename'){const item=p.episodes.find(e=>e.id===b.id)||p.episodes.flatMap(e=>e.chapters).find(c=>c.id===b.id);requireValue(item,'目录项不存在');item.title=title;}
  else throw new Error('不支持的目录操作');
}
export function importDocument(stage,text,format){
  requireValue(['outline','script'].includes(stage),'无效导入阶段');requireValue(typeof text==='string'&&text.trim()&&text.length<=200000,'文件内容应为 1–200000 字符');
  if(format==='json')return validateDocument(stage,JSON.parse(text.replace(/^\uFEFF/,'')));
  const sections=text.replace(/\r/g,'').trim().split(/\n(?=#{1,4}\s|第[一二三四五六七八九十\d]+[章节场幕])/).filter(Boolean);
  requireValue(sections.length<=100,'单章导入最多 100 个段落组，请按章节拆分');
  const parts=sections.map((s,i)=>{const lines=s.split('\n');return {title:lines.length>1?lines.shift().replace(/^#+\s*/, '').slice(0,120):`段落 ${i+1}`,text:lines.join('\n')||s};});
  return stage==='outline'?{logline:parts[0].text.slice(0,200),beats:parts.map(p=>({title:p.title,summary:p.text}))}:{scenes:parts.map(p=>({title:p.title,action:p.text,dialogue:'',shots:[{prompt:p.text,duration:5}]}))};
}
export function validateLibrary(value,kind){
  requireValue(Array.isArray(value)&&value.length<=200,'最多 200 条设定');
  const keys=kind==='characters'?['name','appearance','personality','motivation','relationships','voice','notes']:['name','category','content','keywords'];
  const ids=new Set();return value.map(item=>{const id=item.id||randomUUID();requireValue(typeof id==='string'&&/^[\w-]{1,100}$/.test(id)&&!ids.has(id),'设定 ID 无效或重复');ids.add(id);const result={id};for(const key of keys){const v=item[key]??'';requireValue(typeof v==='string'&&v.length<=10000,'设定内容过长或无效');result[key]=v;}requireValue(result.name.trim(),'请填写设定名称');return result;});
}
export function shotPrompt(shot,p){
  const labels={size:'景别',movement:'运镜',lighting:'灯光',depth:'景深',composition:'画面编排',blocking:'人物走位',mood:'情绪与色调'};
  const parts=[shot.prompt];for(const [k,label] of Object.entries(labels))if(shot.direction?.[k])parts.push(label+'：'+shot.direction[k]);
  for(const id of shot.characterIds||[]){const c=p.characters?.find(c=>c.id===id);if(c)parts.push(`角色 ${c.name}：${c.appearance}；${c.personality}`);}
  for(const w of p.worldbook||[])if(w.category==='视觉'||w.category==='规则')parts.push(`${w.name}：${w.content}`);
  return parts.join('\n');
}
export function validateDirection(shot){
  if(shot.direction){requireValue(typeof shot.direction==='object'&&!Array.isArray(shot.direction),'镜头语言格式无效');for(const [k,v] of Object.entries(shot.direction))requireValue(['size','movement','lighting','depth','composition','blocking','mood'].includes(k)&&typeof v==='string'&&v.length<=3000,'镜头语言字段无效');}
  if(shot.characterIds)requireValue(Array.isArray(shot.characterIds)&&shot.characterIds.length<=50&&shot.characterIds.every(x=>typeof x==='string'),'角色引用无效');
}
