"""
剪映资产搜索工具

在滤镜、转场、特效、文字动画等枚举中搜索可用资产。

用法:
    python3 asset_search.py "关键词"
    python3 asset_search.py "关键词" -c filters
    python3 asset_search.py --list
"""

import argparse
import difflib
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jy_wrapper import (
    FilterType,
    TransitionType,
    IntroType,
    OutroType,
    VideoSceneEffectType,
    FILTER_SYNONYMS,
    TRANSITION_SYNONYMS,
    EFFECT_SYNONYMS,
    TEXT_ANIM_SYNONYMS,
)


CATEGORIES = {
    "filters": ("滤镜", FilterType),
    "transitions": ("转场", TransitionType),
    "effects": ("场景特效", VideoSceneEffectType),
    "text_intros": ("文字入场动画", IntroType),
    "text_outros": ("文字出场动画", OutroType),
}


def search(query: str, category: str = None, limit: int = 20):
    results = []
    query_lower = query.lower()

    cats = {category: CATEGORIES[category]} if category and category in CATEGORIES else CATEGORIES

    for cat_key, (cat_name, enum_cls) in cats.items():
        for member_name in enum_cls.__members__:
            score = 0
            name_lower = member_name.lower()

            # Exact match
            if query_lower == name_lower:
                score = 100
            elif query_lower in name_lower:
                score = 50
            elif name_lower in query_lower:
                score = 30
            else:
                # Fuzzy match
                ratio = difflib.SequenceMatcher(None, query_lower, name_lower).ratio()
                if ratio > 0.5:
                    score = int(ratio * 20)

            if score > 0:
                results.append({
                    "name": member_name,
                    "category": cat_name,
                    "source": cat_key,
                    "score": score,
                })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit]


def format_results(results):
    if not results:
        return "未找到匹配项。尝试更简单的关键词或切换分类。"

    header = f"{'Name':<25} | {'Category':<15} | {'Source'}"
    output = [header, "-" * len(header)]

    for r in results:
        name = r["name"] if len(r["name"]) <= 23 else r["name"][:20] + "..."
        output.append(f"{name:<25} | {r['category']:<15} | {r['source']}")

    return "\n".join(output)


def list_categories():
    print("=== 剪映资产概览 ===\n")
    for key, (name, enum_cls) in CATEGORIES.items():
        count = len(enum_cls.__members__)
        print(f"  {key:<20} | {name:<15} | {count} items")


def main():
    parser = argparse.ArgumentParser(description="剪映资产搜索工具")
    parser.add_argument("query", nargs="?", help="搜索关键词")
    parser.add_argument("-c", "--category", choices=list(CATEGORIES.keys()), help="限定分类")
    parser.add_argument("-l", "--limit", type=int, default=20, help="最多显示数量")
    parser.add_argument("--list", action="store_true", help="列出所有分类")
    args = parser.parse_args()

    if args.list:
        list_categories()
        return

    if not args.query:
        parser.print_help()
        return

    results = search(args.query, args.category, args.limit)
    print(format_results(results))


if __name__ == "__main__":
    main()
