# Skill Naming Convention

Covers two fields:

| Field | Location | Notes |
|---|---|---|
| `name` | `SKILL.md` / `SKILL.cn.md` frontmatter | English identifier, also the directory name — all three must match exactly |
| `display-name-zh` | `meta.yaml` | Chinese display name, shown on cards and the detail page |

`name` is immutable once shipped: the client matches install state by directory name, so renaming
creates a brand-new skill. Confirm it before submitting.

---

## 1. `name` (English identifier)

## Core Rules

1. Use lowercase English words separated with `-` (no `_`, spaces, camelCase, or run-on words)
2. Describe the core capability precisely; avoid vague or overly broad names
3. Prefer **`<vertical>-<use case / subject>-<capability verb>`**, for example `short-drama-series-writer`
4. There is no hard character or token limit; preserve business meaning instead of rewriting names for a legacy cap
5. Avoid empty marketing language; `generator`, `creator`, and `maker` are allowed when they accurately distinguish the capability

## 5 Naming Templates

| Type | Template | Examples |
|---|---|---|
| Agent (executing role) | `<domain>-<role>` | `landing-designer`, `blog-writer` |
| Artifact (output-oriented) | `<domain>-<artifact>` | `frontend-slides`, `api-docs` |
| Action (verb / transform) | `<object>-<action>` | `4k-upscale`, `pdf-extract`, `video-trim` |
| Reference (knowledge / spec) | `<topic>-<kind>` | `remotion-best-practices`, `karpathy-guidelines` |
| Tool (integration) | `<tool>-<surface>` | `lark-mail`, `lark-calendar` |

## Selection Order

Pick the single closest fit — don't stack:

1. Has a clear **action** or **artifact** → Action / Artifact (most specific)
2. Has a clear **executing role** → Agent
3. Is knowledge / spec → Reference
4. Wraps a tool → Tool

## Role Vocabulary (Agent type)

Single word, no stacking:

designer / writer / researcher / reviewer / planner / analyst / editor / coder / tester / translator

## Wording to Avoid

| Category | Avoid |
|---|---|
| Marketing puffery | `smart-`, `pro-`, `ultimate-` when they add no concrete capability |
| False universality | `all-in-one-*`, `universal-*` when they hide capability boundaries |
| Overly broad | `video`, `image`, or `creator` alone, without a use case or deliverable |

`assistant`, `tool`, `generator`, `creator`, and `maker` are not hard-banned. Remove them only when
the remaining name is more precise; preserve them when the user confirmed the name or the suffix
distinguishes the capability.

## Good Examples

| Name | Type | Note |
|---|---|---|
| `short-drama-series-writer` | Agent | vertical + subject + writing capability |
| `papercraft-stop-motion-explainer` | Artifact | visual style + explainer deliverable |
| `landing-designer` | Agent | Landing page designer |
| `frontend-slides` | Artifact | Frontend-themed slides |
| `pdf-extract` | Action | PDF extraction |
| `remotion-best-practices` | Reference | Remotion best practices |
| `lark-calendar` | Tool | Lark calendar |

## Ambiguous Boundaries

| Scenario | Pick A | Pick B |
|---|---|---|
| Emphasize "who does it" vs "what's produced" | `blog-writer` (Agent) | `blog-post` (Artifact) |
| Emphasize "what's done" vs "who does it" | `pdf-extract` (Action) | `pdf-extractor` (Agent) |
| Emphasize "spec" vs "execution" | `react-best-practices` (Reference) | `react-reviewer` (Agent) |

## Vertical Prefix

When the same capability shows up across multiple verticals and would be ambiguous without a
prefix, add a vertical prefix, forming `<vertical>-<subject>-<capability>`:

| Name | Why the prefix is needed |
|---|---|
| `short-drama-series-writer` | `series-writer` alone can't distinguish drama / podcast / documentary |
| `ecommerce-image` | `image` alone is far too broad |

The prefix is not the default move — skip it when the capability is already distinctive
(e.g. `4k-upscale`).

---

## 2. `display-name-zh` (Chinese display name)

### Core Rules

1. Prefer the **"use case / subject + core capability"** structure
2. Use concise, understandable Chinese that states what task it completes
3. There is no legacy 10-character hard cap; do not rewrite an approved business name only to pass length validation
4. It need not be a literal translation of `name` — write idiomatic Chinese, keep the semantics aligned

### Banned Wording

| Type | Banned | Why |
|---|---|---|
| Hype / marketing | 神器, 大师, 封神, 一键封神 | Subjective and uninformative |
| False universality | 万能, 全能, 一站式 | Hides the real capability boundary |
| Intensifiers | 超强, 极致, 顶级 | Replaces useful capability information with puffery |

助手, 工具, 机器人, and 生成器 are not hard-banned. Preserve an approved name; suggest removing
such a suffix only when doing so clearly improves precision without changing meaning.

### Good Examples

| Chinese name | Chars | Structure |
|---|---|---|
| 微短剧剧集编剧 | 7 | subject (微短剧剧集) + capability (编剧) |
| 电商商品图 | 5 | subject (电商商品) + artifact (图) |
| 广告创意脑爆 | 6 | use case (广告创意) + capability (脑爆) |
| 口播动画生成 | 6 | subject (口播动画) + capability (生成) |
| 视频卡点剪辑 | 6 | subject (视频) + capability (卡点剪辑) |

### Bad Examples

| Chinese name | Problem |
|---|---|
| 短视频神器 | Hype wording; "神器" says nothing about what it does |
| 万能创意助手 | 万能 + 助手 — zero of the 6 characters carry information |
| AI 智能视频生成工具 | “AI 智能” adds no capability information and the use case is unclear |
| 编剧 | Too broad — which vertical? drama / film / podcast? |
| 广告 | Vertical only, no capability — brainstorm, generate, or edit? |

### When a Name Needs Simplifying

Cut in this order:

1. Remove empty intensifiers (`智能` / `顶级`) first
2. Use a standard industry abbreviation (`电子商务` → `电商`)
3. Keep words that distinguish the deliverable or capability boundary

If the name remains overly broad, narrow or split the Skill instead of mechanically compressing it.
