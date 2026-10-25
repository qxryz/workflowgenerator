import { App, Segmented } from "antd";
import { LibraryBig, Plus } from "lucide-react";
import { useState } from "react";

import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { ENTITY_GROUP_LABELS } from "@/lib/drama/labels";
import { KIND_ORDER, type KindFilter } from "@/lib/drama/settings-view";
import type { DramaEntity, DramaSnapshot } from "@/lib/drama/types";
import { useGuard, useRefresh } from "./common";
import { importSetting, settingFromAsset } from "./library-sync";
import { createEntity } from "@/services/drama-api";

export type View = "catalogue" | "graph";
type Props = {
    snapshot: DramaSnapshot;
    view: View;
    onView: (view: View) => void;
    filter: KindFilter;
    onFilter: (filter: KindFilter) => void;
    counts: Record<KindFilter, number>;
    onCreated: (entity: DramaEntity) => void;
    /** The first-run empty state carries the main button; the bar then leaves it out. */
    hideTask: boolean;
};

export function SettingsToolbar({ snapshot, view, onView, filter, onFilter, counts, onCreated, hideTask }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const dramaId = snapshot.project.id;
    const guard = useGuard(dramaId);
    const refresh = useRefresh(dramaId);
    const [picking, setPicking] = useState(false);
    const hasSettings = snapshot.entities.length > 0;

    const create = () =>
        guard(async () => {
            const entity = await createEntity(dramaId, { kind: filter === "all" ? "character" : filter, name: t("新设定") });
            await refresh();
            onCreated(entity);
        });
    const fromLibrary = (payload: Parameters<typeof settingFromAsset>[0]) => {
        setPicking(false);
        void guard(async () => {
            const setting = await settingFromAsset(payload);
            if (!setting) return void message.warning(t("这类资产不能作为设定导入"));
            const entity = await importSetting(dramaId, setting);
            await refresh();
            onCreated(entity);
            message.success(t("已从资产库导入「{name}」", { name: entity.name }));
        });
    };

    return (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[color:var(--wg-home-line)] px-5">
            {hasSettings ? (
                <>
                    <Segmented
                        size="small"
                        value={view}
                        onChange={onView}
                        options={[
                            { value: "catalogue", label: t("目录") },
                            { value: "graph", label: t("关系图") },
                        ]}
                    />
                    <Segmented size="small" value={filter} onChange={onFilter} options={[{ value: "all", label: `${t("全部")} ${counts.all}` }, ...KIND_ORDER.map((kind) => ({ value: kind, label: `${t(ENTITY_GROUP_LABELS[kind])} ${counts[kind]}` }))]} />
                </>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
                <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" onClick={() => void create()}>
                    <Plus className="size-4" strokeWidth={1.6} />
                    {t("新建设定")}
                </button>
                <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" onClick={() => setPicking(true)}>
                    <LibraryBig className="size-4" strokeWidth={1.6} />
                    {t("从资产库导入")}
                </button>
                {hideTask ? null : <StartTaskButton snapshot={snapshot} stage="settings" label={hasSettings ? "重新整理" : "整理设定"} />}
            </div>
            <AssetPickerModal open={picking} acceptedKinds={["character", "scene", "image", "text"]} onClose={() => setPicking(false)} onInsert={fromLibrary} />
        </div>
    );
}
