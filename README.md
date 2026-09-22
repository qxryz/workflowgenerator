<p align="center">
  <img src="./web/public/brand/wg.svg" width="88" alt="WorkflowGenerator" />
</p>

# WorkflowGenerator

这是作者自用工具。平时做 AI 图片、视频、提示词和工作流等等。

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
- 一些我自己会用的小入口。
- 数据默认留在本机，模型用自己的 Key。

## 网络代理

如果 TUN 或 Fake-IP 代理导致生成结果无法保存，可在“设置 → 本地与网络”开启“允许私有网络媒体下载”。开关默认关闭；开启后应用会允许模型返回的 HTTPS 下载地址连接任意私有网络，因此请只使用可信的模型渠道和插件。

## 致谢

- [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)
- [jiguang132/storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk)
- [nexu-io/open-design](https://github.com/nexu-io/open-design)
- [DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove)
- [coze-dev/coze-studio](https://github.com/coze-dev/coze-studio)

## 许可证

代码按 [AGPL-3.0-or-later](./LICENSE) 开源。修改后发布、分发，或者拿去提供网络服务，请按 AGPL 把对应源码也公开。

仓库里引用的第三方代码和素材仍按各自许可证执行。这个项目首先是 qxryz 的自用工具箱，不承诺适合任何生产环境，使用前请自己确认数据、模型费用和第三方内容风险。

## 第三方内容

代码部分沿用上面“致谢”中各仓库的原许可证。内置提示词快照来自 [Banana Prompt Quicker](https://glidea.github.io/banana-prompt-quicker/)、[DavidWu GPT Image 2](https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts)、[Awesome GPT Image](https://github.com/ZeroLu/awesome-gpt-image)、[Awesome GPT-4o](https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts)、[YouMind GPT Image 2](https://github.com/YouMind-OpenLab/awesome-gpt-image-2) 和 [YouMind Nano Banana Pro](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts)，内容及图片仍归原作者，并按各来源的许可与署名要求使用。

3D 导演台内的 [UE Mannequin (Retopology)](https://sketchfab.com/3d-models/ue-mannequin-retopology-5394d9f894374a2ab7c57a21929ce4c2) 由 William Luque 制作，按 [Sketchfab Standard License](https://sketchfab.com/licenses) 使用，不属于本项目 AGPL 代码许可证。
