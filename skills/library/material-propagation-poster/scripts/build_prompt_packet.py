#!/usr/bin/env python3
"""Build a deterministic motion-poster prompt packet from a small JSON config."""

import argparse
import json
from pathlib import Path


REQUIRED = [
    "title", "subject", "texture", "scenario", "growth_mode", "duration",
    "aspect_ratio", "seed", "route", "protected_zones",
]


def load_config(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    missing = [key for key in REQUIRED if key not in data]
    if missing:
        raise SystemExit("Missing config fields: " + ", ".join(missing))
    return data


def render(cfg: dict) -> str:
    zones = ", ".join(cfg["protected_zones"])
    return f"""# {cfg['title']}\n\n## Asset brief\n\n- Subject: {cfg['subject']}\n- Texture reference: {cfg['texture']}\n- Scenario: {cfg['scenario']}\n- Growth mode: {cfg['growth_mode']}\n- Duration: {cfg['duration']}s\n- Aspect ratio: {cfg['aspect_ratio']}\n- Seed: {cfg['seed']}\n- Route: {cfg['route']}\n- Protected zones: {zones}\n\n## Master prompt\n\nUse the uploaded subject image as the exact composition and geometry reference. Keep the camera locked, framing {cfg['aspect_ratio']}, background, lighting direction, silhouette, and protected zones unchanged. Transfer only the palette, motif, edge quality, scale, contrast, and surface behavior of the uploaded texture reference.\n\nGrowth mode: {cfg['growth_mode']}. Start at {cfg['seed']}. Travel along {cfg['route']} continuously, remain attached to the subject surface, stop at the declared mask boundary, and settle without changing geometry. Duration {cfg['duration']} seconds. Preserve: {zones}.\n\nStable temporal continuity, coherent occlusion, clean edges, no flicker, no jump cuts, no camera drift, no identity or typography changes.\n\n## Negative prompt\n\nidentity drift, geometry deformation, altered silhouette, invented logo, corrupted typography, background replacement, camera shake, texture floating above the surface, unrelated particles, temporal flicker, frame popping, hard cut\n"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path, help="JSON config path")
    parser.add_argument("-o", "--out", type=Path, help="Output markdown path")
    args = parser.parse_args()
    packet = render(load_config(args.config))
    if args.out:
        args.out.write_text(packet, encoding="utf-8")
    else:
        print(packet, end="")


if __name__ == "__main__":
    main()
