import assert from "node:assert/strict";
import test from "node:test";

import {
    DIRECTOR_BRIDGE_CAPABILITIES,
    createDirectorBridgeMessage,
    isDirectorBridgeMessage,
    isDirectorFrameMessage,
    type DirectorFrameMessage,
    type DirectorHostMessage,
} from "../src/lib/director-bridge.ts";

test("director bridge creates versioned same-channel host messages", () => {
    const message = createDirectorBridgeMessage<DirectorHostMessage>("session.open", {
        instanceId: "shot-1",
        theme: "light",
        project: { version: 1 },
    });

    assert.equal(message.channel, "workflowgenerator:director-desk");
    assert.equal(message.version, 1);
    assert.equal(message.type, "session.open");
    assert.equal(isDirectorBridgeMessage(message), true);
    assert.equal(isDirectorFrameMessage(message), false);
});

test("director bridge accepts frame capabilities and rejects unversioned payloads", () => {
    const message = createDirectorBridgeMessage<DirectorFrameMessage>("ready", {
        capabilities: [...DIRECTOR_BRIDGE_CAPABILITIES],
    });

    assert.equal(isDirectorFrameMessage(message), true);
    assert.equal(isDirectorBridgeMessage({ type: "ready", payload: {} }), false);
    assert.equal(isDirectorBridgeMessage({ ...message, version: 2 }), false);
    assert.equal(isDirectorBridgeMessage({ ...message, channel: "storyai:director-desk" }), false);
});

test("director bridge carries host-backed recent project requests and results", () => {
    assert.equal(DIRECTOR_BRIDGE_CAPABILITIES.includes("project.snapshot"), true);
    const save = createDirectorBridgeMessage<DirectorFrameMessage>("project.snapshot.save", {
        instanceId: "shot-1",
        project: { version: 1 },
    });
    const restore = createDirectorBridgeMessage<DirectorFrameMessage>("project.snapshot.restore", {
        instanceId: "shot-1",
    });
    const result = createDirectorBridgeMessage<DirectorHostMessage>("project.snapshot.result", {
        instanceId: "shot-1",
        action: "restore",
        status: "restored",
        project: { version: 1 },
    });

    assert.equal(isDirectorFrameMessage(save), true);
    assert.equal(isDirectorFrameMessage(restore), true);
    assert.equal(isDirectorFrameMessage(result), false);
    assert.equal(isDirectorBridgeMessage(result), true);
});

test("director bridge carries close-time project flushes and native screenshot exports", () => {
    assert.equal(DIRECTOR_BRIDGE_CAPABILITIES.includes("project.flush"), true);
    const request = createDirectorBridgeMessage<DirectorHostMessage>("project.flush", {
        instanceId: "shot-1",
        requestId: "flush-1",
    });
    const result = createDirectorBridgeMessage<DirectorFrameMessage>("project.flush.result", {
        instanceId: "shot-1",
        requestId: "flush-1",
        project: { version: 1 },
    });
    const exported = createDirectorBridgeMessage<DirectorFrameMessage>("capture.export", {
        instanceId: "shot-1",
        capture: { id: "capture-1", dataUrl: "data:image/png;base64,AAAA", fileName: "shot.png" },
    });

    assert.equal(isDirectorFrameMessage(request), false);
    assert.equal(isDirectorFrameMessage(result), true);
    assert.equal(isDirectorFrameMessage(exported), true);
});
