# 生成、QA 与失败恢复

导航：关键状态/GPT Image/确认 B → H3 输入与 Prompt → 分层回滚/最终 QA/交付 → Visual Bible → Master/Propagation → 自动一致性 QA → 版本与 H3 Gate → 验证工具。

## 18. 时间状态选择：固定 3–4 张

从已确认的 Blender RGB 视频选取第 0 秒的画面和结束时刻对应的画面，两者都必须经过 GPT Image 风格化；再选择中间 1–2 个有信息差的状态，如侧绕揭示、入口过渡或中庭。总计 3–4 张，不得只生成两张，也不得额外重复母版。所有图片统一走 Master + Bible + Propagation + QA。

中间状态按视觉/空间变化选择，不机械等距；时刻严格位于两个端点之间并相互不同。母版可从这 3–4 张任意选一张，其他所有图（包括两个端点状态）都同时参考自己的 Blender 图、同一母版及同版 Bible。

### 秒数与真实帧映射

- `N = frame_end - frame_start + 1`，`T = N / fps`。
- 第 0 秒取 Blender `frame_start`；结束对应状态取 `frame_end`，不请求视频中不存在的 `T` 秒采样。
- 源帧 `f` 的真实采样时间为 `(f - frame_start) / fps`。中间状态也记录真实帧号和时间，不用时间粗略反推后默默错帧。
- 例如 15 秒、24fps、帧号 1–360：结束画面实际采样在 14.958333 秒。向用户可以标“第15秒（结束时刻对应画面）”；内部同时保留 `display_time_seconds=15` 与 `source_time_seconds=359/24`。H3 中写“第15秒结束附近的视觉状态参考”，不承诺在不存在的采样时刻精确匹配像素。
- 时长为 12 秒则使用第12秒，不把所有视频都写成第15秒。
- 对用户的图注、文件展示名和提交 H3 的图像职责均用“第 X 秒 + 空间状态”，不使用“首帧”“尾帧”“起始帧”“结束帧”、first/last frame 等角色标签，也不附加图生视频的强制对齐指令。

图片仍是时间状态的全能风格参考，不是图生视频端点控制。视频的连续路径与节奏由 Blender RGB 提供。

---

## 19. GPT Image：关键状态视觉导演

### 19.1 输入
严格先执行下文 Visual Bible → Master → Style Propagation 流程。母版输入对应 Blender 帧与 Bible；其余帧必须同时参考自己的 Blender 帧、同一母版与同版 Bible。可附加：

- Blender RGB Keyframe；
- 可选 Cycles 光影 Keyframe；
- 用户参考图；
- 用户目标风格；
- 主体身份/准确性约束。

### 19.2 必须保持

- Camera angle；
- Perspective；
- Composition；
- Major geometry；
- Landmark identity；
- Object placement；
- Architectural silhouette。

### 19.3 允许改变

- Art direction；
- Surface material；
- Color palette；
- Lighting treatment；
- Atmosphere；
- Fine texture；
- Decorative detail；
- Style language。

### 19.4 风格模式
支持：

- `Photorealistic Cinematic`（默认）；
- `Cyberpunk`；
- `Architectural Sketch / Line Art`；
- `Anime / Hand-painted`；
- `Post-apocalyptic`；
- 其他 preset；
- 用户自然语言自定义。

### 19.5 准确 vs 好看
#### 写实风格
优先级：
`Identity > Geometry > Spatial Accuracy > Camera > Lighting > Beauty`

#### 强风格/电影化
优先级：
`Identity > Composition > Camera > Visual Impact > Style > Fine Geometry`

无论哪种模式，主体身份不能丢失。

---

## 20. 用户确认节点 B：Style Anchors

自动 Style Consistency QA 全组通过后，一次展示全部 3–4 张最终 GPT Image 风格图（母版包含在这组中，不额外算一张）。不单独要求确认 Master Style Frame。

附各帧编号、场景状态、Blender 时间点和简短 QA 结果；所有图必须实际可见，不能只列文件名。说明：以下关键帧将共同作为 H3 视频的视觉参考，请确认建筑身份、天空、时间、光线方向、材质、色调和整体风格是否统一。确认后进入最终视频生成。

用户确认：

