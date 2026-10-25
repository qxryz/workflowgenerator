import { FolderOpen, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { useAppTranslation } from "@/hooks/use-app-translation";
import type { ArtifactKind } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import type { AssetKind } from "@/stores/use-asset-store";

const ACCEPT: Record<ArtifactKind, string> = { sheet: "image/*", image: "image/*", video: "video/*", audio: "audio/*" };
const HINT: Record<ArtifactKind, string> = { sheet: "拖入或点击选择图片", image: "拖入或点击选择图片", video: "拖入或点击选择视频", audio: "拖入或点击选择音频" };

/** Drop zone / file input. */
export function UploadZone({ kind, busy, onFiles }: { kind: ArtifactKind; busy: boolean; onFiles: (files: File[]) => void }) {
    const { t } = useAppTranslation();
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    return (
        <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
                event.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
                event.preventDefault();
                setOver(false);
                onFiles(Array.from(event.dataTransfer.files));
            }}
            className={cn(
                "flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-xs text-[color:var(--wg-home-muted)] transition disabled:opacity-40",
                over ? "border-[color:var(--wg-home-text)] bg-[color:var(--wg-home-hover)]" : "border-[color:var(--wg-home-line-strong)] hover:bg-[color:var(--wg-home-hover)]",
            )}
        >
            <Upload className="size-5" strokeWidth={1.6} />
            {t(HINT[kind])}
            <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={ACCEPT[kind]}
                onChange={(event) => {
                    onFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                }}
            />
        </button>
    );
}

/** What the library gave us, reduced to what an artifact needs: a stored file, or bytes to upload. */
export type LibraryPick = { storageKey: string; url: string; mime?: string } | File;

async function pickFrom(payload: InsertAssetPayload, kind: ArtifactKind): Promise<LibraryPick | null> {
    const image = payload.kind === "image" ? payload : payload.kind === "structured" ? payload.images.find((item) => item.id === payload.avatarImageId) ?? payload.images[0] : undefined;
    if (image) {
        const dataUrl = "dataUrl" in image ? image.dataUrl : "";
        if (image.storageKey) return { storageKey: image.storageKey, url: dataUrl, mime: image.mimeType };
        return dataUrl ? new File([await (await fetch(dataUrl)).blob()], "library.png", { type: image.mimeType || "image/png" }) : null;
    }
    if ((payload.kind === "video" || payload.kind === "audio") && payload.kind === kind && payload.storageKey) return { storageKey: payload.storageKey, url: payload.url, mime: payload.mimeType };
    return null;
}

/** Opens the app's asset library, filtered to what this kind can use. */
export function LibraryPicker({ kind, busy, onPick }: { kind: ArtifactKind; busy: boolean; onPick: (pick: LibraryPick) => void }) {
    const { t } = useAppTranslation();
    const [open, setOpen] = useState(false);
    const accepted: AssetKind[] = kind === "video" ? ["video"] : kind === "audio" ? ["audio"] : ["image", "character", "scene"];
    return (
        <>
            <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(true)}
                className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[color:var(--wg-home-line-strong)] text-xs text-[color:var(--wg-home-muted)] transition hover:bg-[color:var(--wg-home-hover)] disabled:opacity-40"
            >
                <FolderOpen className="size-5" strokeWidth={1.6} />
                {t("从资产库选择")}
            </button>
            <AssetPickerModal
                open={open}
                acceptedKinds={accepted}
                onClose={() => setOpen(false)}
                onInsert={(payload) => {
                    setOpen(false);
                    void pickFrom(payload, kind).then((pick) => pick && onPick(pick));
                }}
            />
        </>
    );
}
