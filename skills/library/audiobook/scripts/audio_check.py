#!/usr/bin/env python3
"""Audio quality checker — detects energy spikes, DC offset, and clipping.

Usage:
    python3 audio_check.py <audio_file> [--top 20]

Decodes audio to raw PCM via ffmpeg, then checks for:
1. Energy spikes: abrupt jumps from near-silence to loud audio within one hop,
   typically caused by TTS splice artifacts or corrupted segments.
2. DC offset: non-zero mean amplitude indicating a constant bias in the waveform,
   which can cause clicks at splice points and reduce headroom.
3. Clipping: samples hitting the maximum amplitude ceiling (digital distortion).
"""

import argparse
import math
import struct
import subprocess
import sys
from pathlib import Path


def decode_to_pcm(path: str, sr: int = 16000) -> bytes:
    """Decode audio to mono 16-bit PCM via ffmpeg."""
    r = subprocess.run(
        [
            "ffmpeg", "-v", "quiet", "-y",
            "-i", path,
            "-ac", "1", "-ar", str(sr), "-f", "s16le", "-acodec", "pcm_s16le",
            "pipe:1",
        ],
        capture_output=True,
    )
    if r.returncode != 0:
        print(f"ffmpeg decode failed: {r.stderr.decode()}", file=sys.stderr)
        sys.exit(1)
    return r.stdout


def analyze(pcm: bytes, sr: int, top_n: int):
    n_samples = len(pcm) // 2
    if n_samples == 0:
        print("ERROR: empty audio")
        return

    samples = struct.unpack(f"<{n_samples}h", pcm)
    floats = [s / 32768.0 for s in samples]

    duration = n_samples / sr
    peak = max(abs(f) for f in floats)
    rms = (sum(f * f for f in floats) / n_samples) ** 0.5

    print(f"Duration:   {duration:.1f}s  ({n_samples} samples @ {sr}Hz)")
    print(f"Peak:       {peak:.4f}  ({20 * math.log10(max(peak, 1e-10)):.1f} dB)")
    print(f"RMS:        {rms:.4f}  ({20 * math.log10(max(rms, 1e-10)):.1f} dB)")
    print()

    issues = []

    # --- 1. Energy spikes (abrupt silence -> loud in one hop) ---
    win = int(sr * 0.05)  # 50ms window
    hop = win // 2        # 25ms hop
    spike_silence = 10 ** (-48 / 20)
    spike_loud = 0.04
    energy_spikes = []
    prev_rms = 0
    for w in range(0, n_samples - win, hop):
        chunk = floats[w : w + win]
        w_rms = (sum(x * x for x in chunk) / win) ** 0.5
        if prev_rms < spike_silence and w_rms > spike_loud:
            ratio = w_rms / max(prev_rms, 1e-10)
            energy_spikes.append((w / sr, prev_rms, w_rms, ratio))
        prev_rms = w_rms

    if energy_spikes:
        severe = [s for s in energy_spikes if s[3] > 100]
        if severe:
            issues.append(f"{len(severe)} energy spike(s)")
            print(f"  Energy spikes (abrupt onset): {len(severe)} detected")
            severe.sort(key=lambda x: -x[3])
            for t, pre, post, ratio in severe[:top_n]:
                pre_db = 20 * math.log10(max(pre, 1e-10))
                post_db = 20 * math.log10(max(post, 1e-10))
                mm = int(t) // 60
                ss = t - mm * 60
                print(f"   {mm}:{ss:05.2f}  {pre_db:.0f}dB -> {post_db:.0f}dB  (x{ratio:.0f})")
            if len(severe) > top_n:
                print(f"   ... and {len(severe) - top_n} more")
        else:
            print("  Energy spikes: none severe")
    else:
        print("  Energy spikes: none detected")

    # --- 2. DC offset ---
    dc_offset = sum(floats) / n_samples
    dc_pct = abs(dc_offset) * 100
    if dc_pct > 1.0:
        issues.append(f"DC offset {dc_pct:.2f}%")
        print(f"  DC offset:  {dc_offset:+.6f}  ({dc_pct:.2f}%) -- exceeds 1% threshold")
    else:
        print(f"  DC offset:  {dc_offset:+.6f}  ({dc_pct:.2f}%) -- OK")

    # --- 3. Clipping ---
    clip_threshold = 32767 / 32768.0  # ~0.99997
    clipped = sum(1 for f in floats if abs(f) >= clip_threshold)
    clip_pct = clipped / n_samples * 100
    if clipped > 0:
        # Only flag as issue if clipping is significant (>0.01% of samples)
        if clip_pct > 0.01:
            issues.append(f"clipping {clipped} samples ({clip_pct:.3f}%)")
            print(f"  Clipping:   {clipped} samples ({clip_pct:.3f}%) -- significant")
        else:
            print(f"  Clipping:   {clipped} samples ({clip_pct:.4f}%) -- negligible")
    else:
        print(f"  Clipping:   none")

    # --- Summary ---
    print()
    if issues:
        print(f"=== {len(issues)} issue(s) found: {'; '.join(issues)} ===")
    else:
        print("=== PASS ===")


def main():
    parser = argparse.ArgumentParser(description="Check audio for quality issues (energy spikes, DC offset, clipping)")
    parser.add_argument("audio", help="Audio file path")
    parser.add_argument("--top", "-n", type=int, default=20,
                        help="Show top N worst spikes (default 20)")
    parser.add_argument("--sr", type=int, default=16000,
                        help="Sample rate for analysis (default 16000)")
    args = parser.parse_args()

    path = args.audio
    if not Path(path).exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)

    print(f"Checking: {Path(path).name}")
    print(f"{'─' * 50}")

    pcm = decode_to_pcm(path, args.sr)
    analyze(pcm, args.sr, args.top)


if __name__ == "__main__":
    main()
