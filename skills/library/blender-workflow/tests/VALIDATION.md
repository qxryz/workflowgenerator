# Blender workflow validation

## 0.11.1 Windows cold-launch correction, 2026-09-10

The real Design session loaded the 0.11.0 Skill and called its service entry, but application launch returned `launch_failed`. Reproducing the production PowerShell command showed an empty `FilePath`: the environment-variable expression used property syntax instead of PowerShell's `env:` scope. The launcher now reads the literal application path correctly. A regression executes the production command in actual PowerShell while intercepting only process creation; it fails before the correction and passes afterward, including spaces, Unicode and shell metacharacters in the supplied path. macOS retains its existing `open -a` command.

A real cold launch now opens Blender 5.2.1 LTS. The next preparation attempt initially reported an unavailable/ambiguous window; the subsequently observed window was showing Blender's welcome overlay. Newly launched instances now have a bounded wait for their window and receive Escape before the Python Console shortcut. Existing instances do not receive this extra input, and multiple/owned windows still block dispatch. These transitions are covered by controller and service tests.

During verification the user resumed the Design conversation. Its service helper returned `service_started` and `scene_read`, and its actual Blender MCP scene read then succeeded. That live result covers service startup in the already-open application. An uninterrupted cold-launch-to-scene run with the final readiness adjustment remains unverified because the user's creative task is now using Blender. No modeling/rendering/canvas-delivery outcome is claimed by these startup checks.

Validation: 31 Node tests and 23 Python tests passed. The full market validation passed its file, bilingual-name, metadata, tool-name and plugin checks; the two generated-index comparisons failed because Windows Python emitted the comparison output in its default code page. Repeating both index comparisons with Python UTF-8 output passed. Diff-based version checks were skipped by the validator because no base SHA was available; this change bumps the Skill from 0.11.0 to 0.11.1. The active Design runtime also reported that version enabled.

## 0.11.0 Windows addon service startup, 2026-09-10

Added `scripts/blender-service.mjs` as the Windows preparation-to-scene entry, using the installed connector's bundled addon and protocol. It opens/reuses the application, dispatches a bounded console bootstrap, validates addon identity and reads a real scene. The standalone host launcher remains available; its Windows launch now delegates process detachment to Start-Process. The macOS launch path is unchanged and does not use the Windows dispatcher.

Live verification on the existing Windows Blender 5.2.1 LTS instance initially reproduced a disconnected service. Console shortcut and text injection required scan-code input instead of zero-scan virtual keys or Unicode packet input. After that correction, the helper returned `service_started` and `scene_read` with the existing Scene and three objects. This verifies service startup and scene access, not modeling, rendering or canvas delivery. No project switch/save/reset or global preference save was requested.

Automated service tests cover read-only status, already-connected reuse, multiple instances, addon errors, nonce mismatch, missing acknowledgement, unresponsive service and permit/lock cleanup. Python bootstrap tests exercise the permission deadline, addon identity, busy state and preserved project. Run the Node tests and `python -B skills/blender-workflow/tests/test_service_bootstrap.py`. Actual macOS startup and cold Windows application launch require separate integration coverage.

## 0.10.0 default canvas preview, 2026-09-10

Both runtime entrypoints now require a rendered canvas preview alongside the editable source for completed creative work, unless explicitly waived. Static work returns one image; dynamic work returns one finished playable rendered video. This changes the shared workflow only, not platform-specific connection or launch scripts.

These scenarios are static workflow acceptance cases, not live Blender or measured model-execution results:

| Request or state | Expected |
|---|---|
| 用 Blender 做一个可编辑的静态产品模型 | Save the editable source and render one representative image; validate, persist and return it to the canvas without an extra render request |
| 帮我用 Blender 做小猫奔跑，再做环绕后拉运镜 | Render the full intended animation and camera move, assemble if needed, verify playback and return one video plus the editable source; no still substitute |
| 修改已有模型；工程里另有无关动画 | Classify the requested result rather than unrelated keyframes; update its single static preview to match the saved source |
| 最终图片或视频已经生成并自动收录 | Verify the existing file and node, then reuse them without a duplicate preview or video-thumbnail node |
| 只保存 blend，这次不要渲染或放画布 | Honor the explicit exception and verify source delivery without rendering |
| Render produced only numbered PNGs or failed midway | Preserve resumable data outside asset scanning; finish rendering and assembly before video delivery, or report the blocker |
| Verified media exists but canvas publication failed or timed out | Retain the file and source, inspect existing nodes before retrying, and distinguish rendering success from canvas delivery |

