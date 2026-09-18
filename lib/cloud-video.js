import {createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {requireValue,validateEndpoint,validateEnv} from './core.js';
import {request} from './providers.js';
import {secretValue} from './secrets.js';
export const cloudTemplates=[
  {id:'seedance',name:'Seedance · 火山方舟',provider:'seedance',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'doubao-seedance-1-0-pro-250528',keyEnv:'ARK_API_KEY',source:'https://www.volcengine.com/docs/82379/1520757',params:{ratio:'16:9',resolution:'720p'}},
  {id:'kling',name:'可灵 · 官方 API',provider:'kling',baseUrl:'https://api.klingai.com/v1',model:'kling-v1-6',keyEnv:'KLING_ACCESS_KEY',secretEnv:'KLING_SECRET_KEY',source:'https://kling.ai/document-api/apiReference/model/textToVideo',params:{ratio:'16:9',mode:'std'}},
  {id:'veo',name:'Veo · Gemini API',provider:'veo',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'veo-3.1-generate-preview',keyEnv:'GEMINI_API_KEY',source:'https://ai.google.dev/gemini-api/docs/veo',params:{ratio:'16:9',resolution:'720p'}}
];
export function cloudPreset(id){const t=cloudTemplates.find(t=>t.id===id);requireValue(t,'模板不存在');return {...structuredClone(t),profile:t.name,workflow:{},bindings:{},outputNode:'',durationMode:'workflow'};}
export function validateCloud(c){validateEndpoint(c.baseUrl);validateEnv(c.keyEnv);if(c.provider==='kling')validateEnv(c.secretEnv);requireValue(typeof c.model==='string'&&/^[\w.-]{1,160}$/.test(c.model),'模型 ID 无效');requireValue(['16:9','9:16','1:1'].includes(c.params?.ratio),'画幅无效');if(c.provider==='kling')requireValue(['std','pro'].includes(c.params.mode),'可灵模式无效');else requireValue((c.provider==='veo'?['720p','1080p']:['480p','720p','1080p']).includes(c.params.resolution),'分辨率无效');if(c.provider==='veo')requireValue(c.params.ratio!=='1:1','Veo 不支持方形画幅');return c;}
export function cloudDuration(provider,duration){requireValue(Number.isInteger(duration),'云视频秒数须为整数');requireValue(provider==='kling'?[5,10].includes(duration):provider==='veo'?[4,6,8].includes(duration):duration>=4&&duration<=12,provider==='kling'?'可灵模板支持 5/10 秒':provider==='veo'?'Veo 模板支持 4/6/8 秒':'Seedance 模板支持 4–12 秒');}
function auth(c){const key=secretValue(c.keyEnv);requireValue(key,'请在设置中心配置 '+c.keyEnv);if(c.provider==='veo')return {'x-goog-api-key':key};if(c.provider==='kling'){const secret=secretValue(c.secretEnv);requireValue(secret,'请配置可灵 Secret Key');const now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:key,exp:now+1800,nbf:now-5})).toString('base64url'),body=head+'.'+payload;return {Authorization:'Bearer '+body+'.'+createHmac('sha256',secret).update(body).digest('base64url')};}return {Authorization:'Bearer '+key};}
export async function cloudVideo(c,prompt,duration,signal,onRemote,wait=delay,image=null){
  validateCloud(c);cloudDuration(c.provider,duration);const headers={'Content-Type':'application/json',...auth(c)};
  const b64=image?image.bytes.toString('base64'):'';
  const post=c.provider==='seedance'?['/contents/generations/tasks',{model:c.model,content:image?[{type:'text',text:prompt},{type:'image',role:'first_frame',image_url:`data:${image.mime};base64,${b64}`}]:[{type:'text',text:prompt}],duration,ratio:c.params.ratio,resolution:c.params.resolution}]:c.provider==='kling'?['/videos/'+(image?'image2video':'text2video'),{model_name:c.model,prompt,mode:c.params.mode||'std',duration:String(duration),aspect_ratio:c.params.ratio,...(image?{image:`data:${image.mime};base64,${b64}`}:{})}]:['/models/'+encodeURIComponent(c.model)+':predictLongRunning',{instances:[{prompt},...(image?[{image:{bytesBase64Encoded:b64,mimeType:image.mime}}]:[])],parameters:{aspectRatio:c.params.ratio,durationSeconds:duration,resolution:c.params.resolution}}];
  const submitted=await(await request(c.baseUrl,post[0],{method:'POST',headers,signal,body:JSON.stringify(post[1])})).json();
  const id=c.provider==='seedance'?submitted.id:c.provider==='kling'?submitted.data?.task_id:submitted.name;requireValue(typeof id==='string'&&id.length<500,'云服务未返回任务 ID，请检查模型权限和参数');onRemote(id);
  const statusPath=c.provider==='seedance'?'/contents/generations/tasks/'+encodeURIComponent(id):c.provider==='kling'?'/videos/'+(image?'image2video':'text2video')+'/'+encodeURIComponent(id):'/'+id.split('/').map(encodeURIComponent).join('/');
  for(let i=0;i<720;i++){
    const result=await(await request(c.baseUrl,statusPath,{headers:auth(c),signal})).json();
    const status=c.provider==='kling'?result.data?.task_status:result.status;
    requireValue(!result.error&&!['failed','cancelled','expired'].includes(status)&&!(result.code&&c.provider==='kling'),'云端视频生成失败，请在服务商控制台查看任务 '+id);
    let url=c.provider==='seedance'&&status==='succeeded'?result.content?.video_url:c.provider==='kling'&&status==='succeed'?result.data?.task_result?.videos?.[0]?.url:c.provider==='veo'&&result.done?result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri:null;
    if(url){const u=new URL(url);requireValue(u.protocol==='https:','云视频下载地址必须使用 HTTPS');const h={};if(c.provider==='veo'){requireValue(u.hostname==='generativelanguage.googleapis.com','Veo 下载域名不受信任');Object.assign(h,auth(c));}const response=await fetch(u,{headers:h,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});requireValue(response.ok,'下载生成视频失败');return response;}
    if(c.provider==='veo'&&result.done)throw new Error('Veo 未返回视频，可能被内容策略过滤');
    await wait(5000,undefined,{signal});
  }throw new Error('云端任务超时，请使用远端任务 ID 检查结果，避免重复计费');
}
