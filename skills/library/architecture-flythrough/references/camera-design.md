# 摄影机设计与预演

## 9. 镜头设计：电影级 FPV 为核心

每条视频都必须先回答：

> 这个镜头的主要任务是什么？

例如：

- 建立地理关系；
- 展示建筑全貌；
- 强调尺度；
- 揭示入口；
- 从外部进入内部；
- 贴近立面高速掠过；
- 穿梭城市建筑群；
- 在结尾完成 Hero Reveal。

不要因为“摄影机可以动”就无目的运动。

### 9.1 每条镜头必须规划

- Subject；
- Story Beat / 展示重点；
- Opening Composition；
- Landing Composition；
- Camera Height；
- Lens；
- Working Distance；
- Camera Path；
- Look Target Path；
- Duration；
- Speed Profile；
- FPV 强度；
- Start / Mid / Reveal / Entry / Landing 等关键帧；
- Continuity。

### 9.2 推荐 FPV 强度
#### Smooth Cinematic

- 优雅；
- 速度偏缓；
- Roll 小；
- 转弯半径大；
- 适合建筑摄影、历史建筑、豪宅、博物馆。

#### Dynamic FPV（默认）

- 明显速度感；
- 较强前景视差；
- 有爬升、下降和转弯；
- 适合城市、地标、街区和大多数展示。

#### Extreme FPV

- 高速；
- 贴墙；
- 穿洞/穿窗；
- 急转；
- 快速俯冲或拉升；
- 可允许现实无人机难以实现但视觉可信的电影式路径。

### 9.3 镜头和时长联动
时长由以下因素共同决定：

- 主体复杂度；
- 路线长度；
- 是否进入内部；
- FPV 强度；
- 需要展示的标志性结构数量；
- H3 最长限制。

建议：

- 简单建筑：10–11 秒；
- 中等复杂建筑：11–13 秒；
- 复杂地标、外到内：13–15 秒；
- 城市穿梭：13–15 秒。

不得超过 15 秒。

---

## 10. 建筑类默认镜头语法

不是固定模板，但可作为起点：

1. 建立主体全貌；
2. 快速接近；
3. 沿外立面弧线运动；
4. 揭示标志性结构；
5. 通过上升、下降或侧绕制造尺度变化；
6. 寻找具有视觉动机的入口；
7. 连续进入；
8. 内部完成第二次空间揭示；
9. 结尾落在主体核心空间或 Hero Composition。

默认“一镜到底”。

如果真实建筑内部资料不足，不得擅自声称内部完全真实；应说明哪些区域基于参考、哪些区域为合理补全。

---

## 11. 城市/街景默认镜头语法

可从以下结构组合：

1. 高位建立城市；
2. 下降进入建筑群；
3. 沿街道或建筑峡谷加速；
4. 利用前景建筑制造视差；
5. 穿过狭窄通道或低空节点；
6. 快速转向；
7. 贴近建筑立面；
8. 突然拉升/冲出；
9. 以更大尺度城市景观收束。

城市 FPV 应始终保护清晰的 action corridor，避免 Camera 被无意义细节堵死。

---

## 12. Blender 摄影机 Rig 与动画

### 12.1 Rig
推荐：

- Camera Object + Target Empty；
- `TRACK_TO`（-Z tracking，Y up）或稳定 damped track；
- Camera 和 Target 均可动画；
- Crane / Dolly / Orbit / FPV Roll 等需要分层控制时使用父级 Empty；
- 一镜到底时保持 active camera 明确；
- 用户要求多镜头时使用 timeline camera markers。

### 12.2 动画先后
先做 blocking：

- 明确位置；
- 明确目标点；
- 线性插值；
- 低成本渲染。

再做 polish：

- Bezier easing；
- 自定义 handles；
- 路径修整；
- 轻微焦距/对焦变化；
- FPV 倾斜；
- 次级相机响应。

### 12.3 运动设计

- 设计“开场—变化—落点”，不是只设两个位置；
- 需要展示深度时优先弧线、复合运动；
- 需要力量和方向清晰时可使用直线路径；
- Wide lens 可强化速度、前景视差和空间；
- Normal lens 平衡建筑和环境；
- Longer lens 压缩空间，只在叙事需要时使用；
- 焦距变化必须有理由，不要随意 zoom；
- 主路径完成后才添加轻微 shake；
- 不允许无目的摇晃替代真正的速度设计；
- 检查角速度：位置平滑不等于旋转平滑。

### 12.4 FPV 感的来源
FPV 主要来自：

