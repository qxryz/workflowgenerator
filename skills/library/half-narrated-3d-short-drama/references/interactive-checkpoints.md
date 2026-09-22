# Interactive Checkpoints — Standardized `question` Question Templates (3D Manhua Half-Narrated Short Drama · v2.0.3)
This file is the **card catalog** of every `question` call the Skill makes. Each step in `SKILL.md` / `SKILL.cn.md` references one of these templates. The Skill should use the exact options listed here so the user always sees the same shape and the same defaults.

> **v2.0.3 ULF rule (HARD GATE)**: every `question` call (options, descriptions, defaults, placeholders) MUST be written in the user's current language. The user-provided text is preserved verbatim. Technical identifiers stay machine-readable.
>
> **Complete ULF spec**: see `references/user-language-rules.md` (12 user-facing scenarios + 5 non-translation boundaries + 8 hard gates).

**How to use**: at each "ask user" moment in the workflow, look up the matching checkpoint, copy the question and options, and call `question` with them. Replace the `<placeholder>` fields with the current project values.

**Defaults are highlighted with ★** — the Skill must default to that option if the user does not pick.

---

## CHECKPOINT 0.1 — Starting Path (STEP 0, Q1)

> 你的起点是？

| Option | label |
|---|---|
| ★ 1 | 从零开始（只有故事想法） |
| 2 | 半成品素材（剧本片段 / 人物小传 / 参考图） |
| 3 | 完整素材（成型角色设定 + 场景 + 完整剧本） |

If "从零开始": continue to CHECKPOINT 0.2.
If "半成品素材": ask one follow-up "请上传/粘贴你的素材（剧本 / 参考图 / 笔记）", then continue to 0.2.
If "完整素材": skip CHECKPOINT 0.2's question-asking phase and ask "请上传你的完整素材包", then continue to 0.4 (skip 0.3 since genre is usually already implied by the script).

---

## CHECKPOINT 0.2 — Genre Track (STEP 0, Q2)

> 题材轨道是哪一个？（这会决定节拍链的默认节奏、"反转口味"，以及 Q5 旁白音色的自动推荐）

| Option | label | 适合平台 | 自动推到 Q5 的旁白 |
|---|---|---|---|
| ★ 1 | 都市悬疑 | 抖音 / 红果 | 抖音解说男声 |
| 2 | 古风玄幻 | 红果 / 番茄 | 抖音解说男声 |
| 3 | 都市情感 | 抖音 / 红果 | **抖音解说女生** |
| 4 | 校园青春 | 抖音 | **抖音解说女生** |
| 5 | 逆袭成长 | 抖音 / 红果 | 抖音解说男声 |
| 6 | 末世求生 | 红果 | 抖音解说男声 |
| 7 | 异世界冒险 | 番茄 / ReelShort | 抖音解说男声 |
| 8 | 自定义 | — | 抖音解说男声（默认） |

> 经验法则：**男频题材**（悬疑/权谋/战斗/惊悚/末世/异世界）→ 男声；**女频题材**（情感/校园/治愈）→ 女声；古风/通用 → 默认男声，用户可切女声。

---

## CHECKPOINT 0.3 — Format Lock (STEP 0, Q3)

> 锁定格式（这些会写到 Final Spec 里，本集内不可改）：

This is **4 sub-questions** in one `question` call (or one combined question with grouped options):

- **画幅**:
  - ★ 9:16 竖屏（抖音/红果/ReelShort）
  - 16:9 横屏
  - 1:1
- **时长**:
  - 30s 钩子版
  - 60s 短版
  - ★ 90s 标准版
  - 3min 完整版
- **字幕方式**:
  - ★ 硬烧字幕
  - 软字幕
  - 不带字幕
- **发布目标**:
  - ★ 抖音
  - 红果
  - ReelShort
  - YouTube Shorts
  - TikTok
  - 其他

> 3D 漫剧 vs 2D 的差异：3D 漫剧运镜更慢，单镜更长（6-10s vs 4-6s），所以 90s 标准版大约 12-15 镜（2D 是 18 镜左右）。

