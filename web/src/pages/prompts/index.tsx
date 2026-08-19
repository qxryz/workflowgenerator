import { FolderPlus, Search, Trash2 } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { Alert, App, Button, Empty, Spin, Tag } from "antd";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAuthorPromptStore } from "@/stores/use-author-prompt-store";
import { ALL_PROMPTS_OPTION, INSTALLED_AUTHOR_PROMPT_SOURCE_ID, PROMPT_COLLECTION_OPTIONS, type Prompt, type PromptCollectionFilter } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedCollection, setSelectedCollection] = useState<PromptCollectionFilter>("all");
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAuthorPrompt = useAuthorPromptStore((state) => state.remove);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory, collection: selectedCollection });
    const hasDetailFilters = Boolean(titleKeyword.trim()) || selectedTags.length > 0 || selectedCategory !== ALL_PROMPTS_OPTION;
    const hasActiveFilters = Boolean(titleKeyword.trim()) || selectedTags.length > 0 || selectedCategory !== ALL_PROMPTS_OPTION || selectedCollection !== "all";
    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("获取提示词失败"));
    }, [message, query.error, query.isError, t]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const clearFilters = () => {
        setTitleKeyword("");
        setSelectedTags([]);
        setSelectedCategory(ALL_PROMPTS_OPTION);
        setSelectedCollection("all");
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({
            kind: "text",
            title: item.title,
            coverUrl: item.coverUrl,
            tags: item.tags,
            source: item.category,
            note: item.authorNote,
            data: { content: item.prompt },
            metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl, ...(item.authorNote ? { authorNote: item.authorNote } : {}) },
        });
        message.success(t("已加入我的资产"));
    };

    const removeInstalledAuthorPrompt = (item: Prompt) => {
        removeAuthorPrompt(item.id);
        if (selectedPrompt?.id === item.id) setSelectedPrompt(null);
        message.success(`「${item.title}」已从作者私藏移除`);
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="wg-library-page wg-paper-surface flex h-full flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title shrink-0 text-[21px] font-semibold">{t("提示词中心")}</h1>
                        <p className="wg-library-meta mt-0.5">PROMPTS / {query.isLoading ? "--" : String(totalPrompts).padStart(2, "0")}</p>
                    </div>
                    <label className="wg-library-search w-full md:ml-auto md:max-w-md">
                        <Search className="size-4 shrink-0" />
                        <input value={titleKeyword} onChange={(event) => setTitleKeyword(event.target.value)} placeholder={t("搜索标题、内容或标签")} aria-label={t("搜索提示词")} />
                    </label>
                </div>
            </header>

            <main className="wg-library-content min-h-0 flex-1 overflow-y-auto" onScroll={handleListScroll}>
                <div className="mx-auto grid max-w-7xl items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
                    <aside className="wg-library-filter-rail thin-scrollbar max-h-56 overflow-y-auto border-b pb-4 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-10rem)] lg:max-h-[calc(100dvh-10rem)] lg:border-b-0 lg:border-r lg:pb-6 lg:pr-4">
                        <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">{t("筛选")}</h2>
                            {hasActiveFilters ? (
                                <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={clearFilters}>
                                    {t("清除筛选")}
                                </Button>
                            ) : null}
                        </div>
                        <div>
                            <PromptCollectionFilter
                                selected={selectedCollection}
                                onChange={(value) => {
                                    setSelectedCollection(value);
                                    setSelectedCategory(ALL_PROMPTS_OPTION);
                                }}
                            />
                            <div className="mt-6">
                                <PromptFilter label={t("分类")} options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                            </div>
                            <div className="mt-6">
                                <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{t("标签")}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {promptTags.map((tag) => {
                                        const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                        return (
                                            <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>
                                                {tag}
                                            </Tag.CheckableTag>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </aside>

                    <section className="min-w-0" aria-label={t("提示词列表")}>
                        {query.isError ? (
                            <Alert
                                showIcon
                                type="error"
                                message={t("提示词加载失败")}
                                description={query.error instanceof Error ? query.error.message : t("请稍后重试")}
                                action={
                                    <Button size="small" onClick={() => void query.refetch()}>
                                        {t("重新加载")}
                                    </Button>
                                }
                                className="mb-4"
                            />
                        ) : null}
                        {query.isLoading ? (
                            <div className="flex h-56 items-center justify-center" role="status" aria-label={t("正在加载提示词")}>
                                <Spin />
                            </div>
                        ) : null}
                        {!query.isLoading && (!query.isError || promptItems.length > 0) ? (
                            <PromptGrid
                                items={promptItems}
                                onOpen={setSelectedPrompt}
                                renderActions={(item) => (
                                    <>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                            {t("加入资产")}
                                        </Button>
                                        {item.sourceId === INSTALLED_AUTHOR_PROMPT_SOURCE_ID ? (
                                            <Button danger type="text" size="small" aria-label={`移除 ${item.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => removeInstalledAuthorPrompt(item)} />
                                        ) : null}
                                    </>
                                )}
                                onCopy={(item) => copyText(item.prompt, t("提示词已复制"))}
                                emptyDescription={t(selectedCollection === "author" && !hasDetailFilters ? "暂时没有作者私藏" : hasActiveFilters ? "没有符合当前条件的提示词" : "暂时没有可用的提示词")}
                                emptyAction={
                                    hasActiveFilters ? (
                                        <Button size="small" onClick={clearFilters}>
                                            {t("清除筛选")}
                                        </Button>
                                    ) : (
                                        <Button size="small" onClick={() => void query.refetch()}>
                                            {t("重新加载")}
                                        </Button>
                                    )
                                }
                            />
                        ) : null}
                        <div className="mt-5 text-center text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
                            {query.isFetchingNextPage ? t("正在加载更多...") : query.hasNextPage ? t("继续向下滚动加载更多") : promptItems.length > 0 ? t("已经到底了") : null}
                        </div>
                    </section>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("提示词已复制"))} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function PromptCollectionFilter({ selected, onChange }: { selected: PromptCollectionFilter; onChange: (value: PromptCollectionFilter) => void }) {
    const { t } = useAppTranslation();
    return (
        <div>
            <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{t("来源")}</div>
            <div className="flex flex-wrap gap-1.5">
                {PROMPT_COLLECTION_OPTIONS.map((option) => (
                    <Tag.CheckableTag key={option.value} checked={selected === option.value} className={cn("prompt-filter-tag", selected === option.value && "is-active")} onChange={() => onChange(option.value)}>
                        {t(option.label)}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    const { t } = useAppTranslation();
    return (
        <div>
            <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag", selected === option && "is-active")} onChange={() => onChange(option)}>
                        {t(option)}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function PromptGrid({
    items,
    onOpen,
    onCopy,
    renderActions,
    emptyDescription,
    emptyAction,
}: {
    items: Prompt[];
    onOpen: (item: Prompt) => void;
    onCopy: (item: Prompt) => void;
    renderActions: (item: Prompt) => ReactNode;
    emptyDescription: ReactNode;
    emptyAction?: ReactNode;
}) {
    return (
        <div>
            <div className="wg-library-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                    <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />
                ))}
            </div>
            {items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} className="py-14">
                    {emptyAction}
                </Empty>
            ) : null}
        </div>
    );
}
