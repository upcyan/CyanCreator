import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import ffmpeg from 'ffmpeg-static';
import {run, inspect} from '../lib/media.js';
import {mkdir} from 'node:fs/promises';

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
    if(req.url==='/prompt') {let raw='';for await(const c of req)raw+=c;receivedGraph=JSON.parse(raw).prompt;return reply({prompt_id:'fixture-prompt',node_errors:{}});}
    if(req.url==='/history/fixture-prompt')return reply({'fixture-prompt':{status:{completed:true,status_str:'success'},outputs:{'9':{videos:[{filename:'sample.mp4',type:'output'}]}}}});
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
  const generated=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'video',scene:0,shot:0})).id);
  assert.equal(generated.status,'succeeded',generated.error);assert.equal(receivedGraph['2'].inputs.steps,8);assert.equal(receivedGraph['1'].inputs.text,'a quiet tape repair shop at night');
  p=await latest();const scriptVersion=p.scriptVersion;
  p=await call(`/api/projects/${p.id}/shots/0/0/edit`,'POST',{revision:p.revision,prompt:'revised rainy shop',duration:5,params:{steps:9}});
  assert.equal(p.scriptVersion,scriptVersion);assert.equal(p.stale.review,true);
  const before=state.jobs.length;
  const invalidBatch=await fetch(base+'/api/video/batch',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({projectId:p.id,revision:p.revision,shots:[{scene:0,shot:0},{scene:99,shot:0}]})});assert.equal(invalidBatch.status,400);
  p=await latest();assert.equal(state.jobs.length,before);
  const batch=await call('/api/video/batch','POST',{projectId:p.id,revision:p.revision,shots:[{scene:0,shot:0}]});const version2=await wait(batch.ids[0]);assert.equal(version2.status,'succeeded',version2.error);
  assert.equal(receivedGraph['2'].inputs.steps,9);assert.equal(receivedGraph['1'].inputs.text,'revised rainy shop');
  p=await latest();p=await call(`/api/projects/${p.id}/shots/0/0/select`,'POST',{revision:p.revision,assetId:generated.assetId});assert.equal(p.selectedShots['0-0'],generated.assetId);
  const upload=await fetch(base+`/api/assets?projectId=${p.id}&name=silent`,{method:'POST',headers:{'X-Workspace-Token':token},body:await readFile(silent)});assert.equal(upload.status,201);const uploaded=await upload.json();assert.equal(uploaded.audio,false);
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
});
