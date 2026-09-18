import {chatCompletion} from './chat-stream.js';
import {secretValue} from './secrets.js';
import {setTimeout as delay} from 'node:timers/promises';
import {buildWorkflow, messages, validateDocument, requireValue, validateEndpoint} from './core.js';

export async function request(base, path, options = {}) {
  validateEndpoint(base);
  let r;
  try {r = await fetch(base.replace(/\/$/, '') + path, {...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs??180000)]) : AbortSignal.timeout(15000)});}
  catch(e) {
    if(options.signal?.aborted)throw e;
    const code=e.cause?.code||e.code||e.name, origin=new URL(base).origin;
    const hint=code==='ECONNREFUSED'?'服务未启动或端口不正确；请启动对应运行环境并检查服务地址':code==='ENOTFOUND'||code==='EAI_AGAIN'?'域名解析失败，请检查网络和服务地址':/TIMEOUT|Timeout/i.test(code)?'连接超时，请检查服务状态和网络':'请检查运行环境日志、网络与服务地址';
    throw new Error(`无法连接模型服务 ${origin}（${code}）：${hint}`);
  }
  if (!r.ok) throw new Error(`模型服务 HTTP ${r.status}；请检查服务日志和配置`);
  return r;
}
function headers(config) {
  const key = config.keyEnv ? secretValue(config.keyEnv) : '';
  requireValue(!config.keyEnv || key, `密钥引用 ${config.keyEnv} 尚未配置`);
  return {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {})};
}
export async function generateText(stage, project, config, signal, onProgress) {
  requireValue(config.model.trim(), '请先在设置中心配置文本模型名称');
  const data=await chatCompletion(config,messages(stage,project),signal,onProgress);
  requireValue(data.choices?.[0]?.finish_reason !== 'length', '模型输出被截断，请增加输出 token 上限或减少篇幅');
  const raw = data.choices?.[0]?.message?.content;
  requireValue(typeof raw === 'string', '服务未返回文本内容');
  let result; try {result = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));} catch {throw new Error('模型返回了无效 JSON；请换用支持结构化输出的模型');}
  return validateDocument(stage, result);
}
export async function probe(config, kind) {
  const path = kind === 'comfy' ? '/system_stats' : '/models';
  const data = await (await request(config.baseUrl, path, {headers: kind === 'comfy' ? {} : headers(config)})).json();
  return kind === 'comfy' ? {devices: data.devices, version: data.system?.comfyui_version, ...(await preflight(config))} : {models: (data.data || []).map(m => m.id)};
}
export async function preflight(config) {
  const graph = buildWorkflow(config, 'preflight');
  const missing = [];
  for (const type of new Set(Object.values(graph).map(n => n.class_type))) {
    const info = await (await request(config.baseUrl, '/object_info/' + encodeURIComponent(type))).json();
    if (!info[type]) {missing.push(`缺少节点 ${type}`); continue;}
    const spec = {...info[type].input?.required, ...info[type].input?.optional};
    for (const node of Object.values(graph).filter(n => n.class_type === type)) {
      for (const [name, value] of Object.entries(node.inputs)) {
        const rule = spec[name];
        const options = Array.isArray(rule?.[0]) ? rule[0] : rule?.[1]?.options;
        if (Array.isArray(options) && !Array.isArray(value) && options.every(v => typeof v === 'string') && !options.includes(value)) missing.push(`${type}.${name} 不可用：${value}`);
      }
    }
  }
  return {ready: !missing.length, missing, note: '仅验证节点与枚举/权重可见性，显存和推理成功需实际生成验证。'};
}
export async function comfyVideo(config, prompt, signal, onRemote) {
  const graph = buildWorkflow(config, prompt);
  const check = await preflight(config);
  requireValue(check.ready, check.missing.join('；'));
  const submitted = await (await request(config.baseUrl, '/prompt', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal, body: JSON.stringify({prompt: graph, client_id: crypto.randomUUID()})})).json();
  requireValue(submitted.prompt_id && !submitted.error && !Object.keys(submitted.node_errors || {}).length, 'ComfyUI 拒绝了工作流；请检查节点、权重和参数');
  onRemote(submitted.prompt_id);
  const end = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < end) {
    signal.throwIfAborted();
    const data = await (await request(config.baseUrl, `/history/${encodeURIComponent(submitted.prompt_id)}`, {signal})).json();
    const history = data[submitted.prompt_id];
    if (history?.status?.status_str === 'error') throw new Error('ComfyUI 推理失败；请检查显存及服务日志');
    if (history?.status?.completed) {
      const outputs = config.outputNode ? [history.outputs?.[config.outputNode]] : Object.values(history.outputs || {});
      const files = outputs.flatMap(o => [...(o?.videos || []), ...(o?.gifs || []), ...(o?.images || [])]).filter(f => /\.(mp4|webm|mov)$/i.test(f.filename));
      requireValue(files.length === 1, `找到 ${files.length} 个视频输出，请绑定唯一的视频输出节点`);
      const f = files[0];
      return request(config.baseUrl, '/view?' + new URLSearchParams({filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output'}), {signal});
    }
    await delay(2000, undefined, {signal});
  }
  throw new Error('等待超过 2 小时，远端任务可能仍在执行，请检查 ComfyUI');
}
export async function minimaxVideo(config, prompt, duration, signal, onRemote, image=null) {
  requireValue(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'T2V-01-Director', 'T2V-01'].includes(config.model), '当前云适配器仅支持 MiniMax V1 模型；H3 请使用本地 ComfyUI');
  requireValue([6, 10].includes(duration), 'MiniMax V1 镜头时长需为 6 或 10 秒');
  const h = headers(config);
  const check = d => {requireValue(!d.base_resp?.status_code, `MiniMax 返回错误代码 ${d.base_resp?.status_code}`); return d;};
  const task = check(await (await request(config.baseUrl, '/video_generation', {method: 'POST', headers: h, signal, body: JSON.stringify({model: config.model, prompt, duration, resolution: '768P', ...(image?{first_frame_image:`data:${image.mime};base64,${image.bytes.toString('base64')}`}:{})})})).json());
  requireValue(task.task_id, '未返回 MiniMax 任务 ID'); onRemote(task.task_id);
  for (let i = 0; i < 720; i++) {
    const data = check(await (await request(config.baseUrl, '/query/video_generation?task_id=' + encodeURIComponent(task.task_id), {headers: h, signal})).json());
    if (data.status === 'Fail') throw new Error('MiniMax 视频生成失败');
    if (data.status === 'Success') {
      const f = check(await (await request(config.baseUrl, '/files/retrieve?file_id=' + encodeURIComponent(data.file_id), {headers: h, signal})).json());
      const u = new URL(f.file?.download_url); requireValue(u.protocol === 'https:', '无效视频下载地址');
      const r = await fetch(u, {signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]), redirect: 'error'});
      requireValue(r.ok, '下载视频失败'); return r;
    }
    await delay(10000, undefined, {signal});
  }
  throw new Error('MiniMax 任务等待超时，远端任务可能仍在执行');
}
