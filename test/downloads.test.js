import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {downloadFile,safeTarget,officialFetch} from '../lib/downloads.js';
import {Deployments} from '../lib/deployments.js';
import {defaults,buildWorkflow} from '../lib/core.js';
import {videoPreset,videoFrames} from '../lib/video-presets.js';
const data=Buffer.from('model fixture with known digest');
const asset={url:'https://huggingface.co/example/model',target:'text/model.bin',size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
async function folder(){await mkdir('test-output',{recursive:true});return mkdtemp(path.resolve('test-output/download-'));}
test('下载校验、Range 续传、忽略 Range 时重新下载及缓存复用',async()=>{
  for(const resume of [true,false]){
    const root=await folder();await safeTarget(root,asset.target);await writeFile(path.join(root,asset.target+'.part'),data.subarray(0,7));let calls=0;
    const file=await downloadFile(asset,root,{fetchImpl:async(url,o)=>{calls++;assert.equal(o.headers.Range,'bytes=7-');return resume?new Response(data.subarray(7),{status:206,headers:{'Content-Range':`bytes 7-${data.length-1}/${data.length}`}}):new Response(data);}});
    assert.deepEqual(await readFile(file),data);assert.equal(calls,1);
    await downloadFile(asset,root,{fetchImpl:()=>{throw Error('must use verified cache');}});
  }
});
test('拒绝路径越界、恶意跳转和错误摘要，保护已有模型',async()=>{
  const root=await folder();await assert.rejects(safeTarget(root,'../outside'),/路径/);
  await assert.rejects(officialFetch(asset.url,{},async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})),/官方分发域/);
  await assert.rejects(downloadFile({...asset,sha256:'0'.repeat(64)},root,{fetchImpl:async()=>new Response(data)}),/SHA-256/);
  await assert.rejects(stat(path.join(root,asset.target+'.part')),e=>e.code==='ENOENT');
  await writeFile(path.join(root,asset.target),'existing user file');
  await assert.rejects(downloadFile(asset,root),/已有模型文件/);assert.equal(await readFile(path.join(root,asset.target),'utf8'),'existing user file');
});
test('取消保留分段文件，续传范围错误不污染已有分段',async()=>{
  const root=await folder(),controller=new AbortController();
  await assert.rejects(downloadFile(asset,root,{signal:controller.signal,onProgress:()=>controller.abort(),fetchImpl:async()=>new Response(data)}));
  await writeFile(path.join(root,asset.target+'.part'),data.subarray(0,3));
  await assert.rejects(downloadFile(asset,root,{fetchImpl:async()=>new Response(data,{status:206,headers:{'Content-Range':`bytes 0-${data.length-1}/${data.length}`}})}),/续传范围/);
  assert.deepEqual(await readFile(path.join(root,asset.target+'.part')),data.subarray(0,3));
});
test('部署失败不创建配置；成功可复用；重启中断、取消和配置快照',async()=>{
  const root=await folder(),state={settings:defaults(),deployments:[{id:'old',status:'running'}]};let fail=true,release;
  const runtime={status:()=>[],startText:async()=>{if(fail)throw Error('load failed');return {id:'deployed-qwen25-small',model:'qwen25-small'};}};
  const manager=new Deployments(state,root,()=>{},{runtime,download:async()=>'/fixture/model'});
  assert.equal(state.deployments[0].status,'interrupted');
  const wait=async j=>{while(['running','queued'].includes(j.status))await new Promise(r=>setTimeout(r,5));};
  let j=manager.enqueue('qwen25-small');await wait(j);assert.equal(j.status,'failed');assert.equal(state.settings.text.profiles.length,1);
  fail=false;j=manager.enqueue('qwen25-small');await wait(j);assert.equal(j.status,'succeeded');assert.equal(state.settings.text.profiles.length,2);
  j=manager.enqueue('qwen25-small');await wait(j);assert.equal(state.settings.text.profiles.length,2);
  manager.download=async(a,r,{signal})=>new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(signal.reason));});
  j=manager.enqueue('qwen25-small');state.deploymentConfig.gpuLayers=0;assert.equal(j.config.gpuLayers,99);
  assert.throws(()=>manager.enqueue('qwen25-small'),/已在部署/);manager.cancel(j.id);await wait(j);assert.equal(j.status,'cancelled');
});
test('Wan 与 H3 独立工作流和时长换算',()=>{
  const wan=videoPreset('wan21'),h3=videoPreset('minimax-h3');
  assert.equal(videoFrames('wan',5),81);assert.equal(videoFrames('h3',5),124);
  assert.equal(buildWorkflow(wan,'wan prompt')['4'].inputs.text,'wan prompt');
  assert.notEqual(wan.workflow['1'].inputs.unet_name,h3.workflow['1'].inputs.unet_name);
});
