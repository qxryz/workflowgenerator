import { useMemo, useState } from "react";
import copyToClipboard from "copy-to-clipboard";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Copy, ExternalLink, FileCode2, Image, Search, Settings2, Video, Volume2 } from "lucide-react";
import { Link } from "react-router-dom";

import { imageOutputParameterLabel, inferModelProvider, modelUiAdaptation, type ProviderModelCapability, type ProviderProtocol } from "@/lib/model-providers";
import { PLUGIN_RETURNS, PLUGIN_TEMPLATES, PLUGIN_VARIABLES } from "@/services/api/model-plugin";
import { useConfigStore, type ChannelModel } from "@/stores/use-config-store";
import { adapterCapabilitySupport, capabilitySupportLabel, isMiniMaxAdapter } from "@/lib/model-adapters";
import { getModelVendor, legacyApiFormatForVendor, modelVendors, recommendedCatalogModelsForVendor, resolveAdapterForModel, type CatalogModelEntry, type ModelVendorDefinition, type VendorId } from "@/lib/model-catalog";
import { type AdapterId } from "@/lib/model-adapters";
import { isMiniMaxTextModel, miniMaxNativeRoutesForModel, type MiniMaxNativeRoute } from "@/lib/minimax-contract";
import { qwenAudioNativeRoutesForModel } from "@/lib/qwen-audio-contract";
import { ZodiacFlowDoc } from "./zodiac-flow-doc";
import { AssetFilesDoc } from "./asset-files-doc";
import { modelApiParameterDoc, type ModelApiParameterRow } from "./model-api-parameters";

type DocumentModel = { vendor: ModelVendorDefinition; model: CatalogModelEntry; adapter: AdapterId; key: string };
type ScriptExample = { label: string; script: string; source: "saved" | "template" };
type ParameterRow = Omit<ModelApiParameterRow, "ui"> & { ui?: string };
type DocumentationNativeRoute = {
    id: string;
    label: string;
    method: "GET" | "POST";
    path: string;
    docsUrl: string;
    note: string;
    paygOnly?: boolean;
};

const capabilityMeta: Record<ProviderModelCapability, { label: string; navLabel: string; Icon: typeof Image }> = {
    image: { label: "图片", navLabel: "图片生成 API", Icon: Image },
    video: { label: "视频", navLabel: "视频生成 API", Icon: Video },
    text: { label: "文本", navLabel: "文本生成 API", Icon: Code2 },
    audio: { label: "语音", navLabel: "语音生成 API", Icon: Volume2 },
};

const capabilityOrder: ProviderModelCapability[] = ["image", "video", "text", "audio"];
const ARCHITECTURE_KEY = "__architecture__";
const UI_PATHS_KEY = "__ui_paths__";
const ZODIAC_FLOW_KEY = "__zodiac_flow__";
const ASSET_FILES_KEY = "__asset_files__";
const referenceDocs = [
    { key: ARCHITECTURE_KEY, label: "架构与新增渠道示例", color: "#117c8e" },
    { key: UI_PATHS_KEY, label: "绑定模型的原生 UI 解释", color: "#db2777" },
    { key: ZODIAC_FLOW_KEY, label: "Zodiac 工作流技术说明", color: "#7c3aed" },
    { key: ASSET_FILES_KEY, label: "资产与文件", color: "#64748b" },
] as const;

function isMiniMaxVendor(vendorId: string): vendorId is "minimax-token-plan" | "minimax-api" {
    return vendorId === "minimax-token-plan" || vendorId === "minimax-api";
}

