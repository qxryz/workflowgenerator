import { getNodeDefinition, getNodePluginId, isBuiltinNodeType, registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { bundledOfficialPluginId, isBundledOfficialPluginUrl, loadBundledOfficialPluginExport } from "@/lib/canvas/plugin-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import { readResponseBytes } from "@/lib/limited-response";

const MAX_PLUGIN_SOURCE_BYTES = 5 * 1024 * 1024;
export const UNTRUSTED_PLUGINS_ENABLED = Boolean(import.meta.env?.DEV && import.meta.env?.VITE_ENABLE_UNSAFE_PLUGINS === "true");

const cleanups = new Map<string, () => void>();
const activePlugins = new Map<string, CanvasPlugin>();

function evaluatePluginExport(exported: unknown): CanvasPlugin {
    const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
    assertPlugin(plugin);
    return plugin;
}

// 远程插件默认导出可以是 CanvasPlugin,或接收 runtime 返回 CanvasPlugin 的工厂
// (工厂形式用 runtime.React,无需 bundle 自带 React)
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        return evaluatePluginExport(mod.default ?? mod.plugin);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error("插件未导出有效对象");
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error("插件缺少 id 或 nodes");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) throw new Error("插件 id 必须使用 kebab-case");
    const seen = new Set<string>();
    value.nodes.forEach((node) => {
        if (!node || typeof node.type !== "string" || !node.type.startsWith(`${value.id}:`)) throw new Error(`插件节点 type 必须以 ${value.id}: 开头`);
        if (seen.has(node.type)) throw new Error(`插件包含重复节点 type: ${node.type}`);
        seen.add(node.type);
        const existing = getNodeDefinition(node.type);
        if (isBuiltinNodeType(node.type) || (existing && getNodePluginId(node.type) !== value.id)) throw new Error(`节点 type 已被占用: ${node.type}`);
    });
}

