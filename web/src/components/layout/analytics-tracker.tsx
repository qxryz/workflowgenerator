import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { trackPageview } from "@/lib/analytics";

// 监听 SPA 路由变化并上报 pageview。无统计配置时 trackPageview 为空操作。
export function AnalyticsTracker() {
    const location = useLocation();

    useEffect(() => {
        trackPageview(`${location.pathname}${location.search}`);
    }, [location.pathname, location.search]);

    return null;
}