---

## CHECKPOINT 0.4 — Visual Sub-Mode (STEP 0, Q4)

> 视觉风格已锁为 **3D 渲染 + 漫剧 webtoon 分镜语言**。请在这个 3D 漫剧家族里挑一个子模式：

| Option | label | 视觉关键词 |
|---|---|---|
| ★ 1 | 国漫 3D 渲染流（默认） | 3D 渲染 + 干净深色描边叠在 3D 渲染上 + 软 PBR 非写实材质 + 强对比电影光 + 漫剧分镜 |
| 2 | 皮克斯 Disney 流 | 3D 渲染 + 圆润 Q 版 + 大眼 + 较柔光 + 风格化非 PBR + 漫剧分镜 |
| 3 | 半厚涂 3D 写实流 | 3D 渲染 + 笔触覆盖 + 半写实比例 + 强对比光 + 漫剧分镜 |

If the user asks for 2D / Pixar / 真人 / 油画 / 水墨 / 黑白线稿等非 3D 漫剧风格，**stop and tell them**:
> 这套 skill 只做 3D 渲染 + 漫剧 webtoon。要做 2D 描边 / 纯 Pixar 卡通 / 写实 CG / 真人请换其他 skill。

---

## CHECKPOINT 0.5 — Narration Voice (STEP 0, Q5) [v2.0: Top-2 抖音解说]

> 旁白音色（整集保持同一个，按 Q2 题材自动推荐 ★ 默认）：

Pull this list from `references/voice-presets.md` (Top-2 Douyin narration first):

| Option | label | voice_id |
|---|---|---|
| ★ 1 | 抖音解说男声 | the locked catalog narrator voice |
| ★ 2 | 抖音解说女生 | the selected catalog narrator voice |
| 3 | 温润男声 | a selected catalog voice |
| 4 | 沉稳高管 | a selected catalog voice |
| 5 | 抖音青年解说 | a selected catalog voice |
| 6 | 青年大学生 | a selected catalog voice |
| 7 | 自定义 / 试听 | （用户从完整音色表试听后填 voice_id） |

The ★ row that gets highlighted is the one matching the genre track chosen in Q2 (see the auto-recommend table). If the user does not pick, the Skill uses that ★. Do not re-ask.

**Gender-mismatch guardrail (v2.0)**: if the user explicitly picks a gender that doesn't match the genre's auto-recommend (e.g. male voice for a female-frequency romance), honor the user choice but mention the auto-recommend rationale before locking.

---

## CHECKPOINT 1 — Story Read Confirmation (STEP 1 end) [v2.0: +narrative_split.md]

> 故事我已经读完了。故事内核（5 个 bullet）如下：
> - <bullet 1>
> - <bullet 2>
> - <bullet 3>
> - <bullet 4>
> - <bullet 5
>
> **旁白/对白分类**（`narrative_split.md`，[v2.0 新增]）：
> - 旁白：<N> 条
> - 对白：<N> 条
> - 待定（needs_user_confirm）：<N> 条 — **必须先解决**
>
> 是否进入下一节拍链？

| Option | label |
|---|---|
| ★ 1 | 进入 |
| 2 | 调整钩子 |
| 3 | 调整题材 |
| 4 | 旁白对白分类有未决项要解决（needs_user_confirm > 0） |

If option 4: run a single `question` for each pending line ("这句是旁白还是对白？") before continuing.

---

## CHECKPOINT 2 — Beat Chain Confirmation (STEP 2 end) **[narration-first Guardrail 1/3, v2.0: 强化]**