- 是否符合目标风格；
- 是否保持主体身份；
- 写实模式下是否足够真实；
- 强风格模式下艺术加工是否过度；
- 各关键状态之间是否属于同一视觉世界。

确认后：

> LOCK STYLE

将确认消息及整组文件版本写入 manifest，检查 H3 前置条件后进入 H3。用户仅查看、未回复或等待超时都不算确认。用户已明确同意当前整组版本时不重复确认。

---

## 21. H3 输入结构

最终 H3 输入由三类条件组成：

1. `Blender RGB Video`
   - 负责空间结构、前后关系和摄影机运动。

2. `3–4 Style Anchors`
   - 负责目标视觉、美术、材质、色彩和光影参考。

3. `Astra Final Prompt`
   - 负责主体语义、身份约束、风格说明、摄影机运动描述和连续性要求。

H3 是重新生成视频，不是传统后期贴材质，也不是逐像素滤镜。

实际参数和接口能力必须以当前可用的 H3/Hailuo 入口为准；不能假设所有版本都支持完全相同的视频与多参考图组合。必须核实当前入口能同时接收 Blender RGB 视频 + 3–4 张图 + Prompt；不支持时保留全部已完成产物，说明缺失能力并等待兼容入口，不擅自降级为纯图生视频。

---

## 22–24. H3 Prompt 生成、写实与强风格模板

统一读取 [包内 H3 Prompt 框架与建筑模板](h3-prompt.md)。本节旧模块和自由段落模板已迁移为多模态六字段结构；写实/强风格、身份保护、运动/连续性和常见失败规避在该文件内保持。不得绕过新框架回到旧模板。

## 25. 最终生成与一次生成原则

H3 默认生成一次。

生成完成后：

- 不自动无限重试；
- 输出给用户评估；
- 用户指出问题后，先定位问题属于哪一层，再重做对应阶段。

---

## 26. 分层回滚机制

### 模型/身份错误
回滚：
`Reference Research -> Blender Geometry`

### 比例/入口/空间错误
回滚：
`Blender Geometry / Layout`

### 镜头路线或速度错误
回滚：
`Camera Planning -> Camera Animation -> Previs`

### 光影参考错误
回滚：
`Lighting / Cycles Keyframe Pass`

### 风格不对
回滚：
`GPT Image -> 异常 Style Anchors -> 全组 Style Consistency QA -> 确认 B`；保留合格帧。

### H3 中建筑漂移，但 Blender RGB 与风格帧正确
回滚：
`H3 Prompt / Conditioning / Reference Count`

### RGB 本身闪烁或编码错误
回滚：
`Blender Render / RGB Encoding / RGB QA`；先定位灯光、可见性、漏帧或文件错误，保留正确模型与镜头。

不得因为最终视频的局部风格问题无理由重做已经确认的 Blender 模型。

---

## 27. 最终 QA

### 27.1 文件级检查
检查：

- width；
- height；
- fps；
- duration；
- frame count；
- codec；
- black frames；
- corrupted frames。

帧数逻辑：
`frames = seconds × fps`。

如果 Blender 时间线从 start 到 end 包含端点，则实际帧数为：
`end - start + 1`。

### 27.2 视觉级检查
最终 H3 视频抽取至少：

- 0%；
- 25%；
- 50%；
- 75%；
- 最后一个可解码帧（不要请求恰好等于 duration 的不存在帧）；
- 以及入口/转弯/内部揭示等关键时间点。

检查：

- 主体是否仍然是同一建筑；
- 标志性结构是否保持；
- Camera 是否大体遵循 Blender 路线；
- 是否发生结构漂移；
- 是否突然切镜；
- 是否出现重复建筑；
- 是否墙面融化；
- 是否有纹理闪烁；
- 光影方向是否稳定；
- 室内外曝光是否自然；
- 风格是否与 3–4 张 Anchor 一致；
- FPV 速度是否保持。

### 27.3 Blender 交付检查
保存最终 `.blend`，并确认：

- active scene 正确；
- active camera 正确；
- frame range；
- FPS；
- collections；
- Camera Rig；
- external textures；
- 相对路径或打包策略；
- 不包含无关私人文件、凭据或绝对路径依赖。

