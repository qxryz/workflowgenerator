<p align="center">
  <img src="./web/public/brand/wg.svg" width="88" alt="WorkflowGenerator" />
</p>

# WorkflowGenerator

开源画布设计 Agent 工作台。用无限画布组织提示词、参考素材和生成结果；在同一工作流中与 Zodiac 对话、审核计划并运行创作任务。

[![在线体验](https://img.shields.io/badge/在线体验-打开网站-2563eb?style=for-the-badge)](https://workflow.zhouzhou.dev)

## 下载与开始使用

从 [Releases](https://github.com/qxryz/workflowgenerator/releases/latest) 下载 macOS Apple Silicon 安装包。安装后打开“模型与渠道”，填写所用模型服务的 API Key，并选择聊天、图片等默认模型。免费渠道预设提供 Agnes AI 的获取 Key 入口；各模型的可用额度和费用以渠道页面为准。

1. 从“新建画布”进入工作流，添加文本、图片、视频、音频或生成配置节点。
2. 连接节点并填写提示词与参考素材；也可以打开 Zodiac，描述想制作的内容。
3. 检查 Zodiac 准备的画布内容、模型和阶段计划。媒体生成由你在节点或阶段卡中手动启动。
4. 在结果槽查看产物，将需要的内容保存到画布；在“资产”中管理已保存的媒体。

Zodiac 会在工作流中保存对话和阶段状态。右上角“新对话”会保留旧会话；从“历史对话”可以重新打开或归档。已归档会话只读，恢复后才能继续。对话中的“轨迹”显示工具操作、错误、耗时，以及运行组件上报的 Token 和缓存用量。

会话里的“自动审批”默认关闭。打开后，该会话中的命令与文件操作可自动获准；媒体生成仍需手动运行。关闭对话面板或切换页面不会停止正在运行的任务。

应用内置 Zodiac 运行组件，无需另外安装 Agent、Node.js 或 Rust。Skills 会保留正文、参考和脚本；依赖特定外部服务或软件的技能仍需满足其自身条件。

## 数据与备份

桌面版的画布、配置、会话和素材默认保存在 `~/.zodiac`。备份时先退出应用，再复制整个目录；导出单个画布或使用 WebDAV 都不能代替完整数据备份。模型密钥保存在本机配置中，请妥善保护备份。

删除工作流前应用会提示，并联动清理该工作流的会话、计划和工作文件。其他工作流仍在使用的媒体会保留。删除操作前建议备份重要内容。

## 安装与更新

macOS 首次安装后，如系统阻止打开，请将应用拖入“应用程序”，再在终端运行 `xattr -dr com.apple.quarantine /Applications/WorkflowGenerator.app`，然后重新打开。后续版本可在软件内检查并安装更新。

桌面安装包、签名更新包及源码快照发布在 [WorkflowGenerator Releases](https://github.com/qxryz/workflowgenerator/releases)。后续版本可在“设置 → 软件更新”中检查。`wg-dist` 用于提示词、插件等内容分发。

## 网页尝鲜版

[打开网页尝鲜版](https://wg.coco120.cn)。网页端支持画布、工作台、Skills、提示词和浏览器内的流式 Zodiac 对话；当前不提供桌面端的文件、脚本和子任务 Agent 执行。数据保存在当前浏览器，不会自动同步到桌面端或其他设备。

## 网络代理

如果 TUN 或 Fake-IP 代理导致生成结果无法保存，可在“设置 → 本地与网络”开启“允许私有网络媒体下载”。开关默认关闭；开启后应用会允许模型返回的 HTTPS 下载地址连接任意私有网络，因此请只使用可信的模型渠道和插件。

## 开发

桌面端由 `web/src`（React 界面）、`web/server`（Rust 本地服务）和 `web/src-tauri`（桌面窗口与打包）组成。画布节点插件在 `plugins/canvas`，产品技能文件在 `skills/library`。默认业务数据位于 `~/.zodiac`；开发和测试可设置 `WG_DATA_DIR` 使用独立目录。

需要 Node.js 22、Bun、Rust 与 Tauri 所需的 macOS 构建环境。在 `web/` 目录安装依赖并检查：

```sh
bun install --frozen-lockfile
npm run typecheck
npm test
npm run server:test
```

桌面构建使用 `npm run desktop:build`。构建脚本需要 OpenCode `1.18.32` 的本机可执行文件，可通过 `WG_OPENCODE_BINARY` 指定；它作为运行组件进入安装包，不提交到源码仓库。发布还需要单独签名，开发构建不等于可供自动更新的版本。

## 许可与第三方来源

本项目代码以 [AGPL-3.0-or-later](./LICENSE) 发布。第三方代码、模型、提示词、技能、预览图片和视频不因出现在本仓库或应用中而改用 AGPL；再使用时应分别核对来源和许可。

| 项目 | 在本项目中的关系 | 来源协议 |
| --- | --- | --- |
| [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | 无限画布的早期基础与参考 | [MIT](https://github.com/basketikun/infinite-canvas/blob/main/LICENSE) |
| [storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk) | 3D 导演台改编代码 | [MIT](./web/src/director-desk/THIRD_PARTY_NOTICES.md)；随附 3D 模型另计 |
| [OpenCode](https://github.com/anomalyco/opencode) | 随桌面安装包提供的 Zodiac 运行组件 | [MIT](./web/third-party/opencode-LICENSE) |
| [OpenDesign](https://github.com/nexu-io/open-design) | 设计与交互参考 | [Apache-2.0](https://github.com/nexu-io/open-design/blob/main/LICENSE)；其部分技能与模板另有许可 |
| [OpenCove](https://github.com/DeadWaveWave/opencove) | 早期版本功能参考，现搁置 | [MIT](https://github.com/DeadWaveWave/opencove/blob/main/LICENSE) |
| [Coze Studio](https://github.com/coze-dev/coze-studio) | Agent 与工作流设计参考 | [Apache-2.0](https://github.com/coze-dev/coze-studio/blob/main/LICENSE-APACHE) |

提示词目录汇集来自 [Banana Prompt Quicker](https://github.com/glidea/banana-prompt-quicker)、[DavidWu GPT Image 2](https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts)、[Awesome GPT Image](https://github.com/ZeroLu/awesome-gpt-image)、[Awesome GPT-4o](https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts)、[YouMind GPT Image 2](https://github.com/YouMind-OpenLab/awesome-gpt-image-2) 和 [YouMind Nano Banana Pro](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) 的条目。其中 Banana Prompt Quicker、Awesome GPT Image 与 Awesome GPT-4o 仓库标示 MIT；两个 YouMind 集合标示 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；DavidWu 集合未见统一许可证。条目中的文字、图片和外链可能另有原作者权利，使用时应查看具体条目与来源。

技能库含 MiniMax Design 等作者的内容与预览素材；各技能的署名和文件应分别查看，未标出统一许可的内容不视为本项目 AGPL 授权。`vox-style-video-generator` 等单独附有许可证的技能，以其自身文件为准。

3D 导演台使用的 [UE Mannequin (Retopology)](https://sketchfab.com/3d-models/ue-mannequin-retopology-5394d9f894374a2ab7c57a21929ce4c2) 由 William Luque 制作，按 [Sketchfab Standard License](https://sketchfab.com/licenses) 使用；仓库保留了[模型署名与许可说明](./web/public/models/ue-mannequin-retopology.license.txt)。第三方品牌标识及模型图标属于各自权利人。依赖库的具体版本见 `web/bun.lock` 和两个 Rust `Cargo.lock`。
