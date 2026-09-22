import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {initCreation,stashChapter,mutateStructure,importDocument,validateLibrary,shotPrompt,invalidateChapters} from '../lib/creation.js';
import {splitNovelChapters,importNovel} from '../lib/novel.js';

import {SecretVault,secretValue,secretStatus,safeError,vaultBackend} from '../lib/secrets.js';
import {cloudPreset,cloudVideo,cloudDuration} from '../lib/cloud-video.js';
test('旧项目迁移与多集章节切换保留独立稿件和视频版本',()=>{
 const p={outline:{logline:'原稿',beats:[{title:'一',summary:'原稿'}]},script:null,stale:{},history:[],scriptVersion:'original'};initCreation(p);const first=p.activeChapterId;mutateStructure(p,{action:'episode',title:'第二集'});assert.equal(p.outline,null);p.outline={logline:'第二集'};stashChapter(p);mutateStructure(p,{action:'switch',id:first});assert.equal(p.outline.logline,'原稿');assert.equal(p.scriptVersion,'original');invalidateChapters(p);assert.equal(p.episodes[1].chapters[0].stale.outline,true);assert.equal(p.episodes.length,2);
});
test('文本导入保留内容、拒绝非法 JSON 与角色/镜头字段',()=>{
 const input='# 雨夜\n第一段\n\n第二段\n# 清晨\n第三段';const doc=importDocument('script',input,'text');assert.equal(doc.scenes.length,2);assert.match(doc.scenes[0].action,/第二段/);assert.throws(()=>importDocument('outline','{"beats":[]}','json'));assert.throws(()=>validateLibrary([{name:''}],'characters'));
 const prompt=shotPrompt({prompt:'店门口',direction:{lighting:'逆光',movement:'缓慢推近'},characterIds:['c']},{characters:[{id:'c',name:'林舟',appearance:'绿夹克',personality:'克制'}],worldbook:[{name:'基调',category:'视觉',content:'雨夜暖光'}]});assert.match(prompt,/绿夹克/);assert.match(prompt,/运镜：缓慢推近/);assert.match(prompt,/雨夜暖光/);
});
test('密钥保险库落盘不含明文，重载可用，状态不泄露密钥（Windows DPAPI / 其它平台环境变量主密钥）',async()=>{
 await mkdir('test-output',{recursive:true});
 if(process.platform==='win32'){assert.equal(vaultBackend().name,'unavailable');} // 尚未探测
 const root=await mkdtemp(path.resolve('test-output/vault-')),vault=new SecretVault(root),value='fixture-secret-not-a-real-key-9ef27';
 const savedMaster=process.env.CYANCREATOR_VAULT_KEY;if(process.platform!=='win32')process.env.CYANCREATOR_VAULT_KEY='unit-test-master-key-0123456789abcdef0123456789abcdef';
 try{
  await vault.set('TEST_CLOUD_KEY',value);assert.equal(secretValue('TEST_CLOUD_KEY'),value);
  const backendName=vaultBackend().name;assert.ok(backendName==='win-dpapi'||backendName==='env-master','后端应为 win-dpapi 或 env-master，实际 '+backendName);
  const blob=await readFile(vault.file);assert.equal(blob.includes(Buffer.from(value)),false);
  assert.equal(JSON.stringify(secretStatus()).includes(value),false);
  await new SecretVault(root).load();assert.equal(secretValue('TEST_CLOUD_KEY'),value);
  assert.equal(safeError(new Error(value)),'[已隐藏密钥]');
  await vault.set('TEST_CLOUD_KEY','');assert.equal(secretValue('TEST_CLOUD_KEY'),'');
 }finally{if(process.platform!=='win32'){if(savedMaster===undefined)delete process.env.CYANCREATOR_VAULT_KEY;else process.env.CYANCREATOR_VAULT_KEY=savedMaster;}}
});
test('保险库密文不可解密时进入锁定：服务可用、保存被拒、重置保留旧密文',async()=>{
 await mkdir('test-output',{recursive:true});
 const root=await mkdtemp(path.resolve('test-output/vault-sealed-'));
 const saved=process.env.CYANCREATOR_VAULT_KEY;
 try{
  process.env.CYANCREATOR_VAULT_KEY='unit-test-master-key-0123456789abcdef';
  const v1=new SecretVault(root);await v1.set('SEALED_PROBE','fixture-value-abcdef');
  process.env.CYANCREATOR_VAULT_KEY='another-master-key-0123456789abcdef-xyz';
  const v2=new SecretVault(root);await v2.load();
  assert.equal(secretValue('SEALED_PROBE'),'','锁定后保险库值不可读');
  process.env.SEALED_PROBE='env-fallback-abcdef';
  assert.equal(secretValue('SEALED_PROBE'),'env-fallback-abcdef','锁定后回退同名环境变量');
  delete process.env.SEALED_PROBE;
  assert.equal(vaultBackend().sealed,true,'vaultBackend 须报告 sealed');
  assert.ok(vaultBackend().error,'sealed 须带原因');
  assert.equal(JSON.stringify(secretStatus()),'[]','锁定状态不得回显密钥清单');
  await assert.rejects(()=>v2.set('NEW_KEY','abc'),/拒绝保存/,'锁定时保存须被拒绝');
  await v2.reset();
  assert.equal(vaultBackend().sealed,false,'重置后解除锁定');
  await v2.set('REBORN_KEY','fixture-reborn-123456');
  assert.equal(secretValue('REBORN_KEY'),'fixture-reborn-123456','重置后可重新保存');
  const {readdir}=await import('node:fs/promises');
  const names=await readdir(path.join(root,'secrets'));
  assert.ok(names.includes('vault.enc'),'重置后新密文文件名不变');
  assert.ok(names.some(n=>n.startsWith('vault.enc.unreadable-')),'旧密文须改名保留');
 }finally{if(saved===undefined)delete process.env.CYANCREATOR_VAULT_KEY;else process.env.CYANCREATOR_VAULT_KEY=saved;}
});

