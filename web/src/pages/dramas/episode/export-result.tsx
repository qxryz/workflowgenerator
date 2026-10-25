import { Alert, App } from "antd";
import { Download, Film, Loader2, Square, Subtitles } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { useNow } from "@/hooks/use-now";
import { exportErrorText } from "@/lib/drama/episode-steps";
import { formatClock, formatElapsed } from "@/lib/drama/format";
import type { DramaAspect, DramaExport } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/services/download-file";
import { readStoredMediaBlob } from "@/services/server-storage";

export const isActive = (item: DramaExport) => item.status === "queued" || item.status === "encoding";

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, "_");

type Props = { item?: DramaExport; aspect: DramaAspect; fileName: string; onCancel: (item: DramaExport) => void };

/** The export being looked at: progress while it encodes, the player when it is done, the reason when it is not. */
export function ExportResult({ item, aspect, fileName, onCancel }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const [saving, setSaving] = useState<"video" | "srt" | null>(null);
    const now = useNow(Boolean(item && isActive(item)));
    const ratio = aspect.replace(":", " / ");

    const save = async (kind: "video" | "srt") => {
        if (!item) return;
        setSaving(kind);
        try {
            const blob = kind === "video" ? await (await fetch(item.mediaUrl)).blob() : await readStoredMediaBlob("files", item.srtKey);
            if (!blob) throw new Error(t("字幕文件找不到了"));
            const saved = await downloadFile(blob, `${safeName(fileName)}.${kind === "video" ? "mp4" : "srt"}`);
            message.success(t("已保存：{name}", { name: saved }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("保存失败，请重试"));
        } finally {
            setSaving(null);
        }
    };

    if (!item) {
        return (
            <div className="grid place-items-center rounded-xl border border-dashed border-[color:var(--wg-home-line-strong)] text-[color:var(--wg-home-muted)]" style={{ aspectRatio: ratio, maxHeight: "52vh", width: "100%" }}>
                <div className="flex flex-col items-center gap-2 px-6 text-center text-[13px]">
                    <Film className="size-6" strokeWidth={1.4} />
                    <p>{t("还没有成片。选好右边的选项，点「导出成片」。")}</p>
                </div>
            </div>
        );
    }
    if (isActive(item)) {
        return (
            <div className="grid place-items-center rounded-xl border border-[color:var(--wg-home-line)]" style={{ aspectRatio: ratio, maxHeight: "52vh", width: "100%" }}>
                <div className="flex flex-col items-center gap-3 text-[13px]">
                    <Loader2 className="size-6 animate-spin text-[color:var(--wg-home-accent)]" strokeWidth={1.6} />
                    <p>{t(item.status === "queued" ? "排队中…" : "正在合成成片…")} <span className="tabular-nums text-[color:var(--wg-home-muted)]">{formatElapsed(now - item.createdAt)}</span></p>
                    <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line)]" onClick={() => onCancel(item)}>
                        <Square className="size-3" fill="currentColor" strokeWidth={0} />
                        {t("取消导出")}
                    </button>
                </div>
            </div>
        );
    }
    if (item.status === "failed") return <Alert type="error" showIcon title={t("这次没能导出")} description={t(exportErrorText(item.error))} />;
    if (item.status === "cancelled") return <Alert type="info" showIcon title={t("这次导出已取消")} />;
    return (
        <div className="flex flex-col gap-3">
            <video src={item.mediaUrl} controls className="w-full rounded-xl bg-black" style={{ aspectRatio: ratio, maxHeight: "52vh" }} />
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="wg-primary-button !min-h-9" disabled={saving !== null} onClick={() => void save("video")}>
                    {saving === "video" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" strokeWidth={1.6} />}
                    {t("下载 MP4")}
                </button>
                {item.srtKey ? (
                    <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={saving !== null} onClick={() => void save("srt")}>
                        {saving === "srt" ? <Loader2 className="size-4 animate-spin" /> : <Subtitles className="size-4" strokeWidth={1.6} />}
                        {t("下载字幕")}
                    </button>
                ) : (
                    <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("这一集没有对白，所以没有字幕")}</span>
                )}
                <span className="ml-auto text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{formatClock(item.finishedAt ?? item.createdAt)}</span>
            </div>
        </div>
    );
}

const STATUS: Record<DramaExport["status"], string> = { queued: "排队中", encoding: "合成中", ready: "已完成", failed: "失败", cancelled: "已取消" };

type HistoryProps = { items: DramaExport[]; selectedId?: string; onSelect: (id: string) => void };

/** Earlier exports of this episode, newest first. */
export function ExportHistory({ items, selectedId, onSelect }: HistoryProps) {
    const { t } = useAppTranslation();
    if (items.length < 2) return null;
    return (
        <section>
            <h3 className="mb-2 text-[12px] font-semibold text-[color:var(--wg-home-muted)]">{t("导出记录")}</h3>
            <ul className="divide-y divide-[color:var(--wg-home-line)] rounded-xl border border-[color:var(--wg-home-line)]">
                {items.map((item) => (
                    <li key={item.id}>
                        <button type="button" className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition hover:bg-[color:var(--wg-home-hover)]", item.id === selectedId && "bg-[color:var(--wg-home-hover)]")} onClick={() => onSelect(item.id)}>
                            <span className="tabular-nums">{formatClock(item.createdAt)}</span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--wg-home-muted)]">
                                {[item.options.resolution, item.options.keepOriginalAudio && t("原声"), item.options.includeVoice && t("配音"), item.options.musicKey && t("音乐")].filter(Boolean).join(" · ")}
                            </span>
                            <span className={cn("rounded-full border px-2 text-[11px] leading-5", item.status === "failed" ? "border-destructive/40 text-destructive" : "border-[color:var(--wg-home-line)] text-[color:var(--wg-home-muted)]")}>{t(STATUS[item.status])}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
