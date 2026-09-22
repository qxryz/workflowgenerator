import assert from "node:assert/strict";
import test from "node:test";

import { serializeProject } from "../src/director-desk/editor/io/exportProjectJson.ts";
import type { DirectorProject } from "../src/director-desk/editor/schema/directorProject.ts";
import { fingerprintDirectorCapture, hydrateDirectorProjectCaptures, prepareDirectorProjectForStorage } from "../src/pages/director/project-media.ts";

function createProject(dataUrls = ["data:image/png;base64,AAAA"]): DirectorProject {
    return {
        version: 1,
        scene: {
            scale: 1,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
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
        cameras: [
            {
                id: "cam_1",
                name: "机位01",
                fov: 50,
                transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
                targetMode: "manual",
                target: [0, 1, 0],
                lastCaptureUrl: dataUrls.at(-1) ?? null,
                captures: dataUrls.map((dataUrl, index) => ({ id: `capture-${index + 1}`, index: index + 1, name: `截图${index + 1}`, dataUrl })),
            },
        ],
        activeCameraId: "cam_1",
        panoramaAssetId: null,
    };
}

test("director project stores capture bytes once and keeps only native media references in project JSON", async () => {
    let stored = 0;
    const discarded: string[] = [];
    const storage = {
        store: async () => {
            stored += 1;
            return { url: `wg-media://images/capture-${stored}`, storageKey: `image:stored-${stored}`, width: 1280, height: 720, bytes: 12, mimeType: "image/png" };
        },
        resolve: async (storageKey: string) => `wg-media://images/${storageKey}`,
        discard: async (image: { storageKey: string }) => {
            discarded.push(image.storageKey);
        },
    };
    const runtimeProject = createProject();
    const first = await prepareDirectorProjectForStorage(runtimeProject, null, storage);
    const second = await prepareDirectorProjectForStorage(runtimeProject, first.project, storage);

    assert.equal(stored, 1);
    assert.equal(discarded.length, 0);
    assert.equal(first.project.cameras[0]?.captures?.[0]?.storageKey, "image:stored-1");
    assert.equal(first.project.cameras[0]?.captures?.[0]?.dataUrl, "wg-media://images/capture-1");
    assert.equal(second.project.cameras[0]?.captures?.[0]?.storageKey, "image:stored-1");
    assert.doesNotMatch(JSON.stringify(first.project), /data:image\/png;base64/u);
});

test("director project reuses a capture already published to My Assets", async () => {
    const runtimeProject = createProject();
    const contentHash = await fingerprintDirectorCapture(runtimeProject.cameras[0]?.captures?.[0]?.dataUrl ?? "");
    const storedImage = { url: "wg-media://images/shared", storageKey: "image:shared", width: 1280, height: 720, bytes: 12, mimeType: "image/png", contentHash };
    let stored = 0;
    const prepared = await prepareDirectorProjectForStorage(runtimeProject, null, {
        store: async () => {
            stored += 1;
            return storedImage;
        },
        resolve: async () => storedImage.url,
        discard: async () => undefined,
    }, new Map([["capture-1", storedImage]]));

    assert.equal(stored, 0);
    assert.equal(prepared.project.cameras[0]?.captures?.[0]?.storageKey, "image:shared");
    assert.equal(prepared.uploaded.length, 0);
});

test("director project does not reuse an old screenshot when imported content has the same capture id", async () => {
    let stored = 0;
    const storage = {
        store: async () => {
            stored += 1;
            return { url: `wg-media://images/${stored}`, storageKey: `image:${stored}`, width: 1280, height: 720, bytes: 12, mimeType: "image/png" };
        },
        resolve: async () => "",
        discard: async () => undefined,
    };
    const first = await prepareDirectorProjectForStorage(createProject(["data:image/png;base64,ONE"]), null, storage);
    const second = await prepareDirectorProjectForStorage(createProject(["data:image/png;base64,TWO"]), first.project, storage);

    assert.equal(stored, 2);
    assert.equal(second.project.cameras[0]?.captures?.[0]?.storageKey, "image:2");
});

test("director project hydration restores preview data while portable export strips app-private media fields", async () => {
    const storedProject = createProject();
    const capture = storedProject.cameras[0]?.captures?.[0];
    assert.ok(capture);
    Object.assign(capture, { dataUrl: "wg-media://images/capture", storageKey: "image:stored", width: 1280, height: 720, bytes: 12, mimeType: "image/png", contentHash: "abc" });

    const hydrated = await hydrateDirectorProjectCaptures(storedProject, async () => "data:image/png;base64,RESTORED");
    const json = serializeProject(hydrated);

    assert.equal(hydrated.cameras[0]?.captures?.[0]?.dataUrl, "data:image/png;base64,RESTORED");
    assert.doesNotMatch(json, /storageKey|mimeType|contentHash|"bytes"/u);
    assert.match(json, /data:image\/png;base64,RESTORED/u);
});

test("director project discards provisional screenshots when preparing a later capture fails", async () => {
    const discarded: string[] = [];
    let stored = 0;
    await assert.rejects(
        prepareDirectorProjectForStorage(createProject(["data:image/png;base64,ONE", "data:image/png;base64,TWO"]), null, {
            store: async () => {
                stored += 1;
                if (stored === 2) throw new Error("disk full");
                return { url: "wg-media://images/one", storageKey: "image:one", width: 100, height: 100, bytes: 10, mimeType: "image/png" };
            },
            resolve: async () => "",
            discard: async (image) => {
                discarded.push(image.storageKey);
            },
        }),
        /disk full/u,
    );
    assert.deepEqual(discarded, ["image:one"]);
});
