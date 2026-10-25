import { Check, Loader2, Maximize2, Trash2 } from "lucide-react";

import { StatusTag } from "@/components/drama/status-tag";
import { useAppTranslation } from "@/hooks/use-app-translation";
import type { ArtifactKind, DramaArtifact } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { modelOptionName } from "@/stores/use-config-store";

type Props = {
    artifacts: DramaArtifact[];
    kind: ArtifactKind;
    /** CSS aspect-ratio of the drama, e.g. "16 / 9"; used for placeholders. */
    ratio: string;
    isStale: (artifact: DramaArtifact) => boolean;
    onAdopt: (artifact: DramaArtifact) => void;
    onDelete: (artifact: DramaArtifact) => void;
    onPreview: (artifact: DramaArtifact) => void;
};

/** Candidates of one owner+kind, newest first. */
export function CandidateGrid({ artifacts, kind, ratio, isStale, onAdopt, onDelete, onPreview }: Props) {
    const { t } = useAppTranslation();
    if (!artifacts.length) return <p className="py-6 text-center text-xs text-[color:var(--wg-home-muted)]">{t("还没有候选")}</p>;
    return (
        <div className={cn("grid gap-2", kind === "audio" ? "grid-cols-1" : "grid-cols-2")}>
            {artifacts.map((artifact) => (
                <Candidate key={artifact.id} artifact={artifact} kind={kind} ratio={ratio} stale={isStale(artifact)} onAdopt={onAdopt} onDelete={onDelete} onPreview={onPreview} />
            ))}
        </div>
    );
}

type CardProps = Omit<Props, "artifacts" | "isStale"> & { artifact: DramaArtifact; stale: boolean };

function Candidate({ artifact, kind, ratio, stale, onAdopt, onDelete, onPreview }: CardProps) {
    const { t } = useAppTranslation();
    const ready = artifact.status === "ready";
    const origin = artifact.model === "upload" ? t("上传") : artifact.model === "library" ? t("资产库") : modelOptionName(artifact.model);
    return (
        <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border p-1.5", artifact.adopted ? "border-[color:var(--wg-home-line-strong)]" : "border-[color:var(--wg-home-line)]")}>
            {kind === "audio" ? (
                ready ? <audio src={artifact.mediaUrl} controls preload="metadata" className="h-9 w-full" /> : <Placeholder artifact={artifact} ratio="auto" />
            ) : ready ? (
                <button type="button" className="relative block overflow-hidden rounded-lg bg-[color:var(--wg-home-ghost)]" style={{ aspectRatio: ratio }} onClick={() => onPreview(artifact)} title={t("放大预览")}>
                    {kind === "video" ? <video src={artifact.mediaUrl} preload="metadata" muted className="size-full object-contain" /> : <img src={artifact.mediaUrl} alt="" loading="lazy" className={cn("size-full object-contain", stale && "opacity-60")} />}
                </button>
            ) : (
                <Placeholder artifact={artifact} ratio={ratio} />
            )}
            <div className="flex flex-wrap items-center gap-1">
                {artifact.status === "pending" ? <StatusTag status="generating" /> : null}
                {artifact.status === "failed" ? <StatusTag status="failed" /> : null}
                {ready && artifact.adopted ? <StatusTag status="adopted" /> : null}
                {ready && !artifact.adopted && !stale ? <StatusTag status="ready" /> : null}
                {ready && stale ? <StatusTag status="stale" /> : null}
                <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--wg-home-muted)]" title={origin}>
                    {origin}
                </span>
            </div>
            {artifact.status === "failed" && artifact.error ? (
                <p className="line-clamp-2 text-[11px] leading-4 text-destructive" title={artifact.error}>
                    {t(artifact.error)}
                </p>
            ) : null}
            <div className="flex items-center gap-0.5">
                {ready && !artifact.adopted ? (
                    <button type="button" className="wg-text-button !h-7 gap-1 !px-2" onClick={() => onAdopt(artifact)}>
                        <Check className="size-3.5" strokeWidth={1.6} />
                        {t("采用")}
                    </button>
                ) : null}
                <span className="flex-1" />
                {ready && kind !== "audio" ? (
                    <button type="button" className="wg-icon-button !size-7" title={t("放大预览")} onClick={() => onPreview(artifact)}>
                        <Maximize2 strokeWidth={1.6} />
                    </button>
                ) : null}
                <button type="button" className="wg-icon-button !size-7" title={t("删除")} disabled={artifact.status === "pending"} onClick={() => onDelete(artifact)}>
                    <Trash2 strokeWidth={1.6} />
                </button>
            </div>
        </div>
    );
}

function Placeholder({ artifact, ratio }: { artifact: DramaArtifact; ratio: string }) {
    const pending = artifact.status === "pending";
    return (
        <div style={ratio === "auto" ? { height: 36 } : { aspectRatio: ratio }} className="flex items-center justify-center rounded-lg bg-[color:var(--wg-home-ghost)] text-[color:var(--wg-home-muted-strong)]">
            {pending ? <Loader2 className="size-5 animate-spin" strokeWidth={1.6} /> : null}
        </div>
    );
}
