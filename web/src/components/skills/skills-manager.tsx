import { Alert, App, Button, Card, Empty, Input, Modal, Segmented, Spin, Switch, Tag } from "antd";
import { ArrowDown, ArrowUp, Download, ExternalLink, FileUp, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { AuthorNote } from "@/components/author-library/author-note";
import { downloadRegistrySkill, fetchRegistrySkillBody, fetchSkillRegistry, registryEntryIntegrity, type SkillRegistryEntry } from "@/services/skills/skill-registry";
import { createPersonalSkill, type InstalledSkill } from "@/services/skills/skill-presets";
import { useSkillStore } from "@/stores/use-skill-store";
import { cn } from "@/lib/utils";

type SkillsView = "official" | "author" | "personal";
type CatalogItem = { entry: SkillRegistryEntry | null; installed?: InstalledSkill };

const ALL = "全部";

export function SkillsManager() {
    const { message } = App.useApp();
    const importRef = useRef<HTMLInputElement>(null);
    const skills = useSkillStore((state) => state.skills);
    const save = useSkillStore((state) => state.save);
    const remove = useSkillStore((state) => state.remove);
    const setEnabled = useSkillStore((state) => state.setEnabled);
    const setZodiacOnly = useSkillStore((state) => state.setZodiacOnly);
    const move = useSkillStore((state) => state.move);
    const [view, setView] = useState<SkillsView>("official");
    const [registry, setRegistry] = useState<SkillRegistryEntry[]>([]);
    const [loadingRegistry, setLoadingRegistry] = useState(false);
    const [registryAttempted, setRegistryAttempted] = useState(false);
    const [registryError, setRegistryError] = useState("");
    const [installingId, setInstallingId] = useState("");
    const [editing, setEditing] = useState<InstalledSkill | null>(null);
    const [keyword, setKeyword] = useState("");
    const deferredKeyword = useDeferredValue(keyword.trim().toLocaleLowerCase());
    const [category, setCategory] = useState(ALL);
    const [detail, setDetail] = useState<CatalogItem | null>(null);
    const [detailBody, setDetailBody] = useState("");
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");

    const installedById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
    const officialInstalled = useMemo(() => skills.filter((skill) => skill.source !== "personal").sort((a, b) => a.priority - b.priority), [skills]);
    const personalSkills = useMemo(() => skills.filter((skill) => skill.source === "personal").sort((a, b) => a.priority - b.priority), [skills]);
    const catalog = useMemo<CatalogItem[]>(() => {
        const remoteIds = new Set(registry.map((entry) => entry.id));
        return [...registry.map((entry) => ({ entry, installed: installedById.get(entry.id) })), ...officialInstalled.filter((skill) => !remoteIds.has(skill.id)).map((installed) => ({ entry: null, installed }))];
    }, [installedById, officialInstalled, registry]);
    const sourceCatalog = useMemo(() => (view === "personal" ? [] : catalog.filter((item) => catalogSource(item) === view)), [catalog, view]);
    const categories = useMemo(() => [ALL, ...new Set(sourceCatalog.map(catalogCategory))], [sourceCatalog]);
    const visibleCatalog = useMemo(
        () =>
            sourceCatalog.filter((item) => {
                if (category !== ALL && catalogCategory(item) !== category) return false;
                if (!deferredKeyword) return true;
                const entry = item.entry;
                const installed = item.installed;
                return [entry?.name, installed?.name, entry?.description, installed?.description, entry?.authorNote, installed?.authorNote, ...(entry?.tags || installed?.tags || [])].filter(Boolean).join(" ").toLocaleLowerCase().includes(deferredKeyword);
            }),
        [sourceCatalog, category, deferredKeyword],
    );
    const visiblePersonalSkills = useMemo(
        () =>
            personalSkills.filter((skill) => {
                if (!deferredKeyword) return true;
                return [skill.name, skill.description, ...skill.tags].join(" ").toLocaleLowerCase().includes(deferredKeyword);
            }),
        [deferredKeyword, personalSkills],
    );
    const hasActiveFilters = Boolean(keyword.trim()) || (view !== "personal" && category !== ALL);
    const refreshOfficial = async (quiet = false) => {
        setRegistryAttempted(true);
        setLoadingRegistry(true);
        setRegistryError("");
        try {
            const available = (await fetchSkillRegistry()).skills;
            setRegistry(dedupeRegistry(available));
            if (!quiet) message.success(`已更新 ${available.length} 个 Skills`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : "无法读取官方 Skills";
            setRegistryError(reason);
            if (!quiet) message.error(reason);
        } finally {
            setLoadingRegistry(false);
        }
    };

    useEffect(() => {
        if (view === "official" && !registryAttempted && !loadingRegistry) void refreshOfficial(true);
    }, [view, registryAttempted, loadingRegistry]);

    const install = async (entry: SkillRegistryEntry) => {
        setInstallingId(entry.id);
        try {
            save(await downloadRegistrySkill(entry));
            message.success(`「${entry.name}」已可使用`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Skill 安装失败");
        } finally {
            setInstallingId("");
        }
    };

    const openDetail = async (item: CatalogItem) => {
        setDetail(item);
        setDetailError("");
        const body = item.installed?.body;
        if (body) {
            setDetailBody(body);
            return;
        }
        if (!item.entry) return;
        setDetailBody("");
        setDetailLoading(true);
        try {
            setDetailBody(await fetchRegistrySkillBody(item.entry));
        } catch (error) {
            setDetailError(error instanceof Error ? error.message : "Skill 内容暂时不可用");
        } finally {
            setDetailLoading(false);
        }
    };

    const importSkill = async (file?: File) => {
        if (!file) return;
        try {
            if (file.size > 512 * 1024) throw new Error("单个 Skill 文件不能超过 512KB");
            const text = await file.text();
            let imported: InstalledSkill;
            if (file.name.toLowerCase().endsWith(".json")) {
                const value = JSON.parse(text) as Partial<InstalledSkill>;
                imported = createPersonalSkill({ ...value, id: `personal.${crypto.randomUUID()}`, source: "personal", enabled: true });
            } else {
                const heading = text.match(/^#\s+(.+)$/mu)?.[1]?.trim();
                imported = createPersonalSkill({
                    name: heading || file.name.replace(/\.(md|markdown)$/iu, ""),
                    description: "从本机导入",
                    body: text,
                    source: "personal",
                });
            }
            if (!imported.body.trim()) throw new Error("Skill 内容为空");
            save(imported);
            setView("personal");
            message.success(`「${imported.name}」已导入`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法导入 Skill");
        } finally {
            if (importRef.current) importRef.current.value = "";
        }
    };

    const clearFilters = () => {
        setKeyword("");
        setCategory(ALL);
    };

    return (
        <div className="wg-library-page wg-paper-surface flex h-full flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <input ref={importRef} hidden type="file" accept=".md,.markdown,.json,text/markdown,application/json" onChange={(event) => void importSkill(event.target.files?.[0])} />
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title shrink-0 text-[21px] font-semibold">Skills</h1>
                        <p className="wg-library-meta mt-0.5">SKILLS / {String(view === "personal" ? personalSkills.length : sourceCatalog.length).padStart(2, "0")}</p>
                    </div>
                    <div className="wg-library-actions flex min-w-0 flex-1 items-center gap-2 md:ml-auto md:justify-end">
                        <label className="wg-library-search w-full md:max-w-md">
                            <Search className="size-4 shrink-0" />
                            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、用途或标签" aria-label="搜索 Skills" />
                        </label>
                        {view === "official" ? (
                            <Button className="shrink-0" loading={loadingRegistry} icon={<RefreshCw className="size-3.5" />} onClick={() => void refreshOfficial()}>
                                检查更新
                            </Button>
                        ) : view === "personal" ? (
                            <>
                                <Button className="shrink-0" icon={<FileUp className="size-3.5" />} onClick={() => importRef.current?.click()}>
                                    导入
                                </Button>
                                <Button className="shrink-0" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing(createPersonalSkill())}>
                                    新建
                                </Button>
                            </>
                        ) : null}
                    </div>
                </div>
            </header>

            <main className="wg-library-content min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto grid max-w-7xl items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
                    <aside className="wg-library-filter-rail thin-scrollbar max-h-56 overflow-y-auto border-b pb-4 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-10rem)] lg:max-h-[calc(100dvh-10rem)] lg:border-b-0 lg:border-r lg:pb-6 lg:pr-4">
                        <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">筛选</h2>
                            {hasActiveFilters ? (
                                <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={clearFilters}>
                                    清除筛选
                                </Button>
                            ) : null}
                        </div>
                        <SkillFilter
                            label="来源"
                            options={["官方", "作者私藏", "我的"]}
                            selected={view === "official" ? "官方" : view === "author" ? "作者私藏" : "我的"}
                            onChange={(value) => {
                                setView(value === "官方" ? "official" : value === "作者私藏" ? "author" : "personal");
                                setCategory(ALL);
                            }}
                        />
                        {view !== "personal" ? (
                            <div className="mt-6">
                                <SkillFilter label="分类" options={categories} selected={category} onChange={setCategory} />
                            </div>
                        ) : null}
                    </aside>

                    <section className="min-w-0" aria-label={view === "official" ? "官方 Skills" : view === "author" ? "作者私藏" : "我的 Skills"}>
                        {view !== "personal" ? (
                            <>
                                {view === "official" && registryError ? (
                                    <Alert
                                        showIcon
                                        type="warning"
                                        message={registryError}
                                        action={
                                            <Button size="small" onClick={() => void refreshOfficial()}>
                                                重新加载
                                            </Button>
                                        }
                                        className="mb-4"
                                    />
                                ) : null}
                                {view === "official" && loadingRegistry && !sourceCatalog.length ? (
                                    <div className="flex h-56 items-center justify-center">
                                        <Spin />
                                    </div>
                                ) : null}
                                {view === "author" || !loadingRegistry || sourceCatalog.length ? (
                                    visibleCatalog.length ? (
                                        <div className="wg-library-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                            {visibleCatalog.map((item) => (
                                                <SkillCatalogCard key={catalogId(item)} item={item} installingId={installingId} onOpen={() => void openDetail(item)} onInstall={install} onEnabledChange={setEnabled} onOwnershipChange={setZodiacOnly} />
                                            ))}
                                        </div>
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={sourceCatalog.length ? "没有符合当前条件的 Skill" : view === "author" ? "暂时没有作者私藏" : "暂时没有官方 Skills"} className="py-14">
                                            {hasActiveFilters ? (
                                                <Button size="small" onClick={clearFilters}>
                                                    清除筛选
                                                </Button>
                                            ) : view === "official" ? (
                                                <Button size="small" onClick={() => void refreshOfficial()}>
                                                    重新加载
                                                </Button>
                                            ) : null}
                                        </Empty>
                                    )
                                ) : null}
                            </>
                        ) : visiblePersonalSkills.length ? (
                            <div className="wg-library-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {visiblePersonalSkills.map((skill) => {
                                    const index = personalSkills.findIndex((item) => item.id === skill.id);
                                    return <PersonalSkillCard key={skill.id} skill={skill} index={index} count={personalSkills.length} onEnabledChange={setEnabled} onOwnershipChange={setZodiacOnly} onMove={move} onEdit={setEditing} onRemove={remove} />;
                                })}
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={personalSkills.length ? "没有符合当前条件的 Skill" : "还没有个人 Skill"} className="py-14">
                                {hasActiveFilters ? (
                                    <Button size="small" onClick={clearFilters}>
                                        清除筛选
                                    </Button>
                                ) : (
                                    <div className="flex justify-center gap-2">
                                        <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => importRef.current?.click()}>
                                            从本机导入
                                        </Button>
                                        <Button size="small" type="primary" onClick={() => setEditing(createPersonalSkill())}>
                                            新建 Skill
                                        </Button>
                                    </div>
                                )}
                            </Empty>
                        )}
                    </section>
                </div>
            </main>

            <SkillDetailModal item={detail} body={detailBody} loading={detailLoading} error={detailError} installingId={installingId} onClose={() => setDetail(null)} onInstall={install} onEnabledChange={setEnabled} onOwnershipChange={setZodiacOnly} />
            <PersonalSkillEditorModal
                skill={editing}
                onClose={() => setEditing(null)}
                onSave={(skill) => {
                    save(skill);
                    setEditing(null);
                    message.success("Skill 已保存");
                }}
            />
        </div>
    );
}

