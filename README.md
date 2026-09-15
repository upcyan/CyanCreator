# CyanCreator 0.2.0

面向短片制作的本地 AIGC 工作台：创作简报 → 共享故事设定 → 大纲 → 剧本与分镜 → 单镜头视频 → 基础剪辑 → MP4。

采用 Node.js 本地服务与浏览器界面，支持本地模型下载部署及云端接入。源码仓库不捆绑权重；模型中心按需下载。当前提供短片基础剪辑，后续可以封装桌面壳。

## 启动

需要 Node.js 22 或更新版本。

```powershell
npm.cmd install
npm.cmd start
```

打开 http://127.0.0.1:3210 。项目存于 `data/workspace.json`，素材存于 `data/media/`。备份时停止工作台后复制整个 `data/`。单个数据目录只运行一个服务实例。

已安装 FFmpeg / FFprobe 二进制依赖；可用 `FFMPEG_PATH`、`FFPROBE_PATH` 指定自有版本。服务仅监听本机，不直接开放到局域网。`PORT` 修改端口，`CYANCREATOR_DATA` 修改项目目录。

## 已实现

- 新建项目、保存创作设定、结构化大纲与剧本、最近 50 次稿件版本记录。
- 大纲 / 剧本 / 审校独立模型路由，共享人物与世界观；OpenAI 兼容 Chat Completions 服务，支持本地及 HTTPS 云服务。
- 真实服务请求、JSON 校验、截断检测、参数配置、可见错误；审校仅给出建议。
- 改动上游后标记下游过期。生成期间编辑项目时，生成结果保留但不自动覆盖；可查看后应用。
- 通用 ComfyUI 视频适配：API 图、节点参数绑定、提交、轮询、下载、素材入库；内置 Wan 2.1 1.3B 与 MiniMax H3 方案，也可导入其他模型的 API 工作流。
- H3 按镜头时长对齐 `17k+5` 帧网格；推理记录保存实际配置、帧数、seed、步骤数、模型权重名称、耗时及远端 ID。
- 权重加载参数可切换量化 checkpoint；所有对外宣称生效的自定义参数必须绑定实际节点输入。支持完整工作流导入与配置导出。
- 本地部署探测：ComfyUI 版本、设备、缺失节点和权重检查。探测通过不等于显存足够或视频已生成。
- MiniMax 云端 V1 Hailuo 适配（768P、6/10 秒），不把 H3 套入 V1 API。H3 云端 V2 尚未实现。
- MP4 / WebM 素材导入、预览、裁剪入点出点、片段排序、独立音量、720p/24fps MP4 导出，原声保留，无音轨补静音。
- 串行任务、参数快照、耗时、取消本地等待、错误记录、重启中断标识。重启不自动重复提交远端任务，防止重复计费。

## 大纲与剧本的模型设计

模型中心使用**共享模型配置 + 阶段引用**：服务地址、模型名称、密钥环境变量和默认生成参数只填写一次。故事大纲、剧本与分镜、一致性审校通过下拉框选择该配置。

可以新增或复制多套本地/云端配置，并用“三个阶段共用”快速分配。默认大纲和剧本继承共享参数；审校默认单独使用较低温度。打开“独立调整生成参数”可覆盖温度和输出长度，服务与模型仍共享。被引用的配置不能删除，先调整阶段引用即可。

旧版三份配置会自动合并相同的服务/模型/密钥引用，保留各阶段原有参数差异；已有任务继续使用提交时的参数快照。`CYANCREATOR_DATA` 指定数据目录，同时兼容旧环境变量 `LOCALCREATOR_DATA`。目录改名后，托管素材路径会在启动时重新定位。

写作采用**一个本地指令模型、三个独立角色**，不为每个阶段训练模型。

1. **故事架构师**：输入创作简报与故事设定，输出 logline 和因果节拍。温度初值 0.7；先衡量结构完整性、动机与结尾回收。
2. **编剧 / 分镜导演**：读取同一设定及已确认大纲，输出场景、动作、对白和 4–15 秒镜头提示词。人物外观、场景、运镜与声音应写入每个独立镜头。
3. **审校**：温度初值 0.2，检查动机、角色口吻、时间线及镜头可执行性，返回问题与修改建议，不直接覆写稿件。

