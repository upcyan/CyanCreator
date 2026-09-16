import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requireValue,number,validateEndpoint,validateEnv} from './core.js';
import {runNativeCommand} from './native-video.js';
import {downloadFile} from './downloads.js';
import {request} from './providers.js';
import {secretValue} from './secrets.js';
export const speechDefaults=()=>({provider:'piper',model:'zh_CN-huayan-medium',voice:'zh_CN-huayan-medium',baseUrl:'https://api.openai.com/v1',keyEnv:'TTS_API_KEY',speed:1});
export function validateSpeech(c){requireValue(c&&['piper','compatible','elevenlabs'].includes(c.provider),'语音接入方式无效');number(c.speed,0.5,2,'语速');for(const k of ['model','voice'])requireValue(typeof c[k]==='string'&&c[k].length<=160,'语音模型或音色无效');if(c.provider==='piper')requireValue(c.model==='zh_CN-huayan-medium','当前本地模板为中文 huayan');else{validateEndpoint(c.baseUrl);validateEnv(c.keyEnv);requireValue(c.model&&c.voice,'请填写模型和音色 ID');}return c;}
const modelName='zh_CN-huayan-medium.onnx',base='https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/zh/zh_CN/huayan/medium/';
const assets=[{target:modelName,url:base+modelName,size:63201294,sha256:'9929917bf8cabb26fd528ea44d3a6699c11e87317a14765312420be230be0f3d'},{target:modelName+'.json',url:base+modelName+'.json',size:4822,sha256:'d521dc45504a8ccc99e325822b35946dd701840bfb07e3dbb31a40929ed6a82b'}];
export class SpeechRuntime{
  constructor(data){this.data=data;this.root=path.join(data,'runtimes','piper');this.python=path.join(this.root,process.platform==='win32'?'Scripts/python.exe':'bin/python');this.model=path.join(data,'models','speech',modelName);}
  async prepare(config,signal,progress){
    requireValue(config.nativePython&&existsSync(config.nativePython),'请在部署设置选择 Python 3.12');await mkdir(path.dirname(this.root),{recursive:true});
    if(!existsSync(this.python)){progress({message:'创建独立语音环境'});await runNativeCommand(config.nativePython,['-m','venv',this.root],{signal});}
    if(!existsSync(path.join(this.root,'ready-1.8.0'))){progress({message:'安装 Piper 1.8.0 CPU 推理运行时'});await runNativeCommand(this.python,['-m','pip','install','--index-url','https://pypi.org/simple','piper-tts==1.8.0'],{signal});await runNativeCommand(this.python,['-m','pip','check'],{signal});await writeFile(path.join(this.root,'ready-1.8.0'),'ok');}
    for(const asset of assets)await downloadFile(asset,path.dirname(this.model),{signal,onProgress:p=>progress({...p,message:'下载并校验中文语音模型'})});
    await runNativeCommand(this.python,['-c','from piper import PiperVoice; import sys; PiperVoice.load(sys.argv[1])',this.model],{signal});return {ready:true};
  }
  async generate(config,text,output,signal){requireValue(existsSync(this.python)&&existsSync(this.model),'请先部署本地语音模型');await runNativeCommand(this.python,['-u',fileURLToPath(new URL('../native/speech_worker.py',import.meta.url))],{signal,input:{model:this.model,text,output,speed:config.speed}});return output;}
}
export async function cloudSpeech(c,text,signal){validateSpeech(c);const key=secretValue(c.keyEnv);requireValue(key,'请在设置中心配置语音密钥');const eleven=c.provider==='elevenlabs';return request(c.baseUrl,eleven?'/text-to-speech/'+encodeURIComponent(c.voice):'/audio/speech',{method:'POST',signal,headers:{'Content-Type':'application/json',...(eleven?{'xi-api-key':key}:{Authorization:'Bearer '+key})},body:JSON.stringify(eleven?{text,model_id:c.model,voice_settings:{speed:c.speed}}:{model:c.model,voice:c.voice,input:text,speed:c.speed,response_format:'wav'})});}
