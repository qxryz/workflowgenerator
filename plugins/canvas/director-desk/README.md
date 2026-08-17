# 导演台节点

WorkflowGenerator 官方画布插件。节点通过同源 `/director-runtime.html` 接入导演台，把画布上游的第一张图片作为全景输入，并把导演台截图保存到宿主媒体库后回传为可继续连接的图片节点。

```bash
npm install
npm run typecheck
npm run build
```

插件只提供导演项目入口与资产桥接，不是画布工作流里的生成动作。
