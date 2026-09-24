import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {run, inspect, ffmpegPath} from '../lib/media.js';
import {mkdir} from 'node:fs/promises';

const ffmpeg=ffmpegPath();
test('真实 HTTP 工作流、版本冲突、Comfy 协议、媒体导入和 FFmpeg 导出', {timeout:90000}, async t => {
  const root=path.resolve('test-output');await mkdir(root,{recursive:true});const folder=await mkdtemp(path.join(root,'run-'));
  const input=path.join(folder,'sample.mp4');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
  const silent=path.join(folder,'silent.mp4');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=green:size=180x320:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p',silent]);
  const video=await readFile(input);let hold=false, receivedGraph, textRequests=[];
  const fixture=http.createServer(async(req,res)=>{
    const reply=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
    if(req.url==='/v1/chat/completions') {
      let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);textRequests.push(b);if(hold)await delay(400);
      const prompt=b.messages[0].content;
      const output=prompt.includes('故事架构师')?{logline:'最后一盘磁带',beats:[{title:'发现',summary:'听见未来'}]}:prompt.includes('编剧与分镜')?{scenes:[{title:'磁带店 / 夜',action:'青年按下播放键',dialogue:'明天见。',shots:[{prompt:'a quiet tape repair shop at night',duration:5}]}]}:{issues:[],summary:'未发现问题'};
      return reply({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
    }
    if(req.url==='/upload/image'&&req.method==='POST'){for await(const c of req)void c;return reply({name:'cyan-fixture.png',subfolder:''});}
    if(req.url.startsWith('/object_info/')){const t=decodeURIComponent(req.url.split('/object_info/')[1]);const spec={LoadImage:{image:[['a.png','b.png']]},Text:{},Sampler:{},WanImageToVideo:{},CLIPVisionLoader:{clip_name:[['cv.safetensors','clip_vision_h.safetensors']]},CLIPVisionEncode:{},EmptyHunyuanLatentVideo:{},ModelSamplingSD3:{},KSampler:{},UNETLoader:{},CLIPLoader:{},VAELoader:{},CLIPTextEncode:{},VAEDecode:{},CreateVideo:{},SaveVideo:{}};return reply({[t]:spec[t]?{input:{required:spec[t]}}:null});}
    if(req.url==='/prompt') {let raw='';for await(const c of req)raw+=c;receivedGraph=JSON.parse(raw).prompt;return reply({prompt_id:'fixture-prompt',node_errors:{}});}
    if(req.url==='/history/fixture-prompt'){const i2v=JSON.stringify(receivedGraph||{}).includes('CyanCreator_WanI2V');const outputs=i2v?{'13':{images:[{filename:'sample2.mp4',type:'output'}]}}:{'9':{videos:[{filename:'sample.mp4',type:'output'}]}};return reply({'fixture-prompt':{status:{completed:true,status_str:'success'},outputs}});}
    if(req.url.startsWith('/view?')){res.setHeader('Content-Type','video/mp4');return res.end(video);}
    if(req.url==='/v1/models')return reply({data:[{id:'fixture-model'}]});
    if(req.url.startsWith('/object_info/')){const type=req.url.split('/').at(-1);return reply({[type]:{input:{required:{}}}});}
    res.statusCode=404;res.end();
  });
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');t.after(()=>fixture.close());
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'0',CYANCREATOR_DATA:path.join(folder,'data')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  let logs='';child.stderr.on('data',x=>logs+=x);
  const base=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',code=>reject(new Error(`startup ${code}: ${logs}`)));});
  let state=await(await fetch(base+'/api/state')).json(), token=state.token;
  for(const asset of ['/','/app.js','/style.css','/video-workbench.js','/native-settings.js']){const response=await fetch(base+asset);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');await response.arrayBuffer();}
  async function call(url,method='GET',body) {const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Workspace-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
  const latest=async()=>{state=await call('/api/state');return state.projects[0];};
  assert.equal(state.catalog.length,6);
  const wan=await call('/api/video-presets/wan21');assert.equal(wan.durationMode,'wan');
  const badDeploy=await fetch(base+'/api/deployments',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({modelId:'arbitrary-model'})});assert.equal(badDeploy.status,400);
  await call('/api/deployment/config','PUT',state.deploymentConfig);
  const badConfig=await fetch(base+'/api/deployment/config',{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({...state.deploymentConfig,comfyUrl:'http://remote.example:8188'})});assert.equal(badConfig.status,400);
  assert.equal((await fetch(base+'/model-hub.js')).status,200);
  const wait=async id=>{for(let i=0;i<160;i++){await latest();const j=state.jobs.find(j=>j.id===id);if(!['queued','running'].includes(j.status))return j;await delay(100);}throw new Error('job timeout');};
  let p=await call('/api/projects','POST',{name:'Integration fixture'});
  p=await call(`/api/projects/${p.id}`,'PUT',{revision:p.revision,brief:'一位修磁带的人听见未来',bible:'主角始终穿绿色夹克'});
  p=await call(`/api/projects/${p.id}/draft`,'POST',{revision:p.revision,brief:p.brief,bible:p.bible,characters:[{id:'fixture-char',name:'主角'}],worldbook:[]});assert.equal(p.characters.length,1);
  const bad=await fetch(base+`/api/projects/${p.id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({revision:1,brief:'stale'})});assert.equal(bad.status,409);
  const csrf=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"bad"}'});assert.equal(csrf.status,403);
  const settings=state.settings, endpoint=`http://127.0.0.1:${fixture.address().port}`;
  for(const c of settings.text.profiles){c.baseUrl=endpoint+'/v1';c.model='fixture-model';}
  settings.video={...settings.video,durationMode:'workflow',outputNode:'',baseUrl:endpoint,workflow:{'1':{class_type:'Text',inputs:{text:''}},'2':{class_type:'Sampler',inputs:{steps:20}}},bindings:{prompt:{node:'1',input:'text'},steps:{node:'2',input:'steps'}},params:{steps:8}};
  await call('/api/settings','PUT',settings);
  const probed=await call('/api/probe','POST',{kind:'text',profileId:settings.text.profiles[0].id});assert.deepEqual(probed.models,['fixture-model']);
  for(const kind of ['outline','script','review']){const {id}=await call('/api/jobs','POST',{projectId:p.id,kind});const j=await wait(id);assert.equal(j.status,'succeeded',j.error);assert.equal(j.applied,true);}
  assert.deepEqual(textRequests.map(r=>r.model),['fixture-model','fixture-model','fixture-model']);
  assert.deepEqual(textRequests.map(r=>r.temperature),[0.7,0.7,0.2]);
  assert.match(textRequests[1].messages[1].content,/绿色夹克/);assert.match(textRequests[1].messages[1].content,/听见未来/);
  const outlined=state.jobs.find(j=>j.kind==='outline'&&j.applied);assert.ok(outlined);
  const rawState=JSON.parse(await readFile(path.join(folder,'data','workspace.json'),'utf8'));
  const rawJob=rawState.jobs.find(j=>j.id===outlined.id);
  assert.ok(rawJob.snapshot.characters.some(c=>c.id==='fixture-char'),'snapshot must carry shared library');
  assert.equal(rawJob.snapshot.name,'Integration fixture');
  assert.ok(!('id' in rawJob.snapshot),'snapshot must be minimal, not a full project clone');
  const generated=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'video',scene:0,shot:0})).id);
  assert.equal(generated.status,'succeeded',generated.error);assert.equal(receivedGraph['2'].inputs.steps,8);assert.equal(receivedGraph['1'].inputs.text,'a quiet tape repair shop at night\n场景：磁带店 / 夜');
  p=await latest();const scriptVersion=p.scriptVersion;
  p=await call(`/api/projects/${p.id}/shots/0/0/edit`,'POST',{revision:p.revision,prompt:'revised rainy shop',duration:5,params:{steps:9}});
  assert.equal(p.scriptVersion,scriptVersion);assert.equal(p.stale.review,true);
  const before=state.jobs.length;
  const invalidBatch=await fetch(base+'/api/video/batch',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({projectId:p.id,revision:p.revision,shots:[{scene:0,shot:0},{scene:99,shot:0}]})});assert.equal(invalidBatch.status,400);
  p=await latest();assert.equal(state.jobs.length,before);
  const batch=await call('/api/video/batch','POST',{projectId:p.id,revision:p.revision,shots:[{scene:0,shot:0}]});const version2=await wait(batch.ids[0]);assert.equal(version2.status,'succeeded',version2.error);
  assert.equal(receivedGraph['2'].inputs.steps,9);assert.equal(receivedGraph['1'].inputs.text,'revised rainy shop\n场景：磁带店 / 夜');
  p=await latest();p=await call(`/api/projects/${p.id}/shots/0/0/select`,'POST',{revision:p.revision,assetId:generated.assetId});assert.equal(p.selectedShots['0-0'],generated.assetId);
  const upload=await fetch(base+`/api/assets?projectId=${p.id}&name=silent`,{method:'POST',headers:{'X-Workspace-Token':token},body:await readFile(silent)});assert.equal(upload.status,201);const uploaded=await upload.json();assert.equal(uploaded.audio,false);
  const jpeg1x1=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==','base64');const pngUpload=await fetch(base+`/api/assets?projectId=${p.id}&kind=image&characterId=fixture-char&name=probe.png`,{method:'POST',headers:{'X-Workspace-Token':token},body:jpeg1x1});assert.equal(pngUpload.status,201);
  const image=await pngUpload.json();assert.equal(image.kind,'image');assert.equal(image.extension,'jpg');
  const rawAssets=JSON.parse(await readFile(path.join(folder,'data','workspace.json'),'utf8')).assets;
  const storedImage=rawAssets.find(a=>a.id===image.id);
  assert.match(storedImage.file,/\.jpg$/,'on-disk extension must follow detected format');
  assert.ok((await readFile(storedImage.file)).subarray(0,2).equals(Buffer.from([255,216])),'content must stay untouched');
  p=await latest();p=await call(`/api/projects/${p.id}`,'PUT',{revision:p.revision,timeline:[{assetId:generated.assetId,start:0.25,end:1.25,volume:0.5},{assetId:uploaded.id,start:0,end:0.75,volume:1}]});
  const rendered=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'export'})).id);assert.equal(rendered.status,'succeeded',rendered.error);
  const output=path.join(folder,'verified-export.mp4');await writeFile(output,Buffer.from(await(await fetch(base+`/media/${rendered.assetId}`)).arrayBuffer()));
  const metadata=await inspect(output);assert.equal(metadata.width,1280);assert.equal(metadata.height,720);assert.equal(metadata.audio,true);assert.ok(Math.abs(metadata.duration-1.75)<0.2,JSON.stringify(metadata));
  const range=await fetch(base+`/media/${rendered.assetId}`,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  const details=await call(`/api/jobs/${generated.id}/details`);assert.equal(details.config.params.steps,8);
  hold=true;const conflict=await call('/api/jobs','POST',{projectId:p.id,kind:'outline'});p=await latest();await call(`/api/projects/${p.id}`,'PUT',{revision:p.revision,brief:'新的构思'});const conflicted=await wait(conflict.id);assert.equal(conflicted.applied,undefined);assert.ok(conflicted.result);
  p=await latest();await call(`/api/jobs/${conflict.id}/apply`,'POST',{revision:p.revision});p=await latest();assert.equal(p.stale.script,true);
  const cancel=await call('/api/jobs','POST',{projectId:p.id,kind:'outline'});await call(`/api/jobs/${cancel.id}/cancel`,'POST',{});assert.equal((await wait(cancel.id)).status,'cancelled');
  settings.text.profiles[0].baseUrl='http://127.0.0.1:1/v1';await call('/api/settings','PUT',settings);
  const failed=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'outline'})).id);assert.equal(failed.status,'failed');assert.ok(failed.error);
  console.log('Verified export:',output,metadata);

  // --- 项目管理：重命名 / 复制 / 导出 / 导入 / 删除 ---
  p=await latest();
  p=await call(`/api/projects/${p.id}`,'POST',{action:'rename',name:'管理测试 · 重命名'});assert.equal(p.name,'管理测试 · 重命名');
  const badRename=await fetch(base+`/api/projects/${p.id}`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({action:'rename',name:'  '})});assert.equal(badRename.status,400);
  const copy=await call(`/api/projects/${p.id}`,'POST',{action:'duplicate'});assert.equal(copy.name,'管理测试 · 重命名 · 副本');
  const copyState=await call('/api/state');const copiedProject=copyState.projects.find(x=>x.id===copy.id);
  assert.ok(copiedProject.outline&&copiedProject.outline.logline==='最后一盘磁带','duplicate must carry outline');
  assert.equal(copiedProject.selectedShots&&Object.keys(copiedProject.selectedShots).length,0,'duplicate must reset selected shots');
  assert.notEqual(copiedProject.scriptVersion,p.scriptVersion);
  const manifest=await call(`/api/projects/${p.id}`,'POST',{action:'export'});
  assert.equal(manifest.name,'管理测试 · 重命名');assert.ok(Array.isArray(manifest.files));
  const imageFile=manifest.files.find(f=>f.id===image.id);assert.ok(imageFile&&imageFile.bytes&&imageFile.bytes.data&&imageFile.bytes.data.length>0,'export must embed asset bytes');
  const textOnly=structuredClone(manifest);for(const f of textOnly.files)f.bytes=null;
  textOnly.name='仅文本副本';
  const importedText=await call('/api/projects/import','POST',{project:textOnly});assert.equal(importedText.imported,0);assert.equal(importedText.missing,manifest.files.length);
  const importedFull=await call('/api/projects/import','POST',{project:manifest});
  assert.equal(importedFull.imported,manifest.files.length);assert.equal(importedFull.missing,0);
  const reimported=importedFull.project;assert.notEqual(reimported.id,p.id);assert.equal(reimported.name,'管理测试 · 重命名');
  const afterImport=await call('/api/state');
  const reimportedImage=afterImport.assets.find(a=>a.projectId===reimported.id&&a.kind==='image');
  assert.ok(reimportedImage,'reimport must recreate asset records');assert.notEqual(reimportedImage.id,image.id,'reimported assets must get fresh ids');
  const mediaCheck=await fetch(base+`/media/${reimportedImage.id}`);assert.equal(mediaCheck.status,200,'reimported bytes must serve under /media');
  const badImport=await call('/api/projects/import','POST',{project:{name:'x'}}).catch(e=>e);assert.ok(badImport instanceof Error,'invalid manifest must fail');
  const stateBeforeDelete=await call('/api/state');
  assert.ok(stateBeforeDelete.projects.some(x=>x.id===p.id));
  // 副本与导入件引用了原项目的素材：删除原项目应被引用防护拦截
  const blocked=await fetch(base+`/api/projects/${p.id}`,{method:'DELETE',headers:{'X-Workspace-Token':token}});
  assert.equal(blocked.status,400,'deleting a project whose assets are referenced elsewhere must 400');
  await call(`/api/projects/${copy.id}`,'DELETE');
  await call(`/api/projects/${importedText.project.id}`,'DELETE');
  await call(`/api/projects/${importedFull.project.id}`,'DELETE');
  const del=await call(`/api/projects/${p.id}`,'DELETE');assert.equal(del.ok,true);assert.ok(del.removed>=1);
  const stateAfterDelete=await call('/api/state');
  assert.ok(!stateAfterDelete.projects.some(x=>x.id===p.id),'project must be gone');
  assert.ok(!stateAfterDelete.assets.some(a=>a.projectId===p.id),'project assets must be gone');
  const mediaGone=await fetch(base+`/media/${image.id}`);assert.equal(mediaGone.status,404,'deleted asset file must 404');
  const ghostDelete=await fetch(base+`/api/projects/${p.id}`,{method:'DELETE',headers:{'X-Workspace-Token':token}});assert.equal(ghostDelete.status,404);
  console.log('Project management verified: rename/duplicate/export/import/delete');

  // --- 图生视频首帧：引用校验 + 保存通道 ---
  p=await latest();
  // 新建一个项目做首帧/转场/字幕/档位验证
  const proj=await call('/api/projects','POST',{name:'流程缺口验证'});
  // 建角色（图片上传要求本项目角色）+ 导入首帧图片 + 造最小剧本
  let q=await call(`/api/projects/${proj.id}/draft`,'POST',{revision:(await latest()).revision,brief:'',bible:'',characters:[{name:'主角',appearance:'黑色外套',personality:'冷静',motivation:'',relationships:'',voice:'',notes:''}],worldbook:[]});
  q=await latest();
  const ffUpload=await fetch(base+`/api/assets?projectId=${proj.id}&kind=image&characterId=${q.characters[0].id}&name=first-frame.png`,{method:'POST',headers:{'X-Workspace-Token':token},body:jpeg1x1});assert.equal(ffUpload.status,201);
  const ffAsset=await ffUpload.json();
  const scriptDoc={scenes:[{title:'场景一',action:'夜色中的店铺',dialogue:'',shots:[{prompt:'a quiet tape shop at night',duration:5}]}]};
  q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,stage:'script',value:scriptDoc});
  q=await latest();
  assert.ok(q.script.scenes[0].shots[0].prompt);
  // 设置首帧 → 保存成功
  q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__firstFrame:{scene:0,shot:0,assetId:ffAsset.id}});
  q=await latest();assert.equal(q.script.scenes[0].shots[0].firstFrameId,ffAsset.id,'first frame id must persist');
  // 无效首帧引用被拒
  const badFF=await fetch(base+`/api/projects/${proj.id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({revision:q.revision,__firstFrame:{scene:0,shot:0,assetId:'no-such-image'}})});assert.equal(badFF.status,400);
  // 提交云端 i2v 任务：本地 provider 应拒绝首帧（当前 settings.video 是 comfy fixture）
  const badProvider=await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0}).catch(e=>e);
  assert.ok(badProvider instanceof Error,'first-frame on non-cloud provider must fail');
  // 清除首帧后可正常提交（fixture comfy 后端 + fixture 工作流）
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__clearFirstFrame:{scene:0,shot:0}});
  await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0});
  console.log('First-frame reference validation verified');

  // --- 尾帧：校验链（无首帧拒绝 / 非法引用 / MiniMax·comfy 拒绝 / 合法保存与清除）---
  // 导入第二张图片作尾帧
  const lfUpload=await fetch(base+`/api/assets?projectId=${proj.id}&kind=image&characterId=${q.characters[0].id}&name=last-frame.png`,{method:'POST',headers:{'X-Workspace-Token':token},body:jpeg1x1});assert.equal(lfUpload.status,201);
  const lfAsset=await lfUpload.json();
  // 当前项目首帧已被 __clearFirstFrame 清除：先验证"无首帧设尾帧"被拒
  const lfNoFirst=await fetch(base+`/api/projects/${proj.id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({revision:(await latest()).revision,__lastFrame:{scene:0,shot:0,assetId:lfAsset.id}})});
  assert.equal(lfNoFirst.status,400,'last frame requires first frame');
  // 设首帧后：comfy 后端 + 尾帧 → 提交生成应失败（尾帧仅云端 Seedance/可灵）
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__firstFrame:{scene:0,shot:0,assetId:ffAsset.id}});
  const lfOnComfy=await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0}).catch(e=>e);
  assert.ok(lfOnComfy instanceof Error,'tail frame must reject non-cloud providers');
  // MiniMax 形态的后端也拒绝（直接改 settings.provider 模拟）
  const savedVideo=settings.video;settings.video={...savedVideo,provider:'minimax',model:'MiniMax-Hailuo-02',baseUrl:'https://api.minimax.chat',keyEnv:'MINIMAX_KEY',profile:'MiniMax Hailuo'};await call('/api/settings','PUT',settings);
  const lfOnMinimax=await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0}).catch(e=>e);
  assert.ok(lfOnMinimax instanceof Error,'tail frame must reject MiniMax');
  settings.video=savedVideo;await call('/api/settings','PUT',settings);
  // seedance 形态后端 + 尾帧 → videoJob 构建通过（入队成功，fixture 不真正出片）
  settings.video={...savedVideo,provider:'seedance',model:'doubao-seedance-1-0-pro',baseUrl:'https://ark.cn-beijing.volces.com',keyEnv:'ARK_KEY',profile:'Seedance Pro',params:{ratio:'16:9',resolution:'720p'}};await call('/api/settings','PUT',settings);
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__lastFrame:{scene:0,shot:0,assetId:lfAsset.id}});
  q=await latest();assert.equal(q.script.scenes[0].shots[0].lastFrameId,lfAsset.id,'last frame id must persist');
  const tailJob=await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0});
  assert.ok(tailJob.id,'seedance tail-frame job enqueued');
  // 清除尾帧
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__clearLastFrame:{scene:0,shot:0}});
  q=await latest();assert.ok(!q.script.scenes[0].shots[0].lastFrameId,'last frame cleared');
  // 恢复 comfy fixture 后端供后续导出测试（局部 settings.video 已被 seedance 覆盖，用 savedVideo 恢复）
  settings.video=savedVideo;await call('/api/settings','PUT',settings);
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__clearFirstFrame:{scene:0,shot:0}});
  console.log('Last-frame validation chain verified');

  // --- 本地 ComfyUI i2v：wan21-i2v 模板 + 首帧 → 任务成功 ---
  q=await latest();q=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,__firstFrame:{scene:0,shot:0,assetId:ffAsset.id}});
  const i2vTemplate=await call('/api/video-presets/wan21-i2v');
  settings.video=structuredClone({...i2vTemplate,baseUrl:endpoint});await call('/api/settings','PUT',settings);
  const i2vJob=await wait((await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0})).id);
  assert.equal(i2vJob.status,'succeeded',i2vJob.error);
  console.log('Local ComfyUI i2v (first frame) verified');

  // --- 转场 + 字幕 + 导出档位 ---
  // 需要视频素材：复用前面生成的 generated.assetId？已删除。生成一个新镜头视频。
  q=await latest();
  const vid=await wait((await call('/api/jobs','POST',{projectId:proj.id,kind:'video',scene:0,shot:0})).id);assert.equal(vid.status,'succeeded',vid.error);
  q=await latest();const vidAsset=state.assets.find(a=>a.id===vid.assetId);
  // 时间线：两个片段 + fade；非法转场应 400
  const badTl=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,timeline:[{assetId:vidAsset.id,start:0,end:1,volume:1,transition:'wipex'}]}).catch(e=>e);assert.ok(badTl instanceof Error,'unknown transition must fail');
  q=await latest();
  await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,timeline:[{assetId:vidAsset.id,start:0,end:1,volume:1,transition:'fade'},{assetId:vidAsset.id,start:0.5,end:1.5,volume:1}]});
  // 字幕：非法文本被拒；合法保存
  const badSub=await call(`/api/projects/${proj.id}`,'PUT',{revision:(await latest()).revision,subtitles:[{start:0,end:1,text:''}]}).catch(e=>e);assert.ok(badSub instanceof Error,'empty subtitle must fail');
  q=await latest();
  await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,subtitles:[{start:0,end:0.8,text:'夜色中的一盘磁带'},{start:0.9,end:1.6,text:'故事从这里开始'}]});
  // 1080p 竖屏导出（含转场 + 字幕 + 音轨混流链路全走 filter_complex）
  q=await latest();
  const renderedV=await wait((await call('/api/jobs','POST',{projectId:proj.id,kind:'export',preset:'1080-vertical'})).id);
  assert.equal(renderedV.status,'succeeded',renderedV.error);
  const vOut=path.join(folder,'verified-export-v.mp4');await writeFile(vOut,Buffer.from(await(await fetch(base+`/media/${renderedV.assetId}`)).arrayBuffer()));
  const vp=await inspect(vOut);
  assert.equal(vp.width,1080);assert.equal(vp.height,1920);
  console.log('Transitions, subtitles and export presets verified');

  // --- 转场类型扩充：清单暴露 / 混用被拒 / 多转场真实导出 ---
  const st=await call('/api/state');
  assert.ok(Array.isArray(st.transitions)&&st.transitions.length>=20,'state must expose transition catalog');
  assert.ok(st.transitions.some(x=>x.name==='fade'&&x.label),'transition catalog must carry labels');
  assert.equal(st.defaultTransition,'fade');
  q=await latest();
  const mixed=await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,timeline:[{assetId:vidAsset.id,start:0,end:1,volume:1,transition:'wipeleft'},{assetId:vidAsset.id,start:0,end:1,volume:1,transition:''},{assetId:vidAsset.id,start:0,end:1,volume:1}]}).catch(e=>e);
  assert.ok(mixed instanceof Error,'mixed transition/hardcut must fail');
  q=await latest();
  await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,timeline:[{assetId:vidAsset.id,start:0,end:1,volume:1,transition:'wipeleft'},{assetId:vidAsset.id,start:0,end:1,volume:1,transition:'fadeblack'},{assetId:vidAsset.id,start:0,end:1,volume:1}]});
  q=await latest();
  assert.equal(q.timeline[0].transition,'wipeleft');assert.equal(q.timeline[1].transition,'fadeblack');
  await call(`/api/projects/${proj.id}`,'PUT',{revision:q.revision,subtitles:[]});
  q=await latest();
  const renderedW=await wait((await call('/api/jobs','POST',{projectId:proj.id,kind:'export',preset:'720p'})).id);
  assert.equal(renderedW.status,'succeeded',renderedW.error);
  const wOut=path.join(folder,'verified-export-wipe.mp4');await writeFile(wOut,Buffer.from(await(await fetch(base+`/media/${renderedW.assetId}`)).arrayBuffer()));
  const wp=await inspect(wOut);
  assert.equal(wp.width,1280);assert.equal(wp.height,720);
  assert.ok(wp.duration>2.4,'multi-transition export should be longer than hard-cut sum');
  console.log('Transition catalog and multi-transition export verified');

  // --- Seed 延续批量：本地后端（comfy/native）允许，且 seed 按镜头序注入 ---
  settings.video={...settings.video,params:{...settings.video.params,steps:8,seed:42}};await call('/api/settings','PUT',settings);
  const jobsBefore=(await call('/api/state')).jobs.length;
  await call('/api/video/batch','POST',{projectId:proj.id,revision:(await latest()).revision,shots:[{scene:0,shot:0}],seedMode:'continue'});
  const jobsNow=(await call('/api/state')).jobs;
  assert.equal(jobsNow.length,jobsBefore+1,'seed-continue batch must enqueue');
  const seededJob=jobsNow[0];
  assert.ok(seededJob,'video job exists');
  const seededDetails=await call(`/api/jobs/${seededJob.id}/details`);
  assert.equal(seededDetails.config.params.seed,42,'continued seed must be baseSeed+scene*1000+shot');
  console.log('Seed-continue verified');
});
