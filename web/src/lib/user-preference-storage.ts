import { localForageStorage } from "@/lib/localforage-storage";

/**
 * User preferences use the native SQLite-backed storage in desktop builds.
 * localForageStorage keeps the browser build working and imports matching
 * legacy localStorage values the first time they are read.
 */
export async function readUserPreference(key: string): Promise<unknown | null> {
    try {
        const stored = await localForageStorage.getItem(key);
        if (stored == null) return null;
        try {
            return JSON.parse(stored) as unknown;
        } catch {
            return stored;
        }
    } catch {
        return null;
    }
}

export async function readMigratedUserPreference(key: string, legacyKeys: string[] = []): Promise<unknown | null> {
    const current = await readUserPreference(key);
    if (current != null) return current;
    for (const legacyKey of legacyKeys) {
        const legacy = await readUserPreference(legacyKey);
        if (legacy == null) continue;
        await saveUserPreference(key, legacy);
        return legacy;
    }
    return null;
}

export async function saveUserPreference(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return;
    try {
        await localForageStorage.setItem(key, serialized);
    } catch {
        // A preference write must never interrupt the current interaction.
    }
}
