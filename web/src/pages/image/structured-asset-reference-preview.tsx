import { Image } from "antd";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { StructuredAssetAudio, StructuredAssetImage } from "@/stores/use-asset-store";

type Props = {
    prompt: string;
    images: StructuredAssetImage[];
    audios?: StructuredAssetAudio[];
};

type Segment = { type: "text"; value: string } | { type: "reference"; id: string };

export function StructuredAssetReferencePreview({ prompt, images, audios = [] }: Props) {
    const { t } = useAppTranslation();
    const imageById = new Map(images.map((image) => [image.id, image]));
    const audioById = new Map(audios.map((audio) => [audio.id, audio]));
    const segments: Segment[] = [];
    let cursor = 0;
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        const index = match.index;
        if (index > cursor) segments.push({ type: "text", value: prompt.slice(cursor, index) });
        segments.push({ type: "reference", id: match[1] });
        cursor = index + match[0].length;
    }
    if (cursor < prompt.length) segments.push({ type: "text", value: prompt.slice(cursor) });

    return (
        <div className="flex min-w-0 flex-col items-start gap-3 text-sm leading-relaxed">
            {segments.map((segment, index) => {
                if (segment.type === "text")
                    return (
                        <span key={index} className="max-w-full whitespace-pre-wrap break-words">
                            {segment.value}
                        </span>
                    );
                const image = imageById.get(segment.id);
                if (image?.dataUrl) return <Image key={index} src={image.dataUrl} alt={image.title} preview styles={{ root: { maxWidth: "100%" } }} style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 8 }} />;
                const audio = audioById.get(segment.id);
                if (audio?.url)
                    return (
                        <figure key={index} className="m-0 w-full max-w-md space-y-1.5">
                            <figcaption className="text-xs opacity-65">{audio.title}</figcaption>
                            <audio src={audio.url} aria-label={audio.title} controls preload="metadata" className="w-full" />
                        </figure>
                    );
                return (
                    <span key={index} className="rounded border border-dashed px-2 py-1 text-xs opacity-65">
                        {t("引用已失效")}
                    </span>
                );
            })}
        </div>
    );
}
