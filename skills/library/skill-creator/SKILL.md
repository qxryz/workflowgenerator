---
name: skill-creator
description: |
  根据用户意图、工作流或已完成的对话创建、修改、安装、管理或复用双语 Skill，产出对齐的运行时文件和市场元数据。
  用户希望换一组输入重复已完成流程时也使用。
trigger-words: [创建技能, 修改技能, 保存为技能, 把这个保存下来, 变成技能, 固化流程, 记住这个做法, 下次还想这样做, 安装技能, 下载技能, 技能市场, 管理技能, 让这个流程可复用, 更新技能, 配置技能]
guide-prompt: 帮我使用它来创建一个新的技能。首先询问我这个技能应该做什么。
guide-prompt-en: Help me use it to create a new skill. First ask me what this skill should do.
---

# Skill 创建与管理器

创建、修改、安装和管理 Skill。本应用有一个调度器（media-agent）
和多个子 agent：**image**、**video**、**audio**、**editing**。
大部分 Skill 协调这些 agent 完成创意产出。

## 目录结构

| 目录 | 用途 | 谁管理 |
|------|------|--------|
| `~/.hub/skills/` | **市场安装的 Skill** | 应用自动管理，不要手动修改 |
| `~/Movies/Hub/skills/` | **用户创建/编辑的 Skill** | 用户完全控制 |

用户目录优先级更高：同名 Skill 时用户目录的版本生效。

## 从市场安装 Skill

引导用户通过应用内的 Skill 广场页面操作：

1. 打开应用 → 进入「Skill 广场」页面
2. 浏览市场标签页中的可用 Skill
3. 点击「安装」按钮
4. 安装完成后在 Skill 列表中启用

安装的 Skill 存放在 `~/.hub/skills/`，由应用管理，支持自动更新。

---

## 创建 Skill 流程

```
1. 捕捉意图     --  理解工作流
2. 编写 Skill 文件 --  编写中英双语运行时文件和元数据
3. 审查与迭代   --  用户反馈循环
4. 验证         --  触发测试 + 工作流走查
5. 保存并加载   --  保存到用户目录 + 触发加载
6. 迭代（可选）  -- 基于实际使用改进
```

### 三种使用场景

**场景 A：保存当前对话流程**
对话中已经完成了一个工作流，用户想把它固化为 Skill 以便复用。
→ 从对话历史提取工作流，进入步骤 1。

**场景 B：从零创建新 Skill**
用户有一个想法但还没有执行过，想直接创建 Skill。
→ 通过问答了解需求，进入步骤 1（从头创建分支）。

**场景 C：修改已有 Skill**
用户想调整一个已存在的 Skill（改步骤、改参数、改触发词等）。
→ 读取现有 SKILL.md、SKILL.cn.md 和 meta.yaml（如存在），了解修改意图，直接进入步骤 2 修改。

### 什么值得保存为 Skill

不是每个工作流都值得保存。至少满足以下两条时才建议保存：

- **复杂度**：3 步以上、涉及多个 agent、或有分支逻辑
- **可复用**：用户可能用不同输入重复做同样的事
- **隐性知识**：包含不显而易见的技巧——模型选择、参数调优、
  失败时的应对方法、创意技法
- **纠错历史**：用户在流程中做了修正，这些修正适用于未来的执行

如果工作流是简单的一次性操作（如"生成一张图"），建议用户下次直接描述即可。

---

## 步骤 1：捕捉意图

### 场景 A：从对话历史提取

对话中很可能已包含完整工作流。先从对话历史提取，不要问已有答案的问题。

#### 获取对话历史

如果当前上下文不包含完整工作流（发生在之前的会话），
通过 agent 自身的对话历史能力查询之前的会话记录。

**Skill 嵌套**：Skill 不能嵌套调用其他 Skill。如果对话历史中有 Skill 调用，
直接读取被引用 Skill 的 SKILL.md 了解它做了什么，不要尝试重新调用。

#### 从对话历史中提取：

1. **发生了什么**：使用了哪些能力，什么顺序
2. **媒体流转**：输入（音频、图片、文本）→ 中间产物 → 最终输出
3. **创意目的**：核心意图
4. **用户做的关键决策**：模型选择、参数调整、风格方向
5. **出错并修正的地方**：失败、重试、参数变更——这些是最有价值的知识
6. **用户没有改动的地方**：默认值正常工作也是信息，说明这些参数可以保持灵活

