# 音频时间线模板 v2.0

本模板是旁白 / 对白不重叠的唯一事实来源。镜内 start/end 使用镜头相对秒数；global_start/global_end 使用成片全局秒数。所有区间均为半开区间 [start,end)。

## 项目音频锁

~~~yaml
audio_policy:
  dialogue_source_mode: rendered_video_original # 或 input_video_original
  dialogue_replacement_allowed: false
  narration_dialogue_overlap_allowed: false
  minimum_speech_gap_s: 0.20
  narrator_voice_id: selected catalog narrator voice ID
  narrator_speed: 1.0
  narrator_consistency_lock: episode_wide
  narration_source: episode_master_then_slice
  narrator_pitch: 0
  narrator_emotion: "project_locked_baseline"
  narrator_pause_policy: "fixed_punctuation_pauses"
  narrator_volume: 1.0
  narrator_sample_rate: 48000
  narrator_codec: "wav_pcm_s16le"
  narrator_loudness_target_lufs: -16
  narrator_voice_profile_id: ""
  narrator_reference_audio_sha256: ""
  narrator_tts_batch_id: ""
  narration_render_mode: "episode_master_then_slice"
  h3_audio_policy: "dialogue_only; narration_forbidden_in_shot_audio"
  h3_audio_validation_required: true
  audio_render_mode: "separate_narration_master_then_user_editing"
  h3_must_preserve_submitted_audio: true
~~~

dialogue_source_mode 只有两种合法值：输入视频原声，或 H3 片段返回的原声。对白不可用时暂停，不以对白 TTS 兜底。

## 分镜前置音频预算（生成前硬门槛）

旁白窗口不是视频生成后的补丁，而是 Shot 设计的一部分。每个 Shot 在提交视频生成前必须先完成旁白时长估算，并与对白窗口、0.20 秒保护间隔、无口型动作窗口一起锁定。若旁白与对白放不进镜头范围，必须先拆句、移动旁白、拆镜或延长镜头至最多 10 秒；不得先生成对白过满的视频再寻找空间。

每个 Shot 的分镜行必须写出：`audio_order`、`narration_text`、`narration_start_s`、`narration_end_s`、`narration_duration_estimate`、`dialogue_line_text`、`dialogue_start_s`、`dialogue_end_s`、`silent_action_window` 和 `pre_generation_window_check`。旁白窗口对应动作 / 反应 / 空镜，人物口型只在对白窗口中出现。

## 每镜必填字段

| 字段 | 说明 |
|---|---|
| shot_id | 镜头编号 |
| global_start_s / global_end_s | 镜头在成片中的全局范围 |
| dialogue_source_file | 原声来源文件（mp4/wav） |
| dialogue_source_hash | 原声文件 SHA-256 |
| h3_full_audio_file / h3_full_audio_hash | H3 返回的完整音轨及哈希，必须归档用于排查额外旁白 |
| dialogue_stem_file / dialogue_stem_hash | 若 H3 提供独立对白 stem，记录其路径和哈希；否则填 null |
| speaker / line_text | 说话人和转写文本 |
| dialogue_start_s / dialogue_end_s | 对白在本镜内的真实起止；无对白填 null |
| narration_file | 旁白切片文件；无旁白填 null |
| narration_start_s / narration_end_s | 旁白在本镜内的真实起止；无旁白填 null |
| narration_duration_estimate | 视频生成前依据锁定音色和语速估算的旁白时长 |
| audio_order | narration_first / dialogue_first / narration_only / dialogue_only |
| silent_action_window | 旁白期间的无口型动作、反应或空镜区间 |
| pre_generation_window_check | 视频生成前的旁白 / 对白窗口可行性检查结果 |
| narrator_voice_id | 必须等于项目锁定值 |
| narrator_voice_profile_id / narrator_reference_audio_sha256 | 必须等于项目锁定值，用于发现音色漂移 |
| narrator_tts_batch_id | 母轨或统一 TTS 批次标识；逐镜独立 session 不合格 |
| script_line_id / source_text / source_text_hash | 旁白必须引用已批准脚本行；音频、字幕和 prompt 必须逐字一致 |
| unsolicited_speech_check | `pass` 仅表示完整 H3 音轨中除预期对白外没有额外语音 |
| unsolicited_speech_segments | 额外旁白 / 评论 / 描述性语音的 ASR 区间；无则为空数组 |
| expected_speech_segments | 预期对白和（直出模式下）已提交的旁白区间；额外语音只与此集合之外的片段比较 |
| submitted_audio_bed_file / submitted_audio_bed_hash | 直出模式提交给 H3 的预锁定音频床及哈希；不支持时填 null |
| returned_audio_hash / audio_preservation_check | H3 返回音频哈希及原样保留结果；不一致则 fail |
| audio_gap_s | 两种语音之间的实际间隔 |
| overlap_check | 只能是 pass 或 fail |

## 时间约束

同一镜头内必须满足：

~~~text
narration_end_s + 0.20 <= dialogue_start_s
或
dialogue_end_s + 0.20 <= narration_start_s
~~~

跨镜头时，先用 global_start_s 加上镜内 start/end 换算到全局时间，再排序。任意相邻语音区间必须满足：

~~~text
next.start_global_s - current.end_global_s >= minimum_speech_gap_s
~~~

语音区间不得超出所属镜头范围。BGM / 环境声 / 音效可以与语音同在，但需 duck；这不改变语音区间校验。

## 可执行校验伪代码

~~~python
def validate_voice_windows(rows, min_gap=0.20):
    windows = []
    for row in rows:
        shot_len = row["global_end_s"] - row["global_start_s"]
        for kind in ("narration", "dialogue"):
            start = row.get(f"{kind}_start_s")
            end = row.get(f"{kind}_end_s")
            if start is None or end is None:
                continue
            assert start < end, f"{row['shot_id']} {kind}: invalid interval"
            assert 0 <= start < end <= shot_len
            windows.append((row["global_start_s"] + start,
                            row["global_start_s"] + end,
                            kind, row["shot_id"]))
    windows.sort()
    for current, following in zip(windows, windows[1:]):
        if following[0] - current[1] < min_gap:
            raise ValueError(f"speech overlap/gap failure: {current} -> {following}")
    return "pass"
~~~

实际实现时必须保留镜内和全局两套字段，禁止混用。成片导出后须用最终文件再次测量并运行同一校验。

## 冲突修复顺序

1. 改写或拆句；
2. 移到下一个可用空档；
3. 拆镜；
4. 延长镜头（单镜最长 10s）；
5. 重新生成旁白并重新校验。

不得通过加速、截断、交叉淡化、压低一条语音或静音来伪造通过。对白原声轨始终保留原始内容。

## 原声取证命令示例

输入视频的原声抽取（不改写输入文件）：

~~~bash
ffmpeg -i input.mp4 -map 0:a:0 -c:a pcm_s24le audio/input_dialogue_original.wav
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 audio/input_dialogue_original.wav
~~~

H3 片段同样先归档 mp4，再从归档副本抽取 wav；旁白生成并完成 validate_voice_windows 后，将时间线与音频文件交接给用户自行剪辑。本 Skill 不执行最终成片导出后的 QC。
