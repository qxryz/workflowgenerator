export const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/qxryz/workflowgenerator/releases?per_page=100";

export type ReleaseDownloadStats = {
    manualDownloads: number;
    updateDownloads: number;
    totalDownloads: number;
};

export type ReleaseDownloadStatsByVersion = Record<string, ReleaseDownloadStats>;

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:dev|alpha|beta|rc)\.\d+)?$/u;

function asRecord(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readDownloadCount(value: unknown) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeReleaseVersion(value: unknown) {
    if (typeof value !== "string") return null;
    const version = value.trim().replace(/^v/u, "");
    return RELEASE_VERSION_PATTERN.test(version) ? version : null;
}

export function summarizeReleaseDownloads(payload: unknown): ReleaseDownloadStatsByVersion {
    if (!Array.isArray(payload)) return {};
    const entries: [string, ReleaseDownloadStats][] = [];

    for (const item of payload) {
        const release = asRecord(item);
        const version = normalizeReleaseVersion(release?.tag_name);
        if (!release || !version || release.draft === true) continue;

        let manualDownloads = 0;
        let updateDownloads = 0;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        for (const itemAsset of assets) {
            const asset = asRecord(itemAsset);
            const name = typeof asset?.name === "string" ? asset.name.toLowerCase() : "";
            const downloadCount = readDownloadCount(asset?.download_count);
            if (name.endsWith(".dmg")) manualDownloads += downloadCount;
            else if (name.endsWith(".app.tar.gz")) updateDownloads += downloadCount;
        }

        entries.push([
            version,
            {
                manualDownloads,
                updateDownloads,
                totalDownloads: manualDownloads + updateDownloads,
            },
        ]);
    }

    return Object.fromEntries(entries);
}

export async function fetchReleaseDownloadStats(signal?: AbortSignal) {
    const response = await fetch(GITHUB_RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal,
    });
    if (!response.ok) throw new Error(`GitHub Releases request failed (${response.status})`);
    return summarizeReleaseDownloads(await response.json());
}
