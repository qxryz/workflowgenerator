# Skill 命名规范

覆盖两个字段：

| 字段 | 位置 | 说明 |
|---|---|---|
| `name` | `SKILL.md` / `SKILL.cn.md` frontmatter | 英文标识，同时是目录名 —— 三者必须完全一致 |
| `display-name-zh` | `meta.yaml` | 中文展示名，UI 卡片与详情页显示 |

`name` 一旦确定就不能改：客户端按目录名匹配安装状态，改名等于变成一个全新的 skill。
提交前务必确认。

---

## 一、`name`（英文标识）

## 核心规则

1. 采用小写英文单词，单词之间用 `-` 分隔（禁用 `_`、空格、camelCase、连写）
2. 使用简洁、准确的英文描述核心能力，避免含义模糊或过于宽泛
3. 优先采用 **「垂类 + 使用场景 / 创作对象 + 能力动词」**，例如 `short-drama-series-writer`
4. 不设置字符数或 token 数硬上限；名称长度服从语义完整性，不为过旧的长度规则改写业务名称
5. 避免无信息量的营销词；`generator`、`creator`、`maker` 等词在准确表达能力时可以使用

## 5 类命名模板

| 类型 | 模板 | 例子 |
|---|---|---|
| Agent（执行角色） | `<领域>-<角色>` | `landing-designer`、`blog-writer` |
| Artifact（产物导向） | `<领域>-<产物>` | `frontend-slides`、`api-docs` |
| Action（动作/转换） | `<对象>-<动作>` | `4k-upscale`、`pdf-extract`、`video-trim` |
| Reference（知识/规范） | `<主题>-<类型>` | `remotion-best-practices`、`karpathy-guidelines` |
| Tool（工具集成） | `<工具>-<面>` | `lark-mail`、`lark-calendar` |

## 选型顺序

挑最贴的一个，别叠加：

1. 有明确**动作**或**产物** → Action / Artifact（最具体）
2. 有明确**执行角色** → Agent
3. 是知识/规范 → Reference
4. 是工具封装 → Tool

## 角色词表（Agent 类用）

单个词，不叠加：

designer / writer / researcher / reviewer / planner / analyst / editor / coder / tester / translator

## 应避免的模糊表述

| 类型 | 应避免的词 |
|---|---|
| 营销感 | `smart-`、`pro-`、`ultimate-` 等不能说明具体能力的程度词 |
| 万能感 | `all-in-one-*`、`universal-*` 等掩盖能力边界的词 |
| 过度宽泛 | 只有 `video`、`image`、`creator` 等，无法判断使用场景或产物 |

`assistant`、`tool`、`generator`、`creator`、`maker` 不是硬禁词。若去掉后仍能更准确地表达
能力，可以精简；若它们是用户已确认名称或对能力有区分作用，应保留。

## Good 示例

| 命名 | 类型 | 说明 |
|---|---|---|
| `short-drama-series-writer` | Agent | 短剧垂类 + 剧集对象 + 编剧能力 |
| `papercraft-stop-motion-explainer` | Artifact | 纸艺定格风格 + 科普讲解产物 |
| `landing-designer` | Agent | 落地页设计 |
| `frontend-slides` | Artifact | 前端主题幻灯片 |
| `pdf-extract` | Action | PDF 抽取 |
| `remotion-best-practices` | Reference | Remotion 最佳实践 |
| `lark-calendar` | Tool | 飞书日历 |

## 易混边界

| 场景 | 选 A | 选 B |
|---|---|---|
| 强调"谁在做" vs "产什么" | `blog-writer`（Agent） | `blog-post`（Artifact） |
| 强调"做什么" vs "谁在做" | `pdf-extract`（Action） | `pdf-extractor`（Agent） |
| 强调"规范" vs "执行" | `react-best-practices`（Reference） | `react-reviewer`（Agent） |

## 垂类前缀

当同一能力在多个垂类下都会出现、不加前缀会歧义时，增加垂类前缀，形成
`<垂类>-<创作对象>-<能力动词>` 结构：

| 命名 | 为什么需要前缀 |
|---|---|
| `short-drama-series-writer` | 单说 `series-writer` 无法区分短剧 / 播客 / 纪录片 |
| `ecommerce-image` | 单说 `image` 过于宽泛 |

前缀不是默认动作 —— 能力本身已经足够独特时（如 `4k-upscale`）不要硬加垂类。

---

## 二、`display-name-zh`（中文展示名）

### 核心规则

1. 优先采用 **「使用场景 / 创作对象 + 核心能力」** 结构
2. 使用简洁、易理解的中文，直接说明能完成什么任务
3. 不设置旧版 10 字硬上限；避免仅为通过长度校验而改写运营已确认的名称
4. 不必是 `name` 的字面翻译 —— 中文要符合中文表达习惯，语义对齐即可

### 禁用表述

| 类型 | 禁用词 | 为什么 |
|---|---|---|
| 夸张营销 | 神器、大师、一键封神、封神 | 主观、无信息量，且各 skill 之间无法比较 |
| 万能感 | 万能、全能、一站式 | 掩盖真实能力边界，制造错误预期 |
| 程度词 | 超强、极致、顶级 | 形容词挤掉真正的能力描述 |

`助手`、`工具`、`机器人`、`生成器` 不是硬禁词。名称已经由运营或创作者确认时不要擅自删除；
只有在不改变含义且能明显提升准确性时才建议精简。

### Good 示例

| 中文名 | 字符 | 结构拆解 |
|---|---|---|
| 微短剧剧集编剧 | 7 | 创作对象（微短剧剧集）+ 核心能力（编剧） |
| 电商商品图 | 5 | 创作对象（电商商品）+ 产物（图） |
| 广告创意脑爆 | 6 | 使用场景（广告创意）+ 核心能力（脑爆） |
| 口播动画生成 | 6 | 创作对象（口播动画）+ 核心能力（生成） |
| 视频卡点剪辑 | 6 | 创作对象（视频）+ 核心能力（卡点剪辑） |

### Bad 示例

| 中文名 | 问题 |
|---|---|
| 短视频神器 | 夸张表述，且"神器"没说明做什么 |
| 万能创意助手 | 万能 + 助手，6 个字里 0 个字是有效信息 |
| AI 智能视频生成工具 | “AI 智能”是无信息量修饰，核心使用场景不明确 |
| 编剧 | 过于宽泛，看不出适用垂类（短剧？电影？播客？） |
| 广告 | 只有垂类没有能力，不知道是脑爆、生成还是剪辑 |

### 名称需要精简时

按此优先级砍字：

1. 先去掉无信息量的程度词（`智能` / `顶级`）
2. 垂类可用业内通用简称（`电子商务` → `电商`）
3. 保留能区分产物与能力边界的词，不为追求短而牺牲准确性

名称过于宽泛时，优先收窄能力边界或拆分 Skill，而不是机械压缩字数。
