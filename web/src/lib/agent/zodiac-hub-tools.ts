/**
 * Hub 工具在浏览器侧的执行体。
 *
 * 技能库里 84 个技能按 MiniMax Hub 的约定调用 `hub_*`。这些工具由当前宿主按严格契约执行，真正的动作都落到画布工作流。
 *
 * - 已接入的生成类（图片/视频/语音）复用画布既有的生成链路——新建 config 动作节点 +
 *   同类型结果槽节点 + 连线，然后交给工作流运行器。这样生成请求仍然经服务端 `/api/model/*`
 *   代理发出（浏览器不直连供应商），产物落盘、结果槽推进、失败回传都由现成代码负责。
 * - 读取类按需返回画布摘要或文本窗口；文本写入带版本前置条件，分组限定明确节点或本轮产物。
 * - hub_analyse_media 走应用已有的视觉通道。
 * - hub_save_file_to_session 会把正文或画布产物交给当前应用的会话存储；直接模型模式下由宿主决定落盘方式，失败会明确回传。
 *
 * 任何一步失败都返回 ok:false + 中文原因（它会作为工具错误回到模型），不做静默降级。
 */
// 相对路径导入：`@/` 别名由 tests/alias-loader.mjs 在测试时解析。
// 运行时值只依赖 canvas-input-bindings（无任何 import，因此能在 --experimental-strip-types 下加载）；
// 其余模块只取类型（type import 会被剥离，不会把 TypeScript enum 拖进来）。
import { canvasTextHash, textOutline, readCanvasText, grepCanvasText, applyAnchoredCanvasEdits, type CanvasTextEdit } from "../canvas/canvas-text-tools.ts";
import { builtinCanvasResourceKind, isReadyCanvasResourceValue } from "../canvas/canvas-input-bindings.ts";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "../canvas/canvas-agent-ops.ts";
import type { WorkflowExecutionMode, WorkflowRunSnapshot } from "../canvas/workflow-execution.ts";
import type { CanvasGenerationMode, CanvasNodeData } from "../../types/canvas.ts";

/** 与 Zodiac transport 的工具结果同形；这里单独声明避免服务层反向依赖组件。 */
export type HubToolOutcome = { ok: true; result: unknown } | { ok: false; error: string; requiresReconciliation?: true; nodeId?: string; actionNodeId?: string };

export type HubToolRequest = {
    callId: string;
    name: string;
    /** 当前宿主归一化后的对象；这里仍把它当作不可信输入处理。 */
    args: unknown;
};

export type HubExecutorContext = {
    sessionId?: string;
    turnId?: string;
    operationNamespace?: string;
    resolveMediaUrl?: (node: CanvasNodeData) => Promise<string | null>;
    getSnapshot: () => CanvasAgentSnapshot;
    /** 画布桥接层的 applyOps 本身是异步的（要等结构提交），这里保持同一签名。 */
    applyOps: (ops: CanvasAgentOp[]) => Promise<CanvasAgentSnapshot>;
    runWorkflow: (startNodeIds: string[] | undefined, mode: WorkflowExecutionMode, signal?: AbortSignal) => Promise<WorkflowRunSnapshot<unknown>>;
    /** 会话产物保存回当前应用服务端的受控接口。 */
    saveSessionFile: (input: { path: string; content?: string; storageKey?: string; description?: string }) => Promise<{ path: string; bytes: number }>;
    /** 把一张画布图片交给应用已有的视觉能力，返回文字描述。 */
    analyseImage: (input: { dataUrl: string; question?: string }) => Promise<string>;
    /** 读取一个画布图片节点的 data URL；读不到时返回 null（不抛）。 */
    readImageDataUrl: (nodeId: string) => Promise<string | null>;
    signal?: AbortSignal;
};

type HubArgs = Record<string, unknown>;

const GENERATION_MODES: Record<string, CanvasGenerationMode> = {
    hub_generate_image: "image",
    hub_generate_video: "video",
    hub_generate_audio: "audio",
};

