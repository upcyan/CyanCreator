"""One isolated worker per generation; no ComfyUI imports or services."""
import json
import sys
import time


def emit(kind, **data):
    print(json.dumps(dict(type=kind, **data), ensure_ascii=False), flush=True)


def main(request):
    import torch
    import diffusers
    from diffusers import AutoencoderKLWan, WanPipeline
    from diffusers.utils import export_to_video

    device = request.get('device', 'cuda')
    if device not in ('cuda', 'cpu'):
        raise ValueError('Unsupported device')
    if device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('未检测到可用 CUDA 显卡。请检查 NVIDIA 驱动，或选择 CPU 诊断环境；当前未适配 AMD 加速。')
    if request['mode'] == 'check':
        emit('result', ready=True, torch=torch.__version__, diffusers=diffusers.__version__, device=torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU')
        return
    p = request['params']
    dtype = getattr(torch, p['dtype']) if device == 'cuda' else torch.float32
    emit('progress', phase='loading', message='加载本地 Wan 权重')
    vae = AutoencoderKLWan.from_pretrained(request['modelDir'], subfolder='vae', torch_dtype=torch.float32, local_files_only=True)
    pipe = WanPipeline.from_pretrained(request['modelDir'], vae=vae, torch_dtype=dtype, local_files_only=True)
    if p['vaeTiling']:
        pipe.vae.enable_tiling()
    if device == 'cpu':
        pipe.to('cpu')
    elif p['offload'] == 'sequential':
        pipe.enable_sequential_cpu_offload()
    elif p['offload'] == 'model':
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(device)
    started = time.monotonic()

    def progress(pipeline, step, timestep, kwargs):
        emit('progress', phase='sampling', step=step + 1, total=p['steps'], elapsed=round(time.monotonic() - started, 1))
        return kwargs

    frames = pipe(prompt=request['prompt'], negative_prompt=p['negative'], height=p['height'], width=p['width'], num_frames=p['frames'], num_inference_steps=p['steps'], guidance_scale=p['cfg'], generator=torch.Generator(device='cpu').manual_seed(p['seed']), callback_on_step_end=progress).frames[0]
    emit('progress', phase='encoding', message='编码 MP4')
    export_to_video(frames, request['output'], fps=16)
    emit('result', output=request['output'])


if __name__ == '__main__':
    try:
        main(json.load(sys.stdin))
    except Exception as error:
        emit('error', message=str(error))
        sys.exit(1)
