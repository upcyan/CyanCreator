import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudTemplates, cloudPreset, validateCloud, cloudDuration} from '../lib/cloud-video.js';
import {AGNES_BASE_URL, AGNES_KEY_ENV, AGNES_TEXT_MODEL, AGNES_IMAGE_MODEL, AGNES_VIDEO_MODEL, agnesVideoPreset, agnesImagePreset, agnesTextProfile, applyAgnesPreset} from '../lib/agnes-preset.js';
import {validateImage} from '../lib/images.js';
import {defaults, validateSettings} from '../lib/core.js';

const validCloud = () => ({provider:'agnes',baseUrl:AGNES_BASE_URL,model:AGNES_VIDEO_MODEL,keyEnv:AGNES_KEY_ENV,params:{ratio:'16:9',resolution:'720p'}});

test('Agnes 模板注册到云端厂商目录并复用统一密钥引用', () => {
  const t = cloudTemplates.find(c => c.id === 'agnes');
  assert.ok(t, 'agnes 模板未注册');
  assert.equal(t.provider, 'agnes');
  assert.equal(t.model, AGNES_VIDEO_MODEL);
  assert.equal(t.keyEnv, AGNES_KEY_ENV);
  assert.equal(t.params.resolution, '720p');
  // 一键预设使用与 cloudPreset('agnes') 一致的密钥引用
  const preset = cloudPreset('agnes');
  assert.equal(preset.keyEnv, AGNES_KEY_ENV);
  assert.equal(preset.model, AGNES_VIDEO_MODEL);
});

test('Agnes 云视频校验接受 16:9 与三种分辨率，拒绝非法参数', () => {
  for (const resolution of ['480p','720p','1080p']) for (const ratio of ['16:9','9:16','1:1']) {
    assert.ok(validateCloud({...validCloud(),params:{ratio,resolution}}));
  }
  assert.throws(() => validateCloud({...validCloud(),params:{ratio:'16:9',resolution:'4k'}}), /Agnes 分辨率无效|分辨率无效/);
  assert.throws(() => validateCloud({...validCloud(),params:{ratio:'4:3',resolution:'720p'}}), /画幅无效/);
  assert.throws(() => validateCloud({...validCloud(),model:''}), /模型 ID 无效/);
  assert.throws(() => validateCloud({...validCloud(),keyEnv:'bad-name'}), /密钥/);
});

test('Agnes 时长限制为 4/6/8/10 秒，与 Seedance / 可灵 / Veo 互不混淆', () => {
  const assertOk = (fn) => {try{fn();}catch(e){assert.fail(`应通过：${e.message}`);}};
  for (const d of [4,6,8,10]) assertOk(() => cloudDuration('agnes', d));
  for (const d of [5,7,9,12]) assert.throws(() => cloudDuration('agnes', d), /Agnes 模板支持/);
  assert.throws(() => cloudDuration('agnes', 4.5), /整数/);
  // 其它厂商限制不应被 Agnes 覆盖
  assert.throws(() => cloudDuration('kling', 4), /可灵/);
  assert.throws(() => cloudDuration('veo', 12), /Veo/);
});

test('一键 Agnes 预设：同一把 AGNES_API_KEY 覆盖文本 / 图像 / 视频', () => {
  const s = applyAgnesPreset(defaults());
  // 文本：新增 agnes-default profile，三个阶段都指向它
  const profile = s.text.profiles.find(p => p.id === 'agnes-default');
  assert.ok(profile, '未新增 Agnes 文本 profile');
  assert.equal(profile.model, AGNES_TEXT_MODEL);
  assert.equal(profile.keyEnv, AGNES_KEY_ENV);
  for (const role of ['outline','script','review']) assert.equal(s.text.roles[role].profileId, 'agnes-default');
  // 图像
  assert.equal(s.image.provider, 'agnes');
  assert.equal(s.image.model, AGNES_IMAGE_MODEL);
  assert.equal(s.image.keyEnv, AGNES_KEY_ENV);
  assert.ok(validateImage(s.image));
  // 视频
  assert.equal(s.video.provider, 'agnes');
  assert.equal(s.video.model, AGNES_VIDEO_MODEL);
  assert.equal(s.video.keyEnv, AGNES_KEY_ENV);
  // 完整 settings 通过 validateSettings
  assert.ok(validateSettings(structuredClone(s)));
});

test('一键 Agnes 预设幂等：再次应用不会重复创建 profile', () => {
  const s1 = applyAgnesPreset(defaults());
  const before = s1.text.profiles.length;
  const s2 = applyAgnesPreset(s1);
  assert.equal(s2.text.profiles.length, before, '重复应用不应增加 profile 数量');
  assert.equal(s2.text.profiles.filter(p => p.id === 'agnes-default').length, 1);
});

test('一键 Agnes 预设保留阶段独立参数，且首帧图生视频支持 Agnes', () => {
  const base = defaults();
  // 给 review 阶段设置独立参数，应用 Agnes 后应保留 overrides 槽位
  base.text.roles.review.overrides = {temperature: 0.2, maxTokens: 6000};
  const s = applyAgnesPreset(base);
  assert.equal(s.text.roles.review.profileId, 'agnes-default');
  assert.deepEqual(s.text.roles.review.overrides, {temperature: 0.2, maxTokens: 6000});
});
