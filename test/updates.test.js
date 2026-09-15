import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {inspectUpdate} from '../lib/updates.js';
const exec=promisify(execFile);
test('更新工作进程备份数据库、快进代码、安装依赖并重新启动',async()=>{
  await mkdir('test-output',{recursive:true});const root=await mkdtemp(path.resolve('test-output/update-')),data=path.join(root,'data');await mkdir(data);
  const git=(...args)=>exec('git',args,{cwd:root,windowsHide:true});
  await git('init','-b','main');await writeFile(path.join(root,'.gitignore'),'data/\nnode_modules/\n');
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'update-fixture',version:'1.0.0',scripts:{check:'node --check server.js'}}));
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({name:'update-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'update-fixture',version:'1.0.0'}}}));
  await writeFile(path.join(root,'server.js'),"require('fs').writeFileSync(process.env.CYANCREATOR_DATA+'/restarted','yes')");
  await git('add','.');await git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','base');
  const base=(await git('rev-parse','HEAD')).stdout.trim();await writeFile(path.join(root,'release.txt'),'new');await git('add','.');await git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','release');const target=(await git('rev-parse','HEAD')).stdout.trim();await git('checkout','--detach',base);
  await writeFile(path.join(data,'workspace.json'),'{}');
  await exec(process.execPath,[path.resolve('lib/update-worker.js'),root,data,target,'99999999'],{timeout:60000,windowsHide:true});
  for(let i=0;i<50;i++){try{await readFile(path.join(data,'restarted'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.equal(await readFile(path.join(data,'restarted'),'utf8'),'yes');assert.equal((await git('rev-parse','HEAD')).stdout.trim(),target);assert.ok((await readdir(data)).some(x=>x.startsWith('workspace-before-update-')));assert.equal(JSON.parse(await readFile(path.join(data,'update-status.json'),'utf8')).phase,'restarting');
  await git('remote','add','origin','https://example.invalid/repo');await assert.rejects(inspectUpdate(root,false),/官方/);
});
