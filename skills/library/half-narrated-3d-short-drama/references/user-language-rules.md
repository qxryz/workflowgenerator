# User-Language Following (ULF) — Complete Rules (v2.0.3)

This file is the **single source of truth** for the User-Language Following (ULF) hard gate. Every other file in this Skill references this one when in doubt about what to translate and what to preserve.

> **v2.0.3 systemization**: v2.0.1 declared the ULF hard gate in the spec / qc-checklist, but the actual rules were scattered. v2.0.3 consolidates them here and makes them **enforceable** in 12 user-facing scenarios + 5 non-translation boundaries.

## What "user-language following" means in this Skill

> **原则 (Principle)**: The Skill's user-facing output follows the user's current language. The user's own creative content (script, character names, scene names, dialogue) is preserved verbatim. Voice preset labels and field names use the platform's localized display name.

In one line: **skill talks to user in user's language; user's words stay user's words.**

## How user_language is detected

- **Trigger**: the user's first message in the session
- **Detection method**: Mavis runtime auto-detects the user's language (`zh-CN`, `en-US`, `ja-JP`, `ko-KR`, etc.)
- **Fallback**: if undetectable, default to `zh-CN` (the Skill's primary language, since it's optimized for Chinese short-drama content)
- **Stability**: once detected, `user_language` is locked for the entire session unless the user explicitly switches
- **Locked field**: store as `user_language` in `final_video_spec.yaml`

## 12 user-facing scenarios — ULF must apply to ALL of them

| # | Scenario | What gets written in user_language | What stays in original |
|---|---|---|---|
| 1 | `question` options, descriptions, defaults | ALL labels / descriptions / ★ defaults / Other placeholders | internal option `id` keys (machine-readable) |
| 2 | Progress / status updates between steps | "Now generating asset batch 1 of 3..." style messages | internal file paths, asset names |
| 3 | Step completion prompts | "STEP 5 done. Next: STEP 6 — shot generation" | internal step IDs (STEP_5 etc.) |
| 4 | Decision summaries (after `question` resolves) | "You picked: 抖音解说男声 (the locked catalog narrator voice). Locked for the full episode." | `voice_id` (machine-readable) |
| 5 | Script analysis bullet (STEP 1 end) | "5 颗剧情内核 bullet" with full Chinese explanations | `plot_point_refs` (P001 etc.) |
| 6 | Beat chain table (STEP 2 end) | table column headers + content in user language | `beat_role` enum values |
| 7 | Final Spec / Project Lock Card | display fields in user language | technical field names (`visual_style_lock`, `narrator_voice_id`) |
| 8 | Storyboard prompt (the literal text fed to H3) | NOT translated — character / scene / dialogue text from user stays in user's original language | style block (English, machine convention) |
| 9 | STEP 5.5 reconciliation table | column headers + status text in user language | `plot_point` IDs (P001) |
| 10 | `shot_audio_schedule` narrative text | narration / dialogue text in user language (already is — user wrote it) | YAML field names |
| 11 | Error / warning / drift alerts | "对白时长超出计划时间窗 2.4s, 请回 STEP 5 改分镜" | technical identifiers |
| 12 | Final delivery message (STEP 8) | the 🎬 template entirely in user language | `voice_id` / `backend` technical strings |

## 5 boundaries — what is NEVER translated

These preserve the user's creative content and the Skill's technical integrity:

### 1. User-provided text — verbatim

- Character names (`林夏`, `萧珩`, `Mr. Chen`) — keep exactly as the user wrote them
- Scene names (`凤仪宫_正殿`, `林夏_家_客厅`) — keep exactly
- Narration lines (the actual text content) — keep exactly
- Dialogue lines (the actual text content, including punctuation) — keep exactly
- Plot point text (`"我心里想：她一定在骗我。"`) — keep exactly
- Style direction words (`"愤怒"`, `"温柔"`, `"cold"`) — keep in their original language

> **Why**: the user wrote these for a reason. Translating would change the meaning or break the creative intent.

### 2. Voice preset labels — platform's localized name

- `voice_id` (machine-readable): the locked catalog narrator voice — keep as-is
- `voice_preset_label` (user-visible): use the platform's localized display name
  - In `zh-CN`: `抖音解说男声`
  - In `en-US`: `Douyin Narrator (Male)` or `Chinese (Mandarin) Male Announcer`
  - In `ja-JP`: `Douyin ナレーター (男性)`
- **Rule**: use the platform's localization if available; otherwise use the Chinese name (which is the original / canonical name)

### 3. Technical identifiers — machine-readable

- `voice_id`, `backend`, `model_name`, file paths, YAML field names — always English / machine-readable
- These are NOT user-facing; they're internal protocol
- **Rule**: technical identifiers stay English regardless of user language

### 4. Style block content — English (H3 convention)

- The style block fed to H3 (e.g. `3D rendered, Chinese-animation manhua-cel look, ...`) is always English
- H3's training data is primarily English; English style blocks give the most stable output
- **Rule**: H3-facing prompts always English, regardless of user language

### 5. Code snippets and CLI examples

- Technical implementation details are internal and should not be exposed in user-facing copy
- **Rule**: code stays English

## How to handle multi-language scenes in one episode

