# ffmpeg Assembly Recipes

All commands assume the project structure from SKILL.md. Run from the project root. Target spec: 1920x1080, 30fps, H.264 CRF 18, AAC 192k.

## 1. Conform each clip to its beat duration

Each clip must run exactly `vo_duration + 0.5s` (the gap gives narration breathing room). Two cases:

**Clip longer than needed — trim:**
```bash
ffmpeg -y -i clips/clip_01.mp4 -t 10.33 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1" \
  -an -c:v libx264 -crf 18 -preset medium conformed/clip_01.mp4
```

**Clip shorter than needed — hold last frame with tpad:**
```bash
ffmpeg -y -i clips/clip_02.mp4 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=2.4" \
  -an -c:v libx264 -crf 18 -preset medium conformed/clip_02.mp4
```

Strip audio (`-an`) — animation models sometimes emit unwanted audio tracks; the film's audio is built separately. Identical codec/fps/SAR across conformed clips is what makes lossless-ish concat safe.

## 2. Concatenate video

```bash
for f in conformed/clip_*.mp4; do echo "file '$PWD/$f'"; done > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy video_full.mp4
```

If concat complains about parameter mismatches, a clip skipped conform — fix it there rather than re-encoding the concat.

## 3. Build the VO track

Assemble narration with silence gaps matching video timing (0.5s after each beat):

```bash
# Per beat: pad 0.5s of silence onto the end
ffmpeg -y -i audio/vo/beat_01.mp3 -af "apad=pad_dur=0.5" -ar 48000 -ac 2 padded/beat_01.wav
# Then concat all padded WAVs
for f in padded/beat_*.wav; do echo "file '$PWD/$f'"; done > vo_concat.txt
ffmpeg -y -f concat -safe 0 -i vo_concat.txt -c copy vo_full.wav
```

Verify: `vo_full.wav` duration must equal `video_full.mp4` duration within ~0.1s. If it drifts, a conform duration was computed wrong — audit `vo_durations.json` against the conform commands.

## 4. Music: loop/trim + duck under narration

Fit music to film length (`D` = film duration):

```bash
# Loop if short, then trim, with 2s fade in and 3s fade out
ffmpeg -y -stream_loop -1 -i audio/music.mp3 -t $D \
  -af "afade=t=in:d=2,afade=t=out:st=$(echo "$D-3"|bc):d=3" -ar 48000 -ac 2 music_fit.wav
```

**Duck music under VO with sidechain compression** (music drops automatically whenever narration is present — the professional approach):

```bash
ffmpeg -y -i vo_full.wav -i music_fit.wav -filter_complex "\
[1:a][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=200:release=800:makeup=1[ducked];\
[0:a][ducked]amix=inputs=2:duration=first:weights=1 0.9,alimiter=limit=0.95[out]" \
  -map "[out]" -ar 48000 mix.wav
```

Tune by ear: if music pumps audibly, raise `release` toward 1200; if narration is masked, raise `ratio` or lower music weight to 0.7. Simpler fallback: skip sidechain and just mix music at `volume=0.22`.

## 5. Subtitles (.ass)

Generate `subs/captions.ass` programmatically from `script.json` + `vo_durations.json`. Split each beat's narration into chunks of ≤ 42 chars at clause boundaries, and distribute the beat's time window across chunks proportional to character count.

Header style (Vox look — bold, white, heavy outline):

```
[Script Info]
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vox,Archivo Black,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:04.90,Vox,,0,0,0,,In the seventh century, Tang China built Chang'an —\Nthe largest, richest city on Earth.
```

If Archivo Black isn't installed, fall back to `Arial Black` or bundle a font and point libass at it with `fontsdir`. Accent-color keyword highlighting: wrap the word in `{\c&HB29C0C&}word{\c&HFFFFFF&}` (ASS colors are BGR hex).

## 6. Final mux: burn subs + encode

```bash
ffmpeg -y -i video_full.mp4 -i mix.wav \
  -vf "ass=subs/captions.ass" \
  -map 0:v -map 1:a \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  final/film.mp4
```

Optional attribution watermark (add before the ass filter in the chain):
`drawtext=text='Made with vox-style-video-generator':x=w-tw-24:y=h-th-18:fontsize=20:fontcolor=white@0.55`

## 7. QC checklist

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 final/film.mp4
```

- [ ] Duration matches VO total ±0.2s
- [ ] Watch at 1x: every caption appears while its words are being spoken
- [ ] Music audible in gaps, never masking narration
- [ ] No black frames at clip joins (a conform/pad artifact — check setsar and fps consistency)
- [ ] Plays in QuickTime/browser (yuv420p + faststart handle this)