> 5 个节拍是这样：
>
> | 节拍 | 内容 | 时长 |
> |---|---|---|
> | 1 设定 | <...> | <Xs> |
> | 2 压力 | <...> | <Xs> |
> | 3 应对 | <...> | <Xs> |
> | 4 转折 | <...> | <Xs> |
> | 5 悬念/收束 | <...> | <Xs> |
>
> **旁白完整性自检**（narration-first 护栏 1/3，硬关卡）：
> - [ ] 每段旁白独立承载一个剧情支点（无口水话/纯过渡）
> - [ ] 每节拍信息密度足够（无"一句旁白+全靠动作"的空节拍）
> - [ ] 红线圈内信息无遗漏（角色关系/隐藏动机/时间压力/伏笔）
> - [ ] 无"复述画面"的旁白
> - [ ] 结尾节拍真正留悬念或给收束
>
> 5 项必须全部 ✅，否则选"自检不过要重做"。

| Option | label | 适用场景 |
|---|---|---|
| ★ 1 | 通过（自检也过了） | 5 项都 ✅ |
| 2 | 调整某节拍 | 节拍链内容需要改 |
| 3 | 改结尾方向 | 结尾节拍要换 |
| 4 | 旁白自检不过要重做 | 5 项里有任意一项 ❌ — **回 STEP 2 改节拍链/旁白通道职责/配比，不要带到 STEP 5** |

---

## CHECKPOINT 3 — Final Spec Confirmation (STEP 3 end) [v2.0: 4 大硬关卡入卡]

> **Project Lock Card** 整理好了：
> - 剧名：<title>
> - 画幅 / 时长 / 字幕 / 平台：<...> / <...> / <...> / <...>
> - 题材轨道：<track>
> - 视觉：3D 漫剧渲染（<sub_mode>）
> - 旁白音色：<voice_name> (<voice_id>) — 性别匹配：<ok>
> - 后端：平台当前可用的视频能力（10s 模式）
> - 镜头数目标：<N>（3D 漫剧单镜更长，镜数比 2D 少）
> - 旁白 / 对白比例：60% / 40%
> - **3D 漫剧资产计划**：每主要角色 = 1 主卡 + 1 三视图（正/侧/背）；每主要场景 = 1 主卡 + 1 辅卡
> - **重置锚周期**：主角每 4 镜 / 配角每 6 镜 / 场景每 5 镜
> - **剧情不删减规则 [HARD GATE]**：原剧本每个剧情点都保留
> - **画布门禁 [HARD GATE]**：核心资产和最终规格都在画布上
> - **用户语言跟随 [HARD GATE]**：所有用户面向输出跟随 <user_language>
>
> 这一步锁了就不要轻易改。是否通过？

| Option | label |
|---|---|
| ★ 1 | 通过 |
| 2 | 调整画幅时长 |
| 3 | 调整题材轨道 |
| 4 | 调整视觉子模式 |
| 5 | 调整旁白音色 |

---

## CHECKPOINT 4 — Core Asset Pick (STEP 4) [v2.0: +三视图/辅卡 +画布门禁]

> 关键资产清单（按出现频率排）：
> 1. <核心资产 1> — 出现 N 镜
> 2. <核心资产 2> — 出现 N 镜
> 3. <核心资产 3> — 出现 N 镜
> 4. ...
>
> **3D 漫剧每个主要角色需要：1 张主卡 + 1 张三视图（正/侧/背）**
> **3D 漫剧每个主要场景需要：1 张主卡 + 1 张辅卡（远景/近景）**
>
> 先批哪几张图？

| Option | label |
|---|---|
| ★ 1 | 主角主卡 + 主角三视图 + 最高复用场景主辅卡（推荐） |
| 2 | 全部核心资产一起出 |
| 3 | 只出主角，其他后补 |
| 4 | 调整资产清单 |

After the batch, ask once more:
> 这批设定图通过吗？（**生成物已放到画布** [v2.0 画布门禁]）

| Option | label |
|---|---|
| ★ 1 | 通过，继续 |
| 2 | 某张重做 |
| 3 | 整体调色 / 调线 |
| 4 | 三视图某角度重做（3D 漫剧特有） |

---

## CHECKPOINT 5 — Storyboard Confirmation (STEP 5 end) [v2.0: 旁白字数预估前置]

