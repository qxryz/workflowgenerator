import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { decodeChannelModel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import { finalizePluginVideoResult } from "@/lib/video-result-persistence";
import { discardUploadedMedia, publishUploadedMedia } from "@/services/file-storage";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost, CanvasPluginMedia } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PluginHostParams = {
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
    storeImage: CanvasPluginMedia["storeImage"];
    discardImage: CanvasPluginMedia["discardImage"];
    resolveImage: CanvasPluginMedia["resolveImage"];
};

function asPluginReadableNode(node: CanvasNodeData): CanvasNodeData {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = resource?.kind === "text" ? resource.text : resource?.url;
    if (content === undefined) return node;
    return { ...node, metadata: { ...node.metadata, content } };
}

/**
 * 插件节点宿主能力：把宿主侧的 AI 生成、画布读写、面板开关等封装成插件可调用的 host/ai 对象，
 * 并在挂载时加载已安装的远程插件。返回给画布用于渲染插件面板与工具条。
 */
export function usePluginHost(params: PluginHostParams) {
    const { effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps, storeImage, discardImage, resolveImage } = params;

    // 提供给插件节点的宿主能力(节点无关,方法接收 nodeId)
    const pluginAi = useMemo<CanvasPluginAi>(() => {
        // 把插件传入的参考图(dataURL 或 URL)整理成宿主生成 API 需要的 ReferenceImage[]
        const toReferences = (refs?: string[]): ReferenceImage[] => (refs || []).filter(Boolean).map((src, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));
        // AI 配置未就绪:弹出配置弹窗并抛错,交由插件 catch 处理
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openConfigDialog(true);
                throw new Error("AI 配置未就绪,请先在设置里配置模型与密钥");
            }
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "image"), count: String(options?.count || 1), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = toReferences(options?.references);
                const items = references.length ? await requestEdit(config, prompt, references, undefined, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                return { images: items.map((item) => item.dataUrl) };
            },
            generateVideo: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                    ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
                };
                ensureReady(config);
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, toReferences(options?.references), [], [], { signal: options?.signal }));
                return finalizePluginVideoResult(file, publishUploadedMedia, discardUploadedMedia);
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                ensureReady(config);
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            // 列出某能力下用户已配置的模型;label 取编码值中的模型名(去掉 channel 前缀)
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => {
                const node = nodesRef.current.find((item) => item.id === id);
                return node ? asPluginReadableNode(node) : null;
            },
            getNodes: () => nodesRef.current.map(asPluginReadableNode),
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node))
                    .map(asPluginReadableNode),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node))
                    .map(asPluginReadableNode),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            media: { storeImage, discardImage, resolveImage },
            ai: pluginAi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, discardImage, pluginAi, resolveImage, storeImage],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // 组装节点悬浮工具条按钮:插件自定义 toolbar +(声明 interactionToggle 时)宿主自动注入的「交互 ⇄ 移动」开关
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // 仅在节点有内容(展示态)且非强制交互态(如编辑态)时提供「交互/移动」开关
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: interactive ? "当前:交互中。点击切回「移动」——拖动可移动节点" : "当前:可移动。点击切到「交互」——可操作节点内容(如转动全景)",
                label: interactive ? "移动" : "交互",
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, theme],
    );

    // 启动时加载已安装的远程插件
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
