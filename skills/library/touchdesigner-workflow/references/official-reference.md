# Reference：TouchDesigner 通用效果知识

这张卡把 Derivative 官方学习页、节点家族概览和代表性节点文档整理成“效果目标 → 数据类型 → 节点组合”的可执行检索地图。节点名称、参数名和菜单值以当前 TouchDesigner 版本为准；遇到版本差异时先在 TD 的 OP Create、帮助页和 Info DAT 中核验。涉及启动、文件选择、设备、编解码或网络输出时，先按当前操作系统和硬件做能力探针，不把某台机器的路径、驱动或默认设备当作通用事实。

## 内容导航

- 效果选择矩阵：按用户描述选择输入、处理和输出。
- TOP、SOP/POP/COMP/MAT、CHOP、DAT：节点家族和最小闭环。
- 摄像头/姿态/深度、网络控制、文字/UI：外部输入和可复用模块。
- Raymarching、投影映射、媒体桥接：高级视觉和发布路径。
- 开源工程归纳：按效果检索连接模式、参数策略和依赖风险。
- 能力与风险边界：判断哪些效果可直接交付、哪些需要环境探针。

- 稳定性检查：实例冲突、外部依赖、空参数、节点命名、监听与编码失败。

## 何时读取

- 用户提出视觉、交互、生成、3D、音频、摄像头、UI、网络或导出效果，而没有指定节点时。
- 需要从多个 operator family 组合网络，或判断一个效果应由 TOP、CHOP、SOP、DAT、COMP、MAT、POP 还是 GLSL 完成时。
- 节点能工作但画面不稳定、反馈失控、3D 黑屏、shader 编译失败、设备无数据或输出不可复现时。

## 跨平台与环境探针

- **主机边界**：按 TD 所在的 macOS/Windows 主机选择启动方案。Agent 在容器、WSL 或远程服务中时，`localhost` 可能并非 TD 主机；先核对连接能力所属主机和目标实例，不尝试在 Linux 上用文件启动器代替 TD。无目标主机执行权限时说明阻塞点。
- **文件路径**：资源路径来自用户输入、应用注册信息或文件搜索。系统下载目录可能被本地化、重定向或位于其他盘符；使用系统目录 API/运行时返回值，不拼接固定用户名。主机文件路径用对应 OS 路径库处理，Shell 参数作为独立字符串传递并转义空格、中文和引号；TD 内部 OP 路径仍使用 `/`。
- **工程与依赖**：先保留当前窗口及未保存工程，再决定导入还是独立打开。`.tox` 按该发行包的依赖清单保留脚本、模块、schema；加载用持久路径，不能依赖即将清理的临时目录。Shell 的 Python 环境不等于 TD 内置 Python，依赖安装先核对解释器、版本与 CPU 架构，不自动全局安装。
- **连接与参数**：连接能力与工程内的服务组件必须指向同一实际实例。UI 菜单名称和组件参数以当前环境读到的值为准；端口占用或 Active 标签不能单独证明目标网络可读。
- **设备与效果**：重新枚举摄像头、音频驱动、声道、显示器、字体和编解码器；确认 GPU、TD build、Python 依赖、许可证和所需 OP 可用。POP、CUDA/特定 GPU 效果、追踪组件、硬件编码和采集卡能力不能从另一台设备照搬。Syphon/Spout 按目标平台选择，NDI 也需验证实际支持；缺能力时说明替代效果及损失，不静默改变交付目标。

### macOS / Windows 启动分支

以下是准备与恢复（见 `environment-readiness.md`）中的应用启动备用方案，不取代当前工程保护和权限检查。优先复用当前运行实例；找不到某个 CUA 工具时仍检查 Shell。启动前通过应用清单、已运行进程、文件关联或系统注册信息确定安装位置和版本；多个安装版本无法确定目标时询问，不假定固定盘符或安装目录，也不重新安装 TD。

