#!/usr/bin/env python3
"""Burn subtitles into video using PIL text rendering + ffmpeg overlay.

This is the ONLY reliable subtitle method for this pipeline:
- Cloud services (burn_in_subtitles_to_video, batch_burn_subtitles) may 404
- ffmpeg drawtext/subtitles filters require libfreetype/libass (often missing)
- mv_final_assembly subtitle feature may silently fail (reports success, no visible subtitles)

How it works:
1. PIL renders each unique subtitle as a transparent PNG (white text + black outline)
2. Builds a full frame sequence (1 PNG per video frame), reusing cached images
3. Encodes frame sequence as a transparent video (PNG codec + RGBA)
4. ffmpeg overlays the subtitle video onto the main video in a single pass

Usage:
    python3 burn_subs.py <input_video> <output_video>

Before running, edit the SUBTITLES list below with your actual subtitle data.
Video dimensions are auto-detected via ffprobe.

Subtitle data format:
    SUBTITLES = [
        (start_seconds, end_seconds, "subtitle text"),
        (0.00, 2.50, "Hey folks, welcome back."),
        (2.50, 6.10, "Today's burning question:\\nwhy do cats think\\nthey own the house?"),
        ...
    ]

Tips:
- Use \\n for line breaks within a subtitle (max 3 lines recommended)
- Keep each subtitle under 3-4 seconds for readability
- Leave small gaps (0.1-0.5s) between subtitles at natural pauses
- ASR timestamps are a starting point — cross-verify with actual audio
- At segment boundaries (15s marks), ASR timestamps may drift ~0.5s
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ═══════════════════════════════════════════
# SUBTITLE DATA — Edit this before running
# ═══════════════════════════════════════════
SUBTITLES = [
    (0.00, 2.50, "Hey folks, welcome back."),
    (2.50, 6.10, "Today's burning question:\nwhy do cats think\nthey own the house?"),
    # Add your subtitles here...
]

# Remove empty entries
SUBTITLES = [(s, e, t) for s, e, t in SUBTITLES if t]

# ═══════════════════════════════════════════
# STYLE PARAMETERS
# ═══════════════════════════════════════════
FPS = 25
FONT_SIZE = 36
OUTLINE_WIDTH = 3
BOTTOM_MARGIN = 180  # pixels from bottom edge


def detect_video_dimensions(video_path):
    """Auto-detect video width and height via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-select_streams", "v:0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Warning: ffprobe failed, using default 720x1280")
        return 720, 1280
    streams = json.loads(result.stdout).get("streams", [])
    if not streams:
        print(f"Warning: no video stream found, using default 720x1280")
        return 720, 1280
    w = int(streams[0]["width"])
    h = int(streams[0]["height"])
    return w, h


