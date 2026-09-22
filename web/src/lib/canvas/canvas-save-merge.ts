/** Three-way snapshot merge: conflicting fields keep the committed server value. */
export function mergeCanvasValues<T>(base: T, local: T, remote: T): { value: T; conflicts: string[] } {
    const conflicts: string[] = [];
    const equal = (a: unknown, b: unknown): boolean => {
        if (Object.is(a, b)) return true;
        if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
        const left = Object.keys(a), right = Object.keys(b);
        return left.length === right.length && left.every((key) => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
    };
    const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
    const keyed = (value: unknown): value is Array<Record<string, unknown> & { id: string }> => Array.isArray(value) && value.every((item) => object(item) && typeof item.id === "string") && new Set(value.map((item) => item.id)).size === value.length;
    function merge(before: unknown, desired: unknown, current: unknown, path: string): unknown {
        if (equal(desired, before)) return current;
        if (equal(current, before) || equal(desired, current)) return desired;
        if (path === "updatedAt" && typeof desired === "string" && typeof current === "string") return desired > current ? desired : current;
        if (object(before) && object(desired) && object(current)) {
            const result: Record<string, unknown> = {};
            for (const key of new Set([...Object.keys(before), ...Object.keys(desired), ...Object.keys(current)])) {
                const value = merge(before[key], desired[key], current[key], path ? `${path}.${key}` : key);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        if (keyed(before) && keyed(desired) && keyed(current)) {
            const baseById = new Map(before.map((item) => [item.id, item]));
            const localById = new Map(desired.map((item) => [item.id, item]));
            const remoteById = new Map(current.map((item) => [item.id, item]));
            return [...new Set([...current.map((item) => item.id), ...desired.map((item) => item.id), ...before.map((item) => item.id)])]
                .map((id) => merge(baseById.get(id), localById.get(id), remoteById.get(id), `${path}[${id}]`))
                .filter((item) => item !== undefined);
        }
        conflicts.push(path || "project");
        return current;
    }
    return { value: merge(base, local, remote, "") as T, conflicts };
}
