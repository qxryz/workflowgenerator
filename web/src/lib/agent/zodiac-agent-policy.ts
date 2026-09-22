import type { AiConfig } from "@/stores/use-config-store";

export type ZodiacAgentRole = "orchestrator" | "router" | "planner" | "executor";
export type ZodiacExecutionSource = { kind: "opencode" | "model"; config?: AiConfig };
export type ZodiacToolDefinition = { name: string; description: string; parameters: unknown };
export type ZodiacToolCatalog = readonly ZodiacToolDefinition[] | (() => readonly ZodiacToolDefinition[]);
export type ZodiacPolicyRequest = { callId: string; name: string; args: unknown };
export type ZodiacPolicyResult = { ok: true; result?: unknown } | { ok: false; error: string };
export type ZodiacRoleContext = {
    role: ZodiacAgentRole;
    taskId: string;
    rootSessionId: string;
    planId?: string;
    stageId?: string;
    source: ZodiacExecutionSource;
    signal?: AbortSignal;
    /** Issued by the application after a stage claim, never copied from model arguments. */
    approvedTools?: readonly string[];
};

const READ_TOOLS = new Set(["skill", "workflow", "hub_read", "hub_canvas_get_node", "hub_canvas_list_nodes", "hub_canvas_grep_text", "hub_canvas_read_text", "hub_plan_list", "hub_plan_get", "hub_list_capabilities", "hub_plugin_agent_describe"]);
const PLAN_TOOLS = ["hub_plan_write", "hub_plan_patch_stage", "hub_plan_replan"];
const MEDIA_TOOLS = ["hub_generate_image", "hub_generate_video", "hub_generate_audio", "hub_generate_music", "hub_video_edit"];
const CANVAS_WRITES = ["hub_canvas_write_node", "hub_canvas_apply_text_edits", "hub_canvas_group_nodes", "hub_canvas_group_recent_outputs", "hub_canvas_ungroup_node"];
const ORCHESTRATOR_TOOLS = new Set([...READ_TOOLS, ...PLAN_TOOLS, ...MEDIA_TOOLS, ...CANVAS_WRITES, "task", "zodiac-ui", "zodiac-ops", "hub_analyse_media", "hub_save_file_to_session", "hub_plugin_agent_invoke"]);
const PLANNER_TOOLS = new Set([...READ_TOOLS, ...PLAN_TOOLS, "zodiac-ui", "hub_analyse_media"]);
const ROUTER_TOOLS = new Set([...READ_TOOLS].filter((name) => name !== "hub_plan_list" && name !== "hub_plugin_agent_describe"));
const EXECUTOR_TOOLS = new Set([...READ_TOOLS, ...MEDIA_TOOLS, ...CANVAS_WRITES, "hub_analyse_media", "hub_plugin_agent_invoke"]);
const ROLE_LIMITS = { orchestrator: 64, router: 12, planner: 32, executor: 64 };

export function zodiacRoleAllowsTool(context: ZodiacRoleContext, name: string): boolean {
    if (context.role === "executor") return EXECUTOR_TOOLS.has(name) && !!context.planId && !!context.stageId && context.approvedTools?.includes(name) === true;
    return (context.role === "router" ? ROUTER_TOOLS : context.role === "planner" ? PLANNER_TOOLS : ORCHESTRATOR_TOOLS).has(name);
}

export function zodiacToolsForRole(context: ZodiacRoleContext, tools: readonly ZodiacToolDefinition[]) {
    return tools.filter((tool) => zodiacRoleAllowsTool(context, tool.name));
}

export function zodiacToolWaitsForUser(name: string, outcome: ZodiacPolicyResult): boolean {
    if (!outcome.ok) return false;
    const result = outcome.result as { waitingForUser?: unknown; status?: unknown } | undefined;
    return name === "zodiac-ui" || name === "zodiac-ops" || result?.waitingForUser === true || result?.status === "waiting_user";
}

export function throwIfZodiacAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function withZodiacAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
        void promise.catch(() => undefined);
        throwIfZodiacAborted(signal);
    }
    if (!signal) return promise;
    let cancel = () => undefined as void;
    const abort = new Promise<never>((_, reject) => {
        cancel = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", cancel, { once: true });
    });
    try {
        return await Promise.race([promise, abort]);
    } finally {
        signal.removeEventListener("abort", cancel);
    }
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, stableValue(item)]),
        );
    return value;
}

