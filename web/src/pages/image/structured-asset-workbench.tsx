import { App, Image, Input, Modal } from "antd";
import { ArrowDown, ArrowUp, Check, FolderOpen, ImagePlus, Plus, Search, Trash2, Upload, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaWorkbenchHeader } from "@/components/media-workbench-header";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";
import { resolveStructuredAssetReferencePrompt, structuredAssetReferencePrompt, structuredAssetRelationshipText } from "@/lib/structured-asset-reference";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { createServerJsonStore } from "@/services/server-storage";
import { registerStateFlusher } from "@/services/app-lifecycle";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import { discardUploadedImage, publishUploadedImage, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { isStructuredAsset, useAssetStore, type StructuredAsset, type StructuredAssetImage, type StructuredAssetKind } from "@/stores/use-asset-store";
import { discardUploadedMedia, publishUploadedMedia, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import {
    COLLECTION_SECTIONS,
    createStructuredAssetDraft,
    moveCollectionImage,
    normalizeStructuredAssetDraft,
    removeCollectionImage,
    removeCollectionPart,
    structuredAssetPayload,
    structuredAssetToDraft,
    type StructuredAssetDraft,
} from "./structured-asset-collection";
import { StructuredAssetReferencePreview } from "./structured-asset-reference-preview";
import { StructuredAssetRelations } from "./structured-asset-relations";

const structuredDraftStore = createServerJsonStore("structured-image-workbench-drafts-v1");
const quietButton = "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-[color:var(--wg-studio-raised)] disabled:opacity-40";
const fieldClass = "w-full rounded-lg border border-[color:var(--wg-studio-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--wg-studio-accent-strong)]";

export default function StructuredAssetWorkbench({ kind }: { kind: StructuredAssetKind }) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const hydrated = useAssetStore((state) => state.hydrated);
    const [draft, setDraft] = useState(() => createStructuredAssetDraft(kind));
    const draftRef = useRef(draft);
    const [ready, setReady] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const revision = useRef(0);
    const [query, setQuery] = useState("");
    const [error, setError] = useState("");
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [pickerPart, setPickerPart] = useState<string | null>(null);
    const [pickerQuery, setPickerQuery] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const audioInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef("");
    const mounted = useRef(true);
    const epoch = useRef(0);
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const label = kind === "character" ? "人物" : "场景";
    const sections = COLLECTION_SECTIONS[kind];
    const section = sections.find((item) => item.id === draft.activeGroupId);
    const avatar = draft.images.find((image) => image.id === draft.avatarImageId);
    const library = assets.filter((asset): asset is StructuredAsset => isStructuredAsset(asset) && asset.kind === kind).filter((asset) => `${asset.title} ${asset.data.description}`.toLowerCase().includes(query.trim().toLowerCase()));

    useEffect(() => {
        mounted.current = true;
        let disposed = false;
        void structuredDraftStore
            .getItem<StructuredAssetDraft>(kind)
            .then(async (saved) => {
                const next = normalizeStructuredAssetDraft(kind, saved || undefined);
                next.images = await Promise.all(next.images.map(async (image) => ({ ...image, dataUrl: await resolveImageUrl(image.storageKey, image.dataUrl) })));
                next.audios = await Promise.all((next.audios || []).map(async (audio) => ({ ...audio, url: await resolveMediaUrl(audio.storageKey, audio.url) })));
                if (!disposed) {
                    draftRef.current = next;
                    setDraft(next);
                    setDirty(Boolean(saved?.pendingChanges || (saved && saved.collectionVersion !== 1 && (saved.title || saved.images?.length))));
                    setReady(true);
                }
            })
            .catch(() => {
                if (!disposed) setError(t("无法读取草稿，请重新打开工作台"));
            });
        const unregisterMedia = registerRuntimeMediaReferenceProvider(() => draftRef.current);
        const unregisterFlush = registerStateFlusher(() => writes.current.then(() => undefined));
        return () => {
            disposed = true;
            mounted.current = false;
            epoch.current += 1;
            unregisterMedia();
            void writes.current.then(unregisterFlush, unregisterFlush);
        };
    }, [kind, loadAttempt]);

    const persistDraft = (next: StructuredAssetDraft) => {
        draftRef.current = next;
        setDraft(next);
        markMediaReferencesChanged();
        const write = writes.current.catch(() => undefined).then(() => structuredDraftStore.setItem(kind, next));
        writes.current = write;
        void write.catch(() => {
            if (mounted.current) setError(t("草稿保存失败，请重试"));
        });
        return write;
    };
    const change = (update: (current: StructuredAssetDraft) => StructuredAssetDraft) => {
        revision.current += 1;
        setDirty(true);
        setError("");
        void persistDraft({ ...update(draftRef.current), pendingChanges: true });
    };
    const save = async (notify = true) => {
        const current = draftRef.current;
        const savedRevision = revision.current;
        if (!current.title.trim()) {
            void message.warning(t("请先填写名称"));
            return false;
        }
        const unresolved = Array.from(resolveStructuredAssetReferencePrompt(current).matchAll(/@\[node:([^\]]+)\]/g)).some((match) => !current.images.some((image) => image.id === match[1]) && !current.audios?.some((audio) => audio.id === match[1]));
        if (unresolved) {
            setError(t("有素材已移除，请调整引用提示词"));
            return false;
        }
        setBusy(true);
        try {
            await writes.current;
            const relationships = (current.relationships || []).map((relation) => ({ ...relation, targetName: assets.find((asset) => asset.id === relation.targetAssetId)?.title || relation.targetName }));
            const assetId = await useAssetStore.getState().upsertAssetPersisted(current.assetId, structuredAssetPayload({ ...current, relationships }));
            const savedAsset = useAssetStore.getState().assets.find((asset) => asset.id === assetId);
            await persistDraft({
                ...draftRef.current,
                assetId,
                pendingChanges: savedRevision !== revision.current,
                ...(savedRevision === revision.current && savedAsset && isStructuredAsset(savedAsset) ? { relationships: savedAsset.data.relationships, referencePrompt: savedAsset.data.referencePrompt } : {}),
            });
            setDirty(savedRevision !== revision.current);
            setError("");
            if (notify) void message.success(t("已保存到资产库"));
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("保存失败，请重试"));
            return false;
        } finally {
            if (mounted.current) setBusy(false);
        }
    };
    // Relationship edits are saved immediately; refresh mirrored changes without replacing other draft fields.
    useEffect(() => {
        if (!ready || !hydrated || busy) return;
        const current = draftRef.current;
        const saved = assets.find((asset) => asset.id === current.assetId);
        if (!saved || !isStructuredAsset(saved)) return;
        const relationships = saved.data.relationships || [];
        if (JSON.stringify(current.relationships || []) === JSON.stringify(relationships)) return;
        const prompt = structuredAssetReferencePrompt(current);
        void persistDraft({ ...current, relationships, referencePrompt: relationships.length && !prompt.includes("@[node:relationships]") ? [prompt, "@[node:relationships]"].filter(Boolean).join("\n") : current.referencePrompt });
    }, [assets, ready, hydrated, busy, draft.assetId]);
    const saveRelationships = async (relationships: NonNullable<StructuredAssetDraft["relationships"]>) => {
        if (!draftRef.current.title.trim()) {
            void message.warning(t("请先填写名称"));
            return false;
        }
        change((current) => {
            const prompt = structuredAssetReferencePrompt(current);
            return { ...current, relationships, referencePrompt: relationships.length && !prompt.includes("@[node:relationships]") ? [prompt, "@[node:relationships]"].filter(Boolean).join("\n") : current.referencePrompt };
        });
        return save(false);
    };
    const selectDraft = async (asset?: StructuredAsset) => {
        if (busy || !ready) return;
        if (dirty && !(await save(false))) return;
        epoch.current += 1;
        const latest = asset && useAssetStore.getState().assets.find((item) => item.id === asset.id);
        const next = latest && isStructuredAsset(latest) ? structuredAssetToDraft(kind, latest) : createStructuredAssetDraft(kind);
        await persistDraft(next);
        setDirty(false);
        setLibraryOpen(false);
        setError("");
    };
    const selectSection = (id: string) => {
        void persistDraft({ ...draftRef.current, activeGroupId: id });
    };
    const addImages = async (files: FileList | File[], target: string) => {
        if (busy || !ready) return;
        const input = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (!input.length) {
            void message.warning(t("请选择图片文件"));
            return;
        }
        const generation = epoch.current;
        const uploaded: UploadedImage[] = [];
        setBusy(true);
        try {
            for (const file of target === "avatar" ? input.slice(0, 1) : input) uploaded.push(await uploadImage(file));
            if (!mounted.current || generation !== epoch.current) {
                await Promise.all(uploaded.map(discardUploadedImage));
                return;
            }
            const images: StructuredAssetImage[] = uploaded.map((image, index) => ({ ...image, id: nanoid(), dataUrl: image.url, title: input[index].name.replace(/\.[^.]+$/, ""), partId: target, isCurrent: true }));
            const current = draftRef.current;
            const next = { ...current, images: [...current.images.filter((image) => target !== "avatar" || image.id !== current.avatarImageId), ...images], ...(target === "avatar" ? { avatarImageId: images[0].id } : {}) };
            await persistDraft({ ...next, pendingChanges: true });
            uploaded.forEach(publishUploadedImage);
            revision.current += 1;
            setDirty(true);
        } catch (cause) {
            // The draft may already reference uploaded files after a failed acknowledgement; retain them for retry.
            setError(cause instanceof Error ? cause.message : t("图片添加失败"));
        } finally {
            if (mounted.current) setBusy(false);
        }
    };
    const addAudios = async (files: FileList | File[], target: string) => {
        if (busy || !ready) return;
        const input = Array.from(files).filter((file) => file.type.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(file.name));
        if (!input.length) {
            void message.warning(t("请选择音频文件"));
            return;
        }
        const generation = epoch.current;
        const uploaded: UploadedFile[] = [];
        setBusy(true);
        try {
            for (const file of input) uploaded.push(await uploadMediaFile(file, "audio"));
            if (!mounted.current || generation !== epoch.current) {
                await Promise.all(uploaded.map(discardUploadedMedia));
                return;
            }
            const audios = uploaded.map((audio, index) => ({ ...audio, id: nanoid(), title: input[index].name.replace(/\.[^.]+$/, ""), partId: target, isCurrent: true }));
            await persistDraft({ ...draftRef.current, audios: [...(draftRef.current.audios || []), ...audios], pendingChanges: true });
            uploaded.forEach(publishUploadedMedia);
            revision.current += 1;
            setDirty(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("音频添加失败"));
        } finally {
            if (mounted.current) setBusy(false);
        }
    };
    const audioLibrary = assets.flatMap((asset) =>
        asset.kind === "audio" ? [{ ...asset.data, id: asset.id, title: asset.title }] : isStructuredAsset(asset) ? (asset.data.audios || []).map((audio) => ({ ...audio, id: `${asset.id}:${audio.id}`, title: `${asset.title} · ${audio.title}` })) : [],
    );
    const chooseFiles = (target: string) => {
        uploadTarget.current = target;
        fileInput.current?.click();
    };
    const chooseLibrary = (target: string) => {
        setPickerPart(target);
        setPicked([]);
        setPickerQuery("");
    };
    const pickerImages = useMemo(
        () =>
            assets
                .flatMap((asset) =>
                    asset.kind === "image"
                        ? [{ ...asset.data, id: asset.id, title: asset.title } as StructuredAssetImage]
                        : isStructuredAsset(asset)
                          ? asset.data.images.filter((image) => image.partId !== "avatar").map((image) => ({ ...image, id: `${asset.id}:${image.id}`, title: `${asset.title} · ${image.title}` }))
                          : [],
                )
                .filter((image) => image.title.toLowerCase().includes(pickerQuery.toLowerCase())),
        [assets, pickerQuery],
    );
    const addPicked = () => {
        if (!pickerPart) return;
        const target = pickerPart;
        const selected = pickerImages
            .filter((image) => picked.includes(image.id))
            .slice(0, target === "avatar" ? 1 : undefined)
            .map((image) => ({ ...image, id: nanoid(), partId: target, isCurrent: true }));
        change((current) => ({ ...current, images: [...current.images.filter((image) => target !== "avatar" || image.id !== current.avatarImageId), ...selected], ...(target === "avatar" && selected.length ? { avatarImageId: selected[0].id } : {}) }));
        setPickerPart(null);
    };
    const references: CanvasResourceReference[] = [
        ...draft.parts.map((part) => ({
            id: part.id,
            nodeId: part.id,
            kind: "text" as const,
            label: part.title,
            title: part.title,
            text: part.prompt,
            ready: true,
            active: part.enabled !== false && Boolean(part.prompt.trim() || draft.images.some((image) => image.partId === part.id && image.isCurrent !== false) || draft.audios?.some((audio) => audio.partId === part.id && audio.isCurrent !== false)),
            members: draft.images
                .filter((image) => image.partId === part.id && image.isCurrent !== false && image.id !== draft.avatarImageId)
                .map((image) => ({ id: image.id, nodeId: image.id, kind: "image" as const, label: image.title, title: image.title, previewUrl: image.dataUrl, ready: true, active: part.enabled !== false })),
        })),
        ...draft.images
            .filter((image) => image.id !== draft.avatarImageId && image.partId !== "avatar")
            .map((image, index) => ({
                id: image.id,
                nodeId: image.id,
                kind: "image" as const,
                label: `${t("图片")}${index + 1}`,
                title: image.title,
                previewUrl: image.dataUrl,
                ready: true,
                active: image.isCurrent !== false && draft.parts.find((part) => part.id === image.partId)?.enabled !== false,
            })),
        ...(draft.audios || []).map((audio) => ({
            id: audio.id,
            nodeId: audio.id,
            kind: "audio" as const,
            label: audio.title,
            title: audio.title,
            previewUrl: audio.url,
            ready: true,
            active: audio.isCurrent !== false && draft.parts.find((part) => part.id === audio.partId)?.enabled !== false,
        })),
        {
            id: "relationships",
            nodeId: "relationships",
            kind: "text",
            label: t(kind === "character" ? "人物关系" : "关联场景"),
            title: t(kind === "character" ? "人物关系" : "关联场景"),
            text: structuredAssetRelationshipText(draft),
            ready: true,
            active: Boolean(draft.relationships?.length),
        },
    ];
    const template = structuredAssetReferencePrompt(draft);
    const resolved = resolveStructuredAssetReferencePrompt(draft);
    const missingReferences = Array.from(resolved.matchAll(/@\[node:([^\]]+)\]/g)).filter((match) => !draft.images.some((image) => image.id === match[1]) && !draft.audios?.some((audio) => audio.id === match[1]));
    const assetList = (
        <>
            <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-sm font-medium">{t(`${label}库`)}</h2>
                <button className={quietButton} disabled={busy || !ready} onClick={() => void selectDraft()} aria-label={t(`新建${label}`)}>
                    <Plus className="size-4" />
                </button>
            </div>
            <div className="px-3 py-3">
                <Input aria-label={t(`搜索${label}`)} placeholder={t(`搜索${label}`)} prefix={<Search className="size-3.5" />} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {library.map((asset) => (
                    <button
                        key={asset.id}
                        disabled={busy || !ready}
                        onClick={() => void selectDraft(asset)}
                        className={cn("mb-1 flex w-full items-center gap-3 rounded-xl p-2 text-left", draft.assetId === asset.id ? "bg-[color:var(--wg-studio-accent-soft)]" : "hover:bg-[color:var(--wg-studio-raised)]")}
                    >
                        {asset.coverUrl ? (
                            <img src={asset.coverUrl} alt="" className="size-11 rounded-lg object-cover" />
                        ) : (
                            <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-[color:var(--wg-studio-line)]">
                                <UserRound className="size-5" />
                            </span>
                        )}
                        <span className="min-w-0">
                            <span className="block truncate text-sm">{asset.title}</span>
                            <span className="mt-1 block truncate text-xs text-[color:var(--wg-studio-muted)]">{asset.data.description}</span>
                        </span>
                    </button>
                ))}
                {!library.length && <p className="px-3 py-8 text-center text-xs text-[color:var(--wg-studio-muted)]">{t(`还没有${label}资产`)}</p>}
            </div>
        </>
    );

    return (
        <div className="wg-media-workbench" data-collection-workbench={kind}>
            <MediaWorkbenchHeader kind={kind} title={t(`${label}工作台`)} />
            <div className="flex min-h-0 flex-1">
                <aside className="hidden w-52 shrink-0 flex-col border-r border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-surface)] lg:flex">{assetList}</aside>
                <main className="flex min-w-0 flex-1 flex-col">
                    <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--wg-studio-line)] px-4 py-3 sm:px-6">
                        <button className={cn(quietButton, "lg:hidden")} onClick={() => setLibraryOpen(true)} aria-label={t(`打开${label}库`)}>
                            <FolderOpen className="size-4" />
                        </button>
                        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{draft.title || t(`新建${label}`)}</h2>
                        <span className="text-xs text-[color:var(--wg-studio-muted)]">{dirty ? t("未入库") : draft.assetId ? t("已入库") : t("草稿")}</span>
                        <button
                            className="rounded-lg bg-[color:var(--wg-home-accent)] px-4 py-2 text-sm font-medium text-[color:var(--wg-home-accent-text)] transition hover:opacity-90 disabled:opacity-50"
                            disabled={busy || !ready || !hydrated}
                            onClick={() => void save()}
                        >
                            {busy ? t("保存中…") : t(draft.assetId ? "保存更改" : "保存到资产库")}
                        </button>
                    </header>
                    {error && (
                        <div role="alert" className="flex items-center gap-3 border-b border-[color:var(--wg-studio-line)] px-6 py-3 text-sm">
                            {error}
                            <button
                                className={quietButton}
                                onClick={() => {
                                    setError("");
                                    if (!ready) setLoadAttempt((attempt) => attempt + 1);
                                    else void persistDraft(draftRef.current);
                                }}
                            >
                                {t("重试")}
                            </button>
                        </div>
                    )}
                    {!ready ? (
                        <div className="p-8 text-sm">{error ? t("草稿暂不可用") : t("正在读取资产…")}</div>
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                            <nav aria-label={t("素材分类")} className="flex shrink-0 gap-1 overflow-x-auto border-b border-[color:var(--wg-studio-line)] p-2 md:w-36 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
                                {[{ id: "intro", label: "简介" }, ...sections, { id: "reference", label: "引用提示词" }].map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => selectSection(item.id)}
                                        aria-current={draft.activeGroupId === item.id ? "page" : undefined}
                                        className={cn(
                                            "shrink-0 rounded-lg px-3 py-2.5 text-left text-sm",
                                            draft.activeGroupId === item.id ? "bg-[color:var(--wg-studio-accent-soft)] font-medium" : "text-[color:var(--wg-studio-muted)] hover:bg-[color:var(--wg-studio-raised)]",
                                        )}
                                    >
                                        {t(item.label)}
                                    </button>
                                ))}
                            </nav>
                            <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6" key={draft.activeGroupId}>
                                <div className="mx-auto max-w-4xl">
                                    {draft.activeGroupId === "intro" ? (
                                        <section className="max-w-2xl space-y-6">
                                            <div>
                                                <h3 className="text-lg font-medium">{t("简介")}</h3>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-5">
                                                <div className="grid size-24 place-items-center overflow-hidden rounded-2xl border border-[color:var(--wg-studio-line)]">
                                                    {avatar ? <img className="size-full object-cover" src={avatar.dataUrl} alt={t("头像")} /> : <UserRound className="size-8 text-[color:var(--wg-studio-muted)]" />}
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap gap-1">
                                                        <button className={quietButton} disabled={busy} onClick={() => chooseFiles("avatar")}>
                                                            <Upload className="size-3.5" />
                                                            {t(kind === "character" ? "上传头像" : "上传封面")}
                                                        </button>
                                                        <button className={quietButton} onClick={() => chooseLibrary("avatar")}>
                                                            {t("从资产库选择")}
                                                        </button>
                                                    </div>
                                                    {avatar && (
                                                        <button className={quietButton} onClick={() => change((current) => removeCollectionImage(current, avatar.id))}>
                                                            {t("移除")}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <label className="block space-y-2">
                                                <span className="text-sm">{t("名称")}</span>
                                                <input
                                                    aria-label={t("名称")}
                                                    className={fieldClass}
                                                    value={draft.title}
                                                    placeholder={t(kind === "character" ? "人物名字" : "场景名字")}
                                                    onChange={(event) => change((current) => ({ ...current, title: event.target.value }))}
                                                />
                                            </label>
                                            <label className="block space-y-2">
                                                <span className="text-sm">{t("简介")}</span>
                                                <textarea
                                                    aria-label={t("简介")}
                                                    className={fieldClass}
                                                    rows={3}
                                                    placeholder={t("一句话介绍，方便在库中查找")}
                                                    value={draft.description}
                                                    onChange={(event) => change((current) => ({ ...current, description: event.target.value }))}
                                                />
                                            </label>
                                        </section>
                                    ) : draft.activeGroupId === "reference" ? (
                                        <section className="space-y-5">
                                            <h3 className="text-lg font-medium">{t("引用提示词")}</h3>
                                            <p className="text-sm text-[color:var(--wg-studio-muted)]">{t("直接写下提示词，输入 @ 插入素材。")}</p>
                                            <CanvasPromptChipInput
                                                value={template}
                                                tokenMode
                                                references={references.map((reference) => ({ ...reference, text: reference.title }))}
                                                onChange={(value) => change((current) => ({ ...current, referencePrompt: value }))}
                                                placeholder={t("写下素材之间的联系，输入 @ 引用资料或图片")}
                                                className="min-h-52 rounded-xl border border-[color:var(--wg-studio-line)] p-3 text-sm leading-7"
                                            />
                                            {!!missingReferences.length && (
                                                <p role="alert" className="text-sm">
                                                    {t("有素材已移除，请调整引用提示词")}
                                                </p>
                                            )}
                                            <details className="rounded-xl border border-[color:var(--wg-studio-line)] p-4">
                                                <summary className="cursor-pointer text-sm">{t("查看完整引用")}</summary>
                                                <div className="mt-4">
                                                    <StructuredAssetReferencePreview prompt={resolved} images={draft.images} audios={draft.audios} />
                                                </div>
                                            </details>
                                        </section>
                                    ) : section ? (
                                        <section>
                                            <header className="mb-5 flex items-center justify-between gap-2">
                                                <h3 className="text-lg font-medium">{t(section.label)}</h3>
                                                <button
                                                    className={quietButton}
                                                    onClick={() =>
                                                        change((current) => ({
                                                            ...current,
                                                            parts: [
                                                                ...current.parts,
                                                                { id: nanoid(), groupId: section.id, title: t(section.selectable ? "新方案" : "新收集项"), description: "", expectedOutput: "", prompt: "", enabled: !section.selectable },
                                                            ],
                                                        }))
                                                    }
                                                >
                                                    <Plus className="size-4" />
                                                    {t(section.selectable ? "添加方案" : "添加收集项")}
                                                </button>
                                            </header>
                                            {section.id === "relationship" && (
                                                <StructuredAssetRelations kind={kind} assetId={draft.assetId} title={draft.title} avatarUrl={avatar?.dataUrl} relationships={draft.relationships || []} disabled={busy} onChange={saveRelationships} />
                                            )}
                                            <div className="space-y-5">
                                                {draft.parts
                                                    .filter((part) => part.groupId === section.id)
                                                    .map((part) => {
                                                        const images = draft.images.filter((image) => image.partId === part.id);
                                                        return (
                                                            <article
                                                                key={part.id}
                                                                className="rounded-xl border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-surface)] p-4"
                                                                onDragOver={(event) => {
                                                                    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                                                                }}
                                                                onDrop={(event) => {
                                                                    if (event.dataTransfer.files.length) {
                                                                        event.preventDefault();
                                                                        void addImages(event.dataTransfer.files, part.id);
                                                                    }
                                                                }}
                                                                onPaste={(event) => {
                                                                    if (event.clipboardData.files.length) {
                                                                        event.preventDefault();
                                                                        if (section.id === "voice") void addAudios(event.clipboardData.files, part.id);
                                                                        else void addImages(event.clipboardData.files, part.id);
                                                                    }
                                                                }}
                                                            >
                                                                <div className="mb-3 flex items-center gap-3">
                                                                    <input
                                                                        aria-label={t("收集项名称")}
                                                                        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                                                                        value={part.title}
                                                                        onChange={(event) => change((current) => ({ ...current, parts: current.parts.map((item) => (item.id === part.id ? { ...item, title: event.target.value } : item)) }))}
                                                                    />
                                                                    {section.selectable && (
                                                                        <label className="flex shrink-0 items-center gap-2 text-xs">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={part.enabled !== false}
                                                                                onChange={(event) => change((current) => ({ ...current, parts: current.parts.map((item) => (item.id === part.id ? { ...item, enabled: event.target.checked } : item)) }))}
                                                                            />
                                                                            {t(part.enabled !== false ? "已启用" : "启用")}
                                                                        </label>
                                                                    )}
                                                                    <button aria-label={t("移除收集项")} title={t("移除收集项")} className={quietButton} onClick={() => change((current) => removeCollectionPart(current, part.id))}>
                                                                        <X className="size-3.5" />
                                                                    </button>
                                                                </div>
                                                                <textarea
                                                                    aria-label={`${t(part.title)}${t("资料")}`}
                                                                    className={cn(fieldClass, "resize-y border-0 !px-0 !py-1")}
                                                                    rows={section.textOnly ? 7 : 2}
                                                                    value={part.prompt}
                                                                    placeholder={t(section.textOnly ? "粘贴或记录人物、场景的设定资料" : "添加文字说明")}
                                                                    onChange={(event) => change((current) => ({ ...current, parts: current.parts.map((item) => (item.id === part.id ? { ...item, prompt: event.target.value } : item)) }))}
                                                                />
                                                                {!!images.length && (
                                                                    <Image.PreviewGroup>
                                                                        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
                                                                            {images.map((image, index) => (
                                                                                <div key={image.id} className="min-w-0 overflow-hidden rounded-lg border border-[color:var(--wg-studio-line)]">
                                                                                    <div className="flex h-40 items-center justify-center overflow-hidden bg-[color:var(--wg-studio-raised)]">
                                                                                        <Image src={image.dataUrl} alt={image.title} className="!max-h-40 !object-contain" />
                                                                                    </div>
                                                                                    <div className="space-y-2 p-2">
                                                                                        <input
                                                                                            aria-label={t("图片名称")}
                                                                                            className="w-full bg-transparent text-xs outline-none"
                                                                                            value={image.title}
                                                                                            onChange={(event) =>
                                                                                                change((current) => ({ ...current, images: current.images.map((item) => (item.id === image.id ? { ...item, title: event.target.value } : item)) }))
                                                                                            }
                                                                                        />
                                                                                        <div className="flex items-center justify-between">
                                                                                            <label className="flex items-center gap-1.5 text-xs">
                                                                                                <input
                                                                                                    type="checkbox"
                                                                                                    checked={image.isCurrent !== false}
                                                                                                    onChange={(event) =>
                                                                                                        change((current) => ({
                                                                                                            ...current,
                                                                                                            images: current.images.map((item) => (item.id === image.id ? { ...item, isCurrent: event.target.checked } : item)),
                                                                                                        }))
                                                                                                    }
                                                                                                />
                                                                                                {t("选用")}
                                                                                            </label>
                                                                                            <div className="flex">
                                                                                                <button
                                                                                                    className="p-1 disabled:opacity-30"
                                                                                                    aria-label={t("前移图片")}
                                                                                                    disabled={index === 0}
                                                                                                    onClick={() => change((current) => ({ ...current, images: moveCollectionImage(current.images, image.id, -1) }))}
                                                                                                >
                                                                                                    <ArrowUp className="size-3.5" />
                                                                                                </button>
                                                                                                <button
                                                                                                    className="p-1 disabled:opacity-30"
                                                                                                    aria-label={t("后移图片")}
                                                                                                    disabled={index === images.length - 1}
                                                                                                    onClick={() => change((current) => ({ ...current, images: moveCollectionImage(current.images, image.id, 1) }))}
                                                                                                >
                                                                                                    <ArrowDown className="size-3.5" />
                                                                                                </button>
                                                                                                <button className="p-1" aria-label={t("移除图片")} onClick={() => change((current) => removeCollectionImage(current, image.id))}>
                                                                                                    <Trash2 className="size-3.5" />
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </Image.PreviewGroup>
                                                                )}
                                                                {(draft.audios || [])
                                                                    .filter((audio) => audio.partId === part.id)
                                                                    .map((audio) => (
                                                                        <div key={audio.id} className="mt-3 space-y-2 rounded-lg border border-[color:var(--wg-studio-line)] p-3">
                                                                            <input
                                                                                aria-label={t("音频名称")}
                                                                                className={fieldClass}
                                                                                value={audio.title}
                                                                                onChange={(event) => change((current) => ({ ...current, audios: current.audios?.map((item) => (item.id === audio.id ? { ...item, title: event.target.value } : item)) }))}
                                                                            />
                                                                            <audio controls preload="metadata" src={audio.url} aria-label={audio.title} className="w-full" />
                                                                            <div className="flex items-center justify-between">
                                                                                <label className="flex items-center gap-2 text-xs">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={audio.isCurrent !== false}
                                                                                        onChange={(event) =>
                                                                                            change((current) => ({ ...current, audios: current.audios?.map((item) => (item.id === audio.id ? { ...item, isCurrent: event.target.checked } : item)) }))
                                                                                        }
                                                                                    />
                                                                                    {t("选用")}
                                                                                </label>
                                                                                <button
                                                                                    className={quietButton}
                                                                                    aria-label={t("移除音频")}
                                                                                    onClick={() =>
                                                                                        change((current) => ({
                                                                                            ...current,
                                                                                            audios: current.audios?.filter((item) => item.id !== audio.id),
                                                                                            referencePrompt: current.referencePrompt?.split(`@[node:${audio.id}]`).join(""),
                                                                                        }))
                                                                                    }
                                                                                >
                                                                                    <Trash2 className="size-3.5" />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                {section.id === "voice" && (
                                                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--wg-studio-line)] pt-2">
                                                                        <button
                                                                            className={quietButton}
                                                                            disabled={busy}
                                                                            onClick={() => {
                                                                                uploadTarget.current = part.id;
                                                                                audioInput.current?.click();
                                                                            }}
                                                                        >
                                                                            <Upload className="size-3.5" />
                                                                            {t("添加音频")}
                                                                        </button>
                                                                        <select
                                                                            aria-label={t("选择音频资产")}
                                                                            value=""
                                                                            disabled={busy}
                                                                            className={cn(fieldClass, "!w-auto max-w-full")}
                                                                            onChange={(event) => {
                                                                                const audio = audioLibrary.find((item) => item.id === event.target.value);
                                                                                if (audio) change((current) => ({ ...current, audios: [...(current.audios || []), { ...audio, id: nanoid(), partId: part.id, isCurrent: true }] }));
                                                                            }}
                                                                        >
                                                                            <option value="">{t("从资产库选择")}</option>
                                                                            {audioLibrary.map((audio) => (
                                                                                <option key={audio.id} value={audio.id}>
                                                                                    {audio.title}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                )}
                                                                {section.id !== "voice" && (!section.textOnly || images.length > 0) && (
                                                                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[color:var(--wg-studio-line)] pt-2">
                                                                        <button className={quietButton} disabled={busy} onClick={() => chooseFiles(part.id)}>
                                                                            <ImagePlus className="size-3.5" />
                                                                            {t("添加图片")}
                                                                        </button>
                                                                        <button className={quietButton} disabled={busy} onClick={() => chooseLibrary(part.id)}>
                                                                            <FolderOpen className="size-3.5" />
                                                                            {t("从资产库选择")}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </article>
                                                        );
                                                    })}
                                            </div>
                                        </section>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
            <input
                type="file"
                accept="image/*"
                multiple
                hidden
                ref={fileInput}
                onChange={(event) => {
                    if (event.target.files?.length) void addImages(event.target.files, uploadTarget.current);
                    event.target.value = "";
                }}
            />
            <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
                multiple
                hidden
                ref={audioInput}
                onChange={(event) => {
                    if (event.target.files?.length) void addAudios(event.target.files, uploadTarget.current);
                    event.target.value = "";
                }}
            />
            <Modal open={libraryOpen} title={t(`${label}库`)} onCancel={() => setLibraryOpen(false)} footer={null}>
                <div className="flex max-h-[65vh] min-h-60 flex-col">{assetList}</div>
            </Modal>
            <Modal open={pickerPart !== null} title={t("选择图片")} onCancel={() => setPickerPart(null)} onOk={addPicked} okText={t("添加")} cancelText={t("取消")} okButtonProps={{ disabled: !picked.length }} width={720}>
                <Input placeholder={t("搜索图片")} value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} />
                <div className="mt-4 grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto">
                    {pickerImages.map((image) => (
                        <button
                            key={image.id}
                            className={cn("relative overflow-hidden rounded-lg border p-1 text-left", picked.includes(image.id) ? "border-current" : "border-transparent")}
                            onClick={() => setPicked((current) => (current.includes(image.id) ? current.filter((id) => id !== image.id) : pickerPart === "avatar" ? [image.id] : [...current, image.id]))}
                            aria-pressed={picked.includes(image.id)}
                        >
                            <img src={image.dataUrl} alt={image.title} className="h-28 w-full rounded object-contain" />
                            <span className="block truncate p-1 text-xs">{image.title}</span>
                            {picked.includes(image.id) && <Check className="absolute right-2 top-2 size-4" />}
                        </button>
                    ))}
                </div>
                {!pickerImages.length && <p className="p-6 text-center text-sm">{t("没有可选图片")}</p>}
            </Modal>
        </div>
    );
}
