import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_DIRECTOR_INSTANCE_ID, DEFAULT_DIRECTOR_RETURN_TO, directorCaptureTitle, isDirectorCapturePayload, resolveDirectorInstanceId, resolveDirectorReturnTo } from "../src/pages/director/host-utils.ts";

const pageSource = readFileSync(new URL("../src/pages/director/index.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");
const topNavSource = readFileSync(new URL("../src/components/layout/app-top-nav.tsx", import.meta.url), "utf8");
const userLayoutSource = readFileSync(new URL("../src/layouts/user-layout.tsx", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/services/director-project-storage.ts", import.meta.url), "utf8");
const cameraPanelSource = readFileSync(new URL("../src/director-desk/editor/panels/CameraPanel.tsx", import.meta.url), "utf8");
const directorStoreSource = readFileSync(new URL("../src/director-desk/editor/store/directorStore.ts", import.meta.url), "utf8");

test("Director Desk is a first-level route immediately after the workbench", () => {
    assert.match(routerSource, /const DirectorPage = lazy\(\(\) => import\("@\/pages\/director"\)\)/u);
    assert.match(routerSource, /\{ path: "\/director", element: <DirectorPage \/> \}/u);
    const workbench = topNavSource.indexOf('{ label: "工作台"');
    const director = topNavSource.indexOf('{ label: "导演台"');
    const skills = topNavSource.indexOf('{ label: "Skills"');
    assert.ok(workbench >= 0 && director > workbench && skills > director);
});

test("Director Desk keeps the same application shell as the other first-level tabs", () => {
    assert.match(userLayoutSource, /<AppTopNav \/>/u);
    assert.doesNotMatch(userLayoutSource, /AppSidebar/u);
    assert.doesNotMatch(userLayoutSource, /directorOpen/u);
});

test("Director Desk host uses the shared bridge and accepts messages only from its same-origin frame", () => {
    assert.match(pageSource, /src="\/director-runtime\.html"/u);
    assert.match(pageSource, /createDirectorBridgeMessage<SessionOpenMessage>\("session\.open"/u);
    assert.match(pageSource, /isDirectorFrameMessage\(event\.data\)/u);
    assert.match(pageSource, /event\.origin !== window\.location\.origin/u);
    assert.match(pageSource, /event\.source !== frameRef\.current\?\.contentWindow/u);
    assert.match(pageSource, /style=\{\{ colorScheme: "dark" \}\}/u);
});

test("Director projects use the plugin native-storage namespace and instance-scoped key", () => {
    assert.match(storageSource, /createDesktopJsonStore/u);
    assert.match(storageSource, /namespace: "plugin-data-v1:director-desk"/u);
    assert.match(storageSource, /`project:\$\{instanceId\}`/u);
    assert.match(storageSource, /`recent:\$\{instanceId\}`/u);
    assert.match(pageSource, /writeDirectorProject\(instanceId, prepared\.project\)/u);
    assert.match(pageSource, /writeDirectorRecentProject\(instanceId, stored\)/u);
    assert.match(pageSource, /readDirectorRecentProject\(instanceId\)/u);
    assert.match(storageSource, /const confirmed = await storage\.getItem\(key\)/u);
    assert.match(pageSource, /registerDesktopFlusher/u);
    assert.match(pageSource, /requestProjectFlush/u);
    assert.match(pageSource, /imageToDataUrl\(\{ storageKey, url: fallback \}\)/u);
    assert.doesNotMatch(pageSource, /imageToDataUrl\(\{ storageKey, dataUrl: fallback \}\)/u);
});

test("capture publication happens only after durable asset persistence and failures discard provisional uploads", () => {
    const upload = pageSource.indexOf("const { image, staged } = await ensureCaptureImage(capture)");
    const persist = pageSource.indexOf("await addAssetPersisted", upload);
    const publish = pageSource.indexOf("publishUploadedImage(image)", persist);
    assert.ok(upload >= 0 && persist > upload && publish > persist);
    assert.match(pageSource, /message\.success\(`已将 \$\{saved\} 张镜头截图保存到我的资产`\)/u);
    assert.match(pageSource, /exportDesktopMedia\("images", image\.storageKey, fileName\)/u);
    assert.match(cameraPanelSource, /getDirectorCaptureDestinationLabel/u);
    assert.match(cameraPanelSource, /<span>\{captureDestinationLabel\}<\/span>/u);
    assert.match(directorStoreSource, /id: `\$\{camera\.id\}-capture-\$\{crypto\.randomUUID\(\)\}`/u);
});

test("Director host normalizes instance ids, captures and safe return paths", () => {
    assert.equal(resolveDirectorInstanceId("?instanceId=story-01"), "story-01");
    assert.equal(resolveDirectorInstanceId("?instanceId=../../escape"), DEFAULT_DIRECTOR_INSTANCE_ID);
    assert.equal(resolveDirectorReturnTo("?returnTo=%2Fassets%3Fkind%3Dimage%23saved", "https://app.test"), "/assets?kind=image#saved");
    assert.equal(resolveDirectorReturnTo("?returnTo=https%3A%2F%2Fevil.test", "https://app.test"), DEFAULT_DIRECTOR_RETURN_TO);
    assert.equal(resolveDirectorReturnTo("?returnTo=%2F%2Fevil.test", "https://app.test"), DEFAULT_DIRECTOR_RETURN_TO);
    assert.equal(isDirectorCapturePayload({ dataUrl: "data:image/png;base64,AAAA", fileName: "shot.png" }), true);
    assert.equal(isDirectorCapturePayload({ dataUrl: "wg-media://images/shot", storageKey: "image:shot_1", fileName: "shot.png" }), true);
    assert.equal(isDirectorCapturePayload({ dataUrl: "https://evil.test/shot.png", fileName: "shot.png" }), false);
    assert.equal(directorCaptureTitle("/tmp/Opening Shot.png", 0), "Opening Shot");
});
