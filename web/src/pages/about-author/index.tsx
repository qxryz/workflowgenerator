import { Alert, App, Button, Card, Empty, Spin, Tag } from "antd";
import { BookOpenText, Download, FileText, ImageIcon, Music2, RefreshCw, Search, Sparkles, Video, WandSparkles } from "lucide-react";
import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react";

import { AuthorNote } from "@/components/author-library/author-note";
import { fetchAuthorLibraryCatalog, type AuthorLibrarySnapshot } from "@/services/author-library/catalog";
import type { AuthorLibraryItem, AuthorLibraryKind } from "@/services/author-library/contract";
import { installAuthorLibraryItem } from "@/services/author-library/install";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAuthorPromptStore } from "@/stores/use-author-prompt-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { cn } from "@/lib/utils";

type LibraryFilter = "all" | AuthorLibraryKind;

const filters: Array<{ label: string; value: LibraryFilter }> = [
    { label: "全部", value: "all" },
    { label: "Skills", value: "skill" },
    { label: "提示词", value: "prompt" },
    { label: "资产", value: "asset" },
];

export default function AboutAuthorPage() {
    const { message } = App.useApp();
    const skills = useSkillStore((state) => state.skills);
    const prompts = useAuthorPromptStore((state) => state.prompts);
    const assets = useAssetStore((state) => state.assets);
    const [snapshot, setSnapshot] = useState<AuthorLibrarySnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState<LibraryFilter>("all");
    const [keyword, setKeyword] = useState("");
    const deferredKeyword = useDeferredValue(keyword.trim().toLocaleLowerCase());
    const [installingId, setInstallingId] = useState("");

    const refresh = async () => {
        setLoading(true);
        setError("");
        try {
            setSnapshot(await fetchAuthorLibraryCatalog());
        } catch (reason) {
            setSnapshot(null);
            setError(reason instanceof Error ? reason.message : "作者库暂时不可用");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    const items = useMemo(() => {
        const catalogItems = snapshot?.catalog.items || [];
        return catalogItems.filter((item) => {
            if (filter !== "all" && item.kind !== filter) return false;
            if (!deferredKeyword) return true;
            return [item.title, item.description, item.authorNote, item.category, ...item.tags].filter(Boolean).join(" ").toLocaleLowerCase().includes(deferredKeyword);
        });
    }, [deferredKeyword, filter, snapshot?.catalog.items]);
    const hasFilters = filter !== "all" || Boolean(keyword.trim());

    const install = async (item: AuthorLibraryItem) => {
        setInstallingId(item.id);
        try {
            const result = await installAuthorLibraryItem(item, snapshot?.catalog.publisher.name || "作者");
            message.success(destinationMessage(result.destination, result.title));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
        } finally {
            setInstallingId("");
        }
    };

    const installState = (item: AuthorLibraryItem) => {
        const checksum =
            item.kind === "skill"
                ? skills.find((skill) => skill.id === item.id && skill.catalogSource === "author")?.checksum
                : item.kind === "prompt"
                  ? prompts.find((prompt) => prompt.id === item.id)?.checksum
                  : assets.find((asset) => asset.metadata?.authorLibraryId === item.id)?.metadata?.authorLibraryChecksum;
        if (!checksum) return "available" as const;
        return checksum === item.sha256 ? ("installed" as const) : ("update" as const);
    };

    const clearFilters = () => {
        setFilter("all");
        setKeyword("");
    };

    return (
        <div className="wg-library-page wg-paper-surface flex h-full flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title shrink-0 text-[21px] font-semibold">关于作者</h1>
                        <p className="wg-library-meta mt-0.5">AUTHOR LIBRARY / {loading ? "--" : String(snapshot?.catalog.items.length || 0).padStart(2, "0")}</p>
                    </div>
                    <div className="wg-library-actions flex min-w-0 flex-1 items-center gap-2 md:ml-auto md:justify-end">
                        <label className="wg-library-search w-full md:max-w-md">
                            <Search className="size-4 shrink-0" />
                            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、用途或标签" aria-label="搜索作者私藏" />
                        </label>
                        <Button className="shrink-0" loading={loading} icon={<RefreshCw className="size-3.5" />} onClick={() => void refresh()}>
                            检查更新
                        </Button>
                    </div>
                </div>
            </header>

            <main className="wg-library-content min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto grid max-w-7xl items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
                    <aside className="wg-library-filter-rail border-b pb-4 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-10rem)] lg:border-b-0 lg:border-r lg:pb-6 lg:pr-4">
                        <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">内容</h2>
                            {hasFilters ? (
                                <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={clearFilters}>
                                    清除筛选
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {filters.map((option) => (
                                <Tag.CheckableTag key={option.value} checked={filter === option.value} className={cn("prompt-filter-tag", filter === option.value && "is-active")} onChange={() => setFilter(option.value)}>
                                    {option.label}
                                </Tag.CheckableTag>
                            ))}
                        </div>
                    </aside>

                    <section className="min-w-0" aria-label="作者私藏">
                        {snapshot?.warning ? <Alert showIcon type="warning" message="当前显示上次内容" description={snapshot.warning} className="mb-4" /> : null}
                        {error ? (
                            <Alert
                                showIcon
                                type="error"
                                message="作者库暂时不可用"
                                description={error}
                                action={
                                    <Button size="small" onClick={() => void refresh()}>
                                        重新加载
                                    </Button>
                                }
                                className="mb-4"
                            />
                        ) : null}
                        {loading && !snapshot ? (
                            <div className="flex h-56 items-center justify-center" role="status" aria-label="正在加载作者私藏">
                                <Spin />
                            </div>
                        ) : null}
                        {!loading && !error && !snapshot?.catalog.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="作者还没有发布内容" className="py-14" /> : null}
                        {!loading && snapshot?.catalog.items.length && !items.length ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合当前条件的内容" className="py-14">
                                <Button size="small" onClick={clearFilters}>
                                    清除筛选
                                </Button>
                            </Empty>
                        ) : null}
                        {items.length ? (
                            <div className="wg-library-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {items.map((item) => (
                                    <AuthorLibraryCard key={item.id} item={item} state={installState(item)} installing={installingId === item.id} onInstall={() => void install(item)} />
                                ))}
                            </div>
                        ) : null}
                    </section>
                </div>
            </main>
        </div>
    );
}

