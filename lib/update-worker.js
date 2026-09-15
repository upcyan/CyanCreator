// Copied into data before restart, so updating source cannot change this running worker.
import {execFileSync,spawn} from 'node:child_process';
import {writeFileSync,copyFileSync,existsSync,openSync} from 'node:fs';
import path from 'node:path';
const [root,data,target,parent]=process.argv.slice(2),status=path.join(data,'update-status.json');
const report=(phase,error='')=>writeFileSync(status,JSON.stringify({phase,error,target,at:new Date().toISOString()}));
const environment={...process.env,GIT_TERMINAL_PROMPT:'0'};
// npm injects this lifecycle-only flag when starting the app; npm ci rejects it.
for(const key of Object.keys(environment))if(key.toLowerCase()==='npm_config_allow_scripts')delete environment[key];
const run=(exe,args)=>execFileSync(exe,args,{cwd:root,windowsHide:true,timeout:600000,stdio:'pipe',env:environment});
try{
  for(let i=0;i<100;i++){let alive=true;try{process.kill(Number(parent),0);}catch{alive=false;}if(!alive)break;if(i===99)throw new Error('旧服务未退出');await new Promise(r=>setTimeout(r,200));}
  report('backup');const db=path.join(data,'workspace.json');if(existsSync(db))copyFileSync(db,path.join(data,'workspace-before-update-'+Date.now()+'.json'));
  if(run('git',['status','--porcelain']).toString().trim())throw new Error('工作区已变化，停止更新');
  report('pulling');run('git',['merge','--ff-only',target]);
  report('dependencies');
  const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  run(process.execPath,[npm,'ci']);run(process.execPath,[npm,'run','check']);
  report('restarting');
}catch(error){report('failed',String(error.message).slice(-2000));}
const log=openSync(path.join(data,'update-server.log'),'a');
const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,CYANCREATOR_DATA:data}});child.on('error',error=>report('failed',error.message));child.unref();