---

## 28. 用户交付说明

默认交付：

1. `final.mp4`
2. `project.blend`
3. `previs.mp4`
4. `style_anchor_*.png`
5. `shot_manifest.json` + `visual_bible.json` + `style_consistency_qa.json` + `h3_prompt.txt`
6. 简短说明：
   - 主体；
   - 时长；
   - FPS；
   - FPV 模式；
   - 路线；
   - 风格；
   - 哪些几何来自真实资料；
   - 哪些区域属于合理补全；
   - 已知限制。

如用户只需要最终视频，可减少可见交付，但 `.blend` 应尽量保留作为工程资产。

---
## 30. 故障处理

### Blender 连接失败

- 不因为发现连接文件就继续提交修改；
- 先做只读检查；
- 如超时，检查响应文件和 Blender Console；
- 重试前确认上一请求是否实际执行；
- Blender 中途换 Scene 或 File 时必须重新检查。

### 预演空白
检查：

- active scene；
- active camera；
- camera markers；
- visibility；
- clip planes；
- render engine；
- output path。

### FPV 穿模
优先依次修：

1. Camera Path；
2. Target；
3. Clearance；
4. 建筑通道；
5. Lens；
不要用无意义缩小整个建筑来迁就镜头。

### H3 漂移
先检查：

1. Blender RGB 的空间、运动、时序与画面是否稳定；
2. Style Anchor 是否互相冲突；
3. Anchor 是否过多；
4. Prompt 是否同时提出矛盾风格/结构要求；
5. Blender 路线是否过于复杂；
6. H3 当前入口对 RGB 视频和多图组合的实际支持情况。

---

## 31. 工程验证要求

正式实现一键 Skill 前，必须逐项验证：

- Astra/Codex 能否稳定控制 Blender；
- 直接连接不可用时，本地桥接是否可自动恢复；
- Blender `.blend`、preview、RGB、关键帧能否正确回传；
- Blender RGB 是否覆盖完整 10–15 秒，时间线与图像序列/编码是否逐帧一致；
- GPT Image 是否能在保持构图/几何的前提下可靠风格化；
- H3 当前接口是否支持所需 Blender RGB 视频 + 3–4 张已确认参考图 + Prompt；
- H3 文件上传限制、格式限制、时长限制、分辨率限制；
- H3 任务提交、状态轮询、最终 MP4 获取；
- 最终成片结构保持率；
- 3 张或 4 张 Style Anchor 对漂移的影响。

需要比较条件数量且用户授权实验时，用同一 Blender RGB 母版比较 3 / 4 张经 QA 并确认的风格帧。每个条件均保留 RGB 视频与同一 Bible；不把消融测试插入默认一次生成流程。

使用同一 Blender 母版比较：

- 结构稳定性；
- 风格一致性；
- 运动遵循度；
- 漂移；
- H3 自由发挥程度。

---

## Visual Bible：全片唯一视觉规范

本节是 GPT Image 阶段的必读执行细则。顺序为 Bible → 3–4 状态 → Master → Propagation → QA → B → LOCK STYLE；不可把每张关键帧当作独立美术设计任务。

在确认 A 后，根据用户风格、优先参考、已锁定场景坐标建立 `visual_bible.json`，为其分配版本。以下字段按场景填写，不把示例色温、时段或焦距当成默认常数：

| 类别 | 必须锁定的内容 |
|---|---|
| 时间与天气 | 时段、天气、云量/云型、可见性；10–15 秒中不无故改变时刻 |
| 坐标与太阳 | Blender 坐标及与真实方位的映射；太阳世界方位/高度，或从场景指向太阳的归一化向量；记录向量约定，入射光方向相反 |
| 天空 | 天顶/地平线色彩、渐变、云层分布规则；跨视角允许符合方向的差别 |
| 主光与阴影 | 主光方向/色彩/软硬度，阴影方向/长度，辅光及室内局部光源 |
| 材质 | 主体各区域材质身份、基础色、粗糙/反射关系、玻璃/金属/水体规则 |
| 色温与曝光 | 摄影机白平衡、各光源色温、曝光基准、高光滚降、对比度；不要混用白平衡与灯光色温 |
| 色彩分级 | 饱和度、阴影/高光倾向、黑位、统一色板或 LUT（实际存在才引用） |
| 空气与风格 | 雾/空气透视、体积光、写实或绘画语言、细节密度、镜头/颗粒处理 |
| 状态例外 | 外→内时允许的自然曝光过渡、局部灯光；提前定义原因与时间范围 |
| 不变量 | 主体身份、标志构件、锁定几何和镜头；禁止随机增删与视角改造 |

