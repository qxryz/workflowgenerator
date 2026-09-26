import assert from "node:assert/strict";
import test from "node:test";
import { captureVideoLastFrame } from "../src/lib/video-frame.ts";

test("saved video seeks to the end and yields a PNG without an external encoder", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalMediaElement = globalThis.HTMLMediaElement;
    let seekTime = -1;
    let drewFrame = false;
    class FakeVideo extends EventTarget {
        duration = 2;
        videoWidth = 640;
        videoHeight = 360;
        readyState = 1;
        src = "";
        load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
        removeAttribute(name: string) { if (name === "src") this.src = ""; }
        set currentTime(value: number) {
            seekTime = value;
            this.readyState = 2;
            queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
        }
    }
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => { drewFrame = true; } }),
        toBlob: (callback: (value: Blob) => void) => callback(new Blob(["png"], { type: "image/png" })),
    };
    Object.assign(globalThis, {
        window: { location: new URL("http://127.0.0.1:3211/canvas/test"), setTimeout, clearTimeout },
        document: { createElement: (name: string) => name === "video" ? new FakeVideo() : canvas },
        HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    });
    try {
        const blob = await captureVideoLastFrame("/media/media/video-1");
        assert.equal(blob.type, "image/png");
        assert.equal(blob.size, 3);
        assert.equal(seekTime, 1.999);
        assert.equal(canvas.width, 640);
        assert.equal(canvas.height, 360);
        assert.equal(drewFrame, true);
        await assert.rejects(captureVideoLastFrame("https://elsewhere.example/video.mp4"), /本机的画布视频/);
    } finally {
        Object.assign(globalThis, { window: originalWindow, document: originalDocument, HTMLMediaElement: originalMediaElement });
    }
});
