// 统计分析加载器：默认关闭，可同时启用多家。
// 仅支持 GA4 与百度：两者都只接受 ID，脚本地址由代码固定拼接——
// 不接受任意脚本 URL / 内联 JS，避免「配置项被用来在访客浏览器执行任意代码」。
// 全空时不注入任何脚本、不发任何外部请求。这是开源项目的硬要求：
// fork/自托管者默认零统计，官方站点仅通过环境变量注入自己的 ID（ID 不入库）。

import { ANALYTICS_BAIDU_ID, ANALYTICS_GA4_ID } from "@/constant/runtime-config";

type GtagFn = (...args: unknown[]) => void;

declare global {
    interface Window {
        dataLayer?: unknown[];
        gtag?: GtagFn;
        _hmt?: unknown[][];
    }
}

let initialized = false;
// 记录实际启用了哪些统计，供路由上报时按需分发。
const active = { ga4: false, baidu: false };

function appendScript(src: string, attrs: Record<string, string> = {}) {
    const el = document.createElement("script");
    el.async = true;
    el.src = src;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    document.head.appendChild(el);
    return el;
}

function initGa4(id: string) {
    window.dataLayer = window.dataLayer || [];
    const gtag: GtagFn = (...args) => {
        window.dataLayer!.push(args);
    };
    window.gtag = gtag;
    appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    gtag("js", new Date());
    // SPA 路由上报交给 trackPageview，这里关闭默认的自动 page_view，避免重复。
    gtag("config", id, { send_page_view: false });
    active.ga4 = true;
}

function initBaidu(id: string) {
    window._hmt = window._hmt || [];
    appendScript(`https://hm.baidu.com/hm.js?${encodeURIComponent(id)}`);
    active.baidu = true;
}

export function initAnalytics() {
    if (initialized || typeof window === "undefined") return;
    initialized = true;

    // 各家相互独立，逐个判断并启用；任一家出错都不影响其它家与主应用。
    if (ANALYTICS_GA4_ID) {
        try {
            initGa4(ANALYTICS_GA4_ID);
        } catch {
            /* 忽略 */
        }
    }
    if (ANALYTICS_BAIDU_ID) {
        try {
            initBaidu(ANALYTICS_BAIDU_ID);
        } catch {
            /* 忽略 */
        }
    }
}

// SPA 路由切换时上报页面浏览，分发给所有已启用的统计。
export function trackPageview(path: string) {
    try {
        if (active.ga4 && window.gtag) {
            window.gtag("event", "page_view", { page_path: path, page_location: window.location.href });
        }
        if (active.baidu && window._hmt) {
            window._hmt.push(["_trackPageview", path]);
        }
    } catch {
        /* 忽略 */
    }
}