Live static-image rendering, full-animation rendering and Design canvas display/playback remain integration checks on Windows and macOS. Market validation checks packaging and metadata; it does not establish those application outcomes.

## 0.9.0 Windows preparation, 2026-09-10

Windows tests cover managed Python selection, bounded dependency repair, archive/path validation, conflicting files, concurrent repair ownership, installation retry and process-aware application discovery. Run `node --test skills/blender-workflow/tests/*.test.mjs` and `python -B skills/blender-workflow/tests/test_windows_dependencies.py` from the market root.

A fresh isolated copy of the actual Windows connector bundle reproduced `ModuleNotFoundError: pywintypes`. With managed CPython 3.12 x64, the helper downloaded the pinned pywin32 310 wheel, verified its SHA-256, added files only inside that copy, and passed a fresh server import. The original install-addon command then successfully wrote its bundled addon to a separate empty test directory. The live connector cache, Blender preferences and open project were not modified by this verification.

The real Windows host probe found the installed and running Blender 5.2. Full live registration, addon enablement and scene reads remain application integration checks. These results do not claim that a creative task was completed.

## 0.8.0 connector preparation, 2026-09-09

Added a self-contained preparation helper and mirrored first-use instructions. Six helper tests pass: workspace binding rejection, read-only status, local HTTP installation round trip and reuse, unavailable or stale host handling, busy/invalid response rejection, and no automatic retry after an unknown installation outcome. The local HTTP fixture simulates the installer; it does not download or install a real connector.

The paired client change dispatches through its existing connector registry. Its 28 targeted tests pass across preparation, authenticated main bridge and gateway behavior, including all ten registered connectors, unregistered-ID rejection, and response identity checks. Gateway and service type checks pass after rebuilding shared protocol declarations. Market validation passes with pre-existing nonblocking short-description warnings.

The running Electron application has not been restarted for this update. First-use download, system authorization, live Blender addon startup and scene access remain integration checks; these automated results do not claim that those steps succeeded on the user's application.

## 0.7.1 adaptation scope

Adapted the supplied 0.7.0 archive for the skill market: English and Chinese entrypoints, publishing metadata, concise intent-based descriptions and platform-independent workflow wording. Preserved the modeling reference and clean-project helper byte-for-byte. The helper's scene identifier and output marker remain its own implementation details; they are not required host protocol fields.

The modeling reference's claims about 13 inspected example projects come from the supplied document. This adaptation did not independently open those examples or reproduce their geometry. No current-version compatibility or visual-quality guarantee is implied by retaining the reference.

## Local application verification, 2026-09-09

Used installed Blender 4.3.1 on macOS in separate background processes and a unique system temporary directory. Did not open, close or reset the user's foreground project.

- Clean creation with factory startup and automatic scripts disabled: passed. Saved a nonempty blend file with zero objects, the requested scene name and a generated work identifier.
- Reopened that file in a separate background process: passed. Verified its resolved path, empty object collection, scene name and work identifier. The locally installed connector printed a background-mode limitation during this read; scene verification completed, but this does not validate a live connection.
- Attempted to reuse the existing output path: rejected with FileExistsError and exit code 1. The original file's SHA-256 remained unchanged.
- Omitted the required disable-autoexec argument: rejected before output creation with exit code 1; no rejected output file was created.

These checks validate the helper's tested creation and rejection paths, not all failure cases or platforms. Windows, live connection recovery after switching files, rendering, media isolation and canvas delivery still need integration tests.

## Description and workflow walkthrough

These are expected routing outcomes from a static walkthrough, not measured model-trigger results.

| Request | Expected |
|---|---|
| 用 Blender 按这张草图做可编辑的弧形墙白模 | Apply; bind the work, choose continuous geometry, inspect dimensions and silhouette |
| Edit the handle in this blend file and preserve the rest | Apply; continue the identified work, restrict the edit, save and verify |
| 给已有 Blender 场景做一段运镜并渲染视频 | Apply; skip irrelevant modeling chapters, isolate intermediate media and verify the video |
| Explain what a Blender modifier is | Do not apply the production workflow |
| 只帮我安装 Blender 连接器 | Do not apply modeling, file switching or production stages |
| 用导演台做一段三维风格产品视频，不需要 Blender 工程 | Keep the selected route; do not launch Blender because of visual-style keywords |

## Distribution

Keep this maintenance record in the repository. Runtime distribution needs both entrypoints, metadata, shared modeling knowledge and all required scripts; exclude tests and generated application files. The previously delivered 0.7.1 archive predates the connector preparation helper.
