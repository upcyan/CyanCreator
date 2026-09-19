import {spawn} from 'node:child_process';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
let values={};const usedSecrets=new Set();
function normalize(entry){if(entry&&typeof entry==='object')return entry;if(entry)return {value:entry,createdAt:null};return {value:'',createdAt:null};}
export function secretValue(name){const e=values[name];const v=e!==undefined?normalize(e).value:(process.env[name]??'');if(v)usedSecrets.add(v);return v;}
export function secretStatus(){return Object.keys(values).map(name=>({name,configured:true,createdAt:normalize(values[name]).createdAt}));}
export function safeError(error){let text=String(error?.message||error);const secrets=[...Object.values(values).map(e=>typeof e==='object'&&e?e.value:e),...usedSecrets];for(const value of new Set(secrets))if(value)text=text.split(value).join('[已隐藏密钥]');return text;}
const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd() | ConvertFrom-Json; $bytes=[Convert]::FromBase64String($v.value); if($v.mode -eq 'encrypt'){$out=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}else{$out=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}; [Console]::Out.Write([Convert]::ToBase64String($out))`;
function protect(mode,value){
  if(process.platform!=='win32')throw new Error('内置密钥保险库当前仅支持 Windows DPAPI；其它系统请使用环境变量');
  return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';const timeout=setTimeout(()=>child.kill(),15000);child.stdout.on('data',d=>out+=d);child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',()=>{clearTimeout(timeout);reject(new Error('无法启动系统密钥保护服务'));});child.once('close',code=>{clearTimeout(timeout);code===0?resolve(Buffer.from(out.trim(),'base64')):reject(new Error('系统账户无法解密密钥保险库；请在原账户下运行或重新配置密钥'));});child.stdin.end(JSON.stringify({mode,value:Buffer.from(value).toString('base64')}));});
}
export class SecretVault{
  constructor(data){this.file=path.join(data,'secrets','vault.dpapi');this.busy=false;}
  async load(){let blob;try{blob=await readFile(this.file);}catch(e){if(e.code==='ENOENT')return;throw e;}values=JSON.parse((await protect('decrypt',blob)).toString('utf8'));}
  async set(name,value){
    if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(name)||typeof value!=='string'||value.length>16000)throw new Error('密钥名称或长度无效');
    if(this.busy)throw new Error('密钥正在保存，请稍后重试');this.busy=true;
    try{const next={...values};if(value){const prev=normalize(values[name]);next[name]={value,createdAt:prev.createdAt||new Date().toISOString()};}else delete next[name];const blob=await protect('encrypt',Buffer.from(JSON.stringify(next)));await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',blob,{mode:0o600});await rename(this.file+'.tmp',this.file);values=next;}finally{this.busy=false;}
  }
}
