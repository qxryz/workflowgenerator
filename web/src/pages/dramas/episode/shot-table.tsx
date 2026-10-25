import { App } from "antd";
import { ArrowDown, ArrowUp, ChevronRight, Link2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { moveId } from "@/lib/drama/episode-steps";
import { TRANSITION_LABELS } from "@/lib/drama/labels";
import type { LintIssue } from "@/lib/drama/lint";
import type { DramaShot } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { createShot, deleteShot, reorderShots } from "@/services/drama-api";
import type { EpisodeCtx } from "./context";
import { ShotEditor } from "./shot-editor";

const COLUMNS = "grid grid-cols-[3rem_2.75rem_3.75rem_4.5rem_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.75rem_8rem] items-center gap-x-3";

type Props = { ctx: EpisodeCtx; issues: LintIssue[]; expandedId: string | null; onExpand: (id: string | null) => void };

export function ShotTable({ ctx, issues, expandedId, onExpand }: Props) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const dirty = useRef(false);
    const onDirty = useCallback((value: boolean) => void (dirty.current = value), []);
    const { shots, artifacts, episode } = ctx;

    const run = async (work: () => Promise<unknown>) => {
        try {
            await work();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("操作没有成功，请重试"));
        } finally {
            ctx.refresh();
        }
    };

    const toggle = (id: string) => {
        const next = expandedId === id ? null : id;
        if (!dirty.current || expandedId === null) return onExpand(next);
        modal.confirm({ title: t("放弃这一镜没保存的修改？"), okText: t("放弃修改"), cancelText: t("继续编辑"), onOk: () => onExpand(next) });
    };

    const add = (shot: DramaShot) => run(async () => onExpand((await createShot(episode.id, shot.ord)).id));
    const move = (shot: DramaShot, delta: number) =>
        run(() => reorderShots(episode.id, moveId(shots.map((item) => item.id), shot.id, delta)));
    const remove = (shot: DramaShot, at: number) => {
        const made = artifacts.filter((artifact) => artifact.shotId === shot.id && artifact.status === "ready").length;
        modal.confirm({
            title: t("删除第 {count} 镜？", { count: at + 1 }),
            content: made ? t("这一镜已生成的画面、视频和配音也会一起删除。") : undefined,
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: () => run(async () => {
                await deleteShot(shot.id);
                if (expandedId === shot.id) onExpand(null);
            }),
        });
    };

    return (
        <div className="overflow-hidden rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)]">
            <div className={cn(COLUMNS, "border-b border-[color:var(--wg-home-line)] px-3 py-2 text-[11px] text-[color:var(--wg-home-muted)]")} role="row">
                <span>#</span>
                <span>{t("秒数")}</span>
                <span>{t("景别")}</span>
                <span>{t("运镜")}</span>
                <span>{t("画面")}</span>
                <span>{t("对白")}</span>
                <span>{t("出场")}</span>
                <span>{t("衔接")}</span>
                <span />
            </div>
            <ul className="divide-y divide-[color:var(--wg-home-line)]">
                {shots.map((shot, at) => (
                    <Row key={shot.id} ctx={ctx} shot={shot} at={at} open={expandedId === shot.id} warned={issues.some((issue) => issue.shotId === shot.id && issue.level === "warn")} onToggle={() => toggle(shot.id)} onAdd={() => void add(shot)} onMove={(delta) => void move(shot, delta)} onRemove={() => remove(shot, at)} onDirty={onDirty} />
                ))}
            </ul>
        </div>
    );
}

type RowProps = {
    ctx: EpisodeCtx;
    shot: DramaShot;
    at: number;
    open: boolean;
    warned: boolean;
    onToggle: () => void;
    onAdd: () => void;
    onMove: (delta: number) => void;
    onRemove: () => void;
    onDirty: (dirty: boolean) => void;
};

