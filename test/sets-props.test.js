import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLibrary, validateDirection, shotPrompt} from '../lib/creation.js';
import {compileShot} from '../lib/prompt-compiler.js';

// N2 场景/道具资产卡：数据校验、镜头引用校验与提示词组装
test('sets/props 库校验：字段白名单与必填名称', () => {
  const sets = validateLibrary([
    {id:'s1', name:'雨夜天台', appearance:'湿滑地面，冷蓝灯带，水箱剪影', notes:'夜景'},
    {name:'便利店', appearance:'暖白荧光，货架整齐'},
  ], 'sets');
  assert.equal(sets.length, 2);
  assert.equal(sets[0].name, '雨夜天台');
  assert.equal(sets[1].id.length >= 1, true);
  assert.equal(Object.keys(sets[0]).every(k=>['id','name','appearance','notes'].includes(k)), true);
  const props = validateLibrary([{id:'p1', name:'条码信', appearance:'牛皮纸信封，红色火漆'}], 'props');
  assert.equal(props[0].name, '条码信');
  assert.throws(()=>validateLibrary([{name:''}], 'sets'), /请填写设定名称/);
  const extra = validateLibrary([{id:'x', name:'多字段', bogus:'1', appearance:'a'}], 'props');
  assert.equal('bogus' in extra[0], false, '白名单外字段被剔除');
});

test('validateDirection：setId/propIds 类型校验', () => {
  validateDirection({setId:'', propIds:[]});
  validateDirection({setId:'s1', propIds:['p1','p2'], characterIds:['c1']});
  assert.throws(()=>validateDirection({setId:123}), /场景引用无效/);
  assert.throws(()=>validateDirection({propIds:'p1'}), /道具引用无效/);
  assert.throws(()=>validateDirection({propIds:[1,2]}), /道具引用无效/);
});

test('shotPrompt 与 compileShot 组装场景与道具', () => {
  const p = {
    characters:[{id:'c1', name:'林舟', appearance:'绿色夹克', personality:'沉静'}],
    sets:[{id:'s1', name:'雨夜天台', appearance:'湿滑地面，冷蓝灯带'}],
    props:[{id:'p1', name:'条码信', appearance:'牛皮纸信封'}],
    worldbook:[{id:'w1', name:'画风', category:'视觉', content:'暖灯夜雨'}],
  };
  const shot = {prompt:'林舟立于天台边缘', direction:{size:'中景'}, characterIds:['c1'], setId:'s1', propIds:['p1']};
  const sp = shotPrompt(shot, p);
  assert.match(sp, /场景 雨夜天台：湿滑地面，冷蓝灯带/);
  assert.match(sp, /道具 条码信：牛皮纸信封/);
  const cs = compileShot(shot, p, {title:'天台夜'});
  assert.match(cs, /场景 雨夜天台/);
  assert.match(cs, /道具 条码信/);
  // 引用缺失时静默跳过，不产生空标签
  const cs2 = compileShot({...shot, setId:'missing', propIds:['gone']}, p, {});
  assert.doesNotMatch(cs2, /场景 missing/);
  assert.doesNotMatch(cs2, /道具 gone/);
});
