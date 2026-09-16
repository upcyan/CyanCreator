import {request} from './providers.js';
import {secretValue} from './secrets.js';
export async function chatCompletion(config,messages,signal,onProgress=()=>{}){
 const key=secretValue(config.keyEnv);if(config.keyEnv&&!key)throw new Error('请配置文本模型密钥');
 const timeout=AbortSignal.timeout(600000),combined=AbortSignal.any([signal,timeout]);
 onProgress({phase:'text',message:'等待模型首个输出；长上下文预处理可能较慢',characters:0});
 const r=await request(config.baseUrl,'/chat/completions',{method:'POST',timeoutMs:600000,signal:combined,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({model:config.model,messages,temperature:config.temperature,max_tokens:config.maxTokens,response_format:{type:'json_object'},stream:true})});
 if(!r.headers.get('content-type')?.includes('text/event-stream'))return r.json();
 const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',content='',reason=null,usage,last=0,done=false;
 const consume=line=>{if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(raw==='[DONE]'){done=true;return;}if(!raw)return;const packet=JSON.parse(raw);if(packet.error)throw new Error('文本服务返回生成错误');const c=packet.choices?.[0];content+=c?.delta?.content||'';reason=c?.finish_reason||reason;usage=packet.usage||usage;if(content.length>2000000)throw new Error('模型输出过大，请拆分章节');if(Date.now()-last>500){last=Date.now();onProgress({phase:'text',characters:content.length,message:'正在生成 · 已接收 '+content.length+' 字符'});}};
 try{while(!done){let timer;const result=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('模型连续 90 秒未输出，已断开等待。请缩短章节或降低输出长度后重试。')),90000);})]).finally(()=>clearTimeout(timer));if(result.done)break;pending+=decoder.decode(result.value,{stream:true});let n;while((n=pending.indexOf('\n'))>=0){consume(pending.slice(0,n).trim());pending=pending.slice(n+1);}}if(pending.trim())consume(pending.trim());if(!reason&&!done)throw new Error('模型输出连接提前结束，请重试');return {choices:[{finish_reason:reason||'stop',message:{content}}],usage};}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