def get_video_duration(video_path):
    """Get video duration in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(json.loads(result.stdout)["format"]["duration"])


def find_font():
    """Find a suitable font for subtitle rendering (macOS paths)."""
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFCompact.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",       # Linux
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, FONT_SIZE)
            except Exception:
                continue
    return ImageFont.load_default()


def find_chinese_font():
    """Find a font that supports Chinese characters (macOS/Linux)."""
    for p in [
        "/System/Library/Fonts/STHeiti Medium.ttc",       # macOS
        "/System/Library/Fonts/PingFang.ttc",             # macOS
        "/System/Library/Fonts/Hiragino Sans GB.ttc",     # macOS
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",  # Linux
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Linux
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, FONT_SIZE)
            except Exception:
                continue
    return None


def detect_language(subtitles):
    """Detect if subtitles contain Chinese characters."""
    all_text = "".join(t for _, _, t in subtitles)
    chinese_chars = sum(1 for c in all_text if '\u4e00' <= c <= '\u9fff')
    return "zh" if chinese_chars > len(all_text) * 0.1 else "en"


def get_active_subtitle(t):
    """Return the subtitle text active at time t, or None."""
    for start, end, text in SUBTITLES:
        if start <= t < end:
            return text
    return None


def render_frame(text, font, width, height):
    """Render a frame with subtitle text (or transparent if None)."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    if text is None:
        return img

    draw = ImageDraw.Draw(img)
    bbox = draw.multiline_textbbox((0, 0), text, font=font, align="center")
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (width - text_w) // 2
    y = height - BOTTOM_MARGIN - text_h

    # Draw outline (black border for readability)
    for dx in range(-OUTLINE_WIDTH, OUTLINE_WIDTH + 1):
        for dy in range(-OUTLINE_WIDTH, OUTLINE_WIDTH + 1):
            if dx * dx + dy * dy <= OUTLINE_WIDTH * OUTLINE_WIDTH:
                draw.multiline_text(
                    (x + dx, y + dy), text, font=font,
                    fill=(0, 0, 0, 255), align="center"
                )
    # Draw white text on top
    draw.multiline_text(
        (x, y), text, font=font,
        fill=(255, 255, 255, 255), align="center"
    )
    return img


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 burn_subs.py <input_video> <output_video>")
        print()
        print("Edit the SUBTITLES list in this script before running.")
        sys.exit(1)

    input_video = sys.argv[1]
    output_video = sys.argv[2]

    if not SUBTITLES or (len(SUBTITLES) == 1 and "Add your" in SUBTITLES[0][2]):
        print("Error: No subtitle data. Edit the SUBTITLES list in this script first.")
        sys.exit(1)

    # Auto-detect video dimensions
    width, height = detect_video_dimensions(input_video)
    duration = get_video_duration(input_video)
    total_frames = int(duration * FPS) + 1

    # Select font based on subtitle language
    lang = detect_language(SUBTITLES)
    if lang == "zh":
        font = find_chinese_font() or find_font()
        print(f"Detected Chinese subtitles, using CJK font")
    else:
        font = find_font()

    print(f"Video: {width}x{height}, {duration:.2f}s, {total_frames} frames @ {FPS}fps")
    print(f"Subtitles: {len(SUBTITLES)} segments")

    tmpdir = tempfile.mkdtemp(prefix="burn_subs_")
    print(f"Rendering {total_frames} subtitle frames to {tmpdir}...")

    # Pre-compute: render each unique subtitle once, cache for reuse
    cached_images = {}
    blank = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    for frame_num in range(total_frames):
        t = frame_num / FPS
        text = get_active_subtitle(t)

        if text is None:
            img = blank
        else:
            if text not in cached_images:
                cached_images[text] = render_frame(text, font, width, height)
            img = cached_images[text]

        frame_path = os.path.join(tmpdir, f"frame_{frame_num:05d}.png")
        img.save(frame_path)

        if frame_num % 100 == 0:
            print(f"  Frame {frame_num}/{total_frames} (t={t:.1f}s)")

    print(f"Rendered {total_frames} frames, {len(cached_images)} unique subtitle images")

    # Step 1: Create subtitle overlay video from PNG sequence (preserves alpha)
    sub_video = os.path.join(tmpdir, "subs.mov")
    cmd1 = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", os.path.join(tmpdir, "frame_%05d.png"),
        "-c:v", "png",
        "-pix_fmt", "rgba",
        sub_video,
    ]
    print("Creating subtitle overlay video...")
    r1 = subprocess.run(cmd1, capture_output=True, text=True)
    if r1.returncode != 0:
        print("Error creating subtitle video:", r1.stderr[-2000:])
        sys.exit(1)

    # Step 2: Overlay subtitle video onto main video (single pass)
    cmd2 = [
        "ffmpeg", "-y",
        "-i", input_video,
        "-i", sub_video,
        "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1[outv]",
        "-map", "[outv]",
        "-map", "0:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy",
        output_video,
    ]
    print("Overlaying subtitles onto video...")
    r2 = subprocess.run(cmd2, capture_output=True, text=True)
    if r2.returncode != 0:
        print("Error overlaying:", r2.stderr[-2000:])
        sys.exit(1)

    # Cleanup temp files
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)
    print(f"Done! Output: {output_video}")


if __name__ == "__main__":
    main()
