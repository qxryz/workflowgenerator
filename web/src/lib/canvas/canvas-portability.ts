import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

/**
 * 已移除的内置节点类型：终端 Agent。
 *
 * 老画布（服务端持久化、导入的 JSON、WebDAV 合并、导出再导入）在加载时统一走
 * 这里清理，终端节点会连同它的全部连线一起删除。函数是幂等的：没有终端节点时
 * 原样返回同一个对象，不会改动其它节点与连线。
 */
const REMOVED_NODE_TYPE = "terminal";

export function normalizeCanvasProject(project: CanvasProject): CanvasProject {
    if (!project.nodes.some((node) => node.type === REMOVED_NODE_TYPE)) return project;
    const nodes = project.nodes.filter((node) => node.type !== REMOVED_NODE_TYPE);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connections = project.connections.filter((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId));
    return { ...project, nodes, connections };
}