**macOS**：确认命令在 TD 所在 Mac 执行并存在 `open`。`td_app_path` 必须是已发现并核验的 `.app` 路径，`target_file` 是已确认的 `.toe` 或冷启动所需 `.tox` 的绝对路径；变量不得为空，也不能含未替换的占位文字：

```sh
open -a "$td_app_path" "$target_file"
```

**Windows**：确认使用目标 Windows 主机上的 PowerShell；`tdExePath` 是已发现的 TD 可执行文件，`targetFile` 是已确认的工程/组件路径。路径可能包含空格，`ArgumentList` 中的文件参数也必须带引号：

```powershell
$launchArgument = '"' + $targetFile + '"'
Start-Process -FilePath $tdExePath -ArgumentList $launchArgument
```

若只需启动应用，省略文件参数；不能传入空的目标文件。没有 PowerShell 时使用已授权的原生进程启动工具，以参数数组传递文件路径。只有确认 `.toe`/`.tox` 文件关联指向正确 TD 版本后，才可直接用系统文件关联打开；不能假设其他软件不会接管该扩展名。

上述命令不证明组件已导入。打开文件后观察目标窗口，再执行 Skill 的等待、组件检查和连接验收。组件已通过打开动作加载时不要再次导入。缺许可、系统安全提示或目录权限时报告实际阻塞，不自动提升权限或关闭系统保护。

### 换机验证清单

- TD 已确认关闭、只有完整组件包：先自动启动和加载，再做连接检查；不以必然失败的调用作为启动前置条件。健康检查和节点读取成功；macOS/Windows 分开记录实测结果。
- TD 正在运行且有未保存工程：保留现场，不因缺 UI 工具就另开组件工程。
- 安装路径/资源路径有空格、中文或不同盘符，多版本安装、组件改名、目标网络不是默认名称：仍定位到正确实例和节点。
- 组件缺失、依赖不全、冷启动较慢、连接能力不匹配、端口不同或占用、Shell 无网络权限：正确区分错误，有界重试且不误报“已连接”。
- 搬迁 `.toe` 与完整资源目录后重新打开，外部 `.tox`、脚本、媒体、字体和设备引用重新验证；未在对应主机执行的项标为未实测。
- 已连接后返回服务路由不存在：停止写入，检查同一实例/工程/组件；不重开 `.tox`、不切换工程、不重发失败的大脚本。有安全的原位恢复方法时最多尝试一次，否则报告路由故障。
- 写入超时或 TD Python API 报错：先读回部分完成状态，只补未完成阶段；不能把脚本错误当作 TD 未启动，也不能重复创建已存在节点。
- 已授权的另存和备份：保存前核对目标及资源引用，保存与节点编辑分开；保存后健康检查和工程/资源验收成功才更新 owner。文件复制不得声称包含未保存修改；不强制把 `.toe` 留在组件包目录。

## 效果选择矩阵

先用这张矩阵把用户的“效果语言”翻译成可观察的数据流，再选择节点。一个效果可以跨多行组合；先搭最小闭环，再叠加第二种数据或反馈。

| 用户描述 | 起始输入 | 主要处理 | 常见输出 | 稳定性要点 |
|---|---|---|---|---|
| 呼吸、脉冲、节拍 | Beat/LFO/Audio/OSC | Analyze → Math → Lag/Logic/Trigger | TOP 参数、SOP 缩放、Timer 状态 | 连续值与事件分开；只映射少量高影响参数 |
| 拖尾、回声、流体感 | 任意 TOP | Feedback → Level/Blur/Displace/Transform → Composite | 全屏 TOP | 反馈增益小于 1，保留衰减和清除入口 |
| 粒子、尘埃、星云 | SOP 点或 POP | Force/Noise/texture/instancing | Render TOP、点云输出 | 大量点优先 GPU；控制粒子数和 cook 频率 |
| 花环、环形阵列、机械阵列 | Circle/Line/Grid | Copy/Instancing + CHOP 角度/尺度 | Geometry → Render | 用索引或 LFO 做相位，避免每帧随机化 |
| 融化、波浪、布料 | Grid/Line/Sphere | Noise/Deform/Spring/GLSL | Geometry → Render | 先固定拓扑，再调位移幅度和阻尼 |
| 轮廓、人体、手势驱动 | Video Device/MediaPipe/Depth | Threshold/Script/CHOP 分析 | CHOP/SOP/COMP | 先检查帧率、延迟和关键点坐标系 |
| 文字出现、曲面文字 | Text TOP/SOP | Timer/Character delay/Creep/Twist | TOP 或 Geometry | 字符动画由 Timer 驱动，布局与动画参数分离 |
| 抽象体积、分形、隧道 | GLSL TOP | SDF/raymarch/warp/repeat | GLSL TOP → Composite | 核验 GLSL 版本、uniform 和迭代上限 |
| 多投影、舞台输出 | TOP/Render | Mask/Warp/Soft Edge | Window/NDI/Syphon/Spout | 输出前确认分辨率、色彩空间和设备状态 |

