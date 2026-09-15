import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTextSettings, migrateTextSettings, resolveTextConfig} from '../lib/text-settings.js';
import {defaults, validateSettings} from '../lib/core.js';

test('一次修改共享模型影响三个阶段，独立参数保留', () => {
  const text = defaultTextSettings();
  text.profiles[0].model = 'shared-qwen'; text.profiles[0].temperature = 0.9;
  for (const role of ['outline','script','review']) assert.equal(resolveTextConfig(text,role).model,'shared-qwen');
  assert.equal(resolveTextConfig(text,'script').temperature,0.9);
  assert.equal(resolveTextConfig(text,'review').temperature,0.2);
  text.roles.review.overrides = null;
  assert.equal(resolveTextConfig(text,'review').temperature,0.9);
});

test('旧配置按连接去重并无损迁移阶段差异', () => {
  const shared = {baseUrl:'http://127.0.0.1:1234/v1',model:'qwen',keyEnv:'',temperature:0.7,maxTokens:6000};
  const old = {outline:{...shared},script:{...shared},review:{...shared,temperature:0.2,maxTokens:3000}};
  const migrated = migrateTextSettings(old);
  assert.equal(migrated.profiles.length,1);
  for (const role of Object.keys(old)) for (const key of Object.keys(shared)) assert.deepEqual(resolveTextConfig(migrated,role)[key],old[role][key]);
  assert.equal(migrateTextSettings(migrated),migrated);
  assert.equal(migrateTextSettings({...old,review:{...old.review,model:'reviewer'}}).profiles.length,2);
  assert.equal(migrateTextSettings({...old,review:{...old.review,keyEnv:'OTHER_KEY'}}).profiles.length,2);
});

test('拒绝失效引用、重复 ID、非法参数与越权的阶段字段', () => {
  let s = defaults(); s.text.roles.script.profileId = 'missing'; assert.throws(()=>validateSettings(s),/不存在/);
  s=defaults();s.text.profiles.push({...s.text.profiles[0]});assert.throws(()=>validateSettings(s),/重复/);
  s=defaults();s.text.roles.outline.overrides={temperature:0.5,maxTokens:1000,baseUrl:'https://unexpected.test'};assert.throws(()=>validateSettings(s),/覆盖/);
  s=defaults();s.text.profiles[0].maxTokens=500.5;assert.throws(()=>validateSettings(s),/整数/);
  s=defaults();s.text.profiles[0].apiKey='do-not-persist';assert.equal(validateSettings(s).text.profiles[0].apiKey,undefined);
});
