import { assetFileCategory, classifyImportedFile, fileExtension } from "@/lib/asset-file";
import { discardUploadedAssetFile, publishUploadedAssetFile, uploadAssetFile } from "@/services/asset-file-storage";
import { discardUploadedMedia, publishUploadedMedia, uploadMediaFile } from "@/services/file-storage";
import { discardUploadedImage, publishUploadedImage, uploadImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";

type AssetDraft = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export type StagedAssetImport = {
    asset: AssetDraft;
    publish: () => void;
    discard: () => Promise<unknown>;
};

export async function stageAssetImport(file: File, source = "本地导入"): Promise<StagedAssetImport> {
    const kind = classifyImportedFile(file);
    const base = { title: file.name || "文件", coverUrl: "", tags: [], source };
    if (kind === "image") {
        const image = await uploadImage(file);
        return {
            asset: { ...base, kind, coverUrl: image.url, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } },
            publish: () => void publishUploadedImage(image),
            discard: () => discardUploadedImage(image),
        };
    }
    if (kind === "video" || kind === "audio") {
        const media = await uploadMediaFile(file, kind);
        return {
            asset:
                kind === "video"
                    ? { ...base, kind, data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } }
                    : { ...base, kind, data: { url: media.url, storageKey: media.storageKey, durationMs: media.durationMs, bytes: media.bytes, mimeType: media.mimeType } },
            publish: () => void publishUploadedMedia(media),
            discard: () => discardUploadedMedia(media),
        };
    }
    const stored = await uploadAssetFile(file, file.name);
    return {
        asset: {
            ...base,
            kind: "file",
            data: {
                storageKey: stored.storageKey,
                fileName: stored.fileName,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                extension: fileExtension(stored.fileName),
                category: assetFileCategory(stored.fileName, stored.mimeType),
            },
        },
        publish: () => void publishUploadedAssetFile(stored),
        discard: () => discardUploadedAssetFile(stored),
    };
}
