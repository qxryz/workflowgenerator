import { App } from "antd";
import { LibraryBig, Trash2, X } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { ENTITY_KIND_LABELS } from "@/lib/drama/labels";
import { adoptedSheets } from "@/lib/drama/media/references";
import type { DramaSnapshot } from "@/lib/drama/types";
import { deleteEntity } from "@/services/drama-api";
import { KIND_ICON, useGuard, useRefresh } from "./common";
import { EntityForm } from "./entity-form";
import { saveToLibrary } from "./library-sync";
import { SheetPanel } from "./sheet-panel";

type Props = { snapshot: DramaSnapshot; entityId: string | null; focusName: boolean; onClose: () => void };

/** Right-hand pane: edit the selected setting, make its sheet. Inline, never a drawer. */
export function DetailPane({ snapshot, entityId, focusName, onClose }: Props) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const dramaId = snapshot.project.id;
    const guard = useGuard(dramaId);
    const refresh = useRefresh(dramaId);
    const entity = snapshot.entities.find((item) => item.id === entityId);

    if (!entity)
        return (
            <aside className="flex w-[440px] shrink-0 items-center justify-center border-l border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-10 text-center text-[13px] text-[color:var(--wg-home-muted)] max-[1240px]:w-[380px]">
                {t("选择一个设定，在这里查看和修改")}
            </aside>
        );

    const Icon = KIND_ICON[entity.kind];
    const owners = snapshot.entities.filter((item) => item.kind === "character" || item.kind === "scene");
    const remove = () =>
        modal.confirm({
            title: t("删除「{name}」？", { name: entity.name }),
            content: t("它的设定图、关系和分镜里的出场绑定会一并删除。"),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                if (await guard(() => deleteEntity(entity.id))) {
                    onClose();
                    await refresh();
                }
            },
        });
    const store = () =>
        guard(async () => {
            await saveToLibrary(entity, adoptedSheets(snapshot.artifacts).get(entity.id));
            message.success(t("已存入资产库"));
        });

    return (
        <aside className="flex w-[440px] shrink-0 flex-col border-l border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] max-[1240px]:w-[380px]">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--wg-home-line)] pl-4 pr-2">
                <Icon className="size-4 shrink-0 text-[color:var(--wg-home-muted)]" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t(entity.kind === "prop" ? "道具陈设" : ENTITY_KIND_LABELS[entity.kind])}</span>
                <button type="button" className="wg-text-button !h-8" onClick={() => void store()}>
                    <LibraryBig className="size-4" strokeWidth={1.6} />
                    {t("存入资产库")}
                </button>
                <button type="button" className="wg-icon-button !size-8" aria-label={t("删除")} title={t("删除")} onClick={remove}>
                    <Trash2 className="!size-4" strokeWidth={1.6} />
                </button>
                <button type="button" className="wg-icon-button !size-8" aria-label={t("关闭")} title={t("关闭")} onClick={onClose}>
                    <X className="!size-4" strokeWidth={1.6} />
                </button>
            </header>
            <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
                <EntityForm key={entity.id} entity={entity} owners={owners} focusName={focusName} dramaId={dramaId} />
                <div className="border-t border-[color:var(--wg-home-line)]" />
                <SheetPanel entity={entity} project={snapshot.project} artifacts={snapshot.artifacts} />
            </div>
        </aside>
    );
}
