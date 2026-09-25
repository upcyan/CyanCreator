import {spawn} from 'node:child_process';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
let values={};const usedSecrets=new Set();let sealedNote='';
function normalize(entry){if(entry&&typeof entry==='object')return entry;if(entry)return {value:entry,createdAt:null};return {value:'',createdAt:null};}
export function secretValue(name){const e=sealedNote?undefined:values[name];const v=e!==undefined?normalize(e).value:(process.env[name]??'');if(v)usedSecrets.add(v);return v;}
export function secretStatus(){return sealedNote?[]:Object.keys(values).map(name=>({name,configured:true,createdAt:normalize(values[name]).createdAt}));}
export function safeError(error){let text=String(error?.message||error);const secrets=[...Object.values(values).map(e=>typeof e==='object'&&e?e.value:e),...usedSecrets];for(const value of new Set(secrets))if(value)text=text.split(value).join('[已隐藏密钥]');return text;}
export function vaultBackend(){return {name:backend,note:backendNote||'',sealed:!!sealedNote,error:sealedNote,label:backend==='win-dpapi'?'Windows DPAPI':backend==='keyring'?'系统钥匙串':backend==='env-master'?'环境变量主密钥':'不可用'};}
export function decodeVaultEntries(plaintext,allowLegacyWindows=false){
  const raw=Buffer.from(plaintext).toString('utf8');
  // 旧版 Windows 保险库曾将 JSON 先编码为 Base64，再交给 DPAPI。
  const legacy=allowLegacyWindows&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw);
  const parsed=JSON.parse(legacy?Buffer.from(raw,'base64').toString('utf8'):raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('密钥保险库内容格式无效');
  return parsed;
}

// ---------- 后端探测与执行 ----------
const which=(cmd)=>new Promise(resolve=>{const child=spawn(cmd,['--help'],{stdio:['ignore','ignore','ignore']});const t=setTimeout(()=>{child.kill();resolve(false);},2500);child.once('error',()=>{clearTimeout(t);resolve(false);});child.once('close',()=>{clearTimeout(t);resolve(true);});});
const run=(cmd,args,input,timeoutMs=15000)=>new Promise((resolve,reject)=>{
 const child=spawn(cmd,args,{stdio:['pipe','pipe','pipe'],...(process.platform==='win32'?{windowsHide:true}:{})});
 let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('系统密钥工具超时'));},timeoutMs);
 child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.stdin.on('error',()=>{});
 child.once('error',e=>{clearTimeout(timer);reject(new Error('无法启动系统密钥保护服务'));});
 child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(err.trim().split('\n')[0]||'系统密钥工具退出码 '+code));});
 if(input!==undefined)child.stdin.end(input);else child.stdin.end();
});

