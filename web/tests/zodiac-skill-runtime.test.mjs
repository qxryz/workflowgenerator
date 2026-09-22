import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildZodiacSkillRuntimeReport } from "../src/lib/agent/zodiac-skill-runtime.ts";

test("指导正文保持可读；提到不使用ffmpeg不会阻断纯指导技能", () => {
    const report = buildZodiacSkillRuntimeReport({ body: "不要使用 ffmpeg 叠字。请按 question 向用户确认。" });
    assert.equal(report.guidanceReadable, true);
    assert.equal(report.requirements.length, 0);
    assert.equal(report.toolMappings[0].to, "zodiac-ui");
});

test("脚本执行已接入，外部依赖仍单独报告", () => {
    const skill = { body: "python3 scripts/build.py input.json", files: [{ path: "scripts/build.py", content: "import json\nprint(json.dumps({}))" }] };
    const direct = buildZodiacSkillRuntimeReport(skill);
    assert.equal(direct.requirements[0].status, "available");
    const host = buildZodiacSkillRuntimeReport(skill);
    assert.deepEqual(host.scriptFiles, ["scripts/build.py"]);
    assert.equal(host.requirements[0].status, "available");
    assert.ok(host.requirements.every((requirement) => requirement.status === "available"));
});

test("应用连接器脚本依赖MiniMax工作区协议，不冒充已适配", async () => {
    const content = await readFile(new URL("../../skills/library/design-photoshop/scripts/prepare-connector.mjs", import.meta.url), "utf8");
    const report = buildZodiacSkillRuntimeReport({ body: "准备 Photoshop", files: [{ path: "scripts/prepare-connector.mjs", content }] });
    assert.equal(report.requirements.find((requirement) => requirement.kind === "minimax_gateway").status, "unsupported");
    assert.equal(report.requirements.find((requirement) => requirement.kind === "script_execution").status, "available");
});

test("有声书旧媒体索引与批量工具有明确缺口", async () => {
    const body = await readFile(new URL("../../skills/library/audiobook/SKILL.md", import.meta.url), "utf8");
    const content = await readFile(new URL("../../skills/library/audiobook/scripts/match_blobs.py", import.meta.url), "utf8");
    const report = buildZodiacSkillRuntimeReport({ body, files: [{ path: "scripts/match_blobs.py", content }] });
    assert.ok(report.requirements.some((requirement) => requirement.kind === "minimax_storage"));
    assert.ok(report.requirements.some((requirement) => requirement.capability === "旧批量语音生成接口"));
    assert.ok(report.requirements.some((requirement) => requirement.capability === "旧编辑子 Agent"));
});

test("完整嵌套技能脚本路径可识别，真正缺失的脚本会报告", () => {
    const report = buildZodiacSkillRuntimeReport(
        { body: "python3 scripts/verify.py input.json\npython3 .claude/skills/demo/scripts/missing.py input.json", files: [{ path: "references/authoritative/scripts/verify.py", content: "print('ok')" }] },
    );
    assert.deepEqual(
        report.requirements.filter((requirement) => requirement.kind === "missing_file").map((requirement) => requirement.capability),
        ["scripts/missing.py"],
    );
});

test("报告不输出源内容中的绝对路径或非法文件名", () => {
    const report = buildZodiacSkillRuntimeReport(
        {
            body: "位于 /Users/private/secrets；read_media(file_path='/Users/private/image.png')",
            files: [
                { path: "/Users/private/key.py", content: "import PIL" },
                { path: "../outside.py", content: "import numpy" },
            ],
        },
    );
    assert.ok(report.requirements.some((requirement) => requirement.capability === "read_media 输入契约"));
    assert.doesNotMatch(JSON.stringify(report), /\/Users|outside\.py|secrets/);
});