/** Each turn owns its guard: user-requested retries in a later turn remain possible. */
export function createZodiacToolDispatcher(options: {
    context: ZodiacRoleContext;
    tools: () => readonly ZodiacToolDefinition[];
    execute: (request: ZodiacPolicyRequest, context: ZodiacRoleContext) => Promise<ZodiacPolicyResult> | ZodiacPolicyResult;
    /** Metadata must come from the installed skill record, not tool output or skill prose. */
    skillTools?: (request: ZodiacPolicyRequest, context: ZodiacRoleContext) => readonly string[];
    maxCalls?: number;
    onLimit?: () => void;
}) {
    const { context } = options;
    const outcomes = new Map<string, Promise<ZodiacPolicyResult>>();
    const ids = new Map<string, string>();
    const grants = new Set<string>();
    let count = 0;
    let waiting = false;
    const maximum = Math.min(options.maxCalls ?? ROLE_LIMITS[context.role], ROLE_LIMITS[context.role]);
    const dispatch = async (request: ZodiacPolicyRequest): Promise<ZodiacPolicyResult> => {
        throwIfZodiacAborted(context.signal);
        if (waiting) return { ok: false, error: "正在等待用户确认，未执行后续操作。" };
        if (++count > maximum) {
            options.onLimit?.();
            throw new Error("本轮工具调用已达到上限，请缩小任务后重试。");
        }
        if (!zodiacRoleAllowsTool(context, request.name) || !options.tools().some((tool) => tool.name === request.name)) return { ok: false, error: `当前角色不允许调用工具「${request.name}」。` };
        if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) return { ok: false, error: "工具参数必须是对象。" };
        const args = request.args as Record<string, unknown>;
        if (context.planId && request.name.startsWith("hub_plan_") && typeof args.planId === "string" && args.planId !== context.planId) return { ok: false, error: "工具请求不属于当前计划。" };
        const fingerprint = `${request.name}:${JSON.stringify(stableValue(request.args))}`;
        const previous = ids.get(request.callId);
        if (previous && previous !== fingerprint) return { ok: false, error: "工具调用标识重复且参数不同，未执行。" };
        ids.set(request.callId, fingerprint);
        const mutation = !READ_TOOLS.has(request.name) && request.name !== "hub_analyse_media";
        if (mutation && outcomes.has(fingerprint)) return withZodiacAbort(outcomes.get(fingerprint)!, context.signal);
        const execute = async (): Promise<ZodiacPolicyResult> => {
            let outcome: ZodiacPolicyResult;
            try {
                outcome = await withZodiacAbort(Promise.resolve(options.execute(request, context)), context.signal);
            } catch (error) {
                throwIfZodiacAborted(context.signal);
                return { ok: false, error: error instanceof Error ? error.message : "工具执行失败" };
            }
            throwIfZodiacAborted(context.signal);
            if (request.name === "skill" && outcome.ok && (args.path === undefined || args.path === "SKILL.md")) {
                for (const name of options.skillTools?.(request, context) || []) if (zodiacRoleAllowsTool(context, name)) grants.add(name);
            }
            if (zodiacToolWaitsForUser(request.name, outcome)) waiting = true;
            return outcome;
        };
        const result = execute();
        if (mutation) outcomes.set(fingerprint, result);
        return result;
    };
    return {
        dispatch,
        get waitingForUser() {
            return waiting;
        },
        get grantedTools() {
            return [...grants];
        },
    };
}

export const ZODIAC_ROLE_PROMPTS: Record<ZodiacAgentRole, string> = {
    orchestrator:
        "你负责用户交互和创作调度。简单任务直接执行；涉及多阶段依赖的任务先 task(subagent_type=router)，再根据路由 task(subagent_type=planner)。计划先交用户审核，展示审核卡不代表已获批准；阶段执行和结果登记由应用完成。已审核的独立文件或脚本任务可以交给 executor；不能根据技能正文扩大权限。",
    router: '你是独立的只读任务路由器。只依据本次明确意图及引用判断 direct、workflow 或 ask；需要时用 workflow 读取可用流程。不得写画布、生成、创建计划或派发任务。不要假设继承了父会话。最终只返回 JSON：{"route":"direct|workflow|ask","workflowId":"选中的流程ID或省略","reason":"简短依据","question":"需要澄清时的问题"}。不得发明流程 ID、素材内容或路径。',
    planner:
        '你是独立的阶段规划器。只使用本次明确意图、引用和当前服务端计划合同。先按需读取 workflow，再用 hub_plan_write、hub_plan_patch_stage 或 hub_plan_replan 编写当前阶段；大纲可列后续阶段，但不要提前编写其工作项。真正正文写入 hub_canvas_write_node 工作项的 content，不得用标题、会话说明或未来占位替代。保留已完成前缀及稳定工作项 ID。不能生成媒体、执行工作项、批准计划、改运行状态或派发任务。计划标题、目标和审核清单只描述内容、效果与用户需要决定的事项，不展示 args、字段名、哈希或工具协议，也不沿用旧合同中的开发排错清单。计划写入成功后等待用户审核。最终只返回简短 JSON，包含 planId 和当前阶段摘要；有阻碍则返回 {"blocked":true,"reason":"原因"}。',
    executor: "你只执行应用已批准并领取的当前阶段工作项。严格使用给定工具、参数、引用与模型；不能创建或修改计划、确认审核、派发任务或扩充任务范围。复用已有成功结果，只处理明确的执行子集。工具回执之外不能宣称成功。",
};
