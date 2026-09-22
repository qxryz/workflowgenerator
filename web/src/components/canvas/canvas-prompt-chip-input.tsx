import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasReferenceCaption, canvasReferenceLookup, missingCanvasReference } from "./canvas-prompt-references";

type Props = {
    value: string;
    tokenMode?: boolean;
    expandReferences?: boolean;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
};

type MentionState = {
    query: string;
    rect: DOMRect | null;
};

type Token = { type: "text"; value: string } | { type: "reference"; label: string; nodeId?: string };

// 画布引用持久化节点 ID；普通媒体工作台继续使用图片1等供应商编号。
export function CanvasPromptChipInput({ value, tokenMode = false, expandReferences = false, references, onChange, onSubmit, className, style, placeholder }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    // 记录我们最近一次向父级 emit 的 value。聚焦时若 value 与它一致,说明是本组件输入的回声,
    // 跳过重建以免打断光标 / IME;若不一致(如发送后父级把 prompt 清空、或从提示词库插入),即使聚焦也要重建。
    const lastEmittedRef = useRef(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const referenceById = useMemo(() => canvasReferenceLookup(references), [references]);
    const referenceByLabel = useMemo(() => new Map(activeReferences.map((item) => [item.label, item])), [activeReferences]);
    // 长 label 优先匹配,避免「图片1」把「图片10」切坏。
    const activeLabels = useMemo(() => Array.from(new Set(activeReferences.map((item) => item.label))).sort((a, b) => b.length - a.length), [activeReferences]);
    const tokens = useMemo(() => parseTokens(value, activeLabels, tokenMode), [value, activeLabels, tokenMode]);

    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, activeReferences]);

    const refreshReferenceChips = () => {
        const editor = editorRef.current;
        if (!editor || composingRef.current) return;
        // Keep each atomic wrapper and all editable text nodes in place so browser selection survives.
        editor.querySelectorAll<HTMLElement>("[data-ref-label]").forEach((element) => {
            const id = element.dataset.referenceNodeId;
            const reference = id ? referenceById.get(id) || missingCanvasReference(id) : referenceByLabel.get(element.dataset.refLabel || "");
            if (reference) renderReferenceChip(element, reference, theme, setImagePreview, tokenMode, expandReferences);
        });
    };

    // DOM ← value:未聚焦时按 value 重建;聚焦时仅当 value 是外部改动(非本组件回声)才重建。
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (composingRef.current) return;
        if (document.activeElement === editor && value === lastEmittedRef.current) {
            refreshReferenceChips();
            return;
        }
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const reference = token.nodeId ? referenceById.get(token.nodeId) || missingCanvasReference(token.nodeId) : referenceByLabel.get(token.label);
            if (reference) editor.append(createReferenceChip(reference, theme, setImagePreview, tokenMode, expandReferences));
            else editor.append(document.createTextNode(token.label));
        });
        lastEmittedRef.current = value;
    }, [tokens, referenceByLabel, referenceById, theme, value, tokenMode, expandReferences]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        emit(serializeEditor(editor));
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !activeReferences.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "", rect: caretRect() });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention();
        const chip = createReferenceChip(reference, theme, setImagePreview, tokenMode, expandReferences);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const candidateRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const range = candidateRange && (candidateRange.commonAncestorContainer === editor || editor.contains(candidateRange.commonAncestorContainer)) ? candidateRange : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeEditor(editor));
    };

    const showPlaceholder = !value.trim();

    return (
        <div className="relative w-full">
            {showPlaceholder && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm leading-5" style={{ color: theme.node.placeholder }}>
                    {placeholder}
                </div>
            ) : null}
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
                style={{ ...style, cursor: "text" }}
                onInput={() => {
                    if (!composingRef.current) syncFromEditor();
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncFromEditor();
                    refreshReferenceChips();
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    if (isImeComposing(event)) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                        event.preventDefault();
                        requestAnimationFrame(syncFromEditor);
                        return;
                    }
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onBlur={() => window.setTimeout(closeMention, 120)}
            />
            {mention && candidates.length ? <MentionMenu expandReferences={expandReferences} rect={mention.rect} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
            {imagePreview ? <Image src={imagePreview} alt="引用图片预览" style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} /> : null}
        </div>
    );
}

