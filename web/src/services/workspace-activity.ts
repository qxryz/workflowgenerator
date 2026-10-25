import { useAgentStore } from "@/stores/use-agent-store";
import type { WorkspaceActivity, WorkspaceWorkStatus } from "@/lib/agent/workspace-status";

const owners = new Map<string, symbol>();

export function setWorkspaceActivity(activity: WorkspaceActivity) {
    owners.delete(activity.id);
    useAgentStore.getState().setActivity(activity);
}

export function clearWorkspaceActivity(id: string) {
    owners.delete(id);
    useAgentStore.getState().clearActivity(id);
}

/** The promise owns its activity across navigation; an old completion cannot
 * clear a newer operation that happens to reuse the same identity. */
export async function withWorkspaceActivity<T>(activity: WorkspaceActivity, operation: (update: (status: WorkspaceWorkStatus) => void) => Promise<T>): Promise<T> {
    const owner = Symbol(activity.id);
    owners.set(activity.id, owner);
    useAgentStore.getState().setActivity(activity);
    try {
        return await operation((status) => {
            if (owners.get(activity.id) === owner) useAgentStore.getState().setActivity({ ...activity, status });
        });
    } finally {
        if (owners.get(activity.id) === owner) clearWorkspaceActivity(activity.id);
    }
}
