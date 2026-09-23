<p align="center">
  <img src="./web/public/brand/wg.svg" width="88" alt="WorkflowGenerator" />
</p>

# WorkflowGenerator

本地 AI 创作工作台，提供无限画布、Zodiac 对话、媒体生成、Skills 和提示词管理。

[![在线体验](https://img.shields.io/badge/在线体验-打开网站-2563eb?style=for-the-badge)](https://workflow.zhouzhou.dev)

## 桌面端

基于 Tauri 2、React 与 Rust。画布、对话和素材保存在本机，模型使用“设置 → 渠道”中的配置。

应用包含运行组件，首次启动自动配置 `~/.zodiac` 数据目录，无需安装外部 Agent。模型渠道需填写自己的 API Key。画布、会话、素材和配置保存在该数据目录中。

macOS 首次安装后，如系统阻止打开，请将应用拖入“应用程序”，再在终端运行 `xattr -dr com.apple.quarantine /Applications/WorkflowGenerator.app`，然后重新打开。后续版本可在软件内检查并安装更新。

桌面安装包与版本更新发布在 [WorkflowGenerator Releases](https://github.com/qxryz/workflowgenerator/releases)；`wg-dist` 只用于提示词、插件等内容分发。

Zodiac 使用应用内置的 OpenCode 执行任务，沿用渠道中的文本模型，不需要另行连接本机 Agent。会话有独立文件目录，支持读写文件、审批后运行脚本及将产物导入画布。对话自动保存，归档后只能从“对话”菜单点击“恢复”，工作流内历史不显示归档对话。涉及生成和修改的工具支持执行前审批；阶段计划先审核再执行。

技能内容与运行能力分开管理。现有技能包保留；基础文件和脚本执行已接通；专属网关、旧剪辑工具与部分技能所需的外部软件仍需分别适配。

## 现在有的东西

- Zodiac + 无限画布，用来搭生成工作流。
- 图片、视频、音频、SD2.5 等几个常用工作台。
- 3D 导演台，先摆人物、机位和构图，再拿去生成。
- Skills、提示词、我的资产和作者私藏。
- 数据默认留在本机，模型用自己的 Key。

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
