import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {initCreation,stashChapter,mutateStructure,importDocument,validateLibrary,shotPrompt,invalidateChapters} from '../lib/creation.js';
import {SecretVault,secretValue,secretStatus,safeError} from '../lib/secrets.js';
import {cloudPreset,cloudVideo,cloudDuration} from '../lib/cloud-video.js';
test('旧项目迁移与多集章节切换保留独立稿件和视频版本',()=>{
 const p={outline:{logline:'原稿',beats:[{title:'一',summary:'原稿'}]},script:null,stale:{},history:[],scriptVersion:'original'};initCreation(p);const first=p.activeChapterId;mutateStructure(p,{action:'episode',title:'第二集'});assert.equal(p.outline,null);p.outline={logline:'第二集'};stashChapter(p);mutateStructure(p,{action:'switch',id:first});assert.equal(p.outline.logline,'原稿');assert.equal(p.scriptVersion,'original');invalidateChapters(p);assert.equal(p.episodes[1].chapters[0].stale.outline,true);assert.equal(p.episodes.length,2);
});
test('文本导入保留内容、拒绝非法 JSON 与角色/镜头字段',()=>{
 const input='# 雨夜\n第一段\n\n第二段\n# 清晨\n第三段';const doc=importDocument('script',input,'text');assert.equal(doc.scenes.length,2);assert.match(doc.scenes[0].action,/第二段/);assert.throws(()=>importDocument('outline','{"beats":[]}','json'));assert.throws(()=>validateLibrary([{name:''}],'characters'));
 const prompt=shotPrompt({prompt:'店门口',direction:{lighting:'逆光',movement:'缓慢推近'},characterIds:['c']},{characters:[{id:'c',name:'林舟',appearance:'绿夹克',personality:'克制'}],worldbook:[{name:'基调',category:'视觉',content:'雨夜暖光'}]});assert.match(prompt,/绿夹克/);assert.match(prompt,/运镜：缓慢推近/);assert.match(prompt,/雨夜暖光/);
});
test('Windows 密钥落盘不含明文，重载可用，状态不泄露密钥', {skip:process.platform!=='win32'},async()=>{
 await mkdir('test-output',{recursive:true});const root=await mkdtemp(path.resolve('test-output/vault-')),vault=new SecretVault(root),value='fixture-secret-not-a-real-key-9ef27';await vault.set('TEST_CLOUD_KEY',value);assert.equal(secretValue('TEST_CLOUD_KEY'),value);const blob=await readFile(vault.file);assert.equal(blob.includes(Buffer.from(value)),false);assert.equal(JSON.stringify(secretStatus()).includes(value),false);await new SecretVault(root).load();assert.equal(secretValue('TEST_CLOUD_KEY'),value);assert.equal(safeError(new Error(value)),'[已隐藏密钥]');await vault.set('TEST_CLOUD_KEY','');assert.equal(secretValue('TEST_CLOUD_KEY'),'');
});
test('三个云视频协议实际传递参数，轮询与下载不泄露请求密钥',async()=>{
 const original=global.fetch;process.env.ARK_API_KEY='fixture-ark';process.env.KLING_ACCESS_KEY='fixture-ak';process.env.KLING_SECRET_KEY='fixture-sk';process.env.GEMINI_API_KEY='fixture-gemini';
 try{for(const provider of ['seedance','kling','veo']){let submission,downloadHeaders,remote;
 global.fetch=async(url,options={})=>{const u=String(url);if(options.method==='POST'){submission=JSON.parse(options.body);return Response.json(provider==='seedance'?{id:'task'}:provider==='kling'?{data:{task_id:'task'}}:{name:'operations/task'});}if(u.includes('/media.mp4')){downloadHeaders=options.headers;return new Response('fixture-video');}return Response.json(provider==='seedance'?{status:'succeeded',content:{video_url:'https://cdn.example.com/media.mp4'}}:provider==='kling'?{data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.example.com/media.mp4'}]}}}:{done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/media.mp4'}}]}}});};
 const c=cloudPreset(provider),r=await cloudVideo(c,'shot text',provider==='veo'?8:5,AbortSignal.timeout(5000),id=>remote=id);assert.ok(remote);assert.equal(await r.text(),'fixture-video');assert.match(JSON.stringify(submission),/shot text/);if(provider!=='veo')assert.equal(downloadHeaders.Authorization,undefined);
 }assert.throws(()=>cloudDuration('kling',6),/5\/10/);
 }finally{global.fetch=original;for(const k of ['ARK_API_KEY','KLING_ACCESS_KEY','KLING_SECRET_KEY','GEMINI_API_KEY'])delete process.env[k];}
});
