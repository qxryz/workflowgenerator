# Style Presets — 2D Cel-Shaded / Chinese-Animation Webtoon

This file is the **single source of truth** for the visual style of this Skill. The visual style is **locked** to 2D cel-shading + Chinese-animation webtoon language. Within that family, the user picks one of three sub-modes in STEP 0.

If a shot or asset would need a non-2D look, stop and surface the conflict to the user — do not silently drift.

## Locked Family (do not break)

- **Always 2D** — hand-drawn / cel / webtoon language. No 3D rendering, no photoreal, no live-action.
- **Always flat / cel-shaded fills** — flat color + cel highlights, not gradient-heavy "cinematic" shading.
- **Always stylized characters** — not photo-anatomy; faces are simplified.
- **Always clean line art** — bold black or dark outline, no sketch-only no-outline look.
- **Always panel-aware composition** — frames should feel like a webtoon / manhua panel, even in motion.
- **Never bake unwanted text, watermark, or background music** into the rendered shot.

## Sub-Mode 1: 国漫 webtoon 流 (default)

**Closest references**: 国漫条漫 / 漫剧分镜感（《恶毒女配觉醒记》《魔尊要抱抱》《王爷别过来》类国漫短剧）
**Default for**: 都市悬疑 / 古风穿越 / 逆袭 / 都市情感 / 末世 / 惊悚

### Visual DNA
- Clean **bold black** outlines, slightly thicker on foreground characters
- **Flat color fills** with 1–2 cel highlights (no gradient airbrushing)
- **Strong light/shadow contrast** (hard cel shadows, not soft)
- **Webtoon panel composition** — vertical-scroll-friendly framing, often 9:16
- Backgrounds have **simplified painterly fills** with one or two focal accents, no full photoreal scenery
- Emotion conveyed through **sweat drops, motion lines, impact frames, sparkle effects** (webtoon vocabulary)
- Color logic: dramatic; one warm / cool dominance per scene

### Prompt Block (paste into every image/video prompt)

```
2D cel-shaded animation, Chinese-animation webtoon style, clean bold black outlines, flat color fills with cel highlights, dynamic panel composition, dramatic light/shadow contrast, vertical-scroll-friendly framing, expressive webtoon-style emotion cues (sweat drops, motion lines, impact frames), no 3D, no photoreal, no live-action, no watermark, no baked-in text
```

### Per-Shot Sub-Block Examples

- **Mid-shot dialogue**:
  > `[shot content]`, 2D cel-shaded animation, Chinese-animation webtoon style, clean bold black outlines, flat color fills with cel highlights, dynamic panel composition, dramatic light/shadow contrast, vertical-scroll-friendly framing, no 3D, no photoreal, no live-action, no watermark, no baked-in text
- **Establishing shot (city / palace / campus)**:
  > `Wide establishing shot of [location]`, 2D cel-shaded animation, Chinese-animation webtoon style, bold black outlines on architecture, flat color fills with cel highlights, dramatic light/shadow contrast, webtoon panel composition with strong vertical lines, no 3D, no photoreal, no live-action, no watermark, no baked-in text
- **Emotional close-up (crying / angry / shocked)**:
  > `Close-up of [character] with [emotion]`, 2D cel-shaded animation, Chinese-animation webtoon style, clean bold black outlines, flat color fills with cel highlights, expressive webtoon-style emotion cues (sweat drops / impact frames / sparkling tears), dramatic light/shadow contrast, no 3D, no photoreal, no live-action, no watermark, no baked-in text

---

## Sub-Mode 2: 日漫赛璐珞流

**Closest references**: 《鬼灭之刃》《咒术回战》《葬送的芙莉莲》类日式 TV 动画
**Default for**: 校园 / 奇幻冒险 / 治愈 / 少年向热血

### Visual DNA
- **Clean dark line art**, slightly thinner than 国漫 webtoon 流
- **Flat fills with subtle gradients** in some panels (more painterly than 国漫)
- **Softer cinematic lighting** — less hard cel shadow, more atmospheric
- Anime proportions: **larger eyes, smaller face ratio**, sharp jaw / soft features depending on character
- Camera work: more **classical anime shot grammar** (speed lines, dramatic angles, rim light)
- Emotion: more **subtle facial micro-expressions**; sweat drops and impact frames are still used but less heavy

### Prompt Block (paste into every image/video prompt)

```
2D cel-shaded anime, Japanese TV-anime cel style, soft cinematic lighting, clean dark line art, anime proportions, flat fills with subtle gradients, expressive anime micro-expressions, no 3D, no photoreal, no live-action, no watermark, no baked-in text
```

### Per-Shot Sub-Block Examples