- 接近速度；
- 前景视差；
- Camera Roll；
- 加速/减速；
- 与建筑表面的近距离关系；
- 转弯时的惯性；
- Reveal 的时点；
- 尺度变化。

不是来自持续抖动。

---

## 13. Shot Manifest

至少记录：

```json
{
  "name": "S01_Cathedral_FPV",
  "start": 1,
  "end": 312,
  "fps": 24,
  "purpose": "establish facade, orbit landmark features, enter interior",
  "lens_mm": 20,
  "camera_move": "approach -> right orbit -> rise -> dive -> entry -> interior reveal",
  "subject": "landmark",
  "fpv_mode": "Dynamic FPV",
  "style_mode": "Photorealistic Cinematic",
  "geometry_locked": false,
  "camera_locked": false,
  "style_locked": false
}
```

真实字段按实际任务更新，不把示例固定成所有项目模板。

---

## 14. Workbench / Eevee 预演

### 14.1 预演目的
不是看最终画质，而是确认：

- 模型身份和轮廓；
- 比例；
- 空间关系；
- Camera Route；
- FPV 速度；
- 转弯；
- 视差；
- 遮挡；
- 穿模；
- 入口净空；
- 室内外连接；
- 开场与落点；
- 时长与节奏。

### 14.2 默认设置
优先使用 Blender Workbench：

- 完整视频预演为 2560 × 1440、16:9；
- 匹配最终 FPS；
- material colors；
- studio lighting；
- shadows；
- cavity；
- 适度抗锯齿。

需要更多基础光影判断时使用 Eevee。

需要中断恢复时，优先输出原生 2560 × 1440 图像序列再编码视频。

### 14.3 必查帧
每个镜头至少检查：

- First Frame；
- First Clear Composition；
- Midpoint 或 Major Reveal；
- 每个重要 Action / Entry / Turn Frame；
- Final Frame。

对移动摄影机还要检查：

- contact sheet；或
- 完整 preview video。

静帧不能判断角速度不均、ease 异常和连续穿模。

#### 预演帧仅供内部检查，不上画布（强制）
- 本节必查帧、白模截图、测试渲染、图像序列和 contact sheet 均为项目内中间文件；制作、检查、迭代预演及确认 A 期间一律禁止放到画布。
- 内部渲染或抽帧必须采用不自动创建画布节点的方式；不允许先创建图片节点再删除，也不以拼图、附件展示或分组绕过限制。
- 保留代表帧检查、碰撞检查和完整视频检查；内部检查结果通过文字与视频时间点说明，画布只交付预演视频。
- 确认 A 后的风格阶段仍可展示3–4张生成的风格关键状态图供确认 B；不要将这些正式风格图与预演检查帧混淆。

### 14.4 预演检查问题

- 主体是否第一眼可读？
- 镜头是否完成一个明确任务？
- 地理关系是否清楚？
- 重要结构是否被遮挡或裁切？
- 前景视差是否增强空间，而非干扰？
- 镜头高度、焦距和距离是否一致？
- Camera 是否有明确落点？
- 是否碰撞、穿墙、穿模？
- 是否出现近景广角严重畸变？
- 外到内路径是否有足够空间？
- FPV 的速度感是否来自路径，而不是噪声？

### 14.5 迭代顺序
一次只改变一类变量：

1. 修正模型/碰撞/通道；
2. 修正 Camera side、position、target；
3. 修正 lens 和 composition；
4. 修正 timing 和 interpolation；
5. 添加 Roll、轻微 shake、次级运动；
6. 用同一组代表帧和完整预演再次比较。

修改记录使用具体描述，例如：

- `lens 24 -> 20 mm`
- `entry target moved 1.5m higher`
- `orbit radius +3m`

避免只写“镜头优化了”。

---

## 15. 用户确认节点 A：模型与运镜

提交前必须确认 reference_manifest.json 的参考准入和 model_qa.json 的模型质量检查已通过，且对应当前模型版本。内部草模不得作为确认 A 成品；检查失败时依 modeling.md 回到参考或对应几何层。

向用户展示：

- Blender 预演视频；
- 必要时用文字和视频时间点说明代表帧检查结果，不展示或上画布任何预演关键帧；
- 模型/镜头简短说明。

用户确认重点：

- 建筑/城市是否准确；
- 展示重点是否正确；
- FPV 路线是否满意；
- 速度是否满意；
- 是否需要更近、更快、更高、更低或换入口。

用户确认后：

> LOCK GEOMETRY + CAMERA

后续风格化阶段原则上不得改变核心建筑身份、空间布局和摄影机路径。

---

## 16. Cycles：可选“光影参考 Pass”

Cycles 不是默认最终渲染器。

