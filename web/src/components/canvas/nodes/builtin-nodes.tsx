import { FileText, Group, Image as ImageIcon, Music2, Settings2, Terminal, Video } from "lucide-react";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";

// 内置节点的可扩展元数据(尺寸/初始 metadata 复用 NODE_SPECS)。
// 渲染仍由 canvas-node 内部渲染器负责,故不提供 Content。
function builtinResource(node: CanvasNodeData): CanvasNodeResource | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return { kind: "image", url: node.metadata.content };
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return { kind: "video", url: node.metadata.content };
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return { kind: "audio", url: node.metadata.content };
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return { kind: "text", text: node.metadata.content || node.metadata.prompt };
    if (node.type === CanvasNodeType.Terminal) {
        const kind = node.metadata?.terminalOutputMode || "text";
        const output = kind === "text" ? node.metadata?.terminalOutputValue || node.metadata?.terminalOutput : node.metadata?.terminalOutputArtifactUrl;
        if (kind === "text") return { kind, text: output || "" };
        return output ? { kind, url: output } : null;
    }
    return null;
}

const iconClass = "size-5";

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: "文本", icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource },
    { type: CanvasNodeType.Image, title: "图片", icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource },
    { type: CanvasNodeType.Video, title: "视频", icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Audio, title: "音频", icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource },
    { type: CanvasNodeType.Terminal, title: "终端 Agent", description: "运行 Codex、Claude Code 或本地命令", icon: <Terminal className={iconClass} />, minimapColor: "#22c55e", resource: builtinResource },
    { type: CanvasNodeType.Config, title: "生成配置", icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: true },
    { type: CanvasNodeType.Group, title: "组", icon: <Group className={iconClass} />, minimapColor: "#94a3b8" },
].map((def) => {
    const spec = NODE_SPECS[def.type];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS, "builtin");
}
