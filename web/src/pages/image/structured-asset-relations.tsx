import { MapPin, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { useAssetStore, type StructuredAssetRelationship } from "@/stores/use-asset-store";

type Relationship = StructuredAssetRelationship;
type Props = {
    kind: "character" | "scene";
    assetId?: string;
    title: string;
    avatarUrl?: string;
    relationships: Relationship[];
    onChange: (relationships: Relationship[]) => void | Promise<boolean>;
    disabled?: boolean;
};

const fieldClass = "w-full rounded-lg border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-surface)] px-3 py-2 text-sm outline-none focus:border-[color:var(--wg-studio-accent-strong)]";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs hover:bg-[color:var(--wg-studio-raised)] disabled:cursor-not-allowed disabled:opacity-40";

export function StructuredAssetRelations({ kind, assetId, title, avatarUrl, relationships, onChange, disabled }: Props) {
    const assets = useAssetStore((state) => state.assets);
    const { language } = useAppTranslation();
    const label = (zh: string, en: string) => (language === "en-US" ? en : zh);
    const [editor, setEditor] = useState<{ id?: string; targetAssetId: string; label: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    useEffect(() => {
        setEditor(null);
        setSearch("");
    }, [kind, assetId]);
    const library = assets.filter((asset) => asset.kind === kind && asset.id !== assetId);
    const targets = library.filter((asset) => !relationships.some((relation) => relation.targetAssetId === asset.id) && asset.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const selectedTarget = editor ? library.find((asset) => asset.id === editor.targetAssetId) : undefined;
    const currentRelation = editor?.id ? relationships.find((relation) => relation.id === editor.id) : undefined;
    const canSave = Boolean(editor?.label.trim() && (currentRelation || selectedTarget));
    const graphHeight = Math.max(180, Math.ceil(relationships.length / 2) * 124 + 24);
    const Placeholder = kind === "character" ? UserRound : MapPin;
    const fallbackName = label(kind === "character" ? "未命名人物" : "未命名场景", kind === "character" ? "Untitled character" : "Untitled scene");
    const avatar = (url: string | undefined, name: string) => (
        <span className="mx-auto grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[color:var(--wg-studio-raised)]">
            {url ? <img src={url} alt={name} className="size-full object-cover" /> : <Placeholder className="size-5 text-[color:var(--wg-studio-muted)]" />}
        </span>
    );
    const closeEditor = () => {
        setEditor(null);
        setSearch("");
    };

    return (
        <section className="text-[color:var(--wg-studio-text)]" aria-label={label("关系", "Relationships")}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{label("关系", "Relationships")}</h3>
                <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled || saving}
                    onClick={() => {
                        setSearch("");
                        setEditor({ targetAssetId: "", label: "" });
                    }}
                >
                    <Plus className="size-3.5" />
                    {label("添加关系", "Add relationship")}
                </button>
            </div>
            <div className="relative mt-3" style={{ height: graphHeight }}>
                <svg viewBox={`0 0 100 ${graphHeight}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full text-[color:var(--wg-studio-line)]" aria-hidden="true">
                    {relationships.map((relation, index) => {
                        const targetX = index % 2 === 0 ? 14 : 86;
                        const targetY = 56 + Math.floor(index / 2) * 124;
                        return <path key={relation.id} d={`M 50 ${graphHeight / 2} L ${targetX} ${targetY}`} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />;
                    })}
                </svg>
                <div className="absolute left-[40%] top-1/2 w-[20%] -translate-y-1/2 rounded-xl border border-[color:var(--wg-studio-accent-strong)] bg-[color:var(--wg-studio-surface)] p-2 text-center">
                    {avatar(avatarUrl, title || fallbackName)}
                    <p className="mt-1.5 truncate text-xs font-medium" title={title || fallbackName}>
                        {title || fallbackName}
                    </p>
                </div>
                {relationships.map((relation, index) => {
                    const target = library.find((asset) => asset.id === relation.targetAssetId);
                    const name = target?.title || relation.targetName || fallbackName;
                    return (
                        <div key={relation.id}>
                            <span
                                data-relationship-edge={relation.id}
                                className="absolute z-10 max-w-[18%] -translate-x-1/2 -translate-y-1/2 rounded bg-[color:var(--wg-studio-surface)] px-1.5 py-1 text-center text-xs break-words"
                                style={{ left: index % 2 === 0 ? "32%" : "68%", top: (graphHeight / 2 + 56 + Math.floor(index / 2) * 124) / 2 }}
                            >
                                {relation.label}
                            </span>
                            <button
                                disabled={disabled || saving}
                                title={!target ? label("资产已移除", "Asset removed") : name}
                                type="button"
                                className="absolute w-[20%] rounded-xl border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-surface)] p-2 text-center hover:border-[color:var(--wg-studio-accent-strong)]"
                                style={{ top: 12 + Math.floor(index / 2) * 124, left: index % 2 === 0 ? "4%" : "76%" }}
                                onClick={() => setEditor({ id: relation.id, targetAssetId: relation.targetAssetId, label: relation.label })}
                                aria-label={`${label("编辑关系", "Edit relationship")} · ${name}`}
                            >
                                {avatar(target?.coverUrl, name)}
                                <span className="mt-1 block truncate text-xs font-medium" title={name}>
                                    {name}
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
            {editor && (
                <form
                    className="mt-3 space-y-3 rounded-xl border border-[color:var(--wg-studio-line)] p-3"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        if (!canSave || saving || disabled) return;
                        const next = currentRelation
                            ? relationships.map((relation) => (relation.id === currentRelation.id ? { ...relation, label: editor.label.trim(), targetName: selectedTarget?.title || relation.targetName } : relation))
                            : [...relationships, { id: nanoid(), targetAssetId: selectedTarget!.id, targetName: selectedTarget!.title, label: editor.label.trim() }];
                        setSaving(true);
                        try {
                            if ((await onChange(next)) !== false) closeEditor();
                        } finally {
                            setSaving(false);
                        }
                    }}
                >
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-medium">{editor.id ? label("编辑关系", "Edit relationship") : label(kind === "character" ? "选择人物" : "选择场景", kind === "character" ? "Choose a character" : "Choose a scene")}</h4>
                        <button type="button" className="rounded p-1 hover:bg-[color:var(--wg-studio-raised)]" aria-label={label("关闭关系编辑", "Close relationship editor")} onClick={closeEditor}>
                            <X className="size-4" />
                        </button>
                    </div>
                    {!editor.id && (
                        <>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[color:var(--wg-studio-muted)]" />
                                <input
                                    className={`${fieldClass} pl-9`}
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder={label(kind === "character" ? "搜索人物库" : "搜索场景库", kind === "character" ? "Search characters" : "Search scenes")}
                                    aria-label={label(kind === "character" ? "搜索人物库" : "搜索场景库", kind === "character" ? "Search characters" : "Search scenes")}
                                />
                            </div>
                            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                                {targets.map((target) => (
                                    <button
                                        key={target.id}
                                        type="button"
                                        aria-pressed={editor.targetAssetId === target.id}
                                        className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 text-left text-xs ${editor.targetAssetId === target.id ? "border-[color:var(--wg-studio-accent-strong)] bg-[color:var(--wg-studio-accent-soft)]" : "border-[color:var(--wg-studio-line)] hover:bg-[color:var(--wg-studio-raised)]"}`}
                                        onClick={() => setEditor({ ...editor, targetAssetId: target.id })}
                                    >
                                        {avatar(target.coverUrl, target.title)}
                                        <span className="min-w-0 flex-1 truncate">{target.title || fallbackName}</span>
                                    </button>
                                ))}
                            </div>
                            {!targets.length && (
                                <p className="py-2 text-xs text-[color:var(--wg-studio-muted)]">
                                    {search.trim()
                                        ? label("没有找到匹配项", "No matches found")
                                        : label(kind === "character" ? "人物库里暂无其他可添加的人物" : "场景库里暂无其他可添加的场景", kind === "character" ? "No other characters to add" : "No other scenes to add")}
                                </p>
                            )}
                        </>
                    )}
                    {(editor.id || selectedTarget) && (
                        <p className="text-xs font-medium">
                            {currentRelation?.sourceAssetId === currentRelation?.targetAssetId && currentRelation
                                ? `${currentRelation.sourceName || selectedTarget?.title} → ${title || fallbackName}`
                                : `${title || fallbackName} → ${selectedTarget?.title || currentRelation?.targetName || fallbackName}`}
                        </p>
                    )}
                    <label className="block space-y-1.5 text-xs">
                        <span>{label("关系名称", "Relationship")}</span>
                        <input
                            className={fieldClass}
                            disabled={disabled || saving}
                            value={editor.label}
                            onChange={(event) => setEditor({ ...editor, label: event.target.value })}
                            placeholder={label(kind === "character" ? "如：朋友、家人、同事" : "如：相邻、位于室内、通往", kind === "character" ? "e.g. friend, family, colleague" : "e.g. adjacent, inside, leads to")}
                        />
                    </label>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                        {currentRelation && (
                            <button
                                type="button"
                                className={`${buttonClass} mr-auto`}
                                disabled={saving || disabled}
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        if ((await onChange(relationships.filter((relation) => relation.id !== currentRelation.id))) !== false) closeEditor();
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                            >
                                <Trash2 className="size-3.5" />
                                {label("移除关系", "Remove relationship")}
                            </button>
                        )}
                        <button type="button" className={buttonClass} onClick={closeEditor}>
                            {label("取消", "Cancel")}
                        </button>
                        <button type="submit" className={`${buttonClass} text-[color:var(--wg-studio-accent-strong)]`} disabled={!canSave || saving || disabled}>
                            {label("保存关系", "Save relationship")}
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}