/** 结果槽节点类型：与画布既有约定一致（产物类型直接作为 nodeType）。 */
const SLOT_TYPE: Record<CanvasGenerationMode, string> = { text: "text", image: "image", video: "video", audio: "audio" };

function asArgs(value: unknown): HubArgs {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as HubArgs) : {};
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 把模型给的 references 翻成画布节点 id；节点不存在就直接失败，不悄悄丢掉素材。 */
function referenceNodeIds(args: HubArgs, field: string): string[] {
    if (args[field] === undefined) return [];
    if (!Array.isArray(args[field])) throw new Error(`${field} 必须是素材数组`);
    return args[field].map((entry, index) => {
        const nodeId = str(asArgs(entry).nodeId);
        if (!nodeId) throw new Error(`${field}[${index}] 缺少有效 nodeId，未忽略任何引用`);
        return nodeId;
    });
}

function singleReference(args: HubArgs, field: string): string | undefined {
    return str((args[field] as HubArgs | undefined)?.nodeId);
}

function nodeById(snapshot: CanvasAgentSnapshot, nodeId: string) {
    return snapshot.nodes.find((node) => node.id === nodeId);
}

/**
 * 一个节点能否作为生成输入。口径与画布一致：内置资源类型（image/video/audio/text/file）
 * 且内容已就绪。插件节点需要注册表定义才能判定，这里按「不是内置资源」处理——插件节点
 * 作为参考素材时由画布自身的引用校验兜底，不在这里放宽。
 */
function canvasResourceReady(node: CanvasNodeData) {
    const kind = builtinCanvasResourceKind(node.type);
    if (!kind) return false;
    const resultSlotState = node.metadata?.role === "result-slot" ? node.metadata?.slotState : undefined;
    const value = kind === "text" ? node.metadata?.content : node.metadata?.storageKey || node.metadata?.content;
    return isReadyCanvasResourceValue(node.metadata?.status, value, resultSlotState);
}

/**
 * 生成类工具的统一执行：建动作节点与结果槽、连线、触发运行器，最后把产物位置回报给模型。
 * 用画布既有链路而不是在浏览器里另写一遍请求，保证「产物落盘 + 结果槽状态 + 失败回传」
 * 与手动点画布完全一致。
 */
