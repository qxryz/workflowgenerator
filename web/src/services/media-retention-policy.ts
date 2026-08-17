export type VerifiedReferenceSnapshot = Readonly<{
    /**
     * This flag may only be set by a caller that has collected every persisted and
     * in-memory reference domain. Incomplete snapshots must never authorize a
     * destructive media cleanup.
     */
    complete: true;
    data: unknown;
    epoch: number;
}>;

type StorageKeyMatcher = (key: string) => boolean;
const provisionalStorageKeyCounts = new Map<string, number>();
let mediaReferenceEpoch = 0;
let mediaStorageFence = Promise.resolve();

export function createProvisionalUploadRegistry<T extends object, TDiscardIdentity>(captureDiscardIdentity: (upload: T) => TDiscardIdentity, removeUpload: (identity: TDiscardIdentity) => Promise<void>) {
    const provisionalUploads = new WeakSet<T>();
    const discardIdentities = new WeakMap<T, TDiscardIdentity>();
    const pendingDiscards = new WeakMap<T, Promise<boolean>>();

    return {
        track(upload: T) {
            if (provisionalUploads.has(upload)) return upload;
            const discardIdentity = captureDiscardIdentity(upload);
            provisionalUploads.add(upload);
            discardIdentities.set(upload, discardIdentity);
            retainProvisionalStorageKey(discardIdentity);
            return upload;
        },
        publish(upload: T) {
            if (!provisionalUploads.has(upload)) return false;
            releaseProvisionalStorageKey(discardIdentities.get(upload));
            provisionalUploads.delete(upload);
            discardIdentities.delete(upload);
            return true;
        },
        discard(upload: T) {
            const pending = pendingDiscards.get(upload);
            if (pending) return pending;
            if (!provisionalUploads.has(upload)) return Promise.resolve(false);

            const discardIdentity = discardIdentities.get(upload) as TDiscardIdentity;
            releaseProvisionalStorageKey(discardIdentity);
            provisionalUploads.delete(upload);
            discardIdentities.delete(upload);
            const discard = Promise.resolve()
                .then(() => removeUpload(discardIdentity))
                .then(() => true)
                .catch((error) => {
                    provisionalUploads.add(upload);
                    discardIdentities.set(upload, discardIdentity);
                    retainProvisionalStorageKey(discardIdentity);
                    throw error;
                })
                .finally(() => pendingDiscards.delete(upload));
            pendingDiscards.set(upload, discard);
            return discard;
        },
    };
}

export function getProvisionalStorageKeys() {
    return Array.from(provisionalStorageKeyCounts.keys());
}

export function getMediaReferenceEpoch() {
    return mediaReferenceEpoch;
}

export function markMediaReferencesChanged() {
    mediaReferenceEpoch += 1;
}

export function isMediaReferenceEpochCurrent(epoch: number) {
    return epoch === mediaReferenceEpoch;
}

export function reserveStorageKey(storageKey: string) {
    retainProvisionalStorageKey(storageKey);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        releaseProvisionalStorageKey(storageKey);
    };
}

export function withMediaStorageFence<T>(operation: () => Promise<T>) {
    const result = mediaStorageFence.catch(() => undefined).then(operation);
    mediaStorageFence = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

/**
 * Media deletion is fail-closed. Without a verified, complete reference
 * snapshot, no key is eligible for physical removal.
 */
export function selectStorageKeysForDeletion(candidates: Iterable<string>, snapshot: VerifiedReferenceSnapshot | undefined, matchesStorageKey: StorageKeyMatcher) {
    if (!snapshot || snapshot.complete !== true) return [];
    const referencedKeys = collectStorageKeys(snapshot.data, matchesStorageKey);
    return Array.from(new Set(candidates)).filter((key) => matchesStorageKey(key) && !referencedKeys.has(key));
}

export function collectStorageKeys(value: unknown, matchesStorageKey: StorageKeyMatcher, keys = new Set<string>(), seen = new WeakSet<object>()) {
    if (typeof value === "string") {
        if (matchesStorageKey(value)) keys.add(value);
        return keys;
    }
    if (!value || typeof value !== "object") return keys;
    if (seen.has(value)) return keys;
    seen.add(value);

    Object.entries(value).forEach(([property, item]) => {
        if (property.toLowerCase().endsWith("storagekey") && typeof item === "string" && matchesStorageKey(item)) keys.add(item);
        if (Array.isArray(item)) item.forEach((child) => collectStorageKeys(child, matchesStorageKey, keys, seen));
        else collectStorageKeys(item, matchesStorageKey, keys, seen);
    });
    return keys;
}

function retainProvisionalStorageKey(identity: unknown) {
    if (typeof identity !== "string" || !identity.includes(":")) return;
    provisionalStorageKeyCounts.set(identity, (provisionalStorageKeyCounts.get(identity) || 0) + 1);
    markMediaReferencesChanged();
}

function releaseProvisionalStorageKey(identity: unknown) {
    if (typeof identity !== "string") return;
    const count = provisionalStorageKeyCounts.get(identity);
    if (!count) return;
    if (count === 1) provisionalStorageKeyCounts.delete(identity);
    else provisionalStorageKeyCounts.set(identity, count - 1);
    markMediaReferencesChanged();
}
