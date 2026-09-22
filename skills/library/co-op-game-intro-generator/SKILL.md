---
name: co-op-game-intro-generator
description: |
  根据两位玩家名称、游戏标题、视觉风格和可选角色参考图，制作双人合作游戏主菜单或开场动画。先锁定人物身份，生成一张菜单确认图；批准后再回填角色、界面文案、事件节奏和运动说明，并默认使用 H3 生成最终视频。适合合作游戏概念、角色化菜单和社交开场，不用于可玩游戏开发、精确标识复刻、复杂多页面界面或无角色通用片头。
trigger-words: [co-op intro, game menu, two-player game intro, H3 game intro, 双人游戏开场, 游戏主菜单, 玩家名, 游戏名]
allowed-tools: [question, hub_generate_image, hub_generate_video, hub_analyse_media, hub_canvas_get_node, hub_save_file_to_session]
---

# 双人游戏开场视频生成器

当用户想复用一套“双人合作游戏主菜单 / 开场动画”制作流程时使用本 Skill。流程会收集玩家信息、游戏标题、视觉风格和可选角色参考图；先生成一张确认首图，等待用户批准后，再创建最终 H3 视频提示词与视频方案。

## 平台适配规则

本 Skill 已适配平台发布结构，必须保持以下文件布局：

- `SKILL.md` 是默认英文运行文件。
- `SKILL.cn.md` 是中文镜像文件，语义必须与英文版保持一致。
- `meta.yaml` 保存展示名称、标签、版本、作者、来源和可选封面。
- 运行时提示词模板放在 `references/` 中，必须按路径加载，不要凭记忆重写。
- 不要写死项目输出路径，后续步骤使用生成或剪辑工具返回的文件路径。
- 最终视频生成前必须等待用户确认首图。

## 必需参考文件

以下两个模板是运行时必需输入，不是可选背景资料：

- 在 STEP 3 构建确认首图提示词、STEP 4 生成确认首图时，使用 `references/h3-confirmation-image-template.md`。
- 在 STEP 6 回填最终视频提示词时，使用 `references/h3-video-prompt-template.md`。

如果任一模板缺失，停止执行并说明 Skill 包不完整，不要临时改用其他提示词结构。

## STEP 1：收集视觉风格

请用户选择预设风格或输入自定义风格。所选风格具有最高优先级，会控制色彩系统、背景纹理、角色渲染、服装方向、UI 颜色、按钮和图标风格、字体质感与整体氛围。

如果用户不确定风格，先给出简短风格示例，不要直接生成。

## STEP 2：收集玩家和游戏信息

收集：

- PLAYER 1 名称
- PLAYER 2 名称
- 游戏标题
- 可选 PLAYER 1 角色参考图
- 可选 PLAYER 2 角色参考图

当用户上传角色图时，只把它们用于身份映射：可识别脸型轮廓、发型、眼镜、相对五官比例和个人特征。不要继承照片写实感、真实皮肤纹理、现实光线、相机质量或原图风格，除非用户选择的风格明确要求写实。

## STEP 3：构建确认首图提示词

加载并遵循 `references/h3-confirmation-image-template.md` 作为必需提示词骨架。按顺序填写所有占位字段，并保持固定菜单框架不变。

填充后的提示词必须保留：

1. 16:9 横版游戏主菜单构图。
2. 两位居中的可玩角色。
3. 左上角玩家信息卡。
4. 右侧纵向菜单。
5. Continue 作为主要视觉焦点。
6. 游戏标题使用清晰可读的原创标题处理。
7. UI、图标、按钮、字体和装饰元素都与同一色彩系统联动。
8. 上传角色参考图中的身份锚点。

所选风格可以改变渲染方式、材质、纹理、视觉母题、光影氛围、UI 材料语言和字体外观，但不能改变布局层级与菜单逻辑。

## STEP 4：生成一张确认首图

只根据填充后的模板生成一张确认首图。该图是高成本决策检查点，用于确认风格、布局、身份映射、文字可读性和 UI 方向。

不要在同一步生成最终视频。

## STEP 5：等待批准或修改

等待用户批准首图。如果用户修改风格、名称、游戏标题、身份、布局可读性或画面方向，回到 STEP 3 并重新生成确认首图。

只有在用户明确批准后才能继续。

## STEP 6：回填 H3 视频提示词

用户批准后，加载 `references/h3-video-prompt-template.md`，并用以下信息回填：

- 确认首图作为 UI / 布局参考。
- PLAYER 1 与 PLAYER 2 名称。
- 游戏标题。
- 已上传的身份参考图，如有。
- 已确认的视觉风格与色彩语言。
- 最终 UI 文案。
- 时间线事件与运动方向。
- 负面约束。

视频提示词必须保留固定事件框架，同时把所有视觉处理改写为用户选择的风格。

## STEP 7：生成最终视频

只有在首图批准后，才生成最终双人游戏开场视频。最终输出必须与确认首图和身份参考保持关联。

## STEP 8：修复常见失败

如果文字不可读，减少屏幕文字并强化字体约束。如果角色身份互换，强化玩家位置、姓名映射、服装锚点和颜色映射。如果脸部漂移，复用上传参考图，并明确保留身份锚点，同时把脸部渲染进所选风格。如果风格变弱，重写 Overall Style、Color Palette、Character Style、Background、Game UI、Buttons、Icons 和 Typography 等风格相关字段，不要改变固定框架。

## 触发测试示例

应触发：

- “Make a co-op game intro with two player names and a menu screen.”
- “帮我做一个双人游戏主菜单开场视频。”
- “Use H3 to create a two-player game menu animation.”

不应触发：

- “Build a playable co-op game prototype.”
- “Create a generic logo-only title sequence.”
- “Design a complex multi-page game settings UI.”