## 官方学习入口

- Derivative Learn：User Guide、Fundamentals 101 Curriculum、教程、工作坊和支持入口。
- Tutorials：100 Series Fundamentals（69 个主题，含文字、短视频和示例工程）、200 Series Intermediate、官方 YouTube 与工作坊索引。
- Introduction to Python Tutorial：参数表达式、`me`/`op`/`parent`、CHOP 通道、DAT 回调和组件模块。
- TouchDesigner Official YouTube：官方教程、工作坊和社区播放列表。

## 先按数据类型选家族

| 家族 | 官方定位 | 适合的效果问题 | 典型输出 |
|---|---|---|---|
| CHOP | CHOP 处理通道和样本，覆盖运动、音频、数学、逻辑、MIDI、设备和协议 | “数值如何随时间、输入或事件变化？” | 参数导出、动画、音频、控制信号 |
| TOP | TOP 在 GPU 上实时处理图像、纹理、电影和合成 | “画面如何生成、变形、叠加或反馈？” | 图像、纹理、显示、视频 |
| SOP | SOP 生成、导入、修改和组合 3D 表面 | “几何轮廓、点、线、面或粒子如何变化？” | 几何、点云、曲线、模型 |
| DAT | DAT 保存文本和表格，并承载脚本、shader 和网络消息 | “文本、表格、脚本或消息如何驱动系统？” | 文本、JSON、脚本、配置 |
| COMP | Component 把网络封装成模块；Panel COMP 负责交互界面，Object COMP 负责 3D 对象 | “如何封装、复用或让用户操作？” | UI、相机、灯光、几何模块 |
| MAT | MAT 为 SOP/Geometry 提供材质和 shader | “表面如何着色、反射、透明或发光？” | 3D 材质 |
| POP | POP 用 GPU 处理点和粒子（以当前版本可用节点为准） | “大量点、粒子或实例如何高性能运动？” | 点云、粒子、实例 |

## TOP 效果地图

TOP Sweet 16 概览 将常用 TOP 按目的归类；执行时从下列角色选最小闭环：

- 生成：Ramp、Constant、Noise、Text、Movie File In、Video Device In。
- 调色：Level、Luma Level、Lookup、Channel Mix、HSV Adjust。
- 几何化变换：Transform、Flip、Crop、Fit、Corner Pin、Displace。
- 质感：Blur、Edge、Feedback TOP、Cache、Time Machine。
- 层级：Composite/Over、Cross、Multiply、Switch、Select。
- 3D 输出：Render TOP；最小需求是 Camera、Geometry 和必要的 Light/MAT。
- 自定义 GPU： GLSL TOP 运行像素或 Compute Shader；shader 放在 Text DAT，并通过 Info DAT 看编译错误。

Movie File In TOP 读取电影、图片和图片序列。现场播放可用 Sequential；可复现检查和非实时导出用 Locked to Timeline 或 Specify Index。Info CHOP 可读打开状态、长度、分辨率、内部帧率、当前帧、掉帧和是否有音频。