async function runGeneration(context: HubExecutorContext, name: string, args: HubArgs, operation: OperationIdentity): Promise<HubToolOutcome> {
    context.signal?.throwIfAborted();
    const mode = GENERATION_MODES[name];
    if (!mode) return { ok: false, error: `不支持的生成工具：${name}` };
    const prompt = str(args.prompt) ?? str(args.text);
    if (!prompt) return { ok: false, error: `${name} 缺少 prompt（音频工具用 text），请把技能里写好的成稿原样传入。` };

    const snapshot = context.getSnapshot();
    const referenceIds = [...new Set([...referenceNodeIds(args, "references"), ...referenceNodeIds(args, "videoReferences"), ...referenceNodeIds(args, "audioReferences")])];
    const missing = referenceIds.filter((nodeId) => !nodeById(snapshot, nodeId));
    if (missing.length) {
        return { ok: false, error: `这些参考素材不在当前画布上：${missing.join("、")}。请先用 hub_canvas_get_node 或 hub_canvas_list_nodes 确认可用的节点 id。` };
    }
    for (const nodeId of referenceIds) {
        const node = nodeById(snapshot, nodeId)!;
        // 只有「可作为输入且已就绪」的素材才能进生成：未就绪、不是资源节点都明确失败，
        // 不静默删除或截断引用素材。
        if (!canvasResourceReady(node)) {
            return { ok: false, error: `参考素材 ${nodeId} 还不能作为生成输入（不是资源节点，或内容还没准备好）。请先让上游生成完成。` };
        }
    }

    const actionId = `${mode}-action-${operation.id}`;
    const slotId = `${mode}-result-${operation.id}`;
    const existing = nodeById(context.getSnapshot(), actionId);
    if (existing && existing.metadata?.agentOperationFingerprint !== operation.fingerprint) throw new Error("operationId 已用于不同参数，请为新操作使用新的 ID");
    const ready = nodeById(context.getSnapshot(), slotId);
    if (ready && canvasResourceReady(ready) && ready.metadata?.storageKey) return { ok: true, result: await outputReceipt(ready, context, operation, actionId) };
    if (existing && ["loading", "running", "generating"].includes(String(existing.metadata?.status))) return { ok: false, error: "此操作仍在运行，请先核对真实状态，不要重复提交", requiresReconciliation: true, nodeId: slotId, actionNodeId: actionId };
    const metadata: Record<string, unknown> = { generationMode: mode, prompt, status: "idle", ...operation.metadata };
    const model = str(args.model);
    if (model) metadata.model = model;
    const size = str(args.size);
    if (size) metadata.size = size;
    const count = num(args.count);
    if (count) metadata.count = count;
    const seconds = num(args.seconds);
    if (seconds) metadata.seconds = String(seconds);
    const voice = str(args.voice);
    if (voice) metadata.audioVoice = voice;
    const speed = num(args.speed);
    if (speed) metadata.audioSpeed = String(speed);
    for (const [field, target] of Object.entries({
        quality: "quality",
        background: "background",
        imageWatermark: "imageWatermark",
        imageOptimizePrompt: "imageOptimizePrompt",
        imagePromptPrefix: "imagePromptPrefix",
        vquality: "vquality",
        generateAudio: "generateAudio",
        watermark: "watermark",
        format: "audioFormat",
        instructions: "audioInstructions",
    })) {
        if (args[field] === undefined) continue;
        if (typeof args[field] !== "string") throw new Error(`${field} 必须是字符串`);
        metadata[target] = args[field];
    }

    const ops: CanvasAgentOp[] = [
        { type: "add_node", id: actionId, nodeType: "config", title: prompt.slice(0, 40), metadata },
        { type: "add_node", id: slotId, nodeType: SLOT_TYPE[mode], title: `${mode} 结果槽`, metadata: operation.metadata },
        { type: "connect_nodes", fromNodeId: actionId, toNodeId: slotId },
        ...referenceIds.map((fromNodeId): CanvasAgentOp => ({ type: "connect_nodes", fromNodeId, toNodeId: actionId })),
    ];

    try {
        if (!existing) await context.applyOps(ops);
        if (referenceIds.some((id) => !context.getSnapshot().connections.some((edge) => edge.fromNodeId === id && edge.toNodeId === actionId))) throw new Error("参考素材连线未完整保存，未开始生成");
    } catch (error) {
        return { ok: false, error: `把生成动作加到画布时失败：${error instanceof Error ? error.message : String(error)}` };
    }

    // 走运行器：与手动运行同一条链路（含产物落盘与结果槽推进）。失败要把原因原样带回去。
    let run: WorkflowRunSnapshot<unknown>;
    let submitted = false;
    try {
        context.signal?.throwIfAborted();
        submitted = true;
        run = await context.runWorkflow([actionId], "guided", context.signal);
        context.signal?.throwIfAborted();
    } catch (error) {
        return { ok: false, error: `生成状态需要核对：${error instanceof Error ? error.message : String(error)}`, ...(submitted ? { requiresReconciliation: true as const, nodeId: slotId, actionNodeId: actionId } : {}) };
    }
    if (run.status === "error") {
        const failed = run.nodes.find((node) => node.status === "error");
        // The runner also reports transport and persistence failures as "error".
        // It does not expose proof that a remote submission never happened.
        return { ok: false, error: `生成状态需要核对：${failed?.error?.message || "执行或保存未完成核对，请检查画布中的运行状态。"}`, requiresReconciliation: true, nodeId: slotId, actionNodeId: actionId };
    }
    if (run.status === "stopped") return { ok: false, error: "生成已停止等待；远程任务状态仍需核对，不能直接重试。", requiresReconciliation: true, nodeId: slotId, actionNodeId: actionId };

    try {
        const produced = context.getSnapshot().nodes.find((node) => node.id === slotId);
        if (!produced || !canvasResourceReady(produced) || !produced.metadata?.storageKey) {
            return { ok: false, error: "生成尚未核对到已保存的产物，请检查画布中的运行状态，不要直接重试。", requiresReconciliation: true, nodeId: slotId, actionNodeId: actionId };
        }
        return { ok: true, result: await outputReceipt(produced, context, operation, actionId) };
    } catch (error) {
        return { ok: false, error: `生成回执未核对完成：${error instanceof Error ? error.message : String(error)}`, requiresReconciliation: true, nodeId: slotId, actionNodeId: actionId };
    }
}

