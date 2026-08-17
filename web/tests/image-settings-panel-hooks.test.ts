import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(new URL("../src/components/image-settings-panel.tsx", import.meta.url), "utf8");

test("switching between default and provider-specific image models keeps the panel hook order stable", () => {
    const routerStart = panelSource.indexOf("export function ImageSettingsPanel");
    const defaultPanelStart = panelSource.indexOf("function DefaultImageSettingsPanel", routerStart);
    const creatorPanelStart = panelSource.indexOf("function CreatorImageSettingsPanel", defaultPanelStart);

    assert.ok(routerStart >= 0 && defaultPanelStart > routerStart && creatorPanelStart > defaultPanelStart);

    const routerSource = panelSource.slice(routerStart, defaultPanelStart);
    const defaultPanelSource = panelSource.slice(defaultPanelStart, creatorPanelStart);

    assert.match(routerSource, /<CreatorImageSettingsPanel/);
    assert.match(routerSource, /<DefaultImageSettingsPanel/);
    assert.doesNotMatch(routerSource, /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|LayoutEffect)\s*\(/, "the model-switching router must not own hooks");
    assert.match(defaultPanelSource, /\buseState\s*\(/, "stateful default controls belong to their own mounted child");
});