Video Device In TOP 接收摄像头、采集卡、IP camera 或视频解码器。Active、Driver、Device 是第一检查项；Info DAT/CHOP 可辅助判断设备占用和性能。

Movie File Out TOP 输出电影、图片、图片序列和 stop-frame。Type、codec、像素格式、帧范围和绝对路径必须先核验；含音频时需要 Time Sliced 的单声道或立体声音频 CHOP。实时跟不上时会重复视频帧保持同步，非实时导出适合时间线锁定的可复现效果。

### 反馈、残影和时间效果

开源工程反复使用的可靠形状是：

`输入 TOP → Level(轻微衰减) → Displace/Noise(小幅) → Feedback → Composite(Over/Add) → Transform/Lookup → Null/Out`

- Feedback 的第一次迭代先接一个稳定基底，确认能清除；再加入 Displace、Radial Blur 或 Light Tunnel。
- Level 的 Opacity/Multiply 每帧只做小幅衰减；Transform 的缩放、旋转和位移步长保持很小，避免迅速溢出或塌缩。
- 用 Reset/旁路开关、定时清除或场景切换时清除历史；把反馈链路和最终输出分开，便于调试。
- `Cache TOP`、`Time Machine TOP` 和 `Trail CHOP` 可提供可控历史，不必所有历史都用 Feedback 保存。

## SOP、POP、COMP 和 MAT 的 3D 地图

SOP 的官方常用节点包括：

- 基元与结构：Circle、Sphere、Torus、Grid、Box、Line、Add。
- 组合与复制：Merge、Copy、Switch、Blend、Object Merge。
- 变形与细节：Transform、Noise、Twist、Deform、Carve、Facet、Subdivide、Convert。
- 纹理与材质前置：Texture、Material、Attribute、Normal。
- 数据驱动：CHOP to SOP、DAT to SOP、Script SOP；粒子和大量点优先评估 POP/ GPU 组件。
- 导入导出：File In SOP、FBX/模型组件；输出前核对单位、法线、材质和相机可见性。

Geometry COMP 可把 SOP 渲染一次或按 CHOP 样本、DAT 行或 TOP 像素实例化。实例化前明确每个实例通道的语义（位置、旋转、缩放、颜色），用 Math/Lookup 调整范围。

### 实例化和 GPU 粒子模式

- **环形/阵列**：`Circle SOP → Copy/Geometry Instancing`，用 `LFO/Count` 生成角度或索引；用 Math 做半径、相位和随机种子的范围限制。
- **弹性网格/布料**：`Line SOP → Spring SOP → Geometry Instancing`，弹簧的阻尼和长度决定稳定度；先以少量点验证，再增加分辨率。
- **纹理驱动实例**：把 TOP 像素经 `TOP to CHOP` 或实例化纹理通道映射到位置、颜色、旋转和缩放；注意像素坐标到世界坐标的归一化。
- **轮廓转几何**：`Threshold TOP → TOP to CHOP/CHOP to SOP` 或 Script SOP，先滤除噪点再生成点/线，避免把每个噪声像素都当成实例。
- **GPU 粒子/POP**：输入点或纹理 → POP 的位置/速度/力场 → 粒子渲染；在版本差异较大的节点上，先读取当前版本的 POP 节点和参数，不凭旧教程硬编码。
- **传统 GPU 位移**：`Sphere/Geometry → GLSL MAT 顶点位移`，由 Feedback、Noise 或音频纹理驱动 uniform；输出可再次进入 TOP 反馈制造回声。

COMP 负责封装和交互：Container COMP 组合面板，Panel Component 提供按钮/滑块/触控状态，Base COMP 适合无 UI 的可复用网络。3D 场景至少要让 Geometry、Camera、Light、MAT 和 Render 闭环可见。

## CHOP 控制与事件地图

CHOP 的官方 Sweet 16 列表提供通用起点：

