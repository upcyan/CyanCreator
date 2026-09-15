import {spawn} from 'node:child_process';
import {existsSync, openSync, closeSync} from 'node:fs';
import {mkdir, readdir, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {downloadFile} from './downloads.js';
import {llamaRuntime} from './model-catalog.js';
import {run} from './media.js';

export function deploymentDefaults(data) {
  const desktop=path.join(process.env.LOCALAPPDATA||'', 'Comfy-Desktop');
  const install=path.join(desktop,'ComfyUI-Installs','ComfyUI');
  const root=path.join(install,'ComfyUI'), python=path.join(install,'standalone-env','python.exe'), shared=path.join(desktop,'ComfyUI-Shared','models');
  return {comfyRoot:existsSync(path.join(root,'main.py'))?root:'',comfyPython:existsSync(python)?python:'',comfyModels:existsSync(shared)?shared:path.join(data,'models'),comfyUrl:'http://127.0.0.1:8188',gpuLayers:99,contextSize:8192};
}
export function validateDeploymentConfig(c) {
  for(const key of ['comfyRoot','comfyPython','comfyModels'])if(typeof c[key]!=='string'||c[key].length>2000||(c[key]&&!path.isAbsolute(c[key])))throw new Error('运行时路径必须是本机绝对路径');
  if(!c.comfyModels||c.comfyModels===path.parse(c.comfyModels).root)throw new Error('请选择具体模型目录');
  const u=new URL(c.comfyUrl);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||!u.port||u.pathname!=='/'||u.username||u.password||u.search||u.hash)throw new Error('自动部署仅支持本机 HTTP 服务与明确端口');
  for(const [key,min,max] of [['gpuLayers',0,999],['contextSize',1024,32768]])if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw new Error('推理参数范围无效');
  return Object.fromEntries(['comfyRoot','comfyPython','comfyModels','comfyUrl','gpuLayers','contextSize'].map(k=>[k,c[k]]));
}
async function jsonProbe(url) {try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});return r.ok?await r.json():null;}catch{return null;}}
async function findExe(dir,depth=0) {
  for(const item of await readdir(dir,{withFileTypes:true})){if(item.isFile()&&item.name==='llama-server.exe')return path.join(dir,item.name);}
  if(depth<3)for(const item of await readdir(dir,{withFileTypes:true})){if(item.isDirectory()){const found=await findExe(path.join(dir,item.name),depth+1);if(found)return found;}}
  return null;
}
const ps = value => "'"+value.replaceAll("'","''")+"'";
export class LocalRuntime {
  constructor(data){this.data=data;this.processes=new Map();}
  status(){return [...this.processes].map(([id,p])=>({id,pid:p.pid,running:p.exitCode===null&&!p.killed}));}
  stop(id){const p=this.processes.get(id);if(!p)throw new Error('此服务不是当前工作台启动的，请从其原运行时停止');p.kill();this.processes.delete(id);}
  async launch(id,exe,args,cwd,url,check,signal) {
    const current=await jsonProbe(url);if(current){if(check(current))return;throw new Error('端口已有其他模型服务，请先更换端口或停止该服务');}
    const logs=path.join(this.data,'runtime-logs');await mkdir(logs,{recursive:true});
    const handle=openSync(path.join(logs,id+'.log'),'a');
    const child=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore',handle,handle]});closeSync(handle);
    this.processes.set(id,child);let error;child.on('error',e=>{error=e;});
    try {
      for(let i=0;i<240;i++){
        signal.throwIfAborted();if(error||child.exitCode!==null)throw new Error('运行时启动失败，请检查 runtime-logs/'+id+'.log');
        const data=await jsonProbe(url);if(data&&check(data))return;
        await delay(500,undefined,{signal});
      }
      throw new Error('模型加载超时，请降低上下文或 GPU 层数后重试');
    } catch(e){child.kill();this.processes.delete(id);throw e;}
  }
  async startText(entry,file,config,signal,onProgress) {
    if(process.platform!=='win32'||process.arch!=='x64')throw new Error('内置 llama.cpp 自动安装目前支持 Windows x64；其他系统可手动配置兼容服务');
    const runtimeRoot=path.join(this.data,'runtimes');
    const archive=await downloadFile(llamaRuntime,runtimeRoot,{signal,onProgress});
    const target=path.join(runtimeRoot,llamaRuntime.id);
    if(!existsSync(path.join(target,'.ready'))){
      const staging=path.join(runtimeRoot,'extract-'+randomUUID());await mkdir(staging,{recursive:true});
      await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${ps(archive)} -DestinationPath ${ps(staging)} -ErrorAction Stop`],signal);
      if(!await findExe(staging))throw new Error('运行时归档缺少 llama-server.exe');
      await writeFile(path.join(staging,'.ready'),llamaRuntime.sha256);await rename(staging,target);
    }
    const exe=await findExe(target);if(!exe)throw new Error('本地推理程序缺失');
    const base=`http://127.0.0.1:${entry.port}`;
    await this.launch(entry.id,exe,['--model',file,'--alias',entry.id,'--host','127.0.0.1','--port',String(entry.port),'--cors-origins','localhost','--no-cors-credentials','--ctx-size',String(config.contextSize),'--n-gpu-layers',String(config.gpuLayers),'--jinja'],path.dirname(exe),base+'/v1/models',data=>data.data?.some(m=>m.id===entry.id),signal);
    return {id:'deployed-'+entry.id,name:entry.name+' · 本地',baseUrl:base+'/v1',model:entry.id,keyEnv:'',temperature:0.7,maxTokens:Math.min(4096,Math.floor(config.contextSize/2))};
  }
  async ensureVideo(config,signal) {
    if(await jsonProbe(config.comfyUrl+'/system_stats'))return;
    if(!existsSync(config.comfyPython)||!existsSync(path.join(config.comfyRoot,'main.py')))throw new Error('未发现 ComfyUI 运行时，请设置已安装的 ComfyUI 根目录与 Python 路径');
    const runtimeRoot=path.join(this.data,'runtimes');await mkdir(runtimeRoot,{recursive:true});
    const paths=path.join(runtimeRoot,'comfy-model-paths.yaml');
    const map={cyancreator:{base_path:config.comfyModels,diffusion_models:'diffusion_models/',text_encoders:'text_encoders/',vae:'vae/'}};
    // JSON is valid YAML and avoids interpolating user paths into YAML syntax.
    await writeFile(paths,JSON.stringify(map,null,2));
    await this.launch('comfy',config.comfyPython,[path.join(config.comfyRoot,'main.py'),'--listen','127.0.0.1','--port',new URL(config.comfyUrl).port,'--extra-model-paths-config',paths,'--disable-all-custom-nodes'],config.comfyRoot,config.comfyUrl+'/system_stats',data=>Array.isArray(data.devices),signal);
  }
}
