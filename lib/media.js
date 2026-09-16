import {mixAudio} from './audio.js';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {number, requireValue} from './core.js';

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
  const data = JSON.parse(await run(process.env.FFPROBE_PATH || ffprobe.path, ['-v', 'error', '-format_whitelist', 'mov,matroska,webm', '-show_streams', '-show_format', '-of', 'json', file], signal));
  const video = data.streams.find(s => s.codec_type === 'video');
  requireValue(video, '文件不包含有效视频轨道');
  const duration = Number(data.format.duration);
  number(duration, 0.01, 86400, '素材时长');
  const webm = data.format.format_name.includes('webm');
  return {duration, width: video.width, height: video.height, audio: data.streams.some(s => s.codec_type === 'audio'), mime: webm ? 'video/webm' : 'video/mp4', extension: webm ? 'webm' : 'mp4'};
}
export async function render(timeline, assets, folder, output, signal, audioTracks=[]) {
  requireValue(timeline.length > 0 && timeline.length <= 200, '时间线需要 1–200 个片段');
  const parts = [];
  for (const [index, clip] of timeline.entries()) {
    const asset = assets.find(a => a.id === clip.assetId);
    requireValue(asset, '时间线素材不存在');
    number(clip.start, 0, asset.duration, '入点'); number(clip.end, clip.start + 0.04, asset.duration + 0.02, '出点'); number(clip.volume, 0, 2, '音量');
    const dest = path.join(folder, `part-${index}.mp4`);
    const args = ['-y', '-nostdin', '-v', 'error', '-ss', String(clip.start), '-i', asset.file];
    if (!asset.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    args.push('-t', String(clip.end - clip.start), '-map', '0:v:0', '-map', asset.audio ? '0:a:0' : '1:a:0', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24', '-af', `volume=${clip.volume},apad`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', dest);
    await run(process.env.FFMPEG_PATH || ffmpeg, args, signal); parts.push(`file 'part-${index}.mp4'`);
  }
  const manifest = path.join(folder, 'concat.txt'); await writeFile(manifest, parts.join('\n'));
  await run(process.env.FFMPEG_PATH || ffmpeg, ['-y', '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', manifest, '-c', 'copy', '-movflags', '+faststart', audioTracks.length?path.join(folder,'base.mp4'):output], signal);
  if(audioTracks.length)await mixAudio(path.join(folder,'base.mp4'),output,audioTracks,assets,timeline.reduce((sum,c)=>sum+c.end-c.start,0),signal);
  return inspect(output, signal);
}
