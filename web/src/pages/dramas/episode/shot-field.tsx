import type { ReactNode } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaEntity, DramaShot } from "@/lib/drama/types";

/** The part of a shot the editor changes. */
export type ShotDraft = Pick<DramaShot, "seconds" | "size" | "camera" | "description" | "dialogue" | "narration" | "entityIds" | "transition" | "startState" | "endState" | "props" | "imagePrompt" | "videoPrompt">;

export const toDraft = (shot: DramaShot): ShotDraft => ({
    seconds: shot.seconds, size: shot.size, camera: shot.camera, description: shot.description, dialogue: shot.dialogue, narration: shot.narration, entityIds: shot.entityIds,
    transition: shot.transition, startState: shot.startState, endState: shot.endState, props: shot.props, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt,
});

export const sameDraft = (a: ShotDraft, b: ShotDraft) => JSON.stringify(a) === JSON.stringify(b);

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
    const { t } = useAppTranslation();
    return (
        <div className={className}>
            <label className="mb-1 flex items-baseline gap-2 text-[12px] text-[color:var(--wg-home-muted)]">
                <span>{t(label)}</span>
                {hint ? <span className="text-[11px] text-[color:var(--wg-home-muted-strong)]">{t(hint)}</span> : null}
            </label>
            {children}
        </div>
    );
}

export const entityOptions = (entities: readonly DramaEntity[], kinds: DramaEntity["kind"][]) => entities.filter((entity) => kinds.includes(entity.kind)).map((entity) => ({ value: entity.id, label: entity.name }));