> 分镜已写好（<N> 镜）。每镜都包含：节拍角色、时长、场景角色、走位、旁白/对白时间窗、起始/结束状态、风格块、**first_frame（含角度匹配）**、**narration_word_count / narration_predicted_duration**。
>
> 完整表格已附在画布上。是否通过？

| Option | label |
|---|---|
| ★ 1 | 通过 |
| 2 | 调整某镜 |
| 3 | 调整某段对白 |
| 4 | 调整节奏（增删镜） |
| 5 | 调整某镜的 first_frame 角度（3D 漫剧特有） |
| 6 | 某镜旁白字数超上限要拆（narration-first 护栏 2/3） |

---

## CHECKPOINT 5.5 — Script Reconciliation (STEP 5.5 end) [v2.0 新增]

> **STEP 5.5 剧本对账**（剧情不删减 [HARD GATE]）：
>
> | plot_point | text | covered_by_shot | status |
> |---|---|---|---|
> | P001 | <...> | <shot> | ✅/❌/⚠️ |
> | P002 | <...> | — | ❌ |
> | P003 | <...> | <shot> | ✅ |
> | ... | ... | ... | ... |
>
> 总计：✅ <N> 条，❌ <N> 条，⚠️ <N> 条。
>
> **每条 ❌/⚠️ 必须用一次 question 决定（补/并/删/移）**。

For each ❌/⚠️:

| Option | label | 何时选 |
|---|---|---|
| ★ 1 | 补一个分镜 | 漏的剧情点必须保留 |
| 2 | 合并到相邻分镜 | 内容能融进现有镜 |
| 3 | 用户明确删 | 用户自己说这段不要了 |
| 4 | 移到下一集 | 这一集讲不下，下一集接 |

> 全部 ❌/⚠️ 处理完才能进 STEP 5.6。漏的剧情点超过 20% 还强行进 STEP 5.6 是硬关卡违反。

---

## CHECKPOINT 5-pre — Narration Word-Count Pre-Check (STEP 5 end) **[narration-first Guardrail 2/3, v2.0 强化]**

> **为什么必须有这条护栏**：STEP 5.6 改写旁白会磨掉剧情，所以旁白字数要在 STEP 5 就卡死。
>
> 分镜表如下（每镜旁白都标注 `narration_word_count` 和 `narration_predicted_duration`）：
>
> | shot_id | 旁白文本 | 字数 | 预估时长 | 镜头时长 | 字数 vs 上限 | 判定 |
> |---|---|---|---|---|---|---|
> | 01 | <...> | <N> | <Xs> | <Ys> | <N>/28 (普通) / 32 (关键) / 36 (大段) | ✅/⚠️/🔴 |
> | 02 | <...> | <N> | <Xs> | <Ys> | ... | ... |
> | ... | ... | ... | ... | ... | ... | ... |
>
> **判定规则**：
> - 字数 ≤ 上限 ✅ — 进 STEP 5.6
> - 字数 > 上限 ⚠️ — **必须拆**（移到下一镜 / 改对白 / 改动作）
> - 字数 > 上限 × 1.3 🔴 — **回 STEP 2 改节拍链**（这段旁白承载了太多支点）
>
> 预估公式：`predicted_duration = chinese_word_count × 0.25s + 0.3s start-buffer`（基于 STEP 0 锁定的 voice_id，speed=1.0，≈4 字/秒）

| Option | label | 适用场景 |
|---|---|---|
| ★ 1 | 通过（所有 ✅） | 全部旁白在字数上限内 |
| 2 | 调整某镜（⚠️ 拆旁白） | 某镜字数超上限，移到下一镜或改对白 |
| 3 | 回 STEP 2 改节拍链（🔴） | 某镜字数远超上限，承载了太多剧情支点 |
| 4 | 调整某段对白 | 顺带调整对白让旁白更紧凑（仅在旁白确实有冗余时） |

---

## CHECKPOINT 5.6 — Schedule-First Alignment (STEP 5.6 end) [v2.0.2: schedule-first rewrite]

