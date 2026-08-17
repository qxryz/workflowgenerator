import { randomId } from "@/lib/utils";
import { stripZodiacDecisionPayload } from "@/lib/agent/zodiac-decision-ui";
import { ZodiacSessionWriteCoordinator, zodiacSessionWriteFence } from "@/lib/agent/zodiac-session-write-fence";
import { stripZodiacToolPayload } from "@/lib/agent/zodiac-tool-proposal";
import { createDesktopJsonStore } from "@/services/desktop-storage";
import { sanitizeZodiacSessionProtocol } from "@/services/zodiac-session-sanitization";

export type ZodiacSessionItem = {
    id: string;
    role?: string;
    text?: string;
    title?: string;
};

export type ZodiacSessionState<T extends ZodiacSessionItem = ZodiacSessionItem> = {
    version: 2;
    id: string;
    workspaceId: string;
    workspaceTitle: string;
    title: string;
    startedAt: string;
    updatedAt: string;
    summary: string;
    summaryThroughId?: string;
    items: T[];
};

export type ZodiacArchivedSession<T extends ZodiacSessionItem = ZodiacSessionItem> = ZodiacSessionState<T> & {
    endedAt: string;
};

const activeStore = createDesktopJsonStore({
    namespace: "zodiac-sessions-v1",
    legacy: { name: "infinite-canvas", storeName: "zodiac_sessions" },
});
const archiveStore = createDesktopJsonStore({
    namespace: "zodiac-session-history-v1",
    legacy: { name: "infinite-canvas", storeName: "zodiac_session_history" },
});
const activeWrites = new ZodiacSessionWriteCoordinator(zodiacSessionWriteFence);

export function createZodiacSession<T extends ZodiacSessionItem>(
    workspaceId: string,
    workspaceTitle: string,
    items: T[] = [],
): ZodiacSessionState<T> {
    const now = new Date().toISOString();
    return {
        version: 2,
        id: randomId(),
        workspaceId,
        workspaceTitle: workspaceTitle || "工作区",
        title: sessionTitle(items),
        startedAt: now,
        updatedAt: now,
        summary: "",
        items,
    };
}

export async function loadZodiacSession<T extends ZodiacSessionItem>(
    workspaceId: string,
    workspaceTitle: string,
    options?: { preserveAssistantProtocol?: boolean },
): Promise<ZodiacSessionState<T>> {
    const saved = await activeStore.getItem<ZodiacSessionState<T> | T[]>(workspaceId);
    if (Array.isArray(saved)) {
        const session = createZodiacSession(workspaceId, workspaceTitle, saved);
        return options?.preserveAssistantProtocol ? session : sanitizeStoredZodiacSession(session).session;
    }
    if (!saved || saved.version !== 2 || !Array.isArray(saved.items)) {
        return createZodiacSession<T>(workspaceId, workspaceTitle);
    }
    const normalized = {
        ...saved,
        workspaceId,
        workspaceTitle: workspaceTitle || saved.workspaceTitle || "工作区",
        title: saved.title || sessionTitle(saved.items),
        summary: saved.summary || "",
    };
    return options?.preserveAssistantProtocol ? normalized : sanitizeStoredZodiacSession(normalized).session;
}

export function saveZodiacSessionState<T extends ZodiacSessionItem>(session: ZodiacSessionState<T>) {
    const sanitized = sanitizeStoredZodiacSession(session).session;
    const durable = {
        ...sanitized,
        title: sanitized.title || sessionTitle(sanitized.items),
        updatedAt: new Date().toISOString(),
    };
    return activeWrites.enqueue(session.workspaceId, session.id, async () => {
        if (durable.items.length || durable.summary) await activeStore.setItem(session.workspaceId, durable);
        else await activeStore.removeItem(session.workspaceId);
    });
}

export async function archiveZodiacSession<T extends ZodiacSessionItem>(session: ZodiacSessionState<T>) {
    if (!session.items.length && !session.summary) return;
    const sanitized = sanitizeStoredZodiacSession(session).session;
    const archived: ZodiacArchivedSession<T> = {
        ...sanitized,
        title: sanitized.title || sessionTitle(sanitized.items),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
    };
    await archiveStore.setItem(archived.id, archived);
}

export async function removeActiveZodiacSession(workspaceId: string, replacementSessionId?: string) {
    if (!replacementSessionId) {
        await activeStore.removeItem(workspaceId);
        return;
    }
    await activeWrites.replace(workspaceId, replacementSessionId, () => activeStore.removeItem(workspaceId));
}

export function activateZodiacSessionState(session: Pick<ZodiacSessionState, "id" | "workspaceId">) {
    zodiacSessionWriteFence.activate(session.workspaceId, session.id);
}

export async function listArchivedZodiacSessions<T extends ZodiacSessionItem>() {
    const sessions: ZodiacArchivedSession<T>[] = [];
    const migrations: Array<{ key: string; session: ZodiacArchivedSession<T> }> = [];
    await archiveStore.iterate<ZodiacArchivedSession<T>, void>((value, key) => {
        if (!value?.id || !Array.isArray(value.items)) return;
        const normalized = sanitizeStoredZodiacSession(value);
        sessions.push(normalized.session);
        if (normalized.changed) migrations.push({ key, session: normalized.session });
    });
    // A failed cleanup write must not make history unreadable. The value
    // returned above is already safe; successful writes make the migration
    // permanent for later list and preview reads.
    await Promise.allSettled(migrations.map(({ key, session }) => archiveStore.setItem(key, session)));
    return sessions.sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
}

export async function deleteArchivedZodiacSession(sessionId: string) {
    await archiveStore.removeItem(sessionId);
}

function sessionTitle(items: ZodiacSessionItem[]) {
    const firstRequest = items.find((item) => item.role === "user" && item.text?.trim())?.text?.trim();
    return firstRequest ? firstRequest.replace(/\s+/g, " ").slice(0, 48) : "新会话";
}

function sanitizeStoredZodiacSession<T extends ZodiacSessionItem, S extends { summary?: string; items: T[] }>(session: S) {
    return sanitizeZodiacSessionProtocol(session, (text) => stripZodiacDecisionPayload(stripZodiacToolPayload(text)));
}
