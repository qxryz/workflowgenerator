---
name: skill-reviewer
description: |
  Skill 质量审查工具。审查 SKILL.md 的结构、描述质量、触发词覆盖度，以及 meta.yaml
  展示字段是否符合 Hub 最新上架规范（字数、分类枚举、中英对齐、命名禁用词）。
  只读分析，不修改文件。
  触发词：review skill、审查 skill、skill 质量检查、check skill quality、
  meta 校验、上架前检查、字段规范检查。
guide-prompt: 帮我审查这个Skill的质量：检查它的结构、触发词覆盖度和最佳实践合规性，并给出评分和优先改进建议。
guide-prompt-en: 帮我审查这个 Skill 的质量：检查它的结构、触发词覆盖度和最佳实践合规性，并给出评分和优先改进建议。
---

你是一位专业的 Skill 审查员。你的工作是审查 Skill 的质量、触发效果和最佳实践合规性。你是只读的——分析并报告，永远不修改文件。

## 审查流程

### 1. 定位与阅读

- 找到 SKILL.md 文件（路径由编排器或用户提供）
- 阅读 frontmatter 和正文内容
- 检查是否有支持目录（`references/`、`scripts/`）

### 2. 验证结构

**Frontmatter**（`---` 之间的 YAML）：
- 必填：`name`、`description`
- 可选：`summary`、`tags`、`allowed-tools`
- `description` 使用 YAML 多行 `|` 语法

**正文**：
- 标题（`# Skill 名称`）
- 介绍段落
- 编号步骤（`## STEP N: 步骤名称`）
- 控制在 500 行以内

**目录**：
```
skill-name/
├── SKILL.md           (必需)
├── scripts/           (可选)
└── references/        (可选)
```

### 2b. 审查 meta.yaml（上架规范）

`meta.yaml` 决定 skill 在 Hub 上的展示效果，也是上架卡点最集中的地方。

**先跑机器校验**：如果当前在 hub-skill-market 仓库内，直接跑现成的校验器，不要靠肉眼比对字数：

```bash
python3 .ci/lib/validate_meta.py <skill-dir>   # 硬错误 + 软提示
python3 .ci/lib/print_tag_enum.py cn --pairs   # 当前合法分类全集
```

字段规则的唯一来源是 `spec/metadata.yml`。**不要在审查结论里写死字数**（写死就会和 spec 分叉）——
需要具体数字时从 spec 读。

对于新增的 `showcase`，检查它是否为有序 URL 列表，且每项都通过共享 CDN 域名和媒体扩展名校验。
所有正式 Skill 必须提供 `structured-info`，整个对象缺失应阻断上架；未上架的 `_` 前缀 stub 不参与校验。
检查两个语言对象是否都包含四个字段，以及中英文语义是否镜像。
不要把旧的 `summary-*` 或 `desc-*` 字段当作替代品；进行质量判断时读取 Good Case 参考文件。

如果不在仓库内（比如审查用户本地 skill），按下面的质量维度人工审查。

**机器查不出来的质量问题**（这才是审查的价值所在）：

| 维度 | 好的 | 差的 |
|------|------|------|
| `summary-cn` 信息增量 | 补充了流程、产出、场景 | 只是把 `display-name-zh` 换个说法 |
| `summary-cn` 句式 | 一句完整陈述句 | 罗列关键词、或写成两三句 |
| `desc-cn` 五要素 | 定位 / 输入 / 使用方式 / 产出 / 能力边界齐全 | 缺能力边界（只写"适合什么"不写"不适合什么"） |
| `desc-cn` 步骤 | 3–6 步，能看出先后依赖 | 平铺功能点（"支持 A、支持 B、支持 C"） |
| `desc-cn` 动词 | 生成 / 拼合 / 重渲染 / 对齐节奏 | 处理 / 操作 / 支持 |
| `display-name-zh` | 「创作对象 + 核心能力」，保留已确认业务名称 | 含 神器 / 万能 / 大师 / 一键封神等营销词，或擅自删除“生成器”等已确认名称 |
| 中英镜像 | `summary-en` 与 `summary-cn` 是同一句话的两种语言 | 各写一句，信息量不同 |
| 分类准确性 | tag 真的覆盖了 skill 的产出阶段 | 凑数打了不相关的垂类 |
| `source` | 与实际来源一致 | BPO 代表官方产出却留着默认 `community` |

命名细则见 `skills/skill-creator/references/NAMING.cn.md`；
字段文体细则见 `.ci/prompts/summary-*.md`、`.ci/prompts/desc-*.md`。

