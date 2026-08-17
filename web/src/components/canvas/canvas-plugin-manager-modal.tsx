import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Puzzle, RefreshCw, Terminal, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { BUNDLED_OFFICIAL_PLUGINS, fetchOfficialPlugins, hasUpgrade, isBundledOfficialPluginUrl, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [official, setOfficial] = useState<OfficialPluginEntry[]>(() => [...BUNDLED_OFFICIAL_PLUGINS]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialLoaded, setOfficialLoaded] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const localPlugins = useMemo(() => plugins.filter((item) => item.local), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !item.official), [plugins]);

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
            setOfficialLoaded(true);
        }
    }, []);

    // 内置官方插件立即可见；面板首次打开时再补充远程清单。
    useEffect(() => {
        if (open && !officialLoaded && !loadingOfficial) void loadOfficial();
    }, [open, officialLoaded, loadingOfficial, loadOfficial]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target);
            message.success(`已安装插件 ${plugin.name}`);
            setUrl("");
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setInstalling(false);
        }
    };

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true, enabled: !entry.bundled });
            message.success(entry.bundled ? `已安装 ${plugin.name}，启用后即可添加到画布` : `已安装 ${plugin.name}`);
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // 已安装插件的操作区:启用开关 +(非本地)更新/卸载
    // upgradable=true 时(远程有更高版本),更新按钮高亮为主色以提示升级
    const installedControls = (record: InstalledPlugin, upgradable = false) => {
        const bundled = isBundledOfficialPluginUrl(record.url);
        return (
            <>
                <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), checked ? "已启用" : "已禁用")} />
                {!record.local && !bundled ? (
                    <>
                        <Button
                            type={upgradable ? "primary" : "text"}
                            size="small"
                            icon={<RefreshCw className="size-4" />}
                            loading={busyId === record.id}
                            title={upgradable ? "有新版本，点击升级" : "从来源更新"}
                            onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), "已更新")}
                        />
                    </>
                ) : null}
                {!record.local ? (
                    <Popconfirm title="卸载该插件？" okText="卸载" cancelText="取消" onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="卸载" />
                    </Popconfirm>
                ) : null}
            </>
        );
    };

    // 图标外挂一个绿点(右上角),用于「有可升级版本」的提示。
    // boxShadow 画一圈与卡片同色的描边环,让绿点从图标上「浮起」。
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.node.fill}` }} title="有新版本可升级" />
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // 通用插件行:图标 + 标题(名称 + 版本)+ 描述 + 右侧操作
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    本项目官方插件,来自仓库注册表
                </div>
                <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`} />} onClick={loadOfficial} disabled={loadingOfficial}>
                    刷新
                </Button>
            </div>
            {officialError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    加载失败：{officialError}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint("正在获取官方插件…")
            ) : official.length === 0 ? (
                emptyHint("暂无官方插件")
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {official.map((entry) => {
                        const record = recordById.get(entry.id);
                        // 已安装且远程版本更高 → 显示绿点并高亮升级按钮
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            // 有升级时标题版本展示为「本地 → 远程」,让用户看清升级到哪个版本
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, upgradable)
                            ) : (
                                <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => handleInstallOfficial(entry)}>
                                    安装
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const localTab = (
        <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>
    );

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input placeholder="输入插件 JS 文件 URL，例如 https://.../plugin.js" value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={handleInstallUrl} allowClear />
                <Button type="primary" loading={installing} onClick={handleInstallUrl} icon={<Puzzle className="size-4" />}>
                    安装
                </Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">
                {thirdPartyPlugins.length === 0
                    ? emptyHint("还没有安装第三方插件")
                    : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}
            </div>
        </div>
    );

    const tabs = [{ key: "official", label: "官方插件", children: officialTab }, ...(localPlugins.length > 0 ? [{ key: "local", label: "本地插件", children: localTab }] : []), { key: "third", label: "第三方插件", children: thirdPartyTab }];

    return (
        <Modal title="节点插件" open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>插件代码会在当前页面内直接执行，可访问本地数据（包含 AI API Key）。请仅安装你信任来源的插件。</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                    <Terminal className="size-4 shrink-0" />
                    <span>插件节点可与终端节点直接连线，终端发布的文本、图片、视频或音频会作为上游内容传入。</span>
                </div>
                <Tabs defaultActiveKey="official" items={tabs} />
            </div>
        </Modal>
    );
}
