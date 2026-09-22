# 分镜字段模板 v2.0

每镜只承担一个主要信息 / 情绪任务。以下字段为必填；音频时间码以 references/audio-timeline.md 为准。

~~~yaml
shot_id: "03"
script_line_ids: ["S03-N02"]
source_text_hashes: ["sha256:..."]
beat_role: "压力"
duration_s: 6.0
scene: "室内-客厅"
characters: ["主角", "对手"]
blocking: "主角在画面左侧，对手从右侧入画"
spatial_layout:
  axis_180: "主角 -> 对手，屏幕左至右"
  protagonist: {screen: "left", depth: "midground", facing: "right", eyeline: "对手"}
  opponent: {screen: "right", depth: "midground", facing: "left", eyeline: "主角"}
  entry_exit: "对手从右侧入画，主角不换边"
first_frame_source: "clips/shot_02_last.png"
referenced_asset_ids: ["char_protagonist", "scene_living_room", "prop_phone"]
asset_bindings:
  protagonist: "char_protagonist"
  opponent: "char_opponent"
  scene: "scene_living_room"
  phone: "prop_phone"
backend: "the platform’s currently available video capability"
generation_mode: "platform-supported reference mode"
resolution: "<user-selected-768P-or-2K>"
reset_anchor: false
start_state: "主角握住手机，尚未抬头"
action_progression: "对手停步，主角抬眼"
end_state_handoff: "手机屏幕朝向对手，下一镜接反打"
narration:
  script_line_id: "S03-N02"
  text: "我知道她来这里不是为了道歉。"
  source_text_hash: "sha256:..."
  start_s: 0.0
  end_s: 2.1
dialogue:
  script_line_id: "S03-D01"
  source: "video_original"
  source_file: "clips/shot_03.mp4"
  speaker: "对手"
  line_text: "你还要装到什么时候？"
  source_text_hash: "sha256:..."
  start_s: 2.35
  end_s: 3.80
audio_gap_s: 0.25
style_block: "2D cel-shaded animation, Chinese-animation webtoon style, clean bold black outlines, flat color fills with cel highlights, no 3D, no photoreal, no live-action, no watermark, no baked-in text"
~~~

规则：对白 source 只能是 video_original；无对白 / 无旁白时对应对象填 null。对白镜头保证说话者口型和视线清晰，旁白窗口优先使用反应、空镜或动作镜头。每镜必须声明空间站位与资产绑定；如使用首帧 / 末帧参考，再声明其来源和结束状态交接。`script_line_id`、原文和源文本哈希必须与批准脚本清单一致。
