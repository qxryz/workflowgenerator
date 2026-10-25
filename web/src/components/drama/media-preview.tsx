/**
 * MediaPreview — lightbox for an image, video or audio artifact.
 *
 * Props: `MediaPreview({ target, onClose })`
 *   target: { kind: "sheet" | "image" | "video" | "audio"; url: string; title?: string } | null   (null = closed)
 * Images use antd's zoomable preview; video and audio open in a plain modal player.
 */
import { Image, Modal } from "antd";

import type { ArtifactKind } from "@/lib/drama/types";

export type PreviewTarget = { kind: ArtifactKind; url: string; title?: string };

export function MediaPreview({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
    if (!target) return null;
    if (target.kind === "sheet" || target.kind === "image") {
        return <Image src={target.url} alt={target.title ?? ""} style={{ display: "none" }} preview={{ open: true, src: target.url, onOpenChange: (open) => !open && onClose() }} />;
    }
    return (
        <Modal open title={target.title} footer={null} onCancel={onClose} destroyOnHidden centered width={target.kind === "video" ? 880 : 480}>
            {target.kind === "video" ? (
                <video src={target.url} controls autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
            ) : (
                <audio src={target.url} controls autoPlay className="w-full" />
            )}
        </Modal>
    );
}
