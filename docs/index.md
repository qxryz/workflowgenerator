# WorkflowGenerator 文档索引

## 项目介绍

- [快速开始](/docs/overview/quick-start)
- [功能介绍](/docs/overview/features)
- [Render 部署](/docs/overview/render)
- [Docker 部署](/docs/overview/docker)
- [第三方 GitHub 提示词仓库](/docs/overview/third-party-prompt-repositories)

## 操作手册

- [画布节点操作手册](/docs/canvas/canvas-node-manual)
- [画布快捷键](/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/docs/development/local-development)
- [画布数据结构](/docs/development/canvas-data-structure)

## 支持与安全

- [漏洞提交](/docs/support/security)

## 项目进度

- [更新日志](/docs/progress/changelog)
- [待测试](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## 说明

- 桌面版将画布、会话、配置等结构化数据保存在应用 SQLite 中，媒体保存在应用媒体目录；普通关闭窗口前会等待待写入内容完成保存。
- 网页模式使用浏览器 IndexedDB/localForage 作为兼容存储。跨设备使用时，可自行配置 WebDAV 同步。
- 桌面版的 AI API Key 随模型渠道配置保存在应用本地数据中；网页模式则保存在当前浏览器环境。模型请求均直接发往用户配置的兼容接口。
