import type { StructuredAsset } from "../stores/use-asset-store.ts";

/** Restore local URLs after either local-store hydration or remote asset synchronization. */
export async function hydrateStructuredAssetMedia(asset: StructuredAsset, resolveImage: (storageKey: string, fallback: string) => Promise<string>, resolveAudio?: (storageKey: string, fallback: string) => Promise<string>): Promise<StructuredAsset> {
    const images = await Promise.all(asset.data.images.map(async (image) => (image.storageKey ? { ...image, dataUrl: await resolveImage(image.storageKey, image.dataUrl) } : image)));
    const audios = asset.data.audios && (await Promise.all(asset.data.audios.map(async (audio) => (audio.storageKey && resolveAudio ? { ...audio, url: await resolveAudio(audio.storageKey, audio.url) } : audio))));
    const avatar = images.find((image) => image.id === asset.data.avatarImageId);
    const coverUrl = asset.data.collectionVersion === 1 ? avatar?.dataUrl || "" : (avatar || images.find((image) => image.isCurrent) || images[0])?.dataUrl || asset.coverUrl;
    return { ...asset, coverUrl, data: { ...asset.data, images, ...(audios ? { audios } : {}) } };
}

export function shouldRefreshStoredAssetCover(coverUrl: string, contentUrl: string) {
    if (!coverUrl || coverUrl === contentUrl) return true;
    return coverUrl.startsWith("blob:") || coverUrl.startsWith("data:image/") || coverUrl.startsWith("wg-media:");
}
