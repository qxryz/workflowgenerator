#!/usr/bin/env python3
"""Rebuild verbatim prompt and preset assets from the two authoritative Lark docs."""

from __future__ import annotations

import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
DOC1 = "CqZLdOTANo88UzxkilCcghXfn0d"
DOC1_REVISION = 531
DOC2 = "QRaLdoIXfoBnECxdHhyc13b3ndg"
DOC2_REVISION = 1819

SOURCES = {
    "poster-system-prompt.txt": {
        "doc": DOC1,
        "revision": DOC1_REVISION,
        "heading": "doxcnjs9AjEXdtljDa2cfmEOyhb",
        "url": "https://bytedance.larkoffice.com/docx/CqZLdOTANo88UzxkilCcghXfn0d?from=from_copylink",
    },
    "video-system-prompt.txt": {
        "doc": DOC1,
        "revision": DOC1_REVISION,
        "heading": "doxcn94Hz7sVznb0mILK2UGdVPd",
        "url": "https://bytedance.larkoffice.com/docx/CqZLdOTANo88UzxkilCcghXfn0d?from=from_copylink",
    },
}

PRESETS = [
    ("edge-light.json", "back", "horizontal_0", 90),
    ("side-key-light.json", "left", "horizontal_0", 90),
    ("overhead-key-light.json", "disabled", "top_90", 60),
    ("low-angle-key-light.json", "disabled", "bottom_minus_90", 100),
]


def fetch(doc: str, revision: int, heading: str) -> str:
    env = os.environ.copy()
    env["LARK_CLI_UPDATE_CHECK"] = "0"
    command = [
        "lark-cli", "docs", "+fetch", "--doc", doc,
        "--revision-id", str(revision), "--doc-format", "markdown",
        "--scope", "section", "--start-block-id", heading,
        "--detail", "with-ids", "--format", "json",
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True, env=env)
    payload = json.loads(completed.stdout)
    if not payload.get("ok"):
        raise RuntimeError(f"Lark fetch failed for {doc}/{heading}: {payload}")
    return payload["data"]["document"]["content"]


def first_fenced_block(markdown: str) -> str:
    match = re.search(r"```(?:SQL|sql)?\s*\n(.*?)\n```", markdown, re.DOTALL)
    if not match:
        raise RuntimeError("No fenced prompt block found")
    return match.group(1)


def json_html_blocks(markdown: str) -> list[str]:
    matches = re.findall(
        r'<pre[^>]*\blang="JSON"[^>]*><code>(.*?)</code></pre>',
        markdown,
        re.DOTALL | re.IGNORECASE,
    )
    blocks: list[str] = []
    for raw in matches:
        raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
        raw = re.sub(r"</?[^>]+>", "", raw)
        blocks.append(html.unescape(raw).strip("\n"))
    return blocks


def normalized_bytes(text: str) -> bytes:
    return (text.rstrip("\n") + "\n").encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    prompts_dir = ROOT / "prompts"
    presets_dir = ROOT / "presets"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    presets_dir.mkdir(parents=True, exist_ok=True)

    manifest_files: dict[str, dict[str, object]] = {}
    for filename, source in SOURCES.items():
        content = fetch(source["doc"], source["revision"], source["heading"])
        prompt = first_fenced_block(content)
        data = normalized_bytes(prompt)
        path = prompts_dir / filename
        path.write_bytes(data)
        manifest_files[str(path.relative_to(ROOT))] = {
            **source,
            "sha256": digest(data),
            "bytes": len(data),
            "lines": data.count(b"\n"),
            "extraction": "first fenced SQL code block in the named section; UTF-8; one terminal LF",
        }

    lighting_source = {
        "doc": DOC2,
        "revision": DOC2_REVISION,
        "heading": "V2jtdWB6roLp7ZxRorvcU4YGnXc",
        "url": "https://bytedance.larkoffice.com/wiki/IPLMwDT5oiRWQlky31ccR9lbncg?from=from_copylink",
    }
    lighting_markdown = fetch(
        lighting_source["doc"], lighting_source["revision"], lighting_source["heading"]
    )
    blocks = json_html_blocks(lighting_markdown)
    if len(blocks) < 4:
        raise RuntimeError(f"Expected at least four JSON lighting blocks, found {len(blocks)}")

    for index, (filename, horizontal, vertical, intensity) in enumerate(PRESETS):
        block = blocks[index]
        parsed = json.loads(block)
        lighting = parsed["Lighting_Control"]
        direction = lighting["Advanced_Light_Direction_Control"]
        actual = (
            direction["Selected_Horizontal_Position"],
            direction["Selected_Vertical_Position"],
            lighting["Light_Intensity_Control"]["Intensity_Value"],
        )
        expected = (horizontal, vertical, intensity)
        if actual != expected:
            raise RuntimeError(f"Preset {index + 1} mismatch: expected {expected}, got {actual}")
        data = normalized_bytes(block)
        path = presets_dir / filename
        path.write_bytes(data)
        manifest_files[str(path.relative_to(ROOT))] = {
            **lighting_source,
            "source_block_index": index + 1,
            "sha256": digest(data),
            "bytes": len(data),
            "lines": data.count(b"\n"),
            "extraction": "verbatim decoded JSON code block from the first tool-preset table; UTF-8; one terminal LF",
        }

    manifest = {
        "manifest_version": 1,
        "policy": "Authoritative prompt and preset assets are immutable at runtime. Any hash mismatch is fatal.",
        "files": manifest_files,
    }
    (ROOT / "source-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
