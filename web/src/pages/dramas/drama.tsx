import { motion, useReducedMotion } from "motion/react";
import { BookOpen, ClipboardCheck, Clapperboard, Palette, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { DramaPageHeader } from "@/components/drama/page-header";
import { DramaTabs, type DramaTabItem } from "@/components/drama/drama-tabs";
import { RunPanelButton } from "@/components/drama/run-panel";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, dramaListKey, useDrama, useDramaMutation } from "@/hooks/use-drama";
import { useOrphanedRuns } from "@/hooks/use-orphaned-runs";
import { isConflict } from "@/lib/drama/story";
import type { DramaSnapshot, RunStage } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { DramaApiError, updateDrama } from "@/services/drama-api";
import { EpisodesSection } from "./episodes";
import { ReviewSection } from "./review";
import { SettingsSection } from "./settings";
import { StorySection } from "./story";
import { StyleSection } from "./style";

type Tab = "story" | "settings" | "style" | "episodes";
const TABS: Array<{ value: Tab; label: string; icon: DramaTabItem<Tab>["icon"]; stage?: RunStage }> = [
    { value: "story", label: "故事", icon: BookOpen, stage: "chapter" },
    { value: "settings", label: "设定与关系", icon: Users, stage: "settings" },
    { value: "style", label: "画风与色彩", icon: Palette },
    { value: "episodes", label: "分集与剧本", icon: Clapperboard, stage: "episodes" },
];
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value);

export default function DramaPage() {
    const { t } = useAppTranslation();
    const { id } = useParams();
    const [params, setParams] = useSearchParams();
    const { data: snapshot, isPending, error, refetch } = useDrama(id);
    useOrphanedRuns(id, snapshot?.runs);
    const rawTab = params.get("tab");
    const tab: Tab = isTab(rawTab) ? rawTab : "story";
    const reviewing = params.get("view") === "review";

    const go = (next: Record<string, string | null>) =>
        setParams(
            (current) => {
                const merged = new URLSearchParams(current);
                for (const [key, value] of Object.entries(next)) {
                    if (value === null) merged.delete(key);
                    else merged.set(key, value);
                }
                return merged;
            },
            { replace: true },
        );

    if (isPending) return <Skeleton />;
    if (!snapshot) {
        const missing = error instanceof DramaApiError && error.status === 404;
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4 text-center text-sm text-[color:var(--wg-home-muted)]">
                <p>{missing ? t("没有找到这部剧目，可能已被删除。") : t("剧目没能加载")}</p>
                <div className="flex gap-2">
                    {missing ? null : (
                        <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" onClick={() => void refetch()}>
                            {t("重试")}
                        </button>
                    )}
                    <Link to="/dramas" className="wg-primary-button">
                        {t("回到剧目库")}
                    </Link>
                </div>
            </main>
        );
    }

    const items = TABS.map<DramaTabItem<Tab>>((item) => ({ value: item.value, label: item.label, icon: item.icon, badge: item.stage ? <TabBadge snapshot={snapshot} stage={item.stage} /> : undefined }));
    const section = reviewing ? <ReviewSection snapshot={snapshot} /> : tab === "story" ? <StorySection snapshot={snapshot} /> : tab === "settings" ? <SettingsSection snapshot={snapshot} /> : tab === "style" ? <StyleSection snapshot={snapshot} /> : <EpisodesSection snapshot={snapshot} />;
    return (
        <main className="flex h-full min-h-0 flex-col bg-[color:var(--wg-home-bg)] text-[color:var(--wg-home-text)]">
            <DramaPageHeader
                backTo="/dramas"
                backLabel="返回剧目库"
                actions={
                    <>
                        <button
                            type="button"
                            aria-pressed={reviewing}
                            className={cn("wg-text-button !h-9 !border", reviewing ? "!border-[color:var(--wg-home-line-strong)] !bg-[color:var(--wg-home-hover)] !text-[color:var(--wg-home-text)]" : "!border-[color:var(--wg-home-line)]")}
                            onClick={() => go({ view: reviewing ? null : "review" })}
                        >
                            <ClipboardCheck className="size-4" strokeWidth={1.6} />
                            {t("复核")}
                        </button>
                        <RunPanelButton snapshot={snapshot} />
                    </>
                }
            >
                <TitleEditor snapshot={snapshot} />
                <span className="shrink-0 rounded-md border border-[color:var(--wg-home-line)] px-1.5 py-0.5 text-[11px] tabular-nums text-[color:var(--wg-home-muted)]">{snapshot.project.aspect}</span>
            </DramaPageHeader>
            {reviewing ? (
                <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[color:var(--wg-home-line)] px-6 text-[13px]">
                    <span className="font-semibold">{t("复核")}</span>
                    <button type="button" className="wg-text-button !h-7" onClick={() => go({ view: null })}>
                        {t("返回「{name}」", { name: t(TABS.find((item) => item.value === tab)!.label) })}
                    </button>
                </div>
            ) : (
                <DramaTabs className="px-5" items={items} value={tab} onChange={(next) => go({ tab: next })} ariaLabel="剧目内容" />
            )}
            <Body key={reviewing ? "review" : tab}>{section}</Body>
        </main>
    );
}

