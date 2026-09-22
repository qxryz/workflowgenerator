import { isReadyCanvasResourceValue, resolveCanvasInputBindings } from "../canvas/canvas-input-bindings.ts";

export type ZodiacCanvasSnapshot = {
    title: string;
    nodes: Array<{
        id: string;
        type: string;
        title: string;
        position: { x: number; y: number };
        metadata?: Record<string, unknown>;
    }>;
    connections: Array<{ fromNodeId: string; toNodeId: string }>;
    selectedNodeIds: string[];
    /** Used for relevance ordering only; never promoted to system instructions. */
    userText?: string;
    visualContext?: { attachedNodeIds: string[]; omittedImages: number; unavailableNodeIds?: string[] };
};

type ContextNode = ZodiacCanvasSnapshot["nodes"][number];

export function zodiacNodePrompt(node: ContextNode) {
    return stringValue(node.metadata?.prompt) || stringValue(node.metadata?.composerContent);
}

export function zodiacNodeReady(node: Pick<ContextNode, "metadata">) {
    const metadata = node.metadata;
    return isReadyCanvasResourceValue(
        stringValue(metadata?.status) || undefined,
        stringValue(metadata?.content) || stringValue(metadata?.storageKey),
        metadata?.role === "result-slot" ? stringValue(metadata.slotState) || undefined : undefined,
    );
}

export function zodiacPromptNodeIds(prompt: string) {
    return [...new Set(resolveCanvasInputBindings([], prompt).tokens.map((token) => token.nodeId))];
}