太阳和主光使用**世界坐标**，不能要求环绕镜头所有图片的太阳都在屏幕左侧。相机转向后太阳屏幕位置、受光面和阴影投影会自然变化；依据 Blender Camera 朝向、相同构件的世界法线和遮挡核对。室内不可见天空标为有理由的 N/A，不凭空补天窗或太阳。

固定同一色彩管理/输出色彩空间；保存 Blender 视图变换与曝光设置。不要逐帧自动白平衡、自动调色或直方图匹配来掩盖画风差异。文本参数是生成约束，不保证模型能精确执行数值，必须看图 QA。

## Master Style Frame 与 Style Propagation

### 选择与生成母版

1. 从 3–4 个状态中选最能展示主体身份、核心材质、天空/光线的代表帧，不强制第一个时间点。记录 `master_anchor_id`。
2. 输入其 Blender RGB 帧 + 同版 Bible；可补用户身份/风格参考及同相机 Cycles 帧，并明确各参考职责。
3. 输出母版后内部检查构图、结构与 Bible；若母版本身有偏差只修母版，合格前不传播。
4. 母版合格后冻结该图及 Bible 版本，继续生成其余帧，不插入第三个用户确认节点。

母版提示骨架：

```text
将输入 Blender 帧转换成 {target_style}。保留原相机视角、透视、构图、建筑轮廓、主要几何、开口与物体位置。
主体为 {identity_constraints}。全片视觉规则：{visual_bible}。
本帧为 {state_at_time}，仅允许 {approved_state_variations}。
生成这一视角的最终风格关键帧，不改变相机或增删主体核心构件。
```

### 传播到其余状态

每个调用必须同时包含三项，不能仅在 Prompt 中声称参考了未上传的图：

- **A：本状态 Blender 帧**，负责角度、透视、构图、几何、遮挡与入口；可用同帧 Cycles RGB 渲染补物理光照。
- **B：同一 Master Style Frame**，负责风格、材质、天空语言、天气、色彩分级、曝光处理；不得复制其视角和主体位置。
- **C：同版 Visual Bible 文本**，负责固定世界条件与允许的状态变化。

用户图作为补充时注明用于身份还是风格。若工具无法同时接收这些参考，保留素材并报告限制，不用三次独立生图替代。各输出保持与自己的 Blender 帧相同比例和视野，不以裁切去匹配母版。

传播提示骨架：

```text
参考 A 为本帧的几何与相机权威：保留其镜头位置、方向、透视、建筑尺度、轮廓、主要开口与遮挡。
参考 B 为全片唯一视觉母版：继承其天空/天气、材质、光影语言、色温、曝光与色彩分级，不复制 B 的构图。
共同遵循 Visual Bible：{visual_bible}。
本状态为 {state_at_time}，Camera 世界朝向为 {camera_orientation}，太阳世界方向固定为 {sun_world}。
仅允许 {approved_state_variations}；同一建筑/材质在不同视角保持身份与物理关系。
生成本状态的单张最终图，使其与 B 属于同一时刻、同一天气、同一视觉世界。
```

不采用“母版→第二张→第三张→第四张”的接力。其余帧都回到同一个母版；可分次完成，母版确定之前不得同时独立定调多张图。

## 自动 Style Consistency QA

Astra 必须实际查看每张输出、母版、对应 Blender 帧与整组联系表；可用可用的视觉工具辅助。文件存在、相同 Prompt、同一 seed 或色值接近都不能作为通过证据。

