import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Zodiac uses the application-owned OpenCode transport and keeps generated UI tools", () => {
    const zodicApi = readSource("../src/services/api/zodic.ts");
    const panel = readSource("../src/components/agent/zodic-panel.tsx");
    const transport = readSource("../src/services/api/zodiac-transport.ts");
    const desktop = readSource("../src-tauri/src/main.rs");

    const nativeTools = readSource("../src/lib/agent/zodiac-native-tools.js");

    assert.match(zodicApi, /proxyModelPost|chat\/completions|streamGenerateContent|readZodicProviderReply|apiFormat/u);
    assert.match(zodicApi, /nativeTools\(\)|tools:|functionDeclarations|input_schema/u);
    assert.match(nativeTools, /ZODIAC_UI_PARAMETERS/u);
    assert.match(nativeTools, /ZODIAC_OPS_PARAMETERS/u);
    assert.match(nativeTools, /HUB_TOOL_DEFINITIONS/u);
    assert.match(zodicApi, /export type ZodicMessage/u);
    assert.match(panel, /runZodiacTurn\(/u);
    assert.match(panel, /onToolRequest: applyToolRequest/u);
    assert.match(panel, /zodiac-ui|zodiac-ops/u);
    assert.match(transport, /runOpenCodeTurn/u);
    assert.doesNotMatch(panel, /piReady|sidecar|zodiac-stream/u);
    assert.match(desktop, /serve_desktop/u);
});

test("the panel gates sending on a configured text model", () => {
    const panel = readSource("../src/components/agent/zodic-panel.tsx");
    assert.match(panel, /isAiConfigReady/u);
    assert.match(panel, /disabled=\{!directReady/u);
    assert.match(panel, /请先配置文本模型/u);
    assert.doesNotMatch(panel, /data\/pi-agent|lastError/u);
    assert.match(panel, /loadZodiacSession/u);
    assert.match(panel, /resolveTool/u);
    assert.match(panel, /skill\.zodiacOnly/u);
});