function SkillCatalogCard({
    item,
    installingId,
    onOpen,
    onInstall,
    onEnabledChange,
    onOwnershipChange,
}: {
    item: CatalogItem;
    installingId: string;
    onOpen: () => void;
    onInstall: (entry: SkillRegistryEntry) => Promise<void>;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onOwnershipChange: (id: string, zodiacOnly: boolean) => void;
}) {
    const entry = item.entry;
    const installed = item.installed;
    const updateAvailable = isUpdateAvailable(item);
    return (
        <Card hoverable className="[content-visibility:auto] overflow-hidden [contain-intrinsic-size:220px]" styles={{ body: { padding: 0 } }}>
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{entry?.name || installed?.name}</h2>
                            <span className="mt-1 block text-xs text-stone-400 dark:text-stone-500">{catalogPublisher(item)}</span>
                        </div>
                        {installed ? (
                            <Tag color={updateAvailable ? "blue" : "green"} className="!m-0 shrink-0">
                                {updateAvailable ? "可更新" : "已安装"}
                            </Tag>
                        ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{entry?.description || installed?.description}</p>
                    {catalogSource(item) === "author" ? <AuthorNote note={entry?.authorNote || installed?.authorNote} className="mt-3" /> : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(entry?.tags || installed?.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="!m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                {entry && (!installed || updateAvailable) ? (
                    <Button block type="primary" size="small" loading={installingId === entry.id} icon={<Download className="size-3.5" />} onClick={() => void onInstall(entry)}>
                        {updateAvailable ? "更新" : "安装"}
                    </Button>
                ) : installed ? (
                    <div className="flex w-full items-center justify-between gap-2">
                        <SkillOwnershipControl skill={installed} onChange={(zodiacOnly) => onOwnershipChange(installed.id, zodiacOnly)} />
                        <div className="flex shrink-0 items-center gap-1.5 text-xs text-stone-500">
                            <span>{installed.enabled ? "已启用" : "未启用"}</span>
                            <Switch size="small" checked={installed.enabled} onChange={(enabled) => onEnabledChange(installed.id, enabled)} />
                        </div>
                    </div>
                ) : null}
            </div>
        </Card>
    );
}

function PersonalSkillCard({
    skill,
    index,
    count,
    onEnabledChange,
    onOwnershipChange,
    onMove,
    onEdit,
    onRemove,
}: {
    skill: InstalledSkill;
    index: number;
    count: number;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onOwnershipChange: (id: string, zodiacOnly: boolean) => void;
    onMove: (id: string, direction: -1 | 1) => void;
    onEdit: (skill: InstalledSkill) => void;
    onRemove: (id: string) => void;
}) {
    return (
        <Card className="[content-visibility:auto] overflow-hidden [contain-intrinsic-size:220px]" styles={{ body: { padding: 0 } }}>
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(skill)}>
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{skill.name}</h2>
                            <span className="mt-1 block text-xs text-stone-400 dark:text-stone-500">个人 Skill</span>
                        </div>
                    </button>
                    <Switch size="small" checked={skill.enabled} onChange={(enabled) => onEnabledChange(skill.id, enabled)} />
                </div>
                <button type="button" className="block w-full text-left" onClick={() => onEdit(skill)}>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{skill.description || "还没有简介"}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {skill.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="!m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </button>
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pb-4">
                <SkillOwnershipControl skill={skill} onChange={(zodiacOnly) => onOwnershipChange(skill.id, zodiacOnly)} />
                <div className="flex shrink-0 items-center gap-1">
                    <Button type="text" size="small" aria-label="上移" disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(skill.id, -1)} />
                    <Button type="text" size="small" aria-label="下移" disabled={index === count - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(skill.id, 1)} />
                    <Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(skill)}>
                        编辑
                    </Button>
                    <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => onRemove(skill.id)}>
                        删除
                    </Button>
                </div>
            </div>
        </Card>
    );
}