/** Sections fill this box and scroll inside it; the page itself never scrolls. */
function Body({ children }: { children: ReactNode }) {
    const reduce = useReducedMotion();
    return (
        <motion.div className="min-h-0 flex-1 overflow-hidden" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            {children}
        </motion.div>
    );
}

/** Pulsing dot while a run of this stage is live, a count when results wait for confirmation. */
function TabBadge({ snapshot, stage }: { snapshot: DramaSnapshot; stage: RunStage }) {
    const { t } = useAppTranslation();
    const runs = snapshot.runs.filter((run) => run.stage === stage);
    const waiting = runs.filter((run) => run.status === "review").length;
    if (runs.some((run) => run.status === "running")) return <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--wg-home-accent)]" title={t("运行中")} />;
    if (waiting)
        return (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--wg-home-accent)] px-1 text-[10px] font-semibold tabular-nums text-[color:var(--wg-home-accent-text)]" title={t("待你确认")}>
                {waiting}
            </span>
        );
    return null;
}

function TitleEditor({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const client = useQueryClient();
    const { project } = snapshot;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(project.title);
    /** Enter, Escape and blur all end the edit; only the first one counts. */
    const finished = useRef(false);
    useEffect(() => setDraft(project.title), [project.title]);
    const save = useDramaMutation((title: string) => updateDrama(project.id, { rev: project.rev, title }), [dramaKey(project.id), dramaListKey]);
    const finish = (keep: boolean) => {
        if (finished.current) return;
        finished.current = true;
        setEditing(false);
        const next = draft.trim();
        if (!keep || !next || next === project.title) return setDraft(project.title);
        save.mutate(next, {
            onError: (error) => {
                setDraft(project.title);
                message.error(isConflict(error) ? t("剧名已在别处修改，已恢复为最新的") : error instanceof Error ? error.message : t("修改剧名失败，请重试"));
                void client.invalidateQueries({ queryKey: dramaKey(project.id) });
            },
        });
    };
    return editing ? (
        <input
            autoFocus
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(event) => {
                if (event.key === "Enter") finish(true);
                if (event.key === "Escape") finish(false);
            }}
            className="h-8 min-w-0 max-w-sm flex-1 rounded-[7px] border border-[color:var(--wg-home-accent)] bg-[color:var(--wg-panel)] px-2 text-[16px] font-semibold outline-none"
            aria-label={t("剧名")}
        />
    ) : (
        <button
            type="button"
            className="min-w-0 truncate rounded-md px-1.5 py-1 text-left text-[16px] font-semibold hover:bg-[color:var(--wg-home-hover)]"
            title={t("点击修改剧名")}
            onClick={() => {
                finished.current = false;
                setEditing(true);
            }}
        >
            {project.title}
        </button>
    );
}

function Skeleton() {
    return (
        <div className="flex h-full flex-col bg-[color:var(--wg-home-bg)]" aria-busy="true">
            <div className="flex h-14 items-center gap-3 px-5">
                <div className="size-8 animate-pulse rounded-md bg-[color:var(--wg-home-ghost)]" />
                <div className="h-5 w-40 animate-pulse rounded bg-[color:var(--wg-home-ghost)]" />
            </div>
            <div className="h-11 border-b border-[color:var(--wg-home-line)]" />
            <div className="flex-1 space-y-3 p-6">
                {[0, 1, 2].map((key) => (
                    <div key={key} className="h-16 animate-pulse rounded-xl bg-[color:var(--wg-home-ghost)]" />
                ))}
            </div>
        </div>
    );
}
