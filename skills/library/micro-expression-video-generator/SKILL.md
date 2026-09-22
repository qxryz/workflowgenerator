---
name: micro-expression-video-generator
description: |
  将角色图片、剧本片段或情绪提示整理为分时微表情表演指导，并在用户确认后生成可选表演片段。适用于细腻角色演技；不用于完整编剧、面部绑定、口型编辑或最终合成。
trigger-words: [微表情, 角色表演提示词, 细腻情绪表演, 角色演技, 情绪表演, 含泪强撑, 爱而不得]
---

# 人物微表情表演

当用户想让角色的情绪表演更自然、更细腻、更像真实演员时，使用这个 Skill。

## 输入方式

- **图片模式**：给一张角色图，继续设计表演。
- **剧本模式**：给一段剧本、分镜或 prompt，只增强表演层。
- **情绪短语模式**：给一句情绪或关系状态。

## 参考资料库

细节规则都放在这些文件里：

- `references/source-notes.md`
- `references/performance-prototype-library.md`
- `references/emotion-route-library.md`
- `references/muscle-dispatch-library.md`
- `references/video-prompt-guardrails.md`
- `references/tempo-density-guide.md`
- `references/climax-reset-patterns.md`

## 流程

1. 先读用户输入，保留已有角色、场景、台词和运镜。
2. 如果缺少镜头时间，就先问镜头时间；如果缺少表演强度，也先问。
3. 写出简洁提示词包并交给用户审阅；只有确认后才继续生成可选表演片段。优先使用 MiniMax H3，因为它能满足本流程所需的图片、音频参考和表演控制能力。用户指定其他模型时，只要满足已确认要求就遵循其选择；如果能力不符，说明差异并让用户选择等效方案。

## 边界

这个 Skill 只负责表演提示词和情绪表演方向，不替代完整编剧、面部绑定、口型编辑或最终合成。