#### 确认理解

> "我从对话中提取了这些：[摘要]。这样对吗？"

如果用户纠正或提供自己的描述，以用户的为准。

### 场景 B：从零创建

如果没有现有工作流，通过问答了解需求：

- 输入是什么？最终输出是什么？
- 大致的步骤顺序？
- 有特定的模型或技术要求吗？
- 有什么约束（比例、时长、分辨率、风格一致性）？
- 最难的部分是什么——agent 在哪里容易出错？

### 场景 C：修改已有 Skill

1. 读取目标 Skill 的 `SKILL.md`、`SKILL.cn.md` 和 `meta.yaml`（如存在）
2. 了解用户想修改什么
3. 直接跳到步骤 2 进行修改，并保持双语文件对齐。如果缺少 `SKILL.cn.md`，创建它，不要只做英文更新。

---

## 步骤 2：编写双语 Skill 文件

### 目录结构

```
skill-name/
├── SKILL.md           (必须 — Skill 定义：name + description + system prompt)
├── SKILL.cn.md        (必须 — 中文镜像：相同 name，本地化 description + 正文)
├── meta.yaml          (必须 — 展示元数据：display-name-zh / version / tag / summary / desc)
├── scripts/           (可选 — 可复用脚本)
└── references/        (可选 — 按需加载的参考文档)
```

任何准备提交到本市场仓库的 Skill，都必须创建 `SKILL.md`、`SKILL.cn.md` 和 `meta.yaml` 三个必需文件。`skills/` 或 `user-skills/` 下的目录如果缺少 `SKILL.cn.md`，会被 CI 和 pre-commit hook 拦截。

### 三层加载机制

1. **元数据**（name + description）— 始终在 agent 上下文中，用于触发匹配。`SKILL.md` 和 `SKILL.cn.md` 的 `name` 必须完全一致。
2. **运行时正文** — `SKILL.md` 是英文/默认运行时文件，`SKILL.cn.md` 是中文本地化运行时文件。两者都控制在 500 行以内，并保持结构对齐。
3. **附带资源** — 按需加载。大文档放 `references/`，可执行脚本放 `scripts/`

### SKILL.md 前置字段

SKILL.md 只保留 agent 运行时必需的字段：

```yaml
---
name: my-skill                    # kebab-case，和目录名一致
description: |
  在 200 字符内说明用户意图、核心输入与交付物、适用场景、
  自然触发表达和一项重要边界。
trigger-words: [关键词1, 关键词2, keyword1, keyword2]
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 小写英文单词以 `-` 连接，和目录名一致。命名结构与用词见 **`references/NAMING.cn.md`** |
| `description` | ✅ | 触发与路由描述，新建或改写时不超过 200 字符 |
| `trigger-words` | 可选 | 触发词列表 |

新 Skill 不添加 `allowed-tools`；已有字段可为兼容性暂时保留，
但不得扩展，也不得把其内容复制到正文。

### SKILL.cn.md 要求

每个新建或更新的 Skill 都要创建 `SKILL.cn.md`：

- 使用和 `SKILL.md` 相同的 frontmatter 字段。
- `name` 必须和目录名、`SKILL.md` frontmatter 完全一致。
- 将 `description` 和正文中文本地化，同时保留相同工作流、约束、确认点和资源引用。
- 指向共享文件的引用路径保持一致，例如 `references/...` 或 `scripts/...`。
- 如果只改了一种语言，也要同步更新另一种语言，确保两版语义对齐。

#### Description 写作要点

- **长度**：新建或改写时不超过 200 字符
- **信息优先**：200 字符是上限，不是压缩目标；不得为了变短而删掉用户意图、核心输入、主要交付物、适用场景或关键边界。
- **语气**：描述用户意图，不是实现细节
- **覆盖**：包含多种表述（正式/口语/中英文）
- **边界**：和相近 Skill 有歧义时，加简短区分说明
- **反模式**：不要在 description 里写实现步骤

### meta.yaml

展示元数据放在独立的 `meta.yaml` 中：

```yaml
display-name-zh: 广告创意脑爆          # 中文展示名，规则见 references/NAMING.cn.md
version: 0.1.0                     # 语义化版本
tag-en: "Creative & Experimental" # 历史遗留字段,自由字符串,仅要求非空,不再受枚举校验
tag-cn: "创意实验"                 # 历史遗留字段,自由字符串,仅要求非空
complete-tags-en:                 # YAML 列表,一个或多个封闭枚举内的 "垂类 / 阶段" 配对
  - "Creative & Experimental / Creative Generation"
