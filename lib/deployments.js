import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {catalogEntry} from './model-catalog.js';
import {downloadFile} from './downloads.js';
import {LocalRuntime, deploymentDefaults, validateDeploymentConfig} from './local-runtime.js';
import {videoPreset} from './video-presets.js';
import {preflight} from './providers.js';
import {NativeVideo} from './native-video.js';

export class Deployments {
  constructor(state,data,persist,deps={}) {
    this.state=state;this.data=data;this.persist=persist;this.runtime=deps.runtime||new LocalRuntime(data);
    this.download=deps.download||downloadFile;this.check=deps.check||preflight;this.native=deps.native||new NativeVideo(data);this.controllers=new Map();this.pumping=false;
    state.deploymentConfig=validateDeploymentConfig(state.deploymentConfig||deploymentDefaults(data));
    state.deployments??=[];
    for(const j of state.deployments)if(['queued','running'].includes(j.status)){j.status='interrupted';j.error='工作台重启；点击重试将校验并续传已有文件。';}
  }
  enqueue(modelId) {
    catalogEntry(modelId);
    if(this.state.deployments.some(j=>j.modelId===modelId&&['queued','running'].includes(j.status)))throw new Error('该模型已在部署队列中');
    if(this.state.deployments.filter(j=>['queued','running'].includes(j.status)).length>=10)throw new Error('部署队列已满');
    const job={id:randomUUID(),modelId,status:'queued',createdAt:new Date().toISOString(),config:structuredClone(this.state.deploymentConfig)};
    this.state.deployments.unshift(job);this.persist();void this.pump();return job;
  }
  cancel(id) {
    const j=this.state.deployments.find(j=>j.id===id);
    if(!j||!['queued','running'].includes(j.status))throw new Error('部署任务已经结束');
    if(j.status==='queued'){j.status='cancelled';this.persist();}else this.controllers.get(id)?.abort();
  }
  async pump() {
    if(this.pumping)return;this.pumping=true;
    try {let j;while((j=this.state.deployments.findLast(j=>j.status==='queued'))){
      const controller=new AbortController(),signal=controller.signal;this.controllers.set(j.id,controller);j.status='running';this.persist();
      try {
        const entry=catalogEntry(j.modelId),root=entry.runtime==='native'?this.native.root():entry.kind==='text'?path.join(this.data,'models'):j.config.comfyModels;
        let last=0;
        const progress=p=>{j.progress=p;if(Date.now()-last>500){last=Date.now();this.persist();}};
        if(entry.runtime==='native')await this.native.prepare(j.config,signal,progress);
        else if(entry.kind==='video'){progress({phase:'starting',file:'ComfyUI'});await this.runtime.ensureVideo(j.config,signal);}
        const files=[];
        for(const [index,asset] of entry.assets.entries())files.push(await this.download(asset,root,{signal,onProgress:p=>progress({...p,file:asset.target,index:index+1,count:entry.assets.length})}));
        signal.throwIfAborted();progress({phase:'starting',file:entry.name});this.persist();
        if(entry.kind==='text') {
          const profile=await this.runtime.startText(entry,files[0],j.config,signal,p=>progress({...p,file:'llama.cpp Vulkan 运行时'}));
          signal.throwIfAborted();
          if(!this.state.settings.text.profiles.some(p=>p.id===profile.id))this.state.settings.text.profiles.push(profile);
          j.profileId=profile.id;j.note='服务已响应 /v1/models；可在共享模型配置中分配给三个阶段。';
        } else if(entry.runtime==='native'){
          const result=entry.kind==='runtime'?await this.native.environment(j.config,signal):await this.native.check(j.config,signal);
          if(!result.ready)throw new Error('原生文件检查失败：'+result.missing.join('、'));
          j.presetId=entry.kind==='video'?entry.id:undefined;j.note=entry.kind==='runtime'?'独立环境可用；下一步下载原生 Wan 权重。':'原生环境与权重已就绪，生成时按需加载模型。';
        } else {
          const result=await this.check({...videoPreset(entry.id),baseUrl:j.config.comfyUrl});signal.throwIfAborted();
          if(!result.ready)throw new Error('权重已保存，但工作流检查失败：'+result.missing.join('；'));
          j.presetId=entry.id;j.note='节点与权重检查通过；实际显存与视频生成需提交镜头验证。';
        }
        j.status='succeeded';j.progress={phase:'ready'};
      }catch(e){j.status=signal.aborted?'cancelled':'failed';j.error=signal.aborted?'已取消，未完成文件保留供续传。':e.message;}
      finally{j.finishedAt=new Date().toISOString();this.controllers.delete(j.id);this.persist();}
    }}finally{this.pumping=false;}
  }
  close(){for(const c of this.controllers.values())c.abort();for(const {id} of this.runtime.status())this.runtime.stop(id);}
}
