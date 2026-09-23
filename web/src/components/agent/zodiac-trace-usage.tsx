import { useState } from "react";
import { Popover } from "antd";
import { Database } from "lucide-react";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { cacheHitPercent, compactTokens, tokenTotals, type TraceTokens, type TraceUsage } from "@/lib/agent/zodiac-trace-usage";

export function TraceUsageDetails({ tokens }: { tokens: TraceTokens | null }) {
    const { t } = useAppTranslation();
    if (!tokens) return <p className="zodiac-trace-usage-note">{t("未报告用量")}</p>;
    const totals = tokenTotals(tokens);
    return (
        <dl className="zodiac-trace-usage-rows">
            {[
                { label: "输入", value: totals.input },
                { label: "未缓存", value: tokens.input, nested: true },
                { label: "缓存读取", value: tokens.cacheRead, nested: true },
                { label: "缓存写入", value: tokens.cacheWrite, nested: true },
                { label: "输出", value: totals.output },
                { label: "正文", value: tokens.output, nested: true },
                { label: "思考", value: tokens.reasoning, nested: true },
                { label: "合计", value: totals.total },
            ].map(({ label, value, nested }) => (
                <div key={label} data-nested={nested || undefined}>
                    <dt>{t(label)}</dt>
                    <dd>{value == null ? "—" : value.toLocaleString()}</dd>
                </div>
            ))}
        </dl>
    );
}

export function TraceUsagePill({ usage, unavailable }: { usage: TraceUsage | null; unavailable: boolean }) {
    const { t } = useAppTranslation();
    const [open, setOpen] = useState(false);
    const tokens = usage?.requests ? usage.tokens : null;
    const total = tokens ? tokenTotals(tokens).total : null;
    const hit = tokens ? cacheHitPercent(tokens) : null;
    const emptyLabel = unavailable ? "用量读取失败" : usage?.unreported ? "未报告用量" : usage?.pending ? "等待用量" : "暂无用量";
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            getPopupContainer={(trigger) => trigger.closest<HTMLElement>(".ant-modal-body") ?? trigger.parentElement!}
            classNames={{ root: "zodiac-surface zodiac-trace-usage-popover" }}
            content={
                <section role="dialog" aria-label={t("会话 Token 用量")} className="zodiac-trace-usage-content">
                    <h3>{t("会话累计")}</h3>
                    <p className="zodiac-trace-usage-note">{t("含子 Agent")}</p>
                    {tokens ? <TraceUsageDetails tokens={tokens} /> : <p className="zodiac-trace-usage-note">{t(emptyLabel)}</p>}
                    {usage && (usage.requests > 0 || usage.unreported > 0 || usage.pending > 0) ? (
                        <footer className="zodiac-trace-usage-note">
                            {usage.requests > 0 && <span>{t("{count} 次请求已报告", { count: usage.requests })}</span>}
                            {usage.unreported > 0 && <span>{t("{count} 次请求未报告", { count: usage.unreported })}</span>}
                            {usage.pending > 0 && <span>{t("{count} 次请求等待用量", { count: usage.pending })}</span>}
                        </footer>
                    ) : null}
                    {tokens && unavailable ? <p className="zodiac-trace-usage-note">{t("用量更新失败，显示上次记录")}</p> : null}
                </section>
            }
        >
            <button type="button" className="zodiac-trace-usage-pill" aria-label={t("会话 Token 用量")} aria-expanded={open} aria-haspopup="dialog">
                <Database aria-hidden="true" />
                <span>{compactTokens(total)} Token</span>
                {hit != null ? <span className="zodiac-trace-cache-hit">· {t("缓存命中 {percent}%", { percent: hit })}</span> : null}
                {usage?.unreported || unavailable ? <span className="zodiac-trace-usage-indicator" title={t(unavailable ? "用量读取失败" : "部分请求未报告用量")} /> : null}
            </button>
        </Popover>
    );
}
