type Translate = (message: string, values?: Record<string, string | number>) => string;

const pad = (value: number) => String(value).padStart(2, "0");

/** 83_000 -> "01:23"; hours roll into minutes only past 99:59, which a text run never reaches. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "10-25 14:03" */
export function formatClock(timestamp: number): string {
    const date = new Date(timestamp);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeTime(timestamp: number, now: number, t: Translate): string {
    const minutes = Math.floor((now - timestamp) / 60_000);
    if (minutes < 1) return t("刚刚");
    if (minutes < 60) return t("{count} 分钟前", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("{count} 小时前", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t("{count} 天前", { count: days });
    return formatClock(timestamp).slice(0, 5);
}

/** Prefix of run.error when the model's answer failed every check; the reason after it is the server's Chinese wording. */
export const CHECK_FAILED = "模型的输出没有通过检查：";

/** A run's error for display: fixed messages are translated, the reason behind CHECK_FAILED is translated when it is one of ours and stays as the server wrote it otherwise. */
export const runErrorText = (error: string, t: Translate): string => (error.startsWith(CHECK_FAILED) ? `${t(CHECK_FAILED)}${t(error.slice(CHECK_FAILED.length))}` : t(error));
