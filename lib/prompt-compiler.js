// Deterministic shot compilation: no text-model call and no extra LLM tokens.
export function compileShot(shot,project,scene){
 const parts=[];const add=(label,value)=>{const v=String(value||'').replace(/\s+/g,' ').trim();if(v&&!parts.some(p=>p===v||p.endsWith('：'+v)))parts.push(label?label+'：'+v:v);};
 add('',shot.prompt||scene?.action);if(scene?.title&&!String(shot.prompt||'').includes(scene.title))add('场景',scene.title);
 const labels={size:'景别',movement:'运镜',lighting:'灯光',depth:'景深',composition:'画面编排',blocking:'人物走位',mood:'情绪与色调'};
 for(const [key,label] of Object.entries(labels))add(label,shot.direction?.[key]);
 for(const id of shot.characterIds||[]){const c=project.characters?.find(c=>c.id===id);if(c)add('角色 '+c.name,c.appearance);}
 for(const w of project.worldbook||[])if(['视觉','规则'].includes(w.category))add(w.name,w.content);
 return parts.join('\n');
}
export function compactContext(value){if(Array.isArray(value))return value.map(compactContext);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k,v])=>!['generation','history','selectedShots','scriptVersion'].includes(k)&&v!==''&&v!==null&&v!==undefined).map(([k,v])=>[k,compactContext(v)]));return value;}
