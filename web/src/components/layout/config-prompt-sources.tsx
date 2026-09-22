import { App, Button, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { PROMPT_SOURCE_INTERVAL_OPTIONS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];
const loadPromptSourceContentModal = () => import("./prompt-source-content-modal");
const PromptSourceContentModal = lazy(() => loadPromptSourceContentModal().then((module) => ({ default: module.PromptSourceContentModal })));

export function ConfigPromptSources() {
    const { message, modal } = App.useApp();
    const { language, t } = useAppTranslation();
    const queryClient = useQueryClient();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });

    const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);
    const viewingSource = sources.find((item) => item.id === viewingId) || null;

    const invalidatePrompts = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["prompts"] }), queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }), queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })]);
    };

    const handleSave = (source: PromptSource) => {
        saveSource(source);
        void invalidatePrompts();
    };

    const handleDelete = (source: PromptSource) => {
        modal.confirm({
            title: t("删除「{name}」？", { name: source.name }),
            content: t("来源配置会被移除，已经加入我的资产的内容不受影响。"),
            okText: t("删除"),
            okButtonProps: { danger: true },
            cancelText: t("取消"),
            onOk: async () => {
                removeSource(source.id);
                await invalidatePrompts();
            },
        });
    };

    const handleRefreshOne = async (source: PromptSource) => {
        setRefreshingId(source.id);
        try {
            const result = await refreshSource(source.id);
            await invalidatePrompts();
            message.success(t("「{name}」已更新 {count} 条", { name: source.name, count: result.count }));
        } catch (error) {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.error(error instanceof Error ? error.message : t("更新失败，已保留旧缓存"));
        } finally {
            setRefreshingId("");
        }
    };

    const handleRefreshAll = async () => {
        setRefreshingAll(true);
        try {
            const result = await refreshAllSources();
            updateSchedule("lastFetchedAt", new Date().toISOString());
            await invalidatePrompts();
            if (result.failureCount) message.warning(t("更新完成：{success} 个成功，{failure} 个失败，失败来源已保留旧缓存", { success: result.successCount, failure: result.failureCount }));
            else message.success(t("已更新 {sources} 个来源，共 {total} 条", { sources: result.successCount, total: result.total }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("更新失败"));
        } finally {
            setRefreshingAll(false);
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditingSource(addSource())}>
                    {t("新增来源")}
                </Button>
            </div>

            <div className="space-y-2">
                {sources.map((source) => {
                    const status = statusQuery.data?.[source.id];
                    return (
                        <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <Switch
                                size="small"
                                checked={source.enabled}
                                onChange={(checked) => {
                                    toggleSource(source.id, checked);
                                    void invalidatePrompts();
                                }}
                            />
                            <div className="min-w-[220px] flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-semibold">{source.name}</span>
                                    <Tag color={source.origin === "wg" ? "blue" : "default"} className="m-0 shrink-0 text-[10px]">
                                        {t(source.origin === "wg" ? "WG 官方镜像" : "社区来源")}
                                    </Tag>
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                                    <a className="max-w-full truncate hover:text-stone-800 hover:underline dark:hover:text-stone-200" href={source.homepage || source.url} target="_blank" rel="noreferrer">
                                        {source.homepage || source.url}
                                    </a>
                                    <span className="tabular-nums">{t("{count} 条", { count: status?.count ?? 0 })}</span>
                                    {status?.lastError ? (
                                        <Tag color="error" className="m-0 text-[10px]" title={status.lastError}>
                                            {t("失败")}
                                        </Tag>
                                    ) : status?.lastSuccessAt ? (
                                        <Tag color="success" className="m-0 text-[10px]">
                                            {t("正常")}
                                        </Tag>
                                    ) : (
                                        <Tag className="m-0 text-[10px]">{t("未同步")}</Tag>
                                    )}
                                    <span>{status?.lastSuccessAt ? t("上次成功 {time}", { time: formatTime(status.lastSuccessAt, language) }) : t("尚未拉取")}</span>
                                </div>
                            </div>
                            <div className="ml-auto flex flex-wrap justify-end gap-2">
                                <Button size="small" icon={<Eye className="size-3.5" />} onPointerEnter={() => void loadPromptSourceContentModal()} onFocus={() => void loadPromptSourceContentModal()} onClick={() => setViewingId(source.id)}>
                                    {t("查看内容")}
                                </Button>
                                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={refreshingId === source.id} onClick={() => void handleRefreshOne(source)}>
                                    {t("立即拉取")}
                                </Button>
                                {!source.builtIn ? (
                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingSource(source)}>
                                        {t("编辑来源")}
                                    </Button>
                                ) : null}
                                {!source.builtIn ? (
                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(source)}>
                                        {t("删除")}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>

            <section className="mt-5 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="mb-3 text-sm font-semibold">{t("定时拉取")}</div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">{t("拉取周期")}</span>
                        <Select size="small" className="w-36" value={schedule.intervalMinutes} options={PROMPT_SOURCE_INTERVAL_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={(value) => updateSchedule("intervalMinutes", value)} />
                    </div>
                    <Button size="small" type="primary" icon={<RefreshCw className="size-3.5" />} loading={refreshingAll} onClick={() => void handleRefreshAll()}>
                        {t("全部立即拉取")}
                    </Button>
                    <span className="text-xs text-stone-500">{schedule.lastFetchedAt ? t("上次拉取 {time}", { time: formatTime(schedule.lastFetchedAt, language) }) : t("尚未定时拉取")}</span>
                </div>
                <div className="mt-2 text-xs text-stone-400">{t("开启周期后，页面打开期间会按周期自动拉取所有启用的来源。")}</div>
            </section>

            <PromptSourceEditorDrawer open={Boolean(editingSource)} source={editingSource} onSave={handleSave} onClose={() => setEditingSource(null)} />
            {viewingSource ? (
                <Suspense fallback={null}>
                    <PromptSourceContentModal source={viewingSource} onClose={() => setViewingId("")} />
                </Suspense>
            ) : null}
        </div>
    );
}

function formatTime(value: string, language: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
