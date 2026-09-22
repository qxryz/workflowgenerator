#!/usr/bin/env python3
"""校验 animal-podcast 搞笑播客脚本格式是否符合规范。

规则：
  - 文件头部必须包含元信息（话题、动物组合、目标时长）
  - 每个场景必须用 ## [SCENE:id] 标题
  - 每段台词必须包含 **{角色名}：** 标记说话角色
  - 每段台词必须包含 **画面描述：**
  - 每段台词必须包含 **时长预估：** Xs
  - 可选 **音效：** 标记（大笑、惊讶、鼓掌等）
  - 场景之间用 --- 分隔
  - scene_id 不能重复
  - 单段台词时长 3～12s，单场景总时长不超过 20s
  - 总时长不超过 39s
"""

import re
import sys
from pathlib import Path

SCENE_RE = re.compile(r"^##\s+\[SCENE:(\w+)\]\s+(.+)$")
SPEAKER_RE = re.compile(r"^\*\*(.+?)：\*\*$|^\*\*(.+?):\*\*$")
DURATION_RE = re.compile(r"(\d+)s")

# 非角色台词的系统字段（中文 + 英文）
SYSTEM_FIELDS = {"画面描述", "时长预估", "音效",
                 "Visual Description", "Estimated Duration", "SFX"}


def parse_script(path: str) -> tuple[dict, list[dict]]:
    """解析 script.md，返回 (元信息, 场景列表)。

    每个场景包含多个台词段（line），每段有 speaker / has_visual / has_duration / duration_seconds。
    """
    text = Path(path).read_text(encoding="utf-8")
    lines = text.split("\n")

    meta: dict = {"topic": "", "animals": "", "target_duration": "", "aspect_ratio": ""}
    scenes: list[dict] = []
    current_scene: dict | None = None
    current_line: dict | None = None

    in_header = True

    for raw in lines:
        line = raw.strip()

        # ---------- 文件头元信息 ----------
        if in_header and not line.startswith("##"):
            for key, field in [("话题", "topic"), ("动物组合", "animals"),
                               ("目标时长", "target_duration"), ("画面比例", "aspect_ratio"),
                               ("Topic", "topic"), ("Animal Pairing", "animals"),
                               ("Target Duration", "target_duration"), ("Aspect Ratio", "aspect_ratio")]:
                if line.startswith(f"{key}：") or line.startswith(f"{key}:"):
                    # 只按第一个中/英文冒号拆分，保留值中的冒号
                    if "：" in line:
                        meta[field] = line.split("：", 1)[1].strip()
                    else:
                        meta[field] = line.split(":", 1)[1].strip()
                    break
            continue

        in_header = False

        # ---------- 场景标题 ----------
        scene_match = SCENE_RE.match(line)
        if scene_match:
            if current_line and current_scene:
                current_scene["lines"].append(current_line)
                current_line = None
            if current_scene:
                scenes.append(current_scene)
            current_scene = {
                "id": scene_match.group(1),
                "title": scene_match.group(2),
                "lines": [],
            }
            continue

        if current_scene is None:
            continue

        # ---------- 角色台词标记 ----------
        speaker_match = SPEAKER_RE.match(line)
        if speaker_match:
            speaker_name = (speaker_match.group(1) or speaker_match.group(2)).strip()
            # 如果是系统字段，不算新台词段
            if speaker_name in SYSTEM_FIELDS:
                if current_line:
                    if speaker_name in ("画面描述", "Visual Description"):
                        current_line["has_visual"] = True
                    elif speaker_name in ("时长预估", "Estimated Duration"):
                        current_line["has_duration"] = True
                        # 尝试从同行提取数字
                        m = DURATION_RE.search(line)
                        if m:
                            current_line["duration_seconds"] = int(m.group(1))
                    elif speaker_name in ("音效", "SFX"):
                        current_line["has_sfx"] = True
                continue

            # 新的角色台词段
            if current_line:
                current_scene["lines"].append(current_line)
            current_line = {
                "speaker": speaker_name,
                "has_visual": False,
                "has_duration": False,
                "has_sfx": False,
                "duration_seconds": 0,
            }
            continue

        # ---------- 时长预估（可能出现在独立行） ----------
        if current_line and (line.startswith("**时长预估：**") or line.startswith("**时长预估:**")
                            or line.startswith("**Estimated Duration:**")):
            current_line["has_duration"] = True
            m = DURATION_RE.search(line)
            if m:
                current_line["duration_seconds"] = int(m.group(1))
        elif current_line and (line.startswith("**画面描述：**") or line.startswith("**画面描述:**")
                               or line.startswith("**Visual Description:**")):
            current_line["has_visual"] = True
        elif current_line and (line.startswith("**音效：**") or line.startswith("**音效:**")
                               or line.startswith("**SFX:**")):
            current_line["has_sfx"] = True

    # 收尾
    if current_line and current_scene:
        current_scene["lines"].append(current_line)
    if current_scene:
        scenes.append(current_scene)

    return meta, scenes


