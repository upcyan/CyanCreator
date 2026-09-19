import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {guideMessages,validateGuide} from '../lib/guide.js';
test('引导上下文有界、稿件校验与制作阶段隔离',()=>{
 const history=Array.from({length:12},(_,i)=>({status:'succeeded',guide:{message:'第'+i+'轮'},result:{reply:'回复'+i}}));
 const messages=guideMessages({brief:'故事',script:{privateOtherStage:true}},{stage:'outline',message:'继续'},history);
 assert.equal(messages.length,19);assert.equal(messages[2].content,'第7轮');assert.equal(JSON.stringify(messages).includes('privateOtherStage'),false);
 assert.throws(()=>validateGuide({reply:'好',suggestions:[],candidate:{}},'production'));
 assert.throws(()=>validateGuide({reply:'好',suggestions:['a'.repeat(301)]},'outline'));
});
test('引导 HTTP：持续对话、候选确认、章节隔离、冲突和取消',{timeout:60000},async t=>{
 await mkdir('test-output',{recursive:true});const folder=await mkdtemp(path.resolve('test-output/guide-api-'));let captured;
 const fixture=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;captured=JSON.parse(raw);const message=captured.messages.at(-1).content;
 if(message==='等待取消'){res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'{"reply":"'}}]})+'\n\n');return;}
 const candidate=message.includes('稿件')?{logline:'引导故事',beats:[{title:'起点',summary:'主角收到来信'}]}:null;
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'你希望主角为了谁踏上旅程？',suggestions:['为了家人','为了自己'],candidate})}}]}));});fixture.listen(0,'127.0.0.1');await once(fixture,'listening');t.after(()=>{fixture.closeAllConnections();fixture.close();});
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',CYANCREATOR_DATA:path.join(folder,'data')},windowsHide:true,stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());let errors='';child.stderr.on('data',d=>errors+=d);
 const base=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('error',reject);child.once('exit',()=>reject(Error(errors)));});
 let state=await(await fetch(base+'/api/state')).json();const token=state.token;
 async function call(url,method='GET',body,status=200){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Workspace-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
 let p=await call('/api/projects','POST',{name:'引导隔离测试'},201),first=p.activeChapterId;
 const latest=async()=>{state=await call('/api/state');p=state.projects.find(x=>x.id===p.id);return p;};
 async function wait(id,status='succeeded'){for(let i=0;i<200;i++){await latest();const j=state.jobs.find(x=>x.id===id);if(!['queued','running'].includes(j.status)){assert.equal(j.status,status,j.error);return j;}await delay(25);}throw Error('timeout');}
 for(const profile of state.settings.text.profiles){profile.baseUrl='http://127.0.0.1:'+fixture.address().port+'/v1';profile.keyEnv='';profile.model='fixture';}await call('/api/settings','PUT',state.settings);
 const send=message=>call('/api/jobs','POST',{projectId:p.id,kind:'guide',stage:'outline',message},202);
 await call('/api/jobs','POST',{projectId:p.id,kind:'guide',stage:'outline',message:''},400);
 const firstReply=await wait((await send('我的主角是邮差')).id);assert.equal(p.outline,null);await call('/api/jobs/'+firstReply.id+'/apply','POST',{revision:p.revision},400);
 const candidate=await wait((await send('整理稿件')).id);assert.ok(captured.messages.some(m=>m.content==='我的主角是邮差'));assert.equal(p.outline,null);assert.equal('guideHistory' in candidate,false);
 await call('/api/jobs/'+candidate.id+'/apply','POST',{revision:p.revision});await latest();assert.equal(p.outline.logline,'引导故事');
 const conflict=await wait((await send('再次整理稿件')).id);await call('/api/projects/'+p.id+'/structure','POST',{revision:p.revision,action:'rename',id:first,title:'新章节名'});await latest();await call('/api/jobs/'+conflict.id+'/apply','POST',{revision:p.revision},409);
 await call('/api/projects/'+p.id+'/structure','POST',{revision:p.revision,action:'chapter',episodeId:p.episodes[0].id,title:'第二章'});await latest();await call('/api/jobs/'+conflict.id+'/apply','POST',{revision:p.revision},400);
 await wait((await send('新章节')).id);assert.equal(captured.messages.some(m=>m.content==='我的主角是邮差'),false);
 const pending=await send('等待取消');for(let i=0;i<100;i++){await latest();if(state.jobs.find(x=>x.id===pending.id).progress?.characters>0)break;await delay(25);}await call('/api/jobs','POST',{projectId:p.id,kind:'guide',stage:'outline',message:'重复'},400);await call('/api/jobs/'+pending.id+'/cancel','POST',{});await wait(pending.id,'cancelled');
 const persisted=JSON.parse(await readFile(path.join(folder,'data/workspace.json'),'utf8'));assert.ok(persisted.jobs.some(j=>j.id===firstReply.id&&j.result.reply));assert.equal(errors,'');
 const asset=await fetch(base+'/coach.js');assert.equal(asset.status,200);assert.equal(asset.headers.get('cache-control'),'no-store');
});
