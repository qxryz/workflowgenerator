# Markdown 节点插件

WorkflowGenerator 画布节点插件：在画布里编辑与渲染 Markdown。

## 构建

```bash
npm install
npm run build      # 产物 dist/markdown.js,并同步到 web/public/plugins/markdown.js
npm run dev        # watch,改动自动构建
```

## 安装

画布 →「节点插件」→ 官方插件 → 安装并启用「Markdown 节点」。内置版本可离线使用。

独立构建产物仍可用于开发；远端分发继续遵循宿主签名和哈希校验。

## 本地开发

`npm run dev` 起 watch,在 `web/.env.local` 加 `VITE_DEV_PLUGINS=/plugins/markdown.js`,起画布后改 `src/index.tsx` 刷新页面即生效,无需反复安装。

插件契约见 `plugins/canvas/README.md`。

> 本插件演示了独立 CSS 文件用法:`src/styles.css` 经 esbuild `text` loader 打进 bundle,通过插件 `css` 字段自动注入/清理。


## Agent 方法

内置版本声明 `document.read` 与 `document.replace`。先调用 `hub_plugin_agent_describe` 查询指定节点的方法，再调用 `document.read` 取得完整正文与 `revision`。写入时在 `hub_plugin_agent_invoke` 顶层传入相同的 `expectedRevision`，`args` 为 `{ "content": "完整 Markdown 正文" }`。

写入由宿主提交到当前画布并等待服务端持久化和读回核验；文档已变化、请求已取消、schema 不符或保存失败时不会返回成功回执。正文中的代码和命令只作为文本保存，不执行。
