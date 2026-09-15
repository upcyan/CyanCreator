const hf = (repo, revision, file, target, size, sha256) => ({url:`https://huggingface.co/${repo}/resolve/${revision}/${file}`,target,size,sha256});
export const llamaRuntime = {
  id:'llama-b10964-vulkan',target:'llama-b10964-vulkan.zip',size:31674542,
  url:'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-vulkan-x64.zip',
  sha256:'1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642'
};
export const modelCatalog = [
  {id:'qwen25-small',name:'Qwen 2.5 · 0.5B',kind:'text',runtime:'llama',port:11435,quantization:'Q4_K_M',description:'轻量连通验证模型；适合验证本地部署，不作为长篇写作质量基线。',source:'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',assets:[
    hf('Qwen/Qwen2.5-0.5B-Instruct-GGUF','9217f5db79a29953eb74d5343926648285ec7e67','qwen2.5-0.5b-instruct-q4_k_m.gguf','text/qwen2.5-0.5b-instruct-q4_k_m.gguf',491400032,'74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db')
  ]},
  {id:'qwen3-8b',name:'Qwen 3 · 8B',kind:'text',runtime:'llama',port:11436,quantization:'Q4_K_M',description:'本地故事与剧本候选。Vulkan 支持取决于实际驱动；长上下文额外占用显存。',source:'https://huggingface.co/Qwen/Qwen3-8B-GGUF',assets:[
    hf('Qwen/Qwen3-8B-GGUF','7c41481f57cb95916b40956ab2f0b139b296d974','Qwen3-8B-Q4_K_M.gguf','text/Qwen3-8B-Q4_K_M.gguf',5027783488,'d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785')
  ]},
  {id:'wan21',name:'Wan 2.1 · 1.3B',kind:'video',runtime:'comfy',quantization:'扩散 FP16 / 编码器 FP8',description:'轻量文生视频基线，无原生音轨。使用 ComfyUI 原生节点。',source:'https://docs.comfy.org/tutorials/video/wan/wan-video',assets:[
    hf('Comfy-Org/Wan_2.1_ComfyUI_repackaged','617a7633e636506f850e043bc4605f290a466a8e','split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors','diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',2838303560,'be531024cd9018cb5b48c40cfbb6a6191645b1c792eb8bf4f8c1c6e10f924dc5'),
    hf('Comfy-Org/Wan_2.1_ComfyUI_repackaged','617a7633e636506f850e043bc4605f290a466a8e','split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors','text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',6735906897,'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68'),
    hf('Comfy-Org/Wan_2.1_ComfyUI_repackaged','617a7633e636506f850e043bc4605f290a466a8e','split_files/vae/wan_2.1_vae.safetensors','vae/wan_2.1_vae.safetensors',253815318,'2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b')
  ]},
  {id:'minimax-h3',name:'MiniMax H3',kind:'video',runtime:'comfy',quantization:'INT8 / NVFP4',description:'原生音画生成。权重体积较大；量化格式及卸载策略需要在目标显卡验证。',source:'https://github.com/MiniMax-AI/MiniMax-H3',assets:[
    hf('Comfy-Org/MiniMax-H3','a98869194787969724c7425d95d0ed73ce9202af','diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors','diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',20970379616,'e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a'),
    hf('Comfy-Org/MiniMax-H3','a98869194787969724c7425d95d0ed73ce9202af','text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors','text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',15687142551,'35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6'),
    hf('Comfy-Org/MiniMax-H3','a98869194787969724c7425d95d0ed73ce9202af','vae/minimax_h3_video_vae_fp16.safetensors','vae/minimax_h3_video_vae_fp16.safetensors',5207808496,'7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522'),
    hf('Comfy-Org/MiniMax-H3','a98869194787969724c7425d95d0ed73ce9202af','vae/minimax_h3_audio_vae_fp32.safetensors','vae/minimax_h3_audio_vae_fp32.safetensors',605254808,'8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48')
  ]}
];
export function catalogEntry(id) {const e=modelCatalog.find(e=>e.id===id);if(!e)throw new Error('模型不在下载目录中');return e;}
export const publicCatalog = () => modelCatalog.map(({assets,...entry})=>({...entry,bytes:assets.reduce((n,a)=>n+a.size,0),files:assets.map(a=>a.target)}));
