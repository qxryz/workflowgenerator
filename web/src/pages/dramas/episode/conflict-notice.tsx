import { Alert } from "antd";

import { useAppTranslation } from "@/hooks/use-app-translation";

type Props = { message: string; onReload: () => void; onKeep: () => void };

/** Shown after a save was refused because the row changed meanwhile: take the latest, or keep editing on top of it. */
export function ConflictNotice({ message, onReload, onKeep }: Props) {
    const { t } = useAppTranslation();
    return (
        <Alert
            type="warning"
            showIcon
            title={t(message)}
            action={
                <span className="flex gap-2">
                    <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" onClick={onReload}>
                        {t("载入最新")}
                    </button>
                    <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" onClick={onKeep}>
                        {t("继续用我的")}
                    </button>
                </span>
            }
        />
    );
}
