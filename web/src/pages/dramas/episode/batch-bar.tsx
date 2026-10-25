import { App, Checkbox } from "antd";
import { Check, Layers, Loader2, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { planImageBatch, planVideoBatch } from "@/lib/drama/episode-steps";
import { capabilityOf } from "@/lib/drama/media/model-options";
import { isAiConfigReady, modelOptionName, resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useEpisodeBatches } from "@/stores/use-episode-batches";
import { batchKey, runEpisodeBatch, type BatchRequest } from "./batch";
import type { EpisodeCtx } from "./context";

type Props = { ctx: EpisodeCtx; kind: BatchRequest["kind"] };

/** 生成全部缺失画面 / 视频 above the strip, with progress and stop while it runs. */
export function BatchBar({ ctx, kind }: Props) {
    const { t, language } = useAppTranslation();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const batch = useEpisodeBatches((state) => state.batches[batchKey(ctx.episode.id, kind)]);
    const [autoAdopt, setAutoAdopt] = useState(true);

    const capability = capabilityOf(kind);
    const models = selectableModelsByCapability(config, capability);
    const preferred = resolveModelForCapability(config, undefined, capability);
    const model = preferred && models.includes(preferred) ? preferred : (models[0] ?? "");

    const images = useMemo(() => planImageBatch(ctx.shots, ctx.artifacts), [ctx.shots, ctx.artifacts]);
    const videos = useMemo(() => planVideoBatch(ctx.shots, ctx.artifacts, autoAdopt), [ctx.shots, ctx.artifacts, autoAdopt]);
    const first = kind === "image" && images.mode === "first";
    const shotIds = kind === "image" ? images.shotIds : videos.shotIds;

    if (batch) return <Progress total={batch.total} done={batch.done} failed={batch.failed} stopping={batch.stopping} onStop={batch.abort} />;

    const start = (adopt: boolean, concurrency: number) => {
        void runEpisodeBatch({ ctx, kind, shotIds, model, config, language, autoAdopt: adopt, concurrency, title: (n) => t("第 {count} 镜 · {kind}", { count: n, kind: t(kind === "image" ? "分镜图" : "视频") }) }).then((outcome) => {
            if (outcome.stopped) message.info(t("已停止，已经开始的镜头会继续完成"));
            else if (outcome.failed || outcome.skipped) message.warning(outcome.note ? t(outcome.note) : t("有 {count} 个镜头没有生成成功，选中镜头可以看到原因", { count: outcome.failed }));
            else message.success(t("已生成 {count} 个", { count: outcome.made }));
        });
    };

    const click = () => {
        if (!model) return useConfigStore.getState().openConfigDialog(false, "channels");
        if (!isAiConfigReady(config, model)) {
            message.error(t("这个模型还没有填写密钥"));
            return useConfigStore.getState().openConfigDialog(false, "channels");
        }
        if (kind === "image") return start(!first && autoAdopt, 2);
        modal.confirm({
            title: t("将生成 {count} 段视频，共 {seconds} 秒", { count: videos.shotIds.length, seconds: videos.seconds }),
            content: (
                <div className="space-y-1 text-[13px] text-[color:var(--wg-home-muted)]">
                    <p>{t("使用 {model}，视频生成会产生费用。", { model: modelOptionName(model) })}</p>
                    <p>{t("连续镜头默认用上一镜的结尾画面作首帧，其余镜头用本镜画面。")}</p>
                    {videos.skipped ? <p>{t("另有 {count} 镜还没有采用画面，会先跳过。", { count: videos.skipped })}</p> : null}
                    {videos.waiting ? <p>{t("另有 {count} 镜要接着上一镜的结尾，上一镜采用视频后才能生成；打开「完成后自动采用」可以一镜接一镜生成。", { count: videos.waiting })}</p> : null}
                    {videos.chained ? <p>{t("这些连续镜头会按顺序一镜一镜生成。")}</p> : null}
                </div>
            ),
            okText: t("开始生成"),
            cancelText: t("取消"),
            onOk: () => start(autoAdopt, videos.chained ? 1 : 2),
        });
    };

    const word = kind === "image" ? "画面" : "视频";
    const finished = !shotIds.length && !(kind === "image" && first);
    return (
        <div className="flex h-12 shrink-0 items-center gap-3 px-6">
            {finished ? (
                <span className="flex items-center gap-1.5 text-[13px] text-[color:var(--wg-home-muted)]">
                    <Check className="size-4" strokeWidth={1.6} />
                    {kind === "video" && videos.skipped ? t("还有 {count} 镜需要先采用画面", { count: videos.skipped }) : kind === "video" && videos.waiting ? t("还有 {count} 镜要等上一镜采用视频", { count: videos.waiting }) : t(kind === "image" ? "所有镜头都已采用画面" : "所有镜头都已采用视频")}
                </span>
            ) : (
                <>
                    <button type="button" className="wg-primary-button !min-h-9 !rounded-lg" disabled={!shotIds.length} onClick={click}>
                        <Layers className="size-4" strokeWidth={1.6} />
                        {first ? t("先生成第 1 镜") : t("生成全部缺失{kind}", { kind: t(word) })}
                    </button>
                    <span className="text-[12px] text-[color:var(--wg-home-muted)]">
                        {first ? t("先定下画风，再批量生成其余镜头") : t("还差 {count} 镜", { count: shotIds.length })}
                    </span>
                </>
            )}
            {!first && model && (!finished || (kind === "video" && videos.waiting > 0)) ? (
                <Checkbox className="ml-auto" checked={autoAdopt} onChange={(event) => setAutoAdopt(event.target.checked)}>
                    <span className="text-[12px]">{t("完成后自动采用")}</span>
                </Checkbox>
            ) : null}
        </div>
    );
}

function Progress({ total, done, failed, stopping, onStop }: { total: number; done: number; failed: number; stopping: boolean; onStop: () => void }) {
    const { t } = useAppTranslation();
    return (
        <div className="flex h-12 shrink-0 items-center gap-3 px-6">
            <Loader2 className="size-4 animate-spin text-[color:var(--wg-home-accent)]" strokeWidth={1.8} />
            <span className="text-[13px] tabular-nums">{stopping ? t("正在停止…") : t("生成中 {done}/{total}", { done, total })}</span>
            <div className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-[color:var(--wg-home-ghost)]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <div className="h-full rounded-full bg-[color:var(--wg-home-accent)] transition-[width]" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
            </div>
            {failed ? <span className="text-[12px] text-destructive">{t("{count} 个没成功", { count: failed })}</span> : null}
            <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line)]" disabled={stopping} onClick={onStop}>
                <Square className="size-3" fill="currentColor" strokeWidth={0} />
                {t("停止")}
            </button>
        </div>
    );
}