/** Group membership is stored on each child as metadata.groupId, including imported assets. */
export function expandZodiacGroupNodeIds(nodes: ContextNode[], ids: string[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const children = groupChildren(nodes);
    const seen = new Set<string>();
    const visit = (id: string) => {
        if (seen.has(id) || !nodeById.has(id)) return;
        seen.add(id);
        if (nodeById.get(id)?.type === "group") for (const child of children.get(id) || []) visit(child.id);
    };
    ids.forEach(visit);
    return [...seen];
}

export function selectZodiacContextNodes(snapshot: ZodiacCanvasSnapshot, maxNodes = 80) {
    const focus = contextFocus(snapshot);
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const focusedIds = new Set(focus.expandedIds);
    const groups = focus.expandedIds.filter((id) => nodeById.get(id)?.type === "group");
    const children = groupChildren(snapshot.nodes);
    const memberIds = interleave(groups.map((id) => [...(children.get(id) || [])].sort((a, b) => Number(b.type === "text") - Number(a.type === "text")).map((node) => node.id)));
    const neighbors = snapshot.connections.flatMap((edge) => (focusedIds.has(edge.toNodeId) ? [edge.fromNodeId] : focusedIds.has(edge.fromNodeId) ? [edge.toNodeId] : []));
    return [...new Set([...focus.explicitIds, ...groups, ...memberIds, ...focus.expandedIds, ...neighbors, ...snapshot.nodes.map((node) => node.id)])]
        .map((id) => nodeById.get(id))
        .filter((node): node is ContextNode => Boolean(node))
        .slice(0, Math.max(0, Math.floor(maxNodes)));
}

/** IDs only: the caller resolves and attaches actual images, then records successful attachments. */
export function selectZodiacCanvasImages(snapshot: ZodiacCanvasSnapshot, options: { userText?: string; maxImages?: number } = {}) {
    const focus = contextFocus({ ...snapshot, userText: options.userText ?? snapshot.userText });
    const focusedIds = new Set(focus.expandedIds);
    const focusOrder = new Map(focus.expandedIds.map((id, index) => [id, index]));
    const explicitIds = new Set(focus.explicitIds);
    const images = snapshot.nodes.filter((node) => node.type === "image" && zodiacNodeReady(node) && (!focus.hasExplicitFocus || focusedIds.has(node.id))).sort((a, b) => (focusOrder.get(a.id) ?? Infinity) - (focusOrder.get(b.id) ?? Infinity));
    const buckets = new Map<string, ContextNode[]>();
    for (const node of images) {
        const key = stringValue(node.metadata?.groupId) || node.id;
        const bucket = buckets.get(key) || [];
        bucket.push(node);
        buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) bucket.sort((a, b) => imagePriority(b, explicitIds) - imagePriority(a, explicitIds));
    const orderedIds = [...new Set([...focus.explicitIds.filter((id) => images.some((node) => node.id === id)), ...interleave([...buckets.values()].map((bucket) => bucket.map((node) => node.id)))])];
    const requestedLimit = options.maxImages ?? 8;
    const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : 8;
    const nodeIds = orderedIds.slice(0, limit);
    return { nodeIds, omitted: orderedIds.length - nodeIds.length };
}

function contextFocus(snapshot: ZodiacCanvasSnapshot) {
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const userText = snapshot.userText || "";
    const namedIds = snapshot.nodes
        .filter((node) => {
            const name = node.title.replace(/^(?:人物|场景)\s*[·:：-]\s*/u, "").trim();
            return name.length >= 2 && !["文本", "图片", "视频", "音频", "组", "配置"].includes(name) && userText.includes(name);
        })
        .map((node) => node.id);
    const requestedGroups = snapshot.nodes
        .filter((node) => {
            if (node.type !== "group" || !/(?:组|资产|groups?|assets?)/iu.test(userText)) return false;
            if (/(?:人物|角色|characters?)/iu.test(userText)) return node.metadata?.assetKind === "character" || /^(?:人物|角色|character)\s*[·:：-]/iu.test(node.title);
            if (/(?:场景|scenes?)/iu.test(userText)) return node.metadata?.assetKind === "scene" || /^(?:场景|scene)\s*[·:：-]/iu.test(node.title);
            return /(?:资产组|asset\s+groups?|画布.*组|canvas.*groups?)/iu.test(userText);
        })
        .map((node) => node.id);
    const explicitIds = [...new Set([...zodiacPromptNodeIds(userText), ...namedIds, ...requestedGroups, ...snapshot.selectedNodeIds])].filter((id) => nodeById.has(id));
    const visited = new Set<string>();
    const visit = (id: string) => {
        if (visited.has(id) || !nodeById.has(id)) return;
        visited.add(id);
        const parentId = stringValue(nodeById.get(id)?.metadata?.groupId);
        if (parentId && nodeById.get(parentId)?.type === "group") visit(parentId);
        for (const edge of snapshot.connections) if (edge.toNodeId === id) visit(edge.fromNodeId);
    };
    (explicitIds.length ? explicitIds : snapshot.nodes.filter((node) => node.type === "group").map((node) => node.id)).forEach(visit);
    return { explicitIds, expandedIds: expandZodiacGroupNodeIds(snapshot.nodes, [...visited]), hasExplicitFocus: explicitIds.length > 0 };
}

function groupChildren(nodes: ContextNode[]) {
    const children = new Map<string, ContextNode[]>();
    for (const node of nodes) {
        const parentId = stringValue(node.metadata?.groupId);
        if (!parentId) continue;
        const members = children.get(parentId) || [];
        members.push(node);
        children.set(parentId, members);
    }
    return children;
}

function imagePriority(node: ContextNode, explicitIds: Set<string>) {
    if (explicitIds.has(node.id)) return 10;
    if (/主视觉|标准形象|定妆|hero|key\s*visual/iu.test(node.title)) return 3;
    if (/正面|全身|front|full\s*body/iu.test(node.title)) return 2;
    return /三视|表情|turnaround|expression/iu.test(node.title) ? 0 : 1;
}

function interleave(buckets: string[][]) {
    const result: string[] = [];
    const length = Math.max(0, ...buckets.map((bucket) => bucket.length));
    for (let index = 0; index < length; index++) for (const bucket of buckets) if (bucket[index]) result.push(bucket[index]);
    return result;
}

/** Only authored text is eligible for excerpts. Never send raw metadata or media locators. */
export function redactZodiacContextText(value: unknown) {
    return stringValue(value)
        .replace(/(?:data:[^\s,;]+(?:;[^\s,]+)*,|(?:https?|file|blob|wg-media|asset):\/\/)[^\s<>"'，。；）)]+/giu, "[媒体地址已隐藏]")
        .replace(/\b(?:sk|AIza)[-_][a-z\d_-]{8,}\b/giu, "[凭据已隐藏]")
        .replace(/\b(?:provider[-_]?secret|secret)[-_][a-z\d_-]{8,}\b/giu, "[凭据已隐藏]")
        .replace(/\bBearer\s+[^\s,;，。；]+/giu, "Bearer [凭据已隐藏]")
        .replace(/\b((?:api[_-]?key|access[_-]?token|authorization|password|secret)["']?\s*[=:：]\s*)["']?[^\s,;，。；"'}]+["']?/giu, "$1[凭据已隐藏]")
        .replace(/(?:[A-Z]:\\|\/)(?:[^\s<>"'，。；）)\/\\]+[\/\\])+[^\s<>"'，。；）)]+/gu, "[本机路径已隐藏]");
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value : "";
}
