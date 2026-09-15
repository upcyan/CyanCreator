import {h3Preset, h3Frames} from './h3.js';
import {nativePreset} from './native-video.js';

export function wanPreset() {
  return {provider:'comfy',baseUrl:'http://127.0.0.1:8188',model:'Wan2.1-T2V-1.3B',keyEnv:'',profile:'Wan 2.1 · 1.3B FP16 / 文本编码器 FP8',outputNode:'11',durationMode:'wan',
    params:{negative:'blurry, distorted, static, watermark, subtitles',seed:42,steps:20,cfg:6,width:832,height:480,frames:81},
    bindings:{negative:{node:'5',input:'text'},prompt:{node:'4',input:'text'},seed:{node:'8',input:'seed'},steps:{node:'8',input:'steps'},cfg:{node:'8',input:'cfg'},width:{node:'7',input:'width'},height:{node:'7',input:'height'},frames:{node:'7',input:'length'}},
    workflow:{
      '1':{class_type:'UNETLoader',inputs:{unet_name:'wan2.1_t2v_1.3B_fp16.safetensors',weight_dtype:'default'}},
      '2':{class_type:'CLIPLoader',inputs:{clip_name:'umt5_xxl_fp8_e4m3fn_scaled.safetensors',type:'wan',device:'default'}},
      '3':{class_type:'VAELoader',inputs:{vae_name:'wan_2.1_vae.safetensors'}},
      '4':{class_type:'CLIPTextEncode',inputs:{text:'',clip:['2',0]}},
      '5':{class_type:'CLIPTextEncode',inputs:{text:'blurry, distorted, static, watermark, subtitles',clip:['2',0]}},
      '6':{class_type:'ModelSamplingSD3',inputs:{model:['1',0],shift:8}},
      '7':{class_type:'EmptyHunyuanLatentVideo',inputs:{width:832,height:480,length:81,batch_size:1}},
      '8':{class_type:'KSampler',inputs:{model:['6',0],positive:['4',0],negative:['5',0],latent_image:['7',0],seed:42,steps:20,cfg:6,sampler_name:'uni_pc',scheduler:'simple',denoise:1}},
      '9':{class_type:'VAEDecode',inputs:{samples:['8',0],vae:['3',0]}},
      '10':{class_type:'CreateVideo',inputs:{images:['9',0],fps:16}},
      '11':{class_type:'SaveVideo',inputs:{video:['10',0],filename_prefix:'video/CyanCreator_Wan',format:'mp4',codec:'auto'}}
    }
  };
}
export const videoPresets = [{id:'minimax-h3',name:'MiniMax H3 · 原生音画',create:h3Preset},{id:'wan21',name:'Wan 2.1 · 1.3B 文生视频',create:wanPreset}];
export function videoPreset(id) {if(id==='wan21-native')return nativePreset();const p=videoPresets.find(p=>p.id===id);if(!p)throw new Error('未知视频模型方案');return {...p.create(),catalogId:id};}
export function videoFrames(mode, seconds) {
  if(mode==='h3')return h3Frames(seconds);
  if(mode==='wan')return Math.ceil((Math.round(seconds*16)-1)/4)*4+1;
  throw new Error('未知时长换算模式');
}
