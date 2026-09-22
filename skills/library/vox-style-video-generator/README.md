# vox-style-video-generator

A Claude Code skill that turns one topic prompt into a finished Vox-style explainer video. Script, keyframes, animation, voiceover, music, and local assembly — end to end.

**One topic in, finished film out.**

```
TOPIC → Script → Voiceover → Keyframes → Animation → Music → Assembly
        (Claude)  (xAI TTS)  (Seedream    (Gemini     (MiniMax  (ffmpeg)
                              5.0 Pro)     Omni Flash) Music 2.6)
```

All generation runs through the [Atlas Cloud](https://atlascloud.ai) unified API — one key covers every model. Assembly happens locally with ffmpeg.

## Install

```bash
# Claude Code
mkdir -p ~/.claude/skills
git clone https://github.com/YOURUSER/vox-style-video-generator ~/.claude/skills/vox-style-video-generator
```

Requirements:

- `ATLASCLOUD_API_KEY` in your environment ([free credits on signup](https://atlascloud.ai))
- `ffmpeg` + `ffprobe` with libass
- Python 3.10+ with `requests`

## Use

Open Claude Code and ask:

> Make me a 60-second Vox-style explainer about the Tang Dynasty golden age.

Claude reads the skill, writes the script in beats, generates and measures narration first (VO duration drives all timing), locks a visual style with a Seedream anchor frame, animates each keyframe with subtle collage motion, scores it, and assembles a subtitled, mixed, faststart MP4.

## What's inside

| File | What it covers |
|---|---|
| `SKILL.md` | The six-stage pipeline, project structure, orchestration rules |
| `references/vox-style-guide.md` | The writing arc and the mixed-media collage visual grammar, with prompt templates |
| `references/atlas-cloud-api.md` | Endpoints, model IDs, async polling pattern, cost budgeting |
| `references/ffmpeg-assembly.md` | Conform, concat, ASS subtitles, sidechain music ducking, final encode |

## Design decisions worth stealing

- **VO-first timing.** Narration is generated and measured before any video exists. Beat durations become the master clock, so clips are conformed to speech instead of speech being squeezed into clips.
- **Style anchor pattern.** One approved anchor frame + Seedream's edit endpoint (reference images) keeps palette, texture, and framing consistent across every keyframe — the thing that makes it look art-directed instead of generated.
- **Subtle motion vocabulary.** Explainer collage should move like motion graphics, not footage. The skill encodes an allowed/forbidden motion table and forces negative constraints into every animation prompt.
- **Everything is resumable.** All state lives in project files (`script.json`, `vo_durations.json`, per-beat assets), so any single beat can be tweaked and regenerated without touching the rest.

## Cost

Roughly $3–8 per 60-second film at July 2026 Atlas Cloud pricing; animation dominates. The skill quotes a budget before the first expensive stage and offers a cheap-tier draft pass.

## License

MIT