Sometimes an episode has both Chinese and English dialogue (e.g. a character speaks English with a foreigner). In that case:

- The **skill's output** still follows `user_language` (e.g. all step prompts / summaries in Chinese if user is Chinese)
- The **dialogue text** keeps its original language (e.g. English-speaking character's lines stay English; Chinese-speaking character's lines stay Chinese)
- The `shot_audio_schedule.dialogue[].text` field preserves the original dialogue verbatim
- The `voice_id` for each speaker comes from `dialogue_voice_map`, and that voice can be any language (English speaker uses an English TTS voice)

## 8 quality-control hard gates (qc-checklist)

The ULF hard gate expands from 4 items (v2.0.2) to **8 items** in v2.0.3:

1. **[HARD GATE]** Every `question` call (options, descriptions, defaults, placeholders) is written in `user_language`. Internal `id` keys stay machine-readable.
2. **[HARD GATE]** Every progress update, step-completion message, decision summary, and error / warning is in `user_language`.
3. **[HARD GATE]** Final delivery message (STEP 8) is entirely in `user_language` (the 🎬 template), with technical IDs (voice_id, backend) appended as plain string for reference but not translated.
4. **[HARD GATE]** Exact user-provided text (character names, scene names, narration text, dialogue text, plot point text, style direction words) is preserved verbatim across all outputs. No translation, no paraphrase, no synonym substitution.
5. **[HARD GATE]** Voice preset labels (`voice_preset_label`) use the platform's localized display name matching `user_language`. `voice_id` stays as the platform's machine-readable ID.
6. **[HARD GATE]** Subtitle output language matches the user's `output_language` field in the spec, which by default equals `user_language` unless the user explicitly sets `output_language` to a different target language for distribution.
7. **[HARD GATE]** H3-facing style block stays English (H3's training data is English-dominant; English style blocks produce the most stable output). User-facing prompt explanations are in `user_language`.
8. **[HARD GATE]** When the user speaks in a non-default language, the Skill defaults to following it (no fallback to Chinese). Only when language is undetectable does the Skill default to `zh-CN`.

## STEP 0 user-language setup

The Project Lock Card includes `user_language` as a top-level field. It is locked at the start of STEP 0 (right after language detection) and used by every subsequent STEP.

```yaml
# Project Lock Card
user_language: "zh-CN"  # [NEW for v2.0.3] detected from user's first message; used by all ULF rules
output_language: "zh-CN"  # by default equals user_language; user can override for distribution
```

If the user explicitly wants to publish in a different language (e.g. Chinese user publishing on YouTube Shorts with English subtitles), they set `output_language: "en-US"` while `user_language: "zh-CN"` stays unchanged.

## Per-STEP ULF marker

Every STEP in `SKILL.md` and `SKILL.cn.md` ends with a marker:

```
[ULF] Output this STEP in <user_language>
```

This is a quick visual reminder for the Skill runner (human or AI) to check language before finalizing any user-facing text in that STEP.

## Anti-patterns

- ❌ Translating the user's narration / dialogue text when the user wrote it in their own language
- ❌ Translating character / scene names
- ❌ Translating `voice_id` to a "friendly Chinese name" in code (the platform recognizes `voice_id`, not Chinese)
- ❌ Translating YAML field names (e.g. `narrator_voice_id` → `旁白语音编号` — breaks the field schema)
- ❌ Falling back to Chinese when the user is in English (or any other non-default language) — always follow user_language
- ❌ Writing the question options in English when user is Chinese, or vice versa
- ❌ Mixing languages within a single question call (e.g. option label in Chinese but description in English)
- ❌ Translating the 🎬 delivery template literally — keep the emoji and structure, translate the prose

## How this Skill is structured to make ULF enforceable

| File | Role in ULF |
|---|---|
| `SKILL.cn.md` / `SKILL.md` | STEP 0-8 with `[ULF]` markers at the end of each STEP |
| `references/user-language-rules.md` (this file) | the single source of truth |
| `references/interactive-checkpoints.md` | ULF rules per CHECKPOINT |
| `references/qc-checklist.md` | 8-item ULF hard gate checklist |
| `references/voice-presets.md` | voice_preset_label localization rules |
| `meta.yaml` | `summary-cn` / `summary-en` / `desc-cn` / `desc-en` — platform reads the right one based on user language |

## What changed in v2.0.3 (vs v2.0.2)

| Aspect | v2.0.2 | v2.0.3 |
|---|---|---|
| ULF rules documentation | scattered across files | single `user-language-rules.md` |
| ULF scenarios covered | 4 (question, progress, summary, final reply) | 12 (all user-facing output scenarios) |
| ULF hard gates in QC | 4 items | 8 items |
| Non-translation boundaries | 1 (user text verbatim) | 5 (user text, voice labels, technical IDs, H3 style, code) |
| Subtitle language rule | mentioned in passing | explicit [HARD GATE] #6 |
| Multi-language scene handling | not documented | documented with example |
| `user_language` field in Lock Card | mentioned | top-level locked field with default = detect |
| `output_language` field | did not exist | new (for distribution target) |
| `[ULF]` markers per STEP | not used | used at end of every STEP in SKILL.md / SKILL.cn.md |