> **v2.0.2 关键变化**: STEP 5.6 不只生成旁白音频，**也生成对白 TTS 预演**（仅用于量时长）。所有音频时间表都排好，锁成 `shot_audio_schedule`。STEP 6 prompt 引用这张表。
>
> `shot_audio_schedule` 概览：
>
> | shot_id | duration | narration_window | dialogue_window | buffer | total | fits |
> |---|---|---|---|---|---|---|
> | 01 | 8.0s | [0.0, 3.6] | — | 0.0 | 3.6 | ✅ |
> | 02 | 8.0s | [0.0, 3.4] | — | 0.0 | 3.4 | ✅ |
> | 03 | 7.0s | [0.0, 2.8] | [3.3, 5.1] | 0.5 | 5.6 | ✅ |
> | 04 | 8.0s | [0.0, 4.1] | — | 0.0 | 4.1 | ✅ |
> | 05 | 9.0s | [0.0, 4.0] | [4.5, 6.4] | 0.5 | 6.9 | ✅ |
>
> **判定规则**（剧情完整优先）：
> - ✅ 直接进 STEP 6（旁白 + 对白 TTS 都已生成、schedule 锁定）
> - ⚠️ 优先调整镜头时长（不伤剧情）
> - 🔴 必须回 STEP 5 改分镜
>
> **TTS 双轨**：
> - 旁白音频：锁定的 `audio/shot_NN_narration.mp3`（最终成片用）
> - 对白 TTS 预演：`audio/_preview/shot_NN_dialogue_<speaker>_preview.mp3`（**仅量时长，STEP 6.5 后可删**）

For each ⚠️:

| Option | label | 文本是否改动 |
|---|---|---|
| ★ 1 | 调整镜头时长（拉长/缩短 1-3s） | ❌ 不动 |
| 2 | 拆给下一镜（回 STEP 5 改分镜） | ❌ 不动 |
| 3 | 改写旁白/对白文本（仅在有废话时） | ⚠️ 红线选项 |
| 4 | 接受当前情况（不推荐） | ❌ 不动 |

For each 🔴, do NOT ask the user in STEP 5.6 — explicitly go back to STEP 5 (see SKILL.md STEP 5.6.3 for the 4-option list).

---

## CHECKPOINT 6 — Generation Pass Confirmation (STEP 6, before each batch) [v2.0: +画布门禁]

> 下一批是「<角色主卡 / 角色三视图 / 场景主卡 / 场景辅卡 / 道具卡 / 镜头视频>」共 <N> 项，预计消耗较多积分。继续吗？

| Option | label |
|---|---|
| ★ 1 | 继续生成 |
| 2 | 先看当前产物（如果有） |
| 3 | 暂停调整 |

After a batch:
> 这一批通过吗？（**生成物已放到画布** [v2.0 画布门禁]）

| Option | label |
|---|---|
| ★ 1 | 通过 |
| 2 | 某项重做 |
| 3 | 调整风格块 |
| 4 | 三视图某角度重做 / 场景辅卡重做（3D 漫剧特有） |

---

## CHECKPOINT 6.5 — Dialogue Micro-Adjust (STEP 6.5, v2.0.2 兜底) [v2.0.2: from primary to fallback]

> **v2.0.2 关键变化**: 因为 STEP 5.6 预排了 `shot_audio_schedule` 并嵌进 STEP 6 prompt，H3 命中计划时间窗的概率从 ~20% 升到 ~80%。**STEP 6.5 现在是兜底**。
>
> STEP 6 视频全部生成后，实测对白时长 vs `shot_audio_schedule.dialogue_window`：
>
> | shot_id | dialogue_window | dialogue_actual | drift | action |
> |---|---|---|---|---|
> | 03 | [3.3, 5.1] | 5.6s → [3.3, 5.6] | +0.5s | ✅ 接受，软更新 schedule |
> | 04 | [4.0, 6.4] | 7.5s → [4.0, 7.5] | +1.1s | ⚠️ 拉长该镜 |
> | 07 | [3.3, 5.1] | 8.2s → [3.3, 8.2] | +3.1s | 🔴 回 STEP 5 改分镜 |
>
> **v2.0.2 目标**: ≤ 20% 的镜头需要微调（v2.0.1 是 ~80%）
>
> 是否通过？

