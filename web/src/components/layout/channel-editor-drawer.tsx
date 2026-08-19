import { Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { Check, ChevronDown, ChevronUp, ListPlus, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { createModelChannel, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { adapterCapabilitySupport, adapterForLegacyProtocol, capabilitySupportLabel, getModelAdapter, legacyApiFormatForAdapter, modelAdapters, type AdapterId } from "@/lib/model-adapters";
import { defaultAdapterForVendor, legacyApiFormatForVendor, legacyVendorForApiFormat, modelCatalog, modelVendors, recommendedCatalogModelsForVendor, resolveAdapterForModel, type VendorId } from "@/lib/model-catalog";
import { miniMaxCredentialError as getMiniMaxCredentialError } from "@/lib/minimax-contract";
import { ModelSelectModal } from "./model-select-modal";

const loadModelScriptEditor = () => import("./model-script-editor");
const ModelScriptEditor = lazy(() => loadModelScriptEditor().then((module) => ({ default: module.ModelScriptEditor })));

const vendorOptions = modelVendors.map((vendor) => ({ label: vendor.label, value: vendor.id }));
const adapterOptions = modelAdapters.map((adapter) => ({ label: adapter.label, value: adapter.id }));

const capabilityOptions: Array<{ label: string; value: ModelCapability }> = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];
const capabilityOrder: ModelCapability[] = ["text", "image", "video", "audio"];

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useAppTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [recommendedExpanded, setRecommendedExpanded] = useState(false);

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const currentVendor: VendorId = (draft.vendor as VendorId) || legacyVendorForApiFormat(draft.apiFormat);
    const currentVendorDefaultBaseUrl = modelVendors.find((item) => item.id === currentVendor)?.defaultBaseUrl || "";
    const currentVendorAdapter = defaultAdapterForVendor(currentVendor);
    const isMiniMaxVendor = currentVendor === "minimax-token-plan" || currentVendor === "minimax-api";
    const miniMaxCredentialMode = currentVendor === "minimax-token-plan" ? "token-plan" : currentVendor === "minimax-api" ? "payg" : null;
    const minimaxCredentialError = miniMaxCredentialMode ? getMiniMaxCredentialError(miniMaxCredentialMode, draft.apiKey) : "";

    const changeVendor = (vendorId: VendorId) => {
        const vendor = modelVendors.find((item) => item.id === vendorId);
        if (!vendor) return;
        const adapter = defaultAdapterForVendor(vendorId);
        const apiFormat = legacyApiFormatForVendor(vendorId) as ApiCallFormat;
        const customPlaceholder = "https://example.com";
        if (vendorId === "custom") {
            setRecommendedExpanded(false);
            patch({ vendor: vendorId, apiFormat, adapter, baseUrl: customPlaceholder, apiKey: "", models: [] });
            return;
        }
        const isDefaultBaseUrl = !draft.baseUrl.trim() || (currentVendorDefaultBaseUrl && draft.baseUrl.trim() === currentVendorDefaultBaseUrl);
        const baseUrl = isDefaultBaseUrl ? vendor.defaultBaseUrl || draft.baseUrl : draft.baseUrl;
        setRecommendedExpanded(false);
        patch({
            vendor: vendorId,
            apiFormat,
            adapter,
            baseUrl,
            apiKey: vendorId === currentVendor ? draft.apiKey : "",
            models: [],
        });
    };

    const changeAdapter = (adapterId: AdapterId) => {
        if ((currentVendor === "minimax-token-plan" || currentVendor === "minimax-api") && adapterId !== currentVendorAdapter) return;
        const nextAdapter = getModelAdapter(adapterId);
        if (!nextAdapter) return;
        const apiFormat = legacyApiFormatForAdapter(adapterId) as ApiCallFormat;
        const customPlaceholder = "https://example.com";
        if (adapterId === "custom") {
            setRecommendedExpanded(false);
            patch({ apiFormat, adapter: adapterId, baseUrl: customPlaceholder, models: [] });
            return;
        }
        const isDefaultBaseUrl = !draft.baseUrl.trim() || (adapter.defaultBaseUrl && draft.baseUrl.trim() === adapter.defaultBaseUrl);
        const baseUrl = isDefaultBaseUrl ? nextAdapter.defaultBaseUrl || draft.baseUrl : draft.baseUrl;
        setRecommendedExpanded(false);
        patch({ apiFormat, adapter: adapterId, baseUrl, models: [] });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        const selectedModels = names.map((name) => ({ ...(map.get(name) || { name, capability: guessCapability(name) }), provider: draft.apiFormat, ...(currentVendor === "minimax-token-plan" || currentVendor === "minimax-api" ? { adapter: currentVendorAdapter } : {}) }));
        setModels(selectedModels);
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));
    const addPreset = (entry: { name: string; label: string; capability: ModelCapability; description: string; adapter?: string }) => {
        if (draft.models.some((model) => model.name === entry.name)) return;
        setModels([...draft.models, { name: entry.name, capability: entry.capability, provider: draft.apiFormat, adapter: entry.adapter }]);
    };
    const adapter = getModelAdapter(draft.adapter || adapterForLegacyProtocol(draft.apiFormat).id) || modelAdapters[0];
    const recommended = currentVendor === "custom" ? modelCatalog : recommendedCatalogModelsForVendor(currentVendor);
    const enabledCapabilities: ModelCapability[] = (["text", "image", "video", "audio"] as ModelCapability[]).filter((capability) => draft.capabilities?.[capability] ?? adapterCapabilitySupport(adapter.id, capability) !== "unsupported");
    const visibleRecommended = recommended.filter((entry) => enabledCapabilities.includes(entry.capability));
    const RECOMMENDED_COLLAPSED_ROWS = 3;
    const RECOMMENDED_COLLAPSED_COUNT = RECOMMENDED_COLLAPSED_ROWS * 2;
    const recommendedOverflows = visibleRecommended.length > RECOMMENDED_COLLAPSED_COUNT;
    const visibleRecommendedList = recommendedOverflows && !recommendedExpanded ? visibleRecommended.slice(0, RECOMMENDED_COLLAPSED_COUNT) : visibleRecommended;
    const save = () => {
        if (minimaxCredentialError) return;
        const models = normalizeChannelModels(draft.models, draft.apiFormat);
        onSave(createModelChannel({ ...draft, name: draft.name.trim() || "未命名渠道", models }));
        onClose();
    };

    return (
        <Drawer
            open={open}
            size={640}
            title={t("编辑渠道")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("取消")}</Button>
                    <Button type="primary" disabled={Boolean(minimaxCredentialError)} onClick={save}>
                        {t("保存")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("渠道名称")}</span>
                    <Input value={draft.name} disabled={Boolean(draft.preset)} onChange={(event) => patch({ name: event.target.value })} />
                    {draft.preset ? <span className="mt-1 block text-xs text-stone-500">{t("预设渠道名称保持固定，连接信息和模型仍可调整。")}</span> : null}
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("厂商")}</span>
                    <Select className="w-full" value={currentVendor} options={vendorOptions} onChange={(value) => changeVendor(value as VendorId)} />
                    <span className="mt-1 block text-xs text-stone-500">{modelVendors.find((vendor) => vendor.id === currentVendor)?.description}</span>
                </label>
                {!isMiniMaxVendor ? (
                    <label className="block md:col-span-2">
                        <span className="mb-1 block text-sm font-medium">{t("接入方式（适配器）")}</span>
                        <Select className="w-full" value={adapter.id} options={adapterOptions} onChange={(value) => changeAdapter(value as AdapterId)} />
                        <span className="mt-1 block text-xs text-stone-500">{adapter.description}</span>
                    </label>
                ) : null}
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("能力开关")}</span>
                    <div className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {capabilityOrder.map((capability) => {
                                const support = adapterCapabilitySupport(adapter.id, capability);
                                const enabled = draft.capabilities?.[capability] ?? support !== "unsupported";
                                const disabled = support === "unsupported";
                                return (
                                    <button
                                        key={capability}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => patch({ capabilities: { ...draft.capabilities, [capability]: !enabled } })}
                                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50"
                                        style={{
                                            background: disabled ? "rgba(0,0,0,0.05)" : enabled ? (support === "script" ? "rgba(245,158,11,0.16)" : "rgba(16,185,129,0.16)") : "rgba(0,0,0,0.05)",
                                            color: disabled ? "#9ca3af" : enabled ? (support === "script" ? "#b45309" : "#047857") : "#9ca3af",
                                            border: `1px solid ${disabled ? "transparent" : enabled ? (support === "script" ? "#f59e0b" : "#10b981") : "#d1d5db"}`,
                                        }}
                                    >
                                        {enabled ? <Check className="size-3" /> : null}
                                        {t(capability === "text" ? "文本" : capability === "image" ? "图片" : capability === "video" ? "视频" : "音频")} · {t(capabilitySupportLabel(support))}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="mt-1.5 block text-[11px] text-stone-500">
                            {t("关闭的能力不会出现在推荐模型里；原生或脚本支持的能力可自由开关。")}
                        </span>
                    </div>
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("接口地址")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                    {currentVendor === "qwen" ? <span className="mt-1 block text-xs text-stone-500">{t("默认区域：华北 2（北京）")}</span> : null}
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{currentVendor === "minimax-token-plan" ? "Token Plan Key" : "API Key"}</span>
                    <Input.Password
                        status={minimaxCredentialError ? "error" : undefined}
                        value={draft.apiKey}
                        onChange={(event) => patch({ apiKey: event.target.value })}
                        placeholder={currentVendor === "minimax-token-plan" ? "sk-cp-..." : currentVendor === "minimax-api" ? "sk-api-..." : "sk-..."}
                    />
                    {miniMaxCredentialMode ? (
                        <span className={`mt-1 block text-xs ${minimaxCredentialError ? "text-red-500" : "text-stone-500"}`}>
                            {minimaxCredentialError || t(miniMaxCredentialMode === "token-plan" ? "Token Plan Key 应以 sk-cp 开头" : "按量计费 API Key 应以 sk-api 开头")}
                        </span>
                    ) : null}
                </label>
            </div>

            <div className="mt-6">
                <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold">{t("推荐模型")}</div>
                        <div className="mt-0.5 text-xs text-stone-500">{t("精选已适配模型，添加后即可在对应工作台和画布节点中使用。")}</div>
                    </div>
                    <span className="text-xs text-stone-400">{modelVendors.find((vendor) => vendor.id === currentVendor)?.label || t("自定义")}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {visibleRecommendedList.map((entry) => {
                        const added = draft.models.some((model) => model.name === entry.name);
                        const adapterLabel = getModelAdapter(entry.adapter || resolveAdapterForModel(entry.name, entry.capability))?.label || t("自定义");
                        return (
                            <button
                                key={entry.name}
                                type="button"
                                disabled={added}
                                className="flex min-h-16 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2 text-left transition hover:border-stone-400 disabled:cursor-default disabled:opacity-55 dark:border-stone-800 dark:hover:border-stone-600"
                                onClick={() => addPreset(entry)}
                            >
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white" style={{ background: modelVendors.find((vendor) => vendor.id === entry.vendor)?.accent || "#64748b" }}>
                                    {t(entry.capability === "image" ? "图" : entry.capability === "video" ? "影" : entry.capability === "audio" ? "声" : "文")}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{entry.label}</span>
                                    <span className="mt-0.5 block truncate text-xs text-stone-500">{entry.description} · {adapterLabel}</span>
                                </span>
                                <span className="shrink-0 text-xs font-medium" style={{ color: added ? undefined : modelVendors.find((vendor) => vendor.id === entry.vendor)?.accent || "#64748b" }}>
                                    {t(added ? "已添加" : "+ 添加")}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {recommendedOverflows ? (
                    <button
                        type="button"
                        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-800 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-stone-100"
                        onClick={() => setRecommendedExpanded((current) => !current)}
                    >
                        {recommendedExpanded ? (
                            <>
                                <ChevronUp className="size-3.5" />
                                {t("收起")}
                            </>
                        ) : (
                            <>
                                <ChevronDown className="size-3.5" />
                                {t("展开全部（{count} 个）", { count: visibleRecommended.length })}
                            </>
                        )}
                    </button>
                ) : null}
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("渠道模型")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("已选 {count} 个；模型会自动使用对应的创作参数面板。", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" disabled={Boolean(minimaxCredentialError)} icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("选择模型")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => {
                        return (
                            <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                    {model.name}
                                </span>
                                <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                    {getModelAdapter(model.adapter || resolveAdapterForModel(model.name, model.capability))?.label || t("自定义")}
                                </span>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Segmented size="small" value={model.capability} options={capabilityOptions.map((option) => ({ ...option, label: t(option.label) }))} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                    <Button
                                        size="small"
                                        type={model.script ? "primary" : "default"}
                                        ghost={Boolean(model.script)}
                                        onPointerEnter={() => {
                                            void loadModelScriptEditor();
                                        }}
                                        onFocus={() => {
                                            void loadModelScriptEditor();
                                        }}
                                        onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}
                                    >
                                        {t(model.script ? "脚本已设" : "高级脚本")}
                                    </Button>
                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("点击「选择模型」拉取或手动增加模型。")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            {scriptTarget ? (
                <Suspense fallback={null}>
                    <ModelScriptEditor open capability={scriptTarget.capability} modelName={scriptTarget.name} value={scriptTarget.value} onSave={(script) => setScript(scriptTarget.name, script)} onClose={() => setScriptTarget(null)} />
                </Suspense>
            ) : null}
        </Drawer>
    );
}