def validate(meta: dict, scenes: list[dict]) -> list[str]:
    """校验，返回问题列表。"""
    issues: list[str] = []

    # 元信息检查
    if not meta["topic"]:
        issues.append("WARN   文件头缺少 话题：")
    if not meta["animals"]:
        issues.append("WARN   文件头缺少 动物组合：")
    if not meta["target_duration"]:
        issues.append("WARN   文件头缺少 目标时长：")

    if not scenes:
        issues.append("ERROR  未找到任何 ## [SCENE:xxx] 场景")
        return issues

    # scene_id 唯一性
    ids = [s["id"] for s in scenes]
    seen: set[str] = set()
    for sid in ids:
        if sid in seen:
            issues.append(f"ERROR  scene_id 重复: {sid}")
        seen.add(sid)

    # 收集所有角色名
    all_speakers: set[str] = set()
    total_duration = 0

    for sc in scenes:
        scene_label = f"[{sc['id']}] {sc['title']}"
        scene_duration = 0

        if not sc["lines"]:
            issues.append(f"WARN   {scene_label} 没有台词段")

        for idx, ln in enumerate(sc["lines"], 1):
            line_label = f"{scene_label} 台词#{idx}({ln['speaker']})"
            all_speakers.add(ln["speaker"])

            if not ln["has_visual"]:
                issues.append(f"ERROR  {line_label} 缺少 **画面描述：**")
            if not ln["has_duration"]:
                issues.append(f"ERROR  {line_label} 缺少 **时长预估：**")
            elif ln["duration_seconds"] <= 0:
                issues.append(f"ERROR  {line_label} 时长预估格式错误（应为 Xs，如 8s）")
            elif ln["duration_seconds"] < 3:
                issues.append(f"WARN   {line_label} 台词过短 ({ln['duration_seconds']}s < 3s)")
            elif ln["duration_seconds"] > 12:
                issues.append(f"WARN   {line_label} 单段台词过长 ({ln['duration_seconds']}s > 12s)")

            scene_duration += ln["duration_seconds"]

        if scene_duration > 20:
            issues.append(f"WARN   {scene_label} 场景总时长过长 ({scene_duration}s > 20s)")

        total_duration += scene_duration

    # 角色数量检查
    if len(all_speakers) < 2:
        issues.append("WARN   只检测到 1 个角色，搞笑播客建议至少 2 个角色对话")

    # 总时长检查（默认上限 39s）
    if total_duration > 0:
        if total_duration > 39:
            issues.append(f"WARN   总时长 {total_duration}s 超出上限 (39s)")
        elif total_duration < 20:
            issues.append(f"WARN   总时长 {total_duration}s 过短 (建议 30-39s)")

    return issues


def print_summary(meta: dict, scenes: list[dict], issues: list[str]) -> None:
    total_lines = sum(len(s["lines"]) for s in scenes)
    total_duration = sum(
        ln["duration_seconds"] for s in scenes for ln in s["lines"]
    )

    # 角色台词统计
    speaker_stats: dict[str, int] = {}
    for sc in scenes:
        for ln in sc["lines"]:
            speaker_stats[ln["speaker"]] = speaker_stats.get(ln["speaker"], 0) + 1

    print("=== 小动物搞笑播客脚本校验报告 ===\n")
    print(f"话题: {meta.get('topic', '未指定')}")
    print(f"动物组合: {meta.get('animals', '未指定')}")
    print(f"目标时长: {meta.get('target_duration', '未指定')}")
    print(f"画面比例: {meta.get('aspect_ratio', '未指定')}")
    print(f"总场景数: {len(scenes)}")
    print(f"总台词段: {total_lines}")
    print(f"预估总时长: {total_duration}s ({total_duration // 60}m{total_duration % 60}s)")
    print()

    # 角色统计
    print("角色台词分布:")
    for speaker, count in sorted(speaker_stats.items(), key=lambda x: -x[1]):
        print(f"  {speaker}: {count} 段")
    print()

    # 场景明细
    check = lambda v: "Y" if v else "-"
    print(f"{'场景ID':<14} {'标题':<14} {'台词':>4} {'时长':>6} {'画面':>4} {'时长标记':>6}")
    print("-" * 56)
    for sc in scenes:
        scene_dur = sum(ln["duration_seconds"] for ln in sc["lines"])
        all_visual = all(ln["has_visual"] for ln in sc["lines"]) if sc["lines"] else False
        all_dur = all(ln["has_duration"] for ln in sc["lines"]) if sc["lines"] else False
        print(
            f"{sc['id']:<14} {sc['title']:<14} {len(sc['lines']):>4} "
            f"{scene_dur:>5}s {check(all_visual):>4} {check(all_dur):>6}"
        )

    print()
    if issues:
        print(f"发现 {len(issues)} 个问题:\n")
        for issue in issues:
            print(f"  {issue}")
    else:
        print("ALL PASS")


def main():
    if len(sys.argv) < 2:
        print("用法: python validate_script.py <script.md 路径>")
        sys.exit(1)

    script_path = Path(sys.argv[1])
    if not script_path.exists():
        print(f"ERROR: 文件不存在: {script_path}")
        sys.exit(1)

    print(f"\n--- {script_path} ---\n")
    meta, scenes = parse_script(str(script_path))
    issues = validate(meta, scenes)
    print_summary(meta, scenes, issues)

    has_error = any("ERROR" in i for i in issues)
    sys.exit(1 if has_error else 0)


if __name__ == "__main__":
    main()