- 产生：Constant、Pattern、LFO、Noise、Timer、Beat、Pulse。
- 取舍/组合：Select、Switch、Merge、Shuffle、Lookup。
- 数学/范围：Math、Limit、Slope、Speed。
- 稳定/历史：Lag、Filter、Delay、Trail、Record、Cache。
- 事件/状态：Logic、Trigger、Timer、Count；Logic 的 Bound + Rising Edge 将连续值变成一次性事件。
- 输入：Audio File In、Audio Device In、MIDI In、OSC In、Panel CHOP、Info CHOP。
- 转换：CHOP to TOP/SOP/DAT，把通道分别变成图像、几何或表格。

Analyze CHOP 将通道样本压缩为单样本，可选 Average、RMS Power、Maximum、Minimum 和 Peak。先分析再映射，避免单个瞬时样本直接控制大幅视觉。

Math CHOP 负责 Positive、Negate、Average、Multiply、Range 等数学变换；Logic CHOP 负责二值转换、Bounds、Rising/Falling Edge 和多通道逻辑；不要混淆两者职责。

Timer CHOP 输出计时 fraction、counter、running、done 等状态并支持 Python callbacks，适合 cue、playlist、延迟和状态机；多个段落可用 Segments DAT 定义。

Audio Device Out CHOP 将 CHOP 音频发送到 CoreAudio/DirectSound/ASIO。Active、Device、Volume、Pan、Cook Every Frame 和 Buffer Length 是监听检查项；它与视觉 Viewer 是独立输出链路。

### 音频与节拍的实用分层

常见音频视觉链路为：`Audio File In/Audio Device In → Audio Spectrum CHOP → CHOP to TOP → Constant/Composite`。频谱可以直接画成 RGB 横条或纹理；低频/包络适合驱动整体尺度、镜头或发光，高频适合细节、颗粒和纹理。

如果用户只需要“重拍变化”，使用 `Analyze CHOP (RMS/Peak) → Math(阈值/范围) → Logic(Rising Edge) → Trigger/Timer` 生成一次性 beat 事件；连续的 RMS 只控制呼吸或幅度。对输入加 Lag/Filter，避免每个采样点都触发大幅跳变。音频文件播放和监听必须分成两条链：`Audio File In CHOP → 视觉分析`，以及 `Audio File In CHOP → Audio Device Out CHOP`。

## DAT、脚本、网络和 shader

- Table DAT：手工或程序化维护行列数据，适合参数表、实例表和 Timer 段落。
- Text DAT：脚本、GLSL、JSON、XML、说明文本的容器。
- DAT Execute DAT / Execute DAT：内容或生命周期变化时执行回调。
- CHOP to DAT / DAT to CHOP：在数值通道和表格/文本之间转换。
- OSC In/Out DAT、Web Client DAT、Web Server DAT：接收或发送 OSC、HTTP、WebSocket 和二进制媒体；收到后先规范化再驱动参数。
- GLSL TOP：Text DAT 保存 shader，TOP/CHOP 数据可作为 uniform；用 Info DAT 验证编译。
- [Script TOP/CHOP/SOP]：Python 生成图像、通道或几何时，先确认 cook 频率、数组尺寸和错误输出。

### 摄像头、姿态和深度

开源 MediaPipe 工程的通用桥接是：`Web Browser/WebSocket → JSON → Script CHOP 或 Script SOP`。

- 关键点写入 Script SOP 的点位置，也可以转换成命名的 x/y/z CHOP 通道；blendshape 分数适合直接作为表情参数。
- 保留检测耗时、绘制耗时、输入帧率、实时比例和延迟等诊断通道；只启用需要的模型，否则 CPU/GPU 负载会明显上升。
- 外部 `.tox` 依赖其发行包声明的资源目录和 Python 包；不假定目录一定叫 `toxes`。加载后检查组件内部错误和路径，不要只看外层节点。
- Depth Anything 等深度模型通常通过 Thread Manager 和 TDPyEnvManager 异步运行，以免阻塞 TD UI；部署前确认 Python 环境、模型文件、显存和许可证。

### 网络、OSC、MIDI 和录制回放