- **Mid-shot dialogue**:
  > `[shot content]`, 2D cel-shaded anime, Japanese TV-anime cel style, soft cinematic lighting, clean dark line art, anime proportions, flat fills with subtle gradients, no 3D, no photoreal, no live-action, no watermark, no baked-in text
- **Action shot**:
  > `[action content]`, 2D cel-shaded anime, Japanese TV-anime cel style, dynamic angle, speed lines, rim light, clean dark line art, anime proportions, no 3D, no photoreal, no live-action, no watermark, no baked-in text

---

## Sub-Mode 3: 轻彩漫 webtoon 流

**Closest references**: 韩国 Webtoon 风格的全彩漫（《Lookism》《Eleceed》类）+ 国漫彩漫短篇
**Default for**: 轻松向 / 校园 / 都市 / 治愈 / 节奏轻快的甜虐

### Visual DNA
- **Flat color fills, minimal shading** (almost no cel shadow)
- **Bold line art, often with thicker foreground outlines**
- **Panel-driven composition** — frames often echo a comic panel layout
- Characters look **slightly more stylized / chibi-tinged** than 国漫 webtoon 流
- Backgrounds: **bright, clean, simple**, with strong focal accents
- Emotion: very readable, large reaction shots, sparkle/star effects common

### Prompt Block (paste into every image/video prompt)

```
2D webtoon / manhua full-color style, flat color fills, minimal shading, panel-driven composition, bold line art, bright clean backgrounds, expressive reaction shots, no 3D, no photoreal, no live-action, no watermark, no baked-in text
```

### Per-Shot Sub-Block Examples

- **Reaction close-up**:
  > `[reaction content]`, 2D webtoon / manhua full-color style, flat color fills, minimal shading, bold line art, expressive reaction shot, no 3D, no photoreal, no live-action, no watermark, no baked-in text
- **Establishing shot (bright day)**:
  > `[location]`, 2D webtoon / manhua full-color style, flat color fills, minimal shading, bold line art, bright clean palette, no 3D, no photoreal, no live-action, no watermark, no baked-in text

---

## Style Drift Watch List (stop and surface, do not silently fix)

If a generated shot shows any of the following, mark it for repair **before** moving to the next batch — do not let style drift accumulate.

- ❌ **3D / CGI look** — volumetric lighting, ray-traced reflections, Pixar-like rendering
- ❌ **Photoreal / live-action** — skin pores, lens flares, real-world photographic texture
- ❌ **Watercolor / gouache / oil-painting drift** — visible brush texture, no clean line art
- ❌ **Ink-wash / 水墨 drift** — sumi-e brush effects, no clean cel fill
- ❌ **No-outline drift** — soft / airbrushed look with no visible line art (acceptable for *backgrounds only*, not for characters)
- ❌ **Half-style drift** — some elements 2D, some 3D in the same frame (mixing 2D character with 3D prop / background)
- ❌ **Watermark / text baked in** — accidental logos, platform watermarks, generation tool text
- ❌ **Cross-sub-mode drift** — 国漫 webtoon 流 in one shot, 日漫赛璐珞 流 in the next (unless the user explicitly asked for style change between scenes)

When style drift is detected, the **first** repair variable to change is the **prompt's style block** — make it more emphatic, add a "strictly 2D" qualifier, or explicitly forbid 3D. Re-running the same prompt usually fails the same way.

---

## Continuity Block (paste after the style block, before shot content)

To keep identity stable across shots, append a continuity block that names the locked character/scene:

```
[continuity anchors: protagonist wearing [exact wardrobe], hair in [exact style], face shape [exact description]; scene layout [exact layout description]; lighting direction [left/right/top/etc]; color palette [warm/cool/neutral]]
```

This block stays the same across every shot of a character/scene; only the **action / camera** change.

## Quick Style Comparison (for the user in STEP 0)

| | 国漫 webtoon 流（默认） | 日漫赛璐珞流 | 轻彩漫 webtoon 流 |
|---|---|---|---|
| 描边 | 粗黑/深色 | 较细深色 | 粗黑（前景更粗） |
| 上色 | 平涂 + 1–2 处高光 | 平涂 + 微妙渐变 | 平涂，少量阴影 |
| 光影 | 强对比 | 较柔 | 弱 / 极简 |
| 人物比例 | 偏写实国漫 | 偏 anime | 偏 chibi 一点 |
| 情绪表达 | 重——汗珠、冲击框、闪光 | 细腻——微表情 | 夸张——大反应、星光 |
| 最适合 | 剧情/悬疑/逆袭/古风 | 校园/奇幻/热血 | 轻松/甜虐/校园 |