complete-tags-cn:                 # 与 complete-tags-en 同长度、同 index 位置对齐
  - "创意实验 / 创作生成"
summary-en: "One declarative sentence, up to 45 words, mirroring summary-cn."
summary-cn: "基于品牌简报与竞品参考，脑爆创意方向并产出视觉概念图，适用于 campaign 提案阶段。"
desc-en: "One paragraph, 95-130 words, five elements..."
desc-cn: "一段话，150-200 汉字，五要素：定位 / 用户输入 / 使用方式 / 最终产出 / 能力边界……"
author-en: "MiniMax Design"       # 官方填 MiniMax Design;社区填提交者用户名
author-cn: "MiniMax Design"
source: official                  # official-featured | official | community,必须匹配目录
```

⚠️ **以下所有规则的唯一来源是 `spec/metadata.yml`。**
枚举值与字数上限都从那里读，pre-commit 与 CI 用的是同一份文件。
如果本文档与 `spec/metadata.yml` 不一致，以 spec 为准 —— 并且说明本文档过期了，请顺手修掉。

| 字段 | 必填 | 说明 |
|------|------|------|
| `display-name-zh` | ✅ | 简洁准确的中文展示名称，不设旧版 10 字硬上限。命名结构与应避免的营销词见 **`references/NAMING.cn.md`** |
| `version` | ✅ | 语义化版本 `MAJOR.MINOR.PATCH` |
| `tag-en` | ✅ | **历史遗留字段** —— 英文旧分类,自由字符串(仅要求非空,不再受枚举校验)。现分类以 `complete-tags-en` 为准 |
| `tag-cn` | ✅ | **历史遗留字段** —— 中文旧分类,自由字符串(仅要求非空) |
| `complete-tags-en` | ✅ | 英文分类标签,**YAML 列表**。每项 `"垂类 / 阶段"`,必须在封闭枚举内。允许一个或多个 tag。前端垂类(`tags`)从此字段派生 |
| `complete-tags-cn` | ✅ | 中文分类标签,**YAML 列表**。与 `complete-tags-en` 数量相同、同 index 位置对齐。应当由英文列表按 spec 映射派生，**不要独立翻译一遍** —— 错位是硬错误 |
| `summary-en` | ✅ | 英文 UI 摘要，≤45 个单词。一句完整陈述句，与 `summary-cn` 语义镜像 |
| `summary-cn` | ✅ | 中文 UI 摘要，30–60 个汉字。一句完整陈述句 |
| `desc-en` | ✅ | 英文详细描述，新建或改写时 95–130 个单词。单段 |
| `desc-cn` | ✅ | 中文详细描述，新建或改写时 150–200 个汉字。单段 |
| `author-en` | ✅ | 英文作者名（官方填 `MiniMax Design`;社区填提交者用户名） |
| `author-cn` | ✅ | 中文作者名（官方填 `MiniMax Design`;社区填提交者用户名） |
| `source` | ✅ | 3 值枚举 `official-featured` / `official` / `community`,必须匹配目录（`skills/` → official-featured/official,`user-skills/` → community） |
| `cover` | 可选 | 封面媒体 CDN URL（16:9）。使用仓库当前上传方式，再用 `scripts/set-cover.sh` 校验并回写 URL |
| `cover-en` | 可选 | 英文环境封面媒体（同 `cover` 格式校验）。留空则 fallback 到 `cover` |
| `showcase` | 可选 | 新增的详情页媒体 URL 有序列表。每个 URL 都必须使用批准的 CDN 域名和媒体扩展名。 |
| `structured-info` | 所有正式 Skill 必填 | 独立的 `zh-CN` / `en-US` 对象，包含 `summary`、`best-for`、`how-to-use`、`outputs`；不得从旧摘要或描述字段派生。未上架的 `_` 前缀 stub 不参与校验。 |

这些新增字段的写作示例和语义指导位于
`references/STRUCTURED-META-GOOD-CASES.md` 与 `references/STRUCTURED-META-GOOD-CASES.cn.md`。
编写或审查结构化卡片内容时读取它们；机器限制仍只定义在 `spec/metadata.yml` 中。

`spec/metadata.yml` 中的兼容硬上限只用于保证未改动的历史元数据继续有效，
不是新内容的写作目标。新建或改写时，frontmatter 遵循 200 字符上限，
展示描述遵循中文 150–200 汉字、英文 95–130 单词的区间。

#### `summary-cn` / `summary-en` 写法

一句完整陈述句。**不要与 skill 名称重复** —— 名称已经说了"是什么"，摘要要补充"怎么做""产出什么""什么场景用"。

> 基于【用户输入】，完成【核心处理流程】，输出【最终结果】，适用于【使用场景】。

#### `desc-cn` / `desc-en` 写法

一段话，按顺序覆盖五要素：

1. **定位** —— 面向什么用户、解决什么问题、适用什么场景
2. **用户输入** —— 用户需要提供什么，具体到形式
3. **使用方式** —— 按执行顺序说明关键步骤，3～6 个
4. **最终产出** —— 交付物的具体形式
5. **能力边界** —— 最适合什么，以及**不适合**什么

完整 prompt 与正反例见 `.ci/prompts/summary-*.md`、`.ci/prompts/desc-*.md`。

#### 分类枚举

不要在这里手抄枚举，从 spec 渲染：

```bash
python3 .ci/lib/print_tag_enum.py cn --pairs   # 中文垂类 / 阶段 / 合法 tag 全集
python3 .ci/lib/print_tag_enum.py en --pairs   # 英文
```

`平台工具` 单独出现、不带阶段，且是**排他**的 —— 一旦列表里含它，就只能有它一项。
其它情况下一个 skill 可以带多个 tag —— 比如短剧配乐 skill：`["短剧漫剧 / 后期处理", "音频音乐 / 创作生成"]`。

### 正文结构

1. `# Skill 名称` — 标题
2. 简介段 — 何时使用、涉及什么媒体类型
3. 分步骤 — `## 步骤 N：步骤名`