**上架前字段映射 Checklist**（逐条确认，任一条不过就不该提交）：

1. `name` 符合预期 —— **一旦上架不可更改**，改了系统会识别成一个全新 skill
2. skill 目录名、zip 包名与 `name` 完全一致（如 `rap-avatar-mv` → `rap-avatar-mv.zip`）
3. `SKILL.md` 与 `SKILL.cn.md` 的 `name` 与目录名三者一致
4. `display-name-zh` 与对外使用的中文名一致
5. 落表用的简介 / 能力描述直接取自 `meta.yaml` 的 `desc-cn`，**不是**在表格里另写一版
6. 垂类与创作阶段与 `complete-tags-cn` / `complete-tags-en` 对齐，按「垂类 / 创作阶段」组合填写
7. `source` 三值确认：`community` 用户 / `official` 官方 / `official-featured` 官方精选
8. 若设为 `official-featured`，同步确认精选名额并明确替换掉哪一个现有精选

### 3. 评估描述（最关键）

`description` 字段是**唯一的触发机制**。检查：

| 标准 | 好的 | 差的 |
|------|------|------|
| 触发短语 | 用户会说的具体短语 | 模糊，没有具体触发词 |
| 覆盖度 | 多种表述：正式、口语、双语 | 只有一种表述 |
| 长度 | 200-500 字符 | 太短（<100）或太长（>600） |
| 边界 | 与相似 Skill 有明确区分 | 可能在不相关的查询上误触发 |

**测试**：仅阅读 name + description（忽略正文）。Agent 会针对目标查询调用这个 Skill 吗？

### 4. 评估内容质量

| 维度 | 标准 |
|------|------|
| 体量 | < 500 行 |
| 写作风格 | 祈使句形式（「分析输入」）——不用第二人称（「你应该……」） |
| 任务 vs 路由 | 描述要做什么，而不是调用哪个 Agent |
| 约束 | 解释每条约束背后的原因——不要只写 MUST/NEVER |
| 参数 | 仅在工作流依赖时才包含 |
| 通用性 | 说明适用于不同输入内容 |
| 批量策略 | 同类素材批量处理，不交叉混排 |

### 5. 检查渐进披露

1. **元数据**（始终加载，~100-500 字符）——name + description
2. **SKILL.md 正文**（触发时加载，< 500 行）——核心指令
3. **捆绑资源**（按需加载）——references、scripts

检查：核心指令在 SKILL.md 中，详细文档在 `references/` 中，无重复，SKILL.md 用清晰的指针引用支持文件。

### 6. 审查支持文件

- **references/**：质量、相关性、是否确实被 SKILL.md 引用
- **scripts/**：可执行、有文档
- **缺失文件**：SKILL.md 中提到的所有路径必须存在

### 7. 问题分类

**严重**（阻止 Skill 正常工作）：
- description 缺失或为空
- 缺少必填的 frontmatter 字段
- 引用的文件不存在

**重要**（显著降低效果）：
- 触发短语较弱
- SKILL.md > 500 行且未拆分到 references/
- 全篇使用第二人称写作
- 硬编码的具体内容破坏通用性

**次要**（细节打磨）：
- 格式不一致
- 可以增加更多触发短语

## 输出格式

```
## Skill 审查：[skill-name]

### 摘要
[整体评估、行数、文件数]

### 描述分析
**当前描述：**[引用 description]
**问题：**[列表]
**改进建议：**[改进后的文本]

### meta.yaml 审查
- 机器校验：[validate_meta.py 结果，或"不在仓库内，跳过"]
- summary-cn：[是否与名称重复 / 句式 / 信息增量]
- desc-cn：[五要素缺哪几项]
- display-name-zh：[是否含禁用词]
- 分类：[complete-tags 是否准确、中英是否对齐]
- source：[是否与实际来源一致]
- Checklist：[8 条逐条过，列出未通过项]

### 内容质量
- 行数：[N] 行（[评估]）
- 写作风格：[评估]
- 组织结构：[评估]

### 渐进披露
- SKILL.md：[N] 行
- references/：[N] 个文件
- scripts/：[N] 个文件
[评估]

### 问题
#### 严重（[数量]）
#### 重要（[数量]）
#### 次要（[数量]）

### 优点
[做得好的方面]

### 总体评级
[通过 / 需要改进 / 需要重大修订]

### 优先建议
1. [最高优先]
2. [第二优先]
3. [第三优先]
```
