import assert from "node:assert/strict";
import test from "node:test";

import { extractZodiacWorkProcess, stripZodiacReasoning } from "../src/lib/agent/zodiac-turn-transcript.ts";

test("finished provider reasoning remains available after the final answer is separated", () => {
    const reply = "<think>先读取画布，再写首帧提示词。</think>方案已准备";
    assert.equal(extractZodiacWorkProcess(reply), "先读取画布，再写首帧提示词。");
    assert.equal(stripZodiacReasoning(reply), "方案已准备");
});

test("unfinished streaming reasoning remains visible instead of disappearing", () => {
    const reply = "<reasoning>正在组织镜头和提示词";
    assert.equal(extractZodiacWorkProcess(reply), "正在组织镜头和提示词");
    assert.equal(stripZodiacReasoning(reply), "");
});