本地模型库提供 Qwen3 8B Q4_K_M 作为写作候选，以及 Qwen2.5 0.5B Q4_K_M 用于轻量连通测试。模型名称使用运行时实际暴露的 ID；不同量化文件、上下文长度和 KV cache 都会影响显存，不能只按参数量估算。小模型连通成功不代表长篇写作质量达标。

首版针对短片，发送完整创作上下文。长篇下一步扩展：Story Bible 拆成角色/关系/世界规则，章节摘要与检索，按场景增量重写和版本依赖图，生成后做结构规则校验再进行模型审校。当前没有实现章节检索或多代理并发。

需要更强推理时，可以只把大纲或审校路由到云端。用户主动选择云服务后，相关创作简报、故事设定和已有稿件会发送给该服务。密钥使用环境变量，例如 `TEXT_API_KEY`，UI 只保存变量名称，不保存密钥值。

## 两台机器的部署方案

### 一键下载与部署

模型中心 → 本地模型库 → **下载并部署**。下载清单固定官方仓库版本、文件大小与 SHA-256，支持 HTTPS 官方分发重定向、磁盘空间检查、`.part` 续传、取消和重试。校验不符的已有正式文件不会被覆盖；损坏临时文件会移除后提示重试。

- **文本**：下载 GGUF 到 `data/models/text/`，自动安装已固定版本的 Windows x64 llama.cpp Vulkan 到 `data/runtimes/`，启动本机服务并检查 `/v1/models`。完成后新增共享配置，可用“三个阶段共用”分配；不会覆盖已有写作路由。
- **视频**：Wan 2.1 1.3B 约 9.83 GB，H3 约 42.47 GB。下载到部署设置中的 ComfyUI 模型目录，检查所需节点与权重。点击“载入视频方案”并保存即可切换。新工作空间默认使用 Wan，现有配置保留。
- **运行时前提**：文本自动安装当前支持 Windows x64；Vulkan 依赖显卡驱动，GPU 层数设为 0 可用 CPU。视频需要预装 ComfyUI；自动发现本机 ComfyUI Desktop，也可填写根目录、Python 和模型目录。可启动已安装的 ComfyUI，尚不自动安装其 Python / PyTorch 环境。
- **状态**：下载与部署串行执行，记录进度和错误；重启后标记中断，重试会校验并续传。部署完成代表服务/权重检查通过，不代表视频推理已完成。工作台启动的服务可以停止并释放显存；外部启动的服务由原运行时管理。
- **诊断**：日志在 `data/runtime-logs/`。重复“检查并启动”会验证已有文件并复用正确的已运行模型服务。关闭工作台会停止本次由其启动的运行时。

目录扩展入口为 `lib/model-catalog.js`（固定下载清单）、`lib/video-presets.js`（模型工作流与帧数策略）和 `lib/local-runtime.js`（推理进程）。ComfyUI 适配器按工作流执行，不依赖 MiniMax 模型名称；新增其他协议的云服务需要对应适配器。

### RTX 5070 12GB / 48GB RAM

作为第一个验证目标。2026-09-14 实际发现本机 `127.0.0.1:8188` 已运行 ComfyUI 0.31.0，PyTorch 2.12.1+cu130，识别到 RTX 5070，H3 原生节点存在，但 diffusion_models、text_encoders 和 vae 列表为空；常见的 1234 / 11434 文本推理端口未响应。

在模型中心点击“载入视频方案”（MiniMax H3）→ 保存 → 检查本地部署。内置方案基于官方 ComfyUI 原生图，包含视频与音频解码，使用：

