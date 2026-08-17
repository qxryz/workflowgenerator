import type { ModelCapability } from "@/stores/use-config-store";
import { modelExperienceKind, modelUiAdaptation } from "@/lib/model-providers";
import { audioParamSchema, imageParamSchema, textParamSchema, videoParamSchema, type ModelParamSchema } from "@/lib/model-param-schema";
import { findCatalogModel, resolveAdapterForModel } from "@/lib/model-catalog";
import { getModelAdapter } from "@/lib/model-adapters";

/**
 * 模型 → UI 适配解析器：统一决定“这个模型用原生面板还是通用 schema 面板”。
 *
 * 优先级：模型经验（Grok/Seedream/Seedance 等原生面板）→ 通用 schema。
 * 新模型没有声明经验时自动落到通用 schema，界面零改动出现。
 */
export type ModelUiResolution =
    | { kind: "native"; experience: ReturnType<typeof modelExperienceKind>; label: string; detail: string }
    | { kind: "generic"; schema: ModelParamSchema; label: string; detail: string };

const NATIVE_DETAILS: Partial<Record<ReturnType<typeof modelExperienceKind>, string>> = {
    "grok-image": "Grok 图片参数与参考图限制",
    "agnes-image": "Agnes 图片画幅与生成数量",
    "seedream-image": "Seedream 清晰度、多图与方舟选项",
    "minimax-image": "MiniMax image-01 画幅、人物参考与生成选项",
    "grok-video": "Grok 时长、画幅与参考素材",
    "agnes-video": "Agnes 首帧、时长与画幅",
    "seedance-video": "Seedance 图像、视频、音频与声音设置",
    "minimax-video": "MiniMax H3 多模态参考、清晰度、时长与画幅",
    "minimax-hailuo-video": "MiniMax Hailuo 首帧、分辨率、时长与生成选项",
    "qwen-audio": "千问语音、声音克隆与转录任务参数",
    "minimax-audio": "MiniMax Speech 2.8 语音生成与声音复刻参数",
};

const GENERIC_SCHEMAS: Record<ModelCapability, ModelParamSchema> = {
    text: textParamSchema,
    image: imageParamSchema,
    video: videoParamSchema,
    audio: audioParamSchema,
};

export function resolveModelUi(protocol: string, modelName: string, capability: ModelCapability): ModelUiResolution {
    const experience = modelExperienceKind(protocol as never, modelName, capability);
    const adaptation = modelUiAdaptation(protocol as never, modelName, capability);
    const detail = adaptation.native ? adaptation.detail : NATIVE_DETAILS[experience];
    if (detail) {
        return { kind: "native", experience, label: "原生 UI", detail };
    }
    const catalogEntry = findCatalogModel(modelName);
    if (catalogEntry?.parameters) {
        return { kind: "generic", schema: catalogEntry.parameters, label: "模型专属 UI", detail: "模型目录声明了专属参数面板" };
    }
    return { kind: "generic", schema: GENERIC_SCHEMAS[capability], label: "通用 UI", detail: capability === "image" ? "使用通用图像设置" : capability === "video" ? "使用通用视频设置" : capability === "audio" ? "使用通用音频设置" : "使用通用文本设置" };
}

/** 模型实际使用的适配器，供渠道编辑器和文档页展示。 */
export function resolveModelAdapterLabel(modelName: string, capability: ModelCapability, protocol: string) {
    const adapter = resolveAdapterForModel(modelName, capability);
    return getModelAdapter(adapter)?.label || "自定义";
}
