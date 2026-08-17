export const MAX_ZODIAC_SESSION_ITEMS = 160;
export const MAX_ZODIAC_REQUEST_MESSAGES = 40;
export const ZODIAC_CONTEXT_COMPACTION_TOKENS = 24_000;
export const ZODIAC_CONTEXT_RECENT_MESSAGES = 12;

type ConversationItem = {
    id: string;
    role: string;
    text?: string;
    attachments?: Array<{ dataUrl?: string; url?: string }>;
    skills?: Array<{ body?: string }>;
};

export type ZodiacContextCompaction<T extends ConversationItem> = {
    items: T[];
    throughId: string;
};

export function trimZodiacSessionItems<T>(items: T[], limit = MAX_ZODIAC_SESSION_ITEMS) {
    return items.length > limit ? items.slice(-limit) : items;
}

export function recentZodiacConversationItems<T extends { role: string }>(items: T[], limit = MAX_ZODIAC_REQUEST_MESSAGES) {
    return items
        .filter((item) => item.role === "user" || item.role === "assistant")
        .slice(-limit);
}

export function zodiacConversationAfterSummary<T extends ConversationItem>(items: T[], summaryThroughId?: string) {
    const conversation = items.filter((item) => item.role === "user" || item.role === "assistant");
    if (!summaryThroughId) return conversation;
    const index = conversation.findIndex((item) => item.id === summaryThroughId);
    return index < 0 ? conversation.slice(-ZODIAC_CONTEXT_RECENT_MESSAGES) : conversation.slice(index + 1);
}

export function planZodiacContextCompaction<T extends ConversationItem>(
    items: T[],
    summaryThroughId?: string,
    threshold = ZODIAC_CONTEXT_COMPACTION_TOKENS,
    keepRecent = ZODIAC_CONTEXT_RECENT_MESSAGES,
): ZodiacContextCompaction<T> | null {
    const pending = zodiacConversationAfterSummary(items, summaryThroughId);
    if (pending.length <= keepRecent || estimateZodiacConversationTokens(pending) < threshold) return null;
    const compactable = pending.slice(0, -keepRecent);
    return compactable.length ? { items: compactable, throughId: compactable.at(-1)!.id } : null;
}

export function estimateZodiacConversationTokens(items: ConversationItem[]) {
    return items.reduce((total, item) => {
        const text = item.text || "";
        const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
        const other = Math.max(0, text.length - cjk);
        const attachmentTokens = (item.attachments?.length || 0) * 900;
        const skillTokens = (item.skills || []).reduce((skillsTotal, skill) => {
            const body = skill.body || "";
            const skillCjk = (body.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
            const skillOther = Math.max(0, body.length - skillCjk);
            return skillsTotal + skillCjk + Math.ceil(skillOther / 4);
        }, 0);
        return total + cjk + Math.ceil(other / 4) + attachmentTokens + skillTokens + 8;
    }, 0);
}