### 16.1 为什么不默认完整 Cycles 动画
10–15 秒、24fps 约 240–360 帧。完整高采样 Cycles 会明显增加渲染成本，而最终 H3 会重新生成大量像素级内容，因此高成本逐帧 Cycles 往往收益有限。

### 16.2 什么时候使用 Cycles
以下情况可启用：

- 默认写实现实光影；
- 强调黄金时刻、长阴影、真实间接光；
- 室外到室内的明暗变化很重要；
- 玻璃/金属/湿地反射关系重要；
- 体积光方向需要明确；
- GPT Image 需要更可靠的物理光照参考。

### 16.3 推荐做法
优先只渲染 3–4 个关键状态帧：

- 较低/中低 samples；
- Denoise；
- 低于最终分辨率；
- 保持太阳方向、天空、曝光和基础材质一致。

可选 Cycles 关键帧须使用对应 Blender 帧的同一场景、Camera、焦距和几何版本，并共同遵循 Visual Bible。H3 视频输入始终来自 Blender RGB 预演/渲染；只有静帧不能替代完整视频。

### 16.4 默认写实光影 Look
用户未指定风格时：

- 真实建筑摄影；
- Golden Hour 或自然方向性光；
- HDR 动态范围；
- 真实材质关系；
- 适度空气透视；
- 轻微体积光；
- 电影曝光；
- 不过度梦幻，不做廉价霓虹或游戏 CG 感。

---

## RGB 母版与旋转连续性补充

- 验证四元数相邻关键帧符号连续（必要时令 dot ≥ 0）、Euler 绕回和 Track 约束极点；避免 Target 与 Camera 重合。Roll 独立分层，不让约束抵消倾斜。
- 在转弯、近墙、入口、升降极值加密采样；同时检查角速度、近裁剪面、视锥范围及碰撞净空。关键帧不穿模不代表两帧之间安全。
- 固定帧率和时间线端点；第 f 帧相对时间为 `(f - frame_start) / fps`，总帧数为 `frame_end - frame_start + 1`。
- RGB 可以是确认 A 的 Workbench/Eevee 预演，或同一已锁定镜头的改良 Blender RGB 渲染。改良渲染不得改变镜头、几何、时序；仅灯光/材质变化时重新做 RGB QA 并记录替代关系，不另加确认点。若改变模型/镜头，返回 A。
- Workbench studio light 是预演照明，不把屏幕固定高光当作真实太阳证据。风格阶段用 Bible 的世界方向定义太阳；必要时用同场景 Eevee/Cycles 关键帧核验。
- 为 H3 准备清晰 RGB：建筑边界和入口可读，避免过强 cavity、轮廓线、噪声或过曝。强风格任务仍沿同一 RGB 路线，用统一关键帧和 Prompt 控制外观。
- 编码图像序列时明确 start number 与输入 FPS；禁止重复/漏帧、悄悄裁切、变速或改变画幅。接口需要等比例缩放时记录处理并检查构图映射。
- Shot Manifest 补记 RGB 的相对路径、SHA-256、来源 blend/scene/camera 版本、frame range、FPS、尺寸、时长、总帧数、渲染引擎、QA 与确认 A 证据；风格字段参见 failure-recovery.md。

## 2560 × 1440 预演输出约束

Blender render 设置：resolution_x=2560、resolution_y=1440、resolution_percentage=100、pixel_aspect_x=pixel_aspect_y=1；禁用 use_border/use_crop_to_border，避免裁出局部尺寸。编码保持同尺寸、同帧率、同帧序。初始化脚本对新建或显式复用场景都会设置这些输出属性，不改变已有相机与几何。

可用小尺寸单帧做内部试渲染；所有完整预演视频与确认 A 的 previs.mp4 必须原生 2560 × 1440。速度不足时采用 Workbench、较低采样和图像序列续渲染，不能擅自改成 720p/1080p 再放大。无法完成则说明真实进度，不把未达标文件当作完成。

运行 `python scripts/validate_output.py previs.mp4 --previs --expected-fps 24 --decode-check`，帧率与其他期待参数按 manifest 设置。分辨率检查只能证明文件尺寸；还须核对 Blender 配置、源序列尺寸与编码命令，确认没有低分辨率上采样。

2560 × 1440 是 Blender 预演标准，不承诺 H3 最终输出具有同样分辨率。若 H3 入口不接受该尺寸，保留已确认母版，只有接口确需且允许转换时制作等比例上传副本，记录派生关系与映射，不覆盖原预演。不得改变时序、裁切或将上传副本作为确认 A 的原生交付。
