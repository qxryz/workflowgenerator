#!/usr/bin/env python3
"""Batch-analyze short motion-design references with ffmpeg + NumPy + Pillow.

Produces contact sheets, dominant palettes, visual-pulse estimates, audio-transient
estimates, and machine-readable JSON/CSV summaries. Metrics are comparative aids,
not semantic shot labels.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


def run(command: list[str]) -> bytes:
    return subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def probe(path: Path) -> dict:
    raw = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "format=duration:stream=width,height,r_frame_rate",
        "-of", "json", str(path),
    ])
    data = json.loads(raw)
    stream = data["streams"][0]
    num, den = stream.get("r_frame_rate", "0/1").split("/")
    return {
        "duration_s": float(data["format"]["duration"]),
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "fps": float(num) / max(float(den), 1.0),
    }


def decode_video(path: Path, analysis_fps: int = 5, width: int = 160, height: int = 90) -> np.ndarray:
    raw = run([
        "ffmpeg", "-v", "error", "-i", str(path), "-an",
        "-vf", f"fps={analysis_fps},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ])
    frame_size = width * height * 3
    count = len(raw) // frame_size
    if count == 0:
        raise RuntimeError(f"No video frames decoded from {path}")
    return np.frombuffer(raw[: count * frame_size], dtype=np.uint8).reshape(count, height, width, 3)


def decode_audio(path: Path, sample_rate: int = 8000) -> np.ndarray:
    try:
        raw = run([
            "ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
            "-ar", str(sample_rate), "-f", "f32le", "-",
        ])
    except subprocess.CalledProcessError:
        return np.empty(0, dtype=np.float32)
    return np.frombuffer(raw, dtype=np.float32)


def robust_peaks(values: np.ndarray, min_gap: int, floor: float = 0.0) -> tuple[list[int], float]:
    if len(values) < 3:
        return [], floor
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    threshold = max(float(np.percentile(values, 88)), median + 3.5 * mad, floor)
    candidates = [i for i in range(1, len(values) - 1)
                  if values[i] >= threshold and values[i] > values[i - 1] and values[i] >= values[i + 1]]
    kept: list[int] = []
    for index in candidates:
        if not kept or index - kept[-1] >= min_gap:
            kept.append(index)
        elif values[index] > values[kept[-1]]:
            kept[-1] = index
    return kept, threshold


def visual_metrics(frames: np.ndarray, analysis_fps: int) -> dict:
    normalized = frames.astype(np.float32) / 255.0
    luma = normalized[..., 0] * 0.2126 + normalized[..., 1] * 0.7152 + normalized[..., 2] * 0.0722
    chroma = normalized.max(axis=-1) - normalized.min(axis=-1)
    abs_diff = np.mean(np.abs(np.diff(normalized, axis=0)), axis=(1, 2, 3))

    # A histogram component makes the score less sensitive to object motion and more
    # sensitive to full-frame visual changes.
    histograms = []
    for frame in frames:
        channel_hists = [np.histogram(frame[..., c], bins=16, range=(0, 256), density=True)[0] for c in range(3)]
        vector = np.concatenate(channel_hists)
        histograms.append(vector / max(vector.sum(), 1e-8))
    histograms = np.asarray(histograms)
    hist_diff = np.sum(np.abs(np.diff(histograms, axis=0)), axis=1) / 2.0
    score = abs_diff * 0.7 + hist_diff * 0.3
    peaks, threshold = robust_peaks(score, min_gap=max(1, int(analysis_fps * 0.35)), floor=0.07)

    return {
        "mean_luma": round(float(luma.mean()), 4),
        "mean_saturation_proxy": round(float(chroma.mean()), 4),
        "shadow_ratio": round(float((luma < 0.18).mean()), 4),
        "highlight_ratio": round(float((luma > 0.82).mean()), 4),
        "motion_energy": round(float(abs_diff.mean()), 4),
        "motion_p90": round(float(np.percentile(abs_diff, 90)), 4),
        "visual_pulse_count": len(peaks),
        "visual_pulse_times_s": [round((index + 1) / analysis_fps, 2) for index in peaks],
        "visual_pulse_threshold": round(float(threshold), 4),
    }


def audio_metrics(samples: np.ndarray, duration_s: float, sample_rate: int = 8000) -> dict:
    if len(samples) < sample_rate:
        return {"audio_transient_count": 0, "audio_transients_per_s": 0.0, "audio_rms": 0.0}
    window = int(sample_rate * 0.05)
    hop = int(sample_rate * 0.025)
    count = 1 + (len(samples) - window) // hop
    rms = np.empty(count, dtype=np.float32)
    for i in range(count):
        chunk = samples[i * hop:i * hop + window]
        rms[i] = math.sqrt(float(np.mean(chunk * chunk)) + 1e-12)
    envelope = np.log1p(rms * 50.0)
    onset = np.maximum(np.diff(envelope), 0.0)
    peaks, _ = robust_peaks(onset, min_gap=max(1, int(0.12 / (hop / sample_rate))), floor=0.015)
    return {
        "audio_transient_count": len(peaks),
        "audio_transients_per_s": round(len(peaks) / max(duration_s, 0.001), 3),
        "audio_rms": round(float(np.sqrt(np.mean(samples * samples))), 5),
    }


def dominant_palette(frames: np.ndarray, colors: int = 8) -> list[dict]:
    indexes = np.linspace(0, len(frames) - 1, min(24, len(frames)), dtype=int)
    strips = [Image.fromarray(frames[i]).resize((96, 54), Image.Resampling.BILINEAR) for i in indexes]
    canvas = Image.new("RGB", (96, 54 * len(strips)))
    for row, image in enumerate(strips):
        canvas.paste(image, (0, row * 54))
    quantized = canvas.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    raw_palette = quantized.getpalette() or []
    counts = sorted(quantized.getcolors(maxcolors=colors) or [], reverse=True)
    total = sum(count for count, _ in counts) or 1
    result = []
    for count, index in counts:
        rgb = tuple(raw_palette[index * 3:index * 3 + 3])
        result.append({"hex": "#%02X%02X%02X" % rgb, "weight": round(count / total, 4)})
    return result


def get_font(size: int) -> ImageFont.ImageFont:
    for path in [Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def render_contact_sheet(frames: np.ndarray, palette: list[dict], out_path: Path,
                         label: str, duration_s: float, analysis_fps: int,
                         columns: int = 4, rows: int = 4) -> None:
    count = columns * rows
    indexes = np.linspace(0, len(frames) - 1, count, dtype=int)
    tile_w, tile_h, caption_h = 320, 180, 24
    header_h, palette_h = 42, 38
    canvas = Image.new("RGB", (columns * tile_w, header_h + rows * (tile_h + caption_h) + palette_h), "#111111")
    draw = ImageDraw.Draw(canvas)
    font = get_font(16)
    small = get_font(13)
    draw.text((10, 11), f"{label}  |  {duration_s:.1f}s  |  16-point visual scan", fill="white", font=font)
    for position, frame_index in enumerate(indexes):
        row, column = divmod(position, columns)
        x, y = column * tile_w, header_h + row * (tile_h + caption_h)
        image = Image.fromarray(frames[frame_index]).resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        canvas.paste(image, (x, y))
        time_s = frame_index / analysis_fps
        draw.rectangle((x, y + tile_h, x + tile_w, y + tile_h + caption_h), fill="#111111")
        draw.text((x + 7, y + tile_h + 4), f"t={time_s:05.1f}s", fill="#E6E6E6", font=small)
    palette_y = canvas.height - palette_h
    cursor = 0
    for color in palette:
        width = max(1, round(canvas.width * color["weight"]))
        draw.rectangle((cursor, palette_y, min(canvas.width, cursor + width), canvas.height), fill=color["hex"])
        cursor += width
    if cursor < canvas.width:
        draw.rectangle((cursor, palette_y, canvas.width, canvas.height), fill=palette[-1]["hex"] if palette else "#000000")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=92)


def collect_inputs(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(p for p in input_path.iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Video file or directory")
    parser.add_argument("--out", type=Path, required=True, help="Output directory")
    parser.add_argument("--metadata-json", type=Path, help="Optional list keyed by bvid/stem")
    parser.add_argument("--analysis-fps", type=int, default=5)
    args = parser.parse_args()

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg and ffprobe must be on PATH")
    files = collect_inputs(args.input)
    if not files:
        raise SystemExit(f"No supported videos found at {args.input}")

    metadata: dict[str, dict] = {}
    if args.metadata_json:
        metadata = {item.get("bvid", ""): item for item in json.loads(args.metadata_json.read_text(encoding="utf-8"))}

    args.out.mkdir(parents=True, exist_ok=True)
    reports = []
    for path in files:
        print(f"Analyzing {path.name}", flush=True)
        info = probe(path)
        frames = decode_video(path, args.analysis_fps)
        palette = dominant_palette(frames)
        visual = visual_metrics(frames, args.analysis_fps)
        audio = audio_metrics(decode_audio(path), info["duration_s"])
        item = {
            "id": path.stem,
            "file": str(path.resolve()),
            **metadata.get(path.stem, {}),
            **{key: round(value, 3) if isinstance(value, float) else value for key, value in info.items()},
            **visual,
            **audio,
            "visual_pulses_per_s": round(visual["visual_pulse_count"] / max(info["duration_s"], 0.001), 3),
            "palette": palette,
        }
        reports.append(item)
        render_contact_sheet(frames, palette, args.out / "contact_sheets" / f"{path.stem}.jpg",
                             path.stem, info["duration_s"], args.analysis_fps)

    (args.out / "analysis.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    scalar_keys = [
        "id", "cohort", "title", "duration_s", "width", "height", "fps", "mean_luma",
        "mean_saturation_proxy", "shadow_ratio", "highlight_ratio", "motion_energy", "motion_p90",
        "visual_pulse_count", "visual_pulses_per_s", "audio_transient_count", "audio_transients_per_s",
    ]
    with (args.out / "analysis.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=scalar_keys)
        writer.writeheader()
        for report in reports:
            writer.writerow({key: report.get(key, "") for key in scalar_keys})
    print(f"Wrote {len(reports)} reports to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
