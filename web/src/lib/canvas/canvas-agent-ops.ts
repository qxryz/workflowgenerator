import { nanoid } from "nanoid";

import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { normalizeConnection } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && (isRegisteredNodeType(op.nodeType) || Object.values(CanvasNodeType).includes(op.nodeType as CanvasNodeType)) ? op.nodeType : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const nodeId = op.id || `${nodeType}-${Date.now()}-${index}`;
            if (op.id && nodes.some((node) => node.id === op.id)) {
                selectedNodeIds = [op.id];
                return;
            }
            const node: CanvasNodeData = {
                id: nodeId,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: normalizeNodeMetadata(nodeType, { ...spec.metadata, ...op.metadata }),
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const type = op.patch?.type || node.type;
                return { ...node, ...op.patch, metadata: normalizeNodeMetadata(type, { ...node.metadata, ...op.patch?.metadata, ...op.metadata }) };
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const connection = normalizeConnection(op.fromNodeId, op.toNodeId, nodes, "source");
            if (!connection) return;
            const exists = connections.some((conn) => conn.fromNodeId === connection.fromNodeId && conn.toNodeId === connection.toNodeId);
            if (!exists) connections = [...connections, { id: op.id || nanoid(), ...connection }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function normalizeNodeMetadata(nodeType: CanvasNodeTypeId, metadata: CanvasNodeMetadata) {
    if (nodeType !== CanvasNodeType.Terminal) return metadata;
    const terminalInputMode = metadata.terminalInputMode === "auto" || isGenerationMode(metadata.terminalInputMode) ? metadata.terminalInputMode : "auto";
    const terminalOutputMode = isGenerationMode(metadata.terminalOutputMode) ? metadata.terminalOutputMode : "text";
    return { ...metadata, terminalInputMode, terminalOutputMode };
}

function isGenerationMode(value: unknown): value is CanvasGenerationMode {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function opLabel(type: string) {
    if (type === "add_node") return "新增节点";
    if (type === "update_node") return "更新节点";
    if (type === "delete_node") return "删除节点";
    if (type === "delete_connections") return "删除连线";
    if (type === "connect_nodes") return "连接";
    if (type === "set_viewport") return "调整视图";
    if (type === "select_nodes") return "选择节点";
    if (type === "run_generation") return "触发生成";
    return type;
}
