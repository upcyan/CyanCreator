import {spawn} from 'node:child_process';

let probe;
export function dpapiAvailable(){
  if(process.platform!=='win32')return Promise.resolve(true);
  probe??=new Promise(resolve=>{
    const script='Add-Type -AssemblyName System.Security; [Security.Cryptography.ProtectedData]::Protect([byte[]]@(1),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser) | Out-Null';
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore'});
    child.once('error',()=>resolve(false));
    child.once('close',code=>resolve(code===0));
  });
  return probe;
}

export function legacyDpapiBlob(entries){
  const script='Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $out=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($out))';
  const legacyPlaintext=Buffer.from(JSON.stringify(entries)).toString('base64');
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk);
    child.stderr.on('data',chunk=>err+=chunk);
    child.stdin.on('error',()=>{});
    child.once('error',reject);
    child.once('close',code=>code===0?resolve(Buffer.from(out.trim(),'base64')):reject(new Error(err||'DPAPI fixture failed')));
    child.stdin.end(Buffer.from(legacyPlaintext).toString('base64'));
  });
}