function Row({ ctx, shot, at, open, warned, onToggle, onAdd, onMove, onRemove, onDirty }: RowProps) {
    const { t } = useAppTranslation();
    const ref = useRef<HTMLLIElement>(null);
    useEffect(() => {
        if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [open]);
    const names = shot.entityIds.map((id) => ctx.entities.get(id)?.name).filter(Boolean) as string[];
    const speak = (id: string) => ctx.entities.get(id)?.name;
    const first = shot.dialogue.find((line) => line.text.trim());
    const dialogue = first ? `${first.speaker && speak(first.speaker) ? `${speak(first.speaker)}：` : ""}${first.text}` : shot.narration.trim() ? `${t("旁白")}：${shot.narration}` : "";
    const action = "wg-icon-button !size-7";
    return (
        <li ref={ref} className={cn(open && "bg-[color:var(--wg-home-hover)]")}>
            <div
                role="row"
                tabIndex={0}
                aria-expanded={open}
                className={cn(COLUMNS, "group cursor-pointer px-3 py-2.5 text-[13px] outline-none transition hover:bg-[color:var(--wg-home-hover)] focus-visible:bg-[color:var(--wg-home-hover)]")}
                onClick={onToggle}
                onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        onToggle();
                    }
                }}
            >
                <span className="flex items-center gap-0.5 font-semibold tabular-nums">
                    {at + 1}
                    {warned ? <TriangleAlert className="size-3 text-[color:var(--wg-home-accent)]" strokeWidth={1.8} aria-label={t("有静态检查提示")} /> : null}
                    <ChevronRight className={cn("size-3 text-[color:var(--wg-home-muted)] transition-transform", open && "rotate-90")} strokeWidth={1.8} />
                </span>
                <span className="tabular-nums">{shot.seconds}s</span>
                <span className="truncate">{shot.size ? t(shot.size) : "—"}</span>
                <span className="truncate">{shot.camera ? t(shot.camera) : "—"}</span>
                <span className="line-clamp-2 leading-5">{shot.description || <em className="not-italic text-[color:var(--wg-home-muted)]">{t("还没有描述")}</em>}</span>
                <span className="line-clamp-2 leading-5 text-[color:var(--wg-home-muted)]">{dialogue || "—"}</span>
                <span className="flex flex-wrap gap-1">
                    {names.slice(0, 3).map((name) => (
                        <span key={name} className="max-w-full truncate rounded-md border border-[color:var(--wg-home-line)] px-1.5 text-[11px] leading-5">{name}</span>
                    ))}
                    {names.length > 3 ? <span className="text-[11px] leading-5 text-[color:var(--wg-home-muted)]">+{names.length - 3}</span> : null}
                </span>
                <TransitionBadge shot={shot} first={at === 0} />
                <span className={cn("flex items-center justify-end gap-0.5 transition", open ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")} onClick={(event) => event.stopPropagation()}>
                    <button type="button" className={action} disabled={at === 0} title={t("上移")} aria-label={t("上移")} onClick={() => onMove(-1)}><ArrowUp strokeWidth={1.6} /></button>
                    <button type="button" className={action} disabled={at === ctx.shots.length - 1} title={t("下移")} aria-label={t("下移")} onClick={() => onMove(1)}><ArrowDown strokeWidth={1.6} /></button>
                    <button type="button" className={action} title={t("在后面加一镜")} aria-label={t("在后面加一镜")} onClick={onAdd}><Plus strokeWidth={1.6} /></button>
                    <button type="button" className={action} title={t("删除")} aria-label={t("删除")} onClick={onRemove}><Trash2 strokeWidth={1.6} /></button>
                </span>
            </div>
            {open ? <ShotEditor ctx={ctx} shot={shot} index={at} onDirty={onDirty} /> : null}
        </li>
    );
}

function TransitionBadge({ shot, first }: { shot: DramaShot; first: boolean }) {
    const { t } = useAppTranslation();
    if (first) return <span className="text-[color:var(--wg-home-muted)]">—</span>;
    return (
        <span
            className={cn(
                "inline-flex h-5 w-fit items-center gap-1 rounded-full border px-1.5 text-[11px]",
                shot.transition === "continuous" ? "border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-home-hover)]" : "border-[color:var(--wg-home-line)] text-[color:var(--wg-home-muted)]",
                shot.transition === "time_jump" && "border-dashed",
            )}
        >
            {shot.transition === "continuous" ? <Link2 className="size-3" strokeWidth={1.6} /> : null}
            {t(TRANSITION_LABELS[shot.transition])}
        </span>
    );
}
