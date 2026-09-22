# Maintenance validation

## 0.3.0 default canvas preview, 2026-09-10

Both entrypoints and the shared handoff reference now require a final image on the canvas alongside the matching PSD/PSB by default. Static acceptance cases cover an ordinary edit without an explicit preview request, required transparency, source-version correspondence, multiple requested artboards, explicit export/display waiver, existing-node reuse and failed or unknown canvas publication. Explicit animation requires supported full-range video export; a still or frame folder cannot substitute for it.

These are workflow expectations, not live application results. This update changes Skill documentation and metadata only. Actual Windows/macOS export, canvas import and display/playback remain integration checks.

## 0.2.0 Windows readiness, 2026-09-10

Application helper tests cover verified custom installation paths, literal Chinese/spaced arguments, reuse of a unique running version, duplicate instances, unknown process paths and refusal to launch another version. Existing macOS discovery tests also pass on the Windows test runner. Run `node --test skills/design-photoshop/tests/*.test.mjs`.

The real Windows status probe found the installed and running Photoshop 2026. No document or plugin was changed; document connectivity and editing remain live integration checks.

These checks maintain the skill; this file is not part of its runtime reading path.

## Automated and local evidence

- `node --test skills/design-photoshop/tests/*.test.mjs`: 11 passing tests covering connector preparation, workspace binding failures, uncertain installation outcomes, application discovery, version selection and launch dispatch.
- Connector HTTP round trips use a local test server, not the live desktop installer.
- Application launch tests use injected launch functions; they never start a real application. Windows behavior was tested with filesystem fixtures on macOS, not on a Windows host.
- Read-only local inspection discovered Photoshop 2026 and its running process on macOS. This is not document-control verification.
- Skill frontmatter validation, bilingual name/description limits, reference existence and absence of brand mentions/jump links in Markdown were checked.
- Repository validation passed, including metadata and generated market index consistency. Existing unrelated short-description warnings remain.
- Live connector installation, application plugin setup, PSD creation, reopen and canvas handoff remain untested. A host with the compatible connector-preparation entry and real document operations is required to test them.

## Trigger review

Manual review against the two entrypoint descriptions; these are expected routes, not measured model trigger scores.

| Request | Expected |
|---|---|
| 把画布上的商品图和标题做成可编辑 PSD 海报 | Use this skill |
| Retouch this portrait in Photoshop and keep the masks editable | Use this skill |
| 修改这个 PSD 的标题和背景色，保留其他图层 | Use this skill |
| 用 H3 生成一条有 PS 拼贴风格的视频 | Keep the video workflow |
| 生成一张复古风海报，只要 PNG | Keep image generation; do not force Photoshop |
| 把这个模型导出为 Blender 工程 | Use the 3D workflow |

## Workflow walkthrough

Scenario: a designer provides a product photo and a headline from a canvas, requesting a layered square launch poster, a PNG preview and a later text revision.

1. Resolve the source version, exact headline and requested editability. Choose a stated screen size if absent; preserve the artwork language independently of layer naming.
2. Inspect application and connection readiness. Preparation or launch cannot bypass the fresh document response required before editing. An unavailable entry leads to the supported connector interface or a specific blocker.
3. Keep the source photo, make a masked product asset, use native background geometry and live text, and construct contact/cast shadows separately. Inspect a difficult product edge before finishing.
4. Save and inspect a versioned layered document and its preview. Check layer structure independently from visual fidelity; reopen only without risking an unsaved source.
5. Return accessible files to the canvas where supported. For the later revision, identify and edit the existing headline layer in a new version instead of rebuilding the poster.

The walkthrough checks coverage and stage continuity. It is not evidence that a live Photoshop task completed.
