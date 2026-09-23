import { randomId } from "@/lib/utils";
import { stripZodiacDecisionPayload } from "@/lib/agent/zodiac-decision-ui";
import { ZodiacSessionWriteCoordinator, zodiacSessionWriteFence } from "@/lib/agent/zodiac-session-write-fence";
import { stripZodiacToolPayload } from "@/lib/agent/zodiac-tool-proposal";
import { createServerJsonStore } from "@/services/server-storage";
import { sanitizeZodiacSessionProtocol } from "@/services/zodiac-session-sanitization";

export type ZodiacSessionItem = {
    id: string;
    role?: string;
    text?: string;
    title?: string;
    /** Original assistant decision transport retained when cleaning legacy previews. */
    decisionProtocol?: string;
};

export type ZodiacSessionState<T extends ZodiacSessionItem = ZodiacSessionItem> = {
    version: 2;
    autoApprove?: boolean;
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
    archived?: boolean;
};

const activeStore = createServerJsonStore("zodiac-sessions-v1");
const archiveStore = createServerJsonStore("zodiac-session-history-v1");
const activeWrites = new ZodiacSessionWriteCoordinator(zodiacSessionWriteFence);

export function createZodiacSession<T extends ZodiacSessionItem>(workspaceId: string, workspaceTitle: string, items: T[] = []): ZodiacSessionState<T> {
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

export async function loadZodiacSession<T extends ZodiacSessionItem>(workspaceId: string, workspaceTitle: string, options?: { preserveAssistantProtocol?: boolean }): Promise<ZodiacSessionState<T>> {
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
        await activeStore.setItem(session.workspaceId, durable);
    });
}

export async function retainZodiacSession<T extends ZodiacSessionItem>(session: ZodiacSessionState<T>) {
    return storeSessionRecord(session, false);
}

export async function archiveZodiacSession<T extends ZodiacSessionItem>(session: ZodiacSessionState<T>) {
    return storeSessionRecord(session, true);
}

async function storeSessionRecord<T extends ZodiacSessionItem>(session: ZodiacSessionState<T>, isArchived: boolean) {
    if (!session.items.length && !session.summary) return;
    const sanitized = sanitizeStoredZodiacSession(session).session;
    const archived: ZodiacArchivedSession<T> = {
        ...sanitized,
        title: sanitized.title || sessionTitle(sanitized.items),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        archived: isArchived,
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
    return (await listSessionRecords<T>()).filter(session => session.archived !== false);
}

async function listSessionRecords<T extends ZodiacSessionItem>() {
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
    return sanitizeZodiacSessionProtocol(session, (text) => stripZodiacDecisionPayload(stripZodiacToolPayload(text), { allowImplicit: true }));
}

export type ZodiacListedSession<T extends ZodiacSessionItem = ZodiacSessionItem> = ZodiacSessionState<T> & { archived: boolean; endedAt?: string };

/** One history for active and saved conversations. Active snapshots take precedence. */
export async function listZodiacSessions<T extends ZodiacSessionItem>(): Promise<ZodiacListedSession<T>[]> {
    const entries = new Map<string, ZodiacListedSession<T>>();
    for (const session of await listSessionRecords<T>()) entries.set(session.id, { ...session, archived: session.archived !== false });
    await activeStore.iterate<ZodiacSessionState<T>, void>(value => {
        if (value?.version === 2 && value.id && Array.isArray(value.items) && (value.items.length || value.summary)) entries.set(value.id, { ...sanitizeStoredZodiacSession(value).session, archived: false });
    });
    return [...entries.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function resumeZodiacSession(sessionId: string, options?: { restoreArchived?: boolean }) {
    const target = (await listZodiacSessions()).find(session => session.id === sessionId);
    if (!target) throw new Error("会话不存在，请刷新列表。");
    if (target.archived && !options?.restoreArchived) throw new Error("请在对话菜单中选择恢复。");
    const current = await loadZodiacSession(target.workspaceId, target.workspaceTitle, { preserveAssistantProtocol: true });
    if (current.id !== target.id) await retainZodiacSession(current);
    const { archived: _archived, endedAt: _endedAt, ...session } = target;
    await activeWrites.replace(session.workspaceId, session.id, async () => { await activeStore.setItem(session.workspaceId, session); });
    await archiveStore.removeItem(target.id);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("zodiac-session-resumed", { detail: { workspaceId: session.workspaceId } }));
    return session;
}

/** Explicit archive action; replacing the active session invalidates delayed writes. */
export async function archiveZodiacSessionById(sessionId: string) {
    const target = (await listZodiacSessions()).find(session => session.id === sessionId);
    if (!target || target.archived) return;
    const current = await loadZodiacSession(target.workspaceId, target.workspaceTitle, { preserveAssistantProtocol: true });
    await archiveZodiacSession(target);
    if (current.id === target.id) {
        const replacement = createZodiacSession(target.workspaceId, target.workspaceTitle);
        await activeWrites.replace(target.workspaceId, replacement.id, async () => { await activeStore.setItem(target.workspaceId, replacement); });
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("zodiac-session-resumed", { detail: { workspaceId: target.workspaceId } }));
    }
}
