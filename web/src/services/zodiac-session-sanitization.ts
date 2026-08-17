type ZodiacProtocolItem = {
    role?: string;
    text?: string;
};

type ZodiacProtocolSession<T extends ZodiacProtocolItem> = {
    summary?: string;
    items: T[];
};

/**
 * Old Zodiac sessions may predate protocol stripping at the chat boundary.
 * Keep the sanitizer pure so reads can display the safe value immediately and
 * storage can migrate only records that actually changed.
 */
export function sanitizeZodiacSessionProtocol<
    T extends ZodiacProtocolItem,
    S extends ZodiacProtocolSession<T>,
>(session: S, stripProtocol: (text: string) => string): { session: S; changed: boolean } {
    let changed = false;
    const items = session.items.map((item) => {
        if (item.role !== "assistant" || typeof item.text !== "string") return item;
        const text = stripProtocol(item.text);
        if (text === item.text) return item;
        changed = true;
        return { ...item, text };
    });
    const summary = typeof session.summary === "string"
        ? stripProtocol(session.summary)
        : session.summary;
    if (summary !== session.summary) changed = true;
    return changed
        ? { session: { ...session, summary, items } as S, changed: true }
        : { session, changed: false };
}
