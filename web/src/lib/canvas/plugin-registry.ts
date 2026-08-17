import { PLUGIN_REGISTRY_URL } from "@/constant/env";
import { fetchSignedPublisherText } from "@/services/publisher-signature";
import directorDeskPackage from "../../../../plugins/canvas/director-desk/package.json";

export const DIRECTOR_DESK_BUNDLED_PLUGIN_URL = "builtin:director-desk";

// 官方插件清单里的一条(entry 已解析成绝对 URL)
export type OfficialPluginEntry = {
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    url: string;
    bundled?: boolean;
    sha256?: string;
};

type RawEntry = { id?: string; name?: string; version?: string; description?: string; icon?: string; entry?: string; url?: string; sha256?: string };
type RawManifest = { plugins?: RawEntry[] };

export const BUNDLED_OFFICIAL_PLUGINS: OfficialPluginEntry[] = [
    {
        id: "director-desk",
        name: "导演台节点",
        version: directorDeskPackage.version,
        description: "安排场景、机位和镜头，随应用提供，可离线安装",
        icon: "🎬",
        url: DIRECTOR_DESK_BUNDLED_PLUGIN_URL,
        bundled: true,
    },
];

export function isBundledOfficialPluginUrl(url: string) {
    return BUNDLED_OFFICIAL_PLUGINS.some((entry) => entry.url === url);
}

export function bundledOfficialPluginId(url: string) {
    return BUNDLED_OFFICIAL_PLUGINS.find((entry) => entry.url === url)?.id;
}

export async function loadBundledOfficialPluginExport(url: string): Promise<unknown> {
    if (url !== DIRECTOR_DESK_BUNDLED_PLUGIN_URL) throw new Error("内置插件不存在");
    return (await import("../../../../plugins/canvas/director-desk/src/index")).default;
}

function mergeOfficialPlugins(remote: OfficialPluginEntry[]) {
    const bundledIds = new Set(BUNDLED_OFFICIAL_PLUGINS.map((entry) => entry.id));
    return [...BUNDLED_OFFICIAL_PLUGINS, ...remote.filter((entry) => !bundledIds.has(entry.id))];
}

// 拉取官方插件清单;entry(相对文件名)按清单地址解析成绝对 URL,再走既有 URL 安装流程
export async function fetchOfficialPlugins(registryUrl: string = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    try {
        const data = JSON.parse(await fetchSignedPublisherText(registryUrl, 1024 * 1024, "官方插件列表过大")) as RawManifest;
        const list = Array.isArray(data?.plugins) ? data.plugins : [];
        return mergeOfficialPlugins(
            list
                .filter((item): item is RawEntry & { id: string; sha256: string } => Boolean(item && item.id && (item.entry || item.url) && /^[a-f0-9]{64}$/u.test(item.sha256 || "")))
                .map((item) => ({
                    id: item.id,
                    name: item.name || item.id,
                    version: item.version || "0.0.0",
                    description: item.description,
                    icon: item.icon,
                    url: item.url ? item.url : new URL(item.entry as string, registryUrl).toString(),
                    sha256: item.sha256,
                })),
        );
    } catch {
        return [...BUNDLED_OFFICIAL_PLUGINS];
    }
}

// 语义化版本比较:返回 >0 表示 a 更高,<0 表示 b 更高,0 表示相等。
// 只按 major.minor.patch 数值比较,忽略非数字段(预发布标签等)。
function compareSemver(a: string, b: string): number {
    const parse = (v: string) => v.split(".").map((part) => parseInt(part, 10) || 0);
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// 远程版本是否比本地已安装版本更高(即有可升级的更新)
export function hasUpgrade(installedVersion: string, remoteVersion: string): boolean {
    return compareSemver(remoteVersion, installedVersion) > 0;
}
