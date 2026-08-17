import type { ComponentType, ReactNode } from "react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";

// 插件节点作为上游输入被消费时输出的资源
export type CanvasNodeResource = { kind: CanvasResourceKind; text?: string; url?: string };

// --- AI 生成能力(生图/生视频/生文本),由宿主注入,复用宿主模型/密钥配置 ---
export type GenerateOptions = { signal?: AbortSignal; references?: string[]; model?: string };
export type GenerateImageOptions = GenerateOptions & { count?: number; size?: string };
export type GenerateImageResult = { images: string[] };
export type GenerateVideoOptions = GenerateOptions & { size?: string; seconds?: string };
export type GenerateVideoResult = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };
export type GenerateTextOptions = { signal?: AbortSignal; model?: string; system?: string; onDelta?: (text: string) => void };
export type GenerateTextResult = { text: string };
export type PluginModelCapability = "image" | "video" | "text" | "audio";
export type ModelOption = { value: string; label: string };

export type CanvasPluginAi = {
    generateImage: (prompt: string, options?: GenerateImageOptions) => Promise<GenerateImageResult>;
    generateVideo: (prompt: string, options?: GenerateVideoOptions) => Promise<GenerateVideoResult>;
    generateText: (prompt: string, options?: GenerateTextOptions) => Promise<GenerateTextResult>;
    listModels: (capability?: PluginModelCapability) => ModelOption[];
    defaultModel: (capability: PluginModelCapability) => string;
};

// 节点自带的工具栏按钮(追加到 hover 工具栏尾部)
export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

// 每个节点渲染时注入的上下文,是插件与画布交互的核心接口
export type CanvasNodeContext = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean; // 该节点当前是否被选中(用于按需启用 iframe 交互等)
    // 自身数据
    updateMetadata: (patch: CanvasNodeMetadata) => void;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    // 图访问
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: () => CanvasNodeData[];
    getDownstream: () => CanvasNodeData[];
    // 画布操作,复用 Agent 指令集(增删节点/连线/选择/视口/触发生成)
    applyOps: (ops: CanvasAgentOp[]) => void;
    // 节点间/插件间通信
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // AI 生成能力(生图/生视频/生文本),复用宿主模型配置
    ai: CanvasPluginAi;
    // 打开/关闭本节点下方的自定义 Panel(需在节点定义里提供 Panel)
    openPanel: () => void;
    closePanel: () => void;
    // 插件私有持久化,命名空间隔离
    storage: PluginStorage;
    // 宿主管理的媒体存储。返回值可直接写入画布节点 metadata。
    media: CanvasPluginMedia;
};

export type PluginStorage = {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

export type CanvasPluginStoredImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type CanvasPluginMedia = {
    storeImage: (input: string | Blob) => Promise<CanvasPluginStoredImage>;
    discardImage: (image: CanvasPluginStoredImage) => Promise<void>;
    resolveImage: (storageKey: string, fallback?: string) => Promise<string>;
};

// 画布宿主提供的、与具体节点无关的能力集合(由画布页面构建、注入渲染链路)
export type CanvasPluginHost = {
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: (nodeId: string) => CanvasNodeData[];
    getDownstream: (nodeId: string) => CanvasNodeData[];
    updateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    updateMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
    applyOps: (ops: CanvasAgentOp[]) => void;
    media: CanvasPluginMedia;
    // AI 生成能力,复用画布页面当前的模型/密钥配置
    ai: CanvasPluginAi;
    // 打开/关闭指定节点下方的自定义 Panel
    openPanel: (nodeId: string) => void;
    closePanel: () => void;
};

// 复用宿主内置生成面板的配置(见 SDK CanvasBuiltinPanelConfig)
export type CanvasBuiltinPanelConfig = {
    mode: "image" | "video" | "text" | "audio";
    promptPrefix?: string;
    writeBackToSelf?: boolean;
};

// 节点类型定义:内置节点与插件节点统一走这套结构
export type CanvasNodeDefinition = {
    type: string; // 内置如 "image";插件建议 "<pluginId>:<name>"
    title: string;
    icon: ReactNode;
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean; // 默认 true
    hasSourceHandle?: boolean; // 右侧输出连接点,默认 true
    hidePanel?: boolean; // 为 true 时:点击/新建不弹出下方面板(含内置生图面板),纯展示型节点用
    transparentBackground?: boolean; // 为 true 时:节点卡片背景与边框透明,内容直接融入画布(如 SVG/矢量图)
    autoOpenPanel?: boolean; // 为 true 时:单击节点自动打开自定义 Panel(默认仅内置节点单击自动打开)
    useBuiltinPanel?: CanvasBuiltinPanelConfig; // 复用宿主内置生成面板(与自定义 Panel 二选一)
    // 为 true 时:宿主自动提供「交互 ⇄ 移动」工具条开关,并按 metadata.interactive 控制内容层指针事件
    interactionToggle?: boolean;
    // 配合 interactionToggle:返回 true 表示内容强制可交互(如编辑态),忽略 interactive 并隐藏开关
    forceInteractive?: (node: CanvasNodeData) => boolean;
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    resource?: (node: CanvasNodeData) => CanvasNodeResource | null;
    // 渲染:内置节点由 canvas-node 内部渲染器负责,可不提供 Content
    Content?: ComponentType<{ ctx: CanvasNodeContext }>;
    Panel?: ComponentType<{ ctx: CanvasNodeContext; onClose: () => void }>;
    toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean; // 返回 true 表示已处理
};

// 插件启动时可访问的应用能力
export type CanvasPluginApp = {
    version: string;
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // 注入插件样式,返回移除函数;传 key 时同 key 覆盖旧样式
    injectCSS: (css: string, key?: string) => () => void;
};

// 插件包默认导出
export type CanvasPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    minAppVersion?: string;
    css?: string; // 插件样式,启用时自动注入、卸载/禁用时自动清理
    nodes: CanvasNodeDefinition[];
    setup?: (app: CanvasPluginApp) => void | (() => void);
};
