#!/usr/bin/env python3
"""Validate poster JSON without altering the authoritative system prompt."""

from __future__ import annotations
import json
from pathlib import Path
import re
import sys

TOP_LEVEL = ["style_name", "style_slug", "style_version", "style_summary", "environment_variables", "style_fidelity_anchors", "source_content_to_avoid", "visual_deconstruction", "composition", "typography", "color_palette", "image_treatment", "design_rules", "do", "avoid", "prompt_template", "negative_prompt", "examples"]
EXAMPLE_FIELDS = ["PRODUCT_CATEGORY", "DELIVERY_FORMAT", "PRIMARY_COLOR", "SECONDARY_COLOR", "SUBJECT", "SUBJECT_ACTION", "PRODUCT_OR_PROP", "LOCATION", "BACKGROUND_ELEMENTS", "MAIN_TEXT", "SECONDARY_TEXT", "ACCENT_SYMBOL", "WARDROBE_STYLE"]
PROMPT_VARIABLES = ["SUBJECT", "SUBJECT_ACTION", "PRODUCT_OR_PROP", "LOCATION", "BACKGROUND_ELEMENTS", "MAIN_TEXT", "SECONDARY_TEXT", "ACCENT_SYMBOL", "WARDROBE_STYLE", "STYLE_FIDELITY_ANCHORS", "SOURCE_CONTENT_TO_AVOID", "ASPECT_RATIO", "PRODUCT_CATEGORY", "DELIVERY_FORMAT", "PRIMARY_COLOR", "SECONDARY_COLOR"]

def validate(data: object) -> list[str]:
    if not isinstance(data, dict):
        return ["top-level value must be a JSON object"]
    errors = []
    if list(data) != TOP_LEVEL:
        errors.append("top-level keys or their order do not match the required structure")
    examples = data.get("examples")
    if not isinstance(examples, list) or len(examples) != 4:
        errors.append("examples must contain exactly four objects")
    else:
        for index, example in enumerate(examples, 1):
            values = example.get("values") if isinstance(example, dict) else None
            if not isinstance(values, dict) or list(values) != EXAMPLE_FIELDS:
                errors.append(f"examples[{index}].values must contain the 13 explicitly named fields in source order")
    template = data.get("prompt_template")
    if not isinstance(template, str):
        errors.append("prompt_template must be a string")
    else:
        missing = [name for name in PROMPT_VARIABLES if "{" + name + "}" not in template]
        if missing:
            errors.append("prompt_template is missing variables: " + ", ".join(missing))
    if re.search(r"<[^<>]+>", json.dumps(data, ensure_ascii=False)):
        errors.append("angle-bracket placeholder text remains")
    return errors

def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate_poster_json.py <poster-json-file>")
        return 2
    try:
        data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Poster JSON validation FAILED: {exc}")
        return 1
    errors = validate(data)
    if errors:
        print("Poster JSON validation FAILED")
        for error in errors:
            print(f"- {error}")
        print("Source note: the prose says 12 fields, but the mandatory template lists 13; all 13 named fields are preserved.")
        return 1
    print("Poster JSON validation passed")
    print("Source note: validated 13 explicitly named example fields; the untouched source prose also says 12.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
