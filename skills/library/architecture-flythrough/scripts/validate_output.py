#!/usr/bin/env python3
"""Probe a real video; optionally enforce manifest values and full decoding.
Exit 0: passed; 2: failed or unavailable verification. Visual QA is separate.
"""
import argparse
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys


def number(value):
    try:
        return float(Fraction(str(value)))
    except (ValueError, ZeroDivisionError):
        return 0.0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video")
    parser.add_argument("--previs", action="store_true",
                        help="Require 2560x1440 square-pixel Blender preview")
    parser.add_argument("--max-duration", type=float, default=15.0)
    parser.add_argument("--expected-fps", type=float)
    parser.add_argument("--expected-duration", type=float)
    parser.add_argument("--expected-width", type=int)
    parser.add_argument("--expected-height", type=int)
    parser.add_argument("--expected-frames", type=int)
    parser.add_argument("--expected-codec")
    parser.add_argument("--decode-check", action="store_true")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    try:
        path = Path(args.video).resolve(strict=True)
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError("missing or empty video")
        probe = subprocess.run([args.ffprobe, "-v", "error", "-count_frames",
                                "-show_streams", "-show_format", "-of", "json", str(path)],
                               capture_output=True, text=True, check=True)
        if probe.stderr.strip():
            raise ValueError("ffprobe reported decoding errors: " + probe.stderr.strip())
        data = json.loads(probe.stdout)
        video = next((v for v in data.get("streams", [])
                      if v.get("codec_type") == "video"
                      and not v.get("disposition", {}).get("attached_pic")), None)
        if video is None:
            raise ValueError("no video stream")
        fps = number(video.get("avg_frame_rate")) or number(video.get("r_frame_rate"))
        duration = number(video.get("duration")) or number(data.get("format", {}).get("duration"))
        raw_frames = video.get("nb_read_frames")
        frames = int(raw_frames) if raw_frames and str(raw_frames).isdigit() else None
        report = {"file": str(path), "width": video.get("width"), "height": video.get("height"),
                  "fps": fps, "duration": duration, "frames": frames,
                  "frame_count_source": "ffprobe_count_frames", "codec": video.get("codec_name")}
        errors = []
        if args.previs:
            if (report["width"], report["height"]) != (2560, 1440):
                errors.append("preview must be 2560x1440")
            sar = video.get("sample_aspect_ratio")
            if sar not in (None, "N/A", "1:1"):
                errors.append("preview must use square pixels")
        if fps <= 0:
            errors.append("invalid FPS")
        if duration <= 0 or duration > args.max_duration + 0.001:
            errors.append("duration outside allowed range")
        if not report["width"] or not report["height"]:
            errors.append("invalid dimensions")
        if frames is None or frames <= 0:
            errors.append("actual decoded frame count unavailable")
        for key in ("width", "height", "frames", "codec"):
            expected = getattr(args, "expected_" + key)
            if expected is not None and report[key] != expected:
                errors.append(f"{key}: expected {expected}, got {report[key]}")
        if args.expected_fps is not None and abs(fps - args.expected_fps) > 0.01:
            errors.append("FPS mismatch")
        if args.expected_duration is not None and abs(duration - args.expected_duration) > max(0.001, 0.5 / max(fps, 1)):
            errors.append("duration mismatch")
        if frames is not None and fps > 0 and abs(frames - duration * fps) > 1.01:
            errors.append("frame count / duration / FPS mismatch")
        if args.decode_check:
            subprocess.run([args.ffmpeg, "-v", "error", "-xerror", "-i", str(path),
                            "-map", "0:v:0", "-f", "null", "-"],
                           capture_output=True, text=True, check=True)
        report.update(status="failed" if errors else "passed", errors=errors,
                      full_decode_checked=args.decode_check)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2 if errors else 0
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
