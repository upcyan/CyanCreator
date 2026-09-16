// Official repository snapshot. JSON and weights are all SHA-256 pinned.
export const nativeWan = {
  "id": "wan21-native",
  "name": "Wan 2.1 · 原生独立部署",
  "kind": "video",
  "runtime": "native",
  "quantization": "BF16 / FP16 加载",
  "description": "直接使用 Diffusers，不依赖 ComfyUI。Windows NVIDIA CUDA；CPU 用于诊断。官方权重约 28.9 GB，推理期间可卸载到内存。",
  "source": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
  "revision": "0fad780a534b6463e45facd96134c9f345acfa5b",
  "assets": [
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/model_index.json",
      "target": "model_index.json",
      "size": 400,
      "sha256": "b8b28e022329acf975e027579a1d2dc3de44dba28f4c909b98a880fbf5b0de7d"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/scheduler/scheduler_config.json",
      "target": "scheduler/scheduler_config.json",
      "size": 751,
      "sha256": "3fed2abbd9bbc301a74db01947198057ec5049808910dccab320925bf27bea6e"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/config.json",
      "target": "text_encoder/config.json",
      "size": 854,
      "sha256": "4087b6192155a4643f6d29fd326c4610103130674011ef4d0a53f8bce5de967d"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model-00001-of-00005.safetensors",
      "target": "text_encoder/model-00001-of-00005.safetensors",
      "size": 4972389712,
      "sha256": "c0ef3a140898e228a3520c9adec60743d2e8e5b3d229651bb37f1a3921919f99"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model-00002-of-00005.safetensors",
      "target": "text_encoder/model-00002-of-00005.safetensors",
      "size": 4899225672,
      "sha256": "481c7b2b39771c44df6dd8d13ee12ed072d731b4a650bd092885d4d52db229ad"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model-00003-of-00005.safetensors",
      "target": "text_encoder/model-00003-of-00005.safetensors",
      "size": 4966309504,
      "sha256": "f93148bcc04052a169e1e49bfcf6125df6cf9bf243cb9c627da75266cf8e35c3"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model-00004-of-00005.safetensors",
      "target": "text_encoder/model-00004-of-00005.safetensors",
      "size": 4999880704,
      "sha256": "a451792c739c05bca4606190cc2dd16731411bac03b4cf6aacc5767321f857c9"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model-00005-of-00005.safetensors",
      "target": "text_encoder/model-00005-of-00005.safetensors",
      "size": 2885866152,
      "sha256": "7e76e18d224531b8197a46231cb53daf7f2f6ca707130252becf933026ac4eea"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/text_encoder/model.safetensors.index.json",
      "target": "text_encoder/model.safetensors.index.json",
      "size": 22476,
      "sha256": "8af791f24a6447aa30c95786f40adf23d3c9df97470d2f36159c8f1113f120b4"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/tokenizer/special_tokens_map.json",
      "target": "tokenizer/special_tokens_map.json",
      "size": 7079,
      "sha256": "456b58fd240a06c743a7c2cf8008bec501240d68ebd1fc4018ea569505fea270"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/tokenizer/spiece.model",
      "target": "tokenizer/spiece.model",
      "size": 4548313,
      "sha256": "e3909a67b780650b35cf529ac782ad2b6b26e6d1f849d3fbb6a872905f452458"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/tokenizer/tokenizer.json",
      "target": "tokenizer/tokenizer.json",
      "size": 16837459,
      "sha256": "20a46ac256746594ed7e1e3ef733b83fbc5a6f0922aa7480eda961743de080ef"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/tokenizer/tokenizer_config.json",
      "target": "tokenizer/tokenizer_config.json",
      "size": 61758,
      "sha256": "1d8d2a216bf8e70ac15b7ddcea566c4dd0433c024b39a58ca5e4c66bd78defbd"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/transformer/config.json",
      "target": "transformer/config.json",
      "size": 465,
      "sha256": "0b093fa072e9ff28763febe9b964ee582f566733a6d6709deb9dfba1bde16b81"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/transformer/diffusion_pytorch_model-00001-of-00002.safetensors",
      "target": "transformer/diffusion_pytorch_model-00001-of-00002.safetensors",
      "size": 4998781576,
      "sha256": "6d011927dbd2cc8afe53d57abab04a8fd86f615d83324770d985fb058ece3a24"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/transformer/diffusion_pytorch_model-00002-of-00002.safetensors",
      "target": "transformer/diffusion_pytorch_model-00002-of-00002.safetensors",
      "size": 677289072,
      "sha256": "b92ec2309b1f239af6f746431815a881afcc938abb26a4f08d9a2fd6c892f872"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/transformer/diffusion_pytorch_model.safetensors.index.json",
      "target": "transformer/diffusion_pytorch_model.safetensors.index.json",
      "size": 73296,
      "sha256": "dcbcf3497134a3f50557ff069dd7d2c84b5c4d8c5932472f6bdb780fb4016589"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/vae/config.json",
      "target": "vae/config.json",
      "size": 724,
      "sha256": "f0c1cc1d7decb5badc384f54691746a27a9aeff49f7ebca974e583389342d527"
    },
    {
      "url": "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/0fad780a534b6463e45facd96134c9f345acfa5b/vae/diffusion_pytorch_model.safetensors",
      "target": "vae/diffusion_pytorch_model.safetensors",
      "size": 507591892,
      "sha256": "d6e524b3fffede1787a74e81b30976dce5400c4439ba64222168e607ed19e793"
    }
  ]
};

