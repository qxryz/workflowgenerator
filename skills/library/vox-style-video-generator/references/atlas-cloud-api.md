# Atlas Cloud API Reference

One key, one base URL, every model in the pipeline. Auth: `Authorization: Bearer $ATLASCLOUD_API_KEY`.

> **Verify before running.** These patterns were confirmed against Atlas Cloud's public docs in July 2026. Media APIs change; before the first paid call of a session, fetch https://www.atlascloud.ai/docs and confirm endpoint paths, model IDs, and parameter names. Each model's page on atlascloud.ai/models includes a live request example — trust that over this file if they conflict.

## The async task pattern

All media generation (image, video, audio, music) follows submit-then-poll:

```python
import requests, time, os

BASE = "https://api.atlascloud.ai/api/v1"
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {os.environ['ATLASCLOUD_API_KEY']}",
}

def submit(endpoint: str, payload: dict) -> str:
    r = requests.post(f"{BASE}/{endpoint}", headers=HEADERS, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()  # contains a task/request id

def poll(task_id: str, interval=5, timeout=600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{BASE}/model/task/{task_id}", headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        status = data.get("status", "").lower()
        if status in ("succeeded", "completed", "success"):
            return data  # contains output URL(s)
        if status in ("failed", "error", "cancelled"):
            raise RuntimeError(f"Task {task_id} failed: {data}")
        time.sleep(interval)
    raise TimeoutError(task_id)
```

Download outputs immediately — result URLs can expire. Write raw API responses to `prompts.log` alongside the prompt that produced them.

## Models used by this pipeline

| Stage | Model ID | Endpoint family | Cost (July 2026) |
|---|---|---|---|
| Keyframes (anchor) | `bytedance/seedream-v5.0-pro/text-to-image` | generateImage | $0.045/img @1.5K, $0.09 @2K |
| Keyframes (consistent) | `bytedance/seedream-v5.0-pro/edit` | generateImage | $0.054/img; 1st ref image free, +$0.003/extra ref (max 10) |
| Animation | Gemini Omni Flash, image-to-video variant | generateVideo | from $0.112/sec |
| Voiceover | xAI TTS v1 | generateAudio / TTS | per-character; trivial vs. video |
| Music | `minimax/music-2.6` | generateAudio | per generation |

Notes:
- **Seedream 5.0 Pro** outputs 2K/3K (not 4K), 15 prompt languages, strong typography. The edit model preserves identity/lighting/palette across reference images — this is what powers the style-anchor consistency pattern.
- **Gemini Omni Flash** accepts image-to-video with up to 7 reference images and honors negative constraints well; state motion restrictions explicitly in every prompt.
- **xAI TTS v1**: 20 languages, 80+ voices, delivery control parameters (pace/emotion). List available voices via the model page or a voices endpoint; audition 2–3 on beat 1 before committing.
- **MiniMax Music 2.6** verified request shape:

```python
data = {
    "model": "minimax/music-2.6",
    "prompt": "contemplative cinematic underscore, felt piano, soft strings, 90bpm, documentary",
    "is_instrumental": True,
    "format": "mp3",
    "sample_rate": 44100,
    "bitrate": 256000,
}
submit("model/generateAudio", data)
```

`lyrics` (max 3500 chars, `[Verse]`/`[Chorus]` tags) is available but unused here — always instrumental under narration.

## Image-to-video call shape (Stage 4)

Reference images are typically passed as URLs or base64. Keyframes generated in Stage 3 can be re-uploaded or passed by their Atlas-hosted output URL if still valid. Typical payload fields: `model`, `prompt`, `image` (or `reference_images`), `duration`, `resolution`/`aspect_ratio`. Confirm exact field names on the model's page.

Request duration ≥ beat VO duration; you will trim at assembly. If the model only supports fixed durations (e.g., 5s/10s), pick the smallest ≥ the VO length, or plan a hold-last-frame extension in ffmpeg for long beats.

## Concurrency and retries

- Submit all Stage 4 tasks in one burst, collect task IDs, then poll round-robin. Serial generation turns a 10-minute job into an hour.
- Retry transient failures (HTTP 5xx, task status `failed` with infra-sounding errors) once with the same payload. Content failures (moderation, malformed prompt) need a prompt fix, not a retry.
- Rate limits exist per model; on 429, back off 30s and continue the poll loop.

## Budgeting

A 60s film, 7 beats, 10s clips at Omni Flash pricing:

- Keyframes: 1 anchor + 6 edits ≈ $0.42 (+regens ≈ $0.60)
- Animation: 7 × 10s × $0.112 ≈ $7.84 → the dominant cost; shorter clips or a compatible lower-cost video tier can reduce this substantially
- VO + music: < $0.50

Quote the user before Stage 3. Offer the cheap-video-tier tradeoff explicitly for drafts: generate a full draft on the budget tier, then regenerate hero beats on the premium tier.