- OSC In CHOP、MIDI In CHOP 和传感器输入先进入 `Select → Math/Range → Filter/Lag`，再驱动 Transform、Camera 或状态机。手机陀螺仪 pitch/roll 等有符号数据要先做坐标和范围映射。
- CHOP Recorder 可把 MIDI、LiDAR、传感器或现场控制录制到磁盘并回放；录制文件应记录采样率、通道名和时间基准。
- Web Client/Server、WebSocket、TUIO 和 OSC 都要有连接状态、超时和重连分支；原始网络抖动不能直接绑定大型视觉参数。

## Python 与表达式

Introduction to Python 的可迁移规则：

- 将场景读取返回的节点路径字符串传给 `op`；`parent`、`me` 用于层级和当前 operator。不要把示例工程路径复制到另一个工程。
- `op('audio')['chan1']` 读取 CHOP 通道；参数进入 expression mode 后会随值变化自动更新。
- 在工程内执行脚本前读取节点详情、参数名、菜单值和连接；不要凭记忆写版本相关参数。
- 创建网络时保留输入、处理、合成、输出四类节点和可观察的 Null/Out。
- 改动后重新读 evaluated values、表达式状态和 errors；保存、录制、发送设备数据前确认实际路径和副作用。

## 文字、UI 与可复用组件

`TD_textEffects` 展示了适合复用的 Base 封装：`Custom Parameters → Parameter DAT → Select DAT → DAT to CHOP → Timer CHOP → Text TOP/Text SOP → Out`。

- 逐字出现：Timer 的 fraction 或字符索引控制每个字的延迟和透明度。
- 环形、管道和球面文字：Circle/Grid/Sphere 提供路径或点，Text SOP 配合 Creep、Twist；布局参数和动画参数分开暴露。
- 立体文字：Text TOP 作为纹理贴到 Box/Geometry，或直接用 Text SOP 加 MAT；需要多种动画时用 Switch TOP/COMP 切换。
- UI 组件：Container/Panel/Widget → Panel CHOP/Callbacks → Math/Logic → 目标参数。把可调参数集中在 Custom Parameters，并为 reset、预览和错误状态保留控件。

可复用 `.tox` 的经验来自 TDXComponents：Playback（scrub、loop、crossfade、fade）、Masker（多 mask、曲线、反转、预设）、Color Curves、Comper（多层 crop/level/translate/rotate/scale/matte）、Step N Repeat、Timecode 和 CHOP Recorder 都应保持清晰的输入/输出端口与状态参数。Optimeister 只在数据变化时运行 Filter/Lag/Logic/Timer，适合降低空闲时的 cook 开销。

## Raymarching 与 GLSL 结构

Raymarching 工程的可迁移结构是：`GLSL TOP/Raymarcher →（可选传统 Render TOP）→ Composite`。常见模块包括 SDF 基元、数组纹理、软阴影、环境遮蔽、Arcball Camera、空间扭曲、重复、分形、gyroid 和 kaleidoscope。

- 先实现单一 SDF、法线和相机，再逐个加入重复、扭曲、阴影和后处理。
- 把时间、分辨率、鼠标/控制器和输入纹理作为明确 uniform；用 Info DAT 读取编译日志。
- 每次增加迭代、采样或反馈都观察 GPU 时间和分辨率；将高成本 shader 放在可切换分支。

## 投影映射、媒体桥接和发布

投影映射的通用流水线是：`内容 TOP/Render → mask → warp/calibration → Soft Edge（多机时）→ Window/输出设备`。Kantan Mapper 适合 2D/平面映射，CamSchnappr 适合基于相机的 3D 投影，LDI/Projection Mapping Workshop 还强调 Show Prep、UI 和校准状态。

网页或仪表盘可用 `Web Render TOP → Syphon/Spout Out 或 NDI Out` 送入 OBS、其他视觉软件或网络视频系统。输出前明确帧率、分辨率、色彩空间、设备连接和权限；不要把 Viewer 可见当成发布成功。

