import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// N1 镜头静帧生成：任务校验、提示词组装、图片入库与首帧候选标记
test('shot-still：校验、提示词组装、静帧入库与镜头标记', {timeout:60000}, async t=>{
  await mkdir('test-output',{recursive:true});
  const folder=await mkdtemp(path.resolve('test-output/shot-still-'));
  const png=await readFile('public/assets/cyancreator-icon.png');
  let imageRequest;
  const fixture=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const b=JSON.parse(raw||'{}');
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/chat/completions'){
      const blob=JSON.stringify(b);
      const isScript=/编剧与分镜导演/.test(blob);
      const shape=isScript?{scenes:[{title:'雨夜 · 店门',action:'林舟推门',dialogue:'林舟来了',shots:[{prompt:'林舟推门而入',duration:5,direction:{size:'中景',lighting:'冷蓝夜灯'}}]}]}:{logline:'雨夜来客',beats:[{title:'转折',summary:'找到条码信'}]};
      return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(shape)}}]}));
    }
    imageRequest=b;
    res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  });
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');t.after(()=>fixture.close());
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'0',CYANCREATOR_DATA:path.join(folder,'data')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  let errors='';child.stderr.on('data',x=>errors+=x);
  const base=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('exit',code=>reject(Error('startup '+code+errors)));child.once('error',reject);});
  let state=await(await fetch(base+'/api/state')).json();
  async function call(url,method='GET',body,status=200){
    const headers={'Content-Type':'application/json'};headers['X-Workspace-'+'Token']=state.token;headers.origin=base;
    const r=await fetch(base+url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const d=await r.json().catch(()=>({}));
    assert.equal(r.status,status,JSON.stringify(d));
    return d;
  }
  const latest=async()=>{state=await call('/api/state');return state.projects.find(x=>x.id===p.id);};
  const wait=async id=>{for(let i=0;i<200;i++){await latest();const j=state.jobs.find(j=>j.id===id);if(!['queued','running'].includes(j.status)){assert.equal(j.status,'succeeded',j.error);return j;}await delay(50);}throw Error('job timeout');};
  let p=await call('/api/projects','POST',{name:'Still smoke'},201);
  // 文本与图像服务都指向 fixture
  const endpoint='http://127.0.0.1:'+fixture.address().port;
  for(const c of state.settings.text.profiles){c.baseUrl=endpoint+'/v1';c.model='fixture';c.keyEnv='';}
  state.settings.image={provider:'compatible',baseUrl:endpoint+'/v1',model:'fixture',keyEnv:'',size:'1024x1536'};
  await call('/api/settings','PUT',state.settings);
  // 生成大纲再生成剧本
  const outlineBrief='雨夜来客';
  const doc=await call('/api/import-document','POST',{stage:'outline',format:'text',text:'一句话：雨夜来客\n# 转折\n找到条码信'});
  await call('/api/projects/'+p.id+'/draft','POST',{stage:'outline',value:doc,brief:outlineBrief,bible:'都市',characters:[{id:'lin',name:'林舟',appearance:'绿色夹克',personality:'沉静'}],worldbook:[{id:'w',name:'画风',category:'视觉',content:'暖灯夜雨'}],revision:p.revision});
  p=await latest();
  const outlineJob=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'outline'},202)).id);
  p=await latest();
  if(!p.outline){await call('/api/jobs/'+outlineJob.id+'/apply','POST',{revision:p.revision});p=await latest();}
  // 生成剧本（revision 未变时结果自动应用）
  const job=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'script'},202)).id);
  p=await latest();
  if(!p.script){await call('/api/jobs/'+job.id+'/apply','POST',{revision:p.revision});p=await latest();}
  assert.ok(p.script.scenes.length,'剧本已生成');
  // 无效索引被拒绝
  await call('/api/jobs','POST',{projectId:p.id,kind:'shot-still',scene:99,shot:0},400);
  // 正常生成静帧
  const still=await wait((await call('/api/jobs','POST',{projectId:p.id,kind:'shot-still',scene:0,shot:0,instruction:'冷色调，夜景'},202)).id);
  assert.match(imageRequest.prompt,/林舟推门而入/);
  assert.match(imageRequest.prompt,/景别：中景/);
  assert.match(imageRequest.prompt,/绘画要求：冷色调，夜景/);
  const asset=state.assets.find(a=>a.id===still.assetId);
  assert.equal(asset.kind,'image');
  assert.equal(asset.scene,0);
  assert.equal(asset.shot,0);
  assert.equal(asset.stillFor,'first-frame');
  assert.equal(asset.shotKey,'0-0');
  // 静帧图作为首帧被镜头引用（edit 接口）
  const editedProject=await call('/api/projects/'+p.id+'/shots/0/0/edit','POST',{revision:p.revision,prompt:'林舟推门而入',duration:5,firstFrameId:still.assetId});
  assert.equal(editedProject.script.scenes[0].shots[0].firstFrameId,still.assetId);
  // 媒体可取回且与 fixture 返回一致
  const media=await fetch(base+'/media/'+still.assetId);
  assert.equal(media.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);
  assert.equal(errors,'');
});
