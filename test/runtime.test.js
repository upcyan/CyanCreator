import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {deploymentDefaults} from '../lib/local-runtime.js';
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
