import type { CatalogModelEntry, VendorId } from "@/lib/model-catalog";
import { isMiniMaxHailuoFastModel, isMiniMaxHailuoModel, isMiniMaxTextModel, miniMaxNativeRoute } from "@/lib/minimax-contract";
import { isSeedance25Model } from "@/lib/seedance-2-5";

export type ModelApiParameterRow = {
    name: string;
    type: string;
    required?: boolean;
    description: string;
    example: string;
    ui: string;
    auto?: boolean;
};

export type ModelApiParameterDoc = {
    rows: ModelApiParameterRow[];
    note: string;
    source?: { label: string; url: string };
};

const OPENAI_IMAGES = "https://developers.openai.com/api/docs/guides/image-generation";
const OPENAI_VIDEOS = "https://developers.openai.com/api/reference/resources/videos";
const OPENAI_AUDIO = "https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create";
const OPENAI_CHAT = "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create";
const GEMINI_IMAGE = "https://ai.google.dev/gemini-api/docs/image-generation";
const GEMINI_CONTENT = "https://ai.google.dev/api/generate-content";
const XAI_IMAGE = "https://docs.x.ai/developers/model-capabilities/images/generation";
const XAI_VIDEO = "https://docs.x.ai/developers/model-capabilities/video/generation";
const XAI_CHAT = "https://docs.x.ai/developers/model-capabilities/legacy/chat-completions";
const ARK_IMAGE = "https://www.volcengine.com/docs/82379/1541523";
const ARK_VIDEO = "https://www.volcengine.com/docs/82379/1520757";
const ARK_SEEDANCE_25 = "https://docs.volcengine.com/docs/82379/2607688?lang=zh";
const QWEN_TTS = "https://help.aliyun.com/en/model-studio/cosyvoice-tts-http-api";
const QWEN_VOICE_CLONE = "https://help.aliyun.com/en/model-studio/voice-clone-design-http-api";
const QWEN_ASR = "https://help.aliyun.com/en/model-studio/qwen-asr-api-reference";

const row = (name: string, type: string, description: string, example: string, ui: string, required = false, auto = false): ModelApiParameterRow => ({ name, type, description, example, ui, required, auto });

