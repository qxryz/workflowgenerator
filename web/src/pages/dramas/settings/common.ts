import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { Globe, MapPin, Package, User, type LucideIcon } from "lucide-react";
import { useCallback } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey } from "@/hooks/use-drama";
import type { EntityKind } from "@/lib/drama/types";
import { DramaApiError } from "@/services/drama-api";

export const KIND_ICON: Record<EntityKind, LucideIcon> = { character: User, scene: MapPin, prop: Package, world: Globe };

/** Ring colours reuse the app's theme tokens, so both themes work without new colours. */
export const KIND_COLOR: Record<EntityKind, string> = {
    character: "var(--wg-home-accent)",
    scene: "var(--wg-playful-mint)",
    prop: "var(--wg-home-muted-strong)",
    world: "var(--wg-home-text)",
};

/** Refetches the drama snapshot after a change. */
export function useRefresh(dramaId: string) {
    const client = useQueryClient();
    return useCallback(() => client.invalidateQueries({ queryKey: dramaKey(dramaId) }), [client, dramaId]);
}

/** Runs a change and reports failures in plain words; a stale write (409) refreshes the data too. Resolves true on success. */
export function useGuard(dramaId: string) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const refresh = useRefresh(dramaId);
    return useCallback(
        async (action: () => Promise<unknown>) => {
            try {
                await action();
                return true;
            } catch (error) {
                if (error instanceof DramaApiError && error.status === 409) message.error(t("内容已在别处修改，请刷新"));
                else message.error(error instanceof Error ? error.message : t("操作没有成功，请重试"));
                void refresh();
                return false;
            }
        },
        [message, refresh, t],
    );
}
