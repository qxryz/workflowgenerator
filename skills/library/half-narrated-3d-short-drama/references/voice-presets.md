# Voice Presets — Narration Voice for 3D Manhua Half-Narrated Short Drama (v2.0)

This file is the **single source of truth** for narrator voice selection. The Skill surfaces the curated Douyin-narration-style preset list in STEP 0; the user picks one and that `voice_id` is locked for the entire episode (and ideally the entire series).

**The two top-priority presets are 抖音解说男声 and 抖音解说女生.** The Skill must highlight these two first in STEP 0 Question 5, and pick the right one based on the genre track chosen in STEP 0 Question 2.

The narration voice is **fully decoupled from visual style** — the same voice list works for 2D, 3D, live-action, or any other visual track. This file is intentionally aligned with the 2D skill's voice-presets.md for consistency across the user's skill matrix.

### Voice preset label localization (v2.0.3)

The `voice_id` column is **machine-readable** and stays English (the locked catalog narrator voice etc.). The `voice_preset_label` column is **user-visible** and uses the platform's localized display name based on `user_language`:

| `user_language` | voice_preset_label for the locked catalog narrator voice | voice_preset_label for the selected catalog narrator voice |
|---|---|---|
| `zh-CN` (default) | 抖音解说男声 | 抖音解说女生 |
| `en-US` | Douyin Narrator (Male) | Douyin Narrator (Female) |
| `ja-JP` | Douyin ナレーター (男性) | Douyin ナレーター (女性) |
| `ko-KR` | Douyin 내레이터 (남성) | Douyin 내레이터 (여성) |

Rule: always use the platform's localized name if available; otherwise fall back to the Chinese name (the canonical / original name). Never translate `voice_id`.

The full platform voice catalog is wider than this list — do not surface all of them by default.

## Top-2 Douyin narration presets (the two most-used)

| # | User-facing label | voice_id | 风格 | 适合题材 |
|---|---|---|---|---|
| **★ 1** | **抖音解说男声（推荐默认）** | the locked catalog narrator voice | 沉稳、清晰、解说感强；最像抖音热门剧情号男旁白 | 都市悬疑 / 逆袭 / 末世 / 惊悚 / 古风玄幻 / 异世界冒险 / 通用 |
| **★ 2** | **抖音解说女生（推荐默认）** | the selected catalog narrator voice | 偏新闻播报但作为女声版最贴"女解说"——清晰、稳重、距离感适中 | 都市情感 / 校园 / 治愈 / 女频逆袭 / 女频古风 |

**The Skill must default to one of these two.** If the user does not pick, the Skill picks the one that matches the genre track chosen in STEP 0 Q2 (see auto-recommend table below). Only if both are explicitly refused does the Skill fall back to the broader preset list.

## Genre-driven auto-recommend table (based on STEP 0 Q2)

When STEP 0 Question 2 (genre track) is answered, the Skill automatically highlights the matching voice in Question 5's option list (as the ★ default). The user can still pick any other option.

| Genre track (STEP 0 Q2) | Auto-recommended voice (★ in Q5) | voice_id | 备选 |
|---|---|---|---|
| 都市悬疑 | 抖音解说男声 | the locked catalog narrator voice | 沉稳高管 |
| 古风玄幻 | 抖音解说男声 | the locked catalog narrator voice | 温润男声 / 抖音解说女生 |
| 都市情感 | **抖音解说女生** | the selected catalog narrator voice | 温润男声 |
| 校园青春 | **抖音解说女生** | the selected catalog narrator voice | 青年大学生 |
| 逆袭成长 | 抖音解说男声 | the locked catalog narrator voice | 沉稳高管 |
| 末世求生 | 抖音解说男声 | the locked catalog narrator voice | 抖音解说女生 |
| 异世界冒险 | 抖音解说男声 | the locked catalog narrator voice | 沉稳高管 |
| 自定义 | 抖音解说男声（默认） | the locked catalog narrator voice | （让用户挑） |

**Rule of thumb**:
- **男频题材**（悬疑 / 权谋 / 战斗 / 惊悚 / 末世 / 异世界冒险）→ 推男声
- **女频题材**（情感 / 校园 / 治愈）→ 推女声
- **古风 / 通用** → 默认推男声，用户可切女声

## Full curated Douyin-style preset list (shown in STEP 0)

The full list shown in STEP 0 Question 5. The top-2 above are always shown first; the rest are sorted by likelihood of being needed.

| # | User-facing label | voice_id | 风格 | 推荐场景 |
|---|---|---|---|---|
| ★ 1 | **抖音解说男声** | the locked catalog narrator voice | 沉稳、清晰、解说感强 | 男频 / 通用默认 |
| ★ 2 | **抖音解说女生** | the selected catalog narrator voice | 偏新闻播报的女声，最贴女解说 | 女频 / 情感 / 校园 |
| 3 | 温润男声 | a selected catalog voice | 偏温和，克制 | 古风 / 虐恋 |
| 4 | 沉稳高管 | a selected catalog voice | 偏成熟、权威 | 权谋 / 商战 / 悬疑 |
| 5 | 抖音青年解说 | a selected catalog voice | 真诚青年，更口语化 | 校园口语向 |
| 6 | 青年大学生 | a selected catalog voice | 偏年轻，校园感 | 校园 / 轻喜剧 |
| 7 | 自定义 / 试听 | （用户从完整音色表试听后填写） | — | — |

> **Default per genre = the ★ row matching the genre track chosen in STEP 0 Q2.** If the user does not pick, the Skill uses that ★. Do not re-ask.

