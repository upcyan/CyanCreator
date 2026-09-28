// 闪念文库 + 世界观/角色关系增强：单元与接口回归
// 单元：initCreation 默认值、validateIdeas 校验、ideasContext 过滤与上限、messages() 注入
// 接口：draft 持久化闪念、缺省不丢、非法章节拒绝、assist worldbook 阶段候选应用合并
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {initCreation,validateIdeas,ideasContext} from '../lib/creation.js';
import {messages} from '../lib/core.js';
const SESSION_HEADER='X-Workspace-Token';

test('initCreation 默认给空闪念文库',()=>{
  const p={episodes:[],stale:{}};initCreation(p);
  assert.deepEqual(p.ideas,[]);
  const keep={episodes:[],stale:{},ideas:[{id:'a',content:'已有想法',status:'used',tag:'',chapterId:'',createdAt:'2026-01-01'}]};
  initCreation(keep);assert.equal(keep.ideas.length,1);
});

test('validateIdeas 校验内容、章节归属、去重与状态回退',()=>{
  const chapter={episodes:[{id:'e1',chapters:[{id:'c1'}]}],stale:{}};
  const chapterIds=chapter.episodes.flatMap(e=>e.chapters).map(c=>c.id);
  const list=validateIdeas([
    {id:'i1',content:'  主角在雨夜捡到钥匙  ',status:'used',tag:'伏笔',chapterId:'c1',createdAt:'2026-09-01T00:00:00Z'},
    {content:'没有 ID 的想法'},
    {id:'i3',content:'未知状态回退',status:'bogus'}
  ],chapterIds);
  assert.equal(list.length,3);
  assert.equal(list[0].content,'主角在雨夜捡到钥匙');
  assert.equal(list[0].status,'used');
  assert.equal(list[1].id.length,36);
  assert.equal(list[1].status,'new');
  assert.equal(list[2].status,'new');
  assert.equal(list[0].createdAt,'2026-09-01T00:00:00Z');
  assert.throws(()=>validateIdeas([{content:''}],chapterIds),/1–2000/);
  assert.throws(()=>validateIdeas([{content:'x'.repeat(2001)}],chapterIds),/1–2000/);
  assert.throws(()=>validateIdeas([{content:'ok',chapterId:'ghost'}],chapterIds),/章节不存在/);
  assert.throws(()=>validateIdeas([{id:'i1',content:'a'},{id:'i1',content:'b'}],chapterIds),/重复/);
  assert.throws(()=>validateIdeas(Array.from({length:301},(_,i)=>({content:'x'+i})),chapterIds),/最多 300 条/);
  // 长内容截断到 2000 上限由校验拒绝，不静默截断；标签超长静默截断
  const long=validateIdeas([{content:'标签超长',tag:'t'.repeat(80)}],chapterIds);
  assert.equal(long[0].tag.length,60);
});

test('ideasContext 排除归档、上限 50 条、空时为 undefined',()=>{
  const p={ideas:[
    {id:'1',content:'a',status:'new',tag:'',chapterId:'',createdAt:''},
    {id:'2',content:'b',status:'archived',tag:'',chapterId:'',createdAt:''},
    {id:'3',content:'c',status:'used',tag:'伏笔',chapterId:'',createdAt:''}
  ]};
  const ctx=ideasContext(p);
  assert.equal(ctx.length,2);
  assert.deepEqual(ctx[1],{content:'c',tag:'伏笔',status:'已采用'});
  assert.equal(ctx[0].tag,undefined);
  assert.equal(ideasContext({ideas:[]}),undefined);
  assert.equal(ideasContext({ideas:[{id:'x',content:'z',status:'archived',tag:'',chapterId:'',createdAt:''}]}),undefined);
  const many={ideas:Array.from({length:80},(_,i)=>({id:'k'+i,content:'n'+i,status:'new',tag:'',chapterId:'',createdAt:''}))};
  assert.equal(ideasContext(many).length,50);
});