## 开源工程归纳（用于模式检索）

以下项目用于学习网络结构和参数取舍，实际复用前必须核对仓库许可证、TouchDesigner 版本和外部资源：

| 效果/模块 | 代表工程 | 可迁移模式 |
|---|---|---|
| 音频频谱、反馈、文字 | touchdesigner-playground、TD_audioreact_love_EN、TD_textEffects | Audio Spectrum → CHOP to TOP、Feedback/Composite、Timer+Text 封装 |
| 生成粒子、实例和实验网络 | touchdesigner-generative-particle-system、touchDesigner_experiments、touchdesigner-instancing-examples | 点/线/网格生成、GPU 位移、CHOP/DAT/TOP 实例数据 |
| OSC、外部控制 | TouchDesigner_OSC_Controller | OSC In → Select/Math/Range → 相机/Transform，配合平滑 |
| 姿态、面部和深度 | mediapipe-touchdesigner、TDDepthAnything | WebSocket/JSON→Script CHOP/SOP、异步模型与诊断通道 |
| 投影映射 | touchdesigner_ldi_projection_mapping_2019、ProjectionMappingWorkshop | Kantan Mapper、CamSchnappr、Soft Edge、Show Prep |
| Raymarching、SDF、程序化体积 | Raymarching-in-TD | GLSL TOP、SDF/重复/分形、传统 Render 混合 |
| 可复用组件、性能与输出 | TDXComponents、Web2NDI_SyphonSpout_TouchDesigner | `.tox` 模块、录制回放、GLSL 合成、Web Render→NDI/Syphon/Spout |
| 官方教程样例 | TD-Tutorials | 基础 TOP/CHOP/SOP/COMP 连接和课程式拆解 |

这些工程共同说明：稳定的 TD 网络通常有明确的输入、处理、合成、输出边界；参数通过少量中间 CHOP 控制；每个复杂分支都保留 Null/Out、Info 或状态通道。`.toe`/`.tox` 是版本相关的二进制资源，打开后必须重新检查节点错误、依赖路径和许可证，不能仅凭仓库文件保证兼容。

## 可稳定交付的能力与风险边界

通过当前机器的版本、GPU 和许可证探针后，可优先尝试原生节点实现的 2D 生成纹理、反馈、频谱驱动、3D 几何/实例、文字和基础文件输入输出。粒子、姿态追踪、硬件编码及媒体桥接另行核验节点与依赖，不将某个平台可用视为所有机器可用。

POP 高级网络、MediaPipe/Depth Anything/ONNX、Syphon/Spout/NDI、采集卡和专业音频设备都依赖 TD 版本、操作系统、硬件或 Python 环境；实施时先做最小可运行探针并保留降级路径。复用开源代码、`.tox` 或素材前必须核对 MIT/GPL/专用共享许可及仓库是否声明许可证。

## 按效果目标组合

### 生成与循环纹理

`Ramp/Noise/Constant → Level/Transform → Composite → Feedback/Cache（可选）→ Null`

固定种子与分辨率；LFO/Timer 只控制少量连续参数，Feedback 必须有衰减或清除条件。

### 3D 形体、粒子与实例

`Circle/Grid/Line → Noise/Deform/Copy/Particle → Geometry + MAT + Camera/Light → Render → Composite`

CHOP、DAT 或 TOP 可作为实例数据源；先核验通道数量、实例索引和相机可见性。

### 设备与用户互动

`Video Device In / Panel / OSC / MIDI → Select/Math/Filter/Logic → 参数或状态机 → TOP/SOP/COMP 输出`

把原始输入变成有范围、可平滑、可触发的控制信号；设备状态用 Info DAT/CHOP 验证。

### 音频反应（可选输入）

`Audio File In/Device In → Math(Positive) → Analyze(RMS/Average) → Lag → Logic/Trigger → TOP/SOP/COMP 参数`

低频或包络驱动大尺度，高频驱动细节；背景基底保持稳定，避免每帧随机改 seed/period/颜色。

