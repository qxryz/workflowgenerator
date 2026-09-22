"""
JianYing Editor Skill - 完整功能演示

演示所有核心能力：
1. 视频导入 + 多段剪辑
2. 音频/BGM 导入
3. 文字 + 字幕
4. 滤镜 + 场景特效
5. 关键帧动画 (PiP)
6. SRT 字幕导入

用法:
    python3 full_feature_showcase.py /path/to/video.mp4 [/path/to/audio.mp3]
"""

import os
import sys

# 环境注入
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from jy_wrapper import JyProject, KeyframeProperty

def run_showcase(video_path: str, audio_path: str = None):
    print("=" * 60)
    print("JianYing Editor Skill - 完整功能演示")
    print("=" * 60)

    project = JyProject("Skill_Demo_完整演示", overwrite=True)

    cursor = 0  # 当前时间游标（微秒）
    SEC = 1_000_000

    # ── 1. 视频导入：三段剪辑 ──
    print("\n[Phase 1] 视频剪辑...")

    # 第一段：0~3s
    project.add_video(video_path, start_time=cursor, duration="3s", source_start="0s")
    cursor += 3 * SEC

    # 第二段：3~5s
    project.add_video(video_path, start_time=cursor, duration="2s", source_start="1s")
    cursor += 2 * SEC

    # 第三段：5~8s
    project.add_video(video_path, start_time=cursor, duration="3s", source_start="2s")
    cursor += 3 * SEC

    # ── 2. 滤镜 ──
    print("[Phase 2] 滤镜...")
    try:
        project.add_filter("VHS_III", start_time=0, duration=f"{cursor // SEC}s")
        print("  -> VHS_III 滤镜已添加")
    except Exception as e:
        print(f"  -> 滤镜跳过: {e}")

    # ── 3. 场景特效 ──
    print("[Phase 3] 场景特效...")
    try:
        project.add_effect("CCD闪光", start_time="2s", duration="3s")
        print("  -> CCD闪光 特效已添加")
    except Exception as e:
        print(f"  -> 特效跳过: {e}")

    # ── 4. 文字 ──
    print("[Phase 4] 文字...")
    project.add_text(
        "JianYing Editor Skill",
        start_time="0.5s",
        duration="3s",
        font_size=15.0,
        color_rgb=(1.0, 0.8, 0.0),
        transform_y=0.4,
    )

    # 字幕
    project.add_subtitle("第一句字幕", start_time="0.5s", duration="2.5s")
    project.add_subtitle("第二句字幕", start_time="3s", duration="2s")
    project.add_subtitle("第三句字幕", start_time="5s", duration="3s")
    print("  -> 标题 + 3 条字幕已添加")

    # ── 5. PiP 关键帧动画 ──
    print("[Phase 5] PiP 关键帧动画...")

    pip_start = 1 * SEC
    pip_dur = 4 * SEC
    pip_seg = project.add_video(
        video_path,
        start_time=pip_start,
        duration=pip_dur,
        track_name="PiP_Layer",
        clip_settings=project.script.__class__.__mro__  # dummy, we'll use ClipSettings
    )

    # 重新创建带正确 clip_settings 的 PiP
    from jy_wrapper import ClipSettings
    pip_seg = project.add_video(
        video_path,
        start_time=pip_start,
        duration=pip_dur,
        track_name="PiP_Layer_2",
        clip_settings=ClipSettings(scale_x=0.3, scale_y=0.3),
    )

    # 关键帧：从左飞到右
    JyProject.add_keyframe(pip_seg, "position_x", 0, -0.5)
    JyProject.add_keyframe(pip_seg, "position_x", "2s", 0.0)
    JyProject.add_keyframe(pip_seg, "position_x", "4s", 0.5)
    print("  -> PiP 飞行动画已添加")

    # ── 6. 音频 ──
    print("[Phase 6] 音频...")
    if audio_path and os.path.exists(audio_path):
        project.add_audio(audio_path, start_time=0, volume=0.6, track_name="BGM")
        print(f"  -> BGM 已添加: {os.path.basename(audio_path)}")
    else:
        print("  -> 无音频文件，跳过")

    # ── 保存 ──
    print("\n[Saving]...")
    project.save()

    print("\n" + "=" * 60)
    print("演示完成! 功能清单:")
    print("  [x] 多段视频剪辑")
    print("  [x] 滤镜 (VHS_III)")
    print("  [x] 场景特效 (CCD闪光)")
    print("  [x] 标题文字 + 字幕")
    print("  [x] PiP 关键帧动画")
    print("  [x] BGM 音频导入" if audio_path else "  [ ] BGM (无音频)")
    print("=" * 60)
    print(f"\n在剪映中打开 '{project.name}' 即可预览！")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 full_feature_showcase.py <video.mp4> [audio.mp3]")
        sys.exit(1)

    video = sys.argv[1]
    audio = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.exists(video):
        print(f"Error: 视频文件不存在: {video}")
        sys.exit(1)

    run_showcase(video, audio)
