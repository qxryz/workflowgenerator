import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type MentionState = {
    start: number;
    query: string;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, ...props }, forwardedRef) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const changeTimerRef = useRef<number | null>(null);
    const onChangeRef = useRef(onChange);
    const draftRef = useRef(value);
    const lastCommittedRef = useRef(value);
    const [draft, setDraft] = useState(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasSelection, setHasSelection] = useState(false);
    onChangeRef.current = onChange;
    useEffect(() => {
        if (document.activeElement === textareaRef.current || value === draftRef.current) return;
        draftRef.current = value;
        lastCommittedRef.current = value;
        setDraft(value);
    }, [value]);
    useEffect(
        () => () => {
            if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
            if (draftRef.current !== lastCommittedRef.current) onChangeRef.current(draftRef.current);
        },
        [],
    );
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const activeReferences = references.filter((item) => item.active);
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);
    const activeLabels = useMemo(() => (highlightLabels ? Array.from(new Set(references.filter((item) => item.active).map((item) => item.label))).sort((a, b) => b.length - a.length) : []), [highlightLabels, references]);

    const updateValue = (next: string, selectionStart?: number, immediate = false) => {
        draftRef.current = next;
        setDraft(next);
        if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
        if (immediate) {
            changeTimerRef.current = null;
            lastCommittedRef.current = next;
            onChangeRef.current(next);
        } else {
            changeTimerRef.current = window.setTimeout(() => {
                changeTimerRef.current = null;
                lastCommittedRef.current = draftRef.current;
                onChangeRef.current(draftRef.current);
            }, 140);
        }
        if (typeof selectionStart !== "number") return;
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const prefix = nextValue.slice(0, cursor);
        const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
        if (!match || !references.some((item) => item.active)) {
            closeMention();
            return;
        }
        setMention({ start: cursor - match[2].length - 1, query: match[2] });
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const textarea = textareaRef.current;
        const end = textarea?.selectionStart ?? draft.length;
        const insertText = `${reference.label} `;
        const next = `${draft.slice(0, mention.start)}${insertText}${draft.slice(end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const syncOverlayScroll = () => {
        if (!overlayRef.current || !textareaRef.current) return;
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    };

    const updateSelectionState = () => {
        const textarea = textareaRef.current;
        setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
    };

    const showOverlay = Boolean(activeLabels.length && !hasSelection);
    const mergedStyle = {
        ...(style || {}),
        color: showOverlay ? "transparent" : style?.color,
        caretColor: style?.color || theme.node.text,
        cursor: "text",
        // showOverlay 时高亮 div 覆盖在 textarea 上,若不把 textarea 提到上层,原生插入光标(caret)会被盖住看不见
        ...(showOverlay ? { position: "relative", zIndex: 1, background: "transparent", backgroundColor: "transparent" } : {}),
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu textarea={textareaRef.current} caretIndex={mention.start} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full ${containerClassName || ""}`}>
            {showOverlay ? (
                <div ref={overlayRef} className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`} style={{ ...style, color: theme.node.text }}>
                    <MentionHighlightText value={draft || props.placeholder?.toString() || ""} labels={activeLabels} placeholder={!draft} />
                </div>
            ) : null}
            <textarea
                {...props}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={draft}
                className={className}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    updateValue(next);
                    syncMention(next, event.target.selectionStart);
                    requestAnimationFrame(() => {
                        syncOverlayScroll();
                        updateSelectionState();
                    });
                }}
                onSelect={(event) => {
                    updateSelectionState();
                    props.onSelect?.(event);
                }}
                onKeyUp={(event) => {
                    updateSelectionState();
                    props.onKeyUp?.(event);
                }}
                onPointerUp={(event) => {
                    updateSelectionState();
                    props.onPointerUp?.(event);
                }}
                onKeyDown={(event) => {
                    if (isImeComposing(event)) {
                        onKeyDown?.(event);
                        return;
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && !mention) {
                        const el = textareaRef.current;
                        if (el && el.selectionStart === el.selectionEnd) {
                            const result = deleteAdjacentLabel(draft, el.selectionStart, event.key === "Backspace" ? "backward" : "forward", activeLabels);
                            if (result) {
                                event.preventDefault();
                                updateValue(result.value, result.caret);
                                requestAnimationFrame(updateSelectionState);
                                return;
                            }
                        }
                    }
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
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        updateValue(draftRef.current, undefined, true);
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    syncOverlayScroll();
                    props.onScroll?.(event);
                }}
                onBlur={(event) => {
                    setHasSelection(false);
                    updateValue(draftRef.current, undefined, true);
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
});

function MentionHighlightText({ value, labels, placeholder }: { value: string; labels: string[]; placeholder: boolean }) {
    if (placeholder) return <span className="opacity-45">{value}</span>;
    if (!labels.length) return <>{value}</>;
    const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
    return (
        <>
            {value.split(pattern).map((part, index) =>
                labels.includes(part) ? (
                    <span key={`${part}-${index}`} className="rounded-md bg-[#2f80ff]/16 px-1 py-0.5 font-medium text-[#2f80ff] ring-1 ring-[#2f80ff]/24">
                        {part}
                    </span>
                ) : (
                    <span key={`${part}-${index}`}>{part}</span>
                ),
            )}
        </>
    );
}

function MentionMenu({ textarea, caretIndex, references, activeIndex, theme, onSelect }: { textarea: HTMLTextAreaElement; caretIndex: number; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const rect = textarea.getBoundingClientRect();
    const boundary = textarea.closest(".ant-modal-content")?.getBoundingClientRect() || { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    // 菜单锚定到 @ 所在的光标像素位置(而非 textarea 底边),避免输入框较高时菜单离 @ 太远。
    // 画布可能被缩放,rect 是缩放后坐标,而镜像测量得到的是布局坐标,需按 scale 换算。
    const scale = textarea.offsetWidth ? rect.width / textarea.offsetWidth : 1;
    const computed = window.getComputedStyle(textarea);
    const lineHeight = (parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 20) * scale;
    const caret = getCaretPoint(textarea, caretIndex);
    const caretLeft = rect.left + (caret.left - textarea.scrollLeft) * scale;
    const caretTop = rect.top + (caret.top - textarea.scrollTop) * scale;
    const left = clamp(caretLeft, boundary.left + 8, boundary.right - menuWidth - 8);
    const showAbove = caretTop + lineHeight + gap + maxMenuHeight > boundary.bottom && caretTop - gap - maxMenuHeight >= boundary.top;
    const top = clamp(showAbove ? caretTop - gap - maxMenuHeight : caretTop + lineHeight + gap, boundary.top + 8, boundary.bottom - maxMenuHeight - 8);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

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
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

// 通过镜像 div 复刻 textarea 的排版,测出第 index 个字符处光标相对 textarea 的像素坐标(布局尺度,未含缩放)。
const MIRROR_STYLE_PROPS = ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "textTransform"] as const;

function getCaretPoint(textarea: HTMLTextAreaElement, index: number) {
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const style = mirror.style;
    style.position = "absolute";
    style.top = "0";
    style.left = "-9999px";
    style.visibility = "hidden";
    style.whiteSpace = "pre-wrap";
    style.overflowWrap = "break-word";
    for (const prop of MIRROR_STYLE_PROPS) style[prop] = computed[prop];
    mirror.textContent = textarea.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = textarea.value.slice(index) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const point = { left: marker.offsetLeft, top: marker.offsetTop };
    document.body.removeChild(mirror);
    return point;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 纯 textarea 无法做真正的原子 token,这里在删除时把整个引用 label 当作一个整体一次删掉,
// 避免逐字删除把「图片1」删成「图片」。labels 需按长度降序传入以优先匹配更长的 label。
function deleteAdjacentLabel(value: string, caret: number, direction: "backward" | "forward", labels: string[]): { value: string; caret: number } | null {
    if (direction === "backward") {
        const before = value.slice(0, caret);
        for (const label of labels) {
            if (!label) continue;
            const match = new RegExp(`(^|\\s)(${escapeRegExp(label)})\\s*$`).exec(before);
            if (match) {
                const start = match.index + match[1].length; // label 起始位置(保留前面的分隔空格)
                return { value: value.slice(0, start) + value.slice(caret), caret: start };
            }
        }
    } else {
        // 向后删除:光标前须是行首或空白,避免切进其它文字中间
        if (caret > 0 && !/\s/.test(value[caret - 1])) return null;
        const after = value.slice(caret);
        for (const label of labels) {
            if (!label) continue;
            const match = new RegExp(`^(\\s*)(${escapeRegExp(label)})(?=\\s|$)`).exec(after);
            if (match) {
                return { value: value.slice(0, caret) + value.slice(caret + match[0].length), caret };
            }
        }
    }
    return null;
}
