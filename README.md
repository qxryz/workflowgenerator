<p align="center">
  <img src="./web/public/brand/wg.svg" width="88" alt="WorkflowGenerator" />
</p>

# WorkflowGenerator

这是作者自用工具。平时做 AI 图片、视频、提示词和工作流等等。

## 快速体验

目前先发 macOS Apple Silicon 版。去 [Tags](https://github.com/qxryz/workflowgenerator/tags) 找最新版本，下载后拖进“应用程序”就行。软件里打开“设置 → 软件更新”，也可以检查和安装更新。

### macOS 不让打开

目前没有 Apple Developer ID 和公证，第一次打开可能会被 Gatekeeper 拦住。先在 Finder 里右键应用，点一次“打开”；还不行就去“系统设置 → 隐私与安全性”，在底部点“仍要打开”。

如果系统提示应用已损坏，并且确认是从本仓库 Tags 下载的，可以执行：

```bash
xattr -dr com.apple.quarantine /Applications/WorkflowGenerator.app
```

## 现在有的东西

- Zodiac + 无限画布，可以搭工作流，也可以接本机终端 Agent。
- 图片、视频、音频、SD2.5 等几个常用工作台。
- 3D 导演台，先摆人物、机位和构图，再拿去生成。
- Skills、提示词、我的资产和作者私藏。
- DSH Launcher 和一些我自己会用的小入口。
- 数据默认留在本机，模型用自己的 Key。

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