test('无可用加密后端时保存给出可操作的报错',async()=>{
 if(process.platform==='win32')return; // Windows 必有 DPAPI
 await mkdir('test-output',{recursive:true});
 const saved=process.env.CYANCREATOR_VAULT_KEY;delete process.env.CYANCREATOR_VAULT_KEY;
 try{
  const root=await mkdtemp(path.resolve('test-output/vault-nomaster-'));
  const vault=new SecretVault(root);
  await assert.rejects(()=>vault.set('TEST_CLOUD_KEY','abc'),/本机没有可用的密钥加密方式/);
 }finally{if(saved===undefined)delete process.env.CYANCREATOR_VAULT_KEY;else process.env.CYANCREATOR_VAULT_KEY=saved;}
});
test('三个云视频协议实际传递参数，轮询与下载不泄露请求密钥',async()=>{
 const original=global.fetch;process.env.ARK_API_KEY='fixture-ark';process.env.KLING_ACCESS_KEY='fixture-ak';process.env.KLING_SECRET_KEY='fixture-sk';process.env.GEMINI_API_KEY='fixture-gemini';
 try{for(const provider of ['seedance','kling','veo']){let submission,downloadHeaders,remote;
 global.fetch=async(url,options={})=>{const u=String(url);if(options.method==='POST'){submission=JSON.parse(options.body);return Response.json(provider==='seedance'?{id:'task'}:provider==='kling'?{data:{task_id:'task'}}:{name:'operations/task'});}if(u.includes('/media.mp4')){downloadHeaders=options.headers;return new Response('fixture-video');}return Response.json(provider==='seedance'?{status:'succeeded',content:{video_url:'https://cdn.example.com/media.mp4'}}:provider==='kling'?{data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.example.com/media.mp4'}]}}}:{done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/media.mp4'}}]}}});};
 const c=cloudPreset(provider),r=await cloudVideo(c,'shot text',provider==='veo'?8:5,AbortSignal.timeout(5000),id=>remote=id);assert.ok(remote);assert.equal(await r.text(),'fixture-video');assert.match(JSON.stringify(submission),/shot text/);if(provider!=='veo')assert.equal(downloadHeaders.Authorization,undefined);
 }assert.throws(()=>cloudDuration('kling',6),/5\/10/);
 }finally{global.fetch=original;for(const k of ['ARK_API_KEY','KLING_ACCESS_KEY','KLING_SECRET_KEY','GEMINI_API_KEY'])delete process.env[k];}
});

