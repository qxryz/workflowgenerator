import { Alert, App, Button, Drawer, Empty, Select, Spin, Switch, Tag } from "antd";
import { Download, ExternalLink, FileUp, Plus, RefreshCw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { AuthorNote } from "@/components/author-library/author-note";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { createPersonalSkill, type InstalledSkill } from "@/services/skills/skill-presets";
import { downloadRegistrySkill, fetchRegistrySkillBody, fetchSkillRegistry, registryEntryIntegrity, type SkillRegistryEntry } from "@/services/skills/skill-registry";
import { useSkillStore } from "@/stores/use-skill-store";

import {
    ALL,
    UNCATEGORIZED,
    catalogSource,
    fileBadgeCount,
    formatBytes,
    groupBySource,
    hasCompleteMeta,
    hasEnglishMeta,
    matchesFilters,
    matchesKeyword,
    skillAltName,
    skillAuthorLabel,
    skillCategoryLabel,
    skillDownloads,
    skillFileGroups,
    skillId,
    skillName,
    skillSource,
    skillSourceUrl,
    skillShowcase,
    skillStructured,
    skillSubTags,
    skillSummary,
    skillTriggerWords,
    skillVersion,
    sortCatalog,
    stripLocalPaths,
    SKILL_CATEGORIES,
    type CatalogItem,
    type SkillFilters,
    type SkillSort,
} from "./skill-catalog";
import { PersonalSkillCard, SkillCatalogCard, SourceTag } from "./skill-catalog-card";
import { PersonalSkillEditorModal } from "./skill-personal-editor";
import { SkillFilterRail } from "./skill-filter-rail";

/** zodic-panel.tsx 直接从这里取个人技能编辑器，所以保留这个再导出。 */
export { PersonalSkillEditorModal };

/** 左栏「来源」视图：官方目录（含官方精选 / 官方 / 社区 / 来源未知）、作者私藏、我的。 */
type SkillsView = "official" | "author" | "personal";

const INITIAL_FILTERS: SkillFilters = { category: ALL, author: ALL, tag: ALL, status: "all", content: "all", metadata: "all" };
const PAGE_SIZE = 24;

export function SkillsManager() {
    const { message } = App.useApp();
    const { t, language } = useAppTranslation();
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
    const [registryWarnings, setRegistryWarnings] = useState<string[]>([]);
    const [installingId, setInstallingId] = useState("");
    const [installingAll, setInstallingAll] = useState(false);
    const [editing, setEditing] = useState<InstalledSkill | null>(null);
    const [keyword, setKeyword] = useState("");
    const deferredKeyword = useDeferredValue(keyword.trim().toLocaleLowerCase());
    const [filters, setFilters] = useState<SkillFilters>(INITIAL_FILTERS);
    const [sort, setSort] = useState<SkillSort>("recommended");
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [detail, setDetail] = useState<CatalogItem | null>(null);
    const [detailBody, setDetailBody] = useState("");
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");

    const installedById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
    const officialInstalled = useMemo(() => skills.filter((skill) => skill.source !== "personal").sort((a, b) => a.priority - b.priority), [skills]);
    const personalSkills = useMemo(() => skills.filter((skill) => skill.source === "personal").sort((a, b) => a.priority - b.priority), [skills]);
    // 目录 = 注册表条目 + 已安装但没有对应条目的技能（作者私藏、旧版本地安装）。
    const catalog = useMemo<CatalogItem[]>(() => {
        const remoteIds = new Set(registry.map((entry) => entry.id));
        return [...registry.map((entry) => ({ entry, installed: installedById.get(entry.id) })), ...officialInstalled.filter((skill) => !remoteIds.has(skill.id)).map((installed) => ({ entry: null, installed }))];
    }, [installedById, officialInstalled, registry]);
    const viewItems = useMemo(() => [...catalog.filter((item) => catalogSource(item) === view), ...(view === "personal" ? personalSkills.map((installed) => ({ entry: null, installed })) : [])], [catalog, personalSkills, view]);
    const filtered = useMemo(() => {
        const matched = viewItems.filter((item) => matchesFilters(item, filters) && matchesKeyword(item, deferredKeyword));
        // 个人技能默认保持自定义顺序，排序控件才覆盖它。
        return sort === "recommended" && view === "personal" ? matched : sortCatalog(matched, sort, language);
    }, [viewItems, filters, deferredKeyword, sort, language, view]);
    const groups = groupBySource(filtered);
    let remaining = limit;
    const visibleGroups = groups
        .map((group) => {
            const visible = group.items.slice(0, Math.max(0, remaining));
            remaining -= visible.length;
            return { ...group, visible };
        })
        .filter((group) => group.visible.length);
    const enabledCount = skills.filter((skill) => skill.enabled).length;
    // 「全部安装」装的是当前筛选结果，装完就归零，按钮随之变成"已全部安装"。
    const pendingInstallCount = useMemo(() => filtered.filter((item) => item.entry && !item.installed).length, [filtered]);
    const viewCounts = useMemo(
        () => ({ 官方: catalog.filter((item) => catalogSource(item) === "official").length, 作者私藏: catalog.filter((item) => catalogSource(item) === "author").length, 我的: personalSkills.length }),
        [catalog, personalSkills],
    );
    const categories = useMemo(() => categoryChips(viewItems), [viewItems]);
    const authors = useMemo(() => authorChips(viewItems), [viewItems]);
    const tags = useMemo(() => tagChips(viewItems), [viewItems]);
    const extraFilterCount = [filters.author !== ALL, filters.tag !== ALL, filters.status !== "all", filters.content !== "all", filters.metadata !== "all"].filter(Boolean).length;
    const hasActiveFilters = Boolean(keyword.trim()) || extraFilterCount > 0 || filters.category !== ALL;

    useEffect(() => setLimit(PAGE_SIZE), [view, deferredKeyword, filters, sort]);

    const refreshOfficial = async (quiet = false) => {
        setRegistryAttempted(true);
        setLoadingRegistry(true);
        setRegistryError("");
        try {
            const result = await fetchSkillRegistry();
            setRegistry(dedupeRegistry(result.skills));
            setRegistryWarnings(result.warnings || []);
            if (!quiet) message.success(`已更新 ${result.skills.length} 个 Skills`);
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

    /**
     * 一键安装当前筛选结果里还没装的技能。
     * 逐个下载、逐个落库：单个失败只记下来继续，不让整批回滚——网络抖动不该让用户重来一遍。
     */
    const installAllVisible = async () => {
        const pending = filtered.filter((item) => item.entry && !item.installed).map((item) => item.entry!);
        if (!pending.length) {
            message.info(t("当前列表里没有待安装的技能"));
            return;
        }
        setInstallingAll(true);
        let done = 0;
        const failed: string[] = [];
        for (const entry of pending) {
            setInstallingId(entry.id);
            try {
                save(await downloadRegistrySkill(entry));
                done += 1;
            } catch {
                failed.push(entry.name);
            }
        }
        setInstallingId("");
        setInstallingAll(false);
        if (failed.length) message.warning(t("已安装 {done} 个，{failed} 个失败：{names}", { done, failed: failed.length, names: failed.slice(0, 3).join("、") }));
        else message.success(t("已安装 {done} 个技能", { done }));
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
        setFilters(INITIAL_FILTERS);
    };

    const emptyDescription = viewItems.length
        ? "没有符合当前条件的 Skill"
        : view === "author"
          ? "暂时没有作者私藏"
          : view === "personal"
            ? "还没有个人 Skill"
            : "暂时没有官方 Skills";

    return (
        <div className="wg-library-page flex h-full flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <input ref={importRef} hidden type="file" accept=".md,.markdown,.json,text/markdown,application/json" onChange={(event) => void importSkill(event.target.files?.[0])} />
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title shrink-0 text-[21px] font-semibold">Skills</h1>
                        <p className="wg-library-meta mt-0.5">
                            {t("{installed} 个已安装 · {enabled} 个已启用", { installed: skills.length, enabled: enabledCount })}
                        </p>
                    </div>
                    <div className="wg-library-actions flex min-w-0 flex-1 items-center gap-2 md:ml-auto md:justify-end">
                        <label className="wg-library-search w-full md:max-w-md">
                            <Search className="size-4 shrink-0" />
                            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("搜索技能名称、简介、标签或作者")} aria-label={t("搜索 Skills")} />
                        </label>
                        {view === "official" ? (
                            <>
                                <Button className="shrink-0" loading={loadingRegistry} icon={<RefreshCw className="size-3.5" />} onClick={() => void refreshOfficial()}>
                                    {t("检查更新")}
                                </Button>
                                <Button className="shrink-0" type="primary" loading={installingAll} disabled={!pendingInstallCount} icon={<Download className="size-3.5" />} onClick={() => void installAllVisible()}>
                                    {pendingInstallCount ? t("全部安装（{count}）", { count: pendingInstallCount }) : t("已全部安装")}
                                </Button>
                            </>
                        ) : view === "personal" ? (
                            <>
                                <Button className="shrink-0" icon={<FileUp className="size-3.5" />} onClick={() => importRef.current?.click()}>
                                    {t("导入")}
                                </Button>
                                <Button className="shrink-0" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing(createPersonalSkill())}>
                                    {t("新建")}
                                </Button>
                            </>
                        ) : null}
                    </div>
                </div>
            </header>

            <main className="wg-library-content min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto grid max-w-7xl items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
                    <SkillFilterRail
                        options={["官方", "作者私藏", "我的"]}
                        viewLabel={view === "official" ? "官方" : view === "author" ? "作者私藏" : "我的"}
                        viewCounts={viewCounts}
                        onViewChange={(label) => setView(label === "官方" ? "official" : label === "作者私藏" ? "author" : "personal")}
                        categories={categories}
                        category={filters.category}
                        onCategoryChange={(category) => setFilters((current) => ({ ...current, category }))}
                        authors={authors}
                        tags={tags}
                        filters={filters}
                        onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
                        extraFilterCount={extraFilterCount}
                        canClear={hasActiveFilters}
                        onClear={clearFilters}
                    />

                    <section className="min-w-0" aria-label={view === "official" ? "官方 Skills" : view === "author" ? "作者私藏" : "我的 Skills"}>
                        {view === "official" && registryError ? (
                            <Alert
                                showIcon
                                type="warning"
                                message={registryError}
                                action={
                                    <Button size="small" onClick={() => void refreshOfficial()}>
                                        {t("重新加载")}
                                    </Button>
                                }
                                className="mb-4"
                            />
                        ) : null}
                        {view === "official" && registryWarnings.length ? (
                            <Alert showIcon type="info" className="mb-4" message={t("有 {count} 个技能条目被跳过", { count: registryWarnings.length })} description={registryWarnings.join("；")} />
                        ) : null}
                        {view === "official" && loadingRegistry && !viewItems.length ? (
                            <div className="flex h-56 items-center justify-center">
                                <Spin />
                            </div>
                        ) : filtered.length ? (
                            <>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs text-stone-500 dark:text-stone-400">{t("找到 {count} 个技能", { count: filtered.length })}</span>
                                    <Select
                                        size="small"
                                        className="min-w-28"
                                        value={sort}
                                        onChange={setSort}
                                        options={[
                                            { value: "recommended", label: t("推荐") },
                                            { value: "name", label: t("按名称") },
                                            { value: "version", label: t("按版本") },
                                            { value: "updated", label: t("按最近更新") },
                                            { value: "files", label: t("按文件数") },
                                        ]}
                                    />
                                </div>
                                {visibleGroups.map((group) => (
                                    <section key={group.kind} className="mb-5">
                                        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-stone-600 dark:text-stone-300">
                                            {t(group.label)}
                                            <span className="font-normal text-stone-400 dark:text-stone-500">{group.items.length}</span>
                                        </h3>
                                        <div className="wg-library-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                            {group.visible.map((item) =>
                                                item.entry ? (
                                                    <SkillCatalogCard key={skillId(item)} item={item} installingId={installingId} updateAvailable={isUpdateAvailable(item)} onOpen={() => void openDetail(item)} onInstall={install} onEnabledChange={setEnabled} />
                                                ) : (
                                                    <PersonalSkillCard
                                                        key={skillId(item)}
                                                        skill={item.installed!}
                                                        index={personalSkills.findIndex((skill) => skill.id === item.installed!.id)}
                                                        count={personalSkills.length}
                                                        onEnabledChange={setEnabled}
                                                        onMove={move}
                                                        onEdit={setEditing}
                                                        onRemove={remove}
                                                    />
                                                ),
                                            )}
                                        </div>
                                    </section>
                                ))}
                                {filtered.length > limit ? (
                                    <div className="flex justify-center pb-6">
                                        <Button size="small" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                                            {t("显示更多（剩余 {count} 个）", { count: filtered.length - limit })}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(emptyDescription)} className="py-14">
                                {hasActiveFilters ? (
                                    <Button size="small" onClick={clearFilters}>
                                        {t("清除筛选")}
                                    </Button>
                                ) : view === "official" ? (
                                    <Button size="small" onClick={() => void refreshOfficial()}>
                                        {t("重新加载")}
                                    </Button>
                                ) : view === "personal" ? (
                                    <div className="flex justify-center gap-2">
                                        <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => importRef.current?.click()}>
                                            {t("从本机导入")}
                                        </Button>
                                        <Button size="small" type="primary" onClick={() => setEditing(createPersonalSkill())}>
                                            {t("新建 Skill")}
                                        </Button>
                                    </div>
                                ) : null}
                            </Empty>
                        )}
                    </section>
                </div>
            </main>

            <SkillDetailDrawer
                item={detail}
                body={detailBody}
                loading={detailLoading}
                error={detailError}
                installingId={installingId}
                onClose={() => setDetail(null)}
                onInstall={install}
                onEnabledChange={setEnabled}
                onOwnershipChange={setZodiacOnly}
            />
            <PersonalSkillEditorModal
                skill={editing}
                onClose={() => setEditing(null)}
                onSave={(skill) => {
                    save(skill);
                    setEditing(null);
                    message.success(t("Skill 已保存"));
                }}
            />
        </div>
    );
}

