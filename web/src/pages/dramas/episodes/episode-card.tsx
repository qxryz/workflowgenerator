import { App, Dropdown } from "antd";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, useDramaMutation } from "@/hooks/use-drama";
import { episodeProgress, episodeSourceOrds, formatChapterRefs, formatSeconds } from "@/lib/drama/story";
import type { DramaEpisode, DramaSnapshot } from "@/lib/drama/types";
import { deleteEpisode } from "@/services/drama-api";

type Props = { snapshot: DramaSnapshot; episode: DramaEpisode; onEdit: () => void };

/** A fixed-size card; the title is the link into the episode, the rest of the card follows it. */
export function EpisodeCard({ snapshot, episode, onEdit }: Props) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const dramaId = snapshot.project.id;
    const remove = useDramaMutation(() => deleteEpisode(episode.id), [dramaKey(dramaId)]);
    const progress = episodeProgress(episode.progress);
    const sources = formatChapterRefs(episodeSourceOrds(episode, snapshot.chapters), t);
    const confirmDelete = () =>
        modal.confirm({
            title: t("删除第 {ord} 集「{title}」？", { ord: episode.ord, title: episode.title }),
            content: t("这一集的剧本、镜头，以及已生成的画面和视频也会一起删除，无法恢复。"),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: () => remove.mutateAsync(undefined).then(() => undefined, (error) => void message.error(error instanceof Error ? error.message : t("删除失败，请重试"))),
        });

    return (
        <article className="group relative flex min-h-[188px] flex-col rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-4 transition-colors hover:border-[color:var(--wg-home-line-strong)] hover:bg-[color:var(--wg-home-hover)]">
            <div className="flex items-center justify-between">
                <span className="text-[11px] tabular-nums text-[color:var(--wg-home-muted)]">{t("第 {ord} 集", { ord: episode.ord })}</span>
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        items: [
                            { key: "edit", icon: <Pencil className="size-4" strokeWidth={1.6} />, label: t("编辑"), onClick: onEdit },
                            { key: "delete", icon: <Trash2 className="size-4" strokeWidth={1.6} />, label: t("删除"), danger: true, onClick: confirmDelete },
                        ],
                    }}
                >
                    <button type="button" className="wg-icon-button relative z-10 !size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100" aria-label={t("分集操作")}>
                        <MoreHorizontal strokeWidth={1.6} />
                    </button>
                </Dropdown>
            </div>
            <h3 className="mt-1 truncate text-[14px] font-semibold">
                <Link to={`/dramas/${dramaId}/episodes/${episode.id}`} className="!text-[color:var(--wg-home-text)] after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[color:var(--wg-home-accent)]">
                    {episode.title}
                </Link>
            </h3>
            <p className="mb-0 mt-1.5 line-clamp-2 min-h-10 text-[12.5px] leading-5 text-[color:var(--wg-home-muted)]">{episode.outline || t("还没有梗概")}</p>
            <p className="mb-0 mt-3 truncate text-[11px] text-[color:var(--wg-home-muted)]">{[sources, formatSeconds(episode.targetSeconds, t)].filter(Boolean).join(" · ")}</p>
            <div className="mt-auto pt-3">
                {progress.shots ? (
                    <>
                        <div className="relative h-1 overflow-hidden rounded-full bg-[color:var(--wg-home-line)]" role="img" aria-label={t("画面 {images}/{shots}，视频 {videos}/{shots}", progress)}>
                            <span className="absolute inset-y-0 left-0 bg-[color:var(--wg-home-muted-strong)]" style={{ width: `${progress.imageShare * 100}%` }} />
                            <span className="absolute inset-y-0 left-0 bg-[color:var(--wg-home-text)]" style={{ width: `${progress.videoShare * 100}%` }} />
                        </div>
                        <p className="mb-0 mt-1.5 text-[11px] tabular-nums text-[color:var(--wg-home-muted)]">{t("镜头 {shots} · 画面 {images}/{shots} · 视频 {videos}/{shots}", progress)}</p>
                    </>
                ) : (
                    <p className="mb-0 text-[11px] text-[color:var(--wg-home-muted-strong)]">{t("还没有分镜")}</p>
                )}
            </div>
        </article>
    );
}
