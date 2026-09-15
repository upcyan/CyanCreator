import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function git(root,...args){return (await exec('git',args,{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
export async function inspectUpdate(root,fetchRemote=true){
  const remote=await git(root,'remote','get-url','origin');
  if(!/^https:\/\/github\.com\/upcyan\/CyanCreator(?:\.git)?$/i.test(remote))throw new Error('平台更新仅支持官方 HTTPS origin 仓库');
  const branch=await git(root,'branch','--show-current');
  if(branch!=='main')throw new Error('请先切换到 main 分支');
  if(await git(root,'status','--porcelain'))throw new Error('存在本地代码改动，请先提交或备份并清理工作区');
  if(fetchRemote)await git(root,'fetch','origin','main');
  const current=await git(root,'rev-parse','HEAD'),target=await git(root,'rev-parse','origin/main');
  await git(root,'merge-base','--is-ancestor',current,target).catch(()=>{throw new Error('本地与远端分叉或本地领先，请手动处理 Git');});
  return {current,target,available:current!==target,commits:await git(root,'log','--format=%h %s',current+'..'+target)};
}
