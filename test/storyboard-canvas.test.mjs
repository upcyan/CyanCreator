// 分镜画布 DOM 冒烟：jsdom 不可用则退化为手工桩（只测核心交互流）
import {strict as assert} from 'node:assert';

// —— 手工 DOM 桩 ——
const listeners={};
const doc={
  _html:'',
  listeners,
  addEventListener(type,fn){(listeners[type]??=[]).push(fn);},
  querySelector(){return null;},
  querySelectorAll(){return [];},
};
globalThis.document=doc;
globalThis.window=globalThis;

const mod=await import('../public/creation-editor.js');
const p={id:'p1',scriptVersion:'v1',selectedShots:{'0-0':'a1'},
  script:{scenes:[{title:'磁带店',action:'夜色',dialogue:'',shots:[{prompt:'a quiet tape shop',duration:5,firstFrameId:'img1'},{prompt:'close-up of reels',duration:4}]},
                     {title:'后巷',action:'追逐',dialogue:'',shots:[{prompt:'alley chase',duration:6}]}]}};
const state={jobs:[{projectId:'p1',scriptVersion:'v1',kind:'video',scene:0,shot:0,status:'succeeded',assetId:'a1'}],
             assets:[{id:'a1',url:'/media/a1.mp4'},{id:'img1',kind:'image',url:'/media/img1.jpg',name:'首帧图'}]};

// 1) 初始为列表模式：storyboardCanvas 输出画布 HTML
let html=mod.storyboardCanvas(p,state,p.script);
assert.ok(html.includes('sb-card'),'画布应包含镜头卡片');
assert.ok(html.includes('data-sb-shot="0.0"'),'卡片应带定位索引');
assert.ok(html.includes('data-sb-shot="1.0"'),'第二场景卡片');
assert.ok(html.includes('data-doc-path="scenes.0.shots.0.prompt"'),'提示词走标准编辑通道');
assert.ok(html.includes('data-doc-path="scenes.0.shots.0.duration"'),'时长走标准编辑通道');
assert.ok(html.includes('sb-frame first'),'首帧缩略图');
assert.ok(html.includes('已生成'),'任务状态徽章');
assert.ok(html.includes('data-action="creation-shot-add"'),'场景级加镜头');
assert.ok(html.includes('sb-meta'),'场景文字折叠编辑');
// 2) 结构移动函数：跨场景移动 0.1 → 场景1 末尾
mod.moveStoryboardShot('0.1','1:end',null,p.script);
assert.equal(p.script.scenes[1].shots.length,2);
assert.equal(p.script.scenes[1].shots[1].prompt,'close-up of reels');
assert.equal(p.script.scenes[0].shots.length,1);
// 3) 同场景排序：把场景1的 1.1 移到 1.0 之前（插到 1.0 位置）
mod.moveStoryboardShot('1.1','1.0',null,p.script);
assert.equal(p.script.scenes[1].shots[0].prompt,'close-up of reels');
assert.equal(p.script.scenes[1].shots[1].prompt,'alley chase');
// 4) 跨场景到末尾再插回指定位置：alley chase → 场景0末尾，再插到场景0的 0.0 之前
mod.moveStoryboardShot('1.1','0:end',null,p.script);
assert.equal(p.script.scenes[0].shots.length,2);
assert.equal(p.script.scenes[0].shots[1].prompt,'alley chase');
mod.moveStoryboardShot('0.1','0.0',null,p.script);
assert.equal(p.script.scenes[0].shots[0].prompt,'alley chase');
assert.equal(p.script.scenes[0].shots[1].prompt,'a quiet tape shop');
// 4b) 非法目标位置（同场景下移越界）报错
assert.throws(()=>mod.moveStoryboardShot('0.0','0.5',null,p.script),/目标位置无效/);
// 5) 非法移动报错
assert.throws(()=>mod.moveStoryboardShot('9.0','1:end',null,p.script),/场景不存在/);
assert.throws(()=>mod.moveStoryboardShot('0.0','5:end',null,p.script),/场景不存在/);
console.log('storyboard canvas module smoke: all assertions passed');
