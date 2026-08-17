/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // 逗号分隔的本地开发插件 URL,每次启动重新拉取(不缓存、不落库)
    readonly VITE_DEV_PLUGINS?: string;
    // 统计分析（可选，构建期注入）：每家一个独立变量，填了谁就启用谁，可同时启用多家
    // GA4 衡量 ID（G-XXXX）
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // 百度统计站点 ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
}