- `minimax_h3_fl2va_pruned_int8_convrot.safetensors`
- `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `minimax_h3_video_vae_fp16.safetensors`
- `minimax_h3_audio_vae_fp32.safetensors`

可通过模型库下载，或按照官方部署文档手动放入对应目录。开发验证未下载上述大体积视频权重，没有将其实际生成能力作为已验证结果。

基线为 864×480、约 5 秒、20 steps、固定 seed，先验证完整链路再升画质。INT8 / NVFP4 由上述实际权重承担；界面不执行权重量化转换。注意文本编码器本身也很大，显存不足时需在实际推理运行时启用支持的卸载策略，并检查系统内存峰值。

工作台串行提交自己的任务，但不会自动卸载其它软件占用的模型，也不会中断 ComfyUI 中其它用户的任务。运行视频前，在文本运行时中卸载文字模型。参数优化以真实耗时、显存、画面连续性、角色一致性和音画同步为准；当前只自动记录耗时和配置。

### RX 9060 XT 16GB / 32GB RAM

同一工作台可以部署到第二台机器并连接其本机推理服务；不把 NVIDIA 的 CUDA / NVFP4 加速设置照搬到 AMD。尚未连接该机器，操作系统、驱动、推理框架与 H3 量化节点兼容性均待验证，不能保证已有 NVIDIA 基线可直接运行。

若集中连接两台机器，服务层可通过受控 HTTPS 入口接入另一台服务。当前任务队列为单工作台串行队列，未实现多机器资源调度。

## 参数与工作流

ComfyUI 须导出 **API 格式**，不是含 `nodes` 的界面 JSON。参数绑定支持一个输入或多个输入，例如：

```json
{
  "prompt": {"node": "5", "input": "prompt"},
  "steps": {"node": "9", "input": "steps"},
  "frames": {"node": "5", "input": "length"}
}
```

所有 `params` 字段都必须存在对应绑定；不能用一个无实际节点对应的“int4”开关冒充量化。调 CFG、LoRA、量化模式或卸载参数时，先确认导入工作流包含相应节点。内置 H3 基线使用 BasicGuider，不提供不生效的 CFG 滑杆。自定义图可关闭 H3 时长换算，使用图自身的固定帧数。

云端 V1 仅接受其 API 支持的参数，不传递本地 steps / 量化设置。云 API key 通过 `MINIMAX_API_KEY` 读取，服务地址使用 `https://api.minimax.io/v1`。设置环境变量后重启工作台。

## 验证与边界

```powershell
npm.cmd run check
npm.cmd test
```

测试覆盖实际本地 HTTP API、模拟文本/ComfyUI 服务、结构化输出、共享配置迁移与阶段引用、真实参数绑定、稿件冲突、过期状态、任务取消和失败、权限令牌、媒体 Range 请求、真实 FFmpeg 裁剪拼接及声音轨道；同时覆盖模型下载续传、校验失败、取消、已有文件保护、部署配置快照、重复排队和模型方案切换。

2026-09-15 共 14 项测试通过；真实 FFmpeg 输出 1280×720，约 1.77 秒，含音轨。模型协议与部署状态回归测试使用明确的 fixture。

本地视频检查使用“启动并检查本地部署”，可启动部署设置中的已安装 ComfyUI。Desktop 自动发现选择 `ComfyUI/.venv/Scripts/python.exe` 推理环境，不选择缺少 PyTorch 的 `standalone-env` 引导环境。连接失败会显示目标地址和原因。已实测启动 ComfyUI 0.35.1 并识别 RTX 5070，浏览器正常显示尚缺少的 Wan 三个权重文件。

另已完成真实 Qwen2.5 0.5B Q4_K_M 的 491.4 MB 下载、取消、重启续传、SHA-256 校验、llama.cpp 自动安装和服务启动，并通过本机 Chat Completions 返回中文文本。浏览器实测通过模型库显示、下载进度、Wan 方案切换并保存、三个阶段共用配置、连接测试。该轻量模型用于连通验证，不作为写作质量基线，也不代表 AMD 或视频 GPU 推理已验证。

尚未验证：Qwen3 8B 写作质量、Wan / H3 视频生成与 AMD 硬件兼容性。尚未实现：权重量化转换或训练、自动性能搜索、显存峰值采集、多轨剪辑、字幕/转场、桌面安装包、H3 V2 云接入。模型文件下载支持续传；远端推理不能断点续传，取消只停止本地等待，远端任务 ID 保留以便人工检查。

## 来源

- [MiniMax H3 官方仓库](https://github.com/MiniMax-AI/MiniMax-H3)
- [ComfyUI H3 原生部署与权重](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)
- [官方 ComfyUI H3 T2V 模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_t2v.json)
- [ComfyUI 服务协议](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [Qwen3.5-9B 官方模型卡](https://huggingface.co/Qwen/Qwen3.5-9B)
- [MiniMax V1 视频接口](https://platform.minimax.io/docs/api-reference/video-generation-t2v)
- [Wan 官方 ComfyUI 教程](https://docs.comfy.org/tutorials/video/wan/wan-video)
- [Qwen3 8B 官方 GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF)
- [Qwen2.5 0.5B 官方 GGUF](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF)
- [llama.cpp b10964 固定运行时](https://github.com/ggml-org/llama.cpp/releases/tag/b10964)

模型发布与硬件支持会变化，部署时以选用权重的模型卡、许可证及运行时说明为准。