export function modelApiParameterDoc(vendorId: VendorId, model: CatalogModelEntry): ModelApiParameterDoc {
    const base = [row("model", "string", "模型 ID。", model.name, "由模型选择器写入", true)];

    if (vendorId === "minimax-token-plan" || vendorId === "minimax-api") return miniMaxParameterDoc(vendorId, model, base);

    if (model.name === "gpt-image-2") {
        return {
            source: { label: "OpenAI 图片生成文档", url: OPENAI_IMAGES },
            note: "生成与编辑使用不同端点；编辑时 image 可为多张图片，mask 只用于编辑。",
            rows: [
                ...base,
                row("prompt", "string", "图片描述或编辑指令。", "晨光中的白色郁金香", "多行提示词", true),
                row("image[]", "file[]", "编辑时的输入图片。", "reference.png", "多图上传；无图片时走文生图"),
                row("mask", "file", "透明区域表示需要替换的位置。", "mask.png", "蒙版上传；仅编辑模式显示"),
                row("size", "enum", "输出尺寸：auto、1024x1024、1536x1024、1024x1536。", "1024x1024", "画幅分段选择"),
                row("quality", "enum", "输出质量：auto、low、medium、high。", "high", "质量分段选择"),
                row("background", "enum", "背景：auto、opaque、transparent。", "transparent", "背景选择；透明时提示使用 png/webp"),
                row("n", "integer", "生成数量。", "1", "步进器"),
                row("output_format", "enum", "输出格式：png、jpeg、webp。", "png", "格式选择"),
                row("output_compression", "integer", "jpeg/webp 压缩率，0–100。", "90", "滑杆；按输出格式条件显示"),
                row("input_fidelity", "enum", "编辑时输入保真度：low、high。", "high", "保真度选择；仅编辑模式显示"),
                row("moderation", "enum", "内容审核强度：auto、low。", "auto", "高级设置"),
                row("stream / partial_images", "boolean / integer", "流式返回及预览图数量。", "true / 2", "实时预览开关与数量；仅支持时显示"),
            ],
        };
    }

    if (model.name === "sora-2") {
        return {
            source: { label: "OpenAI 视频 API", url: OPENAI_VIDEOS },
            note: "创建任务后需轮询任务状态，再读取视频内容。参考图可使用文件、公开 URL 或 data URL。",
            rows: [
                ...base,
                row("prompt", "string", "视频内容、动作、镜头与风格描述。", "镜头缓慢推进", "多行提示词", true),
                row("input_reference", "file | object", "可选参考图，最大 20 MB。", "{ image_url }", "单图上传"),
                row("seconds", "enum<string>", "时长：4、8、12 秒。", "8", "三段式时长选择"),
                row("size", "enum", "尺寸：720x1280、1280x720、1024x1792、1792x1024。", "1280x720", "画幅与分辨率合并选择"),
            ],
        };
    }

    if (model.name === "gpt-4o-mini-tts") {
        return {
            source: { label: "OpenAI 语音 API", url: OPENAI_AUDIO },
            note: "input 最长 4096 字符；instructions 可控制语气、节奏与情绪。",
            rows: [
                ...base,
                row("input", "string", "要合成为语音的文本。", "欢迎使用 WorkflowGenerator", "文本输入与字数计数", true),
                row("voice", "enum | object", "内置音色或自定义 voice id。", "alloy", "音色试听选择", true),
                row("instructions", "string", "声音风格、情绪、语速与停顿要求。", "自然、温暖、适合旁白", "多行声音指令"),
                row("response_format", "enum", "mp3、opus、aac、flac、wav、pcm。", "mp3", "格式选择"),
                row("speed", "number", "语速 0.25–4.0。", "1", "滑杆 + 数字输入"),
                row("stream_format", "enum", "audio 或 sse。", "audio", "流式模式；放入高级设置"),
            ],
        };
    }

    if (model.name === "qwen-audio-3.0-tts-flash") {
        return {
            source: { label: "千问语音合成 API", url: QWEN_TTS },
            note: "非流式结果返回 24 小时有效的音频 URL；桌面端会在完成后立即保存到本地媒体库。克隆音色必须与创建时绑定的 target_model 一致。",
            rows: [
                ...base,
                row("input.text", "string", "要合成的文本；支持模型规定的情绪与语言标签。", "欢迎使用音频工作台", "正文输入与字数计数", true),
                row("input.voice", "string", "系统音色、基础音色或克隆得到的 voice_id。", "longanhuan_v3.6", "音色名称 / voice ID", true),
                row("input.format", "enum", "输出格式，工作台首批提供 mp3、wav。", "wav", "格式选择"),
                row("input.sample_rate", "integer", "采样率：8000、16000、22050、24000、44100、48000。", "24000", "采样率选择"),
                row("input.volume", "integer", "音量 0–100，默认 50。", "50", "音量数字输入"),
                row("input.rate", "number", "语速 0.5–2.0，默认 1.0。", "1", "语速数字输入"),
                row("input.pitch", "number", "音调 0.5–2.0，默认 1.0。", "1", "音调数字输入"),
                row("input.language_hints", "enum[]", "目标语言提示；当前只处理第一项。", "[\"zh\"]", "语言选择"),
                row("input.instruction", "string", "自然语言声音指令；仅模型支持时使用。", "温暖、沉稳的纪录片旁白", "声音指令；按模型显示"),
                row("input.enable_ssml", "boolean", "是否把 text 作为 SSML 解析。", "false", "高级设置；仅需要时显示"),
                row("input.seed", "integer", "随机种子 0–65535；相同输入可复现。", "42", "高级设置"),
                row("input.enable_aigc_tag", "boolean", "在支持的音频格式中嵌入 AIGC 标识。", "false", "AIGC 音频标识开关"),
            ],
        };
    }

    if (model.name === "qwen3-tts-vc-2026-01-22") {
        return {
            source: { label: "千问声音克隆 API", url: QWEN_VOICE_CLONE },
            note: "声音克隆会串联两次请求：先调用 customization 创建音色，再调用 multimodal-generation 合成语音。两步的 target_model / model 必须完全一致。",
            rows: [
                row("复刻.model", "string", "声音注册服务模型。", "qwen-voice-enrollment", "由声音克隆任务自动设置", true, true),
                row("复刻.input.action", "enum", "创建声音时固定为 create。", "create", "由工作台自动设置", true, true),
                row("复刻.input.target_model", "string", "克隆音色绑定的语音合成模型。", model.name, "由模型选择器写入", true),
                row("复刻.input.preferred_name", "string", "音色名称前缀；字母、数字、下划线，最多 16 位。", "narrator01", "音色名称输入", true),
                row("复刻.input.audio.data", "data URL | URL", "声音样本；桌面文件会转为 Base64 data URL。", "data:audio/mpeg;base64,...", "音频上传", true),
                row("复刻.input.text", "string", "样本的准确转写，可提高克隆质量。", "今天的天气很好。", "样本文本输入"),
                row("复刻.input.language", "enum", "样本语言，如 zh、en、ja、ko。", "zh", "样本语言选择"),
                row("合成.model", "string", "必须与复刻时的 target_model 相同。", model.name, "点击“用于语音生成”时保持原模型", true, true),
                row("合成.input.text", "string", "要使用克隆音色朗读的内容；Qwen-TTS 最长 512 tokens。", "欢迎使用音频工作台", "正文输入", true),
                row("合成.input.voice", "string", "声音复刻接口返回的 voice。", "narrator01_xxx", "克隆结果自动带入", true),
                row("合成.input.language_type", "enum", "Auto、Chinese、English、German、Italian、Portuguese、Spanish、Japanese、Korean、French、Russian。", "Chinese", "语言选择；由语言代码转换"),
            ],
        };
    }

    if (model.name === "qwen3-asr-flash") {
        return {
            source: { label: "千问语音识别 API", url: QWEN_ASR },
            note: "短音频支持公开 URL 或 Base64 data URL；单文件不超过 5 分钟、10 MB。长音频需改用 qwen3-asr-flash-filetrans 异步任务。",
            rows: [
                ...base,
                row("messages[].content[].type", "enum", "音频内容类型，固定为 input_audio。", "input_audio", "由音频上传自动设置", true, true),
                row("messages[].content[].input_audio.data", "data URL | URL", "要识别的音频。", "data:audio/wav;base64,...", "音频上传", true),
                row("messages[system].content", "string", "可选上下文、实体名或术语提示。", "品牌名：WorkflowGenerator", "专有词提示"),
                row("asr_options.language", "enum", "指定语种；留空时自动识别。", "zh", "识别语言选择"),
                row("asr_options.enable_itn", "boolean", "是否规范化数字、日期等口语表达。", "true", "数字与日期规范化开关"),
                row("stream", "boolean", "原生工作台首批使用非流式完整转录。", "false", "由工作台自动设置", false, true),
            ],
        };
    }

    if (model.name === "gemini-3.1-flash-image-preview") {
        return {
            source: { label: "Gemini 图片生成文档", url: GEMINI_IMAGE },
            note: "图片与文本都放在 contents.parts；模型可同时返回文本和图片。参考图数量与角色一致性上限应按模型版本显示。",
            rows: [
                ...base,
                row("contents[].parts[].text", "string", "图片生成或编辑指令。", "生成一张产品海报", "多行提示词", true),
                row("contents[].parts[].inlineData", "object[]", "参考图片的 MIME 类型与 Base64 数据。", "{ mimeType, data }", "多图上传"),
                row("generationConfig.responseModalities", "enum[]", "返回 TEXT、IMAGE 或两者。", "[\"IMAGE\"]", "输出模态多选"),
                row("generationConfig.imageConfig.aspectRatio", "enum", "1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9。", "16:9", "画幅分段选择"),
                row("generationConfig.imageConfig.imageSize", "enum", "512、1K、2K、4K；可用值随具体模型变化。", "2K", "清晰度选择；按模型过滤"),
                row("generationConfig.imageConfig.outputMimeType", "enum", "图片 MIME 类型。", "image/jpeg", "输出格式选择"),
            ],
        };
    }

    if (model.name === "grok-imagine-image-quality") {
        return {
            source: { label: "xAI 图片生成文档", url: XAI_IMAGE },
            note: "单图编辑默认继承输入图画幅；多图编辑最多三张，并允许覆盖 aspect_ratio。",
            rows: [
                ...base,
                row("prompt", "string", "图片描述或编辑指令。", "山谷日出", "多行提示词", true),
                row("image / images", "object | object[]", "单图或多图编辑输入；支持 URL、data URL、file_id。", "{ type, url }", "最多三张参考图"),
                row("aspect_ratio", "enum", "auto、1:1、16:9、9:16、4:3、3:4、3:2、2:3、2:1、1:2、19.5:9、9:19.5、20:9、9:20。", "16:9", "画幅分段选择"),
                row("resolution", "enum", "1k 或 2k。", "2k", "清晰度选择"),
                row("n", "integer", "同一提示词生成的图片数量。", "4", "1–10 步进器"),
                row("response_format", "enum", "url 或 b64_json。", "b64_json", "由应用自动选择", false, true),
            ],
        };
    }

    if (model.name === "grok-imagine-video" || model.name === "grok-imagine-video-1.5") {
        const is15 = model.name.endsWith("1.5");
        return {
            source: { label: "xAI 视频生成文档", url: XAI_VIDEO },
            note: "文字、首帧、参考图、视频编辑与视频续写是互斥模式。视频编辑会继承输入视频的时长、画幅与分辨率。",
            rows: [
                ...base,
                row("prompt", "string", "生成或编辑指令。", "镜头绕主体缓慢移动", "多行提示词", true),
                row("image", "object", "图生视频的首帧。", "{ url }", "单图上传；与 reference_images 互斥"),
                row("reference_images", "object[]", "参考图引导，不锁定首帧。", "[{ url }]", "最多三张参考图；与 image 互斥"),
                row("video / video_url", "object | string", "视频编辑或续写的输入视频。", "{ url }", "单视频上传；切换到编辑模式"),
                row("duration", "integer", "1–15 秒；视频编辑不可设置。", "10", "1–15 秒滑杆"),
                row("aspect_ratio", "enum", "1:1、16:9、9:16、4:3、3:4、3:2、2:3。", "16:9", "画幅分段选择"),
                row("resolution", "enum", `${is15 ? "480p、720p、1080p；参考图模式最高 720p" : "480p、720p"}。`, is15 ? "1080p" : "720p", "按模型与输入模式动态过滤"),
                ...(is15 ? [row("reference_audios", "object[]", "参考图模式可携带预设 voice_id；自定义音频仅向受信伙伴开放。", "[{ voice_id }]", "音色选择；仅参考图模式显示")] : []),
            ],
        };
    }

    if (model.name.startsWith("doubao-seedream-")) {
        return {
            source: { label: "火山方舟图片生成文档", url: ARK_IMAGE },
            note: "提示词与参考图共同放在 content 中；多图输出通过 sequential_image_generation 控制。具体枚举应随模型版本过滤。",
            rows: [
                ...base,
                row("prompt / content", "string | array", "提示词；编辑时 content 同时包含文本与 image_url。", "[{ type: \"text\" }, { type: \"image_url\" }]", "提示词 + 多图上传", true),
                row("size", "enum | string", "输出分辨率或宽高；支持范围随模型版本变化。", "2K", "清晰度 + 画幅联动"),
                row("sequential_image_generation", "enum", "disabled 或 auto，控制单图/组图。", "auto", "单图/组图模式"),
                row("sequential_image_generation_options.max_images", "integer", "组图最大数量。", "4", "数量步进器；仅组图显示"),
                row("watermark", "boolean", "是否添加模型水印。", "false", "水印开关"),
                row("optimize_prompt_options.mode", "enum", "提示词优化模式；仅支持的模型版本可用。", "standard", "提示词优化开关；按模型显示"),
                row("output_format", "enum", "Seedream 5 系列支持指定输出图片格式。", "png", "输出格式；仅 5 系列显示"),
                row("tools", "array", "Seedream 5 系列可调用 web_search。", "[{ type: \"web_search\" }]", "联网搜索开关；仅 5 系列显示"),
            ],
        };
    }

    if (model.name.startsWith("doubao-seedance-")) {
        const seedance25 = isSeedance25Model(model.name);
        return {
            source: { label: seedance25 ? "Seedance 2.5 官方说明" : "火山方舟视频生成文档", url: seedance25 ? ARK_SEEDANCE_25 : ARK_VIDEO },
            note: seedance25
                ? "单次可生成 4–30 秒视频或使用智能时长。最多参考 30 张图片、10 个视频和 10 个音频，素材总数不超过 50；参考视频与音频各自总时长不超过 30 秒。参考视频需使用公网 URL 或方舟素材 ID，官方接口不接受视频 Base64；含真人人脸的参考素材需使用方舟提供的授权方案。视频编辑固定跟随原片时长，视频延长可指定 4–30 秒或使用智能时长。Seedance 2.5 不支持 draft、frames 与 flex 服务档位。"
                : "文本、图片、视频与音频按 content 顺序编号，提示词中用“图片1 / 视频1 / 音频1”引用；可用素材类型与数量随模型版本变化。",
            rows: [
                ...base,
                row("content", "array", seedance25 ? "文本与图片、视频、音频素材；role 用于区分参考素材或首尾帧。" : "文本与 image_url、video_url、audio_url 参考素材。", "[{ type, text | *_url, role }]", seedance25 ? "提示词 + 多模态素材；编辑/延长至少 1 个视频" : "统一素材编排器", true),
                ...(seedance25 ? [row("content[].role", "enum", "reference_image、reference_video、reference_audio、first_frame 或 last_frame；首帧需要 1 张图，首尾帧需要按顺序提供 2 张图。", "first_frame", "普通参考 / 首帧 / 首尾帧模式")] : []),
                row("ratio", "enum", seedance25 ? "16:9、4:3、1:1、3:4、9:16、21:9 或 adaptive；编辑、延长和首尾帧任务只能使用 adaptive。" : "画面比例；可包含 adaptive / 自适应。", seedance25 ? "adaptive" : "16:9", seedance25 ? "生成时可选；编辑/延长跟随原片" : "画幅分段选择"),
                row(
                    "duration",
                    "integer | enum",
                    seedance25 ? "4–30 秒或 -1（智能时长）；编辑任务必须传 -1，并要求待编辑视频时长为 4–30 秒。" : "视频时长；Seedance 2.0 可由模型智能决定。",
                    seedance25 ? "30" : "10",
                    seedance25 ? "4–30 秒 + 智能；编辑时跟随原片" : "时长选择 + 智能时长",
                ),
                row("resolution", "enum", seedance25 ? "480p 或 720p；不支持 1080p 和 4K。" : "输出清晰度。", "720p", "清晰度选择"),
                ...(seedance25 ? [row("output_format", "enum", "mp4（通用播放）或 mov（高色彩精度，适合编辑和延长）。", "mp4", "MP4 / MOV 选择")] : []),
                row("generate_audio", "boolean", "是否生成原生声音。", "true", "声音开关"),
                row("watermark", "boolean", "是否添加模型水印。", "false", "水印开关"),
                ...(seedance25
                    ? [
                          row("seed", "integer", "随机种子，范围 -1 到 4294967295；-1 表示每次随机。", "-1", "随机种子输入"),
                          row("return_last_frame", "boolean", "任务成功后在 content.last_frame_url 返回无水印 PNG 尾帧。", "true", "保存尾帧开关；生成结果可继续作为首帧"),
                          row("tools[].type", "enum", "纯文字生成可传 web_search，让模型检索信息后创作。", "web_search", "联网检索开关；有参考素材时禁用"),
                          row("camera_fixed", "boolean", "固定摄像机位置；当前工作台仅在纯文字生成时发送。", "false", "固定机位开关；有参考素材时禁用"),
                          row("callback_url", "string", "任务状态变化时接收服务端回调的 HTTPS 地址。", "https://example.com/video/callback", "开发者路由配置"),
                          row("execution_expires_after", "integer", "任务执行有效期，范围 3600–259200 秒；默认 172800 秒。", "172800", "开发者路由配置"),
                          row("safety_identifier", "string", "用于标识最终用户并辅助安全风控；不要直接发送敏感个人信息。", "user_8f31c", "开发者路由配置"),
                          row("service_tier", "enum", "仅支持 default；Seedance 2.5 不支持 flex。", "default", "固定为默认服务档位"),
                      ]
                    : []),
            ],
        };
    }

    if (model.name === "agnes-image-2.1-flash") {
        return {
            note: "按当前 Agnes 接入实现整理；未发现稳定的公开参数参考页，新增控件前应以账户控制台中的最新接口说明复核。",
            rows: [
                ...base,
                row("prompt", "string", "图片生成或编辑指令。", "产品棚拍图", "多行提示词", true),
                row("image", "string[]", "参考图 data URL 数组。", "[\"data:image/...\"]", "多图上传"),
                row("size", "string", "输出宽高。", "1024x1024", "画幅/尺寸选择"),
                row("quality", "string", "质量或分辨率档位。", "high", "质量选择"),
                row("n", "integer", "生成数量。", "1", "数量步进器"),
                row("background", "string", "背景模式；仅接口接受时传递。", "transparent", "高级设置"),
            ],
        };
    }

    if (model.name === "agnes-video-v2.0") {
        return {
            note: "按当前 Agnes 接入实现整理；num_frames 必须满足 8 × n + 1，工作台应让用户选时长并自动换算帧数。",
            rows: [
                ...base,
                row("prompt", "string", "视频内容与运动描述。", "人物回头看向镜头", "多行提示词", true),
                row("image", "string", "可选首帧图片 data URL。", "data:image/png;base64,...", "单图上传"),
                row("width / height", "integer", "输出宽高。", "1280 / 720", "画幅选择后自动换算"),
                row("num_frames", "integer", "总帧数，必须为 8 × n + 1。", "145", "由时长自动计算", false, true),
                row("frame_rate", "integer", "帧率；当前接入固定 24。", "24", "只读展示", false, true),
            ],
        };
    }

    if (model.capability === "text") return textParameterDoc(vendorId, model, base);

    return {
        note: "这是 OpenAI 兼容回退契约；第三方模型可能拒绝未声明字段，原生面板应只展示已验证参数。",
        rows: [
            ...base,
            row("prompt", "string", "生成提示词。", "请生成内容", "多行提示词", true),
            row("size", "string", "输出尺寸。", "1024x1024", "尺寸或画幅选择"),
            row("n", "integer", "生成数量。", "1", "数量步进器"),
        ],
    };
}

