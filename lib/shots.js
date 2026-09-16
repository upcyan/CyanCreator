import {cloudDuration} from './cloud-video.js';
import {validateNative} from './native-video.js';
import {buildWorkflow} from './core.js';
import {videoFrames} from './video-presets.js';
const fields=['seed','steps','cfg','width','height','negative'];
export function videoCapabilities(config){return config.provider==='native'?fields:config.provider==='comfy'?fields.filter(k=>config.bindings[k]):[];}
export function shotConfig(config,shot){
  const result=structuredClone(config),g=shot.generation;
  if(g&&g.provider===config.provider&&g.model===config.model){
    const allowed=videoCapabilities(config);if(Object.keys(g.params).some(k=>!allowed.includes(k)))throw new Error('镜头含当前模型不支持的参数，请重新保存');
    Object.assign(result.params,g.params);
  }
  if(['native','comfy'].includes(result.provider)&&['h3','wan'].includes(result.durationMode))result.params.frames=videoFrames(result.durationMode,shot.duration);
  if(result.provider==='native')validateNative(result);else if(result.provider==='comfy')buildWorkflow(result,shot.prompt);
  else if(['seedance','kling','veo'].includes(result.provider))cloudDuration(result.provider,shot.duration);
  else if(![6,10].includes(shot.duration))throw new Error('MiniMax 云端镜头时长需为 6 或 10 秒');
  return result;
}
export function editShot(original,input,config){
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>20000)throw new Error('请填写有效镜头提示词（最多 20000 字符）');
  if(typeof input.duration!=='number'||!Number.isFinite(input.duration)||input.duration<4||input.duration>15)throw new Error('镜头时长须为 4–15 秒');
  const params=input.params||{},allowed=videoCapabilities(config);
  for(const [key,value] of Object.entries(params)){
    if(!allowed.includes(key))throw new Error('当前后端不支持：'+key);
    if(key==='negative'){if(typeof value!=='string'||value.length>10000)throw new Error('负面提示词无效');continue;}
    const [min,max]=key==='seed'?[0,2147483647]:key==='steps'?[1,100]:key==='cfg'?[0,20]:[64,1280];
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(key!=='cfg'&&!Number.isInteger(value))||(['width','height'].includes(key)&&value%16))throw new Error('镜头参数无效：'+key);
  }
  const shot={...original,prompt:input.prompt,duration:input.duration,generation:{provider:config.provider,model:config.model,params}};
  shotConfig(config,shot);return shot;
}
