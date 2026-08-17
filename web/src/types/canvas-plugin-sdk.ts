// 本地内置插件在应用源码中直载时使用宿主真源类型；独立插件构建仍由公共 SDK 提供同形契约。
export type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
export type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
export type { CanvasNodeContext, CanvasPlugin, CanvasPluginStoredImage } from "@/types/canvas-plugin";
export type { PluginRuntime } from "@/lib/canvas/plugin-runtime";
