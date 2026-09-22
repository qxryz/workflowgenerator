> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# Text, UI, Logo, Typography, And Layout

Use when exact text, UI, HUD, typography, poster, title card, app/website, menu, dashboard, product package, logo, or layout accuracy matters.

## Reference Fit Before New Image

When the user provides a reference image, first evaluate whether it already contains the requested UI/text/layout relationship.

- If it satisfies the need, use the provided reference directly.
- If it partially satisfies the need, state which parts are usable and ask whether to supplement or regenerate.
- If it does not satisfy the need, clearly say it does not meet the required UI/text/layout relationship and ask whether to generate/provide another reference image.

Do not automatically recommend a new reference image when the provided reference already satisfies the user's requirement.

## When To Use Reference-Image-First

Prefer a two-stage workflow when the request contains:

- many exact UI words, menu options, HUD labels, usernames, subtitles, title cards, slogans, buttons
- app/website/dashboard/game menu/software UI/ecommerce page/product landing page/poster/packaging layout
- specific composition, UI hierarchy, character positions, color identity, font style, text placement
- more than 3 exact strings
- a static design frame that should stay stable while animated

## Output Order For Two-Stage Workflow

```text
【推荐链路】
先生成 / 上传 1 张 UI、文字、构图参考图，再把它作为 @图片1 输入 H3。

【文字与界面清单（唯一真源）】
列出所有必须准确出现的文字、用户名、按钮、菜单、HUD 标签、标题、Logo/Slogan。

【参考图生成提示词】
静态图提示词，只锁定构图、UI 层级、文字、颜色、角色/产品位置、字体、可读性。

【H3 视频提示词】
说明 @图片1 是 UI/文字/构图/色彩系统参考，H3 必须保持其结构和文字稳定，然后写时间线、动效、声音、禁止项。

【一致性校验】
检查参考图提示词与 H3 提示词中的文字、角色名、颜色身份、布局位置是否一致。
```

## Text Ledger Rules

- Every exact string appears once in the ledger.
- Use quotes around exact strings.
- Reuse the same spelling, capitalization, punctuation, and spacing everywhere.
- If extra readable text is forbidden, write: `除清单文字外，不出现任何其他可读文字。`
- If text should not change, write: `保持文字不变，只允许面板/光效/选中态/加载条产生动效。`

## H3 Prompt Rule With Reference Image

```text
@图片1 是 UI/文字/构图/色彩系统参考图。这张内容必须按“图片”来理解，不能按文字重新处理。H3 必须保持 @图片1 中的 UI 结构、文字内容、字体层级、按钮位置、色彩身份和画面构图稳定清晰。视频中可以让面板滑入、按钮高亮、光标点击、加载条推进、角色动作和背景展开，但所有清单文字必须与 @图片1 完全一致，不新增随机文字。
```

## Negative Constraints

No unreadable UI, random letters, misspellings, duplicated labels, extra menu options, copied official branded interface, layout drift, duplicated cursors, wrong logo, fake brand text, watermark.