/** 读取类工具：只读画布快照，不碰生成。 */
function readNode(snapshot: CanvasAgentSnapshot, nodeId: string) {
    const node = nodeById(snapshot, nodeId);
    if (!node) return { ok: false as const, error: `画布上没有节点 ${nodeId}；可用 id 见本轮快照。` };
    return { ok: true as const, node };
}

async function nodePayload(node: CanvasNodeData, snapshot: CanvasAgentSnapshot, context: HubExecutorContext) {
    const content = node.metadata?.content ?? "";
    return {
        nodeId: node.id,
        type: node.type,
        title: node.title,
        position: node.position,
        status: node.metadata?.status ?? null,
        content: content.length <= 6000 ? content : null,
        ...(node.type === "text" ? { contentHash: await canvasTextHash(content), totalChars: content.length, totalLines: content.split("\n").length, preview: content.slice(0, 600), outline: textOutline(content) } : {}),
        prompt: node.metadata?.prompt ?? null,
        model: node.metadata?.model ?? null,
        storageKey: node.metadata?.storageKey ?? null,
        url: node.metadata?.storageKey && context.resolveMediaUrl ? await context.resolveMediaUrl(node) : null,
        upstream: snapshot.connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.fromNodeId),
        downstream: snapshot.connections.filter((connection) => connection.fromNodeId === node.id).map((connection) => connection.toNodeId),
    };
}

const inFlightGenerations = new Map<string, { fingerprint: string; promise: Promise<HubToolOutcome> }>();

