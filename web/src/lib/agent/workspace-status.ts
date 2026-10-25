export type WorkspaceWorkStatus = "running" | "generating" | "downloading" | "uploading" | "saving" | "exporting" | "syncing" | "waiting" | "attention";
export type WorkspaceActivity = { id: string; title: string; status: WorkspaceWorkStatus; route: string };

const priority: WorkspaceWorkStatus[] = ["waiting", "attention", "syncing", "exporting", "downloading", "uploading", "saving", "generating", "running"];
export const WORKSPACE_STATUS_LABELS: Record<WorkspaceWorkStatus, string> = {
    running: "进行中 {count}", generating: "生成中 {count}", downloading: "下载中 {count}", uploading: "上传中 {count}", saving: "保存中 {count}",
    exporting: "导出中 {count}", syncing: "同步中 {count}", waiting: "等待确认 {count}", attention: "待处理 {count}",
};

export function workspaceWorkStatus(work: Record<string, boolean | WorkspaceWorkStatus>): WorkspaceWorkStatus | undefined {
    const statuses = Object.values(work).filter(Boolean).map((status) => status === true ? "running" : status) as WorkspaceWorkStatus[];
    return priority.find((status) => statuses.includes(status));
}

export function workspaceWorkStatuses(work: Record<string, boolean | WorkspaceWorkStatus>): WorkspaceWorkStatus[] {
    // Agent/tool/chapter flags describe one execution. Canvas generation and DAG
    // work can run separately while that agent is waiting for approval.
    const { generation, workflow, ...execution } = work;
    const agent = workspaceWorkStatus(execution);
    const independent = [generation, workflow].filter(Boolean).map(status => status === true ? "running" : status) as WorkspaceWorkStatus[];
    return priority.filter(status => status === agent || independent.includes(status));
}

export function workspaceStatusCounts(statuses: WorkspaceWorkStatus[], pendingWrites = 0) {
    const counts = new Map<WorkspaceWorkStatus, number>();
    for (const status of statuses) counts.set(status, (counts.get(status) || 0) + 1);
    // Upload writes and an explicit saving phase already describe the ledger.
    if (pendingWrites && !counts.has("saving") && !counts.has("uploading")) counts.set("saving", 1);
    return priority.filter((status) => counts.has(status)).map((status) => ({ status, count: counts.get(status)! }));
}

export function workspaceStatusIsRunning(status: WorkspaceWorkStatus) {
    return status !== "waiting" && status !== "attention";
}
