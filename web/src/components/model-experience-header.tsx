import { Image as ImageIcon, Sparkles, Video } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { getProviderDefinition, modelDisplayName, modelExperienceKind } from "@/lib/model-providers";
import { isSeedance25Model } from "@/lib/seedance-2-5";
import { modelOptionName, resolveModelRequestConfig, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export function ModelExperienceHeader({ config, capability, theme, compact = false }: { config: AiConfig; capability: Extract<ModelCapability, "image" | "video">; theme: CanvasTheme; compact?: boolean }) {
    const selected = config.model || (capability === "image" ? config.imageModel : config.videoModel);
    const request = resolveModelRequestConfig(config, selected);
    const provider = getProviderDefinition(request.apiFormat);
    const modelName = modelOptionName(selected || request.model);
    const kind = modelExperienceKind(request.apiFormat, modelName, capability);
    const hint = experienceHint(kind, modelName);
    const Icon = capability === "image" ? ImageIcon : Video;

    return (
        <div className={`flex items-start gap-3 rounded-xl border ${compact ? "p-2.5" : "p-3"}`} style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ background: provider.accent }}>
                <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                    <Sparkles className="size-3" />
                    {provider.label}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold" title={modelName}>
                    {modelDisplayName(request.apiFormat, modelName)}
                </span>
                {compact ? null : (
                    <span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>
                        {hint}
                    </span>
                )}
            </span>
        </div>
    );
}

function experienceHint(kind: ReturnType<typeof modelExperienceKind>, modelName = "") {
    if (kind === "grok-image") return "支持 1K / 2K、多种画幅和最多三张参考图编辑。";
    if (kind === "seedream-image") return "适合高分辨率创作、多图融合和细节编辑。";
    if (kind === "agnes-image") return "快速完成图片生成与风格变化，尺寸由画幅自动匹配。";
    if (kind === "gemini-image") return "适合图文混合创作，参考图会和提示词一起理解。";
    if (kind === "grok-video") return "支持文生视频、首帧动画和参考图引导，最长 15 秒。";
    if (kind === "seedance-video" && isSeedance25Model(modelName)) return "支持长视频、视频延长与精准编辑。";
    if (kind === "seedance-video") return "支持图片、视频与音频参考，可生成同步声音。";
    if (kind === "agnes-video") return "适合快速文生视频或首帧动画，默认 24 帧每秒。";
    return kind.includes("video") ? "参数会按当前视频模型的能力自动适配。" : "参数会按当前图片模型的能力自动适配。";
}
