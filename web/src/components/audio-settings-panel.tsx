import { normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { ModelParamPanel } from "@/components/model-param-panel";
import { audioParamSchema } from "@/lib/model-param-schema";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { Input, InputNumber, Select } from "antd";
import { modelOptionName } from "@/stores/use-config-store";

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const model = modelOptionName(config.model || config.audioModel).toLowerCase();
    if (model === "speech-2.8-hd" || model === "speech-2.8-turbo") {
        const voice = config.audioVoice === "alloy" ? "" : config.audioVoice;
        return (
            <div className={className}>
                {showTitle ? <div className="text-sm font-semibold" style={{ color: theme.node.text }}>MiniMax 语音设置</div> : null}
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>音色 ID</span>
                    <Input value={voice} placeholder="如 male-qn-qingse 或克隆 voice ID" onChange={(event) => onConfigChange("audioVoice", event.target.value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>输出格式</span>
                    <Select className="w-full" value={["mp3", "wav", "flac"].includes(config.audioFormat) ? config.audioFormat : "mp3"} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }, { value: "flac", label: "FLAC" }]} onChange={(value) => onConfigChange("audioFormat", value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>语速</span>
                    <InputNumber className="w-full" min={0.5} max={2} step={0.1} value={Math.max(0.5, Math.min(2, Number(config.audioSpeed) || 1))} onChange={(value) => onConfigChange("audioSpeed", String(value || 1))} />
                </label>
            </div>
        );
    }
    if (model.startsWith("qwen-audio-") || model.startsWith("qwen3-tts")) {
        return (
            <div className={className}>
                {showTitle ? <div className="text-sm font-semibold" style={{ color: theme.node.text }}>千问语音设置</div> : null}
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>音色</span>
                    <Input value={config.audioVoice === "alloy" ? "" : config.audioVoice} placeholder={model.startsWith("qwen-audio-") ? "如 longanhuan_v3.6 或克隆 voice ID" : "系统音色或克隆 voice ID"} onChange={(event) => onConfigChange("audioVoice", event.target.value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>输出格式</span>
                    <Select className="w-full" value={config.audioFormat === "wav" ? "wav" : "mp3"} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} onChange={(value) => onConfigChange("audioFormat", value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: theme.node.text }}>声音指令</span>
                    <Input.TextArea value={config.audioInstructions} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="可选：情绪、语气或方言要求" onChange={(event) => onConfigChange("audioInstructions", event.target.value)} />
                </label>
            </div>
        );
    }
    const schema = { ...audioParamSchema, controls: audioParamSchema.controls.map((control) => (control.type === "number" && control.key === "audioSpeed" ? { ...control, normalize: normalizeAudioSpeedValue } : control)) };
    return <ModelParamPanel schema={schema} config={config} onConfigChange={(key, value) => onConfigChange(key as AudioSettingKey, value)} theme={theme} showTitle={showTitle} className={className} />;
}
