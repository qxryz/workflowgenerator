import { useState, type ReactNode } from "react";
import { Button, Checkbox } from "antd";
import { CheckSquare, ImagePlus, Plus, Trash2 } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";

export type MediaWorkbenchHistoryItem = {
    id: string;
    title: string;
    model: string;
    details: string[];
    time: string;
    badge: string;
    badgeTone?: "default" | "failed" | "pending";
    preview?: { kind: "image" | "video"; src: string };
    icon?: ReactNode;
    selectionDisabled?: boolean;
};

type MediaWorkbenchHistoryProps = {
    countLabel: string;
    items: MediaWorkbenchHistoryItem[];
    activeId?: string;
    selectedIds: string[];
    onSelectedIdsChange: (ids: string[]) => void;
    onCreate: () => void;
    onDeleteSelected: () => void;
    onOpen: (id: string) => void;
    children?: ReactNode;
};

export function MediaWorkbenchHistory({ countLabel, items, activeId, selectedIds, onSelectedIdsChange, onCreate, onDeleteSelected, onOpen, children }: MediaWorkbenchHistoryProps) {
    const { t } = useAppTranslation();
    const selectableIds = items.filter((item) => !item.selectionDisabled).map((item) => item.id);
    const selectedCount = selectedIds.length;
    const allSelected = Boolean(selectableIds.length) && selectableIds.every((id) => selectedIds.includes(id));
    const [managing, setManaging] = useState(false);

    const toggleManaging = () => {
        if (managing) onSelectedIdsChange([]);
        setManaging((value) => !value);
    };

    const toggleAll = () => onSelectedIdsChange(allSelected ? [] : selectableIds);

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-[15px] font-semibold">{t("生成记录")}</h2>
                    <p className="mt-0.5 text-[10px] text-[color:var(--wg-studio-muted)]">{countLabel}</p>
                </div>
                <Button type="text" size="small" icon={<CheckSquare className="size-3.5" />} onClick={toggleManaging} aria-pressed={managing}>
                    {t(managing ? "完成" : "多选")}
                </Button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreate}>
                    {t("新创作")}
                </Button>
                {managing ? (
                    <>
                        <Button size="small" disabled={!selectableIds.length} onClick={toggleAll}>
                            {t(allSelected ? "取消全选" : "全选")}
                        </Button>
                        <span className="self-center text-[11px] text-[color:var(--wg-studio-muted)]">{t("已选 {count} 条", { count: selectedCount })}</span>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedCount} onClick={onDeleteSelected}>
                            {t("删除（{count}）", { count: selectedCount })}
                        </Button>
                    </>
                ) : null}
            </div>

            <div className="space-y-2.5">
                {items.map((item) => (
                    <div key={item.id} className={cn("wg-media-history-card", activeId === item.id && "is-active")}>
                        {managing ? (
                            <Checkbox
                                className="absolute right-2 top-2 z-10"
                                checked={selectedIds.includes(item.id)}
                                disabled={item.selectionDisabled}
                                aria-label={t("选择记录：{title}", { title: item.title })}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onSelectedIdsChange(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id))}
                            />
                        ) : null}
                        <button type="button" className="block w-full text-left focus-visible:outline-none" onClick={() => onOpen(item.id)}>
                            <div className="flex gap-2.5">
                                <div className="wg-media-history-thumb">
                                    {item.preview?.kind === "image" ? <img src={item.preview.src} alt="" /> : null}
                                    {item.preview?.kind === "video" ? <video src={item.preview.src} muted preload="metadata" /> : null}
                                    {!item.preview ? item.icon || <ImagePlus className="size-5" /> : null}
                                    <span className={cn(item.badgeTone === "failed" && "is-failed", item.badgeTone === "pending" && "is-pending")}>{item.badge}</span>
                                </div>
                                <div className="min-w-0 flex-1 py-0.5">
                                    <div className="truncate pr-5 text-[12px] font-semibold">{item.title}</div>
                                    <div className="mt-1 truncate text-[10px] text-[color:var(--wg-studio-muted)]">{item.model}</div>
                                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[color:var(--wg-studio-muted)]">
                                        {item.details.map((detail) => (
                                            <span key={detail}>{detail}</span>
                                        ))}
                                    </div>
                                    <div className="mt-1.5 truncate text-[9px] text-[color:var(--wg-studio-muted)] opacity-75">{item.time}</div>
                                </div>
                            </div>
                        </button>
                    </div>
                ))}
                {!items.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("暂无生成记录")}</div> : null}
            </div>
            {children}
        </>
    );
}
