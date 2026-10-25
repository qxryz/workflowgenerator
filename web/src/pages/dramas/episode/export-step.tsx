import { Alert, App } from "antd";
import { Clapperboard, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { adoptedByShot, exportErrorText, shotsMissingVideo } from "@/lib/drama/episode-steps";
import type { DramaExport, ExportOptions } from "@/lib/drama/types";
import { publishUploadedMedia, uploadMediaFile } from "@/services/file-storage";
import { cancelExport, createExport, getExport } from "@/services/drama-api";
import type { EpisodeCtx } from "./context";
import { ExportChecklist } from "./export-checklist";
import { ExportOptionsForm, type Music } from "./export-options";
import { ExportHistory, ExportResult, isActive } from "./export-result";

const POLL_MS = 1500;

/** Polls the export that is encoding until it settles; `live` is the freshest copy this tab has seen. */
function useLiveExport(ctx: EpisodeCtx) {
    const [live, setLive] = useState<DramaExport>();
    const items = useMemo(() => [...ctx.exports].sort((a, b) => b.createdAt - a.createdAt), [ctx.exports]);
    const merged = live ? [live, ...items.filter((item) => item.id !== live.id)].sort((a, b) => b.createdAt - a.createdAt) : items;
    // The snapshot may lag behind `live`: prefer whichever copy has settled.
    const list = merged.map((item) => (live && item.id === live.id && !isActive(live) ? live : item));
    const active = list.find(isActive);
    const activeId = active?.id;
    const { refresh } = ctx;

    useEffect(() => {
        if (!activeId) return;
        const timer = window.setInterval(() => {
            getExport(activeId).then((next) => {
                setLive(next);
                if (!isActive(next)) refresh();
            }, () => undefined);
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [activeId, refresh]);
    return { list, active, setLive };
}

export function ExportStep({ ctx }: { ctx: EpisodeCtx }) {
    const { t, language } = useAppTranslation();
    const { message } = App.useApp();
    const { episode, shots, artifacts, snapshot } = ctx;
    const { list, active, setLive } = useLiveExport(ctx);
    const voices = adoptedByShot(artifacts, "audio").size;
    const [options, setOptions] = useState<ExportOptions>({ resolution: "1080p", keepOriginalAudio: true, includeVoice: voices > 0, musicVolume: 0.3 });
    const [music, setMusic] = useState<Music>();
    const [uploading, setUploading] = useState(false);
    const [starting, setStarting] = useState(false);
    const [problem, setProblem] = useState("");
    const [viewId, setViewId] = useState<string>();

    const missing = shotsMissingVideo(shots, artifacts);
    const shown = list.find((item) => item.id === viewId) ?? list[0];
    const blocked = !shots.length ? t("这一集还没有镜头") : missing.length ? t("还有 {count} 镜没有采用视频", { count: missing.length }) : "";

    const pickMusic = async (file: File | null) => {
        if (!file) return setMusic(undefined);
        if (!file.type.startsWith("audio/")) return void message.error(t("请选择音频文件"));
        setUploading(true);
        try {
            const uploaded = await uploadMediaFile(file, "audio");
            publishUploadedMedia(uploaded);
            setMusic({ key: uploaded.storageKey, name: file.name, url: uploaded.url });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("上传失败，请重试"));
        } finally {
            setUploading(false);
        }
    };

    const start = async () => {
        setStarting(true);
        setProblem("");
        try {
            const created = await createExport(episode.id, { ...options, ...(music ? { musicKey: music.key } : { musicKey: undefined, musicVolume: undefined }) });
            setLive(created);
            setViewId(created.id);
            ctx.refresh();
        } catch (error) {
            setProblem(exportErrorText(error instanceof Error ? error.message : ""));
        } finally {
            setStarting(false);
        }
    };

    const cancel = async (item: DramaExport) => {
        try {
            setLive(await cancelExport(item.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("取消失败，请重试"));
        }
        ctx.refresh();
    };

    return (
        <div className="flex h-full min-h-0">
            <div className="thin-scrollbar min-w-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
                    {problem ? <Alert type="error" showIcon closable={{ onClose: () => setProblem("") }} title={t("没能开始导出")} description={t(problem)} /> : null}
                    <ExportResult item={shown} aspect={snapshot.project.aspect} fileName={`${snapshot.project.title}-${language === "en-US" ? "episode" : "第"}${episode.ord}${language === "en-US" ? "" : "集"}`} onCancel={(item) => void cancel(item)} />
                    <ExportHistory items={list} selectedId={shown?.id} onSelect={setViewId} />
                </div>
            </div>
            <aside className="flex w-[420px] shrink-0 flex-col border-l border-[color:var(--wg-home-line)]">
                <ExportChecklist ctx={ctx} />
                <div className="shrink-0 border-t border-[color:var(--wg-home-line)]">
                    <ExportOptionsForm options={options} onChange={setOptions} voices={voices} music={music} uploading={uploading} onMusic={(file) => void pickMusic(file)} />
                    <div className="px-4 pb-4 pt-2">
                        <button type="button" className="wg-primary-button w-full" disabled={Boolean(blocked) || Boolean(active) || starting || uploading} onClick={() => void start()}>
                            {starting || active ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" strokeWidth={1.6} />}
                            {t(active ? "正在合成…" : "导出成片")}
                        </button>
                        {blocked ? <p className="mt-2 text-center text-[12px] text-[color:var(--wg-home-muted)]">{blocked}</p> : null}
                    </div>
                </div>
            </aside>
        </div>
    );
}