## 反模式

- 只因出现“动态”就同时连接多个 LFO、Noise 和 Feedback，导致不可解释的运动。
- 把未经范围转换、滤波或事件化的原始设备/网络/音频数据直接绑定视觉。
- 只看 Viewer 认定音频输出或视频导出成功。
- 3D 网络缺 Camera、Geometry、Light、MAT 或 Render 中任一关键环节却继续调材质。
- shader/脚本报错时盲目重建整套网络，不先读 Info DAT、错误列表和已完成节点。


## 稳定性检查

更新原包记录了 2026-09-10 的历史会话及 macOS / TouchDesigner 2025.33230 现场观察。以下保留其决策边界，不将原包的现场结论视为本次适配已复测，也不推广为所有 build、许可证和硬件都适用。

- 启动后立即控制可能连接拒绝；按 `environment-readiness.md` 的准备、归属检查和有界恢复执行。两个实例争用同一监听位置时，请求可能落入错误工程；先停止写入并区分实例，不通过反复打开组件碰运气。
- `externaltox` 解析到不存在的组件时，监听正常也可能无法读取工程。保留发行包声明的组件、模块、脚本和描述文件，迁移及保存后重新核对实际解析路径。
- 新建 OP 名称使用 ASCII 字母、数字和下划线，例如 `fx_feedback`、`out_main`。中文内容写入 Text DAT/TOP 或参数；原包记录过中文 OP 名称导致 `Illegal node name specified`。不要为修一个新节点去重命名已有用户网络。
- 参数 `page`、`menuNames` 可能为空，版本相关方法可能缺失。参数读取用下方模板区分空值和求值失败；错误读取缺失或失败要标为未验证，不能伪装成空错误列表。
- 布局先核对当前对象支持的 `nodeX`、`nodeY`，仅在需要时逐节点安排，不凭记忆调用未知布局方法。
- Non-Commercial、当前 macOS build 或硬件可能限制 H.264/H.265、AAC。读取当前编码菜单后做最小导出，设置编码器后立即检查节点错误；可选 ProRes、MJPEG、PNG 序列等也须本机验证。中间格式不等于用户要求的最终格式，必要的外部转码及音轨仍须完成验收。
- Audio Device Out 无输入时可能报 `Not enough sources specified`。分析与监听分开，未要求监听时关闭该输出；需要监听则先修复输入、设备及声道，不隐藏错误。

### 容错的只读诊断

以下函数只检查调用方已从当前工程取得的实际参数或节点对象，不寻找固定端口、不修改节点。读取服务节点及父组件时，分别保留节点路径、实际参数值、错误结果，再与目标工程归属核对。返回未验证时仍可继续独立诊断，但不能据此宣布组件无错误。

```python
def describe_par(parameter):
    page = getattr(getattr(parameter, 'page', None), 'name', None)
    menus = getattr(parameter, 'menuNames', None) or []
    try:
        value = parameter.eval()
        evaluation_error = None
    except Exception as exc:
        value = None
        evaluation_error = str(exc)
    return {'name': getattr(parameter, 'name', None), 'page': page,
            'value': value, 'menus': list(menus),
            'evaluation_error': evaluation_error}


def read_node_errors(node, recurse=False):
    reader = getattr(node, 'errors', None)
    if not callable(reader):
        return {'verified': False, 'errors': None,
                'reason': 'Error inspection unavailable'}
    try:
        errors = reader(recurse=True) if recurse else reader()
        if errors is None:
            return {'verified': False, 'errors': None,
                    'reason': 'Error inspection returned no result'}
        return {'verified': True, 'errors': list(errors)}
    except Exception as exc:
        return {'verified': False, 'errors': None, 'reason': str(exc)}
```

正常值、求值异常、节点报错和错误检查本身失败是不同结果。检查结果没有错误后，还需核对画面、短预览、设备状态以及文件的类型、尺寸、帧率、时长、帧数和音轨；节点参数正确不能替代交付验收。
