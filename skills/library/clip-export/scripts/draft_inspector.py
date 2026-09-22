"""
剪映草稿检查器

用法:
    python3 draft_inspector.py list [--limit N]
    python3 draft_inspector.py show --name "草稿名"
    python3 draft_inspector.py summary --name "草稿名"
"""

import argparse
import json
import os
import platform
import sys
from typing import Any, Dict, List, Optional


def get_default_drafts_root() -> str:
    system = platform.system()
    if system == "Darwin":
        path = os.path.expanduser(
            "~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
        )
        if os.path.exists(path):
            return path
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        path = os.path.join(
            local_app_data,
            "JianyingPro/User Data/Projects/com.lveditor.draft",
        )
        if os.path.exists(path):
            return path
    return ""


def get_all_drafts(root_path: str) -> List[Dict]:
    drafts = []
    if not os.path.exists(root_path):
        return []
    for item in os.listdir(root_path):
        if item.startswith("."):
            continue
        path = os.path.join(root_path, item)
        if not os.path.isdir(path):
            continue
        has_content = os.path.exists(os.path.join(path, "draft_content.json"))
        has_meta = os.path.exists(os.path.join(path, "draft_meta_info.json"))
        if has_content or has_meta:
            drafts.append({
                "name": item,
                "mtime": os.path.getmtime(path),
                "path": path,
                "has_content": has_content,
                "has_meta": has_meta,
            })
    return sorted(drafts, key=lambda x: x["mtime"], reverse=True)


def cmd_list(root: str, limit: int) -> None:
    drafts = get_all_drafts(root)
    if limit > 0:
        drafts = drafts[:limit]

    print(f"Draft Root: {root}")
    print(f"Total: {len(drafts)}")
    print()
    for i, d in enumerate(drafts, 1):
        status = []
        if d["has_content"]:
            status.append("content")
        if d["has_meta"]:
            status.append("meta")
        print(f"  {i}. {d['name']}  [{', '.join(status)}]")


def cmd_show(root: str, name: str, kind: str) -> None:
    draft_path = os.path.join(root, name)
    if not os.path.isdir(draft_path):
        print(f"Error: Draft not found: {name}")
        sys.exit(1)

    if kind in ("content", "both"):
        content_path = os.path.join(draft_path, "draft_content.json")
        if os.path.exists(content_path):
            with open(content_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            print(f"No draft_content.json (JianYing 6+ encrypts it)")

    if kind in ("meta", "both"):
        meta_path = os.path.join(draft_path, "draft_meta_info.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            print("No draft_meta_info.json")


def cmd_summary(root: str, name: str) -> None:
    draft_path = os.path.join(root, name)
    content_path = os.path.join(draft_path, "draft_content.json")

    if not os.path.exists(content_path):
        print(f"Cannot summarize: draft_content.json not found")
        print(f"(JianYing 6+ encrypts draft content)")
        # Fall back to meta
        meta_path = os.path.join(draft_path, "draft_meta_info.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            print(f"\nDraft Meta Info:")
            print(f"  Name: {meta.get('draft_name', name)}")
            print(f"  Version: {meta.get('new_version', 'unknown')}")
        return

    with open(content_path, "r", encoding="utf-8") as f:
        content = json.load(f)

    tracks = content.get("tracks", [])
    materials = content.get("materials", {}) or {}

    total_segments = 0
    print(f"Name: {name}")
    print(f"Path: {draft_path}")
    print(f"Tracks: {len(tracks)}")
    print()

    for t in tracks:
        segs = t.get("segments", []) or []
        total_segments += len(segs)
        print(f"  Track: {t.get('name', '?')} ({t.get('type', '?')}) - {len(segs)} segments")

    print(f"\nTotal Segments: {total_segments}")

    mat_counts = {}
    for k, v in materials.items():
        if isinstance(v, list):
            mat_counts[k] = len(v)
    if mat_counts:
        print("\nMaterials:")
        for k, v in sorted(mat_counts.items()):
            print(f"  {k}: {v}")


def main():
    parser = argparse.ArgumentParser(description="剪映草稿检查器")
    parser.add_argument("--root", default=get_default_drafts_root(), help="草稿根目录")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="列出草稿")
    p_list.add_argument("--limit", type=int, default=0, help="最多显示数量")

    p_show = sub.add_parser("show", help="显示草稿 JSON")
    p_show.add_argument("--name", required=True, help="草稿名")
    p_show.add_argument("--kind", choices=["content", "meta", "both"], default="content")

    p_summary = sub.add_parser("summary", help="草稿摘要")
    p_summary.add_argument("--name", required=True, help="草稿名")

    args = parser.parse_args()

    if not args.root:
        print("Error: 无法找到剪映草稿目录，请通过 --root 指定")
        sys.exit(1)

    if args.cmd == "list":
        cmd_list(args.root, args.limit)
    elif args.cmd == "show":
        cmd_show(args.root, args.name, args.kind)
    elif args.cmd == "summary":
        cmd_summary(args.root, args.name)


if __name__ == "__main__":
    main()