/** L2 详情：结构化介绍 / 文件构成 / 正文逐层展开，正文用 Markdown 渲染并过滤本机绝对路径。 */
function SkillDetailDrawer({
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
    const { t, language } = useAppTranslation();
    const currentSkills = useSkillStore((state) => state.skills);
    const [bodyOpen, setBodyOpen] = useState(false);
    const [fileLimits, setFileLimits] = useState<Record<string, number>>({});
    const [activeMedia, setActiveMedia] = useState(0);
    useEffect(() => {
        setBodyOpen(false);
        setFileLimits({});
        setActiveMedia(0);
    }, [item]);
    const requested = item?.installed;
    // entry / installed 只在这里取一次；作者备注来自任一方的 authorNote。
    const entry = (item?.entry || null) as (SkillRegistryEntry & { authorNote?: string }) | null;
    const installed = (requested ? currentSkills.find((skill) => skill.id === requested.id) || requested : undefined) as (InstalledSkill & { authorNote?: string }) | undefined;
    const updateAvailable = entry && requested ? isUpdateAvailable({ entry, installed }) : false;
    const altName = item ? skillAltName(item, language) : undefined;
    const structured = item ? skillStructured(item, language) : null;
    const showcase = item ? skillShowcase(item) : [];
    const downloads = item ? skillDownloads(item) : undefined;
    const triggers = item ? skillTriggerWords(item) : [];
    const sourceUrl = item ? skillSourceUrl(item) : undefined;
    const fileGroups = item ? skillFileGroups(item) : [];
    return (
        <Drawer open={Boolean(item)} onClose={onClose} width="min(920px, 92vw)" title={item ? skillName(item, language) : ""} styles={{ body: { paddingTop: 16 } }}>
            {item ? (
                <div className="grid gap-5">
                    {showcase.length ? <SkillMediaGallery media={showcase} active={activeMedia} onActiveChange={setActiveMedia} title={skillName(item, language)} /> : null}
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <SourceTag item={item} />
                            <Tag className="!m-0">{t(skillCategoryLabel(item))}</Tag>
                            <span className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
                                {skillId(item)} · v{skillVersion(item)}
                            </span>
                            {downloads !== undefined ? <span className="text-[11px] text-stone-400 dark:text-stone-500">{t("{count} 次使用", { count: downloads.toLocaleString() })}</span> : null}
                            {fileBadgeCount(item) ? <Tag className="!m-0 text-[11px]">{t("含 {count} 个文件", { count: fileBadgeCount(item) })}</Tag> : null}
                            {!hasCompleteMeta(item) ? (
                                <Tag color="orange" className="!m-0 text-[11px]">
                                    {t("元数据不全")}
                                </Tag>
                            ) : null}
                        </div>
                        {altName ? <div className="mt-1 text-xs text-stone-400 dark:text-stone-500">{altName}</div> : null}
                        <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                            {t("作者：{author}", { author: skillAuthorLabel(item) })}
                            {language === "en-US" && !hasEnglishMeta(item) ? <span className="ml-2 text-amber-600 dark:text-amber-500">{t("暂无英文")}</span> : null}
                        </div>
                    </div>

                    <p className="text-sm leading-6 text-stone-700 dark:text-stone-300">{skillSummary(item, language)}</p>

                    {skillSource(item) === "author" ? <AuthorNote note={entry?.authorNote || installed?.authorNote} expanded /> : null}

                    {structured ? (
                        <section aria-label={t("结构化介绍")} className="grid gap-3 sm:grid-cols-2">
                            {structured.summary ? <StructuredBlock label="概览" value={structured.summary} /> : null}
                            {structured.bestFor.length ? <StructuredBlock label="适用场景" value={structured.bestFor.join(" · ")} /> : null}
                            {structured.howToUse ? <StructuredBlock label="如何使用" value={structured.howToUse} /> : null}
                            {structured.outputs ? <StructuredBlock label="产出内容" value={structured.outputs} /> : null}
                        </section>
                    ) : null}

                    {fileGroups.length > 1 ? (
                        <div>
                            <div className="mb-2 text-xs font-semibold text-stone-600 dark:text-stone-300">{t("文件构成")}</div>
                            <div className="grid gap-3">
                                {fileGroups.map((group) => {
                                    const shown = group.files.slice(0, fileLimits[group.dir] || 5);
                                    return (
                                        <div key={group.dir || "root"}>
                                            <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                                                <span className="font-mono">{group.dir || t("根目录")}</span>
                                                <span>
                                                    {group.files.length} · {formatBytes(group.bytes)}
                                                </span>
                                            </div>
                                            <ul className="mt-1 grid gap-0.5">
                                                {shown.map((file) => (
                                                    <li key={file.path} className="flex items-center justify-between gap-2 font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                                        <span className="truncate">{file.path}</span>
                                                        <span className="flex shrink-0 items-center gap-2">
                                                            {file.isEntry ? <Tag className="!m-0 text-[10px]">{t("入口文件")}</Tag> : null}
                                                            {formatBytes(file.bytes)}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            {group.files.length > shown.length ? (
                                                <Button type="link" size="small" className="!h-auto !px-0 text-[11px]" onClick={() => setFileLimits((current) => ({ ...current, [group.dir]: group.files.length }))}>
                                                    {t("查看全部 {count} 个", { count: group.files.length })}
                                                </Button>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {triggers.length ? <div className="text-xs text-stone-500 dark:text-stone-400">{t("触发词：{words}", { words: triggers.join("、") })}</div> : null}

                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">{t("使用说明（SKILL.md）")}</span>
                            <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={() => setBodyOpen((open) => !open)}>
                                {t(bodyOpen ? "收起" : "展开")}
                            </Button>
                        </div>
                        {bodyOpen ? (
                            loading ? (
                                <div className="flex h-40 items-center justify-center">
                                    <Spin />
                                </div>
                            ) : error ? (
                                <Alert showIcon type="error" message={error} />
                            ) : body ? (
                                <div className="mt-2 border-t border-stone-200 pt-3 dark:border-stone-800">
                                    <Streamdown className="agent-streamdown text-sm">{stripLocalPaths(body, t("（本机路径已隐藏）"))}</Streamdown>
                                </div>
                            ) : null
                        ) : (
                            <div className="mt-2 text-xs text-stone-400 dark:text-stone-500">{loading ? <Spin size="small" /> : t("正文较长，展开后再渲染。")}</div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                        {entry && (!installed || updateAvailable) ? (
                            <Button type="primary" loading={installingId === entry.id} icon={<Download className="size-4" />} onClick={() => void onInstall(entry)}>
                                {t(updateAvailable ? "更新 Skill" : "安装 Skill")}
                            </Button>
                        ) : null}
                        {installed ? (
                            <>
                                <div className="flex items-center gap-2 text-sm">
                                    <Switch checked={installed.enabled} onChange={(enabled) => onEnabledChange(installed.id, enabled)} />
                                    {t(installed.enabled ? "已启用" : "未启用")}
                                </div>
                                <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400" title={t("只在 Zodiac 对话框里附加使用")}>
                                    <Switch size="small" checked={Boolean(installed.zodiacOnly)} onChange={(zodiacOnly) => onOwnershipChange(installed.id, zodiacOnly)} />
                                    {t("Zodiac 专属")}
                                </div>
                            </>
                        ) : null}
                        {sourceUrl ? (
                            <Button href={sourceUrl} target="_blank" icon={<ExternalLink className="size-4" />}>
                                {t("查看来源")}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

function SkillMediaGallery({ media, active, onActiveChange, title }: { media: string[]; active: number; onActiveChange: (index: number) => void; title: string }) {
    const { t } = useAppTranslation();
    const selected = media[Math.min(active, media.length - 1)];
    const video = /\.(?:mp4|webm|mov)$/iu.test(new URL(selected).pathname);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [selected]);
    return (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-black dark:border-stone-800">
            <div className="aspect-video w-full bg-black">
                {failed ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-stone-400">{t("预览素材暂时无法加载")}</div>
                ) : video ? (
                    <video key={selected} src={selected} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label={`${title} · ${t("演示视频")}`} onError={() => setFailed(true)} />
                ) : (
                    <img src={selected} alt={`${title} · ${t("预览")}`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} />
                )}
            </div>
            {media.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto bg-stone-950 p-2">
                    {media.map((url, index) => (
                        <button
                            type="button"
                            key={url}
                            onClick={() => onActiveChange(index)}
                            className={`shrink-0 rounded px-3 py-1 text-xs ${index === active ? "bg-white text-stone-950" : "bg-white/10 text-white hover:bg-white/20"}`}
                        >
                            {index === 0 ? t("封面") : t("案例 {count}", { count: index })}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function StructuredBlock({ label, value }: { label: string; value: string }) {
    const { t } = useAppTranslation();
    return (
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="text-xs font-semibold text-stone-500 dark:text-stone-400">{t(label)}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">{value}</p>
        </div>
    );
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

function categoryChips(items: CatalogItem[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(skillCategoryLabel(item), (counts.get(skillCategoryLabel(item)) || 0) + 1);
    return [{ value: ALL, label: ALL, count: items.length }, ...[...SKILL_CATEGORIES, UNCATEGORIZED].filter((label) => counts.has(label)).map((label) => ({ value: label, label, count: counts.get(label)! }))];
}

function authorChips(items: CatalogItem[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(skillAuthorLabel(item), (counts.get(skillAuthorLabel(item)) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ value: label, label, count }));
}

function tagChips(items: CatalogItem[]) {
    const counts = new Map<string, number>();
    for (const item of items) for (const tag of skillSubTags(item, "zh-CN")) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ value: label, label, count }));
}