## Voice Lock Rules (apply to the entire episode / series)

1. **One voice per episode** — once STEP 0 locks `narrator_voice_id`, every narration clip for every shot must use the same `voice_id`. No mid-episode voice swap.
2. **Speed stays within ±10% of preset default** — if the user wants faster/slower, set a per-episode `narrator_speed` and apply it consistently. Do not vary per shot unless the user asks.
3. **Emotion is per-shot but bounded** — default `neutral`; can be re-tuned per shot at STEP 5.6 (e.g. `surprised` for reveals, `sad` for reveals-with-loss, `angry` for climaxes). Do not flip emotion back and forth on adjacent shots.
4. **Record the preset name in the final spec** — so the user can reuse it on the next episode without re-picking.
5. **Series lock** — if the user is making a series, the same `narrator_voice_id` should be used across every episode for narrator consistency. Surface this in STEP 0 of episode 2+.
6. **Gender-match lock [NEW for v2.0]** — `narrator_gender_match` must be `ok` per the auto-recommend table. Do not force a male voice onto a female-frequency / female-protagonist story.
7. **Narrator volume lock [NEW for v2.0.1]** — `narrator_volume` defaults to 1.8 (range 1.2-2.0). Do not default to 1.0 — that makes narration inaudible in noisy environments and breaks the half-narrated short drama's core function.

## Default TTS Call Snippet

Use this as a starting point for the locked voice. Adjust `text`, `speed`, and `emotion` per shot:

```python
synthesize_speech(
    text="<narration line for this shot>",
    output_file_path="<shot_NN_narration.mp3>",
    voice_id="<locked voice_id from STEP 0>",  # 抖音解说男声/女生/其他
    speed=1.0,  # from STEP 0; per-episode lock
    emotion="neutral",  # per-shot; most shots stay neutral
    volume=1.8,  # [NEW for v2.0.1] 旁白音量比默认大 80%，让"半解说"在嘈杂环境也能听清
    pitch=0,
)
```

For batch generation, use `batch speech synthesis` with one entry per shot's narration line. All entries share the locked `voice_id`, `speed`, and `volume`; only `text`, `output_file_path`, and optionally `emotion` change.

### Narrator volume — 旁白音量 (NEW for v2.0.1)

> **核心问题**: 半解说短剧的旁白承载 60% 的剧情信息（背景/时间跳转/内心），默认 `volume=1.0` 在抖音/红果嘈杂环境（地铁/通勤/外放）下会被对白和环境音压住。**旁白音量必须显著高于默认**，让"解说"功能在 80% 的真实播放场景中成立。

**默认音量**（hardcoded in the snippet above）:

| 元素 | volume | 占比 | 理由 |
|---|---|---|---|
| 旁白 | **1.8** | 180% | 承载 60% 剧情信息，必须在嘈杂环境听清 |
| 对白 | 1.0 | 100% | 默认音量（视频原声） |
| 环境音 / SFX | 0.3-0.5 | 30-50% | 不能盖过旁白和对白 |

**音量范围说明**：平台 `volume` 参数范围 `[0.0, 10.0]`，1.0 是"标准音量"。1.8 = 比默认大 80%，已经在不破音的安全区间（>2.0 容易出现削波失真）。

**用户可调**：如果用户觉得旁白太冲/不够冲，让他们在 CHECKPOINT 3 调 `narrator_volume`（范围 1.2-2.0）：
- 1.2 = 略大 20%（安静环境偏好）
- 1.5 = 大 50%（默认推荐）
- 1.8 = 大 80%（嘈杂环境偏好，**半解说短剧默认**）
- 2.0 = 大 100%（最大安全值，强嘈杂环境）

**反模式**：
- ❌ 旁白和对白都用 1.0 — 旁白被对白压住
- ❌ 旁白 > 2.0 — 容易破音
- ❌ 旁白 < 1.2 — 嘈杂环境听不清，半解说功能废
- ❌ 在 STEP 7 装配时把旁白压小到和对白同音量 — 这正是要避免的

## Anti-Patterns

- ❌ Switching voice_id mid-episode to "match a character arc" — the narrator is one stable voice; do not dramatize the narrator.
- ❌ Boosting speed above 1.2 to fit a long line into a short shot — extend the shot duration first, do not speed up speech.
- ❌ Mixing `male-qn-*` family with `Chinese (Mandarin)_*` family in the same episode.
- ❌ Skipping the preset list and defaulting to whatever the platform API defaults to — the platform default is `male-qn-qingse`, which is **not** a Douyin narration style. Always honor the STEP 0 lock.
- ❌ **Gender mismatch [NEW for v2.0]**: forcing a male voice on a story that strongly implies female narration (e.g. a female-protagonist first-person romance where 抖音解说男声 feels jarring) — use the genre-driven auto-recommend table. If the user explicitly wants the other gender, honor it but warn them.
- ❌ **Default narrator volume = 1.0 [NEW for v2.0.1]**: makes narration inaudible in noisy viewing environments. Always set `narrator_volume=1.8` (or 1.2-2.0 range per user preference) so the half-narrated function survives subway / commute / phone-speaker playback.

## Voice-rebind warning (mid-episode change)

If the user asks to change voice mid-episode or in a later episode:
- **Mid-episode change** → warn the user, **regenerate every narration clip in the episode** (all old clips discarded). Lock re-binds from that moment.
- **Next-episode change** → just update the per-episode `narrator_voice_id`. Past episodes are not affected.
- If the user is on episode 2+ of a series, **default to reusing the previous episode's `narrator_voice_id`** without re-asking.