test('大纲/剧本/审校消息包含未归档闪念，排除归档',()=>{
  const p={name:'t',brief:'简报',bible:'设定',characters:[],characterRelations:[],worldbook:[],ideas:[
    {id:'1',content:'伏笔：钟停在三点的理由',status:'new',tag:'',chapterId:'',createdAt:''},
    {id:'2',content:'废弃想法',status:'archived',tag:'',chapterId:'',createdAt:''}
  ],outline:{logline:'l',beats:[{title:'t',summary:'s'}]},script:null,review:null,stale:{}};
  for(const stage of ['outline','script','review']){
    const user=messages(stage,p)[1].content;
    assert.ok(user.includes('伏笔：钟停在三点的理由'),stage+' 应包含未归档闪念');
    assert.ok(!user.includes('废弃想法'),stage+' 不得包含归档闪念');
  }
});

test('创作 HTTP：闪念持久化、缺省保留、非法章节拒绝、世界观候选应用合并', {timeout:60000},async t=>{
  await mkdir('test-output',{recursive:true});const folder=await mkdtemp(path.resolve('test-output/ideas-api-'));
  const fixture=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/chat/completions'){
      const content=JSON.stringify(b).includes('世界观设定助手')?{worldbook:[{name:'地下集市',category:'地点',content:'只在雨夜开放的黑市',keywords:'黑市;雨夜'}]}:{logline:'x',beats:[{title:'t',summary:'s'}]};
      return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));
    }
    res.end('{}');});
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');t.after(()=>fixture.close());
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'0',CYANCREATOR_DATA:path.join(folder,'data')},windowsHide:true,stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  let errors='';child.stderr.on('data',x=>errors+=x);
  const base=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('exit',code=>reject(Error('startup '+code+errors)));child.once('error',reject);});
  let state,session;
  async function call(url,method='GET',body,status=200){const h={'Content-Type':'application/json'};if(session)h[SESSION_HEADER]=session;const r=await fetch(base+url,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
  const latest=async()=>{state=await call('/api/state');return state.projects.find(x=>x.id===p.id);};
  state=await(await fetch(base+'/api/state')).json();session=state.token;
  let p=await call('/api/projects','POST',{name:'Ideas integration'},201);
  const chapterId=p.activeChapterId;
  // 1. draft 保存闪念
  await call('/api/projects/'+p.id+'/draft','POST',{revision:p.revision,stage:'outline',value:null,brief:'',bible:'',characters:[],worldbook:[],ideas:[{id:'i1',content:'主角怕水',status:'new',tag:'人设',chapterId,createdAt:'2026-09-28T00:00:00Z'}]});
  p=await latest();assert.equal(p.ideas.length,1);assert.equal(p.ideas[0].content,'主角怕水');
  // 2. 缺省 ideas 的 draft 不得丢闪念
  await call('/api/projects/'+p.id+'/draft','POST',{revision:p.revision,stage:'outline',value:null,brief:'新简报',bible:'',characters:[],worldbook:[]});
  p=await latest();assert.equal(p.ideas.length,1);
  // 3. 非法章节归属拒绝
  await call('/api/projects/'+p.id+'/draft','POST',{revision:p.revision,stage:'outline',value:null,brief:'',bible:'',characters:[],worldbook:[],ideas:[{content:'x',chapterId:'ghost'}]},400);
  // 4. 世界观伴写候选：应用后合并进世界书
  for(const c of state.settings.text.profiles){c.baseUrl='http://127.0.0.1:'+fixture.address().port+'/v1';c.model='fixture';c.keyEnv='';}
  await call('/api/settings','PUT',state.settings);
  const job=await call('/api/jobs','POST',{projectId:p.id,kind:'assist',stage:'worldbook',mode:'世界观设定',instruction:'补充一个地点'},202);
  for(let i=0;i<200;i++){await latest();const j=state.jobs.find(x=>x.id===job.id);if(!['queued','running'].includes(j.status)){assert.equal(j.status,'succeeded',j.error);break;}await delay(50);}
  p=await latest();assert.equal(p.worldbook.some(w=>w.name==='地下集市'),false,'应用前不得合并');
  await call('/api/jobs/'+job.id+'/apply','POST',{revision:p.revision});
  p=await latest();assert.equal(p.worldbook.some(w=>w.name==='地下集市'),true);assert.equal(p.worldbook[0].category,'地点');
  assert.equal(errors,'');
});
