import { useEffect, useState } from "react";

/** Current time, re-read every `intervalMs` while `active`; for elapsed-time labels. */
export function useNow(active = true, intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(timer);
    }, [active, intervalMs]);
    return now;
}