const winScript=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd() | ConvertFrom-Json; $bytes=[Convert]::FromBase64String($v.value); if($v.mode -eq 'encrypt'){$out=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}else{$out=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}; [Console]::Out.Write([Convert]::ToBase64String($out))`;

let backend='unavailable'; // win-dpapai | keyring | env-master | unavailable
let backendNote='';

async function detectBackend(){
  if(process.platform==='win32'){backend='win-dpapi';backendNote='Windows DPAPI · 当前账户';return;}
  if(await which('secret-tool')){
    const service='cyancreator-vault-key';
    try{ // 先试读取；无条目报错但工具可用 → 试写入主密钥
      let out=await run('secret-tool',['lookup','service',service],undefined,5000).catch(e=>{throw e;});
      if(out&&out.trim().length>=32){backend='keyring';backendNote='系统钥匙串（libsecret）保管主密钥';return;}
      const master=randomBytes(32).toString('base64');
      await run('secret-tool',['store','service',service,'application','CyanCreator'],master,5000);
      backend='keyring';backendNote='系统钥匙串（libsecret）保管主密钥';return;
    }catch(e){backendNote='钥匙串工具存在但不可用：'+e.message;}
  } else if(await which('security')){
    const service='CyanCreatorVaultKey';
    try{
      let out=await run('security',['find-generic-password','-s',service,'-w'],undefined,5000).catch(e=>{throw e;});
      if(out&&out.trim().length>=32){backend='keyring';backendNote='macOS 钥匙串保管主密钥';return;}
      const master=randomBytes(32).toString('base64');
      await run('security',['add-generic-password','-s',service,'-a','CyanCreator','-w',master,'-U'],undefined,5000);
      backend='keyring';backendNote='macOS 钥匙串保管主密钥';return;
    }catch(e){backendNote='钥匙串工具存在但不可用：'+e.message;}
  } else backendNote='未找到 secret-tool / security';
  // 环境变量主密钥降级（32+ 字节任意内容）
  if((process.env.CYANCREATOR_VAULT_KEY||'').length>=32){backend='env-master';backendNote='环境变量 CYANCREATOR_VAULT_KEY 保管主密钥';return;}
  if(backendNote)backendNote+='；';
}

// ---------- 加解密原语 ----------
function winProtect(mode,value){return run('powershell.exe',['-NoProfile','-NonInteractive','-Command',winScript],JSON.stringify({mode,value:Buffer.from(value).toString('base64')})).then(out=>Buffer.from(out.trim(),'base64'));}
async function keyringMaster(){ // 返回 Buffer；首次访问生成并写回
  if(process.platform==='darwin'){const out=await run('security',['find-generic-password','-s','CyanCreatorVaultKey','-w'],undefined,8000);return Buffer.from(out.trim(),'base64');}
  const out=await run('secret-tool',['lookup','service','cyancreator-vault-key'],undefined,8000);return Buffer.from(out.trim(),'base64');
}
async function aesProtect(mode,value,master){
  const salt=Buffer.from('cyancreator-vault-v1','utf8');
  const key=scryptSync(master,salt,32);
  if(mode==='encrypt'){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    const enc=Buffer.concat([cipher.update(value),cipher.final()]),tag=cipher.getAuthTag();
    return Buffer.concat([Buffer.from('CV1'),iv,tag,enc]);
  }
  const head=Buffer.from(value.subarray(0,3));if(head.toString()!=='CV1')throw new Error('密钥保险库文件格式无法识别');
  const iv=value.subarray(3,15),tag=value.subarray(15,31),enc=value.subarray(31);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc),decipher.final()]);
}
async function protect(mode,value){ // value: Buffer / string → Buffer
  if(backend==='unavailable')await detectBackend();
  if(backend==='win-dpapi')return winProtect(mode,value);
  if(backend==='keyring')return aesProtect(mode,Buffer.from(value),await keyringMaster());
  if(backend==='env-master'){
    const master=process.env.CYANCREATOR_VAULT_KEY;
    if(!master||master.length<32){backend='unavailable';backendNote='环境变量 CYANCREATOR_VAULT_KEY 已不可用';throw new Error('本机没有可用的密钥加密方式：环境变量 CYANCREATOR_VAULT_KEY 已失效；请重新设置后重启，或改用普通环境变量保存密钥');}
    return aesProtect(mode,Buffer.from(value),Buffer.from(master,'utf8'));
  }
  throw new Error('本机没有可用的密钥加密方式：请安装 libsecret（secret-tool）/ 使用 macOS 钥匙串，或设置长度≥32 的环境变量 CYANCREATOR_VAULT_KEY；也可以继续使用普通环境变量保存密钥');
}

export class SecretVault{
  constructor(data){this.file=path.join(data,'secrets',process.platform==='win32'?'vault.dpapi':'vault.enc');this.busy=false;}
  async load(){
    sealedNote='';
    // 密文不可解密时进入锁定（sealed）而非崩溃：服务照常启动，环境变量密钥仍可用，
    // 保存被拒绝以保护原密文，用户可在设置中心确认后重置保险库。
    await detectBackend();
    let blob;try{blob=await readFile(this.file);}catch(e){if(e.code==='ENOENT'){values={};return;}throw e;}
    try{
      values=decodeVaultEntries(await protect('decrypt',blob),backend==='win-dpapi');
    }
    catch{
      values={};
      sealedNote=backend==='win-dpapi'
        ?'保险库密文无法在本机解密：常见于从其他机器复制 data 目录，或 Windows 账户已变更'
        :'保险库密文无法在本机解密：本机主密钥与密文不匹配';
      backendNote=(backendNote||'')+'；解密失败，已锁定';
      console.warn('[密钥保险库] '+sealedNote);
    }
  }
  backendLabel(){return backend==='win-dpapi'?'Windows DPAPI':backend==='keyring'?'系统钥匙串':backend==='env-master'?'环境变量主密钥':'不可用后端';}
  async set(name,value){
    if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(name)||typeof value!=='string'||value.length>16000)throw new Error('密钥名称或长度无效');
    await detectBackend();
    if(sealedNote)throw new Error('保险库密文无法在本机解密，已拒绝保存以保护原密文；请回到原 Windows 账户/机器恢复密钥，或在设置中心「密钥保险库」重置后重新录入');
    if(this.busy)throw new Error('密钥正在保存，请稍后重试');this.busy=true;
    try{const next={...values};if(value){const prev=normalize(values[name]);next[name]={value,createdAt:prev.createdAt||new Date().toISOString()};}else delete next[name];const blob=await protect('encrypt',Buffer.from(JSON.stringify(next)));await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',blob,{mode:0o600});await rename(this.file+'.tmp',this.file);values=next;}finally{this.busy=false;}
  }
  async reset(){ // 仅锁定状态下可用；旧密文改名保留，不直接删除
    if(!sealedNote)throw new Error('保险库当前可正常解密，未提供重置；如需清空请逐个移除密钥');
    try{await rename(this.file,this.file+'.unreadable-'+Date.now());}catch(e){if(e.code!=='ENOENT')throw e;}
    values={};sealedNote='';backendNote=(backendNote||'')+'；已重置（旧密文改名保留）';
  }
}
