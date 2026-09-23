import roleSource from "./zodiac-roles.json" with { type: "json" };
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
    turnId?: string;
    nativeCallId?: string;
    planId?: string;
    stageId?: string;
    source: ZodiacExecutionSource;
    signal?: AbortSignal;
    /** Issued by the application after a stage claim, never copied from model arguments. */
    approvedTools?: readonly string[];
};

const READ_TOOLS = new Set(["skill", "workflow", "hub_read", "hub_canvas_get_node", "hub_canvas_list_nodes", "hub_canvas_grep_text", "hub_canvas_read_text", "hub_plan_list", "hub_plan_get", "hub_list_capabilities", "hub_plugin_agent_describe"]);
const EXECUTOR_TOOLS = new Set(["hub_canvas_write_node", "hub_generate_image", "hub_generate_video", "hub_generate_audio"]);

export function zodiacRoleAllowsTool(context: ZodiacRoleContext, name: string): boolean {
    if (context.role === "executor" && context.planId && context.stageId) return EXECUTOR_TOOLS.has(name) && context.approvedTools?.includes(name) === true;
    const tools: readonly string[] = roleSource.roles[context.role].appTools;
    return tools.includes("*") || tools.includes(name);
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
    const maximum = Math.min(options.maxCalls ?? roleSource.roles[context.role].maxCalls, roleSource.roles[context.role].maxCalls);
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