使用 `references/SKILL-TEMPLATE.md` 作为起始模板。

### 写作原则

#### 不把 MCP 细节写入 Skill

不得在 `SKILL.md`、`SKILL.cn.md` 或 `references/` 中写 MCP tool 名称、完整 MCP 调用、
MCP 调用参数名、请求对象、参数嵌套规则或 provider 专属 schema。应改为领域动作，
例如分析参考素材、生成关键帧、制作视频片段或合成最终交付物。这些动作如何映射到当前能力，
由运行时负责。

#### 描述任务，不描述路由

- 好：「生成一张 16:9 的主角肖像画——红裙年轻女性，电影感光线」
- 坏：「把这一步路由到平台专属图像端点，并填写它的请求字段。」

#### 只在用户明确指定时提及模型

用户说「用 Kling 生成视频」就记录。agent 自动选的默认值不要写死。

#### 解释约束背后的原因

- 好：「最终合成前去掉对口型片段的音轨，因为合成步骤会加原曲，重复音轨会造成叠音」
- 坏：「必须用 `-an` flag」

#### 捕捉创意流程，不是实现细节

- 好：「分析音乐的情绪变化、节奏转折和人声段落」
- 坏：「调用媒体分析端点，并设置它的请求参数。」

#### 批量处理，不要交替

- 好：「一次生成所有场景图，然后一次生成所有视频」
- 坏：「每个片段：先生图，再生视频，然后下一个」

#### 在创意决策点加用户确认

在高成本操作（视频生成、最终合成）前加确认步骤。不要每个小步骤都确认。

#### 编码用户的纠错，不只是成功路径

重试和修正是最有价值的知识。

#### 从具体中提炼通用

- 好：「分析音频确定段落边界」（通用）
- 坏：「在 0:45, 1:30, 2:15 处分割」（特定文件）

#### 所有输出都在会话项目目录

不要硬编码输出路径。使用工具返回的文件路径进行后续操作。

#### 正文 500 行以内

超出部分放 `references/`，可执行模式提取到 `scripts/`。

---

## 步骤 3：审查与迭代

向用户展示完整的 `SKILL.md`、`SKILL.cn.md` 和 `meta.yaml`：

> "这是我编写的 Skill，看看有什么需要调整的？"

常见修改：调整步骤顺序、改模型选择、调参数灵活度、加边界情况处理、
改触发词、去掉过度具体的指令。

---

## 步骤 4：验证

### 4a：触发测试

