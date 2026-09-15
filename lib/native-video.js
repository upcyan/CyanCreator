import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,stat,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {nativeWan} from './native-catalog.js';

const worker=fileURLToPath(new URL('../native/wan_worker.py',import.meta.url));
const requirements=fileURLToPath(new URL('../native/requirements.txt',import.meta.url));
export function nativePreset(){return {provider:'native',model:'wan21-native',catalogId:'wan21-native',baseUrl:'http://127.0.0.1:3210',keyEnv:'',profile:'Wan 2.1 · 原生 Diffusers',durationMode:'wan',workflow:{},bindings:{},outputNode:'',params:{seed:42,steps:20,cfg:6,width:832,height:480,frames:81,negative:'blurry, distorted, watermark, subtitles',dtype:'bfloat16',offload:'sequential',vaeTiling:true}};}
export function validateNative(c){
  if(c.model!=='wan21-native')throw new Error('原生后端暂支持 Wan 2.1 1.3B');
  const p=c.params;
  for(const [k,min,max] of [['seed',0,2147483647],['steps',1,100],['cfg',0,20],['width',64,1280],['height',64,1280],['frames',5,241]])if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<min||p[k]>max||(k!=='cfg'&&!Number.isInteger(p[k])))throw new Error('原生参数无效：'+k);
  if(p.width%16||p.height%16||(p.frames-1)%4)throw new Error('宽高必须是 16 的倍数；帧数须为 4k+1');
  if(!['bfloat16','float16'].includes(p.dtype)||!['model','sequential','none'].includes(p.offload)||typeof p.vaeTiling!=='boolean'||typeof p.negative!=='string'||p.negative.length>10000)throw new Error('原生精度、卸载或负面提示词配置无效');
  const allowed=['seed','steps','cfg','width','height','frames','negative','dtype','offload','vaeTiling'];
  if(Object.keys(p).some(k=>!allowed.includes(k)))throw new Error('包含原生后端不支持的参数');
  return c;
}
export function runNativeCommand(exe,args,{signal,input,onEvent=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{windowsHide:true,signal,env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},stdio:['pipe','pipe','pipe']});
    let tail='',pending='',result;
    child.stderr.on('data',d=>{tail=(tail+d).slice(-3000);});
    child.stdout.on('data',d=>{pending+=d;let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);try{const event=JSON.parse(line);if(event.type==='result')result=event;else if(event.type==='error')tail=event.message;else onEvent(event);}catch{tail=(tail+'\n'+line).slice(-3000);}}});
    child.stdin.on('error',()=>{});child.on('error',reject);
    child.on('close',code=>{if(signal?.aborted)return reject(signal.reason);code===0?resolve(result||{}):reject(new Error(tail||`独立运行时退出 (${code})`));});
    child.stdin.end(input===undefined?'':JSON.stringify(input));
  });
}
export class NativeVideo {
  constructor(data,run=runNativeCommand){this.data=data;this.run=run;this.installing=false;this.generating=false;}
  root(){return path.join(this.data,'models','wan21-native');}
  python(config){return path.join(this.data,'runtimes','wan-diffusers-'+(config.nativeDevice||'cuda'),process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');}
  async prepare(config,signal,onProgress=()=>{}){
    if(this.installing||this.generating)throw new Error('原生环境正在安装或生成，请稍后重试');
    if(!config.nativePython||!existsSync(config.nativePython))throw new Error('请选择独立 Python 3.12 可执行文件；无需安装 ComfyUI');
    this.installing=true;
    try{
      const python=this.python(config),folder=path.dirname(path.dirname(python));await mkdir(path.dirname(folder),{recursive:true});
      await this.run(config.nativePython,['-c','import sys; assert sys.version_info[:2] == (3,12), "Please select Python 3.12"'],{signal});
      if(!existsSync(python)){onProgress({phase:'starting',file:'创建独立 Python 环境'});await this.run(config.nativePython,['-m','venv',folder],{signal});}
      const marker=path.join(folder,'cyancreator-ready-v1');
      const fingerprint=createHash('sha256').update(await readFile(requirements)).update('torch==2.8.0|python3.12|'+(config.nativeDevice||'cuda')).digest('hex');
      if((await readFile(marker,'utf8').catch(()=>''))!==fingerprint){
        onProgress({phase:'starting',file:'安装 PyTorch 2.8（首次需下载依赖，详见网络速度）'});
        await this.run(python,['-m','pip','install','--disable-pip-version-check','torch==2.8.0','--index-url',config.nativeDevice==='cpu'?'https://download.pytorch.org/whl/cpu':'https://download.pytorch.org/whl/cu128'],{signal});
        onProgress({phase:'starting',file:'安装 Diffusers 与模型依赖'});
        await this.run(python,['-m','pip','install','--disable-pip-version-check','--index-url','https://pypi.org/simple','-r',requirements],{signal});
        await this.run(python,['-m','pip','check'],{signal});await writeFile(marker,fingerprint);
      }
      return await this.environment(config,signal);
    }finally{this.installing=false;}
  }
  async environment(config,signal){
    const python=this.python(config);if(!existsSync(python))throw new Error('原生环境尚未安装，请先在模型库安装独立运行时');
    return this.run(python,['-u',worker],{signal,input:{mode:'check',device:config.nativeDevice||'cuda'}});
  }
  async check(config,signal){
    const environment=await this.environment(config,signal),missing=[];
    for(const asset of nativeWan.assets){const s=await stat(path.join(this.root(),asset.target)).catch(()=>null);if(!s||s.size!==asset.size)missing.push(asset.target);}
    return {...environment,ready:missing.length===0,missing,note:'环境与文件检查；模型加载和画质需实际生成验证。'};
  }
  async generate(config,deployment,prompt,signal,onEvent){
    validateNative(config);if(this.installing||this.generating)throw new Error('原生运行时忙，请稍后重试');
    this.generating=true;const folder=path.join(this.data,'native-jobs',randomUUID());
    const file=path.join(folder,'output.mp4');
    try{
      await mkdir(folder,{recursive:true});
      const check=await this.check(deployment,signal);if(!check.ready)throw new Error('原生权重未就绪：'+check.missing.join('、'));
      await this.run(this.python(deployment),['-u',worker],{signal,onEvent,input:{mode:'generate',device:deployment.nativeDevice||'cuda',modelDir:this.root(),output:file,prompt,params:config.params}});
      if(!existsSync(file))throw new Error('原生推理未生成视频文件');return {file,cleanup:()=>rm(folder,{recursive:true,force:true})};
    }catch(e){await rm(folder,{recursive:true,force:true});throw e;}finally{this.generating=false;}
  }
}