function AuthorLibraryCard({ item, state, installing, onInstall }: { item: AuthorLibraryItem; state: "available" | "installed" | "update"; installing: boolean; onInstall: () => void }) {
    const destination = item.kind === "skill" ? "Skills · 作者私藏" : item.kind === "prompt" ? "提示词 · 作者私藏" : "我的资产";
    return (
        <Card className="wg-library-card overflow-hidden [content-visibility:auto] [contain-intrinsic-size:260px]" styles={{ body: { padding: 0 } }}>
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
            ) : (
                <div className="grid aspect-[16/9] w-full place-items-center border-b border-dashed border-stone-200 bg-stone-50/60 text-stone-400 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-600">{itemIcon(item)}</div>
            )}
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
                        <span className="mt-1 block text-xs text-stone-400 dark:text-stone-500">{destination}</span>
                    </div>
                    <Tag className="!m-0 shrink-0">{kindLabel(item)}</Tag>
                </div>
                <p className="mt-2 line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-stone-600 dark:text-stone-400">{item.description || "作者私藏内容"}</p>
                <AuthorNote note={item.authorNote || (item.kind === "asset" ? item.note : undefined)} className="mt-3" />
                <div className="mt-3 flex min-h-5 flex-wrap gap-1.5">
                    {item.tags.slice(0, 3).map((tag) => (
                        <Tag key={tag} className="!m-0 text-[11px]">
                            {tag}
                        </Tag>
                    ))}
                </div>
            </div>
            <div className="px-4 pb-4">
                <Button
                    block
                    type={state === "installed" ? "default" : "primary"}
                    disabled={state === "installed"}
                    loading={installing}
                    icon={state === "installed" ? <Sparkles className="size-3.5" /> : <Download className="size-3.5" />}
                    onClick={onInstall}
                >
                    {state === "installed" ? "已保存" : state === "update" ? "更新" : "保存到 WorkflowGenerator"}
                </Button>
            </div>
        </Card>
    );
}

function itemIcon(item: AuthorLibraryItem): ReactNode {
    if (item.kind === "skill") return <WandSparkles className="size-10" strokeWidth={1.4} />;
    if (item.kind === "prompt") return <BookOpenText className="size-10" strokeWidth={1.4} />;
    if (item.assetKind === "image") return <ImageIcon className="size-10" strokeWidth={1.4} />;
    if (item.assetKind === "video") return <Video className="size-10" strokeWidth={1.4} />;
    if (item.assetKind === "audio") return <Music2 className="size-10" strokeWidth={1.4} />;
    return <FileText className="size-10" strokeWidth={1.4} />;
}

function kindLabel(item: AuthorLibraryItem) {
    if (item.kind === "skill") return "Skill";
    if (item.kind === "prompt") return "提示词";
    if (item.assetKind === "image") return "图片";
    if (item.assetKind === "video") return "视频";
    if (item.assetKind === "audio") return "音频";
    return "文本";
}

function destinationMessage(destination: AuthorLibraryInstallResultDestination, title: string) {
    if (destination === "skill") return `「${title}」已保存到 Skills → 作者私藏`;
    if (destination === "prompt") return `「${title}」已保存到提示词 → 作者私藏`;
    return `「${title}」已保存到我的资产`;
}

type AuthorLibraryInstallResultDestination = "skill" | "prompt" | "asset";
