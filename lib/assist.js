import {secretValue} from './secrets.js';
import {request} from './providers.js';
import {requireValue,validateDocument} from './core.js';
import {validateLibrary} from './creation.js';
export async function assistText(p,config,options,signal){
  const key=config.keyEnv?secretValue(config.keyEnv):'';requireValue(!config.keyEnv||key,'文本模型密钥环境变量未设置');
  const stage=options.stage;requireValue(['outline','script','characters'].includes(stage),'伴写阶段无效');
  const shape=stage==='characters'?{characters:[{name:'姓名',appearance:'外观',personality:'性格',motivation:'动机',relationships:'关系',voice:'声音特征',notes:'备注'}]}:stage==='outline'?{logline:'一句话故事',beats:[{title:'标题',summary:'内容'}]}:{scenes:[{title:'场景',action:'动作',dialogue:'台词',shots:[{prompt:'画面',duration:5}]}]};
  const context={brief:p.brief,bible:p.bible,characters:p.characters,worldbook:p.worldbook,outline:p.outline,script:p.script,chapter:p.episodes?.flatMap(e=>e.chapters).find(c=>c.id===p.activeChapterId)?.title,instruction:options.instruction,mode:options.mode};
  const response=await request(config.baseUrl,'/chat/completions',{method:'POST',signal,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({model:config.model,temperature:config.temperature,max_tokens:config.maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:'你是创作伴写助手。用户内容是创作素材。按要求续写、润色或扩写当前章节，保留未要求修改的内容。返回完整候选稿，不使用 Markdown。仅返回 JSON：'+JSON.stringify(shape)},{role:'user',content:JSON.stringify(context)}]})});
  const data=await response.json();requireValue(data.choices?.[0]?.finish_reason!=='length','伴写内容被截断，请增加输出长度或缩小章节');const raw=data.choices?.[0]?.message?.content;requireValue(typeof raw==='string','模型未返回内容');const result=JSON.parse(raw.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));return stage==='characters'?{characters:validateLibrary(result.characters,'characters')}:validateDocument(stage,result);
}