function miniMaxParameterDoc(vendorId: "minimax-token-plan" | "minimax-api", model: CatalogModelEntry, base: ModelApiParameterRow[]): ModelApiParameterDoc {
    const isTokenPlan = vendorId === "minimax-token-plan";
    const credentialNote = "可在渠道设置中选择 Token Plan（sk-cp）或 API 计费（sk-api）接入；两类 Key 不能混用，应用不会在渠道间自动切换。";

    if (isMiniMaxTextModel(model.name)) {
        const route = miniMaxNativeRoute("text");
        return {
            source: { label: route.label, url: route.docsUrl },
            note: `${model.label} 使用 MiniMax 原生 Messages 接口；当前会话已接入文本和图片。${credentialNote}`,
            rows: [
                ...base,
                row("messages", "object[]", "对话历史；厂商协议还支持视频、工具调用与工具结果内容块。", "[{ role, content }]", "当前会话：对话正文与图片附件", true),
                row("messages[].content[].source", "object", "图片或视频来源，可使用公开 URL 或受支持的 Base64 数据。", "{ type: \"url\", url }", "当前会话已接入图片；视频暂未开放"),
                row("system", "string | object[]", "设置回复角色、语气与任务边界。", "你是一名创作助手", "系统提示词"),
                row("max_tokens", "integer", "最大输出长度；M3 推荐 131072，上限 524288。", "8192", "当前会话固定为 8192", true, true),
                row("temperature", "number", "输出随机性，范围 0–2。", "1", "接口支持；当前会话暂未开放"),
                row("top_p", "number", "核采样范围 0–1，M3 默认 0.95。", "0.95", "接口支持；当前会话暂未开放"),
                row("tools", "object[]", "可供模型调用的工具定义。", "[{ name, description, input_schema }]", "接口支持；当前会话暂未开放"),
                row("tool_choice", "object", "工具选择策略，仅使用 auto 或 none。", "{ type: \"auto\" }", "接口支持；当前会话暂未开放"),
                row("thinking", "object", "控制 M3 是否使用自适应思考。", "{ type: \"adaptive\" }", "接口支持；当前会话暂未开放"),
                row("service_tier", "enum", isTokenPlan ? "服务档位；可用范围以 Token Plan 权益为准。" : "standard 为标准服务；priority 为 API 计费的优先服务。", "standard", "接口支持；当前会话暂未开放"),
                row("stream", "boolean", "是否边生成边显示。", "false", "当前会话固定为非流式", false, true),
            ],
        };
    }

    if (model.name === "image-01") {
        const route = miniMaxNativeRoute("image");
        return {
            source: { label: route.label, url: route.docsUrl },
            note: `文生图与角色参考编辑使用同一接口。桌面端使用 URL 并立即保存结果，网页预览使用 Base64。${credentialNote}`,
            rows: [
                ...base,
                row("prompt", "string", "图片描述或编辑指令，最长 1500 字符。", "电影感的雨夜街道", "多行提示词与字数提示", true),
                row("subject_reference", "object[]", "人物主体参考；每项使用 character 类型与 image_file。", "[{ type: \"character\", image_file }]", "角色参考图"),
                row("aspect_ratio", "enum", "1:1、16:9、4:3、3:2、2:3、3:4、9:16、21:9。", "16:9", "画幅选择"),
                row("width / height", "integer", "自定义宽高均为 512–2048 且为 8 的倍数；与画幅同时填写时以画幅为准。", "1280 / 720", "接口支持；当前工作台暂未开放"),
                row("response_format", "enum", "url 或 base64。", "url", "桌面端使用 url；网页预览使用 base64", false, true),
                row("seed", "integer", "随机种子，可用于生成相近结果。", "42", "接口支持；当前工作台暂未开放"),
                row("n", "integer", "单次生成 1–9 张图片。", "4", "数量步进器"),
                row("prompt_optimizer", "boolean", "是否自动优化提示词。", "true", "提示词优化开关"),
                row("aigc_watermark", "boolean", "是否在生成图片中加入 AIGC 标识。", "false", "添加水印开关"),
            ],
        };
    }

    if (model.name === "MiniMax-H3") {
        const route = miniMaxNativeRoute("video-h3");
        return {
            source: { label: route.label, url: route.docsUrl },
            note: `H3 必须包含文字提示；首帧、尾帧、首尾帧与多模态参考按所选模式使用。图片仅支持 JPEG、PNG、WebP，单张不超过 30 MB；单个视频不超过 50 MB，单个音频不超过 15 MB。图片最多 9 张，视频与音频各最多 3 个，请求总体不超过 64 MB。${credentialNote}`,
            rows: [
                ...base,
                row("content", "object[]", "文字与图片、视频、音频素材；每次请求必须包含非空 text。", "[{ type: \"text\", text }]", "提示词与统一参考素材区", true),
                row("content[].role", "enum", "素材用途：first_frame、last_frame、reference_image、reference_video、reference_audio。", "reference_image", "首帧 / 首尾帧 / 参考素材模式"),
                row("resolution", "enum", "输出分辨率：768P 或 2K。", "2K", "清晰度选择", true),
                row("duration", "integer", "视频时长 4–15 秒，使用整数。", "8", "时长滑杆", true),
                row("ratio", "enum", "adaptive、21:9、16:9、4:3、1:1、3:4、9:16；纯文本不能使用 adaptive，首帧、尾帧与首尾帧模式固定为 adaptive。", "16:9", "按当前素材模式显示可用画幅"),
                row("aigc_watermark", "boolean", "是否在生成视频中加入 AIGC 标识。", "false", "添加水印开关"),
            ],
        };
    }

    if (isMiniMaxHailuoModel(model.name)) {
        const route = miniMaxNativeRoute("video-hailuo");
        const fast = isMiniMaxHailuoFastModel(model.name);
        return {
            source: { label: route.label, url: route.docsUrl },
            note: `${fast ? "Hailuo 2.3 Fast 仅支持单首帧图生视频。" : "Hailuo 2.3 支持文生视频与单首帧图生视频。"}首帧仅接受 JPEG、PNG、WebP，需小于 20 MB、短边大于 300px，宽高比在 2:5 到 5:2 之间；不支持尾帧、首尾帧、参考视频或参考音频。${isTokenPlan ? "Token Plan 各级套餐的实际权限和额度以 MiniMax 接口返回为准。" : "当前页面使用 API 计费厂商中的 Hailuo 兼容视频接口。"}`,
            rows: [
                ...base,
                row("prompt", "string", fast ? "可选的运动与镜头描述，最长 2000 字符。" : "视频描述，最长 2000 字符；没有首帧时必填。", "镜头缓慢推进，人物转头看向窗外", "多行提示词与字数提示", !fast),
                row("first_frame_image", "string", fast ? "首帧图片；Fast 模型必须提供且只接受一张。" : "可选首帧；提供后从图片生成视频。", "data:image/jpeg;base64,...", "单张首帧上传", fast),
                row("duration", "enum", "视频时长：6 或 10 秒；1080P 只支持 6 秒。", "6", "时长选择，并与清晰度联动", true),
                row("resolution", "enum", "输出清晰度：768P 或 1080P；10 秒时固定为 768P。", "768P", "清晰度选择，并与时长联动", true),
                row("prompt_optimizer", "boolean", "是否自动优化提示词，默认开启。", "true", "提示词优化开关"),
                row("fast_pretreatment", "boolean", "缩短提示词优化耗时；仅在提示词优化开启时生效。", "false", "快速预处理开关"),
                row("aigc_watermark", "boolean", "是否在生成视频中加入 AIGC 标识。", "false", "添加水印开关"),
                row("callback_url", "string", "可选任务状态回调地址；当前工作台使用轮询。", "https://example.com/minimax-callback", "接口支持；当前工作台暂未开放"),
            ],
        };
    }

    if (!model.name.startsWith("speech-2.8-")) {
        return { rows: base, note: `当前模型没有可显示的专属参数。${credentialNote}` };
    }

    const route = miniMaxNativeRoute("speech");
    const speechRows = [
        row("语音.text", "string", "要合成的文字，少于 10000 字符。", "欢迎使用音频工作台", "正文输入与字数提示", true),
        row("语音.stream", "boolean", "是否流式返回；当前工作台使用完整音频结果。", "false", "由工作台自动设置", false, true),
        row("语音.voice_setting.voice_id", "string", "系统音色或已有的自定义音色 ID。", "male-qn-qingse", "音色 ID", true),
        row("语音.voice_setting.speed / vol / pitch", "number", "语速、音量与音调。", "1 / 1 / 0", "语速、音量、音调控制"),
        row("语音.voice_setting.emotion", "enum", "模型支持的情绪表达。", "happy", "情绪选择"),
        row("语音.audio_setting", "object", "采样率、码率、mp3 / wav / flac 格式与声道。", "{ sample_rate: 32000, bitrate: 128000, format: \"mp3\", channel: 1 }", "音频格式与质量"),
        row("语音.language_boost", "enum", "指定语言、方言或 auto 自动判断。", "Chinese", "语言选择"),
        row("语音.pronunciation_dict", "object", "为多音字、专名或外语词指定读音。", "{ tone: [\"处理/(chu3)(li3)\"] }", "接口支持；当前工作台暂未开放"),
        row("语音.voice_modify", "object", "对输出声音应用音高、强度或混响等效果。", "{ pitch: 0 }", "接口支持；当前工作台暂未开放"),
        row("语音.subtitle_enable / subtitle_type", "boolean / enum", "开启字幕并选择 sentence、word 或 word_streaming 粒度。", "true / sentence", "接口支持；当前工作台暂未开放"),
        row("语音.output_format", "enum", "非流式结果使用 url 或 hex；URL 有效 24 小时。", "url", "由工作台自动设置", false, true),
        row("语音.aigc_watermark", "boolean", "是否在生成音频中加入 AIGC 标识。", "false", "AIGC 音频标识开关"),
    ];
    const cloneRows = [
        row("复刻上传.file", "file", "声音样本，支持 MP3、M4A、WAV。", "voice-sample.wav", "声音样本上传", true),
        row("复刻上传.purpose", "enum", "上传声音样本时固定为 voice_clone。", "voice_clone", "由工作台自动设置", true, true),
        row("复刻.file_id", "int64", "上传成功后返回的文件 ID；按完整十进制整数传递。", "9223372036854770000", "上传完成后自动带入", true, true),
        row("复刻.voice_id", "string", "8–256 位，以英文字母开头，只含字母、数字、-、_，且末位不能是 - 或 _。", "MiniMax001", "自定义音色 ID", true),
        row("复刻.clone_prompt", "object", "可选增强样本；同时提供少于 8 秒的 prompt_audio 文件 ID 与对应 prompt_text，可提高相似度和稳定性。", "{ prompt_audio: 987654321, prompt_text: \"样本文本\" }", "接口支持；当前工作台暂未开放"),
        row("复刻.text / model", "string", "可选试听文字；填写后同时选择试听用的 Speech 2.8 模型。", "这是一段试听。 / speech-2.8-hd", "试听文字与模型"),
        row("复刻.language_boost", "enum", "增强指定语言或方言的识别；不确定时可使用 auto。", "Chinese", "接口支持；当前工作台暂未开放"),
        row("复刻.text_validation", "string", "样本的预期转写，最长 200 字符；接口会用语音识别结果核对相似度。", "这是一段清晰的样本语音。", "接口支持；当前工作台暂未开放"),
        row("复刻.accuracy", "number", "配合 text_validation 使用的相似度阈值，范围 0–1，默认 0.7。", "0.7", "接口支持；当前工作台暂未开放"),
        row("复刻.need_noise_reduction", "boolean", "是否降低样本中的环境噪声。", "true", "当前工作台自动开启", false, true),
        row("复刻.need_volume_normalization", "boolean", "是否自动统一样本音量。", "true", "当前工作台自动开启", false, true),
        row("复刻.aigc_watermark", "boolean", "是否为试听结果添加 AIGC 标识。", "false", "接口支持；当前工作台待接入"),
    ];
    return {
        source: { label: route.label, url: route.docsUrl },
        note: `Speech 2.8 在此厂商中提供语音生成与快速声音复刻。复刻样本需为 MP3、M4A 或 WAV，时长 10 秒至 5 分钟且不超过 20 MB；新音色应在 7 天内用于一次正式语音生成。${credentialNote}`,
        rows: [...base, ...speechRows, ...cloneRows],
    };
}

