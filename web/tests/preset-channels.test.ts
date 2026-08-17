import assert from "node:assert/strict";
import test from "node:test";

import {
    DASH_SCOPE_BEIJING_BASE_URL,
    PRESET_CHANNEL_DEFAULTS,
    nextCustomChannelName,
} from "../src/lib/preset-channels.ts";

test("every fresh config exposes the two key-free preset channels", () => {
    assert.deepEqual(Object.values(PRESET_CHANNEL_DEFAULTS).map((channel) => [channel.name, channel.apiKey]), [
        ["免费", ""],
        ["语音模型", ""],
    ]);
    assert.equal(PRESET_CHANNEL_DEFAULTS.voice.baseUrl, DASH_SCOPE_BEIJING_BASE_URL);
    assert.equal(PRESET_CHANNEL_DEFAULTS.voice.models.every((model) => model.capability === "audio"), true);
});

test("preset defaults never contain a distributable credential", () => {
    assert.equal(Object.values(PRESET_CHANNEL_DEFAULTS).every((channel) => channel.apiKey === ""), true);
});

test("custom channel numbering starts at one and fills the first available number", () => {
    assert.equal(nextCustomChannelName(Object.values(PRESET_CHANNEL_DEFAULTS)), "渠道 1");
    assert.equal(nextCustomChannelName([...Object.values(PRESET_CHANNEL_DEFAULTS), { name: "渠道 1" }]), "渠道 2");
});
