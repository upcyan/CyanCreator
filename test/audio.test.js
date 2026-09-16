import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {run,render} from '../lib/media.js';
import {inspectAudio,validateTracks} from '../lib/audio.js';
test('真实音频分析、时间线音轨校验与 FFmpeg 配音配乐混音',async()=>{
 await mkdir('test-output',{recursive:true});const root=await mkdtemp(path.resolve('test-output/audio-')),audio=path.join(root,'tone.wav'),video=path.join(root,'video.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=500:duration=1','-c:a','pcm_s16le',audio]);const meta=await inspectAudio(audio);assert.equal(meta.kind,'audio');
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=green:size=128x128:rate=24:duration=2','-c:v','libx264',video]);const assets=[{id:'a',file:audio,...meta},{id:'v',file:video,duration:2,audio:false}];const tracks=[{assetId:'a',role:'voice',start:0,end:1,offset:0.5,volume:0.7,fadeIn:0.1,fadeOut:0.1}];assert.throws(()=>validateTracks([{...tracks[0],assetId:'other'}],assets));const out=path.join(root,'mix.mp4');const result=await render([{assetId:'v',start:0,end:2,volume:1}],assets,root,out,undefined,tracks);assert.equal(result.audio,true);assert.ok(result.duration>=2);const measurement=await run(ffmpeg,['-v','error','-i',out,'-map','0:a','-f','s16le','-']);assert.ok(measurement.length>1000);
});
