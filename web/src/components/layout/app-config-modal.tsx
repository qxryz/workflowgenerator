import { App, Button, Form, Input, Modal, Progress, Select, Tabs, Tag } from "antd";
import { Cloud, Download, Languages, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Upload, Wifi } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { ConfigRunConnections } from "@/components/layout/config-run-connections";
import { ConfigUpdates } from "@/components/layout/config-updates";
import { ModelPicker } from "@/components/model-picker";
import { useAppTranslation } from "@/hooks/use-app-translation";
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
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";
import { providerLabel } from "@/lib/model-providers";
import { getModelVendor, legacyVendorForApiFormat } from "@/lib/model-catalog";

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

function DefaultAudioVoiceField({ model, value, onChange }: { model: string; value: string; onChange: (value: string) => void }) {
    const { t } = useAppTranslation();
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
                options={[...presets, { value: customAudioVoiceValue, label: t("自定义音色 ID") }]}
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
                    aria-label={t("自定义音色 ID")}
                    placeholder={t("输入已创建的 Voice ID")}
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
    const { language, t } = useAppTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
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

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.models.some((model) => isAiConfigReady(config, encodeChannelModel(channel.id, model.name))));
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存"));
        clearPromptContinue();
    };
    const changeTab = (key: string) => {
        if (key === "prompt-sources") void loadConfigPromptSources();
        setActiveTab(key as ConfigTabKey);
    };

    const loadConfigFile = async (file: File) => {
        try {
            const result = await importAppConfig(file);
            message.success(t(result.strippedScripts ? "配置已导入；其中的自定义脚本已移除" : "配置与用户偏好已导入"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("配置文件读取失败"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        void loadChannelEditorDrawer();
        const channel = createModelChannel({ name: nextCustomChannelName(config.channels) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.find((channel) => channel.id === id)?.preset) {
            message.info(t("预设渠道会保留，可使用重置恢复初始配置"));
            return;
        }
        if (config.channels.length <= 1) {
            message.warning(t("至少保留一个渠道"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const resetChannel = (channel: ModelChannel) => {
        modal.confirm({
            title: t("重置“{name}”预设渠道？", { name: channel.name }),
            content: t("接口地址、模型和能力设置会恢复默认，已填写的 API Key 会被清空。"),
            okText: t("重置"),
            cancelText: t("取消"),
            onOk: () => {
                const reset = resetPresetChannel(channel);
                updateChannels(config.channels.map((item) => (item.id === channel.id ? reset : item)));
                message.success(t("“{name}”已恢复默认配置", { name: reset.name }));
            },
        });
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("请先填写 WebDAV 地址"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("WebDAV 连接可用"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("WebDAV 连接测试失败"));
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
            message.error(t("请先填写 WebDAV 地址"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("准备同步"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("同步完成：{projects} 个画布，{assets} 个资产，本次上传 {files} 个文件 {bytes}", { projects: result.projects, assets: result.assets, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("WebDAV 同步失败"));
            message.error(error instanceof Error ? error.message : t("WebDAV 同步失败"));
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
                <div className="text-xs text-stone-500">{t("导出文件不包含 API Key 和 WebDAV 密码。")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("导入配置")}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        {t("导出配置")}
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
                        label: t("渠道"),
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">{t("每个渠道选择一个协议并拉取模型，为每个模型指定能力（生图/视频/文本/音频），并可自定义调用脚本。")}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        {t("新增渠道")}
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <div className="truncate text-sm font-semibold">{channel.name || t("未命名渠道")}</div>
                                                    {channel.preset ? <Tag className="m-0 shrink-0 border-0 bg-stone-100 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">{t("预设")}</Tag> : null}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {channelVendorLabel(channel)} · {t("{count} 个模型", { count: channel.models.length })} · {t(channelConnectionLabel(channel))}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                {channel.preset ? (
                                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => resetChannel(channel)}>
                                                        {t("重置")}
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    size="small"
                                                    icon={<Pencil className="size-3.5" />}
                                                    onPointerEnter={() => void loadChannelEditorDrawer()}
                                                    onFocus={() => void loadChannelEditorDrawer()}
                                                    onClick={() => setEditingChannelId(channel.id)}
                                                >
                                                    {t("编辑")}
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
                        key: "agents",
                        label: t("本地与网络"),
                        children: activeTab === "agents" ? <ConfigRunConnections /> : null,
                    },
                    {
                        key: "updates",
                        label: t("软件更新"),
                        children: activeTab === "updates" ? <ConfigUpdates /> : null,
                    },
                    {
                        key: "preferences",
                        label: t("偏好设置"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="mb-5 rounded-xl border border-stone-200 p-4 dark:border-stone-800" aria-labelledby="app-language-heading">
                                    <div className="flex flex-wrap items-center justify-between gap-4">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <Languages className="mt-0.5 size-4 shrink-0 text-blue-500" />
                                            <div>
                                                <div id="app-language-heading" className="text-sm font-semibold">
                                                    {t("应用语言")}
                                                </div>
                                                <div className="mt-1 text-xs leading-5 text-stone-500">{t("选择应用界面使用的语言，切换后立即生效。")}</div>
                                            </div>
                                        </div>
                                        <Select
                                            value={config.language}
                                            aria-label={t("应用语言")}
                                            className="w-full sm:w-48"
                                            options={[
                                                { value: "zh-CN", label: "中文（简体）" },
                                                { value: "en-US", label: "English" },
                                            ]}
                                            onChange={(language) => updateConfig("language", language)}
                                        />
                                    </div>
                                </section>
                                <div className="mb-1 text-sm font-semibold">{t("新任务默认模型")}</div>
                                <div className="mb-3 text-xs leading-5 text-stone-500">{t("工作台会记住最后选择，并把它作为下一次创作和新建节点的初始模型；不会改动已有节点。")}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.defaultLabel)} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => changeDefaultModel(group, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <section className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                                    <div className="mb-1 text-sm font-semibold">{t("工作流节点默认值")}</div>
                                    <div className="mb-3 text-xs leading-5 text-stone-500">{t("只在新建生成节点时复制为初始值，之后可在节点内独立修改。")}</div>
                                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <Form.Item label={t("生图张数")} extra={t("实际范围会按所选图片模型限制。")} className="mb-4">
                                            <Input
                                                type="number"
                                                min={1}
                                                max={15}
                                                value={config.canvasImageCount}
                                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                            />
                                        </Form.Item>
                                        <Form.Item label={t("默认音色")} extra={t("音色列表会随默认音频模型更新；克隆或设计的音色可填写 Voice ID。")} className="mb-4">
                                            <DefaultAudioVoiceField model={config.audioModel} value={config.audioVoice} onChange={(value) => updateConfig("audioVoice", value)} />
                                        </Form.Item>
                                        <Form.Item label={t("默认音频格式")} className="mb-4">
                                            <Select
                                                value={audioDefaultFormatOptions.some((option) => option.value === config.audioFormat) ? config.audioFormat : "mp3"}
                                                options={audioDefaultFormatOptions}
                                                onChange={(value) => updateConfig("audioFormat", value)}
                                            />
                                        </Form.Item>
                                        <Form.Item label={t("默认音频语速")} extra={t("{min}–{max} 倍", audioSpeedRange)} className="mb-4">
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
                                        <Form.Item label={t("默认声音指令")} extra={t("仅用于支持声音指令的语音生成模型。")} className="mb-0">
                                            <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("例如：自然、温暖、适合旁白。")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                        </Form.Item>
                                    ) : null}
                                </section>
                                <section className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                                    <div className="mb-1 text-sm font-semibold">{t("提示词行为")}</div>
                                    <div className="mb-3 text-xs leading-5 text-stone-500">{t("不同场景分别保存，避免一条全局提示词意外改变所有生成结果。")}</div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("Zodiac 默认角色")} extra={t("只影响 Zodiac 会话，不会进入媒体生成或工作流节点。")} className="mb-0">
                                            <Input.TextArea rows={4} value={config.zodiacSystemPrompt} placeholder={t("例如：回答简洁，先给结论，再给可执行步骤。")} onChange={(event) => updateConfig("zodiacSystemPrompt", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("图片提示前缀")} extra={t("只在图片生成请求前加入，不影响视频、音频和会话。")} className="mb-0">
                                            <Input.TextArea rows={4} value={config.imagePromptPrefix} placeholder={t("例如：电影感写实摄影，光线自然，构图克制。")} onChange={(event) => updateConfig("imagePromptPrefix", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                </section>

                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: t("提示词来源"),
                        children:
                            activeTab === "prompt-sources" ? (
                                <Suspense fallback={<div className="flex min-h-32 items-center justify-center text-xs text-stone-500">{t("正在打开提示词来源...")}</div>}>
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
                                                {t("云端同步")}
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">{t("同步画布、我的资产、生成记录和本地媒体文件，不包含 AI API Key；应用会直接连接 WebDAV 服务。")}</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? t("上次同步 {time}", { time: formatWebdavTime(webdav.lastSyncedAt, language) }) : t("尚未同步")}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("WebDAV 地址")} className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("远程目录")} extra={t("会在该目录下分业务目录保存，每个目录包含 {manifest} 和 files/", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                            <Input value={webdav.directory} placeholder="workflowgenerator" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("用户名")} className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("密码 / 应用密码")} className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            {t("测试连接")}
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {t(syncingWebdav ? "同步中" : "立即同步")}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex items-center justify-end gap-3">
                    <span className="text-xs text-stone-500">{t("修改已自动保存在本机")}</span>
                    <Button type="primary" onClick={finishConfig}>
                        {t("关闭")}
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
    const { t } = useAppTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("配置与用户偏好")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("渠道聚合、默认模型和同步偏好")}</div>
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

function formatWebdavTime(value: string, language: string) {
    return new Date(value).toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    const { t } = useAppTranslation();
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(item.label)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage.startsWith("上传清单 ")
                                    ? t("上传清单 {size}", { size: item.stage.slice("上传清单 ".length) })
                                    : item.stage.startsWith("上传媒体 ")
                                      ? t("上传媒体 {size}", { size: item.stage.slice("上传媒体 ".length) })
                                      : t(item.stage)}
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
