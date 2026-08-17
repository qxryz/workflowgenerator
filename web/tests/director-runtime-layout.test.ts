import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
    new URL("../src/director-desk/app/layout/DirectorDeskShell.tsx", import.meta.url),
    "utf8",
);
const styles = readFileSync(new URL("../src/director-desk/styles/index.css", import.meta.url), "utf8");
const runtimeHtml = readFileSync(new URL("../director-runtime.html", import.meta.url), "utf8");
const hostBridgeSource = readFileSync(
    new URL("../src/director-desk/editor/io/hostBridge.ts", import.meta.url),
    "utf8",
);
const directorPageSource = readFileSync(new URL("../src/pages/director/index.tsx", import.meta.url), "utf8");
const directorAppSource = readFileSync(new URL("../src/director-desk/App.tsx", import.meta.url), "utf8");
const directorPluginSource = readFileSync(
    new URL("../../plugins/canvas/director-desk/src/index.tsx", import.meta.url),
    "utf8",
);

test("Director runtime keeps the upstream charcoal editor theme", () => {
    assert.doesNotMatch(styles, /WorkflowGenerator native paper theme/u);
    assert.doesNotMatch(styles, /--wg-paper/u);
    assert.match(styles, /:root\[data-theme="dark"\][\s\S]*?--bg-rgb:\s*9 9 9/u);
    assert.match(styles, /html,[\s\S]*?#root\s*\{[\s\S]*?background:\s*#090909/u);
    assert.match(styles, /--director-host-surface-rgb:\s*238 237 231/u);
    assert.match(styles, /\.left-sidebar,\s*\.right-sidebar,\s*\.director-sidebar\s*\{[\s\S]*?--bg-rgb:\s*var\(--director-host-surface-rgb\)[\s\S]*?url\("\/backgrounds\/zodiac-sanctum\.png"\)/u);
    assert.match(styles, /\.object-tree-panel\s*\{[\s\S]*?background:\s*transparent/u);
    assert.match(styles, /\.right-inspector\s*\{[\s\S]*?background:\s*transparent/u);
    assert.match(styles, /\.viewport-toolbar,\s*\.viewport-toolbar-menu,[\s\S]*?--surface-rgb:\s*var\(--director-host-surface-rgb\)[\s\S]*?--text-rgb:\s*var\(--director-host-text-rgb\)[\s\S]*?--accent-rgb:\s*var\(--director-host-accent-rgb\)/u);
    assert.match(styles, /\.viewport-toolbar\s*\{[\s\S]*?background:\s*rgb\(var\(--surface-rgb\)\s*\/\s*0\.97\)/u);
    assert.match(styles, /\.model-library-panel\s*\{[\s\S]*?background:\s*rgb\(var\(--panel-rgb\)\s*\/\s*0\.98\)/u);
});

test("Director runtime stays charcoal while hosts keep the backward-compatible theme field", () => {
    assert.match(runtimeHtml, /<html lang="zh-CN" data-theme="dark" class="dark">/u);
    assert.match(hostBridgeSource, /document\.documentElement\.dataset\.hostTheme = theme/u);
    assert.match(hostBridgeSource, /document\.documentElement\.dataset\.theme = "dark"/u);
    assert.match(hostBridgeSource, /document\.documentElement\.classList\.add\("dark"\)/u);
    assert.doesNotMatch(hostBridgeSource, /dataset\.theme = theme/u);
    assert.match(directorPageSource, /theme,[\s\S]*?project/u);
    assert.match(directorPageSource, /style=\{\{ colorScheme: "dark" \}\}/u);
    assert.match(directorPluginSource, /style: \{ colorScheme: "dark" \}/u);
});

test("compact Director layout exposes both scene and properties as dismissible overlays", () => {
    assert.match(shellSource, /matchMedia\("\(max-width: 920px\)"\)/u);
    assert.match(shellSource, /aria-label="导演台面板"/u);
    assert.match(shellSource, /aria-controls="director-scene-panel"/u);
    assert.match(shellSource, /aria-controls="director-properties-panel"/u);
    assert.match(shellSource, /event\.key === "Escape"/u);
    assert.match(shellSource, /hidden=\{scenePanelHidden\}/u);
    assert.match(shellSource, /hidden=\{propertiesPanelHidden\}/u);
    assert.match(styles, /@media \(max-width: 920px\)[\s\S]*?\.director-compact-panel-switch\s*\{/u);
    assert.match(styles, /\.director-shell-fullbleed\.is-compact-scene-open > \.left-sidebar/u);
    assert.match(styles, /\.director-shell-fullbleed\.is-compact-properties-open > \.right-sidebar/u);
});

test("compact Director header keeps project actions reachable", () => {
    assert.match(directorAppSource, /<h1 className="top-bar-title">3D 导演台<\/h1>/u);
    assert.doesNotMatch(directorAppSource, /top-bar-subtitle|top-bar-brand-icon|规划分镜、整理素材与镜头输出/u);
    assert.doesNotMatch(directorPageSource, /<header className=/u);
    assert.match(styles, /--director-host-surface:\s*#eeede7/u);
    assert.match(styles, /:root\[data-host-theme="dark"\]\s*\{[\s\S]*?--director-host-surface:\s*#151716/u);
    assert.match(styles, /\.top-bar\s*\{[\s\S]*?min-height:\s*68px[\s\S]*?background:\s*var\(--director-host-surface\)/u);
    assert.match(styles, /\.top-bar::before\s*\{[\s\S]*?url\("\/backgrounds\/zodiac-sanctum\.png"\)/u);
    assert.match(styles, /\.top-bar\s*\{[\s\S]*?border-bottom:\s*1px dashed/u);
    assert.doesNotMatch(styles, /\.top-bar-subtitle|\.top-bar-brand-icon/u);
    assert.match(directorAppSource, /<ProjectMenu \/>/u);
    assert.match(styles, /@media \(max-width: 920px\)[\s\S]*?\.top-bar-actions\s*\{[\s\S]*?display:\s*flex/u);
    assert.doesNotMatch(styles, /@media \(max-width: 920px\)[\s\S]*?\.top-bar-actions\s*\{\s*display:\s*none/u);
});
