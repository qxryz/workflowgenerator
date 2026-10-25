/**
 * ProjectCard — one drama in the library grid.
 *
 * Props: `ProjectCard({ item }: { item: DramaSummary })`. Click opens the drama; the "..." menu renames,
 * replaces the cover (random line drawing / uploaded image) or deletes (with confirmation).
 */
import { useQueryClient } from "@tanstack/react-query";
import { App, Dropdown, type MenuProps } from "antd";
import { ImagePlus, MoreHorizontal, Pencil, Shuffle, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CoverArt, randomCover } from "@/components/drama/cover-art";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaListKey } from "@/hooks/use-drama";
import { relativeTime } from "@/lib/drama/format";
import { SOURCE_TYPE_LABELS } from "@/lib/drama/labels";
import type { DramaCover, DramaSummary } from "@/lib/drama/types";
import { deleteDrama, getDrama, updateDrama } from "@/services/drama-api";
import { uploadImage } from "@/services/image-storage";


/** Stable pseudo-random cover for dramas created without one. */
const fallbackCover = (id: string) => {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return { variant: Math.abs(hash) % 5, seed: Math.abs(hash) };
};

export function ProjectCard({ item }: { item: DramaSummary }) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const client = useQueryClient();
    const upload = useRef<HTMLInputElement>(null);
    const [renaming, setRenaming] = useState(false);
    const [title, setTitle] = useState(item.title);

    const patch = async (change: { title?: string; cover?: DramaCover }) => {
        try {
            const { project } = await getDrama(item.id);
            await updateDrama(item.id, { rev: project.rev, ...change });
            await client.invalidateQueries({ queryKey: dramaListKey });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("保存失败，请重试"));
        }
    };
    const saveTitle = () => {
        setRenaming(false);
        const next = title.trim();
        if (next && next !== item.title) void patch({ title: next });
        else setTitle(item.title);
    };
    const pickFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const saved = await uploadImage(file);
            await patch({ cover: { mediaKey: saved.storageKey, mediaUrl: saved.url } });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("图片上传失败"));
        }
    };
    const confirmDelete = () =>
        modal.confirm({
            title: t("删除「{title}」？", { title: item.title }),
            content: t("章节、设定、分集和已生成的画面都会一起删除，无法恢复。"),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteDrama(item.id);
                    await client.invalidateQueries({ queryKey: dramaListKey });
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("删除失败，请重试"));
                }
            },
        });

    const menu: MenuProps = {
        items: [
            { key: "rename", icon: <Pencil className="size-4" strokeWidth={1.6} />, label: t("重命名") },
            {
                key: "cover",
                icon: <ImagePlus className="size-4" strokeWidth={1.6} />,
                label: t("更换封面"),
                children: [
                    { key: "random", icon: <Shuffle className="size-4" strokeWidth={1.6} />, label: t("随机线稿") },
                    { key: "upload", icon: <Upload className="size-4" strokeWidth={1.6} />, label: t("上传图片") },
                ],
            },
            { type: "divider" },
            { key: "delete", icon: <Trash2 className="size-4" strokeWidth={1.6} />, label: t("删除"), danger: true },
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "rename") setRenaming(true);
            if (key === "random") void patch({ cover: randomCover() });
            if (key === "upload") upload.current?.click();
            if (key === "delete") confirmDelete();
        },
    };
    const cover = item.cover ?? fallbackCover(item.id);

    return (
        <article className="group relative min-w-0 cursor-pointer rounded-xl p-1.5 transition-colors duration-150 hover:bg-[color:var(--wg-home-hover)]" onClick={(event) => event.currentTarget.contains(event.target as Node) && !renaming && navigate(`/dramas/${item.id}`)}>
            <div className="relative aspect-[16/10] overflow-hidden rounded-[10px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] text-[color:var(--wg-home-text)] transition-colors group-hover:border-[color:var(--wg-home-line-strong)]">
                {"mediaUrl" in cover ? <img src={cover.mediaUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} /> : <CoverArt variant={cover.variant} seed={cover.seed} />}
                <Dropdown trigger={["click"]} menu={menu} placement="bottomRight">
                    <button type="button" className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-[7px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-floating)] text-[color:var(--wg-home-muted)] opacity-0 shadow-sm backdrop-blur-xl transition hover:text-[color:var(--wg-home-text)] focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100" aria-label={t("剧目操作")} onClick={(event) => event.stopPropagation()}>
                        <MoreHorizontal className="size-4" strokeWidth={1.8} />
                    </button>
                </Dropdown>
            </div>
            <div className="px-1.5 pb-1 pt-2.5">
                {renaming ? (
                    <input
                        value={title}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") saveTitle();
                            if (event.key === "Escape") {
                                setTitle(item.title);
                                setRenaming(false);
                            }
                        }}
                        className="h-8 w-full rounded-[7px] border border-[color:var(--wg-home-accent)] bg-[color:var(--wg-panel)] px-2 text-[13px] font-semibold outline-none"
                    />
                ) : (
                    <h2 className="truncate text-[13px] font-semibold">{item.title}</h2>
                )}
                <p className="mt-1 truncate text-[11px] text-[color:var(--wg-home-muted)]">
                    {t(SOURCE_TYPE_LABELS[item.sourceType])} · {item.aspect} · {t("{chapters} 章 · {episodes} 集", { chapters: item.counts.chapters, episodes: item.counts.episodes })}
                </p>
                <p className="mt-0.5 text-[11px] text-[color:var(--wg-home-muted-strong)]">{t("更新于 {time}", { time: relativeTime(item.updatedAt, Date.now(), t) })}</p>
            </div>
            <input
                ref={upload}
                type="file"
                accept="image/*"
                className="hidden"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                    void pickFile(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </article>
    );
}