function SkillDetailModal({
    item,
    body,
    loading,
    error,
    installingId,
    onClose,
    onInstall,
    onEnabledChange,
    onOwnershipChange,
}: {
    item: CatalogItem | null;
    body: string;
    loading: boolean;
    error: string;
    installingId: string;
    onClose: () => void;
    onInstall: (entry: SkillRegistryEntry) => Promise<void>;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onOwnershipChange: (id: string, zodiacOnly: boolean) => void;
}) {
    const currentSkills = useSkillStore((state) => state.skills);
    const entry = item?.entry;
    const requestedInstalled = item?.installed;
    const installed = requestedInstalled ? currentSkills.find((skill) => skill.id === requestedInstalled.id) || requestedInstalled : undefined;
    const updateAvailable = item && requestedInstalled ? isUpdateAvailable({ ...item, installed }) : false;
    return (
        <Modal title={entry?.name || installed?.name} open={Boolean(item)} onCancel={onClose} footer={null} width={760} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {item ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Tag>{catalogPublisher(item)}</Tag>
                            <Tag>{catalogCategory(item)}</Tag>
                            <span className="text-xs text-stone-400">v{entry?.version || installed?.version}</span>
                        </div>
                        <p className="text-sm leading-6 text-stone-500">{entry?.description || installed?.description}</p>
                        {catalogSource(item) === "author" ? <AuthorNote note={entry?.authorNote || installed?.authorNote} expanded /> : null}
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        {loading ? (
                            <div className="flex h-40 items-center justify-center">
                                <Spin />
                            </div>
                        ) : null}
                        {error ? <Alert showIcon type="error" message={error} /> : null}
                        {!loading && !error ? <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-stone-800 dark:text-stone-300">{body}</pre> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pt-4">
                        {entry && (!installed || updateAvailable) ? (
                            <Button type="primary" loading={installingId === entry.id} icon={<Download className="size-4" />} onClick={() => void onInstall(entry)}>
                                {updateAvailable ? "更新 Skill" : "安装 Skill"}
                            </Button>
                        ) : null}
                        {installed ? (
                            <div className="flex flex-wrap items-center gap-3">
                                <SkillOwnershipControl skill={installed} onChange={(zodiacOnly) => onOwnershipChange(installed.id, zodiacOnly)} />
                                <div className="flex items-center gap-2 text-sm">
                                    <Switch checked={installed.enabled} onChange={(enabled) => onEnabledChange(installed.id, enabled)} />
                                    {installed.enabled ? "已启用" : "未启用"}
                                </div>
                            </div>
                        ) : null}
                        {entry?.homepage || installed?.homepage ? (
                            <Button href={entry?.homepage || installed?.homepage} target="_blank" icon={<ExternalLink className="size-4" />}>
                                查看来源
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function SkillOwnershipControl({ skill, onChange }: { skill: InstalledSkill; onChange: (zodiacOnly: boolean) => void }) {
    return (
        <Segmented
            size="small"
            className="wg-skill-ownership"
            value={skill.zodiacOnly ? "zodiac" : "terminal"}
            options={[
                { label: "Zodiac 专属", value: "zodiac", title: "只在 Zodiac 对话框里附加使用" },
                { label: "终端可用", value: "terminal", title: "可在画布终端节点的设置中启用" },
            ]}
            onChange={(value) => onChange(value === "zodiac")}
        />
    );
}

function SkillFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    return (
        <div>
            <div className="mb-2 text-xs font-medium text-stone-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag", selected === option && "is-active")} onChange={() => onChange(option)}>
                        {option}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function catalogId(item: CatalogItem) {
    return item.entry?.id || item.installed!.id;
}

function catalogPublisher(item: CatalogItem) {
    return item.entry?.publisher || item.installed?.publisher || "WorkflowGenerator";
}

function catalogSource(item: CatalogItem) {
    return item.entry?.catalogSource || item.installed?.catalogSource || "official";
}

function catalogCategory(item: CatalogItem) {
    const category = item.entry?.category || item.installed?.category || item.entry?.capabilities[0] || item.installed?.capabilities[0] || "workflow";
    if (category === "writing") return "文本";
    if (category === "image") return "图像";
    if (category === "video") return "视频";
    if (category === "audio") return "音频";
    if (category === "terminal") return "终端";
    if (category === "workflow") return "工作流";
    return category;
}

function isUpdateAvailable(item: CatalogItem) {
    if (!item.entry || !item.installed) return false;
    const integrity = registryEntryIntegrity(item.entry);
    return item.installed.version !== item.entry.version || Boolean(integrity && item.installed.checksum && item.installed.checksum !== integrity);
}

function dedupeRegistry(entries: SkillRegistryEntry[]) {
    const seen = new Set<string>();
    return entries.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

export function PersonalSkillEditorModal({ skill, onClose, onSave }: { skill: InstalledSkill | null; onClose: () => void; onSave: (skill: InstalledSkill) => void }) {
    const [draft, setDraft] = useState(skill);
    useEffect(() => setDraft(skill), [skill]);
    if (!skill || !draft) return null;
    const patch = (value: Partial<InstalledSkill>) => setDraft((current) => (current ? { ...current, ...value } : current));
    return (
        <Modal
            title={skill.name === "未命名 Skill" ? "新建 Skill" : "编辑 Skill"}
            open
            onCancel={onClose}
            okText="保存"
            cancelText="取消"
            width={720}
            onOk={() => onSave({ ...draft, name: draft.name.trim() || "未命名 Skill", source: "personal", updatedAt: new Date().toISOString() })}
        >
            <div className="grid gap-4 pt-2">
                <label className="grid gap-1.5 text-xs font-medium">
                    名称
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                    简介
                    <Input value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                    归属
                    <Segmented
                        value={draft.zodiacOnly ? "zodiac" : "terminal"}
                        options={[
                            { label: "Zodiac 专属", value: "zodiac", title: "只在 Zodiac 对话框里附加使用" },
                            { label: "终端可用", value: "terminal", title: "可在画布终端节点的设置中启用" },
                        ]}
                        onChange={(value) => patch({ zodiacOnly: value === "zodiac" })}
                    />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                    使用方式
                    <Input.TextArea rows={14} value={draft.body} onChange={(event) => patch({ body: event.target.value })} placeholder="写清适用场景、步骤、判断标准与交付要求。" />
                </label>
            </div>
        </Modal>
    );
}
