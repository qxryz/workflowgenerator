import { Button, Tag } from "antd";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";

import { ALL, type SkillFilters } from "./skill-catalog";

export type FilterChip = { value: string; label: string; count?: number };

type RailProps = {
    /** 「来源」视图选项；社区与来源未知归在官方目录下，见 skill-catalog.ts 的 catalogSource。 */
    options: string[];
    viewLabel: string;
    viewCounts: Record<string, number>;
    onViewChange: (label: string) => void;
    categories: FilterChip[];
    category: string;
    onCategoryChange: (value: string) => void;
    authors: FilterChip[];
    tags: FilterChip[];
    filters: SkillFilters;
    onFiltersChange: (patch: Partial<SkillFilters>) => void;
    extraFilterCount: number;
    canClear: boolean;
    onClear: () => void;
};

/** 左栏只默认展开「来源」与「分类」，其余筛选收进「更多筛选」。 */
export function SkillFilterRail({ options, viewLabel, viewCounts, onViewChange, categories, category, onCategoryChange, authors, tags, filters, onFiltersChange, extraFilterCount, canClear, onClear }: RailProps) {
    const { t } = useAppTranslation();
    const [moreOpen, setMoreOpen] = useState(false);
    const statusOptions: FilterChip[] = [
        { value: "installed", label: "已安装" },
        { value: "enabled", label: "已启用" },
        { value: "disabled", label: "未启用" },
    ];
    const contentOptions: FilterChip[] = [
        { value: "single", label: "单文件" },
        { value: "references", label: "含参考文档" },
        { value: "scripts", label: "含脚本" },
        { value: "tests", label: "含测试" },
    ];
    const metadataOptions: FilterChip[] = [
        { value: "complete", label: "元数据完整" },
        { value: "incomplete", label: "元数据不全" },
    ];
    return (
        <aside className="wg-library-filter-rail thin-scrollbar max-h-56 overflow-y-auto border-b pb-4 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-10rem)] lg:max-h-[calc(100dvh-10rem)] lg:border-b-0 lg:border-r lg:pb-6 lg:pr-4">
            <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">{t("筛选")}</h2>
                {canClear ? (
                    <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={onClear}>
                        {t("清除筛选")}
                    </Button>
                ) : null}
            </div>
            <FilterChips label="来源" options={options.map((option) => ({ value: option, label: option, count: viewCounts[option] }))} selected={viewLabel} onChange={onViewChange} />
            <div className="mt-6">
                <FilterChips label="分类" options={categories} selected={category} onChange={onCategoryChange} />
            </div>
            <div className="mt-6">
                <Button size="small" type={moreOpen ? "default" : "text"} className="!h-auto !px-1.5 text-xs" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setMoreOpen((open) => !open)}>
                    {t("更多筛选")}
                    {extraFilterCount ? <span className="text-[color:var(--wg-home-muted)]">（{extraFilterCount}）</span> : null}
                </Button>
                {moreOpen ? (
                    <div className="mt-4 grid gap-5">
                        <FilterChips label="作者" options={[{ value: ALL, label: ALL }, ...authors]} selected={filters.author} onChange={(value) => onFiltersChange({ author: value })} />
                        {tags.length ? <FilterChips label="标签" options={[{ value: ALL, label: ALL }, ...tags]} selected={filters.tag} onChange={(value) => onFiltersChange({ tag: value })} /> : null}
                        <FilterChips label="启用状态" options={[{ value: "all", label: ALL }, ...statusOptions]} selected={filters.status} onChange={(value) => onFiltersChange({ status: value as SkillFilters["status"] })} />
                        <FilterChips label="内容形态" options={[{ value: "all", label: ALL }, ...contentOptions]} selected={filters.content} onChange={(value) => onFiltersChange({ content: value as SkillFilters["content"] })} />
                        <FilterChips label="元数据" options={[{ value: "all", label: ALL }, ...metadataOptions]} selected={filters.metadata} onChange={(value) => onFiltersChange({ metadata: value as SkillFilters["metadata"] })} />
                    </div>
                ) : null}
            </div>
        </aside>
    );
}

function FilterChips({ label, options, selected, onChange }: { label: string; options: FilterChip[]; selected: string; onChange: (value: string) => void }) {
    const { t } = useAppTranslation();
    return (
        <div>
            <div className="mb-2 text-xs font-medium text-stone-500">{t(label)}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option.value} checked={selected === option.value} className={cn("prompt-filter-tag", selected === option.value && "is-active")} onChange={() => onChange(option.value)}>
                        {t(option.label)}
                        {typeof option.count === "number" ? <span className="ml-1 opacity-60">{option.count}</span> : null}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}
