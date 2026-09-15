let target;
export function updatePanel(){return `<section class="panel"><h2>平台更新</h2><p class="hint">从官方仓库检查更新。应用时备份项目数据库、安装依赖并重启服务，模型与素材保留。</p><div class="actions"><button data-action="update-check">检查更新</button><button data-action="update-apply">应用更新并重启</button></div><pre id="update-result" style="white-space:pre-wrap" aria-live="polite">请先保存编辑，再检查更新。</pre></section>`;}
export async function handleUpdate(action,api){
  const show=text=>{const el=document.querySelector('#update-result');if(el)el.textContent=text;};
  if(action==='update-check'){
    show('正在检查…');try{const result=await api('/api/updates/check','POST');target=result.available?result.target:null;show(result.available?`当前 ${result.current.slice(0,8)} → ${result.target.slice(0,8)}\n${result.commits}`:'当前代码已是最新版本');}catch(error){target=null;show(error.message);throw error;}return;
  }
  if(!target)throw new Error('请先检查并确认有可用更新');
  await api('/api/updates/apply','POST',{target});target=null;
  show('正在应用更新，服务暂时断开。请勿关闭后台进程…');
  for(let i=0;i<720;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{const response=await fetch('/api/updates/status',{cache:'no-store'});if(!response.ok)continue;const status=await response.json();if(status.phase==='failed'){show('更新失败：'+status.error+'\n请检查 data/update-server.log，修复后重新检查更新。');return;}if(status.phase==='succeeded'){location.reload();return;}}catch{}
  }
  show('服务未在预期时间内恢复。请查看 data/update-status.json 和 data/update-server.log；必要时在安装目录运行 npm start。');
}
