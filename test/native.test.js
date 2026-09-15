import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {nativePreset,validateNative,NativeVideo,runNativeCommand} from '../lib/native-video.js';
import {editShot,shotConfig,videoCapabilities} from '../lib/shots.js';
import {wanPreset} from '../lib/video-presets.js';
test('原生环境旧标记触发同步，成功复用，失败后可以重试',async()=>{
  await mkdir('test-output',{recursive:true});
  const data=await mkdtemp(path.resolve('test-output/env-')),calls=[];
  let fail=false;
  const native=new NativeVideo(data,async(exe,args)=>{calls.push(args);if(fail&&args.includes('install'))throw new Error('install failed');return {ready:true};});
  const config={nativePython:process.execPath,nativeDevice:'cuda'},python=native.python(config),marker=path.join(path.dirname(path.dirname(python)),'cyancreator-ready-v1');
  await mkdir(path.dirname(python),{recursive:true});await writeFile(python,'fixture');await writeFile(marker,'v1');
  await native.prepare(config);assert.equal(calls.filter(a=>a.includes('install')).length,2);
  calls.length=0;await native.prepare(config);assert.equal(calls.filter(a=>a.includes('install')).length,0);
  await writeFile(marker,'stale');fail=true;await assert.rejects(native.prepare(config),/install failed/);assert.equal(native.installing,false);
  fail=false;calls.length=0;await native.prepare(config);assert.equal(calls.filter(a=>a.includes('install')).length,2);
});
test('原生参数、镜头覆盖、帧数对齐与不同模型隔离',()=>{
  const c=nativePreset(),shot=editShot({prompt:'old',duration:5},{prompt:'rainy shop',duration:6,params:{seed:12,steps:8,width:640,height:368,negative:'watermark'}},c),snapshot=shotConfig(c,shot);
  assert.equal(snapshot.params.frames,97);assert.equal(snapshot.params.seed,12);assert.equal(c.params.seed,42);
  assert.throws(()=>shotConfig({...c,model:'another'}, {...shot,generation:null}),/暂支持/);
});
test('原生参数严格校验，不支持的能力不可提交',()=>{
  const c=nativePreset();assert.throws(()=>validateNative({...c,params:{...c.params,width:641}}),/倍数/);
  assert.throws(()=>editShot({}, {prompt:'p',duration:5,params:{referenceImage:'x'}},c),/不支持/);
  const comfy=wanPreset();assert.ok(videoCapabilities(comfy).includes('negative'));
  assert.equal(shotConfig(comfy,{prompt:'p',duration:5,generation:{provider:'native',model:c.model,params:{seed:99}}}).params.seed,42);
});
test('原生进程协议传递进度、传播失败、可取消',async()=>{
  const events=[];const r=await runNativeCommand(process.execPath,['-e',`console.log(JSON.stringify({type:'progress',step:1}));console.log(JSON.stringify({type:'result',ready:true}));`],{onEvent:e=>events.push(e)});
  assert.equal(r.ready,true);assert.equal(events[0].step,1);
  await assert.rejects(runNativeCommand(process.execPath,['-e',`console.log(JSON.stringify({type:'error',message:'GPU failure'}));process.exit(1);`]),/GPU failure/);
  const controller=new AbortController(),pending=runNativeCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});controller.abort();await assert.rejects(pending);
});
test('原生生成不请求 ComfyUI，成功返回文件、失败清理临时目录',async()=>{
  await mkdir('test-output',{recursive:true});const root=await mkdtemp(path.resolve('test-output/native-'));
  let payload;const native=new NativeVideo(root,async(exe,args,{input,onEvent})=>{payload=input;onEvent?.({type:'progress',step:1,total:1});await writeFile(input.output,'fixture');return {};});
  native.check=async()=>({ready:true});const output=await native.generate(nativePreset(),{nativeDevice:'cpu'},'prompt',new AbortController().signal,()=>{});
  assert.equal(payload.mode,'generate');assert.equal(payload.prompt,'prompt');assert.equal(payload.params.steps,20);assert.equal((await stat(output.file)).size,7);
  await output.cleanup();await assert.rejects(stat(output.file));assert.equal(native.generating,false);
  native.run=async()=>{throw Error('out of memory');};await assert.rejects(native.generate(nativePreset(),{nativeDevice:'cpu'},'p',new AbortController().signal,()=>{}),/out of memory/);assert.equal(native.generating,false);
});