export function activatePlugin(plugin: CanvasPlugin) {
    registerNodeDefinitions(plugin.nodes, plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    try {
        // 插件声明的样式:启用时注入,禁用/卸载时清理
        if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
        const cleanup = plugin.setup?.(runtime);
        if (typeof cleanup === "function") disposers.push(cleanup);
        cleanups.set(plugin.id, () =>
            disposers
                .slice()
                .reverse()
                .forEach((dispose) => dispose()),
        );
        activePlugins.set(plugin.id, plugin);
    } catch (error) {
        disposers
            .slice()
            .reverse()
            .forEach((dispose) => {
                try {
                    dispose();
                } catch {
                    // 保留原始激活错误。
                }
            });
        unregisterPluginNodes(plugin.id);
        throw error;
    }
}

export function deactivatePlugin(pluginId: string) {
    try {
        cleanups.get(pluginId)?.();
    } finally {
        cleanups.delete(pluginId);
        activePlugins.delete(pluginId);
        unregisterPluginNodes(pluginId);
    }
}

export async function loadBundledPlugin(url: string) {
    if (!isBundledOfficialPluginUrl(url)) throw new Error("内置插件不存在");
    const plugin = evaluatePluginExport(await loadBundledOfficialPluginExport(url));
    const expectedId = bundledOfficialPluginId(url);
    if (expectedId && plugin.id !== expectedId) throw new Error(`内置插件 id 不匹配: 期望 ${expectedId}`);
    return plugin;
}

async function digestHex(bytes: Uint8Array) {
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchPluginSource(url: string, expectedSha256?: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`);
    const bytes = await readResponseBytes(response, MAX_PLUGIN_SOURCE_BYTES, "插件文件过大，已停止安装");
    if (expectedSha256 && (await digestHex(bytes)) !== expectedSha256.toLowerCase()) throw new Error("插件文件校验失败，已停止安装");
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Error("插件文件不是有效的 UTF-8 文本");
    }
}

async function loadPlugin(url: string, source?: string, bustCache = false, expectedSha256?: string) {
    if (isBundledOfficialPluginUrl(url)) return { plugin: await loadBundledPlugin(url), source: "" };
    const resolvedSource = source ?? (await fetchPluginSource(bustCache ? withCacheBust(url) : url, expectedSha256));
    if (source && expectedSha256) {
        const bytes = new TextEncoder().encode(source);
        if ((await digestHex(bytes)) !== expectedSha256.toLowerCase()) throw new Error("插件缓存校验失败，请重新安装");
    }
    return { plugin: await evaluatePluginSource(resolvedSource), source: resolvedSource };
}

async function loadInstalledPlugin(record: InstalledPlugin) {
    if (isBundledOfficialPluginUrl(record.url)) return loadBundledPlugin(record.url);
    const source = record.local ? await fetchPluginSource(withCacheBust(record.url)) : record.source;
    if (record.official && !record.sha256 && !isBundledOfficialPluginUrl(record.url)) throw new Error("官方插件缺少完整性信息，请重新安装");
    if (record.sha256) {
        const bytes = new TextEncoder().encode(source);
        if ((await digestHex(bytes)) !== record.sha256.toLowerCase()) throw new Error("插件缓存校验失败，请重新安装");
    }
    const plugin = await evaluatePluginSource(source);
    if (plugin.id !== record.id) throw new Error(`插件 id 不匹配: 期望 ${record.id}`);
    return plugin;
}

// 加缓存穿透参数,配合 watch 构建拿到最新产物
function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// 从 URL 安装(或覆盖更新)一个插件。普通 URL 沿用「安装即启用」,
// 随应用提供的官方插件可以 enabled=false 安装,由用户再明确启用。
// bustCache=true 时下载绕过 HTTP/CDN 缓存(升级场景必需,避免拿到旧产物),
// 但落库的 url 始终保持干净(不带 ?t=),便于后续再次更新。
export async function installPluginFromUrl(url: string, opts?: { official?: boolean; bustCache?: boolean; enabled?: boolean; expectedSha256?: string }) {
    if (!opts?.official && !UNTRUSTED_PLUGINS_ENABLED) throw new Error("当前版本只允许安装经过签名校验的官方插件");
    if (opts?.official && !isBundledOfficialPluginUrl(url) && !opts.expectedSha256) throw new Error("官方插件缺少完整性信息");
    const loadedPlugin = await loadPlugin(url, undefined, opts?.bustCache, opts?.expectedSha256);
    const { plugin, source } = loadedPlugin;
    const previous = activePlugins.get(plugin.id);
    const enabled = opts?.enabled ?? !isBundledOfficialPluginUrl(url);
    try {
        deactivatePlugin(plugin.id); // 覆盖旧版本
        if (enabled) activatePlugin(plugin);
        usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled, official: opts?.official, sha256: opts?.expectedSha256 });
        return plugin;
    } catch (error) {
        if (activePlugins.get(plugin.id) === plugin) {
            try {
                deactivatePlugin(plugin.id);
            } catch {
                // 继续尝试恢复更新前的插件。
            }
        }
        if (previous) {
            try {
                activatePlugin(previous);
            } catch {
                // 安装错误仍是用户最需要看到的原因。
            }
        }
        throw error;
    }
}

export async function updatePlugin(record: InstalledPlugin, expectedSha256?: string) {
    // 升级必须拿到最新产物,强制绕过缓存
    return installPluginFromUrl(record.url, { official: record.official, bustCache: true, enabled: record.enabled, expectedSha256: expectedSha256 || record.sha256 });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (!enabled) {
        try {
            deactivatePlugin(record.id);
        } finally {
            usePluginStore.getState().setEnabled(record.id, false);
        }
        return;
    }
    if (!record.official && !UNTRUSTED_PLUGINS_ENABLED) throw new Error("当前版本只允许启用经过签名校验的官方插件");
    const plugin = await loadInstalledPlugin(record);
    activatePlugin(plugin);
    usePluginStore.getState().setEnabled(record.id, true);
}

export function uninstallPlugin(id: string) {
    try {
        deactivatePlugin(id);
    } finally {
        usePluginStore.getState().remove(id);
    }
}

let loaded = false;

// 应用启动时加载已安装且启用的插件
export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    await usePluginStore.persist.rehydrate();
    if (UNTRUSTED_PLUGINS_ENABLED) await loadLocalPlugins();
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled && (record.official || UNTRUSTED_PLUGINS_ENABLED));
    await Promise.all(
        records.map(async (record) => {
            try {
                activatePlugin(await loadInstalledPlugin(record));
            } catch (error) {
                console.error(`[plugin] 加载失败: ${record.id}`, error);
            }
        }),
    );
    if (UNTRUSTED_PLUGINS_ENABLED) await loadDevPlugins();
}

// 自动发现 web/public/plugins 下的本地插件:加入列表但默认关闭,
// 本地开发放好插件文件即可在管理器里看到并一键启用,无需手动填 URL。
// 已在列表中的:刷新元数据(version/name/description/source)到最新产物,
// 但保留用户的 enabled 开关 —— 否则改了插件版本后,持久化 store 里的旧 version 永不更新。
async function loadLocalPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json");
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return; // 无本地清单(如生产环境未构建插件)则跳过
    }
    if (!Array.isArray(urls) || !urls.length) return;
    const store = usePluginStore.getState();
    await Promise.all(
        urls.map(async (url: string) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluatePluginSource(source);
                const existing = store.plugins.find((item) => item.id === plugin.id);
                store.upsert({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || "0.0.0",
                    description: plugin.description,
                    url,
                    source,
                    enabled: existing?.enabled ?? false, // 保留用户开关,新发现默认关闭
                    local: true,
                });
            } catch (error) {
                console.error(`[plugin] 本地插件发现失败: ${url}`, error);
            }
        }),
    );
}

// 本地开发:VITE_DEV_PLUGINS 里的 URL 每次启动都重新拉取(不缓存、不落库),
// 配合 watch 构建即可「改代码→刷新页面」看到最新插件,无需反复安装。
async function loadDevPlugins() {
    const raw = import.meta.env?.VITE_DEV_PLUGINS;
    if (!raw) return;
    const urls = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    await Promise.all(
        urls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluatePluginSource(source);
                deactivatePlugin(plugin.id);
                activatePlugin(plugin);
                console.info(`[plugin] dev 插件已加载: ${plugin.id} (${url})`);
            } catch (error) {
                console.error(`[plugin] dev 插件加载失败: ${url}`, error);
            }
        }),
    );
}
