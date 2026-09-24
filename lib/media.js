import {mixAudio} from './audio.js';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {number, requireValue} from './core.js';
import {normalizeTransition} from './transitions.js';

// 统一的媒体二进制解析：环境变量优先，回退到随包安装的静态二进制。
// 所有调用点（含测试）都必须经由此处，避免某处绕过 FFMPEG_PATH 覆盖。
export const ffmpegPath = () => process.env.FFMPEG_PATH || ffmpeg;
export const ffprobePath = () => process.env.FFPROBE_PATH || ffprobe.path;

export function run(exe, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {windowsHide: true, signal});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => {stdout = (stdout + d).slice(-1000000);});
    child.stderr.on('data', d => {stderr = (stderr + d).slice(-2000);});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`媒体处理失败 (${code})：${stderr.slice(-800)}`)));
  });
}
export async function inspect(file, signal) {
  const data = JSON.parse(await run(ffprobePath(), ['-v', 'error', '-format_whitelist', 'mov,matroska,webm', '-show_streams', '-show_format', '-of', 'json', file], signal));
  const video = data.streams.find(s => s.codec_type === 'video');
  requireValue(video, '文件不包含有效视频轨道');
  const duration = Number(data.format.duration);
  number(duration, 0.01, 86400, '素材时长');
  const webm = data.format.format_name.includes('webm');
  return {duration, width: video.width, height: video.height, audio: data.streams.some(s => s.codec_type === 'audio'), mime: webm ? 'video/webm' : 'video/mp4', extension: webm ? 'webm' : 'mp4'};
}
const FADE=0.5;
export async function render(timeline, assets, folder, output, signal, audioTracks=[], preset={width:1280,height:720}, subtitles=[]) {
  const W=preset.width,H=preset.height;requireValue([[1280,720],[1920,1080],[720,1280],[1080,1920]].some(([w,h])=>w===W&&h===H),'导出档位无效');
  requireValue(Array.isArray(subtitles)&&subtitles.length<=500,'字幕条目过多（最多 500）');
  for (const st of subtitles) {number(st.start,0,86400,'字幕起点');number(st.end,st.start+0.1,86400,'字幕终点');requireValue(typeof st.text==='string'&&st.text.trim()&&st.text.length<=200,'字幕文本无效（1–200 字）');}
  // 转场段校验：带转场的片段尾部与下一片段重叠 0.5s（时间线要么全硬切、要么每个衔接处都有转场）
  requireValue(timeline.length > 0 && timeline.length <= 200, '时间线需要 1–200 个片段');
  for (const [i,clip] of timeline.entries()) if (clip.transition) requireValue(i<timeline.length-1,'转场不能用于最后一个片段');
  const parts = [];
  for (const [index, clip] of timeline.entries()) {
    const asset = assets.find(a => a.id === clip.assetId);
    requireValue(asset, '时间线素材不存在');
    number(clip.start, 0, asset.duration, '入点'); number(clip.end, clip.start + 0.04, asset.duration + 0.02, '出点'); number(clip.volume, 0, 2, '音量');
    const dest = path.join(folder, `part-${index}.mp4`);
    const fade = !!clip.transition&&index<timeline.length-1;
    const span = clip.end-clip.start+(fade?FADE:0);
    const args = ['-y', '-nostdin', '-v', 'error', '-ss', String(clip.start), '-i', asset.file];
    if (!asset.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    args.push('-t', String(span), '-map', '0:v:0', '-map', asset.audio ? '0:a:0' : '1:a:0', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`, '-af', `volume=${clip.volume},apad`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', dest);
    await run(ffmpegPath(), args, signal); parts.push(`file 'part-${index}.mp4'`);
  }
  const joins = timeline.slice(0,-1).map(c=>normalizeTransition(c.transition)); // '' = 硬切
  const fades = joins.map(Boolean);
  const needsFilter = fades.some(Boolean) || subtitles.length;
  if (!needsFilter) {
    const manifest = path.join(folder, 'concat.txt'); await writeFile(manifest, parts.join('\n'));
    await run(ffmpegPath(), ['-y', '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', manifest, '-c', 'copy', '-movflags', '+faststart', audioTracks.length?path.join(folder,'base.mp4'):output], signal);
  } else {
    // 组装 xfade 链（fade 必须统一应用于所有衔接处，时长固定 0.5s）或全量 concat
    requireValue(joins.every(Boolean), '转场需用于所有片段衔接处，或全部使用硬切（各衔接处可选用不同转场类型）');
    const durations = timeline.map((c,i)=>(c.end-c.start)+(fades[i]?FADE:0));
    let expr='', label='0:v';
    if (fades.some(Boolean)) {
      let off=0;
      const chain=[];
      let prev='[0:v]';
      for (let i=1;i<parts.length;i++) {
        off += durations[i-1]-FADE;
        const out=i<parts.length-1?`vx${i}`:'vxf';
        chain.push(`${prev}[${i}:v]xfade=transition=${joins[i-1]}:duration=${FADE}:offset=${off.toFixed(3)}[${out}]`);
        prev=`[${out}]`;
      }
      expr=chain.join(';');label='vxf';
    } else {
      expr = `${timeline.map((_,i)=>`[${i}:v]`).join('')}concat=n=${parts.length}:v=1:a=0[vout]`; label='vout';
    }
    if (subtitles.length) {
      const escapes = t => t.replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\\"").replace(/%/g,'\\%');
      const draw = subtitles.map(st=>`drawtext=text='${escapes(st.text)}':enable='between(t,${st.start.toFixed(2)},${st.end.toFixed(2)})':fontcolor=white:fontsize=${Math.round(H/22)}:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=h-text_h-${Math.round(H/14)}`).join(',');
      expr = `${expr};[${label}]${draw}[vsub]`; label='vsub';
    }
    const inputs = [];
    for (let i=0;i<parts.length;i++) inputs.push('-i', path.join(folder, `part-${i}.mp4`));
    await run(ffmpegPath(), ['-y','-nostdin','-v','error',...inputs,'-filter_complex',expr,'-map',`[${label}]`,'-map',`${parts.length-1}:a?`,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart', audioTracks.length?path.join(folder,'base.mp4'):output], signal);
  }
  if(audioTracks.length)await mixAudio(path.join(folder,'base.mp4'),output,audioTracks,assets,timeline.reduce((sum,c)=>sum+c.end-c.start,0),signal);
  return inspect(output, signal);
}