| Option | label | 适用场景 |
|---|---|---|
| ★ 1 | 通过（所有 ✅） | 漂移都在 1s 内，软更新 schedule |
| 2 | 拉长某镜（⚠️ 1-2.5s 漂移） | 该镜时长延长 1-2.5s |
| 3 | 拆对白到下一镜（⚠️ 1-2.5s 漂移） | 对白拆给下一镜承载 |
| 4 | 回 STEP 5 改分镜（🔴 > 2.5s 漂移） | 该镜对白承载了太多，必须回 STEP 5 改分镜 |

---

## CHECKPOINT 7 — Final Cut Preview (STEP 7 end) [v2.0.4 加 3 选项]

> 成片已装配好（含旁白、对白、字幕、节奏）。时长 M 分钟。
>
> **剧情不删减 [HARD GATE]**：原剧本每个剧情点都保留 ✅
> **画布门禁 [HARD GATE]**：核心资产都在画布上 ✅
> **用户语言跟随 [HARD GATE]**：输出语言 = <user_language> ✅
> **口型约束 [HARD GATE]**：单镜单说话者，旁白不触发口型 ✅
> **BGM 后置+独立资产 [HARD GATE]**：无 BGM 版是必交付 ✅
> **闪避硬约束 [HARD GATE]**：闪避只用于环境音/SFX，不能代替分离说话声 ✅
>
> 是否通过？

| Option | label |
|---|---|
| ★ 1 | 通过 |
| 2 | 调整某段旁白速度 |
| 3 | 替换某段对白 |
| 4 | 调换镜头顺序 |
| 5 | 调 BGM（追加 BGM 版，**不覆盖无 BGM 版**） |
| 6 | 调音量闪避 |
| 7 | 修复口型错位（单镜单说话者规则违反） |

---

## CHECKPOINT 8 — Delivery Wrap-Up (STEP 8 end) [v2.0: 加 4 行]

Use a non-question format (this is a final summary, not a prompt). **Must be in user's current language.**

Template:

> 🎬 第 X 集完成，共 N 镜，总时长 M 分钟
> - 视觉：3D 漫剧渲染（<sub_mode>）
> - 旁白音色：<voice_name> (<voice_id>)
> - 后端：平台当前可用的视频能力（10s 模式）
> - 锚点：主角每 4 镜/配角每 6 镜/场景每 5 镜重置一次；三视图（正/侧/背）+ 场景辅卡支撑运镜
> - 流水线：narration-first（旁白先生成，STEP 6 按真实时长拍镜头）
> - 剧情：原剧本 100% 保留（无删减/压缩/改写）
> - 旁白对白：全镜非重叠（默认）
> - 下一步建议：<一键出下一集 / 调 BGM / 出 3 平台投流剪辑 / 调整画幅出海>

---

## Notes for the Skill Runner

- **Always show the current project state** in the question body (title, voice, style, etc.) so the user can confirm in context.
- **Always include a recommendation** (★ option).
- **Always offer an "Other / 自定义" option** in the form's `Other` field.
- **Never re-ask a question** the user already answered. If the user already locked the narrator voice in STEP 0 of episode 1, episode 2 should *suggest* the same voice, not re-ask.
- **Skip a checkpoint gracefully** if its precondition isn't met.
- **Be terse** in the option labels — 2–6 字 in Chinese, 3–8 words in English. Long labels hide on mobile.
- **3D manhua specific**: at CHECKPOINT 4 and 6, the asset batch always includes the multi-angle extras (three-view sheet / auxiliary scene card). Surface this in the question body so the user understands the extra cost upfront.
- **3D manhua specific**: at CHECKPOINT 5, the storyboard review should also flag the first_frame angle match for each shot — the user can catch angle mismatches here before the expensive generation pass.
- **v2.0.3 ULF rule (full enforcement)**: every `question` call (options, descriptions, defaults, placeholders) MUST be in `user_language`. The Option `id`, question header keys, and internal labels stay in machine-readable format (English keys), but the `label` field is the user-visible text and MUST match `user_language`. See `references/user-language-rules.md` for the complete spec.
- **v2.0 canvas-gate rule**: every "asset generated" or "asset approved" checkpoint MUST mention the canvas placement explicitly, so the user knows the canvas gate is active.
- **v2.0 story-preservation rule**: every "storyboard / spec" checkpoint MUST show the `plot_point_refs` linkage to `script_reconciliation_table` so the user can verify no plot point was silently dropped.
- **v2.0.2 schedule-first rule**: every "shot / schedule" checkpoint MUST show the `shot_audio_schedule` linkage and confirm `fits_in_shot: true`.

