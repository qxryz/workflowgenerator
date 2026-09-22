# Houdini 动效的美术与节奏

仅用于已经选择 Houdini 的动效任务。原包包含通用三维美术入口，其跨软件触发描述不进入本 Skill 的路由。简单模型修改不要求整套美术策划。

新短片先提炼情绪转变、唯一视觉重点、色彩/材质/光线与镜头语言，再设计主要运动、辅助运动和节奏变化。以代表帧和低成本动态预览确认方向后扩展模拟和高质量渲染。按任务规模选择 `motion/art-direction.md`、`motion/rhythm-and-editing.md`、`motion/production-and-critique.md`。

创意提案可以提取参考的视觉语言重新设计；用户要求忠实复刻时则保留约定的形体、时间、镜头和声音，不能套用“不要照搬”的创意原则降低还原目标。样本中的镜头时长、配色比例和评分门槛是分析参考，不覆盖用户的具体作品规格。

需要书面策划时可用 `../assets/art-bible-template.md`、`../assets/beat-sheet.csv` 和 `../assets/review-scorecard.csv`；并非每个任务都必须生成三份文件。

短参考视频可使用 `../scripts/analyze_motion_refs.py` 提取接触表、色彩和运动脉冲摘要。脚本需 ffmpeg、ffprobe、NumPy 和 Pillow，依赖见 `../scripts/requirements-motion.txt`；在独立临时目录输出分析文件，不自动安装到 Houdini 内置 Python。缺依赖时用现有媒体分析能力或说明限制。脚本将解码帧存入内存，长视频先取有代表性的短片段。视觉脉冲不等于剪辑点，音频解码失败不能断言原片无声音，必须回看原视频验证。
