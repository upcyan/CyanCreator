// Adapted from the official Comfy-Org H3 T2V graph, checked against local
// ComfyUI 0.31.0 /object_info on 2026-09-14. No weights are bundled.
export function h3Preset() {
  return {
    provider:'comfy',baseUrl:'http://127.0.0.1:8188',model:'MiniMax-H3',keyEnv:'',
    profile:'MiniMax H3 · INT8 / NVFP4 · 480p 基线（待实测）',outputNode:'14',durationMode:'h3',
    params:{seed:42,steps:20,width:864,height:480,frames:124,diffusion:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',encoder:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',videoVae:'minimax_h3_video_vae_fp16.safetensors',audioVae:'minimax_h3_audio_vae_fp32.safetensors'},
    bindings:{prompt:{node:'5',input:'prompt'},seed:{node:'6',input:'noise_seed'},steps:{node:'9',input:'steps'},width:{node:'5',input:'width'},height:{node:'5',input:'height'},frames:{node:'5',input:'length'},diffusion:{node:'1',input:'unet_name'},encoder:{node:'2',input:'clip_name'},videoVae:{node:'3',input:'vae_name'},audioVae:{node:'4',input:'vae_name'}},
    workflow:{
      '1':{class_type:'UNETLoader',inputs:{unet_name:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}},
      '2':{class_type:'CLIPLoader',inputs:{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}},
      '3':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_fp16.safetensors'}},
      '4':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}},
      '5':{class_type:'MiniMaxH3ImageToVideo',inputs:{clip:['2',0],vae:['3',0],prompt:'',width:864,height:480,length:124}},
      '6':{class_type:'RandomNoise',inputs:{noise_seed:42}},
      '7':{class_type:'BasicGuider',inputs:{model:['1',0],conditioning:['5',0]}},
      '8':{class_type:'KSamplerSelect',inputs:{sampler_name:'res_multistep'}},
      '9':{class_type:'BasicScheduler',inputs:{model:['1',0],scheduler:'simple',steps:20,denoise:1}},
      '10':{class_type:'SamplerCustomAdvanced',inputs:{noise:['6',0],guider:['7',0],sampler:['8',0],sigmas:['9',0],latent_image:['5',1]}},
      '11':{class_type:'VAEDecode',inputs:{samples:['10',0],vae:['3',0]}},
      '12':{class_type:'VAEDecodeAudio',inputs:{samples:['10',0],vae:['4',0]}},
      '13':{class_type:'CreateVideo',inputs:{images:['11',0],audio:['12',0],fps:24,bit_depth:8}},
      '14':{class_type:'SaveVideo',inputs:{video:['13',0],filename_prefix:'video/CyanCreator_H3',format:'mp4',codec:'auto'}}
    }
  };
}
export function h3Frames(seconds) {const frames=Math.max(5,Math.round(seconds*24));return frames+(5-frames%17+17)%17;}