---

## ULF Rules per Checkpoint (v2.0.3 new section)

Every CHECKPOINT in this file follows the same ULF rules. Below is the per-CHECKPOINT application:

| Checkpoint | Question text | Options | Description | Default ★ | Internal ID | Post-resolve message |
|---|---|---|---|---|---|---|
| 0.1 (Starting Path) | user's language | user's language | user's language | user's language | "starting_path" | user's language |
| 0.2 (Genre Track) | user's language | user's language | user's language | user's language | "genre_track" | user's language |
| 0.3 (Format Lock) | user's language | user's language | user's language | user's language | "format_lock" | user's language |
| 0.4 (Visual Sub-Mode) | user's language | user's language | user's language | user's language | "visual_sub_mode" | user's language |
| 0.5 (Narration Voice) | user's language | voice preset label uses **platform's localized name** for `user_language` | user's language | user's language | "narrator_voice_id" | user's language: "Locked `抖音解说男声` (the locked catalog narrator voice) for the full episode" |
| 1 (Story Read) | user's language | n/a | user's language | user's language | n/a | user's language |
| 2 (Beat Chain + 旁白自检) | user's language | user's language | user's language | user's language | n/a | user's language |
| 3 (Final Spec) | user's language | user's language | user's language | user's language | n/a | user's language |
| 4 (Core Asset Pick) | user's language | user's language | user's language | user's language | n/a | user's language: "Asset placed on canvas for review" |
| 5 (Storyboard) | user's language | user's language | user's language | user's language | n/a | user's language |
| 5.5 (Script Reconciliation) | user's language | user's language | user's language | user's language | n/a | user's language |
| 5-pre (Narration Word-Count) | user's language | user's language | user's language | user's language | n/a | user's language |
| 5.6 (Schedule-First Alignment) | user's language | user's language | user's language | user's language | n/a | user's language |
| 6 (Generation Pass) | user's language | user's language | user's language | user's language | n/a | user's language: "Asset batch placed on canvas" |
| 6.5 (Dialogue Micro-Adjust) | user's language | user's language | user's language | user's language | n/a | user's language |
| 7 (Final Cut Preview) | user's language | user's language | user's language | user's language | n/a | user's language |
| 8 (Delivery Wrap-Up) | n/a (this is a final summary, not a question) | n/a | n/a | n/a | n/a | **the entire 🎬 template is in `user_language`** — see CHECKPOINT 8 below for the language-aware template |

**Practical implementation note**: when running this Skill, the Skill runner (human or AI) should first detect `user_language` from the user's first message, then for each CHECKPOINT:

1. Generate the question text in `user_language` (use the template below as a guide, but translate to `user_language`)
2. Generate the option `label` fields in `user_language`
3. Keep the option `id` (machine-readable) in English
4. Default ★ may also be in `user_language` (e.g. Chinese "通过" or English "Pass")
5. After resolution, post a short message in `user_language` confirming the lock

**Example in Chinese (user_language = zh-CN)**:
- Question: "你的起点是？"
- Options: `从零开始（只有故事想法）` / `半成品素材` / `完整素材`
- Default ★: `从零开始（只有故事想法）`
- Internal ID: `starting_path` (English, machine-readable)