function MentionMenu({
    rect,
    expandReferences,
    references,
    activeIndex,
    theme,
    onSelect,
}: {
    rect: DOMRect | null;
    expandReferences: boolean;
    references: CanvasResourceReference[];
    activeIndex: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, references]);

    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    const anchor = rect || new DOMRect(16, 16, 0, 0);
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const showAbove = anchor.bottom + gap + maxMenuHeight > window.innerHeight && anchor.top - gap - maxMenuHeight >= 0;
    const top = showAbove ? anchor.top - gap - maxMenuHeight : anchor.bottom + gap;

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} expandReferences={expandReferences} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{expandReferences ? reference.title || reference.label : reference.label}</span>
                        <span className="block truncate opacity-65">{reference.bindingKind ? `${reference.title} · ${reference.members?.length || 0} 项素材` : reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference, expandReferences }: { reference: CanvasResourceReference; expandReferences: boolean }) {
    const images = expandReferences ? reference.members?.filter((member) => member.kind === "image" && member.previewUrl) || [] : [];
    if (images.length)
        return (
            <span className="flex w-20 shrink-0 flex-wrap gap-0.5">
                {images.slice(0, 4).map((image) => (
                    <img key={image.nodeId} src={image.previewUrl} alt={image.title} className="size-9 rounded object-cover" />
                ))}
                {images.length > 4 ? <span className="text-[10px] opacity-65">+{images.length - 4}</span> : null}
            </span>
        );
    if ((reference.kind === "image" || reference.bindingKind) && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(reference: CanvasResourceReference, theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void, tokenMode = false, expandReferences = false) {
    const wrapper = document.createElement("span");
    renderReferenceChip(wrapper, reference, theme, onImagePreview, tokenMode, expandReferences);
    return wrapper;
}

function renderReferenceChip(wrapper: HTMLElement, reference: CanvasResourceReference, theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void, tokenMode: boolean, expandReferences: boolean) {
    wrapper.textContent = "";
    wrapper.style.cssText = "";
    wrapper.title = "";
    wrapper.contentEditable = "false";
    wrapper.dataset.refLabel = reference.label;
    delete wrapper.dataset.referenceNodeId;
    delete wrapper.dataset.referenceMissing;
    if (tokenMode) wrapper.dataset.referenceNodeId = reference.nodeId;
    if (!reference.active) wrapper.dataset.referenceMissing = "true";
    const appendImage = (parent: HTMLElement, imageReference: CanvasResourceReference, expanded: boolean) => {
        const image = document.createElement("img");
        image.src = imageReference.previewUrl || "";
        image.alt = imageReference.title;
        image.className = expanded ? "h-20 w-auto max-w-full cursor-zoom-in rounded object-contain" : "size-6 cursor-zoom-in rounded object-cover";
        image.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(imageReference.previewUrl || "");
        });
        // Previewing a chip must not move the insertion caret out of the surrounding prose.
        image.addEventListener("mousedown", (event) => event.preventDefault());
        parent.appendChild(image);
    };
    if (expandReferences && reference.active) {
        wrapper.className = "mx-1 my-1 inline-flex max-w-full flex-col gap-2 rounded-lg border p-2 align-middle";
        Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } as CSSProperties);
        const caption = document.createElement("span");
        caption.className = "text-xs font-medium";
        caption.textContent = reference.bindingKind ? canvasReferenceCaption(reference) : reference.title || reference.label;
        wrapper.appendChild(caption);
        if (reference.text?.trim() && reference.text.trim() !== reference.title.trim()) {
            const text = document.createElement("span");
            text.className = "whitespace-pre-wrap text-sm leading-relaxed";
            text.textContent = reference.text;
            wrapper.appendChild(text);
        }
        const images = reference.members?.filter((member) => member.kind === "image" && member.previewUrl) || [];
        if (reference.kind === "image" && reference.previewUrl && !images.length) images.push(reference);
        if (images.length) {
            const gallery = document.createElement("span");
            gallery.className = "flex max-w-full flex-wrap gap-1.5";
            images.forEach((image) => appendImage(gallery, image, true));
            wrapper.appendChild(gallery);
        }
    } else if (reference.kind === "image" && reference.previewUrl) {
        wrapper.className = "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
        appendImage(wrapper, reference, false);
    } else {
        wrapper.className = "mx-px inline-flex h-6 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
        Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } as CSSProperties);
        wrapper.title = reference.bindingKind ? reference.title : reference.text || reference.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = reference.active ? canvasReferenceCaption(reference) : reference.label;
        wrapper.appendChild(text);
    }
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/﻿/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const label = node.dataset.refLabel;
        if (node.dataset.referenceNodeId) result += `@[node:${node.dataset.referenceNodeId}]`;
        else if (label) result += label;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

// chip 是 contentEditable="false" 的原子块,光标紧邻它按 Backspace/Delete 时整块删除。
function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.refLabel ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height || rect.left || rect.top) return rect;
    // 空行/空编辑器时 range 无尺寸,退回到编辑器盒子。
    const editor = closestEditor(range.startContainer);
    return editor ? editor.getBoundingClientRect() : null;
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

// 按 active label(已按长度降序)把 value 文本切成「文本片段 + 命中的引用 label」。
function parseTokens(value: string, labels: string[], tokenMode = false): Token[] {
    if (!tokenMode && !labels.length) return value ? [{ type: "text", value }] : [];
    const escaped = labels.map(escapeRegExp).join("|");
    const pattern = tokenMode ? /@\[node:([^\]]+)\]/g : new RegExp(`(${escaped})`, "g");
    const tokens: Token[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "reference", label: match[0], ...(tokenMode ? { nodeId: match[1] } : {}) });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
