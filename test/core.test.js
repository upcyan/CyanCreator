import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkflow, validateDocument, messages, validateEndpoint, defaults} from '../lib/core.js';
import {h3Frames, h3Preset} from '../lib/h3.js';

test('H3 基线按真实网格计算帧数并绑定量化权重', () => {
  assert.equal(h3Frames(5),124); assert.equal(h3Frames(15),362);
  const config=h3Preset(), graph=buildWorkflow(config,'short film');
  assert.equal(graph['5'].inputs.prompt,'short film');
  assert.match(graph['1'].inputs.unet_name,/int8/);
  assert.equal(graph['14'].inputs.video[0],'13');
});

test('工作流绑定确实修改推理输入且不污染原配置', () => {
  const config = {workflow:{'12':{class_type:'Text',inputs:{text:'old'}},'8':{class_type:'Sampler',inputs:{steps:20,seed:1}}},bindings:{prompt:{node:'12',input:'text'},steps:{node:'8',input:'steps'},seed:{node:'8',input:'seed'}},params:{steps:8,seed:42}};
  const result = buildWorkflow(config,'new prompt');
  assert.equal(result['12'].inputs.text,'new prompt');assert.equal(result['8'].inputs.steps,8);assert.equal(result['8'].inputs.seed,42);
  assert.equal(config.workflow['12'].inputs.text,'old');
  assert.throws(()=>buildWorkflow({...config,params:{...config.params,quantization:'int8'}},'x'),/未绑定/);
  assert.throws(()=>buildWorkflow({...config,bindings:{prompt:{node:'invalid',input:'text'}}},'x'),/不存在/);
});
test('结构化输出与服务边界校验', () => {
  assert.throws(()=>validateDocument('script',{scenes:[{title:'a',action:'b',shots:[{prompt:'c',duration:100}]}]}),/镜头秒数/);
  assert.throws(()=>validateDocument('outline',{logline:'a',beats:[]}),/beats/);
  assert.throws(()=>validateEndpoint('http://remote.test/v1'),/HTTPS/);
  assert.throws(()=>validateEndpoint('https://user:secret@remote.test'),/服务地址/);
  assert.equal(validateEndpoint('http://127.0.0.1:1234/v1').port,'1234');
  const m = messages('script',{brief:'brief',bible:'fixed character',outline:{logline:'story'}});
  assert.match(m[1].content,/fixed character/);assert.match(m[1].content,/story/);
  assert.equal(defaults().text.roles.review.overrides.temperature,0.2);
});