**Example in English (user_language = en-US)**:
- Question: "What's your starting point?"
- Options: `From scratch (only a story idea)` / `Partial materials (script fragment / character sketch / reference image)` / `Complete materials (finished character sheets + scenes + full script)`
- Default ★: `From scratch (only a story idea)`
- Internal ID: `starting_path` (English, machine-readable)

**Example in Japanese (user_language = ja-JP)**:
- Question: "スタート地点は？"
- Options: `ゼロから始める（ストーリーのアイデアのみ）` / `部分的な素材` / `完全な素材`
- Default ★: `ゼロから始める（ストーリーのアイデアのみ）`
- Internal ID: `starting_path` (English, machine-readable)

The `id` field stays English across all languages. Only the `label` and `description` are translated.

## CHECKPOINT 8 — Delivery Wrap-Up (per-language templates)

> **ULF v2.0.3 requirement**: the 🎬 delivery template MUST be in `user_language`. The template below shows the Chinese version (default for `user_language = zh-CN`); for other languages, translate the prose but keep the emoji and structure.

### Template (zh-CN default)

> 🎬 第 X 集完成，共 N 镜，总时长 M 分钟
> - 视觉：3D 漫剧渲染（<sub_mode>）
> - 旁白音色：<voice_name> (<voice_id>)
> - 后端：平台当前可用的视频能力（10s 模式）
> - 锚点：主角每 4 镜/配角每 6 镜/场景每 5 镜重置一次；三视图（正/侧/背）+ 场景辅卡支撑运镜
> - 流水线：schedule-first（旁白+对白时间表先排，STEP 6 按计划时间窗拍镜头）
> - 剧情：原剧本 100% 保留（无删减/压缩/改写）
> - 旁白音量：<narrator_volume>（默认 1.8，嘈杂环境也能听清）
> - 旁白对白：全镜非重叠（默认）
> - 下一步建议：<一键出下一集 / 调 BGM / 出 3 平台投流剪辑 / 调整画幅出海>

### Template (en-US)

> 🎬 Episode X complete, N shots, total M minutes
> - Visual: 3D manhua render (<sub_mode>)
> - Narrator voice: <voice_name> (<voice_id>)
> - Backend: 平台当前可用的视频能力 (10s mode)
> - Anchors: protagonist every 4 shots / supporting every 6 shots / scene every 5 shots; three-view sheet (front/side/back) + scene auxiliary card support camera moves
> - Pipeline: schedule-first (narration + dialogue time tables pre-planned, STEP 6 films to planned windows)
> - Story: 100% of original script preserved (no deletion/compression/rewrite)
> - Narrator volume: <narrator_volume> (default 1.8, audible in noisy environments)
> - Narration/dialogue: non-overlapping in all shots (default)
> - Next-step suggestion: <one-click next episode / adjust BGM / 3-platform ad clips / adjust aspect ratio for overseas>

### Template (ja-JP)

> 🎬 第 X 話完成、N カット、総再生時間 M 分
> - ビジュアル：3D マンチュアニメーション（<sub_mode>）
> - ナレーター：<voice_name> (<voice_id>)
> - バックエンド：平台当前可用的视频能力（10s モード）
> - アンカー：主人公 4 カット毎 / 脇役 6 カット毎 / シーン 5 カット毎；3 面図（正面/側面/背面）+ シーン補助カードでカメラ移動をサポート
> - パイプライン：schedule-first（ナレーション+ dialogue のタイムテーブルを先に組み、STEP 6 で計画通りに撮影）
> - ストーリー：原作台本の 100% を保持（削除/圧縮/書き換えなし）
> - ナレーション音量：<narrator_volume>（デフォルト 1.8、騒音環境でも聞き取れる）
> - ナレーション/dialogue：全カット重複なし（デフォルト）
> - 次のステップ提案：<次話一键作成 / BGM 調整 / 3 プラットフォーム広告クリップ / 海外向け比率調整>