function textParameterDoc(vendorId: VendorId, model: CatalogModelEntry, base: ModelApiParameterRow[]): ModelApiParameterDoc {
    if (vendorId === "google") {
        return {
            source: { label: "Gemini generateContent API", url: GEMINI_CONTENT },
            note: "多模态输入按 parts 排列；结构化输出、工具与思考配置适合按需展开，避免默认面板过载。",
            rows: [
                ...base,
                row("contents", "array", "多轮文本、图片、音频或视频内容。", "[{ role, parts }]", "对话输入与附件", true),
                row("systemInstruction", "object", "系统指令。", "{ parts: [{ text }] }", "系统提示词"),
                row("generationConfig.temperature / topP", "number", "采样随机性。", "0.7 / 0.95", "高级采样设置"),
                row("generationConfig.maxOutputTokens", "integer", "最大输出 token 数。", "8192", "数字输入"),
                row("generationConfig.responseMimeType / responseSchema", "string / object", "JSON 等结构化输出约束。", "application/json", "输出格式 + Schema 编辑器"),
                row("tools / toolConfig", "array / object", "函数、搜索、代码执行等工具。", "[{ functionDeclarations }]", "工具多选与参数表单"),
                row("generationConfig.thinkingConfig", "object", "思考预算或级别；可用字段随模型变化。", "{ thinkingBudget }", "推理设置；按模型显示"),
            ],
        };
    }

    const source = vendorId === "xai"
        ? { label: "xAI Chat Completions", url: XAI_CHAT }
        : vendorId === "openai"
          ? { label: "OpenAI Chat Completions API", url: OPENAI_CHAT }
          : undefined;
    return {
        source,
        note: vendorId === "agnes" || vendorId === "ark"
            ? "当前文本链路使用 OpenAI Chat Completions 兼容格式；第三方模型的可选字段应由渠道脚本做最终裁剪。"
            : "图片输入放在 messages[].content 中；工具调用、结构化输出与推理参数适合在高级设置中按模型能力显示。",
        rows: [
            ...base,
            row("messages", "array", "系统、用户与助手消息；内容可包含文本和图片。", "[{ role, content }]", "对话输入与附件", true),
            row("reasoning_effort", "enum", "推理强度；可用值随模型变化。", "high", "推理强度选择；按模型过滤"),
            row("temperature / top_p", "number", "采样随机性；通常只调整其中一项。", "0.7 / 0.95", "高级采样设置"),
            row("max_completion_tokens", "integer", "最大生成 token 数。", "4096", "数字输入"),
            row("tools / tool_choice", "array / enum", "函数工具定义与选择策略。", "auto", "工具多选与调用策略"),
            row("response_format", "object", "文本或 JSON Schema 结构化输出。", "{ type: \"json_schema\" }", "输出格式 + Schema 编辑器"),
            row("stream", "boolean", "是否流式返回。", "true", "由工作台自动启用", false, true),
        ],
    };
}
