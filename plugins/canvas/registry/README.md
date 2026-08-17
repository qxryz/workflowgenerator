# WorkflowGenerator 官方插件注册表

本目录**只放构建脚本**，不放构建产物。官方插件由 CI 发布到本仓库的 `plugins-dist` 分支，画布从该分支拉取并安装。第三方插件不进本流程，由用户自行填写 JS URL 安装。

```
registry/
  package.json    # 构建依赖（esbuild + SDK）
  build.mjs       # 一次构建所有官方插件并生成清单
  dist/           # 本地构建产物（gitignore，不提交到 main）
```

`dist/` 与 `node_modules/` 均被 `.gitignore` 覆盖，`main` 分支只保留源码与脚本。

## 构建与发布

本仓库的 `.github/workflows/publish-plugins.yml` 会在版本 tag 或手动触发时：

1. 在 `dist/` 产出各 `<id>.js` 与 `official-plugins.json`；
2. 把完整结果保存为 GitHub Actions artifact；
3. 内容变化时更新 `plugins-dist` 分支。该分支只保存发布文件，不混入开发源码。

前端默认从下面地址读取（可用 `VITE_PLUGIN_REGISTRY_URL` 覆盖）：

```
https://raw.githubusercontent.com/qxryz/workflowgenerator/plugins-dist/official-plugins.json
```

清单里的 `entry` 会按清单所在目录解析为插件文件地址。

## 新增 / 更新官方插件

- 修改官方插件源码后，在 `build.mjs` 的 `OFFICIAL` 中保持登记；新增插件也在这里加入。
- 本地构建并确认清单与插件文件无误，再提交 `main`；下次版本 tag 或手动运行工作流时会更新发布快照。

## 本地自测官方面板

```bash
cd plugins/canvas/registry
npm install
npm run build
```
