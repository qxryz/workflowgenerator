import { useQueryClient } from "@tanstack/react-query";
import { App, Segmented } from "antd";
import { FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory, useStageRuns } from "@/components/drama/run-history";
import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, episodeKey } from "@/hooks/use-drama";
import { chapterNo } from "@/lib/drama/story";
import { isUnsettled } from "@/lib/drama/stage-runs";
import type { DramaRun, ScriptProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { DramaApiError, updateEpisode } from "@/services/drama-api";
import { ConflictNotice } from "./conflict-notice";
import type { EpisodeCtx } from "./context";
import { SCREENPLAY, ScriptView } from "./script-view";

export function ScriptStep({ ctx }: { ctx: EpisodeCtx }) {
    const { t } = useAppTranslation();
    const { snapshot, episode } = ctx;
    const match = useCallback((run: DramaRun) => run.episodeId === episode.id, [episode.id]);
    const { current, history } = useStageRuns(snapshot.runs, "script", match);
    const [picked, setPicked] = useState<string>();
    const run = history.find((item) => item.id === picked) ?? current;
    // A finished run is only worth a row of its own when the user went looking for it.
    const showRun = run && (picked !== undefined || isUnsettled(run));
    const hasScript = Boolean(episode.script.trim());

    return (
        <div className="thin-scrollbar h-full overflow-y-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
                <div className="flex flex-wrap items-center gap-3">
                    <StartTaskButton snapshot={snapshot} stage="script" episodeId={episode.id} label={hasScript ? "重新写剧本" : "写剧本"} icon={FileText} variant="primary" onStarted={(started) => setPicked(started.id)} />
                    <span className="ml-auto" />
                    <RunHistory runs={history} selectedId={run?.id} onSelect={setPicked} dramaId={snapshot.project.id} />
                </div>
                <Outline ctx={ctx} />
                {showRun ? (
                    <div className="flex max-h-[min(60vh,560px)] flex-col">
                        <ProposalShell key={run.id} run={run} title={t("剧本草稿")} confirmAdopt={hasScript ? "采用后将替换现有剧本" : undefined} onAdopted={() => setPicked(undefined)}>
                            {(proposal) => <ScriptView script={(proposal as ScriptProposal).script} />}
                        </ProposalShell>
                    </div>
                ) : null}
                <ScriptEditor ctx={ctx} />
            </div>
        </div>
    );
}

function Outline({ ctx }: { ctx: EpisodeCtx }) {
    const { t } = useAppTranslation();
    const { episode, snapshot } = ctx;
    const [open, setOpen] = useState(false);
    const chapters = snapshot.chapters.filter((chapter) => episode.sourceChapterIds.includes(chapter.id));
    return (
        <section className="rounded-xl border border-[color:var(--wg-home-line)] px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] text-[color:var(--wg-home-muted)]">
                <span className="font-semibold text-[color:var(--wg-home-text)]">{t("本集梗概")}</span>
                <span className="tabular-nums">{t("目标 {seconds} 秒", { seconds: episode.targetSeconds })}</span>
                {chapters.length ? <span className="min-w-0 truncate">· {chapters.map((chapter) => chapter.title || chapterNo(chapter.ord, t)).join("、")}</span> : null}
            </div>
            {episode.outline.trim() ? (
                <>
                    <p className={cn("mt-2 whitespace-pre-wrap text-[13px] leading-6", !open && "line-clamp-3")}>{episode.outline}</p>
                    {episode.outline.length > 120 ? (
                        <button type="button" className="mt-1 text-[12px] text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]" onClick={() => setOpen((value) => !value)}>
                            {t(open ? "收起" : "展开")}
                        </button>
                    ) : null}
                </>
            ) : (
                <p className="mt-2 text-[13px] text-[color:var(--wg-home-muted)]">{t("这一集还没有梗概")}</p>
            )}
        </section>
    );
}

function ScriptEditor({ ctx }: { ctx: EpisodeCtx }) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const client = useQueryClient();
    const { episode } = ctx;
    const [mode, setMode] = useState<"read" | "edit">(episode.script.trim() ? "read" : "edit");
    const [draft, setDraft] = useState(episode.script);
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);

    // Follow the saved script (a run was adopted) unless the user has typed something of their own.
    const synced = useRef(episode.script);
    useEffect(() => {
        setDraft((current) => (current === synced.current ? episode.script : current));
        synced.current = episode.script;
    }, [episode.script]);

    const dirty = draft !== episode.script;
    const save = async () => {
        setSaving(true);
        try {
            await updateEpisode(episode.id, { rev: episode.rev, script: draft });
            await Promise.all([client.invalidateQueries({ queryKey: episodeKey(episode.id) }), client.invalidateQueries({ queryKey: dramaKey(ctx.snapshot.project.id) })]);
            setConflict(false);
            setMode("read");
            message.success(t("已保存"));
        } catch (error) {
            if (error instanceof DramaApiError && error.status === 409) {
                setConflict(true);
                ctx.refresh();
            } else message.error(error instanceof Error ? error.message : t("保存失败，请重试"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)]">
            <header className="flex items-center gap-3 border-b border-[color:var(--wg-home-line)] px-4 py-2.5">
                <h3 className="text-[14px] font-semibold">{t("剧本")}</h3>
                <span className="text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("{count} 字", { count: draft.replace(/\s/g, "").length })}</span>
                <Segmented
                    className="ml-auto"
                    size="small"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: "read", label: t("阅读") },
                        { value: "edit", label: t("编辑") },
                    ]}
                />
            </header>
            {conflict ? (
                <div className="px-4 pt-3">
                    <ConflictNotice
                        message="剧本刚在别处被修改过"
                        onReload={() => {
                            setDraft(episode.script);
                            setConflict(false);
                        }}
                        onKeep={() => setConflict(false)}
                    />
                </div>
            ) : null}
            {mode === "read" ? (
                draft.trim() ? (
                    <ScriptView script={draft} />
                ) : (
                    <p className="px-5 py-10 text-center text-[13px] text-[color:var(--wg-home-muted)]">{t("还没有剧本。点上方「写剧本」，或在编辑里直接写。")}</p>
                )
            ) : (
                <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    placeholder={t("【场景 1】外景｜地点｜时间")}
                    className={cn(SCREENPLAY, "block min-h-[22rem] w-full resize-y bg-transparent px-5 py-4 outline-none placeholder:text-[color:var(--wg-home-muted-strong)]")}
                    aria-label={t("剧本")}
                />
            )}
            {dirty || mode === "edit" ? (
                <footer className="flex items-center gap-2 border-t border-[color:var(--wg-home-line)] px-4 py-2.5">
                    <button type="button" className="wg-primary-button !min-h-9" disabled={!dirty || saving} onClick={() => void save()}>
                        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                        {t("保存")}
                    </button>
                    <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={!dirty || saving} onClick={() => setDraft(episode.script)}>
                        {t("还原")}
                    </button>
                    {dirty ? <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("有没保存的修改")}</span> : null}
                </footer>
            ) : null}
        </section>
    );
}
