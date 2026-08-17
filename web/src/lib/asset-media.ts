export function shouldRefreshStoredAssetCover(coverUrl: string, contentUrl: string) {
    if (!coverUrl || coverUrl === contentUrl) return true;
    return coverUrl.startsWith("blob:") || coverUrl.startsWith("data:image/") || coverUrl.startsWith("wg-media:");
}
