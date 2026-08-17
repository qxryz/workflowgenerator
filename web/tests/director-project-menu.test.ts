import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { serializeProject } from "../src/director-desk/editor/io/exportProjectJson.ts";
import { parseProject } from "../src/director-desk/editor/io/importProjectJson.ts";

const menuSource = readFileSync(new URL("../src/director-desk/editor/panels/ProjectMenu.tsx", import.meta.url), "utf8");
const menuStyles = readFileSync(new URL("../src/director-desk/styles/project-menu.css", import.meta.url), "utf8");
const layoutStyles = readFileSync(new URL("../src/director-desk/styles/index.css", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/director-desk/editor/io/hostBridge.ts", import.meta.url), "utf8");
const panoramaImportSource = readFileSync(new URL("../src/director-desk/editor/loaders/panoramaImport.ts", import.meta.url), "utf8");

const project = {
    version: 1 as const,
    scene: {
        scale: 1,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        backgroundColor: "#000000",
        panoramaYaw: 0,
        panoramaRadius: 60,
        showLabels: true,
        snapToGrid: false,
        showGround: true,
        groundOpacity: 0.4,
        groundHeight: 0,
    },
    assets: [],
    objects: [],
    cameras: [],
    activeCameraId: null,
    panoramaAssetId: null,
};

test("Director project JSON export and import round-trip through the validated contract", () => {
    assert.deepEqual(parseProject(serializeProject(project)), project);
    assert.throws(() => parseProject('{"version":1}'), /无效的导演台工程文件/u);
});

test("Director exposes real project actions without browser business persistence", () => {
    for (const label of ["导入工程", "导出工程", "保存为最近工程", "恢复最近工程"]) assert.match(menuSource, new RegExp(label, "u"));
    assert.match(menuSource, /saveAs\(new Blob/u);
    assert.match(menuSource, /replaceProject\(parseProject\(await file\.text\(\)\)\)/u);
    assert.match(bridgeSource, /project\.snapshot\.save/u);
    assert.match(bridgeSource, /project\.snapshot\.restore/u);
    assert.match(layoutStyles, /@media \(max-width: 920px\)[\s\S]*\.top-bar-actions\s*\{[\s\S]*display: flex/u);
    assert.match(layoutStyles, /\.top-bar\s*\{[\s\S]*?z-index:\s*100;[\s\S]*?overflow:\s*visible;/u);
    assert.match(menuStyles, /@media \(max-width: 680px\)[\s\S]*\.director-project-menu-trigger/u);
    assert.doesNotMatch(`${menuSource}\n${bridgeSource}`, /localStorage|sessionStorage/u);
    assert.match(panoramaImportSource, /reader\.readAsDataURL\(file\)/u);
    assert.match(panoramaImportSource, /projectionMode: "equirectangular" as const,\s*url: await readFileAsDataUrl\(file\)/u);
    assert.doesNotMatch(panoramaImportSource, /url:\s*URL\.createObjectURL\(file\)/u);
});
