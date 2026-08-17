import { App, Button, Form, Input, Modal, Progress, Select, Tabs, Tag } from "antd";
import { Bot, CheckCircle2, CircleAlert, Cloud, Database, Download, Pencil, Plus, RefreshCw, RotateCcw, ScanLine, Trash2, Upload, Wifi, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { AppUpdateSettings } from "@/components/layout/app-update-settings";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { audioDefaultsKindForModel, audioVoiceOptionsForModel, defaultAudioPreferencesForModel } from "@/lib/audio-defaults";
import {
    createModelChannel,
    encodeChannelModel,
    isAiConfigReady,
    modelOptionsFromChannels,
    nextCustomChannelName,
    normalizeModelOptionValue,
    resetPresetChannel,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type ConfigTabKey,
    type ExternalTerminalApp,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";
import { providerLabel } from "@/lib/model-providers";
import { getModelVendor, legacyVendorForApiFormat } from "@/lib/model-catalog";
import { scanLocalAgents, type LocalAgentInstallation } from "@/services/terminal";
import { getDesktopStorageLocations, type DesktopStorageLocations } from "@/services/desktop-storage";

const loadChannelEditorDrawer = () => import("@/components/layout/channel-editor-drawer");
const ChannelEditorDrawer = lazy(() => loadChannelEditorDrawer().then((module) => ({ default: module.ChannelEditorDrawer })));
const loadConfigPromptSources = () => import("@/components/layout/config-prompt-sources");
const ConfigPromptSources = lazy(() => loadConfigPromptSources().then((module) => ({ default: module.ConfigPromptSources })));

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    defaultLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", defaultLabel: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", defaultLabel: "默认视频模型" },
    { capability: "text", modelKey: "textModel", defaultLabel: "默认文本模型" },
    { capability: "audio", modelKey: "audioModel", defaultLabel: "默认音频模型" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的资产",
};

const customAudioVoiceValue = "__custom_audio_voice__";

function LocalStorageLocations({ locations, error }: { locations: DesktopStorageLocations | null | undefined; error: boolean }) {
    if (error) return <div className="mt-4 border-t border-stone-200 pt-3 text-xs text-rose-600 dark:border-stone-800 dark:text-rose-400">暂时无法读取存放目录，请重新打开此页面。</div>;
    if (locations === undefined) return <div className="mt-4 border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-stone-800">正在读取存放目录…</div>;
    if (locations === null) return <div className="mt-4 border-t border-stone-200 pt-3 text-xs leading-5 text-stone-500 dark:border-stone-800">网页预览的数据由当前浏览器站点存储管理；请在桌面应用中查看实际目录。</div>;

    const entries = [
        { label: "应用数据根目录", detail: "本应用自动保存的数据都位于这里", path: locations.root, wide: true },
        { label: "配置与业务数据", detail: "配置、密钥、画布、会话、工作台记录、提示词与资产索引", path: locations.data },
        { label: "图片文件", detail: "生成图片、导入图片与导演台截图", path: locations.images },
        { label: "视频、音频与其他文件", detail: "生成结果、参考素材与工作流文件", path: locations.media },
        { label: "临时写入", detail: "未完成的媒体写入，应用会自动清理", path: locations.temporary },
    ];

    return (
        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-stone-200 pt-3 md:grid-cols-2 dark:border-stone-800">
            {entries.map((entry) => (
                <div key={entry.label} className={entry.wide ? "md:col-span-2" : ""}>
                    <dt className="text-xs font-medium text-stone-700 dark:text-stone-300">{entry.label}</dt>
                    <dd className="mt-0.5 text-[11px] leading-4 text-stone-500">{entry.detail}</dd>
                    <dd className="mt-1 break-all font-mono text-[11px] leading-4 text-stone-700 dark:text-stone-300" title={entry.path}>
                        {entry.path}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function DefaultAudioVoiceField({ model, value, onChange }: { model: string; value: string; onChange: (value: string) => void }) {
    const presets = audioVoiceOptionsForModel(model);
    const normalizedValue = value.trim();
    const valueIsPreset = presets.some((option) => option.value === normalizedValue);
    const [customMode, setCustomMode] = useState(presets.length === 0 || Boolean(normalizedValue && !valueIsPreset));
    const [customValue, setCustomValue] = useState(valueIsPreset ? "" : normalizedValue);

    useEffect(() => {
        const nextPresets = audioVoiceOptionsForModel(model);
        const nextValue = value.trim();
        const nextIsPreset = nextPresets.some((option) => option.value === nextValue);
        setCustomMode(nextPresets.length === 0 || Boolean(nextValue && !nextIsPreset));
        setCustomValue(nextIsPreset ? "" : nextValue);
    }, [model, value]);

    const selectValue = customMode ? customAudioVoiceValue : valueIsPreset ? normalizedValue : presets[0]?.value || customAudioVoiceValue;
    return (
        <div className="space-y-2">
            <Select
                className="w-full"
                value={selectValue}
                options={[...presets, { value: customAudioVoiceValue, label: "自定义音色 ID" }]}
                onChange={(nextValue) => {
                    if (nextValue === customAudioVoiceValue) {
                        setCustomMode(true);
                        setCustomValue(valueIsPreset ? "" : normalizedValue);
                        return;
                    }
                    setCustomMode(false);
                    setCustomValue("");
                    onChange(nextValue);
                }}
            />
            {customMode ? (
                <Input
                    value={customValue}
                    aria-label="自定义音色 ID"
                    placeholder="输入已创建的 Voice ID"
                    onChange={(event) => {
                        setCustomValue(event.target.value);
                        onChange(event.target.value);
                    }}
                />
            ) : null}
        </div>
    );
}

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message, modal } = App.useApp();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const [agentInstallations, setAgentInstallations] = useState<LocalAgentInstallation[]>([]);
    const [scannedAgentPaths, setScannedAgentPaths] = useState<string[]>([]);
    const [scanningAgents, setScanningAgents] = useState(false);
    const [storageLocations, setStorageLocations] = useState<DesktopStorageLocations | null>();
    const [storageLocationsError, setStorageLocationsError] = useState(false);
    const scannedAgentsRef = useRef(false);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    useEffect(() => setActiveTab(initialTab), [initialTab]);
    useEffect(() => {
        let active = true;
        void getDesktopStorageLocations()
            .then((locations) => {
                if (active) setStorageLocations(locations);
            })
            .catch(() => {
                if (active) setStorageLocationsError(true);
            });
        return () => {
            active = false;
        };
    }, []);

    const scanAgents = async () => {
        setScanningAgents(true);
        try {
            const result = await scanLocalAgents(config.agentScanPaths);
            setAgentInstallations(result.agents);
            setScannedAgentPaths(result.searchPaths);
            scannedAgentsRef.current = true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "本机 Agent 扫描失败");
        } finally {
            setScanningAgents(false);
        }
    };

    useEffect(() => {
        if (activeTab === "agents" && !scannedAgentsRef.current && !scanningAgents) void scanAgents();
    }, [activeTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.models.some((model) => isAiConfigReady(config, encodeChannelModel(channel.id, model.name))));
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };
    const changeTab = (key: string) => {
        if (key === "prompt-sources") void loadConfigPromptSources();
        setActiveTab(key as ConfigTabKey);
    };

    const loadConfigFile = async (file: File) => {
        try {
            const result = await importAppConfig(file);
            message.success(result.strippedScripts ? "配置已导入；其中的自定义脚本已移除" : "配置与用户偏好已导入");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "配置文件读取失败");
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));
    const addAgentScanPath = (path: string) => {
        const next = path.trim();
        if (!next || config.agentScanPaths.includes(next)) return;
        updateConfig("agentScanPaths", [...config.agentScanPaths, next]);
    };
    const removeAgentScanPath = (path: string) =>
        updateConfig(
            "agentScanPaths",
            config.agentScanPaths.filter((item) => item !== path),
        );

    const addChannel = () => {
        void loadChannelEditorDrawer();
        const channel = createModelChannel({ name: nextCustomChannelName(config.channels) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.find((channel) => channel.id === id)?.preset) {
            message.info("预设渠道会保留，可使用重置恢复初始配置");
            return;
        }
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const resetChannel = (channel: ModelChannel) => {
        modal.confirm({
            title: `重置“${channel.name}”预设渠道？`,
            content: "接口地址、模型和能力设置会恢复默认，已填写的 API Key 会被清空。",
            okText: "重置",
            cancelText: "取消",
            onOk: () => {
                const reset = resetPresetChannel(channel);
                updateChannels(config.channels.map((item) => (item.id === channel.id ? reset : item)));
                message.success(`“${reset.name}”已恢复默认配置`);
            },
        });
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个资产，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    const audioDefaultsKind = audioDefaultsKindForModel(config.audioModel);
    const audioDefaultFormatOptions =
        audioDefaultsKind === "minimax"
            ? audioFormatOptions.filter((option) => ["mp3", "wav", "flac"].includes(option.value))
            : audioDefaultsKind === "qwen"
              ? audioFormatOptions.filter((option) => ["mp3", "wav"].includes(option.value))
              : audioFormatOptions;
    const audioSpeedRange = audioDefaultsKind === "generic" ? { min: 0.25, max: 4 } : { min: 0.5, max: 2 };
    const changeDefaultModel = (group: ModelGroup, model: string) => {
        updateConfig(group.modelKey, model);
        if (group.modelKey !== "audioModel") return;
        const defaults = defaultAudioPreferencesForModel(model);
        updateConfig("audioVoice", defaults.voice);
        updateConfig("audioFormat", defaults.format);
        updateConfig("audioSpeed", defaults.speed);
        updateConfig("audioInstructions", defaults.instructions);
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">导出文件不包含 API Key 和 WebDAV 密码。</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        导入配置
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        导出配置
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={changeTab}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">每个渠道选择一个协议并拉取模型，为每个模型指定能力（生图/视频/文本/音频），并可自定义调用脚本。</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                    {channel.preset ? <Tag className="m-0 shrink-0 border-0 bg-stone-100 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">预设</Tag> : null}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {channelVendorLabel(channel)} · {channel.models.length} 个模型 · {channelConnectionLabel(channel)}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                {channel.preset ? (
                                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => resetChannel(channel)}>
                                                        重置
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    size="small"
                                                    icon={<Pencil className="size-3.5" />}
                                                    onPointerEnter={() => void loadChannelEditorDrawer()}
                                                    onFocus={() => void loadChannelEditorDrawer()}
                                                    onClick={() => setEditingChannelId(channel.id)}
                                                >
                                                    编辑
                                                </Button>
                                                {!channel.preset ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} /> : null}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "偏好设置",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="mb-5 rounded-xl border border-stone-200 p-4 dark:border-stone-800" aria-labelledby="local-storage-heading">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <Database className="mt-0.5 size-4 shrink-0 text-blue-500" />
                                            <div className="min-w-0 flex-1">
                                                <div id="local-storage-heading" className="text-sm font-semibold">本机应用数据</div>
                                                <div className="mt-1 text-xs leading-5 text-stone-500">画布、Zodiac 会话和媒体由应用自动保存在此设备。关闭后再次打开，可以从上次的位置继续。</div>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="size-3.5" />
                                            修改已自动保存在本机
                                        </div>
                                    </div>
                                    <LocalStorageLocations locations={storageLocations} error={storageLocationsError} />
                                </section>
                                <div className="mb-1 text-sm font-semibold">新任务默认模型</div>
                                <div className="mb-3 text-xs leading-5 text-stone-500">工作台会记住最后选择，并把它作为下一次创作和新建节点的初始模型；不会改动已有节点。</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => changeDefaultModel(group, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <section className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                                    <div className="mb-1 text-sm font-semibold">工作流节点默认值</div>
                                    <div className="mb-3 text-xs leading-5 text-stone-500">只在新建生成节点时复制为初始值，之后可在节点内独立修改。</div>
                                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <Form.Item label="生图张数" extra="实际范围会按所选图片模型限制。" className="mb-4">
                                            <Input
                                                type="number"
                                                min={1}
                                                max={15}
                                                value={config.canvasImageCount}
                                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                            />
                                        </Form.Item>
                                        <Form.Item label="默认音色" extra="音色列表会随默认音频模型更新；克隆或设计的音色可填写 Voice ID。" className="mb-4">
                                            <DefaultAudioVoiceField model={config.audioModel} value={config.audioVoice} onChange={(value) => updateConfig("audioVoice", value)} />
                                        </Form.Item>
                                        <Form.Item label="默认音频格式" className="mb-4">
                                            <Select
                                                value={audioDefaultFormatOptions.some((option) => option.value === config.audioFormat) ? config.audioFormat : "mp3"}
                                                options={audioDefaultFormatOptions}
                                                onChange={(value) => updateConfig("audioFormat", value)}
                                            />
                                        </Form.Item>
                                        <Form.Item label="默认音频语速" extra={`${audioSpeedRange.min}–${audioSpeedRange.max} 倍`} className="mb-4">
                                            <Input
                                                type="number"
                                                min={audioSpeedRange.min}
                                                max={audioSpeedRange.max}
                                                step={0.05}
                                                value={Math.max(audioSpeedRange.min, Math.min(audioSpeedRange.max, Number(config.audioSpeed) || 1))}
                                                onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                                onBlur={(event) => updateConfig("audioSpeed", normalizeScopedAudioSpeed(event.target.value, audioSpeedRange))}
                                            />
                                        </Form.Item>
                                    </div>
                                    {audioDefaultsKind !== "minimax" ? (
                                        <Form.Item label="默认声音指令" extra="仅用于支持声音指令的语音生成模型。" className="mb-0">
                                            <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                        </Form.Item>
                                    ) : null}
                                </section>
                                <section className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                                    <div className="mb-1 text-sm font-semibold">提示词行为</div>
                                    <div className="mb-3 text-xs leading-5 text-stone-500">不同场景分别保存，避免一条全局提示词意外改变所有生成结果。</div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="Zodiac 默认角色" extra="只影响 Zodiac 会话，不会进入媒体生成或工作流节点。" className="mb-0">
                                            <Input.TextArea rows={4} value={config.zodiacSystemPrompt} placeholder="例如：回答简洁，先给结论，再给可执行步骤。" onChange={(event) => updateConfig("zodiacSystemPrompt", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="图片提示前缀" extra="只在图片生成请求前加入，不影响视频、音频和会话。" className="mb-0">
                                            <Input.TextArea rows={4} value={config.imagePromptPrefix} placeholder="例如：电影感写实摄影，光线自然，构图克制。" onChange={(event) => updateConfig("imagePromptPrefix", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "agents",
                        label: "终端工具",
                        children: (
                            <AgentNodeSettings
                                terminalApp={config.terminalApp}
                                onTerminalAppChange={(terminalApp) => updateConfig("terminalApp", terminalApp)}
                                installations={agentInstallations}
                                scanPaths={config.agentScanPaths}
                                scannedPaths={scannedAgentPaths}
                                scanning={scanningAgents}
                                onScan={() => void scanAgents()}
                                onAddScanPath={addAgentScanPath}
                                onRemoveScanPath={removeAgentScanPath}
                            />
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: "提示词来源",
                        children:
                            activeTab === "prompt-sources" ? (
                                <Suspense fallback={<div className="flex min-h-32 items-center justify-center text-xs text-stone-500">正在打开提示词来源...</div>}>
                                    <ConfigPromptSources />
                                </Suspense>
                            ) : null,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的资产、生成记录和本地媒体文件，不包含 AI API Key；应用会直接连接 WebDAV 服务。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="workflowgenerator" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "updates",
                        label: "软件更新",
                        children: <AppUpdateSettings />,
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex items-center justify-end gap-3">
                    <span className="text-xs text-stone-500">修改已自动保存在本机</span>
                    <Button type="primary" onClick={finishConfig}>
                        关闭
                    </Button>
                </div>
            ) : null}
            {editingChannel ? (
                <Suspense fallback={null}>
                    <ChannelEditorDrawer open channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
                </Suspense>
            ) : null}
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、默认模型和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function AgentNodeSettings({
    terminalApp,
    onTerminalAppChange,
    installations,
    scanPaths,
    scannedPaths,
    scanning,
    onScan,
    onAddScanPath,
    onRemoveScanPath,
}: {
    terminalApp: ExternalTerminalApp;
    onTerminalAppChange: (terminalApp: ExternalTerminalApp) => void;
    installations: LocalAgentInstallation[];
    scanPaths: string[];
    scannedPaths: string[];
    scanning: boolean;
    onScan: () => void;
    onAddScanPath: (path: string) => void;
    onRemoveScanPath: (path: string) => void;
}) {
    const [pathDraft, setPathDraft] = useState("");
    const [showMissing, setShowMissing] = useState(false);
    const foundInstallations = installations.filter((installation) => installation.path);
    const missingInstallations = installations.filter((installation) => !installation.path);

    return (
        <div className="space-y-3">
            <section className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-800 dark:bg-stone-900/30">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Bot className="size-4" />
                            本机终端工具
                        </div>
                        <div className="mt-1 text-xs text-stone-500">已发现 {foundInstallations.length} 个。它们可以直接在终端节点中运行。</div>
                    </div>
                    <Button icon={<ScanLine className="size-4" />} loading={scanning} onClick={onScan}>
                        扫描本机
                    </Button>
                </div>
                <div className="mt-4 max-w-sm">
                    <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">默认外部终端</div>
                    <Select
                        value={terminalApp}
                        className="w-full"
                        onChange={(value) => onTerminalAppChange(value as ExternalTerminalApp)}
                        options={[
                            { value: "terminal", label: "macOS Terminal" },
                            { value: "ghostty", label: "Ghostty" },
                        ]}
                    />
                    <div className="mt-1.5 text-[11px] text-stone-500">从终端节点的设置面板可按此偏好打开当前工作目录。</div>
                </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                {foundInstallations.length ? (
                    foundInstallations.map((installation, index) => {
                        return (
                            <div key={installation.id} className={index ? "border-t border-stone-200 dark:border-stone-800" : ""}>
                                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <CheckCircle2 className="size-4 text-emerald-500" />
                                            {installation.name}
                                        </div>
                                        <div className="mt-1 font-mono text-[11px] text-stone-500">{installation.command}</div>
                                    </div>
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">可运行</span>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="px-4 py-8 text-center text-sm text-stone-500">还没有发现可用终端工具。可以重新扫描，或添加扫描位置。</div>
                )}
            </section>

            {missingInstallations.length ? (
                <button type="button" onClick={() => setShowMissing((value) => !value)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs text-stone-500 transition hover:bg-stone-100 dark:hover:bg-stone-900">
                    <span>未发现的工具（{missingInstallations.length}）</span>
                    <span>{showMissing ? "收起" : "查看"}</span>
                </button>
            ) : null}
            {showMissing ? (
                <div className="flex flex-wrap gap-2 px-2 pb-1">
                    {missingInstallations.map((installation) => (
                        <span key={installation.id} className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-500 dark:bg-stone-900">
                            <CircleAlert className="size-3" />
                            {installation.name}
                        </span>
                    ))}
                </div>
            ) : null}

            <details className="group rounded-xl border border-stone-200 dark:border-stone-800">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
                    <span>扫描位置</span>
                    <span className="text-xs font-normal text-stone-500">{scannedPaths.length ? `当前 ${scannedPaths.length} 个位置` : "添加自定义位置"}</span>
                </summary>
                <div className="border-t border-stone-200 p-4 dark:border-stone-800">
                    <div className="flex gap-2">
                        <Input
                            value={pathDraft}
                            placeholder="添加要扫描的本机工具目录"
                            onChange={(event) => setPathDraft(event.target.value)}
                            onPressEnter={() => {
                                onAddScanPath(pathDraft);
                                setPathDraft("");
                            }}
                        />
                        <Button
                            onClick={() => {
                                onAddScanPath(pathDraft);
                                setPathDraft("");
                            }}
                        >
                            添加
                        </Button>
                    </div>
                    {scanPaths.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {scanPaths.map((path, index) => (
                                <span
                                    key={path}
                                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-50 py-1 pl-2 pr-1 font-mono text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                                >
                                    <span className="max-w-[360px] truncate">{localLocationLabel(path, `自定义位置 ${index + 1}`)}</span>
                                    <button type="button" className="grid size-5 place-items-center rounded hover:bg-stone-200 dark:hover:bg-stone-800" aria-label={`移除自定义位置 ${index + 1}`} onClick={() => onRemoveScanPath(path)}>
                                        <X className="size-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {scannedPaths.length ? (
                        <div className="mt-4 text-xs text-stone-500">
                            <div className="mb-2">本次扫描位置</div>
                            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                                {scannedPaths.map((path, index) => (
                                    <span key={path} className="rounded bg-stone-100 px-1.5 py-1 font-mono text-[10px] dark:bg-stone-900">
                                        {localLocationLabel(path, `系统位置 ${index + 1}`)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            </details>
        </div>
    );
}

function localLocationLabel(path: string, fallback: string) {
    const name = path.replace(/\\/gu, "/").replace(/\/+$/gu, "").split("/").at(-1);
    return name ? `…/${name}` : fallback;
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function normalizeScopedAudioSpeed(value: string, range: { min: number; max: number }) {
    const normalized = Number(normalizeAudioSpeedValue(value));
    return String(Math.max(range.min, Math.min(range.max, normalized)));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    return providerLabel(apiFormat);
}

function channelConnectionLabel(channel: ModelChannel) {
    return channel.baseUrl || "未填写接口地址";
}

function channelVendorLabel(channel: ModelChannel) {
    const vendor = getModelVendor(channel.vendor || legacyVendorForApiFormat(channel.apiFormat));
    return vendor?.label || apiFormatLabel(channel.apiFormat);
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
