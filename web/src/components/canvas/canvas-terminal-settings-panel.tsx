import { useState, type CSSProperties } from "react";
import { App, Button, Input, InputNumber, Switch } from "antd";
import { Copy, ExternalLink, RotateCcw, Share2, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { openExternalTerminal } from "@/services/terminal";
import { useCopyText } from "@/hooks/use-copy-text";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasTerminalInputMode } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const modes: Array<{ value: CanvasGenerationMode; label: string }> = [
    { value: "text", label: "文本" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
];

export function CanvasTerminalSettingsPanel({ node, references, onChange, onClose, onConfirm }: { node: CanvasNodeData; references: CanvasResourceReference[]; onChange: (patch: Partial<CanvasNodeMetadata>) => void; onClose: () => void; onConfirm?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const inputMode = node.metadata?.terminalInputMode || "auto";
    const outputMode = node.metadata?.terminalOutputMode || "text";
    const acceptedReferences = references.filter((reference) => reference.nodeId !== node.id && (inputMode === "auto" || reference.kind === inputMode));
    const controlStyle: CSSProperties = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const { message } = App.useApp();
    const copyText = useCopyText();
    const terminalApp = useConfigStore((state) => state.config.terminalApp);
    const skills = useSkillStore((state) => state.skills);
    const setSkillEnabled = useSkillStore((state) => state.setEnabled);
    // Zodiac 专属技能只供画布上的 Zodiac Agent 编排，不进入终端节点环境。
    const enabledSkills = skills.filter((skill) => skill.enabled && !skill.zodiacOnly).sort((a, b) => a.priority - b.priority);
    const terminalSkills = skills.filter((skill) => !skill.zodiacOnly).sort((a, b) => a.priority - b.priority);
    const zodiacOnlyEnabledCount = skills.filter((skill) => skill.enabled && skill.zodiacOnly).length;
    const [openingExternal, setOpeningExternal] = useState(false);
    const needsSetup = node.metadata?.terminalConfigured === false;
    const restart = () => onChange({ terminalSessionVersion: (node.metadata?.terminalSessionVersion || 0) + 1 });
    const publishTextOutput = () => {
        onChange({ terminalOutputRevision: (node.metadata?.terminalOutputRevision || 0) + 1 });
        message.success("输出已传给下游节点");
    };
    const copyAgentPrompt = () => {
        const prompt = buildTerminalContextPrompt(acceptedReferences, outputMode, enabledSkills.map((skill) => skill.name));
        copyText(prompt, "已复制给 Agent");
    };
    const openInDefaultTerminal = async () => {
        setOpeningExternal(true);
        try {
            await openExternalTerminal(terminalApp, node.metadata?.terminalDirectory);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法打开外部终端");
        } finally {
            setOpeningExternal(false);
        }
    };

    return (
        <div className="rounded-2xl border p-3 shadow-2xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">{needsSetup ? "配置终端" : "终端设置"}</div>
                    <div className="mt-0.5 text-[11px] opacity-55">{needsSetup ? "确认工作目录与数据流后再启动终端。" : "设置终端工作目录与画布数据流。"}</div>
                </div>
                <Button size="small" type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<X className="size-3.5" />} aria-label="关闭终端设置" onClick={onClose} />
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="grid gap-1.5 text-xs font-medium">
                    工作目录
                    <Input value={node.metadata?.terminalDirectory || ""} placeholder="默认使用应用工作目录" onChange={(event) => onChange({ terminalDirectory: event.target.value })} />
                </label>
                <div className="flex items-end">
                    <div className="flex gap-2">
                        <Button icon={<RotateCcw className="size-3.5" />} onClick={restart}>重新打开</Button>
                        <Button loading={openingExternal} icon={<ExternalLink className="size-3.5" />} onClick={() => void openInDefaultTerminal}>在 {terminalApp === "ghostty" ? "Ghostty" : "Terminal"} 中打开</Button>
                    </div>
                </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ModePicker label="接收内容" value={inputMode} onChange={(value) => onChange({ terminalInputMode: value })} allowAuto />
                <ModePicker label="输出内容" value={outputMode} onChange={(value) => onChange({ terminalOutputMode: value as CanvasGenerationMode })} />
            </div>
            <div className="mt-4 flex items-end gap-3">
                <label className="grid gap-1.5 text-xs font-medium">
                    终端字号
                    <InputNumber min={10} max={20} value={node.metadata?.terminalFontSize || 12} onChange={(value) => onChange({ terminalFontSize: Math.min(20, Math.max(10, Number(value) || 12)) })} />
                </label>
                <span className="pb-1 text-[11px] opacity-50">拖动节点边角可调整终端显示区域。</span>
                {outputMode === "text" ? <Button className="ml-auto" icon={<Share2 className="size-3.5" />} disabled={!node.metadata?.terminalOutputValue?.trim()} onClick={publishTextOutput}>发布输出</Button> : null}
            </div>
            <div className="mt-4 rounded-xl border px-3 py-2.5" style={controlStyle}>
                <div className="mb-1.5 flex items-center justify-between gap-2"><div className="text-[11px] font-medium opacity-70">已连接内容</div><Button size="small" icon={<Copy className="size-3.5" />} onClick={copyAgentPrompt}>复制给 Agent</Button></div>
                {acceptedReferences.length ? <div className="flex flex-wrap gap-1.5">{acceptedReferences.map((reference) => <span key={reference.id} className="max-w-44 truncate rounded-md bg-black/5 px-2 py-1 text-[11px] dark:bg-white/[.07]">{reference.title}</span>)}</div> : <div className="text-[11px] opacity-50">连接上游节点后会显示在这里。</div>}
            </div>
            <div className="mt-3 grid gap-2 rounded-xl border px-3 py-2.5 text-[11px]" style={controlStyle}>
                <div><span className="mr-2 font-semibold opacity-80">输入</span><code className="font-mono">WG_INPUT_TEXT</code><span className="opacity-50"> 与 </span><code className="font-mono">WG_INPUT_DIR</code></div>
                <div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="mr-2 font-semibold opacity-80">Skills</span>
                        <span className="opacity-50">{enabledSkills.length} 个已启用，可从 WG_SKILLS_INDEX 读取</span>
                    </div>
                    {terminalSkills.length ? (
                        <div className="mt-1.5 space-y-1">
                            {terminalSkills.map((skill) => (
                                <label key={skill.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 transition hover:bg-black/5 dark:hover:bg-white/5">
                                    <span className="min-w-0 truncate" title={skill.description}>{skill.name}</span>
                                    <Switch size="small" checked={skill.enabled} onChange={(checked) => setSkillEnabled(skill.id, checked)} aria-label={`终端启用 ${skill.name}`} />
                                </label>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-1 opacity-50">尚未启用</div>
                    )}
                </div>
                {zodiacOnlyEnabledCount ? <div><span className="mr-2 opacity-50">Zodiac</span>{zodiacOnlyEnabledCount} 个专属技能仅用于 Zodiac 编排，不进入终端环境。</div> : null}
                {outputMode === "text" ? <div><span className="mr-2 font-semibold opacity-80">输出</span>确认结果后点击“发布输出”，一次传给下游节点。</div> : <div><span className="mr-2 font-semibold opacity-80">输出</span>保存到 <code className="font-mono">WG_OUTPUT_DIR</code> 会自动进入画布；保存在工作目录时可执行 <code className="font-mono">wg-output "./文件名"</code>。</div>}
            </div>
            {needsSetup ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-blue-500/25 bg-blue-500/[.06] px-3 py-2.5">
                    <span className="text-[11px] leading-5 opacity-70">确认后才会启动这个终端节点。</span>
                    <Button type="primary" size="small" onClick={onConfirm}>完成设置</Button>
                </div>
            ) : null}
        </div>
    );
}

function buildTerminalContextPrompt(references: CanvasResourceReference[], outputMode: CanvasGenerationMode, skillNames: string[]) {
    const lines = ["请使用与本终端直接相连的上游节点输出完成任务。", "文本内容位于：$WG_INPUT_DIR/input.txt，也可从 $WG_INPUT_TEXT 读取。", "图片、视频和音频素材位于：$WG_INPUT_DIR"];
    if (references.length) {
        const counts = references.reduce<Record<string, number>>((result, reference) => ({ ...result, [reference.kind]: (result[reference.kind] || 0) + 1 }), {});
        const labels: Record<string, string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };
        lines.push(`本次已注入：${Object.entries(counts).map(([kind, count]) => `${labels[kind] || kind} ${count} 项`).join("、")}。`);
    }
    lines.push("请先读取实际内容，不要把节点名称当作输入正文。");
    if (skillNames.length) lines.push(`本轮可用 Skills：${skillNames.join("、")}。索引位于 $WG_SKILLS_INDEX，请按需读取对应 SKILL.md。`);
    if (outputMode === "text") {
        lines.push("本节点输出为文本，请在终端中给出最终文本结果。");
    } else {
        const labels: Record<CanvasGenerationMode, string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };
        lines.push(`本节点输出为${labels[outputMode]}。请将最终文件写入 $WG_OUTPUT_DIR，文件写入完成后会自动进入画布。`);
        lines.push('若必须写入当前工作目录，请在完成后执行：wg-output "./文件名"。回复中只写文件名或相对路径。');
    }
    return lines.join("\n");
}

function ModePicker({ label, value, onChange, allowAuto = false }: { label: string; value: CanvasTerminalInputMode | CanvasGenerationMode; onChange: (value: CanvasTerminalInputMode | CanvasGenerationMode) => void; allowAuto?: boolean }) {
    return (
        <div>
            <div className="mb-1.5 text-xs font-medium opacity-70">{label}</div>
            <div className="flex flex-wrap gap-1">
                {allowAuto ? <ModeButton active={value === "auto"} onClick={() => onChange("auto")}>自动</ModeButton> : null}
                {modes.map((mode) => <ModeButton key={mode.value} active={value === mode.value} onClick={() => onChange(mode.value)}>{mode.label}</ModeButton>)}
            </div>
        </div>
    );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
    return <button type="button" onClick={onClick} className={`rounded-md px-2 py-1 text-xs transition ${active ? "bg-blue-500 text-white shadow-sm" : "bg-black/5 text-stone-500 hover:bg-black/10 dark:bg-white/[.07] dark:text-stone-300 dark:hover:bg-white/[.12]"}`}>{children}</button>;
}