| 项目 | 判断依据与失败例子 |
|---|---|
| 天空 | 同类天空渐变/云况；不同方位可有差别，不能随机由晴天变乌云 |
| 时间 | 同一拍摄时段；不能外景黄金时刻、下一外景正午 |
| 天气 | 云、雨、雾、地面湿润状况符合 Bible 和空间连接 |
| 太阳与光线方向 | 世界方向一致，受光面/投影合理；不能把屏幕方向固定当一致性 |
| 建筑材质 | 相同构件材质身份不变；陶瓷不能在下一帧变混凝土或金属 |
| 色温 | 白平衡稳定，主光/辅光符合规则；室内局部光仅允许预定义变化 |
| 曝光 | 相同环境曝光关系一致，保留高光；室内外变化合理可连续过渡 |
| 色彩分级 | 阴影色、高光色、饱和度、黑位与对比度属于同一调色方案 |
| 主体身份 | 标志轮廓、塔楼/屋顶、地标特征稳定；不能泛化成别的建筑 |
| 建筑结构 | 各自对照 Blender；比例、开口、构件数量、连接、位置不漂移 |
| 整体画风 | 写实程度、笔触/线条、纹理密度、锐度、颗粒、镜头语言统一 |

QA 采用三层对照：每张对自己的 Blender 帧检查结构；每张对母版/Bible 检查外观；全组按时间顺序交叉比较并检查相邻状态过渡。不要用一致的美术掩盖结构错误。

写入 `style_consistency_qa.json`：Bible/母版/RGB 版本与哈希、每张文件与哈希、各项 `pass/fail/not_applicable`、可见证据、问题区域、修复要求、迭代次数、全组结论。N/A 必须说明原因；看不清则标待核实，不能当通过。自动检查是本流程中的视觉判断，不声称脚本可精确证明生成图的物理光照。

### 异常帧修复

- 只提交异常帧重做：仍输入该帧 Blender + 原合格母版 + 同版 Bible，并精确指明问题，如“保持当前构图，把天空与母版统一，太阳保持世界方向”。
- 已通过帧文件保持不变；修复后检查改动帧所有项目，再与完整组复查。不能因为只修天空就跳过建筑检查。
- 母版是异常源时，先修母版，再检查所有既有帧；仅重做因此实际不合格的帧，不一律重做全组。
- 默认每个制作批次最多两轮自动异常帧修复（首次生成不计）；用户可指定预算。仍失败则停止生成，呈现失败原因与可保留成果，等待调整方向；此处是故障反馈，不是额外的 Master 确认或已通过的确认 B。
- 改动 Bible 必须升版，重新对全组 QA；通过且未变的图可保留，不能沿用旧 QA 状态。
- 只有全组通过才能提交确认 B。用户修改某帧后，修该帧并重新做全组 QA，展示更新后的完整组一次确认。

## 版本记录、锁定与 H3 Gate

`shot_manifest.json` 除 camera-design.md 中字段，至少保存以下信息（相对路径，哈希对应实际文件）：

```text
stage: RESEARCH / WAIT_REFERENCE_CHOICE / REFERENCE_GENERATION /
       REFERENCE_QA / MODELING / MODEL_QA / CAMERA_PREVIS / WAIT_A /
       VISUAL_BIBLE / MASTER / PROPAGATION / STYLE_QA / WAIT_B /
       STYLE_LOCKED / H3 / FINAL_QA / DELIVERED
reference_manifest_path, reference_revision, reference_gate
model_qa_path, model_qa_revision, model_qa_status
geometry_revision, camera_revision, rgb_revision
rgb: path, sha256, source_blend, scene, camera, engine,
     frame_start, frame_end, fps, width, height, duration, frames, qa
checkpoint_a: approved, evidence_message, approved_geometry_camera_revision
visual_bible: path, revision, sha256
master_anchor_id
anchors[]: id, state, blender_frame, time_seconds, source_time_seconds, display_time_seconds, blender_image,
           path, sha256, bible_revision, master_sha256, qa
style_qa: report_path, report_sha256, status, input_versions
checkpoint_b: approved, evidence_message, approved_group_digest
style_locked, h3_prompt_path, h3_prompt_sha256
h3: mode=all-purpose-reference, actual_endpoint_mode, input_asset_mapping, submitted_versions, job_id, status
```

