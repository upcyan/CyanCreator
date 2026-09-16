import {writeFile,rename,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// Serialize writes and retry Windows sharing violations without blocking HTTP cancellation.
export class WorkspaceStore {
  constructor(file,io={writeFile,rename,unlink}){this.file=file;this.io=io;this.pending=null;this.writing=null;this.error='';}
  schedule(value){this.pending=JSON.stringify(value);this.start();}
  start(){if(this.writing||this.pending===null)return;this.writing=this.drain().catch(e=>{this.error=e.code||e.message;}).finally(()=>{this.writing=null;});}
  async drain(){while(this.pending!==null){const snapshot=this.pending;this.pending=null;const temporary=this.file+'.'+process.pid+'.tmp';try{await this.io.writeFile(temporary,snapshot);for(let attempt=0;;attempt++){try{await this.io.rename(temporary,this.file);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=7)throw e;await delay(50*(attempt+1));}}this.error='';}catch(e){if(this.pending===null)this.pending=snapshot;await this.io.unlink(temporary).catch(()=>{});throw e;}}}
  async flush(){this.start();await this.writing;if(this.error)throw new Error('工作区暂时无法保存（'+this.error+'），请检查文件占用和磁盘权限；内存中的修改仍保留，请重试保存。');}
}