export async function executeHubTool(request: HubToolRequest, context: HubExecutorContext): Promise<HubToolOutcome> {
    context.signal?.throwIfAborted();
    try {
        if (!GENERATION_MODES[request.name]) return await executeHubToolUnsafe(request, context);
        const operation = await operationIdentity(request, context);
        const pending = inFlightGenerations.get(operation.id);
        if (pending) {
            if (pending.fingerprint !== operation.fingerprint) throw new Error("operationId 正在用于不同参数");
            return await pending.promise;
        }
        const promise = runGeneration(context, request.name, asArgs(request.args), operation);
        inFlightGenerations.set(operation.id, { fingerprint: operation.fingerprint, promise });
        try {
            return await promise;
        } finally {
            inFlightGenerations.delete(operation.id);
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function executeHubToolUnsafe(request: HubToolRequest, context: HubExecutorContext): Promise<HubToolOutcome> {
    context.signal?.throwIfAborted();
    const args = asArgs(request.args);

    if (request.name === "hub_generate_music") {
        return { ok: false, error: "此工具尚未接入音乐生成，不能使用语音合成替代。" };
    }
    if (CANVAS_TOOLS.includes(request.name)) return executeCanvasTool(request, context, args);

    if (request.name === "hub_video_edit") {
        return { ok: false, error: "此工具尚未接入视频编辑或延长，请在视频工作台选择对应任务；不会改为生成新视频。" };
    }

    if (request.name === "hub_read" || request.name === "hub_canvas_get_node") {
        const nodeId = str(args.nodeId);
        if (!nodeId) return { ok: false, error: `${request.name} 需要 nodeId。` };
        const hit = readNode(context.getSnapshot(), nodeId);
        if (!hit.ok) return { ok: false, error: hit.error };
        return { ok: true, result: await nodePayload(hit.node, context.getSnapshot(), context) };
    }

    if (request.name === "hub_analyse_media") {
        const nodeId = singleReference(args, "asset") ?? str((args.asset as HubArgs | undefined)?.nodeId);
        if (!nodeId) return { ok: false, error: "hub_analyse_media 需要一个 asset.nodeId。" };
        const hit = readNode(context.getSnapshot(), nodeId);
        if (!hit.ok) return { ok: false, error: hit.error };
        const dataUrl = await context.readImageDataUrl(nodeId);
        context.signal?.throwIfAborted();
        // 读不到就明确失败：没看过画面就不允许声称看过（与视觉快照的契约一致）。
        if (!dataUrl) return { ok: false, error: `读不到节点 ${nodeId} 的画面内容（可能还没生成完、不是图片，或读取失败），不能对它做分析。` };
        try {
            const description = await context.analyseImage({ dataUrl, question: str(args.question) });
            context.signal?.throwIfAborted();
            return { ok: true, result: { nodeId, description } };
        } catch (error) {
            return { ok: false, error: `分析画面失败：${error instanceof Error ? error.message : String(error)}` };
        }
    }

    if (request.name === "hub_save_file_to_session") {
        const path = str(args.path);
        if (!path) return { ok: false, error: "hub_save_file_to_session 需要 path（会话内的相对文件名）。" };
        const content = typeof args.content === "string" ? args.content : undefined;
        const assetNodeId = singleReference(args, "asset");
        if (content === undefined && !assetNodeId) return { ok: false, error: "hub_save_file_to_session 需要 content（写文本）或 asset（落盘画布产物）之一。" };
        let storageKey: string | undefined;
        if (assetNodeId) {
            const hit = readNode(context.getSnapshot(), assetNodeId);
            if (!hit.ok) return { ok: false, error: hit.error };
            storageKey = str(hit.node.metadata?.storageKey);
            if (!storageKey) return { ok: false, error: `节点 ${assetNodeId} 还没有产物可以落盘。` };
        }
        try {
            const saved = await context.saveSessionFile({ path, content, storageKey, description: str(args.description) });
            context.signal?.throwIfAborted();
            return {
                ok: true,
                result: {
                    path: saved.path,
                    bytes: saved.bytes,
                    note: "文件已写入本会话工作目录；后续只使用返回的会话相对路径，不要向用户展示或复制宿主机绝对路径。",
                },
            };
        } catch (error) {
            return { ok: false, error: `保存到会话目录失败：${error instanceof Error ? error.message : String(error)}` };
        }
    }

    return { ok: false, error: `Zodiac 内核请求了还不支持的工具「${request.name}」，请用文字说明你的方案或换一个工具。` };
}

type OperationIdentity = {
    id: string;
    key: string;
    fingerprint: string;
    metadata: { agentSessionId?: string; agentTurnId?: string; agentOperationId: string; agentOperationFingerprint: string };
};

async function operationIdentity(request: HubToolRequest, context: HubExecutorContext): Promise<OperationIdentity> {
    const args = asArgs(request.args);
    const key = str(args.operationId) ?? request.callId;
    if (!key || key.length > 200) throw new Error("operationId 无效");
    const namespace = context.operationNamespace ?? context.sessionId ?? context.getSnapshot().projectId;
    const id = (await canvasTextHash(`${context.getSnapshot().projectId}\n${namespace}\n${key}`)).slice(0, 32);
    const canonical = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(canonical)
            : value && typeof value === "object"
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, item]) => [name, canonical(item)]),
                )
              : value;
    const fingerprint = await canvasTextHash(JSON.stringify([request.name, canonical(args)]));
    return { id, key, fingerprint, metadata: { agentSessionId: context.sessionId, agentTurnId: context.turnId, agentOperationId: key, agentOperationFingerprint: fingerprint } };
}

