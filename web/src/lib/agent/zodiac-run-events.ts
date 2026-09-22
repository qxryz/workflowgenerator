export type ZodiacRunStatus = "running" | "waiting" | "completed" | "stopped" | "error";
export type ZodiacRunPhaseStatus = "pending" | "active" | "done" | "error";

export type ZodiacRunPhase = {
    id: "context" | "plan" | "confirm";
    label: string;
    status: ZodiacRunPhaseStatus;
};

export type ZodiacRun = {
    status: ZodiacRunStatus;
    phases: ZodiacRunPhase[];
};

export function createZodiacRun(activeSkillCount = 0): ZodiacRun {
    return {
        status: "running",
        phases: [
            { id: "context", label: activeSkillCount ? `读取画布与 ${activeSkillCount} 个 Skills` : "读取画布上下文", status: "active" },
            { id: "plan", label: "组织方案", status: "pending" },
        ],
    };
}

export function markZodiacRunPlanning(run: ZodiacRun): ZodiacRun {
    if (run.status !== "running") return run;
    return {
        ...run,
        phases: run.phases.map((phase) => {
            if (phase.id === "context") return { ...phase, status: "done" };
            if (phase.id === "plan") return { ...phase, status: "active" };
            return phase;
        }),
    };
}

export function finishZodiacRun(run: ZodiacRun, waitingForConfirmation: boolean): ZodiacRun {
    const completed = run.phases
        .filter((phase) => phase.id !== "confirm")
        .map((phase) => ({ ...phase, status: "done" as const }));
    return waitingForConfirmation
        ? {
            status: "waiting",
            phases: [...completed, { id: "confirm", label: "等待你确认", status: "active" }],
        }
        : { status: "completed", phases: completed };
}

export function markZodiacRunApplying(run: ZodiacRun): ZodiacRun {
    return {
        status: "running",
        phases: run.phases.map((phase) => (phase.id === "confirm" ? { ...phase, label: "正在加入画布", status: "active" } : phase)),
    };
}

export function settleZodiacRun(run: ZodiacRun, decision: "applied" | "rejected" | "failed"): ZodiacRun {
    return {
        status: decision === "failed" ? "error" : "completed",
        phases: run.phases.map((phase) =>
            phase.id === "confirm"
                ? {
                      ...phase,
                      label: decision === "applied" ? "已加入画布" : decision === "failed" ? "这套方案还没完成" : "继续调整方案",
                      status: decision === "failed" ? "error" : "done",
                  }
                : phase,
        ),
    };
}

export function interruptZodiacRun(run: ZodiacRun, failed = false): ZodiacRun {
    let marked = false;
    return {
        status: failed ? "error" : "stopped",
        phases: run.phases.map((phase) => {
            if (!marked && phase.status === "active") {
                marked = true;
                return { ...phase, label: failed ? "处理失败" : "已停止", status: failed ? "error" : "done" };
            }
            return phase;
        }),
    };
}

/** Conversation progress is transient; settled turns are represented by their message or action card. */
export function shouldShowZodiacRun(run: ZodiacRun) {
    return run.status === "running";
}
