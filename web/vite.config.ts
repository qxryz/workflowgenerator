import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";

// 暴露 /plugins/index.json:列出 public/plugins 下的本地插件文件,
// 供前端自动发现并加入插件列表(默认关闭)。dev 下实时读目录,构建时产出静态清单。
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

// 开发时代理到本地服务端。前端把数据、媒体和模型请求全部发给 /api 与 /media，
// vite 只提供前端源码，不代理的话每个请求都会 404 —— 数据搬到服务端之后，
// 原来靠浏览器存储回退来跑 dev 的方式就不存在了。
//
//   终端 1: bun run server:dev     # 本地服务端，3211
//   终端 2: bun run dev            # vite，3000，代理到 3211
//
// 三者端口互不冲突：vite 3000 / 本地服务端 3211 / Docker 容器 3210。
// 想直接对着正在运行的容器开发前端（共用同一份 ./data）：
//     WG_SERVER_ORIGIN=http://127.0.0.1:3210 bun run dev
const serverOrigin = process.env.WG_SERVER_ORIGIN || "http://127.0.0.1:3211";
const proxy = {
    // ws: true 是 Zodiac 需要的：它走 /api/zodiac/stream 的 WebSocket，
    // 不打开升级转发时 dev 模式下握手会直接失败。
    "/api": { target: serverOrigin, changeOrigin: false, ws: true },
    // 媒体地址由服务端签发为 /media/{bucket}/{url_key}，必须一并代理，
    // 否则 <img> / <video> 全部加载失败。
    "/media": { target: serverOrigin, changeOrigin: false },
};

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest()],
    server: { proxy },
    preview: { proxy },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
    },
    build: {
        rollupOptions: {
            input: {
                app: resolve(webDir, "index.html"),
                directorRuntime: resolve(webDir, "director-runtime.html"),
            },
        },
    },
});