组摘要由有序关键帧哈希、Bible 版本/哈希及 RGB 版本生成；母版可位于任意时间，但 H3 图像列表按时间顺序传递，不再额外重复上传母版。记录 `@图编号 → 状态 → Blender帧号/时间` 映射；接入方真实资产标识取得后再替换 Prompt 中占位符。

调用 H3 前逐项核验：

1. A 对应当前几何与 Camera，锁定有效；参考准入和模型 QA 记录存在且匹配当前建模依据与模型。历史项目缺少记录时补查，不为填记录重建已合格资产。
2. 确认 A 的 RGB 母版通过 --previs 检查且原生为 2560 × 1440；上传派生副本若存在须有映射记录。RGB 可读、完整可解码且已实际观看；来源为当前锁定 Blender，时长/FPS/帧序/画幅与 manifest 一致。
3. 总计 3–4 张最终图（含母版），覆盖第0秒、结束对应状态和中间1–2个不同状态；均已风格化、可读，结构源帧映射存在，统一 Bible、母版与整组 QA 有效。
4. B 已明确确认当前完整组，`style_locked=true`；QA 通过不能替代用户确认。
5. Astra Prompt 已经包内 h3-prompt.md 的六字段与素材适配自检，与 RGB 镜头路径、Bible、参考顺序一致，没有未替换模板字段或冲突指令。
6. 当前 H3 入口已实际选为全能参考模式并支持同时提交视频 + 3–4 图 + Prompt；禁止选择首尾帧模式或用仅含起止图片的接口代替。上传完成且可访问，实际提交资产与锁定版本一致。接口限制在运行时核实，不猜测参数名或能力。

任何文件改变时重新计算哈希和受影响状态；不能仅凭旧布尔值放行。上传超时先查是否已成功，提交后保存 job_id；响应不明先查询原任务，避免重复扣费。默认生成一次，不在状态轮询时重新提交。

回滚失效范围：模型/Camera 改动→新预演与 A，受影响源帧/风格 QA/B/H3 失效；仅 RGB 编码修复且像素时序相同→复验 RGB 并更新依赖，已有 A/风格确认可复用；风格/Bible 改动→全组复核 QA 与 B，保留 Geometry/Camera/A；仅 H3 Prompt 修正且不改变已确认内容→保留 A/B。

## 验证工具边界与执行

`prepare_scene.py` 在 Blender 内运行，用于新的独立场景初始化或经检查后的复用；保存由调用者选择新路径，不自动覆盖文件。`validate_output.py` 在普通 Python 中调用 ffprobe；用 `--decode-check` 可增加 ffmpeg 完整解码检查。

```sh
python scripts/validate_output.py previs.mp4 --expected-fps 24 --expected-duration 12 --previs --expected-width 2560 --expected-height 1440 --expected-frames 288 --expected-codec h264 --decode-check
```

实际参数来自 manifest，不照抄示例。验片程序不负责风格 QA；黑帧检测可用 ffmpeg blackdetect 辅助，但真实暗场应人工判读；最终必须看完整运动及代表帧，不能把工具无错误等同于最终视觉合格。

## 研究与模型质量回滚补充

- 搜索失败、只拿到文字或未实际看图：回到研究，记录工具限制，不跳到印象建模。
- 关键资料不足：先完成针对性补搜与缺口说明，再进入 WAIT_REFERENCE_CHOICE，等待用户是否同意补生成参考；不可把“下一步”当作对未呈现补图方案的授权。
- 生成参考互相矛盾：回到 REFERENCE_QA，只修异常图；保留可靠原图，不把生成设定升级为真实证据。
- 抽象草模或标志结构缺失：回到 MODELING，完成 model_qa.json 后再预演；不通过增加渲染采样或后续 H3 掩盖。
- 参考更新只使受影响的部件及下游证据失效；检查当前模型是否仍符合，保留未受影响的资产与用户确认。

## 全能参考模式不可降级

提交前检查实际工具参数/界面所选模式，不能只在 Prompt 中写“全能参考”却调用其他模式。使用当前接口的真实模式枚举值并记录，不凭内部 mode 标签臆造 API 参数。若入口没有全能参考或不支持 RGB + 3–4 张图，则保留完成的素材并报告限制，不改用首尾帧模式。最终图组覆盖检查与模式检查在 H3 Gate 内执行，不新增用户确认点。
