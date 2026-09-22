#!/usr/bin/env python3
"""Seedance 视频片段质量审查模板。

此脚本不直接调用 API，而是：
1. 输出标准化的 read_media 审查 prompt
2. 解析审查结果 JSON 并给出 PASS/FAIL 判定
3. 将审查记录写入 review_log.json

使用方式：
  # 生成审查 prompt（供 Claude 调用 read_media 时使用）
  python3 review_segment.py prompt <segment.mp4>

  # 记录审查结果
  python3 review_segment.py record <segment.mp4> <PASS|FAIL> <reason> [--log review_log.json]

  # 检查所有片段是否通过审查
  python3 review_segment.py check [--log review_log.json]
"""

import json
import sys
from datetime import datetime
from pathlib import Path

# ═══════════════════════════════════════════
# 审查标准定义
# ═══════════════════════════════════════════

REVIEW_CRITERIA = {
    "style": {
        "name": "风格一致性",
        "name_en": "Style Consistency",
        "description": "必须是 3D 皮克斯风格动画，不能是 2D 扁平/写实/其他风格",
        "weight": "CRITICAL",  # CRITICAL = 不通过即 FAIL
    },
    "camera": {
        "name": "分镜切换",
        "name_en": "Camera Transitions",
        "description": "15s 片段内必须有至少 2 次镜头切换（全景↔特写），不能全程固定机位",
        "weight": "CRITICAL",
    },
    "audio": {
        "name": "音频质量",
        "name_en": "Audio Quality",
        "description": "对话清晰无乱码、无重叠/重复/AI 噪声，全程可懂",
        "weight": "CRITICAL",
    },
    "character": {
        "name": "角色一致性",
        "name_en": "Character Consistency",
        "description": "角色外观（服装、配饰、体型）与参考图一致",
        "weight": "IMPORTANT",  # IMPORTANT = 警告但可酌情通过
    },
    "content": {
        "name": "内容匹配",
        "name_en": "Content Match",
        "description": "对话内容与脚本大致吻合，不必逐字匹配但意思要对",
        "weight": "IMPORTANT",
    },
}

# ═══════════════════════════════════════════
# 标准化审查 Prompt
# ═══════════════════════════════════════════

REVIEW_PROMPT = """Evaluate this video segment against these 5 criteria. For each criterion, give a PASS or FAIL verdict with a brief reason.

## Criteria

1. **STYLE** (Critical): Is this 3D Pixar-style animation? NOT 2D flat/realistic/other styles. Rate: PASS or FAIL.

2. **CAMERA TRANSITIONS** (Critical): Count the number of distinct camera angle changes (e.g. wide shot → close-up → wide shot). A 15s segment MUST have at least 2 camera changes. List each shot with timestamp. Rate: PASS or FAIL.

3. **AUDIO QUALITY** (Critical): Is ALL dialogue clear and understandable throughout the entire clip? Check for: garbled speech, overlapping/doubled audio tracks, AI noise/artifacts, nonsensical words. Even a brief 2-second garble = FAIL. Rate: PASS or FAIL.

4. **CHARACTER CONSISTENCY** (Important): Do characters maintain consistent appearance (clothes, accessories, body type) across shots? Rate: PASS or FAIL.

5. **CONTENT MATCH** (Important): Does the spoken dialogue roughly match expected content? (Don't need exact words, but the topic/meaning should be right.) Rate: PASS or FAIL.

## Output Format

Respond in this exact JSON format:
```json
{
  "style": {"verdict": "PASS/FAIL", "reason": "..."},
  "camera": {"verdict": "PASS/FAIL", "reason": "...", "shot_count": N, "shots": ["0:00-0:05 wide shot", ...]},
  "audio": {"verdict": "PASS/FAIL", "reason": "...", "garbled_sections": []},
  "character": {"verdict": "PASS/FAIL", "reason": "..."},
  "content": {"verdict": "PASS/FAIL", "reason": "..."},
  "overall": "PASS/FAIL",
  "summary": "One sentence summary"
}
```

OVERALL is PASS only if ALL Critical criteria (style, camera, audio) pass. Important criteria failures are warnings but don't block overall PASS."""


def cmd_prompt(segment_path: str):
    """输出标准化的审查 prompt。"""
    print("=" * 60)
    print(f"审查片段: {segment_path}")
    print("=" * 60)
    print()
    print("请使用以下 prompt 调用 read_media:")
    print()
    print(REVIEW_PROMPT)
    print()
    print("审查标准:")
    for key, c in REVIEW_CRITERIA.items():
        print(f"  [{c['weight']}] {c['name']} ({c['name_en']}): {c['description']}")


def cmd_record(segment_path: str, verdict: str, reason: str, log_path: str = "review_log.json"):
    """记录审查结果到 JSON 日志。"""
    log_file = Path(log_path)
    if log_file.exists():
        log = json.loads(log_file.read_text())
    else:
        log = {"reviews": [], "segments": {}}

    segment_name = Path(segment_path).name
    entry = {
        "segment": segment_name,
        "path": str(segment_path),
        "verdict": verdict.upper(),
        "reason": reason,
        "timestamp": datetime.now().isoformat(),
    }
    log["reviews"].append(entry)
    log["segments"][segment_name] = entry

    log_file.write_text(json.dumps(log, indent=2, ensure_ascii=False))
    icon = "✅" if verdict.upper() == "PASS" else "❌"
    print(f"{icon} {segment_name}: {verdict.upper()} — {reason}")


def cmd_check(log_path: str = "review_log.json"):
    """检查所有片段审查状态。"""
    log_file = Path(log_path)
    if not log_file.exists():
        print("未找到审查日志，请先进行审查")
        sys.exit(1)

    log = json.loads(log_file.read_text())
    segments = log.get("segments", {})

    if not segments:
        print("无审查记录")
        sys.exit(1)

    all_pass = True
    print("=== 审查状态汇总 ===\n")
    for name, entry in sorted(segments.items()):
        icon = "✅" if entry["verdict"] == "PASS" else "❌"
        print(f"  {icon} {name}: {entry['verdict']} — {entry['reason']}")
        if entry["verdict"] != "PASS":
            all_pass = False

    print()
    if all_pass:
        print("ALL PASS — 所有片段通过审查，可以进行拼接合成")
    else:
        failed = [n for n, e in segments.items() if e["verdict"] != "PASS"]
        print(f"BLOCKED — {len(failed)} 个片段未通过: {', '.join(failed)}")
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "prompt":
        if len(sys.argv) < 3:
            print("用法: python review_segment.py prompt <segment.mp4>")
            sys.exit(1)
        cmd_prompt(sys.argv[2])

    elif cmd == "record":
        if len(sys.argv) < 5:
            print("用法: python review_segment.py record <segment.mp4> <PASS|FAIL> <reason>")
            sys.exit(1)
        log_path = "review_log.json"
        for i, arg in enumerate(sys.argv):
            if arg == "--log" and i + 1 < len(sys.argv):
                log_path = sys.argv[i + 1]
        cmd_record(sys.argv[2], sys.argv[3], sys.argv[4], log_path)

    elif cmd == "check":
        log_path = "review_log.json"
        for i, arg in enumerate(sys.argv):
            if arg == "--log" and i + 1 < len(sys.argv):
                log_path = sys.argv[i + 1]
        cmd_check(log_path)

    else:
        print(f"未知命令: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
