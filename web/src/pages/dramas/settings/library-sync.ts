import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { DramaArtifact, DramaEntity, EntityKind } from "@/lib/drama/types";
import { importMedia } from "@/lib/drama/media/runner";
import { adoptArtifact, createEntity } from "@/services/drama-api";
import { createStructuredAssetDraft, structuredAssetPayload } from "@/pages/image/structured-asset-collection";
import { useAssetStore, type StructuredAssetImage } from "@/stores/use-asset-store";

const textOf = (...parts: Array<string | undefined>) =>
    parts
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n\n");

/** Character and scene settings become structured assets with their sheet as the main picture; props and the world become a plain image or text asset. */
export async function saveToLibrary(entity: DramaEntity, sheet: DramaArtifact | undefined): Promise<void> {
    const store = useAssetStore.getState();
    const now = new Date().toISOString();
    const image = sheet && { dataUrl: sheet.mediaUrl, storageKey: sheet.mediaKey || undefined, width: sheet.width ?? 0, height: sheet.height ?? 0, bytes: 0, mimeType: sheet.mime || "image/png" };
    if (entity.kind === "character" || entity.kind === "scene") {
        const draft = createStructuredAssetDraft(entity.kind);
        const profile = entity.kind === "character" ? "identity-profile" : "scene-profile";
        const main = entity.kind === "character" ? "turnaround" : "master-wide";
        const images: StructuredAssetImage[] = image
            ? [
                  { id: `sheet-${sheet!.id}`, title: entity.name, partId: main, isCurrent: true, createdAt: now, ...image },
                  { id: `avatar-${sheet!.id}`, title: entity.name, partId: "avatar", createdAt: now, ...image },
              ]
            : [];
        await store.addAssetPersisted(
            structuredAssetPayload({
                ...draft,
                title: entity.name,
                tags: entity.aliases,
                description: entity.description,
                parts: draft.parts.map((part) => (part.id === profile ? { ...part, prompt: textOf(entity.description, entity.appearance && `外观：${entity.appearance}`) } : part)),
                images,
                avatarImageId: image ? `avatar-${sheet!.id}` : undefined,
            }),
        );
        return;
    }
    const base = { title: entity.name, tags: entity.aliases, source: "剧目", note: entity.description };
    await store.addAssetPersisted(image ? { kind: "image", coverUrl: image.dataUrl, ...base, data: image } : { kind: "text", coverUrl: "", ...base, data: { content: textOf(entity.description, entity.appearance) || entity.name } });
}

type Media = { storageKey: string; url: string; mime?: string } | File;
export type LibrarySetting = { kind: EntityKind; name: string; description: string; media?: Media };

async function mediaOf(image: { dataUrl: string; storageKey?: string; mimeType?: string } | undefined): Promise<Media | undefined> {
    if (!image) return undefined;
    if (image.storageKey) return { storageKey: image.storageKey, url: image.dataUrl, mime: image.mimeType };
    return image.dataUrl ? new File([await (await fetch(image.dataUrl)).blob()], "library.png", { type: image.mimeType || "image/png" }) : undefined;
}

/** Reads an asset library pick as a setting; null for kinds that cannot be one (video, audio, files). */
export async function settingFromAsset(payload: InsertAssetPayload): Promise<LibrarySetting | null> {
    if (payload.kind === "structured") {
        const image = payload.images.find((item) => item.id === payload.avatarImageId) ?? payload.images.find((item) => item.isCurrent) ?? payload.images[0];
        const profile = payload.parts?.find((part) => part.groupId === "overview" && part.prompt.trim());
        return { kind: payload.assetKind === "character" ? "character" : "scene", name: payload.title, description: textOf(payload.description, profile?.prompt) || "", media: await mediaOf(image) };
    }
    if (payload.kind === "image") return { kind: "prop", name: payload.title, description: "", media: await mediaOf(payload) };
    if (payload.kind === "text") return { kind: "world", name: payload.title, description: payload.content.slice(0, 4000) };
    return null;
}

/** Creates the setting and, when the asset has a picture, adopts it as the sheet. */
export async function importSetting(dramaId: string, setting: LibrarySetting): Promise<DramaEntity> {
    const entity = await createEntity(dramaId, { kind: setting.kind, name: setting.name.trim().slice(0, 60) || "未命名", description: setting.description });
    if (setting.media) {
        const sheet = await importMedia({ dramaId, owner: { entityId: entity.id }, kind: "sheet", source: setting.media });
        await adoptArtifact(sheet.id);
    }
    return entity;
}
