/**
 * GenerationWorkbench — the one panel for making and choosing media: 设定图 (sheet), 分镜图 (image),
 * 视频 (video), 配音 (audio). Source switch 生成 / 上传 / 资产库, options, exact prompt preview,
 * then the owner's results (adopt / delete / enlarge).
 *
 * Contract (wave-2 pages depend on it exactly):
 *
 *   type Prepared = { prompt: string; references: ReferencePlan; firstFrame?: RefImage; inputHash: string; aspect: DramaAspect; params?: Record<string, unknown> };
 *   type GenerationWorkbenchProps = {
 *     dramaId: string; owner: Owner; kind: ArtifactKind; title: string; route: string;
 *     artifacts: DramaArtifact[];   // all artifacts of this owner+kind, newest first
 *     prepare: (look: { useStyle: boolean; usePalette: boolean; language: AppLanguage; model: string }) => Prepared;  // pure, sync
 *     hasStyle: boolean; hasPalette: boolean;   // show the 画风 / 色卡 checkboxes (checked by default)
 *     extraOptions?: ReactNode;                 // kind-specific controls (e.g. 首帧来源)
 *     disabledReason?: string;                  // disables 生成 and is shown as the hint
 *     onChange: () => void;                     // refetch the owner's data after any change
 *     onPoll?: () => void;                      // refetch while a result is generating (every 3s); omit when the page already polls
 *   };
 *
 * - `prepare` is called with the toggles the user sees; the prompt/references it returns are what is sent.
 * - `params` is merged into the job params (video: `seconds`; audio: `voice`). The panel adds `aspect`,
 *   and `quality` (images) / `resolution` + `generateAudio` (video) / `voice` (audio) from its own controls.
 * - Staleness ignores the toggles: an artifact is 过期 when its inputHash differs from `prepare` called with
 *   every available look on and the artifact's own model, so unticking 画风 never marks work stale.
 * - Results are server state; this panel only calls `onPoll` every 3s while one is generating, and stops as soon as none is.
 * - The prompt shown is `sentPrompt(...)`, the same text the runner sends.
 */
import { App, Checkbox, Input, Segmented, Select, Switch } from "antd";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ResultGrid } from "@/components/drama/generation-results";
import { LibraryPicker, UploadZone, type LibraryPick } from "@/components/drama/generation-sources";
import { MediaPreview, type PreviewTarget } from "@/components/drama/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { adoptArtifact, deleteArtifact } from "@/services/drama-api";
import { ARTIFACT_KIND_LABELS } from "@/lib/drama/labels";
import { capabilityOf, normalizeQuality, qualityChoices, supportsGenerateAudio, VIDEO_RESOLUTIONS } from "@/lib/drama/media/model-options";
import { generate, importMedia, resumePending, type Owner } from "@/lib/drama/media/runner";
import { humanError, isStale, requestPlan, sentPrompt } from "@/lib/drama/media/state";
import type { RefImage, ReferencePlan } from "@/lib/drama/media/references";
import type { ArtifactKind, DramaArtifact, DramaAspect } from "@/lib/drama/types";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

export type Prepared = { prompt: string; references: ReferencePlan; firstFrame?: RefImage; inputHash: string; aspect: DramaAspect; params?: Record<string, unknown> };
export type Look = { useStyle: boolean; usePalette: boolean; language: AppLanguage; model: string };
export type GenerationWorkbenchProps = {
    dramaId: string;
    owner: Owner;
    kind: ArtifactKind;
    title: string;
    route: string;
    artifacts: DramaArtifact[];
    prepare: (look: Look) => Prepared;
    hasStyle: boolean;
    hasPalette: boolean;
    extraOptions?: ReactNode;
    disabledReason?: string;
    onChange: () => void;
    onPoll?: () => void;
};

type Source = "generate" | "upload" | "library";
const POLL_MS = 3000;
/** Last model picked per kind, for the rest of the session. */
const lastModel: Partial<Record<ArtifactKind, string>> = {};

