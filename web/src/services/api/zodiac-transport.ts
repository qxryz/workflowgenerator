import { runOpenCodeTurn } from "./opencode-runtime.ts";
import type { ZodicMessage } from "@/services/api/zodic";
import { throwIfZodiacAborted, type ZodiacExecutionSource, type ZodiacRoleContext, type ZodiacToolCatalog, type ZodiacToolDefinition } from "@/lib/agent/zodiac-agent-policy";
import type { ZodiacActivityEvent } from "@/lib/agent/zodiac-activity";
export type ZodiacToolRequest = { callId: string; name: string; args: unknown };
export type ZodiacToolResult = { ok: true; result?: unknown } | { ok: false; error: string };
export type { ZodiacExecutionSource, ZodiacRoleContext } from "@/lib/agent/zodiac-agent-policy";
export async function resolveZodiacExecutionSource(): Promise<ZodiacExecutionSource> {
    return { kind: "opencode" };
}

export type ZodiacTurnOptions = {
    sessionId: string;
    projectId?: string;
    turnId?: string;
    assets?: import("@/lib/agent/zodiac-assets").ZodiacWorkspaceAsset[];
    onPermissionRequest?: (request: ZodiacToolRequest) => Promise<boolean>;
    source?: ZodiacExecutionSource;
    tools?: ZodiacToolCatalog;
    skillToolCatalog?: readonly ZodiacToolDefinition[];
    skillTools?: (request: ZodiacToolRequest, context: ZodiacRoleContext) => readonly string[];
    text: string;
    messages?: ZodicMessage[];
    skills?: unknown;
    onDelta?: (text: string) => void;
    onReasoning?: (text: string) => void;
    onActivity?: (event: ZodiacActivityEvent) => void;
    onToolRequest?: (request: ZodiacToolRequest, context: ZodiacRoleContext) => Promise<ZodiacToolResult> | ZodiacToolResult;
    signal?: AbortSignal;
    maxToolRounds?: number;
};

export async function runZodiacTurn(options: ZodiacTurnOptions) {
    throwIfZodiacAborted(options.signal);
    if (!options.projectId) throw new Error("请先打开工作流，再开始对话。");
    return runOpenCodeTurn(options);
}