1. **写 6 个测试查询** — 3 个应该触发，3 个不应该触发。双语 Skill 要同时覆盖英文和中文说法。
2. **自测**：只看 `SKILL.md` / `SKILL.cn.md` 中的 name 和 description，问自己"会触发吗？"
3. **给用户看**：展示测试查询和预期结果

### 4b：工作流走查

用一个不同于原始对话的假设场景，逐步走查：

- [ ] **完整性**：每一步的输出是下一步需要的输入吗？
- [ ] **通用性**：有没有步骤绑定了原始对话的具体内容？
- [ ] **确认点**：用户确认在高成本操作之前吗？
- [ ] **失败路径**：生成失败时 Skill 有指导吗？
- [ ] **批量策略**：同类资源是批量处理还是逐个交替？

---

## 步骤 5：保存并加载

用户确认后保存到目标 Skill 目录。用户本地 Skill 使用 `~/Movies/Hub/skills/<skill-name>/`。市场贡献则使用用户指定的仓库路径，通常是 `skills/<skill-name>/` 或 `user-skills/<skill-name>/`。

### 1. 创建目录并写入

先设置目标目录：

- 用户本地 Skill：`TARGET_DIR=~/Movies/Hub/skills/<skill-name>`
- 市场贡献：`TARGET_DIR=<用户指定的仓库路径>/<skill-name>`，通常是 `skills/<skill-name>` 或 `user-skills/<skill-name>`

```bash
mkdir -p "$TARGET_DIR"
```

将 SKILL.md 保存到 `$TARGET_DIR/SKILL.md`。
将 SKILL.cn.md 保存到 `$TARGET_DIR/SKILL.cn.md`。
将 meta.yaml 保存到 `$TARGET_DIR/meta.yaml`。

如有 references 或 scripts，创建对应子目录。

### 2. 验证引用完整

保存后确认必需文件存在，并确认引用的所有文件都存在：

```bash
test -f "$TARGET_DIR/SKILL.md"
test -f "$TARGET_DIR/SKILL.cn.md"
test -f "$TARGET_DIR/meta.yaml"
grep -oE '(references|scripts)/[^\s`"]+' "$TARGET_DIR/SKILL.md" | \
  while read f; do
    [ -f "$TARGET_DIR/$f" ] || echo "MISSING: $f"
  done
grep -oE '(references|scripts)/[^\s`"]+' "$TARGET_DIR/SKILL.cn.md" | \
  while read f; do
    [ -f "$TARGET_DIR/$f" ] || echo "MISSING: $f"
  done
```

市场贡献在结束前运行 `.ci/validate.sh`。如果改动了 `SKILL.md`、`SKILL.cn.md` 或 `meta.yaml`，将 `meta.yaml` 版本设置为严格高于 main 基线一个 patch 版本。同一分支后续多次提交保持该版本不变。

### 3. 触发 Skill 重新加载

用户本地 Skill 保存完成后，如果产品当前提供 Skill 重载能力，使用该能力触发加载。
不要把运行时能力名或重载协议写进所创建的 Skill；如果无法重载，告知用户新 Skill 何时可见。
市场贡献不触发本地 reload，改为报告仓库路径和 `.ci/validate.sh` 结果。

### 4. 告知用户

- Skill 已保存到 `$TARGET_DIR`
- 用户本地 Skill 已触发重新加载，新 Skill 可在当前或下次会话中使用
- 市场贡献已通过校验，仓库路径可提交或发起 MR
- 列出步骤 4a 的 3 个触发测试查询作为示例

---

## 步骤 6：迭代与改进（可选）

Skill 的第一版很少是最好的。实际使用后再来改进。

### 观察信号

| 信号 | 含义 | 修复 |
|------|------|------|
| Agent 没触发 Skill | description 缺少用户的说法 | 扩充触发词 |
| 触发了但执行差 | 指令不清晰或有歧义 | 澄清步骤，加示例 |
| 不该触发时触发了 | description 太宽泛 | 加边界说明 |
| Agent 每次都写类似脚本 | 重复工作未打包 | 提取到 `scripts/` |
| 用户每次都改同一步 | 约束不够紧 | 加明确指导和原因 |
| Agent 做了多余的事 | 指令导致无效工作 | 删除或简化 |

### 改进流程

1. 收集 2-3 次使用的证据
2. 诊断：触发问题（description）、执行问题（正文）、还是缺资源？
3. 精准修复：只改有问题的部分
4. 重新验证（跑步骤 4 清单）
5. 修改后按需使用当前可用的重载能力
