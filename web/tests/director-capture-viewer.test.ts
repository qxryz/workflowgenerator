import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cameraPanelSource = readFileSync(new URL("../src/director-desk/editor/panels/CameraPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/director-desk/styles/index.css", import.meta.url), "utf8");

test("camera capture viewer escapes the clipped inspector sidebar", () => {
    assert.match(cameraPanelSource, /import \{ createPortal \} from "react-dom"/u);
    assert.match(cameraPanelSource, /return createPortal\([\s\S]*?document\.body,?\s*\);/u);
    assert.match(styles, /\.camera-capture-viewer\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/u);
});
