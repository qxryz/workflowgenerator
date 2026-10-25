import { Check } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";

type Props = { adopted: boolean; elsewhere?: string; canAdopt: boolean; busy: boolean; reason?: string | null; onAdopt: () => void; onClear: () => void };

/** One pattern for both tools: 采用 when something differs, "已采用" with 取消采用 when it is in use. */
export function AdoptBar({ adopted, elsewhere, canAdopt, busy, reason, onAdopt, onClear }: Props) {
    const { t } = useAppTranslation();
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                {adopted ? (
                    <>
                        <span className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-home-hover)] text-[13px] font-medium">
                            <Check className="size-4" strokeWidth={1.8} />
                            {t("已采用")}
                        </span>
                        <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={busy} onClick={onClear}>
                            {t("取消采用")}
                        </button>
                    </>
                ) : (
                    <button type="button" className="wg-primary-button !min-h-9 flex-1" disabled={busy || !canAdopt} onClick={onAdopt}>
                        {t("采用")}
                    </button>
                )}
            </div>
            {reason && !adopted ? <p className="!mb-0 text-[12px] text-[color:var(--wg-home-muted)]">{t(reason)}</p> : null}
            {elsewhere && !adopted ? (
                <p className="!mb-0 text-[12px] text-[color:var(--wg-home-muted)]">
                    {t("当前采用的是「{name}」", { name: elsewhere })}
                    <button type="button" className="ml-2 underline underline-offset-2 hover:text-[color:var(--wg-home-text)]" disabled={busy} onClick={onClear}>
                        {t("取消采用")}
                    </button>
                </p>
            ) : null}
        </div>
    );
}
