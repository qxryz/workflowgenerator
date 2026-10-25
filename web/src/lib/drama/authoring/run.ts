import { DramaApiError, createRun, getRun, listChapters, submitProposal, updateRun } from "@/services/drama-api";
import { withWorkspaceActivity } from "@/services/workspace-activity";
import { requestZodicReply, type ZodicMessage } from "@/services/api/zodic";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useDramaRuns } from "@/stores/use-drama-runs";
import { CHECK_FAILED } from "../format.ts";
import type { DramaRun, DramaSnapshot, ProposalIssue, RunProposal, RunScope, RunStage } from "../types.ts";
import * as chapter from "./chapter.ts";
import type { Prompt, StageInput } from "./context.ts";
import * as episodes from "./episodes.ts";
import * as review from "./review.ts";
import * as script from "./script.ts";
import * as settings from "./settings.ts";
import * as shots from "./shots.ts";

const STAGES: Record<RunStage, { build: (input: StageInput) => Prompt; parse: (text: string) => RunProposal; maxOutputTokens: number }> = {
    chapter: { ...chapter, maxOutputTokens: 16000 },
    settings: { ...settings, maxOutputTokens: 16000 },
    episodes: { ...episodes, maxOutputTokens: 8192 },
    script: { ...script, maxOutputTokens: 12000 },
    shots: { ...shots, maxOutputTokens: 16000 },
    review: { ...review, maxOutputTokens: 8192 },
};
const STAGE_TITLE: Record<RunStage, string> = { chapter: "写章节", settings: "整理设定", episodes: "规划分集", script: "写剧本", shots: "拆分镜", review: "复核" };
const MAX_CORRECTIONS = 2;

export type StartRunOptions = {
    snapshot: DramaSnapshot;
    stage: RunStage;
    scope?: RunScope;
    episodeId?: string;
    instruction?: string;
    /** "channel::model" value; defaults to the configured text model. */
    model?: string;
    /** Revise this run's proposal instead of starting from scratch. */
    parentId?: string;
    /** Called when the run is registered and again when it settles, so callers can refresh their queries. */
    onChange?: () => void;
};

/** Creates the run and returns it right away; the model work continues in the background. `done` resolves with the final state. */
export async function startRun(options: StartRunOptions): Promise<{ run: DramaRun; done: Promise<DramaRun> }> {
    const { snapshot, stage, onChange } = options;
    const config = useConfigStore.getState().config;
    const model = options.model || config.textModel || config.model;
    const scope = stage === "chapter" && !options.scope?.ord ? { ...options.scope, ord: Math.max(0, ...snapshot.chapters.map((c) => c.ord)) + 1 } : (options.scope ?? {});
    // The snapshot lists chapters without bodies; the prompts read them.
    const full = { ...snapshot, chapters: await listChapters(snapshot.project.id) };
    const input: StageInput = { snapshot: full, scope, episodeId: options.episodeId, instruction: options.instruction?.trim() ?? "" };
    if (options.parentId) input.base = JSON.stringify((await getRun(options.parentId)).proposal ?? null);
    const prompt = STAGES[stage].build(input);

    const run = await createRun(snapshot.project.id, { stage, episodeId: options.episodeId, scope: input.scope, instruction: input.instruction, model, parentId: options.parentId });
    const controller = new AbortController();
    useDramaRuns.getState().start({ runId: run.id, dramaId: snapshot.project.id, episodeId: options.episodeId ?? null, stage, text: "", phase: "requesting", startedAt: Date.now(), abort: () => controller.abort() });
    onChange?.();

    const route = `/dramas/${snapshot.project.id}${options.episodeId ? `/episodes/${options.episodeId}` : ""}`;
    const activity = { id: `drama-run:${run.id}`, title: `${snapshot.project.title}·${STAGE_TITLE[stage]}`, status: "running" as const, route };
    const done = withWorkspaceActivity(activity, (setStatus) => execute(run.id, stage, { ...config, textModel: model }, prompt, controller.signal, setStatus))
        .finally(() => {
            useDramaRuns.getState().finish(run.id);
            onChange?.();
        });
    return { run, done };
}

async function execute(runId: string, stage: RunStage, config: AiConfig, prompt: Prompt, signal: AbortSignal, setStatus: (status: "saving") => void): Promise<DramaRun> {
    const runs = useDramaRuns.getState();
    const messages: ZodicMessage[] = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
    ];
    let output = "";
    let failure = "";
    /** Technical reasons of the last failed check, kept with the output for troubleshooting. */
    let details = "";
    try {
        for (let round = 0; round <= MAX_CORRECTIONS; round += 1) {
            runs.update(runId, { text: "", phase: round ? "correcting" : "requesting" });
            output = await requestZodicReply(config, messages, (text) => runs.update(runId, { text }), { tools: [], includeDefaultRole: false, signal, maxOutputTokens: STAGES[stage].maxOutputTokens });
            let problem: string;
            const parsed = parseOutput(stage, output);
            if ("error" in parsed) {
                problem = `输出格式无法解析：${parsed.error}`;
                failure = `${CHECK_FAILED}格式无法识别`;
                details = problem;
            } else {
                runs.update(runId, { phase: "saving" });
                setStatus("saving");
                await updateRun(runId, { output });
                try {
                    return await submitProposal(runId, parsed.proposal);
                } catch (error) {
                    if (!(error instanceof DramaApiError && error.status === 422 && error.issues.length)) throw error;
                    problem = issueList(error.issues);
                    failure = `${CHECK_FAILED}${plainReason(error.issues)}`;
                    details = problem;
                }
            }
            messages.push({ role: "assistant", content: output }, { role: "user", content: `只修正以下问题，并输出完整结果：\n${problem}` });
        }
        return await updateRun(runId, { output: details ? `${output}\n\n--- 检查结果 ---\n${details}` : output, status: "failed", error: failure });
    } catch (error) {
        if (signal.aborted) return updateRun(runId, { output: useDramaRuns.getState().runs[runId]?.text || output, status: "stopped" });
        return updateRun(runId, { output, status: "failed", error: error instanceof Error ? error.message : "任务失败，请重试" });
    }
}

function parseOutput(stage: RunStage, output: string): { proposal: RunProposal } | { error: string } {
    try {
        return { proposal: STAGES[stage].parse(output) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "无法解析" };
    }
}

/** The first issue in words a writer understands: messages that mention field names or codes become a generic line (the full list stays in the output). */
function plainReason(issues: ProposalIssue[]): string {
    const first = issues[0].message;
    return /[A-Za-z_#[\]]/.test(first) ? "有内容不符合要求" : first;
}

const issueList = (issues: ProposalIssue[]) =>
    issues
        .slice(0, 20)
        .map((issue) => `- ${issue.path}：${issue.message}`)
        .join("\n");