async function outputReceipt(node: CanvasNodeData, context: HubExecutorContext, operation: OperationIdentity, actionNodeId?: string) {
    // A preview lookup cannot invalidate a durable output or justify another paid run.
    let url: string | null = null;
    if (node.metadata?.storageKey && context.resolveMediaUrl) {
        try {
            url = await context.resolveMediaUrl(node);
        } catch {
            /* The receipt still identifies the saved artifact. */
        }
    }
    return {
        nodeId: node.id,
        kind: node.type,
        operationId: operation.key,
        actionNodeId,
        status: node.metadata?.status ?? "success",
        ...(node.type === "text" ? { contentHash: await canvasTextHash(node.metadata?.content ?? "") } : {}),
        ...(node.metadata?.storageKey ? { storageKey: node.metadata.storageKey, resultVersionId: node.metadata.currentResultVersionId, url } : {}),
    };
}

const CANVAS_TOOLS = ["hub_canvas_list_nodes", "hub_canvas_grep_text", "hub_canvas_read_text", "hub_canvas_write_node", "hub_canvas_apply_text_edits", "hub_canvas_group_nodes", "hub_canvas_group_recent_outputs", "hub_canvas_ungroup_node"];

async function executeCanvasTool(request: HubToolRequest, context: HubExecutorContext, args: HubArgs): Promise<HubToolOutcome> {
    let snapshot = context.getSnapshot();
    const success = (result: unknown): HubToolOutcome => ({ ok: true, result });
    if (request.name === "hub_canvas_list_nodes") {
        const limit = num(args.limit) ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit 必须在 1–50 之间");
        const nodes = snapshot.nodes.filter((node) => (!str(args.type) || node.type === args.type) && (!str(args.groupId) || node.metadata?.groupId === args.groupId));
        const cursor = str(args.cursor);
        const found = cursor ? nodes.findIndex((node) => node.id === cursor) : -1;
        if (cursor && found < 0) throw new Error("分页位置已失效，请从第一页重新读取");
        const page = nodes.slice(found + 1, found + 1 + limit);
        return success({
            nodes: page.map((node) => ({ nodeId: node.id, type: node.type, title: node.title.slice(0, 160), groupId: node.metadata?.groupId ?? null, status: node.metadata?.status ?? null, preview: (node.metadata?.content ?? "").slice(0, 120) })),
            total: nodes.length,
            nextCursor: found + 1 + page.length < nodes.length ? page.at(-1)?.id : null,
        });
    }
    if (request.name === "hub_canvas_read_text" || request.name === "hub_canvas_grep_text") {
        const node = nodeById(snapshot, str(args.nodeId) ?? "");
        if (!node || node.type !== "text") throw new Error("请指定存在的文本节点");
        const content = node.metadata?.content ?? "";
        const contentHash = await canvasTextHash(content);
        if (request.name === "hub_canvas_read_text") return success({ nodeId: node.id, contentHash, ...readCanvasText(content, num(args.offsetLine) ?? 1, num(args.limitLines) ?? 100) });
        if (args.regex === true) throw new Error("当前搜索仅支持字面量，不支持正则表达式");
        return success({ nodeId: node.id, contentHash, ...grepCanvasText(content, typeof args.query === "string" ? args.query : "", num(args.maxMatches) ?? 20) });
    }
    const operation = await operationIdentity(request, context);
    context.signal?.throwIfAborted();
    snapshot = context.getSnapshot();
    if (request.name === "hub_canvas_write_node" || request.name === "hub_canvas_apply_text_edits") {
        if (args.kind !== undefined && args.kind !== "text") throw new Error("此写入工具只支持文本节点；媒体由生成和资产入口登记");
        const nodeId = str(args.nodeId);
        const targetId = nodeId ?? `text-${operation.id}`;
        const current = nodeById(context.getSnapshot(), targetId);
        if (nodeId && (!current || current.type !== "text")) throw new Error("请指定存在的文本节点");
        if (request.name === "hub_canvas_apply_text_edits" && !nodeId) throw new Error("局部编辑需要 nodeId");
        if (current && current.metadata?.agentOperationFingerprint === operation.fingerprint) {
            if (!current.metadata.agentOutputHash || current.metadata.agentOutputHash !== (await canvasTextHash(current.metadata.content ?? ""))) throw new Error("上次操作后的正文已改变，请重新读取");
            return success(await outputReceipt(current, context, operation));
        }
        if (!nodeId && current) throw new Error("operationId 已用于不同正文，请使用新的 ID");
        const previous = current?.metadata?.content ?? "";
        if (current && (typeof args.expectedContentHash !== "string" || args.expectedContentHash !== (await canvasTextHash(previous)))) throw new Error("文本版本冲突：expectedContentHash 缺失或已过期，请重新读取");
        let content: string;
        if (request.name === "hub_canvas_apply_text_edits") content = applyAnchoredCanvasEdits(previous, args.edits as CanvasTextEdit[]);
        else {
            if (typeof args.content !== "string" || args.content.length > 200000) throw new Error("必须提供完整 content，最多 200000 字符");
            const mode = str(args.mode) ?? "replace";
            if (!["replace", "append", "prepend"].includes(mode) || (!current && mode !== "replace")) throw new Error("文本写入 mode 无效");
            content = mode === "append" ? previous + args.content : mode === "prepend" ? args.content + previous : args.content;
            if (content.length > 200000) throw new Error("文本正文不能超过 200000 字符");
        }
        const sourceIds = args.sourceNodeIds === undefined ? [] : args.sourceNodeIds;
        if (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== "string" || !nodeById(context.getSnapshot(), id))) throw new Error("sourceNodeIds 含失效引用，未写入正文");
        const title = str(args.name) ?? str(args.title);
        const agentOutputHash = await canvasTextHash(content);
        context.signal?.throwIfAborted();
        const ops: CanvasAgentOp[] = current
            ? [{ type: "update_node", id: current.id, expectedContent: previous, ...(title ? { patch: { title } } : {}), metadata: { content, agentOutputHash, ...operation.metadata } }]
            : [{ type: "add_node", id: targetId, nodeType: "text", title: title ?? "文档", metadata: { content, agentOutputHash, status: "success", ...operation.metadata } }];
        for (const source of new Set(sourceIds as string[])) ops.push({ type: "connect_nodes", fromNodeId: source, toNodeId: targetId });
        const saved = await context.applyOps(ops);
        const node = nodeById(saved, targetId);
        if (!node || node.metadata?.content !== content) throw new Error("正文写入后读回不一致");
        if ((sourceIds as string[]).some((id) => !saved.connections.some((edge) => edge.fromNodeId === id && edge.toNodeId === targetId))) throw new Error("正文的来源连线未完整保存");
        return success(await outputReceipt(node, context, operation));
    }
    if (request.name === "hub_canvas_ungroup_node") {
        const group = nodeById(snapshot, str(args.nodeId) ?? "");
        if (!group || group.type !== "group") throw new Error("请指定存在的分组节点");
        const children = snapshot.nodes.filter((node) => node.metadata?.groupId === group.id);
        const ops: CanvasAgentOp[] = children.map((node) => ({ type: "update_node", id: node.id, metadata: { groupId: group.metadata?.groupId } }));
        // Detach before deleting: the common delete operation intentionally removes descendants.
        ops.push({ type: "delete_node", id: group.id });
        const saved = await context.applyOps(ops);
        if (children.some((node) => !nodeById(saved, node.id))) throw new Error("解组后成员校验失败");
        return success({ removedGroupId: group.id, nodeIds: children.map((node) => node.id) });
    }
    const existingGroup = nodeById(context.getSnapshot(), `group-${operation.id}`);
    if (existingGroup) {
        if (existingGroup.type !== "group" || existingGroup.metadata?.agentOperationFingerprint !== operation.fingerprint) throw new Error("operationId 已用于不同分组");
        const members = context.getSnapshot().nodes.filter((node) => node.metadata?.groupId === existingGroup.id);
        return success({ groupId: existingGroup.id, groupedCount: members.length, nodeIds: members.map((node) => node.id) });
    }
    let ids: string[];
    if (request.name === "hub_canvas_group_recent_outputs") {
        if (!context.sessionId || !context.turnId) return success({ groupId: null, groupedCount: 0, reason: "no-session-scope" });
        ids = snapshot.nodes.filter((node) => node.metadata?.agentSessionId === context.sessionId && node.metadata?.agentTurnId === context.turnId && !node.metadata?.groupId && canvasResourceReady(node)).map((node) => node.id);
    } else {
        if (!Array.isArray(args.nodeIds) || args.nodeIds.length > 100 || args.nodeIds.some((id) => typeof id !== "string" || !nodeById(snapshot, id))) throw new Error("nodeIds 必须包含 1–100 个有效节点 ID");
        ids = [...new Set(args.nodeIds as string[])];
    }
    if (ids.length < 2) return success({ groupId: null, groupedCount: 0, reason: "insufficient-candidates" });
    const selected = ids.map((id) => nodeById(snapshot, id)!);
    if (selected.some((node) => node.metadata?.groupId && !ids.includes(node.metadata.groupId))) throw new Error("节点已经属于其他分组，请先解组或选择整个分组");
    const groups = selected.filter((node) => node.type === "group");
    if (groups.some((node) => node.metadata?.groupId)) throw new Error("合并分组前请先将嵌套分组解组");
    const groupId = groups[0]?.id ?? `group-${operation.id}`;
    const members = [...new Map(selected.flatMap((node) => (node.type === "group" ? snapshot.nodes.filter((child) => child.metadata?.groupId === node.id) : [node])).map((node) => [node.id, node])).values()];
    if (members.length < 2) return success({ groupId: null, groupedCount: 0, reason: "insufficient-candidates" });
    const left = Math.min(...members.map((node) => node.position.x)) - 24;
    const top = Math.min(...members.map((node) => node.position.y)) - 48;
    const width = Math.max(...members.map((node) => node.position.x + node.width)) - left + 24;
    const height = Math.max(...members.map((node) => node.position.y + node.height)) - top + 24;
    const ops: CanvasAgentOp[] = groups.length ? [] : [{ type: "add_node", id: groupId, nodeType: "group", title: (str(args.label) ?? "分组").slice(0, 40), position: { x: left, y: top }, width, height, metadata: operation.metadata }];
    if (groups.length) ops.push({ type: "update_node", id: groupId, patch: { position: { x: left, y: top }, width, height } });
    for (const node of members) ops.push({ type: "update_node", id: node.id, ...(groups.length ? { patch: { position: node.position } } : {}), metadata: { groupId } });
    for (const group of groups.slice(1)) ops.push({ type: "delete_node", id: group.id });
    await context.applyOps(ops);
    return success({ groupId, groupedCount: members.length, nodeIds: members.map((node) => node.id) });
}

/** 判断一个工具名是否属于浏览器侧执行集（其余直接拒绝或交给宿主桥接）。 */
export const HUB_TOOL_EXECUTION_NAMES = ["hub_generate_image", "hub_generate_video", "hub_generate_audio", "hub_generate_music", "hub_video_edit", "hub_analyse_media", "hub_read", "hub_canvas_get_node", ...CANVAS_TOOLS, "hub_save_file_to_session"];
