import type { AiConfig, ModelCapability } from "@/stores/use-config-store";
import { audioFormatOptions, audioVoiceOptions } from "@/lib/audio-generation";

/**
 * 参数 schema：描述“这个模型的面板显示哪些控件、选项是什么”。
 *
 * 面板从 schema 渲染控件，不再为每个模型硬编码 JSX。新增模型时，
 * 只需要在模型目录里声明一段 schema（或引用通用 schema），界面自动出现。
 */
export type ParamOption = {
    value: string;
    label: string;
    hint?: string;
};

export type ParamControl =
    | { type: "options"; key: keyof AiConfig; label: string; options: ParamOption[]; columns?: 2 | 3 | 4 | 5 }
    | { type: "switch"; key: keyof AiConfig; label: string; hint?: string; onValue?: string; offValue?: string }
    | { type: "number"; key: keyof AiConfig; label: string; min?: number; max?: number; step?: number; suffix?: string; normalize?: (value: string) => string }
    | { type: "textarea"; key: keyof AiConfig; label: string; placeholder?: string }
    | { type: "dimension"; key: keyof AiConfig; label: string; step?: number; options?: ParamOption[] }
    | { type: "group"; label: string; controls: ParamControl[] };

export type ModelParamSchema = {
    capability: ModelCapability;
    /** 面板标题；缺省用能力默认标题。 */
    title?: string;
    controls: ParamControl[];
};

export function optionValues(control: Extract<ParamControl, { type: "options" }>, config: AiConfig): string {
    return String(config[control.key] ?? control.options[0]?.value ?? "");
}

export function switchValue(control: Extract<ParamControl, { type: "switch" }>, config: AiConfig): boolean {
    const value = String(config[control.key] ?? control.offValue ?? "");
    return value === (control.onValue ?? "true");
}

export function numberValue(control: Extract<ParamControl, { type: "number" }>, config: AiConfig): number {
    const value = Number(config[control.key]);
    if (!Number.isFinite(value)) return control.min ?? 0;
    return value;
}

/** 通用文本设置 schema：所有文本模型默认使用。 */
export const textParamSchema: ModelParamSchema = {
    capability: "text",
    title: "文本设置",
    controls: [
        {
            type: "options",
            key: "reasoningEffort",
            label: "推理强度",
            columns: 5,
            options: [
                { value: "auto", label: "自动" },
                { value: "low", label: "低" },
                { value: "medium", label: "中" },
                { value: "high", label: "高" },
                { value: "xhigh", label: "极高" },
            ],
        },
    ],
};

/** 通用音频设置 schema：OpenAI 兼容 TTS 模型默认使用。 */
export const audioParamSchema: ModelParamSchema = {
    capability: "audio",
    title: "音频设置",
    controls: [
        {
            type: "group",
            label: "声音",
            controls: [
                {
                    type: "options",
                    key: "audioVoice",
                    label: "音色",
                    columns: 3,
                    options: audioVoiceOptions,
                },
            ],
        },
        {
            type: "options",
            key: "audioFormat",
            label: "格式",
            columns: 3,
            options: audioFormatOptions,
        },
        {
            type: "options",
            key: "audioSpeed",
            label: "语速",
            columns: 4,
            options: [
                { value: "0.75", label: "0.75×" },
                { value: "1", label: "1×" },
                { value: "1.25", label: "1.25×" },
                { value: "1.5", label: "1.5×" },
            ],
        },
        {
            type: "number",
            key: "audioSpeed",
            label: "自定义语速",
            min: 0.25,
            max: 4,
            step: 0.05,
        },
        {
            type: "textarea",
            key: "audioInstructions",
            label: "声音指令",
            placeholder: "例如：自然、温暖、适合旁白。",
        },
    ],
};

/** 通用图片设置 schema：无特殊参数的图片模型默认使用。 */
export const imageParamSchema: ModelParamSchema = {
    capability: "image",
    title: "图像设置",
    controls: [
        {
            type: "options",
            key: "quality",
            label: "质量",
            columns: 4,
            options: [
                { value: "auto", label: "自动" },
                { value: "high", label: "高" },
                { value: "medium", label: "中" },
                { value: "low", label: "低" },
            ],
        },
        {
            type: "dimension",
            key: "size",
            label: "尺寸",
            step: 16,
            options: [
                { value: "1024x1024", label: "1:1" },
                { value: "1536x1024", label: "3:2" },
                { value: "1024x1536", label: "2:3" },
                { value: "1360x1024", label: "4:3" },
                { value: "1024x1360", label: "3:4" },
                { value: "1824x1024", label: "16:9" },
                { value: "1024x1824", label: "9:16" },
            ],
        },
        {
            type: "switch",
            key: "background",
            label: "透明背景",
            hint: "仅支持透明背景的模型生效",
            onValue: "transparent",
            offValue: "",
        },
        {
            type: "number",
            key: "count",
            label: "生成张数",
            min: 1,
            max: 15,
            suffix: " 张",
        },
    ],
};

/** 通用视频设置 schema：无特殊参数的视频模型默认使用。 */
export const videoParamSchema: ModelParamSchema = {
    capability: "video",
    title: "视频设置",
    controls: [
        {
            type: "options",
            key: "vquality",
            label: "清晰度",
            columns: 3,
            options: [
                { value: "720", label: "720p" },
                { value: "480", label: "480p" },
                { value: "1080", label: "1080p" },
            ],
        },
        {
            type: "dimension",
            key: "size",
            label: "尺寸",
            step: 16,
            options: [
                { value: "1280x720", label: "横屏" },
                { value: "720x1280", label: "竖屏" },
                { value: "1024x1024", label: "方形" },
                { value: "1792x1024", label: "宽屏" },
                { value: "1024x1792", label: "长图" },
            ],
        },
        {
            type: "number",
            key: "videoSeconds",
            label: "秒数",
            min: 1,
            max: 20,
            suffix: " 秒",
        },
        {
            type: "group",
            label: "输出",
            controls: [
                {
                    type: "switch",
                    key: "videoGenerateAudio",
                    label: "生成声音",
                    onValue: "true",
                    offValue: "false",
                },
                {
                    type: "switch",
                    key: "videoWatermark",
                    label: "添加水印",
                    onValue: "true",
                    offValue: "false",
                },
            ],
        },
    ],
};
