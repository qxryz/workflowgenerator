import { useCallback, useState } from "react";

import { useRefresh } from "@/pages/dramas/settings/common";
import { updateDrama } from "@/services/drama-api";
import type { DramaProject } from "@/lib/drama/types";
import { useGuard } from "@/pages/dramas/settings/common";

/** Saves or clears the project's style / palette. The drama's own rev guards the write. */
export function useAdopt(project: DramaProject) {
    const guard = useGuard(project.id);
    const refresh = useRefresh(project.id);
    const [busy, setBusy] = useState(false);
    const run = useCallback(
        async (patch: { style: DramaProject["style"] } | { palette: DramaProject["palette"] }) => {
            setBusy(true);
            const ok = await guard(() => updateDrama(project.id, { rev: project.rev, ...patch }));
            if (ok) await refresh();
            setBusy(false);
            return ok;
        },
        [guard, project.id, project.rev, refresh],
    );
    return { busy, adoptStyle: (style: DramaProject["style"]) => run({ style }), adoptPalette: (palette: DramaProject["palette"]) => run({ palette }) };
}
