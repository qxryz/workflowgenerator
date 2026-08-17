import { parseProjectValue } from "../../director-desk/editor/io/importProjectJson.ts";
import type { DirectorCameraCapture, DirectorProject } from "../../director-desk/editor/schema/directorProject.ts";

export type DirectorStoredImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    contentHash?: string;
};

export type PreparedDirectorProject = {
    project: DirectorProject;
    uploaded: DirectorStoredImage[];
};

type DirectorImageStorage = {
    store: (dataUrl: string) => Promise<DirectorStoredImage>;
    resolve: (storageKey: string) => Promise<string>;
    discard: (image: DirectorStoredImage) => Promise<unknown>;
};

function captureStorageFields(image: DirectorStoredImage, contentHash: string) {
    return {
        dataUrl: image.url,
        storageKey: image.storageKey,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        mimeType: image.mimeType,
        ...(contentHash ? { contentHash } : {}),
    };
}

function captureAsStoredImage(capture: DirectorCameraCapture | undefined): DirectorStoredImage | null {
    if (!capture?.storageKey || !capture.width || !capture.height || !capture.bytes || !capture.mimeType) return null;
    return {
        url: capture.dataUrl,
        storageKey: capture.storageKey,
        width: capture.width,
        height: capture.height,
        bytes: capture.bytes,
        mimeType: capture.mimeType,
        ...(capture.contentHash ? { contentHash: capture.contentHash } : {}),
    };
}

export async function fingerprintDirectorCapture(dataUrl: string) {
    if (!/^data:image\/[a-z0-9.+-]+(?:;|,)/iu.test(dataUrl)) return "";
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
        return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    }
    let firstHash = 0x811c9dc5;
    let secondHash = 0x9e3779b9;
    for (let index = 0; index < dataUrl.length; index += 1) {
        const code = dataUrl.charCodeAt(index);
        firstHash = Math.imul(firstHash ^ code, 0x01000193) >>> 0;
        secondHash = Math.imul(secondHash ^ code, 0x85ebca6b) >>> 0;
        secondHash = ((secondHash << 13) | (secondHash >>> 19)) >>> 0;
    }
    return `fallback-${firstHash.toString(16).padStart(8, "0")}${secondHash.toString(16).padStart(8, "0")}-${dataUrl.length.toString(16)}`;
}

export function indexDirectorCaptureImages(project: DirectorProject | null | undefined) {
    const images = new Map<string, DirectorStoredImage>();
    project?.cameras.forEach((camera) => {
        camera.captures?.forEach((capture) => {
            const image = captureAsStoredImage(capture);
            if (image) images.set(capture.id, image);
        });
    });
    return images;
}

export function findDirectorCapture(project: DirectorProject | null | undefined, captureId: string) {
    for (const camera of project?.cameras ?? []) {
        const capture = camera.captures?.find((item) => item.id === captureId);
        if (capture) return capture;
    }
    return undefined;
}

export async function prepareDirectorProjectForStorage(
    value: unknown,
    previousValue: unknown,
    storage: DirectorImageStorage,
    knownImages: ReadonlyMap<string, DirectorStoredImage> = new Map(),
): Promise<PreparedDirectorProject> {
    const project = parseProjectValue(value);
    let previous: DirectorProject | null = null;
    try {
        previous = previousValue == null ? null : parseProjectValue(previousValue);
    } catch {
        previous = null;
    }
    const previousImages = indexDirectorCaptureImages(previous);
    const uploaded: DirectorStoredImage[] = [];

    try {
        const cameras = [] as DirectorProject["cameras"];
        for (const camera of project.cameras) {
            const captures = [] as DirectorCameraCapture[];
            for (const capture of camera.captures ?? []) {
                const contentHash = capture.contentHash || (await fingerprintDirectorCapture(capture.dataUrl));
                const knownImage = knownImages.get(capture.id);
                const previousImage = previousImages.get(capture.id);
                let image: DirectorStoredImage | null = null;
                if (capture.storageKey) {
                    if (knownImage?.storageKey === capture.storageKey) image = knownImage;
                    else if (previousImage?.storageKey === capture.storageKey) image = previousImage;
                }
                if (!image && contentHash) {
                    if (knownImage?.contentHash === contentHash) image = knownImage;
                    else if (previousImage?.contentHash === contentHash) image = previousImage;
                }
                if (!image && capture.storageKey) {
                    const resolvedUrl = await storage.resolve(capture.storageKey);
                    const stored = captureAsStoredImage(capture);
                    if (resolvedUrl && stored) image = { ...stored, url: resolvedUrl };
                }
                if (!image) {
                    image = { ...(await storage.store(capture.dataUrl)), ...(contentHash ? { contentHash } : {}) };
                    uploaded.push(image);
                }
                captures.push({ ...capture, ...captureStorageFields(image, contentHash || image.contentHash || "") });
            }
            cameras.push({
                ...camera,
                captures,
                lastCaptureUrl: captures.at(-1)?.dataUrl ?? null,
            });
        }

        return {
            project: { ...project, cameras },
            uploaded,
        };
    } catch (error) {
        await Promise.allSettled(uploaded.map((image) => storage.discard(image)));
        throw error;
    }
}

export async function hydrateDirectorProjectCaptures(value: unknown, readDataUrl: (storageKey: string, fallback: string) => Promise<string>) {
    const project = parseProjectValue(value);
    const cameras = await Promise.all(
        project.cameras.map(async (camera) => {
            const captures = await Promise.all(
                (camera.captures ?? []).map(async (capture) => ({
                    ...capture,
                    dataUrl: capture.storageKey ? await readDataUrl(capture.storageKey, capture.dataUrl) : capture.dataUrl,
                })),
            );
            return {
                ...camera,
                captures,
                lastCaptureUrl: captures.at(-1)?.dataUrl ?? null,
            };
        }),
    );
    return { ...project, cameras };
}
