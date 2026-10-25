import type { ReactNode } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaEntity } from "@/lib/drama/types";

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
