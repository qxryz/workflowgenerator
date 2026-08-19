import { create } from "zustand";

import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

const BUILTIN_NODE_TYPES = new Set(["text", "file", "config", "image", "video", "audio", "terminal", "group"]);

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>(); // type -> pluginId(内置为 "builtin")

// 注册表版本号,注册/卸载时自增,驱动创建菜单等 UI 重渲染
export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
function bump() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(defs: CanvasNodeDefinition[], pluginId = "builtin") {
    defs.forEach((def) => {
        definitions.set(def.type, def);
        ownerByType.set(def.type, pluginId);
    });
    bump();
}

export function unregisterPluginNodes(pluginId: string) {
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
    }
    bump();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export type AgentVisiblePluginNodeDefinition = Readonly<{
    type: string;
    title: string;
    description?: string;
}>;

/**
 * Returns the inert catalog fields that Zodiac may see for currently active
 * plugin nodes. Runtime components, metadata defaults and callbacks never cross
 * the agent protocol boundary.
 */
export function listAgentVisiblePluginNodeDefinitions(): AgentVisiblePluginNodeDefinition[] {
    return Array.from(definitions.entries()).flatMap(([type, definition]) => {
        if (!isAgentVisiblePluginNodeType(type)) return [];
        const title = safeAgentCatalogText(definition.title, 120) || type;
        const description = safeAgentCatalogText(definition.description, 240);
        return [{ type, title, ...(description ? { description } : {}) }];
    }).sort((left, right) => left.type.localeCompare(right.type));
}

/** A plugin type is agent-visible only while its enabled definition is live. */
export function isAgentVisiblePluginNodeType(type: string) {
    const definition = definitions.get(type);
    return Boolean(
        definition
        && !isBuiltinNodeType(type)
        && ownerByType.get(type) !== "builtin"
        && definition.showInCreateMenu !== false
        && isSafeAgentPluginNodeType(type),
    );
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

function isSafeAgentPluginNodeType(type: string) {
    return type.length > 0 && type.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(type);
}

function safeAgentCatalogText(value: unknown, maximumLength: number) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: "节点", metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

// 提供默认尺寸/标题/初始 metadata,createCanvasNode 与 agent-ops 复用
export function getNodeSpec(type: string) {
    const def = definitions.get(type);
    if (!def) return FALLBACK_SPEC;
    return { width: def.defaultSize.width, height: def.defaultSize.height, title: def.title, metadata: def.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return BUILTIN_NODE_TYPES.has(type);
}