test('小说分章：章回/回目/Markdown 标题识别、无头退化切分、上限保护',()=>{
 const doc=splitNovelChapters('第一章 雨夜\n甲到店\n\n第二章 清晨\n乙离开');assert.equal(doc.length,2);assert.equal(doc[0].title,'第一章 雨夜');assert.equal(doc[1].text,'乙离开');
 assert.equal(splitNovelChapters('第一回 起\nA\n第二回 承\nB').length,2);
 assert.equal(splitNovelChapters('# 场景一\n内容1\n# 场景二\n内容2')[0].title,'场景一');
 assert.equal(splitNovelChapters('导语\n\n第一章 正题\n正文').length,2);
 const chunked=splitNovelChapters('x'.repeat(7000));assert.equal(chunked.length,2);assert.equal(chunked[0].title,'片段 1');
 assert.equal(splitNovelChapters('短文')[0].title,'开篇');
 assert.throws(()=>splitNovelChapters(''));
 assert.throws(()=>splitNovelChapters(Array.from({length:61},(_,i)=>`第${i}章\n内容`).join('\n')),/最多导入 60 章/);
});
test('小说导入三模式建目录：并入一集 / 一章一集 / 附加当前章',()=>{
 const mk=()=>{const p={episodes:[],stale:{}};initCreation(p);return p;};
 const p1=mk();const r1=importNovel(p1,{mode:'chapters-in-episode',text:'第一章 甲\nA\n\n第二章 乙\nB'});assert.equal(r1.queue.length,2);assert.equal(p1.episodes[0].chapters.length,3);assert.ok(p1.episodes[0].chapters[1].novelSource.includes('A'));assert.ok(p1.episodes[0].chapters[2].novelSource.includes('B'));assert.equal(p1.activeChapterId,r1.queue[0].chapterId);
 const p2=mk();importNovel(p2,{mode:'chapter-per-episode',text:'第一章 甲\nA\n\n第二章 乙\nB'});assert.equal(p2.episodes.length,3);
 const p3=mk();const before=p3.episodes[0].chapters.length;importNovel(p3,{mode:'current',text:'仅原文'});assert.equal(p3.episodes[0].chapters.length,before);assert.ok(p3.episodes[0].chapters[0].novelSource.includes('仅原文'));
 assert.throws(()=>importNovel(mk(),{mode:'bad',text:'内容'}),/导入模式无效/);
 assert.throws(()=>importNovel(mk(),{mode:'chapters-in-episode',text:Array.from({length:61},(_,i)=>`第${i}章\n内容`).join('\n')}),/最多导入 60 章/);
});
test('目录编排：跨集移动、全局重排、合并剧本、按场景拆分',()=>{
 const p={episodes:[],stale:{}};initCreation(p);
 mutateStructure(p,{action:'chapter',episodeId:p.episodes[0].id,title:'第二章'});
 mutateStructure(p,{action:'chapter',episodeId:p.episodes[0].id,title:'第三章'});
 mutateStructure(p,{action:'episode',title:'第 2 集'});
 const ids=p.episodes.flatMap(e=>e.chapters).map(c=>c.id);
 mutateStructure(p,{action:'chapter-move',chapterId:ids[2],toEpisodeId:p.episodes[1].id});assert.equal(p.episodes[1].chapters.length,2);
 mutateStructure(p,{action:'chapter-move',chapterId:ids[2],toEpisodeId:p.episodes[0].id,toIndex:0});assert.equal(p.episodes[0].chapters[0].title,'第三章');
 mutateStructure(p,{action:'chapter-reorder',order:[ids[1],ids[0],ids[2],ids[3]]});assert.equal(p.episodes.length,1);assert.equal(p.episodes[0].chapters[0].id,ids[1]);
 mutateStructure(p,{action:'chapter-reorder',order:[[ids[0],ids[1]],[ids[2],ids[3]]]});assert.equal(p.episodes.length,2);
 p.episodes[0].chapters[0].script={scenes:[{title:'S1',action:'',dialogue:'',shots:[{prompt:'p1',duration:5}]}]};
 p.episodes[0].chapters[1].script={scenes:[{title:'S2',action:'',dialogue:'',shots:[{prompt:'p2',duration:5}]}]};
 mutateStructure(p,{action:'chapter-merge',chapterIds:[ids[0],ids[1]],intoChapterId:ids[0]});
 assert.equal(p.episodes[0].chapters[0].script.scenes.length,2);assert.equal(p.episodes[0].chapters[1].script,null);
 p.episodes[0].chapters[0].script.scenes.push({title:'S3',action:'',dialogue:'',shots:[{prompt:'p3',duration:5}]});
 stashChapter(p);
 mutateStructure(p,{action:'chapter-split-at',chapterId:ids[0],sceneIndex:1});
 assert.equal(p.episodes[0].chapters.length,3);assert.equal(p.episodes[0].chapters[0].script.scenes.length,1);assert.equal(p.episodes[0].chapters[1].script.scenes.length,2);
 assert.throws(()=>mutateStructure(p,{action:'chapter-move',chapterId:'nope',toEpisodeId:p.episodes[0].id}));
 assert.throws(()=>mutateStructure(p,{action:'chapter-reorder',order:['nope']}),/章节顺序/);
 assert.throws(()=>mutateStructure(p,{action:'chapter-split-at',chapterId:p.episodes[0].chapters[0].id,sceneIndex:0}),/拆分位置/);
 assert.throws(()=>mutateStructure(p,{action:'chapter-merge',chapterIds:[ids[0]],intoChapterId:ids[0]}),/2–50/);
 assert.throws(()=>mutateStructure(p,{action:'chapter-merge',chapterIds:[ids[0],'ghost'],intoChapterId:ids[0]}),/未知章节/);
 assert.equal(p.episodes.flatMap(e=>e.chapters).filter(c=>ids.includes(c.id)).length,4);
});