export function GenerationWorkbench(props: GenerationWorkbenchProps) {
    const { dramaId, owner, kind, title, route, artifacts, prepare, hasStyle, hasPalette, extraOptions, disabledReason, onChange, onPoll } = props;
    const { t, language } = useAppTranslation();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [source, setSource] = useState<Source>("generate");
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<PreviewTarget | null>(null);
    const [picked, setPicked] = useState(lastModel[kind]);
    const [styleOn, setStyleOn] = useState(true);
    const [paletteOn, setPaletteOn] = useState(true);
    const [quality, setQuality] = useState<string>();
    const [resolution, setResolution] = useState("720p");
    const [sound, setSound] = useState(true);
    const [voice, setVoice] = useState("");
    const [showPrompt, setShowPrompt] = useState(false);
    const [edit, setEdit] = useState<{ from: string; text: string } | null>(null);

    const models = selectableModelsByCapability(config, capabilityOf(kind));
    const model = [picked, resolveModelForCapability(config, undefined, capabilityOf(kind))].find((value) => value && models.includes(value)) ?? models[0] ?? "";
    const prepared = prepare({ useStyle: hasStyle && styleOn, usePalette: hasPalette && paletteOn, language, model });
    const english = language === "en-US";
    const plan = requestPlan(prepared.references, prepared.firstFrame, english);
    const edited = edit && edit.from === prepared.prompt ? edit.text : prepared.prompt;
    const imageKind = kind === "sheet" || kind === "image";
    const qualities = imageKind && model ? qualityChoices(config, model) : [];
    const canSound = kind === "video" && Boolean(model) && supportsGenerateAudio(config, model);
    const ratio = prepared.aspect.replace(":", " / ");

    const hashes = new Map<string, string>();
    const currentHash = (artifactModel: string) => {
        if (!hashes.has(artifactModel)) hashes.set(artifactModel, prepare({ useStyle: hasStyle, usePalette: hasPalette, language, model: artifactModel }).inputHash);
        return hashes.get(artifactModel)!;
    };

    const polled = useRef(onPoll);
    polled.current = onPoll;
    useEffect(() => resumePending(artifacts, route), [artifacts, route]);
    const generating = artifacts.some((artifact) => artifact.status === "pending");
    const polling = generating && Boolean(onPoll);
    useEffect(() => {
        if (!polling) return;
        const timer = window.setInterval(() => polled.current?.(), POLL_MS);
        return () => window.clearInterval(timer);
    }, [polling]);

    const readyHint = !model
        ? "先在「模型与渠道」里添加模型"
        : !useConfigStore.getState().isAiConfigReady(config, model)
          ? "这个模型还没有填写密钥"
          : !edited.trim()
            ? "提示词为空"
            : "";
    const blocked = disabledReason || readyHint;

    const run = () => {
        const params: Record<string, unknown> = { ...prepared.params, aspect: prepared.aspect };
        if (qualities.length) params.quality = normalizeQuality(config, model, quality);
        if (kind === "video") Object.assign(params, { resolution, ...(canSound ? { generateAudio: sound } : {}) });
        if (kind === "audio" && (voice.trim() || prepared.params?.voice)) params.voice = voice.trim() || prepared.params?.voice;
        lastModel[kind] = model;
        generate({
            dramaId, owner, kind, title, route, model, params,
            prompt: edited,
            references: prepared.references,
            firstFrame: prepared.firstFrame,
            inputHash: currentHash(model),
            onCreated: onChange,
        })
            .then(onChange)
            .catch((error) => message.error(t(humanError(error))));
    };

    const bring = async (items: Array<File | LibraryPick>) => {
        setBusy(true);
        try {
            for (const item of items) await importMedia({ dramaId, owner, kind, source: item });
        } catch (error) {
            message.error(t(humanError(error)));
        } finally {
            setBusy(false);
            onChange();
        }
    };

    const act = (work: Promise<unknown>) => work.catch((error) => message.error(t(humanError(error)))).finally(onChange);
    const remove = (artifact: DramaArtifact) => {
        const drop = () => act(deleteArtifact(artifact.id));
        if (!artifact.adopted) return void drop();
        modal.confirm({ title: t("删除已采用的{kind}？", { kind: t(ARTIFACT_KIND_LABELS[kind]) }), content: t("删除后需要重新采用其他结果。"), okText: t("删除"), cancelText: t("取消"), okButtonProps: { danger: true }, onOk: drop });
    };

    return (
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <Segmented
                block
                size="small"
                value={source}
                onChange={setSource}
                options={[
                    { value: "generate", label: t("生成") },
                    { value: "upload", label: t("上传") },
                    { value: "library", label: t("资产库") },
                ]}
            />

            {source === "upload" ? <UploadZone kind={kind} busy={busy} onFiles={(files) => void bring(files)} /> : null}
            {source === "library" ? <LibraryPicker kind={kind} busy={busy} onPick={(pick) => void bring([pick])} /> : null}

            {source === "generate" ? (
                <div className="flex flex-col gap-3">
                    {models.length ? (
                        <ModelPicker config={config} value={model} capability={capabilityOf(kind)} onChange={setPicked} fullWidth />
                    ) : (
                        <button type="button" className="text-left text-xs text-[color:var(--wg-home-accent)] underline-offset-2 hover:underline" onClick={() => openConfigDialog(false, "channels")}>
                            {t("还没有可用模型，去「模型与渠道」添加")}
                        </button>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[color:var(--wg-home-muted)]">
                        {qualities.length ? (
                            <Option label="清晰度">
                                <Select size="small" className="w-24" value={normalizeQuality(config, model, quality)} onChange={setQuality} options={qualities.map((item) => ({ value: item.value, label: t(item.label) }))} />
                            </Option>
                        ) : null}
                        {kind === "video" ? (
                            <>
                                <Option label="清晰度">
                                    <Select size="small" className="w-24" value={resolution} onChange={setResolution} options={VIDEO_RESOLUTIONS} />
                                </Option>
                                {typeof prepared.params?.seconds === "number" ? <span>{t("时长 {seconds} 秒", { seconds: prepared.params.seconds })}</span> : null}
                                {canSound ? (
                                    <Option label="生成声音">
                                        <Switch size="small" checked={sound} onChange={setSound} />
                                    </Option>
                                ) : null}
                            </>
                        ) : null}
                        {kind === "audio" ? (
                            <Option label="音色">
                                <Input size="small" className="w-40" value={voice} placeholder={t(typeof prepared.params?.voice === "string" ? prepared.params.voice : "默认音色")} onChange={(event) => setVoice(event.target.value)} />
                            </Option>
                        ) : null}
                        {hasStyle && kind !== "audio" ? (
                            <Checkbox checked={styleOn} onChange={(event) => setStyleOn(event.target.checked)}>
                                {t("画风")}
                            </Checkbox>
                        ) : null}
                        {hasPalette && kind !== "audio" ? (
                            <Checkbox checked={paletteOn} onChange={(event) => setPaletteOn(event.target.checked)}>
                                {t("色卡")}
                            </Checkbox>
                        ) : null}
                    </div>
                    {extraOptions}

                    {plan.images.length ? (
                        <div className="flex flex-wrap gap-1.5">
                            {plan.images.map((image, index) => (
                                <img key={`${image.artifactId}-${index}`} src={image.url} alt={image.name} title={plan.notes[index]} className="size-11 rounded-lg border border-[color:var(--wg-home-line)] object-cover" />
                            ))}
                        </div>
                    ) : null}

                    <div className="rounded-xl border border-[color:var(--wg-home-line)]">
                        <div className="flex items-center justify-between px-2.5 py-1.5">
                            <button type="button" className="flex items-center gap-1 text-xs font-medium text-[color:var(--wg-home-text)]" aria-expanded={showPrompt} onClick={() => setShowPrompt((value) => !value)}>
                                <ChevronRight className={cn("size-3.5 transition-transform", showPrompt && "rotate-90")} strokeWidth={1.6} />
                                {t("提示词")}
                            </button>
                            {showPrompt ? (
                                <button type="button" className="text-xs text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]" onClick={() => setEdit(edit ? null : { from: prepared.prompt, text: prepared.prompt })}>
                                    {edit ? t("恢复") : t("调整")}
                                </button>
                            ) : null}
                        </div>
                        {showPrompt ? (
                            <div className="border-t border-[color:var(--wg-home-line)] px-2.5 py-2">
                                {edit ? (
                                    <>
                                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} value={edited} onChange={(event) => setEdit({ from: prepared.prompt, text: event.target.value })} />
                                        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-4 text-[color:var(--wg-home-muted)]">{plan.notes.join("\n")}</p>
                                        <p className="mt-1 text-[11px] text-[color:var(--wg-home-muted)]">{t("只对这一次生成有效")}</p>
                                    </>
                                ) : (
                                    <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-5 text-[color:var(--wg-home-text)]">{sentPrompt(kind, edited, plan)}</pre>
                                )}
                            </div>
                        ) : null}
                    </div>

                    <button type="button" className="wg-primary-button w-full" disabled={Boolean(blocked)} onClick={run}>
                        {generating ? <Loader2 className="size-4 animate-spin" strokeWidth={1.6} /> : <Sparkles className="size-4" strokeWidth={1.6} />}
                        {t("生成")}
                    </button>
                    {blocked ? <p className="-mt-2 text-center text-xs text-[color:var(--wg-home-muted)]">{t(blocked)}</p> : null}
                </div>
            ) : null}

            <ResultGrid
                artifacts={artifacts}
                kind={kind}
                ratio={ratio}
                isStale={(artifact) => isStale(artifact, currentHash(artifact.model))}
                onAdopt={(artifact) => void act(adoptArtifact(artifact.id))}
                onDelete={remove}
                onPreview={(artifact) => setPreview({ kind, url: artifact.mediaUrl, title: t(ARTIFACT_KIND_LABELS[kind]) })}
            />
            <MediaPreview target={preview} onClose={() => setPreview(null)} />
        </div>
    );
}

function Option({ label, children }: { label: string; children: ReactNode }) {
    const { t } = useAppTranslation();
    return (
        <label className="flex items-center gap-1.5">
            <span>{t(label)}</span>
            {children}
        </label>
    );
}
