import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, lstat, realpath, stat, link, unlink, statfs} from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export async function safeTarget(root, relative) {
  if (!path.isAbsolute(root) || root === path.parse(root).root || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p=>!p || p==='.' || p==='..' || p.includes(':'))) throw new Error('模型保存路径无效');
  await mkdir(root,{recursive:true});
  const base=await realpath(root), file=path.resolve(base,relative);
  if (!file.startsWith(base+path.sep)) throw new Error('模型保存路径越界');
  const parts=path.relative(base,file).split(path.sep);let current=base;
  for(const [i,part] of parts.entries()) {
    current=path.join(current,part);
    const s=await lstat(current).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(s?.isSymbolicLink())throw new Error('模型路径中不能包含链接或目录联接');
    if(i<parts.length-1){if(s&&!s.isDirectory())throw new Error('模型父路径不是目录');await mkdir(current,{recursive:true});}
  }
  return file;
}
export async function digestFile(file,signal) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)){signal?.throwIfAborted();hash.update(chunk);}
  return hash.digest('hex');
}
function sourceUrl(raw) {
  const u=new URL(raw);
  const domains=['huggingface.co','hf.co','github.com','githubusercontent.com'];
  if(u.protocol!=='https:' || u.username || u.password || !domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new Error('下载源必须来自模型目录认可的 HTTPS 官方分发域');
  return u;
}
export async function officialFetch(url,options={},fetchImpl=fetch) {
  let current=sourceUrl(url);
  for(let i=0;i<8;i++){
    const r=await fetchImpl(current,{...options,redirect:'manual'});
    if(![301,302,303,307,308].includes(r.status))return r;
    const next=new URL(r.headers.get('location'),current);await r.body?.cancel();current=sourceUrl(next);
  }
  throw new Error('下载源重定向过多');
}
export async function downloadFile(asset,root,{signal,onProgress=()=>{},fetchImpl=fetch}={}) {
  if(!Number.isSafeInteger(asset.size)||asset.size<=0||!/^\w{64}$/.test(asset.sha256)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw new Error('下载清单缺少有效的大小或 SHA-256');
  const file=await safeTarget(root,asset.target), part=await safeTarget(root,asset.target+'.part');
  const existing=await stat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(existing){onProgress({phase:'verifying',completed:asset.size,total:asset.size});if(existing.size!==asset.size || await digestFile(file,signal)!==asset.sha256)throw new Error('已有模型文件校验失败，请先移走该文件：'+asset.target);return file;}
  let offset=(await stat(part).catch(e=>{if(e.code!=='ENOENT')throw e;return {size:0};})).size;
  if(offset>asset.size){await unlink(part);offset=0;}
  const space=await statfs(path.dirname(file));
  if(Number(space.bavail)*Number(space.bsize)<asset.size-offset+128*1024*1024)throw new Error('模型目录所在磁盘空间不足');
  if(offset<asset.size) {
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(6*60*60*1000)]):AbortSignal.timeout(6*60*60*1000);
    const r=await officialFetch(asset.url,{signal:requestSignal,headers:offset?{Range:`bytes=${offset}-`}:{}},fetchImpl);
    if(!r.ok){await r.body?.cancel();throw new Error(`下载失败 HTTP ${r.status}，未完成数据已保留，可重试续传`);}
    if(r.status===206) {
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')||'');
      if(!range||Number(range[1])!==offset||Number(range[3])!==asset.size){await r.body?.cancel();throw new Error('下载源返回了不匹配的续传范围');}
    } else if(r.status===200) offset=0;
    else {await r.body?.cancel();throw new Error('下载源返回了不支持的状态');}
    let completed=offset;
    const meter=new Transform({transform(chunk,_,done){completed+=chunk.length;if(completed>asset.size)return done(new Error('下载数据超出清单大小'));onProgress({phase:'downloading',completed,total:asset.size});done(null,chunk);}});
    await pipeline(Readable.fromWeb(r.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal:requestSignal});
  }
  signal?.throwIfAborted();onProgress({phase:'verifying',completed:asset.size,total:asset.size});
  const size=(await stat(part)).size;
  if(size!==asset.size)throw new Error('下载未完成，已保留分段文件供续传');
  if(await digestFile(part,signal)!==asset.sha256){await unlink(part);throw new Error('SHA-256 不匹配，已移除损坏的临时下载，请重试');}
  // A concurrent external file must never be overwritten.
  await link(part,file);await unlink(part);return file;
}