export default function DocsPage() {
    const config = useConfigStore((state) => state.config);
    const [query, setQuery] = useState("");
    const [selectedKey, setSelectedKey] = useState(() => documentModels()[0]!.key);
    const [activeScriptLabel, setActiveScriptLabel] = useState("");
    const [copied, setCopied] = useState(false);
    const [isDirectoryCollapsed, setIsDirectoryCollapsed] = useState(false);
    const [isScriptCollapsed, setIsScriptCollapsed] = useState(false);
    const [collapsedCapabilities, setCollapsedCapabilities] = useState<Partial<Record<ProviderModelCapability, boolean>>>({});
    const [isReferenceCollapsed, setIsReferenceCollapsed] = useState(false);
    const models = useMemo(documentModels, []);
    const selected = models.find((item) => item.key === selectedKey) || models[0]!;
    const savedScript = useMemo(() => findSavedScript(config.channels, selected.vendor.id, selected.model.name, selected.model.capability), [config.channels, selected.model.capability, selected.model.name, selected.vendor.id]);
    const scriptExamples = useMemo(() => scriptExamplesFor(selected, savedScript), [savedScript, selected]);
    const activeScript = scriptExamples.find((item) => item.label === activeScriptLabel) || scriptExamples[0]!;
    const directNativeCall = usesDirectNativeAdapter(selected.adapter) && !savedScript;
    const scriptPanelSummary = directNativeCall ? "应用已原生接入，无需配置高级脚本。" : "可选：用于覆盖默认调用；不配置时使用应用内置适配。";
    const isReferenceDoc = selectedKey === ARCHITECTURE_KEY || selectedKey === UI_PATHS_KEY || selectedKey === ZODIAC_FLOW_KEY || selectedKey === ASSET_FILES_KEY;
    const search = query.trim().toLocaleLowerCase();
    const visibleModels = search ? models.filter(({ vendor, model }) => [vendor.label, vendor.shortLabel, model.label, model.name, model.description, capabilityMeta[model.capability].label].join(" ").toLocaleLowerCase().includes(search)) : models;

    const selectModel = (key: string) => {
        const nextModel = models.find((item) => item.key === key);
        setSelectedKey(key);
        setActiveScriptLabel("");
        setCopied(false);
        if (nextModel) {
            setCollapsedCapabilities((current) => ({ ...current, [nextModel.model.capability]: false }));
        }
    };

    const copyScript = () => {
        if (!copyToClipboard(activeScript.script)) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    const endpoint = endpointFor(selected.vendor.id, selected.model);
    const nativeRoutes = documentationNativeRoutesForModel(selected.vendor.id, selected.model.name);
    const ui = modelUiAdaptation(legacyApiFormatForVendor(selected.vendor.id) as ProviderProtocol, selected.model.name, selected.model.capability);

    return (
        <main className="wg-reference-page wg-paper-surface flex h-full min-w-0 flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title text-[21px] font-semibold">模型接口</h1>
                        <p className="wg-library-meta mt-0.5">已适配推荐模型 / {String(models.length).padStart(2, "0")} · 参考 / 04</p>
                    </div>
                    <label className="ml-auto flex h-9 w-[min(36vw,340px)] items-center gap-2 rounded-[9px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-3 text-[color:var(--wg-home-muted)] focus-within:border-[color:var(--wg-home-accent)] focus-within:ring-2 focus-within:ring-[color:var(--wg-home-accent)]/10">
                        <Search className="size-4 shrink-0" strokeWidth={1.8} />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索推荐模型" className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--wg-home-text)] outline-none placeholder:text-[color:var(--wg-home-muted-strong)]" />
                    </label>
                </div>
            </header>
            <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside
                className={`hidden shrink-0 overflow-y-auto border-r border-[color:var(--wg-home-line)] bg-[color:var(--wg-chrome)] transition-[width] duration-300 ease-out lg:block ${isDirectoryCollapsed ? "w-[52px] p-2" : "w-[248px] p-4"}`}
                aria-label="模型接口目录"
            >
                {isDirectoryCollapsed ? (
                    <button
                        type="button"
                        onClick={() => setIsDirectoryCollapsed(false)}
                        className="flex size-9 items-center justify-center rounded-md text-[#61717b] transition hover:bg-[#eaf5f6] hover:text-[#117c8e] dark:text-slate-400 dark:hover:bg-[#0d3a42]/55"
                        aria-label="展开模型接口目录"
                        title="展开模型接口目录"
                    >
                        <ChevronRight className="size-4" strokeWidth={1.8} />
                    </button>
                ) : (
                    <>
                        <div className="mb-4 flex items-center gap-2 px-1">
                            <FileCode2 className="size-[18px] text-[#117c8e]" strokeWidth={1.8} />
                            <h1 className="flex-1 text-[16px] font-semibold tracking-[-0.01em]">模型接口</h1>
                            <button
                                type="button"
                                onClick={() => setIsDirectoryCollapsed(true)}
                                className="flex size-7 items-center justify-center rounded text-[#87929a] transition hover:bg-[#eaf5f6] hover:text-[#117c8e] dark:text-slate-400 dark:hover:bg-[#0d3a42]/55"
                                aria-label="收起模型接口目录"
                                title="收起模型接口目录"
                            >
                                <ChevronLeft className="size-4" strokeWidth={1.8} />
                            </button>
                        </div>
                        <div className="mt-2 space-y-5">
                            {capabilityOrder.map((capability) => {
                                const group = visibleModels.filter((item) => item.model.capability === capability);
                                if (!group.length) return null;
                                const Icon = capabilityMeta[capability].Icon;
                                const isGroupCollapsed = Boolean(collapsedCapabilities[capability]) && !search;
                                return (
                                    <section key={capability} aria-label={capabilityMeta[capability].navLabel}>
                                        <button
                                            type="button"
                                            onClick={() => setCollapsedCapabilities((current) => ({ ...current, [capability]: !current[capability] }))}
                                            className="mb-1.5 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px] font-semibold text-[#343e46] transition hover:bg-[#edf5f6] dark:text-slate-200 dark:hover:bg-slate-800"
                                            aria-expanded={!isGroupCollapsed}
                                        >
                                            <ChevronDown className={`size-3.5 transition-transform duration-200 ${isGroupCollapsed ? "-rotate-90" : "rotate-0"}`} strokeWidth={1.8} />
                                            <Icon className="size-3.5 text-[#73808a]" strokeWidth={1.8} />
                                            <span>{capabilityMeta[capability].navLabel}</span>
                                        </button>
                                        {!isGroupCollapsed ? (
                                            <div className="space-y-0.5">
                                                {group.map((item) => (
                                                    <EndpointNavItem key={item.key} item={item} selected={item.key === selectedKey} onSelect={selectModel} />
                                                ))}
                                            </div>
                                        ) : null}
                                    </section>
                                );
                            })}
                            <section aria-label="参考文档">
                                <button
                                    type="button"
                                    onClick={() => setIsReferenceCollapsed((current) => !current)}
                                    className="mb-1.5 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px] font-semibold text-[#343e46] transition hover:bg-[#edf5f6] dark:text-slate-200 dark:hover:bg-slate-800"
                                    aria-expanded={!isReferenceCollapsed}
                                >
                                    <ChevronDown className={`size-3.5 transition-transform duration-200 ${isReferenceCollapsed ? "-rotate-90" : "rotate-0"}`} strokeWidth={1.8} />
                                    <Settings2 className="size-3.5 text-[#73808a]" strokeWidth={1.8} />
                                    <span>参考文档</span>
                                </button>
                                {!isReferenceCollapsed ? (
                                    <div className="space-y-0.5">
                                        {referenceDocs.map((doc) => (
                                            <button
                                                key={doc.key}
                                                type="button"
                                                onClick={() => selectModel(doc.key)}
                                                aria-current={selectedKey === doc.key ? "page" : undefined}
                                                className={`group flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-2 text-left text-[12px] transition-colors ${selectedKey === doc.key ? "border-[#117c8e] bg-[#eaf5f6] font-medium text-[#117c8e] dark:bg-[#0d3a42]/55" : "border-transparent text-[#59656e] hover:bg-[#f0f4f5] hover:text-[#26323b] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"}`}
                                            >
                                                <span className="size-1.5 shrink-0 rounded-full" style={{ background: doc.color }} />
                                                <span className="truncate">{doc.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        </div>

                        {visibleModels.length === 0 ? <p className="px-2 py-8 text-center text-[12px] text-[#7b858d]">没有找到匹配接口</p> : null}
                        <div className="mt-8 border-t border-[#e5e8eb] px-1 pt-4 text-[11px] leading-5 text-[#7b858d] dark:border-slate-700 dark:text-slate-400">模型、密钥与调用脚本均在渠道设置内管理。</div>
                    </>
                )}
            </aside>

            <section className="min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-[color:var(--wg-panel)]" aria-labelledby={isReferenceDoc ? undefined : "endpoint-title"} aria-label={isReferenceDoc ? "参考文档" : undefined}>
                <div className="border-b border-[#e7eaed] bg-[#fbfcfd] px-5 py-3 dark:border-slate-700 dark:bg-[#151a1e] lg:hidden">
                    <label className="flex items-center gap-3 text-[11px] font-medium text-[#65717a] dark:text-slate-300">
                        模型接口
                        <select
                            value={selectedKey}
                            onChange={(event) => selectModel(event.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-[#dbe2e6] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#26323a] outline-none focus:border-[#117c8e] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        >
                            {capabilityOrder.map((capability) => (
                                <optgroup key={capability} label={capabilityMeta[capability].navLabel}>
                                    {models
                                        .filter((item) => item.model.capability === capability)
                                        .map((item) => (
                                            <option key={item.key} value={item.key}>
                                                {endpointNavLabel(item)}
                                    </option>
                                ))}
                                </optgroup>
                            ))}
                            <optgroup label="参考文档">
                                {referenceDocs.map((doc) => (
                                    <option key={doc.key} value={doc.key}>{doc.label}</option>
                                ))}
                            </optgroup>
                        </select>
                    </label>
                </div>
                <div className="mx-auto max-w-[820px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
                    {selectedKey === ARCHITECTURE_KEY ? (
                        <ArchitectureFlow />
                    ) : selectedKey === UI_PATHS_KEY ? (
                        <UiPathsFlow />
                    ) : selectedKey === ZODIAC_FLOW_KEY ? (
                        <ZodiacFlowDoc />
                    ) : selectedKey === ASSET_FILES_KEY ? (
                        <AssetFilesDoc />
                    ) : (
                        <>
                    <div className="mb-7 flex flex-wrap items-start justify-between gap-3 border-b border-[#e7eaed] pb-6 dark:border-slate-700">
                        <div className="min-w-0">
                            <div className="mb-3 flex items-center gap-2 text-[11px] text-[#7d8790] dark:text-slate-400">
                                <span>{documentationVendorLabel(selected.vendor)}</span>
                                <span>/</span>
                                <span>{capabilityMeta[selected.model.capability].navLabel}</span>
                            </div>
                            <h2 id="endpoint-title" className="text-[26px] font-semibold tracking-[-0.025em] text-[#182027] dark:text-white">
                                {selected.model.label}
                            </h2>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-[#117c8e] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">POST</span>
                                <code className="rounded-md bg-[#f1f4f6] px-2.5 py-1 font-mono text-[12px] text-[#34414a] dark:bg-slate-800 dark:text-slate-200">{endpoint.path}</code>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[#7a878f] dark:text-slate-400">
                                <span className="font-medium">{isMiniMaxVendor(selected.vendor.id) ? "服务地址" : "兼容地址"}</span>
                                <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[10px] text-[#45525b] dark:bg-slate-800 dark:text-slate-300">{isMiniMaxVendor(selected.vendor.id) ? "按所选 MiniMax 渠道" : endpoint.baseUrl || "自定义"}</code>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-[#117c8e]/40 bg-[#117c8e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#0d6b7a] dark:border-teal-400/40 dark:bg-teal-400/10 dark:text-teal-200">已适配</span>
                            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                                {capabilityMeta[selected.model.capability].label} {capabilitySupportLabel(adapterCapabilitySupport(selected.adapter, selected.model.capability))}
                            </span>
                            <span className="rounded-md border border-[#dce3e7] px-2.5 py-1.5 text-[11px] text-[#64717b] dark:border-slate-700 dark:text-slate-300">{ui.native ? "专属设置" : "通用设置"}</span>
                        </div>
                    </div>

                    <p className="max-w-2xl text-[13px] leading-7 text-[#65717a] dark:text-slate-300">
                        {selected.model.description}。
                        {isMiniMaxVendor(selected.vendor.id)
                            ? "支持 Token Plan 和 API 计费两种接入方式，请在渠道设置中选择与 Key 对应的方式。"
                            : "完成渠道配置后，可在对应工作台和工作流中直接使用。"}
                    </p>

                    {isMiniMaxVendor(selected.vendor.id) ? <MiniMaxAccessCard /> : null}

                    {nativeRoutes.length ? (
                        <EndpointSection title={isMiniMaxTextModel(selected.model.name) ? "会话使用的接口" : "工作台使用的接口"}>
                            <div className="grid gap-2">
                                {nativeRoutes.map((route) => (
                                    <div key={`${route.method}:${route.path}`} className="rounded-lg border border-[#e0e5e8] bg-[#fafbfc] px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-[12px] font-semibold text-[#24313a] dark:text-slate-100">{isMiniMaxTextModel(selected.model.name) ? "会话已接入" : "工作台已接入"} · {route.label}</span>
                                                {route.paygOnly ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">API 计费</span> : null}
                                            </div>
                                            <a className="text-[11px] font-medium text-[#117c8e] hover:underline" href={route.docsUrl} target="_blank" rel="noreferrer">官方接口文档 ↗</a>
                                        </div>
                                        <code className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-[11px] text-[#45525b] dark:bg-slate-800 dark:text-slate-300">{route.method} {route.path}</code>
                                        <p className="mt-2 text-[11px] leading-5 text-[#6b7881] dark:text-slate-400">{route.note}</p>
                                    </div>
                                ))}
                            </div>
                        </EndpointSection>
                    ) : null}

                    <EndpointSection title="请求头">
                        <ParameterList rows={requestHeaderRowsFor(selected)} />
                    </EndpointSection>

                    <EndpointSection title="原生 API 请求参数">
                        <ParameterList rows={parameterRowsFor(selected)} />
                        <ApiParameterFootnote selected={selected} />
                    </EndpointSection>

                    <EndpointSection title="调用脚本上下文">
                        <div className="overflow-hidden rounded-md border border-[#e0e5e8] dark:border-slate-700">
                            {PLUGIN_VARIABLES.filter((variable) => !variable.capabilities || variable.capabilities.includes(selected.model.capability))
                                .slice(0, 7)
                                .map((variable) => (
                                    <div key={variable.name} className="border-b border-[#edf0f2] px-4 py-3 last:border-b-0 dark:border-slate-800 md:grid md:grid-cols-[minmax(104px,0.9fr)_minmax(92px,0.75fr)_minmax(0,2fr)] md:gap-3">
                                        <div className="flex items-center justify-between gap-3 md:contents">
                                            <code className="min-w-0 truncate text-[11px] font-semibold text-[#1e2a33] dark:text-slate-100">{variable.name}</code>
                                            <code className="shrink-0 text-[10px] text-[#74808a] dark:text-slate-400">{variable.type}</code>
                                        </div>
                                        <span className="mt-1.5 block text-[11px] leading-5 text-[#68747d] dark:text-slate-300 md:mt-0">{variable.desc}</span>
                                    </div>
                                ))}
                        </div>
                    </EndpointSection>

                    {selected.model.capability === "image" ? (
                        <div className="mt-8 border-l-2 border-[#117c8e] bg-[#f3f8f8] px-4 py-3 text-[12px] leading-6 text-[#52616a] dark:bg-[#123139]/35 dark:text-slate-300">
                            图片输出字段由应用自动适配。{imageCompatibilityNote(selected.vendor.id, selected.model.name, selected.model.capability)}
                        </div>
                    ) : null}

                    <section className="mt-9 xl:hidden" aria-label="脚本示例">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[16px] font-semibold text-[#1e2a33] dark:text-white">脚本示例</h3>
                                <p className="mt-1 text-[11px] leading-5 text-[#72808a] dark:text-slate-400">{scriptPanelSummary}</p>
                            </div>
                            <Link to="/config" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#117c8e]">
                                <Settings2 className="size-3.5" />
                                渠道设置
                            </Link>
                        </div>
                        <div className="mt-3 flex gap-1 overflow-x-auto border-b border-[#e4e8eb] dark:border-slate-700" role="tablist" aria-label="移动端脚本模板">
                            {scriptExamples.map((example) => (
                                <button
                                    key={example.label}
                                    type="button"
                                    onClick={() => {
                                        setActiveScriptLabel(example.label);
                                        setCopied(false);
                                    }}
                                    className={`relative -mb-px shrink-0 px-2.5 py-2 text-[11px] font-medium ${example.label === activeScript.label ? "border-b-2 border-[#117c8e] text-[#117c8e]" : "text-[#7a858e] dark:text-slate-400"}`}
                                    role="tab"
                                    aria-selected={example.label === activeScript.label}
                                >
                                    {example.label}
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 overflow-hidden rounded-lg border border-[#1b2630] bg-[#151b22]">
                            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] text-[#9caab2]">
                                <span>JavaScript</span>
                                <button type="button" onClick={copyScript} className="inline-flex items-center gap-1">
                                    <Copy className="size-3.5" />
                                    {copied ? "已复制" : "复制"}
                                </button>
                            </div>
                            <pre className="thin-scrollbar max-h-[360px] overflow-auto px-3 py-3 text-[10.5px] leading-[1.65] text-[#d9e1dd]">
                                <code>{activeScript.script}</code>
                            </pre>
                        </div>
                    </section>
                        </>
                    )}
                </div>
            </section>

            {!isReferenceDoc ? (
                <aside
                    className={`hidden shrink-0 overflow-y-auto border-l border-[color:var(--wg-home-line)] bg-[color:var(--wg-chrome)] transition-[width] duration-300 ease-out xl:block ${isScriptCollapsed ? "w-[52px] p-2" : "w-[380px] p-4"}`}
                    aria-label="脚本示例"
                >
                {isScriptCollapsed ? (
                    <button
                        type="button"
                        onClick={() => setIsScriptCollapsed(false)}
                        className="flex size-9 items-center justify-center rounded-md text-[#61717b] transition hover:bg-[#eaf5f6] hover:text-[#117c8e] dark:text-slate-400 dark:hover:bg-[#0d3a42]/55"
                        aria-label="展开脚本示例"
                        title="展开脚本示例"
                    >
                        <ChevronLeft className="size-4" strokeWidth={1.8} />
                    </button>
                ) : (
                    <div className="sticky top-0 rounded-xl border border-[#e0e5e8] bg-white p-4 shadow-[0_8px_24px_rgba(19,36,46,0.06)] dark:border-slate-700 dark:bg-[#1b2228]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-[15px] font-semibold text-[#1b2730] dark:text-white">脚本示例</h2>
                                <p className="mt-1 text-[11px] leading-5 text-[#72808a] dark:text-slate-400">{scriptPanelSummary}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsScriptCollapsed(true)}
                                className="flex size-7 shrink-0 items-center justify-center rounded text-[#87929a] transition hover:bg-[#eaf5f6] hover:text-[#117c8e] dark:text-slate-400 dark:hover:bg-[#0d3a42]/55"
                                aria-label="收起脚本示例"
                                title="收起脚本示例"
                            >
                                <ChevronRight className="size-4" strokeWidth={1.8} />
                            </button>
                        </div>

                        <div className="mt-4 flex gap-1 border-b border-[#e4e8eb] dark:border-slate-700" role="tablist" aria-label="脚本模板">
                            {scriptExamples.map((example) => {
                                const selectedScript = example.label === activeScript.label;
                                return (
                                    <button
                                        key={example.label}
                                        type="button"
                                        onClick={() => {
                                            setActiveScriptLabel(example.label);
                                            setCopied(false);
                                        }}
                                        className={`relative -mb-px truncate px-2.5 py-2 text-[11px] font-medium transition-colors ${selectedScript ? "border-b-2 border-[#117c8e] text-[#117c8e]" : "text-[#7a858e] hover:text-[#33414a] dark:text-slate-400 dark:hover:text-slate-200"}`}
                                        role="tab"
                                        aria-selected={selectedScript}
                                    >
                                        {example.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="mt-4 overflow-hidden rounded-lg border border-[#1b2630] bg-[#151b22] text-[#dce8e3]">
                            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] text-[#9caab2]">
                                <span>JavaScript · {activeScript.source === "saved" ? "当前已保存" : "内置模板"}</span>
                                <button type="button" onClick={copyScript} className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition hover:bg-white/10" aria-label="复制脚本">
                                    {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
                                    {copied ? "已复制" : "复制"}
                                </button>
                            </div>
                            <pre className="thin-scrollbar max-h-[470px] overflow-auto px-3 py-3 text-[10.5px] leading-[1.65] text-[#d9e1dd]">
                                <code>{activeScript.script}</code>
                            </pre>
                        </div>

                        <p className="mt-3 text-[11px] leading-5 text-[#78848d] dark:text-slate-400">返回要求：{PLUGIN_RETURNS[selected.model.capability]}</p>
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                onClick={copyScript}
                                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-[#cbd5da] text-[12px] font-medium text-[#34434c] transition hover:border-[#117c8e] hover:text-[#117c8e] dark:border-slate-600 dark:text-slate-200"
                            >
                                <Copy className="size-3.5" />
                                复制脚本
                            </button>
                            <Link to="/config" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#117c8e] text-[12px] font-medium text-white transition hover:bg-[#0d6b7a]">
                                <ExternalLink className="size-3.5" />
                                打开渠道设置
                            </Link>
                        </div>
                    </div>
                )}
                </aside>
            ) : null}
            </div>
        </main>
    );
}

function EndpointNavItem({ item, selected, onSelect }: { item: DocumentModel & { key: string }; selected: boolean; onSelect: (key: string) => void }) {
    return (
        <button
            type="button"
            onClick={() => onSelect(item.key)}
            className={`group flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-2 text-left text-[12px] transition-colors ${selected ? "border-[#117c8e] bg-[#eaf5f6] font-medium text-[#117c8e] dark:bg-[#0d3a42]/55" : "border-transparent text-[#59656e] hover:bg-[#f0f4f5] hover:text-[#26323b] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"}`}
            aria-current={selected ? "page" : undefined}
        >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: item.vendor.accent }} />
            <span className="truncate">{endpointNavLabel(item)}</span>
        </button>
    );
}

function endpointNavLabel(item: DocumentModel) {
    const vendorLabel = documentationVendorLabel(item.vendor);
    const vendor = vendorLabel.toLocaleLowerCase();
    return item.model.label.toLocaleLowerCase().startsWith(vendor) ? item.model.label : `${vendorLabel} ${item.model.label}`;
}

function documentationVendorLabel(vendor: ModelVendorDefinition) {
    return isMiniMaxVendor(vendor.id) ? "MiniMax" : vendor.shortLabel;
}

function EndpointSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-9">
            <h3 className="mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[#1e2a33] dark:text-white">{title}</h3>
            {children}
        </section>
    );
}

function MiniMaxAccessCard() {
    const tokenPlan = getModelVendor("minimax-token-plan")!;
    const api = getModelVendor("minimax-api")!;
    const accessModes = [
        { label: "Token Plan", tag: "套餐权益", baseUrl: tokenPlan.defaultBaseUrl, credential: "Token Plan 专属 Key（sk-cp）", tone: "bg-[#eaf5f6] text-[#117c8e] dark:bg-teal-400/10 dark:text-teal-200" },
        { label: "API 计费", tag: "按量计费", baseUrl: api.defaultBaseUrl, credential: "MiniMax API Key（sk-api）", tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
    ];
    return (
        <EndpointSection title="接入方式">
            <div className="grid gap-2 sm:grid-cols-2">
                {accessModes.map((item) => (
                    <div key={item.label} className="rounded-lg border border-[#dce4e8] bg-[#fafbfc] p-3.5 dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-[#24313a] dark:text-slate-100">{item.label}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${item.tone}`}>{item.tag}</span>
                        </div>
                        <code className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-[10px] text-[#53616a] dark:bg-slate-800 dark:text-slate-300">{item.baseUrl}</code>
                        <p className="mt-2 text-[11px] leading-5 text-[#66737c] dark:text-slate-400">{item.credential}</p>
                    </div>
                ))}
            </div>
            <p className="mt-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                两类 Key 不能混用。选择与 Key 对应的 MiniMax 渠道后，应用会始终使用该渠道，不会自动切换。
            </p>
        </EndpointSection>
    );
}

function ParameterList({ rows }: { rows: ParameterRow[] }) {
    return (
        <div className="overflow-hidden rounded-md border border-[#e0e5e8] dark:border-slate-700">
            <div className="hidden grid-cols-[minmax(105px,0.8fr)_70px_48px_minmax(150px,1.35fr)_minmax(120px,1fr)_minmax(130px,1.05fr)] gap-3 border-b border-[#e6eaed] bg-[#fafbfc] px-4 py-2.5 text-[10px] font-medium text-[#7d8890] dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400 md:grid">
                <span>参数</span>
                <span>类型</span>
                <span>必填</span>
                <span>说明</span>
                <span>示例</span>
                <span>界面控件建议</span>
            </div>
            {rows.map((row) => (
                <div key={row.name} className="border-b border-[#edf0f2] px-4 py-3 last:border-b-0 dark:border-slate-800">
                    <div className="flex items-center gap-2 md:hidden">
                        <code className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#243039] dark:text-slate-100">{row.name}</code>
                        <span className="shrink-0 font-mono text-[10px] text-[#7a858e] dark:text-slate-400">{row.type}</span>
                        <span className={`shrink-0 text-[10px] font-medium ${row.required ? "text-[#d84b49]" : "text-[#839099]"}`}>{row.required ? "必填" : "可选"}</span>
                    </div>
                    <span className="mt-1.5 block text-[11px] leading-5 text-[#62707a] dark:text-slate-300 md:hidden">
                        {row.description}
                        {row.auto ? <span className="ml-1.5 rounded bg-[#dff1f3] px-1.5 py-0.5 text-[9px] font-medium text-[#117c8e] dark:bg-[#0d4a55] dark:text-[#a6e3eb]">自动适配</span> : null}
                    </span>
                    {row.ui ? <span className="mt-1 block text-[10px] leading-5 text-[#117c8e] dark:text-teal-300 md:hidden">界面：{row.ui}</span> : null}
                    <div className="hidden md:grid md:grid-cols-[minmax(105px,0.8fr)_70px_48px_minmax(150px,1.35fr)_minmax(120px,1fr)_minmax(130px,1.05fr)] md:gap-3">
                        <code className="text-[11px] font-semibold text-[#243039] dark:text-slate-100">{row.name}</code>
                        <span className="font-mono text-[10px] text-[#7a858e] dark:text-slate-400">{row.type}</span>
                        <span className={`text-[10px] font-medium ${row.required ? "text-[#d84b49]" : "text-[#839099]"}`}>{row.required ? "必填" : "可选"}</span>
                        <span className="text-[11px] leading-5 text-[#62707a] dark:text-slate-300">
                            {row.description}
                            {row.auto ? <span className="ml-1.5 rounded bg-[#dff1f3] px-1.5 py-0.5 text-[9px] font-medium text-[#117c8e] dark:bg-[#0d4a55] dark:text-[#a6e3eb]">自动适配</span> : null}
                        </span>
                        <span className="truncate rounded border border-[#dde3e7] bg-white px-2 py-1 font-mono text-[10px] text-[#56636c] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300" title={row.example}>
                            {row.example}
                        </span>
                        <span className="text-[10px] leading-5 text-[#0d6b7a] dark:text-teal-300">{row.ui || "—"}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function documentModels(): DocumentModel[] {
    return modelVendors.filter((vendor) => vendor.id !== "minimax-token-plan").flatMap((vendor) =>
        recommendedCatalogModelsForVendor(vendor.id).map((model) => ({
            vendor,
            model,
            adapter: model.adapter || resolveAdapterForModel(model.name, model.capability),
            key: `${vendor.id}:${model.name}`,
        })),
    );
}

function findSavedScript(channels: { vendor?: string; models: ChannelModel[] }[], vendorId: VendorId, modelName: string, capability: ProviderModelCapability) {
    return (
        channels
            .filter((channel) => !isMiniMaxVendor(vendorId) || isMiniMaxVendor(channel.vendor || ""))
            .flatMap((channel) => channel.models)
            .find((model) => model.name === modelName && model.capability === capability)
            ?.script?.trim() || ""
    );
}

function usesDirectNativeAdapter(adapter: AdapterId) {
    return isMiniMaxAdapter(adapter) || adapter === "ark-media" || adapter === "dashscope-audio" || adapter === "xai" || adapter === "agnes";
}

function scriptExamplesFor(selected: DocumentModel, savedScript: string): ScriptExample[] {
    if (usesDirectNativeAdapter(selected.adapter)) {
        return [
            ...(savedScript ? [{ label: "当前脚本", script: savedScript, source: "saved" as const }] : []),
            { label: "原生调用", script: `// ${selected.model.label} 已由应用原生接入，无需添加高级脚本。`, source: "template" },
        ];
    }
    const templates = PLUGIN_TEMPLATES[selected.model.capability] || [];
    const preferred = selected.adapter === "gemini" ? templates.find((template) => template.label === "Gemini 规范") : templates.find((template) => template.label === "OpenAI 规范");
    const examples: ScriptExample[] = savedScript ? [{ label: "当前脚本", script: savedScript, source: "saved" }] : [];
    if (preferred) examples.push({ ...preferred, label: "推荐模板", source: "template" });
    templates.filter((template) => template.label !== preferred?.label).forEach((template) => examples.push({ ...template, source: "template" }));
    return examples.length ? examples : [{ label: "默认调用", script: "// 当前模型使用系统默认调用，无需配置脚本。", source: "template" }];
}

function documentationNativeRoutesForModel(vendorId: VendorId, model: string): DocumentationNativeRoute[] {
    const qwenRoutes: DocumentationNativeRoute[] = qwenAudioNativeRoutesForModel(model).map((route) => ({ ...route, method: "POST" }));
    const miniMaxRoutes: DocumentationNativeRoute[] = isMiniMaxVendor(vendorId)
        ? miniMaxNativeRoutesForModel(model)
              .map((route) => ({
                  ...route,
                  note: miniMaxRouteNote(route),
              }))
        : [];
    return [...qwenRoutes, ...miniMaxRoutes];
}

function miniMaxRouteNote(route: MiniMaxNativeRoute) {
    if (route.id === "text") return "当前会话已接入文字和图片；接口还支持视频输入、工具调用与思考参数，详见下方参数表。";
    if (route.id === "image") return "文生图与角色参考编辑使用同一条原生图片接口。";
    if (route.id === "video-h3") return route.method === "GET" ? "提交后按任务 ID 查询进度，成功时直接读取视频地址。" : "支持文字、首帧、首尾帧以及图片 / 视频 / 音频参考。";
    if (route.id === "video-hailuo") {
        if (route.label.includes("查询")) return "按任务 ID 查询生成状态；工作台每 10 秒更新一次。";
        if (route.label.includes("下载")) return "任务成功后使用完整 file_id 获取视频下载地址。";
        return "Hailuo 2.3 支持文生与单首帧图生视频，Fast 必须提供首帧；不支持尾帧或多模态参考。具体可用范围以所选 MiniMax 渠道返回为准。";
    }
    if (route.id === "speech") return "使用 Speech 2.8 HD 或 Turbo 生成完整音频；实际可用权限以当前厂商接口返回为准。";
    return route.label.includes("上传") ? "先上传 10 秒至 5 分钟的声音样本并获得 file_id。" : "使用 file_id 创建自定义音色。";
}

function endpointFor(vendorId: VendorId, model: CatalogModelEntry) {
    const baseUrl = getModelVendor(vendorId)?.defaultBaseUrl || "";
    const capability = model.capability;
    if (isMiniMaxVendor(vendorId)) {
        const primaryRoute = miniMaxNativeRoutesForModel(model.name)[0];
        return { baseUrl, path: primaryRoute?.path || "" };
    }
    if (vendorId === "google") {
        return { baseUrl, path: capability === "video" ? "/v1beta/models/{model}:predictLongRunning" : "/v1beta/models/{model}:generateContent" };
    }
    if (vendorId === "anthropic") {
        return { baseUrl, path: "/v1/messages" };
    }
    if (vendorId === "qwen") {
        if (model.name === "qwen-audio-3.0-tts-flash") return { baseUrl, path: "/api/v1/services/audio/tts/SpeechSynthesizer" };
        if (model.name === "qwen3-tts-vc-2026-01-22") return { baseUrl, path: "/api/v1/services/audio/tts/customization" };
        if (model.name === "qwen3-asr-flash") return { baseUrl, path: "/compatible-mode/v1/chat/completions" };
        return { baseUrl, path: "/compatible-mode/v1/chat/completions" };
    }
    if (vendorId === "ark") {
        return { baseUrl, path: capability === "text" ? "/chat/completions" : capability === "image" ? "/images/generations" : "/contents/generations/tasks" };
    }
    if (vendorId === "xai") {
        return { baseUrl, path: capability === "image" ? "/images/generations" : capability === "video" ? "/videos/generations" : capability === "audio" ? "/audio/speech" : "/chat/completions" };
    }
    if (vendorId === "agnes") {
        return { baseUrl, path: capability === "image" ? "/images/generations" : capability === "video" ? "/videos" : capability === "audio" ? "/audio/speech" : "/chat/completions" };
    }
    return { baseUrl, path: capability === "image" ? "/v1/images/generations" : capability === "video" ? "/v1/videos" : capability === "audio" ? "/v1/audio/speech" : "/v1/chat/completions" };
}

function requestHeaderRowsFor(selected: DocumentModel): ParameterRow[] {
    const vendorId = selected.vendor.id;
    if (vendorId === "google") {
        return [
            { name: "x-goog-api-key", type: "string", required: true, description: "Gemini API Key。", example: "${apiKey}", ui: "从渠道安全读取", auto: true },
            { name: "Content-Type", type: "string", required: true, description: "JSON 请求。", example: "application/json", ui: "应用自动设置", auto: true },
        ];
    }
    if (vendorId === "anthropic") {
        return [
            { name: "x-api-key", type: "string", required: true, description: "Anthropic API Key。", example: "${apiKey}", ui: "从渠道安全读取", auto: true },
            { name: "anthropic-version", type: "string", required: true, description: "Anthropic API 版本。", example: "2023-06-01", ui: "应用自动设置", auto: true },
            { name: "Content-Type", type: "string", required: true, description: "JSON 请求。", example: "application/json", ui: "应用自动设置", auto: true },
        ];
    }
    if (isMiniMaxVendor(vendorId)) {
        return [
            { name: "Authorization", type: "string", required: true, description: "当前 MiniMax 渠道的 Key，使用 Bearer 鉴权。", example: "Bearer ${apiKey}", ui: "从所选渠道读取", auto: true },
            {
                name: "Content-Type",
                type: "string",
                required: true,
                description: "原生接口使用 JSON 请求；声音样本上传时使用 multipart/form-data。",
                example: "application/json",
                ui: "应用按请求自动设置",
                auto: true,
            },
        ];
    }
    if (vendorId === "ark") {
        return [
            { name: "Authorization", type: "string", required: true, description: "方舟 API Key，使用 Bearer 鉴权。", example: "Bearer ${apiKey}", ui: "从渠道安全读取", auto: true },
            { name: "Content-Type", type: "string", required: true, description: "方舟媒体生成任务使用 JSON 请求。", example: "application/json", ui: "应用自动设置", auto: true },
        ];
    }
    return [
        { name: "Authorization", type: "string", required: true, description: "渠道中保存的 API Key。", example: "Bearer ${apiKey}", ui: "从渠道安全读取", auto: true },
        { name: "Content-Type", type: "string", required: true, description: "JSON 或上传文件时的 multipart/form-data。", example: "application/json", ui: "应用按请求自动设置", auto: true },
    ];
}

function parameterRowsFor(selected: DocumentModel): ParameterRow[] {
    return modelApiParameterDoc(selected.vendor.id, selected.model).rows;
}

function ApiParameterFootnote({ selected }: { selected: DocumentModel }) {
    const doc = modelApiParameterDoc(selected.vendor.id, selected.model);
    return (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-[11px] leading-5 text-[#69767f] dark:text-slate-400">
            <span className="max-w-2xl">{doc.note}</span>
            {doc.source ? <a className="shrink-0 font-medium text-[#117c8e] hover:underline" href={doc.source.url} target="_blank" rel="noreferrer">{doc.source.label} ↗</a> : null}
        </div>
    );
}

function imageCompatibilityNote(vendorId: VendorId, modelName: string, capability: ProviderModelCapability) {
    const provider = legacyApiFormatForVendor(vendorId) as ProviderProtocol;
    if (capability !== "image") return "此模型的参数会随渠道协议和工作台设置自动整理。";
    if ((inferModelProvider(modelName) || provider) === "agnes") return "Agnes 图片模型使用最小兼容参数，不发送 response_format 或 output_format。";
    return `${imageOutputParameterLabel(provider, modelName)}会在模型支持时自动加入请求。`;
}

function ArchitectureFlow() {
    const steps = [
        { title: "新增渠道", detail: "配置 → 渠道 → 新增渠道" },
        { title: "选择厂商", detail: "OpenAI / Anthropic / Gemini / 千问 / MiniMax Token Plan / MiniMax API / xAI / Agnes / 火山方舟 / 自定义" },
        { title: "自动带出", detail: "接口地址 · 特征适配器 · 能力开关" },
        { title: "添加推荐模型", detail: "从模型目录按厂商与能力过滤" },
        { title: "保存并使用", detail: "工作台与工作流按模型能力调用" },
    ];
    const layers = [
        {
            title: "协议适配器",
            tag: "传输层",
            color: "#117c8e",
            items: ["openai-compatible", "openai-response", "anthropic", "gemini", "dashscope-audio", "minimax-token-plan-native", "minimax-api-native", "ark-media", "xai", "agnes", "custom"],
            detail: "负责请求格式、鉴权、默认地址和能力表；必要时也固定凭据与计费边界",
        },
        {
            title: "模型目录",
            tag: "数据层",
            color: "#7c3aed",
            items: ["厂商 + 模型", "能力归属", "适配器推断", "参数声明"],
            detail: "纯数据，新模型通常只需加一条记录",
        },
        {
            title: "参数 schema + 通用渲染器",
            tag: "界面层",
            color: "#db2777",
            items: ["选项", "开关", "数字", "多行文本", "分组"],
            detail: "面板由数据生成，新模型界面自动出现",
        },
    ];

    return (
        <section className="mb-10" aria-label="架构示例流程图">
            <div className="mb-5">
                <h3 className="text-[22px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">架构与新增渠道示例流程</h3>
                <p className="mt-2 text-[13px] leading-6 text-[#65717a] dark:text-slate-400">渠道 = 厂商 + 适配器 + 能力开关 + 模型；适配器与模型目录分离，新模型低代码接入。</p>
            </div>

            <div className="mb-6">
                <div className="mb-3 text-[14px] font-medium text-[#34414a] dark:text-slate-300">新增渠道操作流程</div>
                <div className="flex flex-wrap items-stretch gap-2">
                    {steps.map((step, index) => (
                        <div key={step.title} className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                            <div className="min-w-0 flex-1 rounded-lg border border-[#e0e5e8] bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex items-center gap-1.5">
                                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#117c8e] text-[10px] font-bold text-white">{index + 1}</span>
                                    <span className="truncate text-[13px] font-semibold text-[#24313a] dark:text-slate-100">{step.title}</span>
                                </div>
                                <div className="mt-1.5 text-[12px] leading-5 text-[#6b7881] dark:text-slate-400">{step.detail}</div>
                            </div>
                            {index < steps.length - 1 ? <span className="shrink-0 text-[#a6b2b8] dark:text-slate-600">→</span> : null}
                        </div>
                    ))}
                </div>
            </div>

            <div className="mb-3 text-[14px] font-medium text-[#34414a] dark:text-slate-300">最终三层架构</div>
            <div className="grid gap-3 md:grid-cols-3">
                {layers.map((layer) => (
                    <div key={layer.title} className="rounded-lg border border-[#e0e5e8] bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-[#24313a] dark:text-slate-100">{layer.title}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${layer.color}18`, color: layer.color }}>
                                {layer.tag}
                            </span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1">
                            {layer.items.map((item) => (
                                <span key={item} className="rounded bg-[#f1f4f6] px-2 py-1 font-mono text-[11px] text-[#45525b] dark:bg-slate-800 dark:text-slate-300">
                                    {item}
                                </span>
                            ))}
                        </div>
                        <p className="mt-2.5 text-[12px] leading-5 text-[#6b7881] dark:text-slate-400">{layer.detail}</p>
                    </div>
                ))}
            </div>

            <div className="mt-5 rounded-lg border border-[#e0e5e8] bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-2 text-[13px] font-medium text-[#45525b] dark:text-slate-300">厂商 → 特征适配器示例</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] leading-6 text-[#52616a] dark:text-slate-300">
                    <span>OpenAI → openai-compatible</span>
                    <span>Anthropic → anthropic</span>
                    <span>Gemini → gemini</span>
                    <span>千问音频 → dashscope-audio</span>
                    <span>MiniMax Token Plan → minimax-token-plan-native</span>
                    <span>MiniMax API → minimax-api-native</span>
                    <span>xAI → xai</span>
                    <span>Agnes → agnes</span>
                    <span>火山方舟 → ark-media</span>
                    <span>自定义 → openai-compatible</span>
                </div>
            </div>
        </section>
    );
}

function UiPathsFlow() {
    const paths = [
        {
            title: "路线一：数据驱动的通用面板",
            tag: "大多数模型",
            color: "#117c8e",
            steps: [
                "在模型目录条目里声明一段 parameters（选项 / 开关 / 数字 / 尺寸 / 分组）",
                "通用渲染器 ModelParamPanel 自动按 schema 生成面板",
                "新模型加数据即可，不需要修改任何面板代码",
            ],
            examples: ["例如新增模型时声明：尺寸仅 1:1 / 3:2 / 2:3，生成张数 ≤ 10", "或声明：清晰度 480p / 720p / 1080p，时长仅 4 / 5 / 6 / 10s"],
        },
        {
            title: "路线二：代码编写的原生面板",
            tag: "特殊交互",
            color: "#db2777",
            steps: [
                "模型经验命中 Grok / Agnes / Seedream / Seedance / MiniMax 图片、视频或音频等原生经验",
                "面板由专门组件提供（CreatorImage / CreatorVideo / Seedance…）",
                "适合有专属交互或特殊参数约束的模型，行为完全可控",
            ],
            examples: ["Grok 图片：参考图引导与 1K / 2K 选项", "MiniMax：两个独立厂商、H3 多模态素材、Hailuo 首帧视频与 Speech 2.8 声音设置"],
        },
    ];
    const implemented = [
        { model: "MiniMax M3（两厂商）", path: "会话 UI", owner: "共享会话 + 原生序列化", contract: "使用现有会话界面，并按 Anthropic Messages 原生协议发送文字与图片" },
        { model: "MiniMax Token Plan 媒体模型", path: "路线二", owner: "MiniMax 图片 / 视频 / 音频工作台", contract: "完整展示 Image 01、H3、Hailuo 2.3、Speech 2.8 与快速声音复刻；使用 Token Plan 专属 Key 请求，具体权限由 MiniMax 返回；不含音乐或转录" },
        { model: "MiniMax API 计费媒体模型", path: "路线二", owner: "MiniMax 图片 / 视频 / 音频工作台", contract: "完整展示 Image 01、H3、Hailuo 2.3、Speech 2.8 与快速声音复刻；使用 API Key 请求，具体权限由 MiniMax 返回；不含音乐或转录" },
        { model: "千问音频工作台", path: "路线二", owner: "音频工作台", contract: "按任务显示语音生成、声音复刻或语音转录参数" },
        { model: "Grok / Agnes 图片与视频", path: "路线二", owner: "图片 / 视频工作台", contract: "按模型显示参考素材、画幅、时长与清晰度" },
        { model: "Seedance 2.5", path: "路线二 + 专属工作板", owner: "SD2.5 / 视频工作台 / 工作流", contract: "单次生成 4–30 秒或 -1，支持视频延长、视频编辑、480p / 720p 与 mp4 / mov 输出" },
        { model: "Seedream / Seedance 2.0", path: "路线二", owner: "图片 / 视频工作台", contract: "按模型显示图片、视频、音频参考素材与生成参数" },
        { model: "其余目录模型", path: "路线一", owner: "通用参数面板", contract: "按模型能力自动显示可用设置" },
    ];

    return (
        <section className="mb-10" aria-label="绑定模型的原生 UI 解释">
            <div className="mb-5">
                <h3 className="text-[22px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">绑定模型的原生 UI 解释</h3>
                <p className="mt-2 text-[13px] leading-6 text-[#65717a] dark:text-slate-400">模型参数面板由两种方式提供：数据驱动的通用面板，以及代码编写的原生面板。两者按优先级自动选择。</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                {paths.map((path) => (
                    <div key={path.title} className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[14px] font-semibold text-[#24313a] dark:text-slate-100">{path.title}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${path.color}18`, color: path.color }}>
                                {path.tag}
                            </span>
                        </div>
                        <div className="mt-3.5 space-y-2">
                            {path.steps.map((step, index) => (
                                <div key={step} className="flex items-start gap-2.5 text-[12px] leading-5 text-[#52616a] dark:text-slate-300">
                                    <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: path.color }}>
                                        {index + 1}
                                    </span>
                                    <span>{step}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3.5 rounded-md bg-[#fafbfc] p-2.5 dark:bg-slate-800/40">
                            <div className="mb-1.5 text-[11px] font-medium text-[#7a878f] dark:text-slate-400">示例</div>
                            {path.examples.map((example) => (
                                <div key={example} className="text-[12px] leading-5 text-[#6b7881] dark:text-slate-400">
                                    · {example}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-5 rounded-lg border border-[#e0e5e8] bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-2 text-[13px] font-medium text-[#45525b] dark:text-slate-300">面板选择优先级</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] leading-6 text-[#52616a] dark:text-slate-300">
                    <span>① 原生面板（Grok / Agnes / Seedream / Seedance / MiniMax 等经验）</span>
                    <span>→ ② 模型专属 schema（目录中声明了 parameters）</span>
                    <span>→ ③ 通用面板（按能力使用默认 schema）</span>
                </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-lg border border-[#e0e5e8] bg-white dark:border-slate-700 dark:bg-slate-900">
                <div className="border-b border-[#edf0f2] px-3.5 py-3 text-[13px] font-medium text-[#45525b] dark:border-slate-800 dark:text-slate-300">当前工作台路线清单</div>
                {implemented.map((item) => (
                    <div key={item.model} className="border-b border-[#edf0f2] px-3.5 py-3 last:border-b-0 dark:border-slate-800 md:grid md:grid-cols-[1fr_72px_1.2fr_1.8fr] md:gap-3">
                        <div className="text-[12px] font-semibold text-[#24313a] dark:text-slate-100">{item.model}</div>
                        <div className="mt-1 text-[11px] font-medium text-[#117c8e] md:mt-0">{item.path}</div>
                        <code className="mt-1 block text-[10px] text-[#66737c] dark:text-slate-400 md:mt-0">{item.owner}</code>
                        <div className="mt-1 text-[11px] leading-5 text-[#6b7881] dark:text-slate-400 md:mt-0">{item.contract}</div>
                    </div>
                ))}
            </div>

            <div className="mt-4 rounded-lg border border-[#117c8e]/35 bg-[#f3f8f8] px-3.5 py-3 text-[12px] leading-6 text-[#52616a] dark:border-teal-400/30 dark:bg-[#123139]/35 dark:text-slate-300">
                选择模型后，可在模型接口页查看工作台采用的路线、实际请求地址与参数对应关系；未接入请求的设置不会显示为可用。
            </div>

            <div className="mt-4 rounded-lg border border-[#e0e5e8] bg-[#f3f8f8] px-3.5 py-3 text-[12px] leading-6 text-[#52616a] dark:border-slate-700 dark:bg-[#123139]/35 dark:text-slate-300">
                通用工作台 UI 无模型介绍标记；原生工作台 UI 含有该模型的介绍图标。
            </div>
        </section>
    );
}
