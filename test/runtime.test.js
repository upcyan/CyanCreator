import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {deploymentDefaults,validateDeploymentConfig} from '../lib/local-runtime.js';
import {request} from '../lib/providers.js';
test('ComfyUI Desktop 自动发现选择推理 venv 而非引导 Python',async()=>{
  await mkdir('test-output',{recursive:true});const desktop=await mkdtemp(path.resolve('test-output/runtime-'));
  const install=path.join(desktop,'ComfyUI-Installs','ComfyUI'),root=path.join(install,'ComfyUI');
  const python=path.join(root,'.venv','Scripts','python.exe');
  await mkdir(path.dirname(python),{recursive:true});await mkdir(path.join(install,'standalone-env'));
  await writeFile(python,'fixture');await writeFile(path.join(root,'main.py'),'fixture');await writeFile(path.join(install,'standalone-env','python.exe'),'bootstrap');
  assert.equal(deploymentDefaults(desktop,desktop).comfyPython,python);
});
test('关闭的本地模型服务返回端口和可操作提示',async()=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
  await assert.rejects(request(`http://127.0.0.1:${port}`,'/system_stats'),e=>e.message.includes(String(port))&&e.message.includes('ECONNREFUSED')&&e.message.includes('服务未启动'));
});

test('非 Windows 无 LOCALAPPDATA 时部署配置可校验（空字符串占位，不崩溃）',()=>{
  const saved=process.env.LOCALAPPDATA;
  try{
    delete process.env.LOCALAPPDATA;
    const cfg={comfyRoot:'',comfyPython:'',comfyModels:path.resolve('test-output'),comfyUrl:'http://127.0.0.1:8188',gpuLayers:99,contextSize:8192};
    const out=validateDeploymentConfig(cfg);
    assert.equal(out.nativePython,'','未设置 LOCALAPPDATA 时独立 Python 留空待配置');
    assert.equal(out.nativeDevice,'cuda');
  }finally{
    if(saved===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=saved;
  }
});
test('有 LOCALAPPDATA 时独立 Python 回落为基于该目录的默认路径',()=>{
  const saved=process.env.LOCALAPPDATA;
  try{
    const base=path.resolve('test-output','appdata-fixture');
    process.env.LOCALAPPDATA=base;
    const cfg={comfyRoot:'',comfyPython:'',comfyModels:path.resolve('test-output'),comfyUrl:'http://127.0.0.1:8188',gpuLayers:99,contextSize:8192};
    const out=validateDeploymentConfig(cfg);
    assert.equal(out.nativePython,path.join(base,'Programs','Python','Python312','python.exe'),'默认路径由 LOCALAPPDATA 推导');
    assert.ok(out.nativePython.toLowerCase().includes('python312'),'默认指向 Python312');
  }finally{
    if(saved===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=saved;
  }
});
