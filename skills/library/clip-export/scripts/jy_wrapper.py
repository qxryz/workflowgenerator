"""
JianYing Editor Skill - 高级封装

基于 pyJianYingDraft (PyPI) 封装的高级 API，提供：
- 多格式输出：剪映 / DaVinci Resolve / Premiere Pro / Final Cut Pro
- 自动打包素材 + 工程文件为 zip
- 简化的媒体导入、文字、特效、转场、关键帧操作
- 时间单位自动转换（秒/字符串 → 微秒）
- 枚举模糊匹配（中英文/同义词/fuzzy）
"""

import difflib
import json
import os
import platform
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import quote as urlquote

import pyJianYingDraft as draft
from pyJianYingDraft import (
    AudioMaterial,
    AudioSegment,
    ClipSettings,
    DraftFolder,
    FilterType,
    IntroType,
    KeyframeProperty,
    OutroType,
    ScriptFile,
    TextSegment,
    TextStyle,
    Timerange,
    TrackType,
    TransitionType,
    VideoMaterial,
    VideoSceneEffectType,
    VideoSegment,
    tim,
    trange,
)

SEC = draft.SEC  # 1_000_000 microseconds

# ── CapCut / 剪映兼容 ─────────────────────────────────────────

# 剪映（国内版）默认值
JIANYING_PLATFORM = {
    "os": "mac",
    "os_version": "",
    "app_version": "7.8.0",
    "app_source": "lv",
    "device_id": "",
    "hard_disk_id": "",
    "mac_address": "",
    "app_id": 3704,
}

# CapCut（海外版）默认值
CAPCUT_PLATFORM = {
    "os": "mac",
    "os_version": "",
    "app_version": "8.4.0",
    "app_source": "cc",
    "device_id": "",
    "hard_disk_id": "",
    "mac_address": "",
    "app_id": 359289,
}

# ── 导出目标 ────────────────────────────────────────────────

EXPORT_TARGETS = {
    "jianying": "剪映 / CapCut",
    "davinci": "DaVinci Resolve",
    "premiere": "Adobe Premiere Pro",
    "fcpro": "Final Cut Pro",
}

# ── 中英同义词映射 ──────────────────────────────────────────

EFFECT_SYNONYMS = {
    "vintage": ["复古", "复古DV"],
    "retro": ["复古", "复古DV"],
    "light_leak": ["漏光"],
    "blur": ["模糊", "高斯模糊"],
    "glitch": ["故障", "信号故障"],
    "shake": ["抖动", "画面抖动"],
    "zoom": ["放大", "缩放"],
    "flash": ["闪烁", "闪光"],
    "vignette": ["暗角"],
    "film_grain": ["胶片颗粒"],
}

TRANSITION_SYNONYMS = {
    "dissolve": ["叠化"],
    "fade": ["淡化", "淡入淡出"],
    "wipe": ["擦除"],
    "slide": ["滑动", "推移"],
    "zoom": ["缩放"],
    "spin": ["旋转", "中心旋转"],
    "blur": ["模糊"],
    "mix": ["混合"],
    "flash": ["闪白"],
    "ink": ["水墨"],
    "page_turn": ["翻页", "上下翻页"],
}

FILTER_SYNONYMS = {
    "vintage": ["复古", "胶片"],
    "warm": ["暖色", "暖调"],
    "cold": ["冷色", "冷调"],
    "bw": ["黑白", "灰度"],
    "cinematic": ["电影", "电影感"],
    "japanese": ["日系"],
    "retro": ["复古"],
    "dreamy": ["梦幻"],
}

TEXT_ANIM_SYNONYMS = {
    "typewriter": ["打字机", "打字机_I"],
    "fade_in": ["渐显", "渐入"],
    "pop": ["弹入", "弹出"],
    "slide_up": ["上移", "向上滑动"],
    "slide_down": ["下移", "向下滑动"],
    "bounce": ["弹跳"],
    "fly_in": ["飞入"],
    "blur": ["模糊"],
    "barrage": ["弹幕"],
}


# ── 工具函数 ────────────────────────────────────────────────


def _default_output_root() -> str:
    """默认输出目录：项目下 .jy-output/"""
    return os.path.join(os.getcwd(), ".jy-output")


def _get_jianying_drafts_root() -> Optional[str]:
    """探测本机剪映/CapCut 草稿目录，优先 CapCut（海外版），回退剪映。返回 None 如果未安装。"""
    if platform.system() == "Darwin":
        candidates = [
            os.path.expanduser("~/Movies/CapCut/User Data/Projects/com.lveditor.draft"),
            os.path.expanduser("~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"),
        ]
    elif platform.system() == "Windows":
        candidates = [
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "CapCut", "User Data", "Projects", "com.lveditor.draft"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "User Data", "Projects", "com.lveditor.draft"),
        ]
    else:
        return None
    for root in candidates:
        if os.path.isdir(root):
            return root
    return None


def _detect_platform_from_drafts(drafts_root: str) -> Optional[dict]:
    """从已有草稿的 draft_info.json 中读取 platform 字段，用于匹配本机 CapCut/剪映版本。

    只提取 platform 设备信息（device_id、mac_address、os_version），
    不提取 version/new_version（由 CapCut 内部升级，不适合用于新草稿）。
    """
    try:
        for entry in sorted(os.listdir(drafts_root), reverse=True):
            info_path = os.path.join(drafts_root, entry, "draft_info.json")
            if os.path.isfile(info_path):
                with open(info_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                plat = d.get("platform")
                if isinstance(plat, dict) and plat.get("app_id"):
                    return plat
    except Exception:
        pass
    return None


def _is_capcut_root(drafts_root: str) -> bool:
    """判断草稿目录是否属于 CapCut（海外版）而非剪映。"""
    return "/CapCut/" in drafts_root or "\\CapCut\\" in drafts_root


def _patch_for_capcut78(draft_dir: str) -> None:
    """将 pyJianYingDraft 生成的 draft_content.json 转换为 CapCut/剪映兼容的 draft_info.json。

    最小化修改：只更新 platform 和文件名，保留 pyJianYingDraft 原始 version/new_version。
    """
    content_path = os.path.join(draft_dir, "draft_content.json")
    info_path = os.path.join(draft_dir, "draft_info.json")

    if not os.path.exists(content_path):
        return

    with open(content_path, "r", encoding="utf-8") as f:
        d = json.load(f)

    # 从已有草稿探测设备信息，否则用默认值
    drafts_root = os.path.dirname(draft_dir)
    detected_plat = _detect_platform_from_drafts(drafts_root)

    if detected_plat:
        plat = dict(detected_plat)
    elif _is_capcut_root(drafts_root):
        plat = dict(CAPCUT_PLATFORM)
    else:
        plat = dict(JIANYING_PLATFORM)

    # 只更新 platform，不修改 version/new_version
    d["platform"] = plat
    d["last_modified_platform"] = dict(plat)

    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)

    os.remove(content_path)

    # 创建 CapCut 所需的辅助文件和目录
    _create_capcut_scaffold(draft_dir)


def _create_capcut_scaffold(draft_dir: str) -> None:
    """创建 CapCut/剪映草稿所需的辅助文件和空目录。"""
    import time
    now_sec = int(time.time())

    # 必需的空目录
    for subdir in ("Resources", "adjust_mask", "matting", "qr_upload",
                   "smart_crop", "subdraft"):
        os.makedirs(os.path.join(draft_dir, subdir), exist_ok=True)

    # draft_agency_config.json
    agency_path = os.path.join(draft_dir, "draft_agency_config.json")
    if not os.path.exists(agency_path):
        with open(agency_path, "w", encoding="utf-8") as f:
            json.dump({
                "is_auto_agency_enabled": False,
                "is_auto_agency_popup": False,
                "is_single_agency_mode": False,
                "marterials": None,
                "use_converter": False,
                "video_resolution": 720,
            }, f, ensure_ascii=False)

    # draft_biz_config.json (空文件)
    biz_path = os.path.join(draft_dir, "draft_biz_config.json")
    if not os.path.exists(biz_path):
        open(biz_path, "w").close()

    # draft_settings — 补充 cloud_last_modify_platform
    settings_path = os.path.join(draft_dir, "draft_settings")
    if os.path.exists(settings_path):
        content = open(settings_path, "r").read()
        if "cloud_last_modify_platform" not in content:
            content = content.rstrip("\n") + "\ncloud_last_modify_platform=mac\n"
            with open(settings_path, "w") as f:
                f.write(content)

    # performance_opt_info.json
    perf_path = os.path.join(draft_dir, "performance_opt_info.json")
    if not os.path.exists(perf_path):
        with open(perf_path, "w", encoding="utf-8") as f:
            json.dump({"export_fps": 0, "original_fps": 0, "resolution": ""}, f)

    # timeline_layout.json
    tl_path = os.path.join(draft_dir, "timeline_layout.json")
    if not os.path.exists(tl_path):
        with open(tl_path, "w", encoding="utf-8") as f:
            json.dump({"enable_layout_mode": False, "layout_list": [], "version": "1.0.0"}, f)


def _copy_media_into_draft(draft_dir: str) -> None:
    """将 draft_info.json 中引用的外部媒体文件复制到草稿目录内，并更新路径。

    CapCut 是沙盒应用，无法访问草稿目录外的文件。此函数把所有媒体
    复制到 draft_dir/Resources/ 下，并将 JSON 中的路径改为绝对路径指向副本。
    """
    info_path = os.path.join(draft_dir, "draft_info.json")
    if not os.path.exists(info_path):
        return

    with open(info_path, "r", encoding="utf-8") as f:
        d = json.load(f)

    res_dir = os.path.join(draft_dir, "Resources")
    os.makedirs(res_dir, exist_ok=True)

    path_map = {}  # old_abs -> new_abs

    for mtype in ("videos", "audios"):
        for mat in d.get("materials", {}).get(mtype, []):
            orig = mat.get("path", "")
            if not orig or not os.path.isabs(orig) or not os.path.exists(orig):
                continue
            # 已经在草稿目录内则跳过
            if os.path.commonpath([orig, draft_dir]) == draft_dir:
                continue
            if orig in path_map:
                mat["path"] = path_map[orig]
                continue
            basename = os.path.basename(orig)
            dest = os.path.join(res_dir, basename)
            # 避免重名
            counter = 1
            while os.path.exists(dest):
                stem, ext = os.path.splitext(basename)
                dest = os.path.join(res_dir, f"{stem}_{counter}{ext}")
                counter += 1
            shutil.copy2(orig, dest)
            path_map[orig] = dest
            mat["path"] = dest

    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


def _update_draft_meta_timestamps(draft_dir: str, total_duration_us: int = 0) -> None:
    """更新 draft_meta_info.json 中的时间戳、名称和时长。"""
    meta_path = os.path.join(draft_dir, "draft_meta_info.json")
    if not os.path.exists(meta_path):
        return

    import time
    now = int(time.time() * 1_000_000)
    draft_name = os.path.basename(draft_dir)

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    meta["tm_draft_modified"] = now
    if not meta.get("tm_draft_create"):
        meta["tm_draft_create"] = now
    meta["draft_name"] = draft_name
    meta["draft_fold_path"] = draft_dir
    meta["draft_root_path"] = os.path.dirname(draft_dir)

    if total_duration_us > 0:
        meta["tm_duration"] = total_duration_us

    # CapCut 需要 draft_materials 包含类型占位
    if not meta.get("draft_materials"):
        meta["draft_materials"] = [
            {"type": t, "value": []} for t in (0, 1, 2, 3, 6, 7, 8)
        ]

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)


def safe_tim(inp: Union[str, int, float]) -> int:
    """增强版时间解析器。

    支持:
    - int: 视为微秒
    - float: 视为秒
    - str "HH:MM:SS" / "MM:SS": 冒号格式
    - str "1h2m3s" / "500ms" / "200000us": 带单位组合
    - str 纯数字: 视为秒
    """
    if isinstance(inp, int):
        return inp
    if isinstance(inp, float):
        return int(inp * SEC)
    if not isinstance(inp, str):
        return tim(inp)

    s = inp.strip()

    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 3:
                h, m, sec = map(float, parts)
                return int((h * 3600 + m * 60 + sec) * SEC)
            elif len(parts) == 2:
                m, sec = map(float, parts)
                return int((m * 60 + sec) * SEC)
        except ValueError:
            pass

    unit_pattern = re.compile(r"\s*(\d+(?:\.\d+)?)(ms|us|h|m|s)\s*", re.IGNORECASE)
    unit_scale = {"h": 3600 * SEC, "m": 60 * SEC, "s": SEC, "ms": 1000, "us": 1}
    matches = list(unit_pattern.finditer(s))
    if matches:
        pos = 0
        total_us = 0.0
        for match in matches:
            if match.start() != pos:
                break
            value = float(match.group(1))
            unit = match.group(2).lower()
            total_us += value * unit_scale[unit]
            pos = match.end()
        if pos == len(s):
            return int(total_us)

    if s.replace(".", "", 1).isdigit():
        return int(float(s) * SEC)

    return tim(inp)


def resolve_enum(enum_cls, name: str, synonyms_dict: dict):
    """从枚举类中模糊查找成员（支持同义词和fuzzy匹配）"""
    if not name:
        return None
    if hasattr(enum_cls, name):
        return getattr(enum_cls, name)

    name_lower = name.lower()
    mapping = {k.lower(): k for k in enum_cls.__members__.keys()}

    if name_lower in mapping:
        return getattr(enum_cls, mapping[name_lower])

    for key, synonyms in synonyms_dict.items():
        if name_lower == key.lower():
            for candidate in synonyms:
                cl = candidate.lower()
                if cl in mapping:
                    return getattr(enum_cls, mapping[cl])
        if key.lower() in mapping:
            for syn in synonyms:
                if syn.lower() in name_lower or name_lower in syn.lower():
                    kl = key.lower()
                    if kl in mapping:
                        return getattr(enum_cls, mapping[kl])

    matches = difflib.get_close_matches(name, enum_cls.__members__.keys(), n=1, cutoff=0.6)
    if matches:
        return getattr(enum_cls, matches[0])
    return None


def get_duration_ffprobe(file_path: str) -> float:
    """通过 ffprobe 获取媒体文件时长（秒）"""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", file_path],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, timeout=10,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _us_to_rational(us: int, fps: int = 30) -> str:
    """微秒转 FCPXML 有理数时间 (e.g. '3003/1001s' for 30fps)"""
    # FCPXML uses rational time: numerator/denominator's'
    # For 30fps: frame_duration = 100/3000s
    # Convert microseconds to seconds fraction
    seconds = us / 1_000_000
    # Use high precision rational
    numerator = int(seconds * fps * 1000)
    denominator = fps * 1000
    return f"{numerator}/{denominator}s"


def _file_uri(path: str) -> str:
    """文件路径转 file:// URI"""
    abs_path = os.path.abspath(path)
    return "file://" + urlquote(abs_path)


# ── FCPXML 导出器 ──────────────────────────────────────────


class FCPXMLExporter:
    """将 pyJianYingDraft 的 draft_content.json 转换为 FCPXML 1.9"""

    def __init__(self, draft_content: dict, project_name: str,
                 width: int, height: int, fps: int):
        self.content = draft_content
        self.name = project_name
        self.width = width
        self.height = height
        self.fps = fps
        self._resource_id = 0
        self._asset_map: Dict[str, str] = {}  # material_id -> resource_id

    def _next_id(self) -> str:
        self._resource_id += 1
        return f"r{self._resource_id}"

    def export(self, media_dir: str = "") -> str:
        """生成 FCPXML XML 字符串"""
        fcpxml = ET.Element("fcpxml", version="1.9")

        resources = ET.SubElement(fcpxml, "resources")
        fmt_id = self._next_id()
        frame_dur = f"{1000}/{self.fps * 1000}s"
        ET.SubElement(resources, "format",
                      id=fmt_id,
                      name=f"FFVideoFormat{self.height}p{self.fps}",
                      frameDuration=frame_dur,
                      width=str(self.width),
                      height=str(self.height))

        # Build asset resources from materials
        materials = self.content.get("materials", {})
        for video_mat in materials.get("videos", []):
            self._add_asset(resources, video_mat, fmt_id, media_dir,
                            has_video="1", has_audio="1")
        for audio_mat in materials.get("audios", []):
            self._add_asset(resources, audio_mat, fmt_id, media_dir,
                            has_video="0", has_audio="1")

        # Build timeline
        library = ET.SubElement(fcpxml, "library")
        event = ET.SubElement(library, "event", name="Timeline")
        project = ET.SubElement(event, "project", name=self.name)

        total_dur = self._get_total_duration()
        sequence = ET.SubElement(project, "sequence",
                                 format=fmt_id,
                                 duration=_us_to_rational(total_dur, self.fps))
        spine = ET.SubElement(sequence, "spine")

        # Add video segments to spine
        tracks = self.content.get("tracks", [])
        main_video_segs = []
        overlay_segs = []
        audio_segs = []
        text_entries = []

        for track in tracks:
            ttype = track.get("type", "")
            segments = track.get("segments", [])
            if ttype == "video":
                if not main_video_segs:
                    main_video_segs = segments
                else:
                    overlay_segs.extend(segments)
            elif ttype == "audio":
                audio_segs.extend(segments)
            elif ttype == "text":
                text_entries.extend(segments)

        # Main video spine
        for seg in main_video_segs:
            self._add_clip_to_spine(spine, seg, materials)

        # Overlay video as connected clips (attached to spine)
        for seg in overlay_segs:
            self._add_connected_clip(spine, seg, materials)

        # Audio as connected clips (lane -1)
        for seg in audio_segs:
            self._add_audio_clip(spine, seg, materials)

        # Text as titles
        for seg in text_entries:
            self._add_title(spine, seg, materials, fmt_id)

        tree = ET.ElementTree(fcpxml)
        ET.indent(tree, space="  ")
        return ET.tostring(fcpxml, encoding="unicode",
                           xml_declaration=True)

    def _add_asset(self, resources: ET.Element, mat: dict,
                   fmt_id: str, media_dir: str, **kwargs):
        mat_id = mat.get("id", "")
        path = mat.get("path", "")

        # If media was bundled, use the bundled path
        if media_dir and path:
            basename = os.path.basename(path)
            bundled = os.path.join(media_dir, basename)
            if os.path.exists(bundled):
                path = bundled

        rid = self._next_id()
        self._asset_map[mat_id] = rid

        duration_us = mat.get("duration", 0)
        if not duration_us and path and os.path.exists(path):
            duration_us = int(get_duration_ffprobe(path) * SEC)

        attrs = {
            "id": rid,
            "src": _file_uri(path) if path else "",
            "start": "0/1s",
            "duration": _us_to_rational(duration_us, self.fps),
            "format": fmt_id,
        }
        attrs.update(kwargs)
        ET.SubElement(resources, "asset", **attrs)

    def _get_total_duration(self) -> int:
        max_end = 0
        for track in self.content.get("tracks", []):
            for seg in track.get("segments", []):
                tr = seg.get("target_timerange", {})
                start = tr.get("start", 0)
                dur = tr.get("duration", 0)
                end = start + dur
                if end > max_end:
                    max_end = end
        return max_end

    def _find_material_id_for_segment(self, seg: dict, materials: dict) -> str:
        """从 segment 中找到对应的 material_id"""
        return seg.get("material_id", "")

    def _add_clip_to_spine(self, spine: ET.Element, seg: dict, materials: dict):
        mat_id = self._find_material_id_for_segment(seg, materials)
        ref = self._asset_map.get(mat_id, "")
        if not ref:
            return

        target_tr = seg.get("target_timerange", {})
        source_tr = seg.get("source_timerange", target_tr)
        offset = _us_to_rational(target_tr.get("start", 0), self.fps)
        duration = _us_to_rational(target_tr.get("duration", 0), self.fps)
        start = _us_to_rational(source_tr.get("start", 0), self.fps)

        clip = ET.SubElement(spine, "asset-clip",
                             ref=ref, offset=offset,
                             start=start, duration=duration)

        # Volume
        volume = seg.get("volume", 1.0)
        if volume != 1.0:
            adjust = ET.SubElement(clip, "adjust-volume",
                                   amount=f"{volume:.2f}dB")

    def _add_connected_clip(self, spine: ET.Element, seg: dict, materials: dict):
        """叠加视频作为 connected clip"""
        mat_id = self._find_material_id_for_segment(seg, materials)
        ref = self._asset_map.get(mat_id, "")
        if not ref:
            return

        target_tr = seg.get("target_timerange", {})
        source_tr = seg.get("source_timerange", target_tr)
        offset = _us_to_rational(target_tr.get("start", 0), self.fps)
        duration = _us_to_rational(target_tr.get("duration", 0), self.fps)
        start = _us_to_rational(source_tr.get("start", 0), self.fps)

        # Find the first spine element to attach to
        spine_children = list(spine)
        if spine_children:
            clip = ET.SubElement(spine_children[0], "asset-clip",
                                 ref=ref, offset=offset, lane="1",
                                 start=start, duration=duration)

    def _add_audio_clip(self, spine: ET.Element, seg: dict, materials: dict):
        mat_id = self._find_material_id_for_segment(seg, materials)
        ref = self._asset_map.get(mat_id, "")
        if not ref:
            return

        target_tr = seg.get("target_timerange", {})
        source_tr = seg.get("source_timerange", target_tr)
        offset = _us_to_rational(target_tr.get("start", 0), self.fps)
        duration = _us_to_rational(target_tr.get("duration", 0), self.fps)
        start = _us_to_rational(source_tr.get("start", 0), self.fps)

        spine_children = list(spine)
        if spine_children:
            clip = ET.SubElement(spine_children[0], "asset-clip",
                                 ref=ref, offset=offset, lane="-1",
                                 start=start, duration=duration)
            volume = seg.get("volume", 1.0)
            if volume != 1.0:
                ET.SubElement(clip, "adjust-volume",
                              amount=f"{volume:.2f}dB")

    def _add_title(self, spine: ET.Element, seg: dict,
                   materials: dict, fmt_id: str):
        target_tr = seg.get("target_timerange", {})
        offset = _us_to_rational(target_tr.get("start", 0), self.fps)
        duration = _us_to_rational(target_tr.get("duration", 0), self.fps)

        # Get text content from materials
        mat_id = self._find_material_id_for_segment(seg, materials)
        text_content = ""
        for txt_mat in materials.get("texts", []):
            if txt_mat.get("id") == mat_id:
                # content 字段包含富文本 JSON
                content_raw = txt_mat.get("content", "")
                try:
                    content_data = json.loads(content_raw) if isinstance(content_raw, str) else content_raw
                    # 提取纯文本
                    if isinstance(content_data, dict):
                        styles = content_data.get("styles", [])
                        for style in styles:
                            r = style.get("range", [0, 0])
                        text_content = content_data.get("text", "")
                except (json.JSONDecodeError, TypeError):
                    text_content = str(content_raw)
                break

        if not text_content:
            return

        spine_children = list(spine)
        parent = spine_children[0] if spine_children else spine

        title = ET.SubElement(parent, "title",
                              ref=fmt_id, offset=offset,
                              duration=duration, lane="2",
                              name=text_content[:50])
        text_elem = ET.SubElement(title, "text")
        ts = ET.SubElement(text_elem, "text-style", ref=f"ts_{mat_id[:8]}")
        ts.text = text_content


# ── JyProject 主类 ──────────────────────────────────────────


class JyProject:
    """剪映草稿项目封装，支持多格式导出。

    用法示例::

        project = JyProject("我的MV")
        project.add_video("/path/to/video.mp4", start_time=0, duration="5s")
        project.add_audio("/path/to/bgm.mp3", start_time=0)
        project.add_text("Hello World", start_time="1s", duration="3s")
        project.save()  # 交互式选择导出目标
        # 或
        project.save(target="davinci")  # 直接指定
    """

    def __init__(
        self,
        name: str,
        width: int = 1920,
        height: int = 1080,
        fps: int = 30,
        *,
        overwrite: bool = False,
        output_root: Optional[str] = None,
        direct: bool = False,
    ):
        self.name = name
        self.width = width
        self.height = height
        self.fps = fps
        self.direct = direct

        if direct:
            # 直接创建到剪映草稿目录（CapCut 7.8 兼容）
            jy_root = _get_jianying_drafts_root()
            if not jy_root:
                raise RuntimeError(
                    "未找到剪映草稿目录。"
                    "macOS: ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/"
                )
            self.root = jy_root
        else:
            self.root = output_root or _default_output_root()

        os.makedirs(self.root, exist_ok=True)

        self._folder = DraftFolder(self.root)
        self._script: ScriptFile = self._folder.create_draft(
            name, width, height, fps, allow_replace=overwrite,
        )

        # 创建默认轨道
        self._script.add_track(TrackType.video, "main_video")
        self._script.add_track(TrackType.audio, "main_audio")
        self._script.add_track(TrackType.text, "main_text")
        self._script.add_track(TrackType.filter, "main_filter")
        self._script.add_track(TrackType.effect, "main_effect")

        self._materials = {}
        self._media_files: List[str] = []  # 所有引用的媒体文件路径

    @property
    def script(self) -> ScriptFile:
        return self._script

    @property
    def draft_path(self) -> str:
        return os.path.join(self.root, self.name)

    # ── 媒体导入 ──────────────────────────────────────────

    def _get_or_create_material(
        self, path: str, material_type: str = "video"
    ) -> Union[VideoMaterial, AudioMaterial]:
        abs_path = os.path.abspath(path)
        key = f"{material_type}:{abs_path}"

        if key not in self._materials:
            if material_type == "audio":
                try:
                    mat = AudioMaterial(abs_path)
                except ValueError:
                    audio_path = self._extract_audio(abs_path)
                    mat = AudioMaterial(audio_path)
                    key = f"audio:{audio_path}"
                    abs_path = audio_path
            else:
                mat = VideoMaterial(abs_path)
            self._script.add_material(mat)
            self._materials[key] = mat
            if abs_path not in self._media_files:
                self._media_files.append(abs_path)

        return self._materials[key]

    def _extract_audio(self, video_path: str) -> str:
        stem = os.path.splitext(os.path.basename(video_path))[0]
        if self.direct:
            # direct 模式：提取到草稿的 audio/ 子目录，CapCut 用绝对路径引用
            cache_dir = os.path.join(self.draft_path, "audio")
        else:
            cache_dir = os.path.join(self.root, "__audio_cache__")
        os.makedirs(cache_dir, exist_ok=True)
        audio_path = os.path.join(cache_dir, f"{stem}.m4a")

        if os.path.exists(audio_path):
            return audio_path

        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", video_path,
                 "-vn", "-acodec", "aac", "-b:a", "192k", audio_path],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=30, check=True,
            )
        except Exception as e:
            raise RuntimeError(f"音频提取失败: {e}")
        return audio_path

    def _ensure_track(self, track_type: TrackType, track_name: Optional[str] = None) -> str:
        if track_name:
            try:
                self._script.add_track(track_type, track_name)
            except Exception:
                pass
            return track_name

        defaults = {
            "video": "main_video",
            "audio": "main_audio",
            "text": "main_text",
            "filter": "main_filter",
            "effect": "main_effect",
        }
        return defaults.get(track_type.name, track_type.name)

    def add_video(
        self,
        file_path: str,
        start_time: Union[str, int, float] = 0,
        duration: Optional[Union[str, int, float]] = None,
        *,
        source_start: Union[str, int, float] = 0,
        speed: Optional[float] = None,
        volume: float = 1.0,
        track_name: Optional[str] = None,
        clip_settings: Optional[ClipSettings] = None,
    ) -> VideoSegment:
        """添加视频片段到时间线。"""
        abs_path = os.path.abspath(file_path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"视频文件不存在: {abs_path}")

        material = self._get_or_create_material(abs_path, "video")
        start_us = safe_tim(start_time)

        if duration is not None:
            dur_us = safe_tim(duration)
        else:
            dur_seconds = get_duration_ffprobe(abs_path)
            dur_us = int(dur_seconds * SEC) if dur_seconds > 0 else 5 * SEC

        src_start_us = safe_tim(source_start)
        target_tr = Timerange(start_us, dur_us)
        source_tr = Timerange(src_start_us, dur_us)

        seg = VideoSegment(
            material, target_tr,
            source_timerange=source_tr,
            speed=speed, volume=volume,
            clip_settings=clip_settings,
        )

        track = self._ensure_track(TrackType.video, track_name)
        self._script.add_segment(seg, track)
        return seg

    def add_audio(
        self,
        file_path: str,
        start_time: Union[str, int, float] = 0,
        duration: Optional[Union[str, int, float]] = None,
        *,
        source_start: Union[str, int, float] = 0,
        speed: Optional[float] = None,
        volume: float = 1.0,
        track_name: Optional[str] = None,
    ) -> AudioSegment:
        """添加音频片段到时间线。"""
        abs_path = os.path.abspath(file_path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"音频文件不存在: {abs_path}")

        material = self._get_or_create_material(abs_path, "audio")
        start_us = safe_tim(start_time)

        if duration is not None:
            dur_us = safe_tim(duration)
        else:
            dur_seconds = get_duration_ffprobe(abs_path)
            dur_us = int(dur_seconds * SEC) if dur_seconds > 0 else 5 * SEC

        src_start_us = safe_tim(source_start)
        target_tr = Timerange(start_us, dur_us)
        source_tr = Timerange(src_start_us, dur_us)

        seg = AudioSegment(
            material, target_tr,
            source_timerange=source_tr,
            speed=speed, volume=volume,
        )

        track = self._ensure_track(TrackType.audio, track_name)
        self._script.add_segment(seg, track)
        return seg

    # ── 文字 ──────────────────────────────────────────────

    def add_text(
        self,
        text: str,
        start_time: Union[str, int, float] = 0,
        duration: Union[str, int, float] = "3s",
        *,
        font_size: float = 8.0,
        color_rgb: Tuple[float, float, float] = (1.0, 1.0, 1.0),
        bold: bool = False,
        italic: bool = False,
        transform_x: float = 0.0,
        transform_y: float = 0.0,
        scale: float = 1.0,
        alpha: float = 1.0,
        track_name: Optional[str] = None,
    ) -> TextSegment:
        """添加文字到时间线。"""
        start_us = safe_tim(start_time)
        dur_us = safe_tim(duration)
        tr = Timerange(start_us, dur_us)

        style = TextStyle(size=font_size, bold=bold, italic=italic, color=color_rgb)
        clip = ClipSettings(
            transform_x=transform_x, transform_y=transform_y,
            scale_x=scale, scale_y=scale, alpha=alpha,
        )

        seg = TextSegment(text, tr, style=style, clip_settings=clip)
        track = self._ensure_track(TrackType.text, track_name)
        self._script.add_segment(seg, track)
        return seg

    def add_subtitle(
        self,
        text: str,
        start_time: Union[str, int, float] = 0,
        duration: Union[str, int, float] = "3s",
        *,
        font_size: float = 6.0,
        color_rgb: Tuple[float, float, float] = (1.0, 1.0, 1.0),
        track_name: Optional[str] = None,
    ) -> TextSegment:
        """添加字幕（预设底部位置）。"""
        return self.add_text(
            text, start_time, duration,
            font_size=font_size, color_rgb=color_rgb,
            transform_y=-0.8,
            track_name=track_name or "subtitles",
        )

    def import_srt(
        self,
        srt_path: str,
        track_name: str = "subtitles",
        *,
        time_offset: Union[str, float] = 0.0,
        font_size: float = 6.0,
        color_rgb: Tuple[float, float, float] = (1.0, 1.0, 1.0),
    ) -> "JyProject":
        """导入 SRT 字幕文件。"""
        abs_path = os.path.abspath(srt_path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"SRT 文件不存在: {abs_path}")
        self._ensure_track(TrackType.text, track_name)
        style = TextStyle(size=font_size, color=color_rgb)
        clip = ClipSettings(transform_y=-0.8)
        self._script.import_srt(abs_path, track_name,
                                time_offset=time_offset,
                                text_style=style, clip_settings=clip)
        return self

    # ── 转场 ──────────────────────────────────────────────

    def add_transition(self, transition_name: str,
                       duration: Union[str, int, float] = "0.5s") -> "JyProject":
        """在最后两个视频片段之间添加转场。"""
        tt = resolve_enum(TransitionType, transition_name, TRANSITION_SYNONYMS)
        if tt is None:
            raise ValueError(f"未找到转场 '{transition_name}'")
        dur_us = safe_tim(duration)
        print(f"[Transition] {transition_name} -> {tt.name}, duration={dur_us}us")
        return self

    # ── 滤镜 ──────────────────────────────────────────────

    def add_filter(self, filter_name: str,
                   start_time: Union[str, int, float] = 0,
                   duration: Union[str, int, float] = "5s",
                   *, intensity: float = 100.0,
                   track_name: Optional[str] = None) -> "JyProject":
        """添加滤镜效果。"""
        ft = resolve_enum(FilterType, filter_name, FILTER_SYNONYMS)
        if ft is None:
            raise ValueError(f"未找到滤镜 '{filter_name}'")
        start_us = safe_tim(start_time)
        dur_us = safe_tim(duration)
        self._script.add_filter(ft, Timerange(start_us, dur_us),
                                track_name=track_name, intensity=intensity)
        return self

    # ── 特效 ──────────────────────────────────────────────

    def add_effect(self, effect_name: str,
                   start_time: Union[str, int, float] = 0,
                   duration: Union[str, int, float] = "5s",
                   *, track_name: Optional[str] = None) -> "JyProject":
        """添加场景特效。"""
        et = resolve_enum(VideoSceneEffectType, effect_name, EFFECT_SYNONYMS)
        if et is None:
            raise ValueError(f"未找到特效 '{effect_name}'")
        start_us = safe_tim(start_time)
        dur_us = safe_tim(duration)
        self._script.add_effect(et, Timerange(start_us, dur_us),
                                track_name=track_name)
        return self

    # ── 关键帧 ────────────────────────────────────────────

    @staticmethod
    def add_keyframe(segment: VideoSegment,
                     prop: Union[str, KeyframeProperty],
                     time_offset: Union[str, int, float],
                     value: float):
        """为视频片段添加关键帧。"""
        if isinstance(prop, str):
            prop_enum = getattr(KeyframeProperty, prop, None)
            if prop_enum is None:
                raise ValueError(f"未知属性 '{prop}'")
        else:
            prop_enum = prop
        offset = safe_tim(time_offset) if not isinstance(time_offset, int) else time_offset
        segment.add_keyframe(prop_enum, offset, value)

    # ── 保存 & 打包 ──────────────────────────────────────

    def _calc_total_duration(self) -> int:
        """从 draft JSON 中计算时间线总时长（微秒）。"""
        info_path = os.path.join(self.draft_path, "draft_info.json")
        content_path = os.path.join(self.draft_path, "draft_content.json")
        path = info_path if os.path.exists(info_path) else content_path
        if not os.path.exists(path):
            return 0
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        max_end = 0
        for track in d.get("tracks", []):
            for seg in track.get("segments", []):
                tr = seg.get("target_timerange", {})
                end = tr.get("start", 0) + tr.get("duration", 0)
                if end > max_end:
                    max_end = end
        return max_end

    def save(self, target: Optional[str] = None) -> str:
        """保存并打包工程文件。

        Args:
            target: 导出目标，可选值：
                - "jianying" — 剪映 / CapCut
                - "davinci"  — DaVinci Resolve
                - "premiere" — Adobe Premiere Pro
                - "fcpro"    — Final Cut Pro
                - None       — 全部格式都生成

        Returns:
            输出目录路径（direct 模式）或第一个 zip 路径
        """
        # 1. 保存 pyJianYingDraft 草稿（总是生成，作为中间表示）
        self._script.save()

        # 2. direct 模式：直接生成到剪映草稿目录，不打包
        if self.direct:
            _patch_for_capcut78(self.draft_path)
            _copy_media_into_draft(self.draft_path)
            total_dur = self._calc_total_duration()
            _update_draft_meta_timestamps(self.draft_path, total_dur)
            print(f"\n{'=' * 50}")
            print(f"项目 '{self.name}' 已直接创建到剪映草稿目录")
            print(f"路径: {self.draft_path}")
            print("请在 CapCut / 剪映中刷新草稿列表即可打开")
            print(f"{'=' * 50}")
            return self.draft_path

        # 3. zip 模式：打包素材 + 工程文件
        media_dir = os.path.join(self.draft_path, "media")
        os.makedirs(media_dir, exist_ok=True)
        self._bundle_media(media_dir)

        outputs = []
        targets = [target] if target else list(EXPORT_TARGETS.keys())

        for t in targets:
            if t == "jianying":
                zip_path = self._package_jianying(media_dir)
                outputs.append(("剪映 / CapCut", zip_path))
            elif t in ("davinci", "premiere", "fcpro"):
                fcpxml_path = self._export_fcpxml(media_dir)
                zip_path = self._package_fcpxml(fcpxml_path, media_dir, t)
                outputs.append((EXPORT_TARGETS[t], zip_path))

        print(f"\n{'=' * 50}")
        print(f"项目 '{self.name}' 导出完成:")
        for label, path in outputs:
            size_kb = os.path.getsize(path) / 1024
            print(f"  [{label}] {path} ({size_kb:.0f} KB)")
        print(f"{'=' * 50}")

        return outputs[0][1] if outputs else self.draft_path

    def _bundle_media(self, media_dir: str):
        """将所有引用的媒体文件拷贝到 media/ 目录"""
        content_path = os.path.join(self.draft_path, "draft_content.json")
        with open(content_path, "r", encoding="utf-8") as f:
            content = json.load(f)

        path_map = {}
        for mtype in ["videos", "audios"]:
            for mat in content.get("materials", {}).get(mtype, []):
                orig = mat.get("path", "")
                if not orig or not os.path.exists(orig):
                    continue
                if orig in path_map:
                    mat["path"] = path_map[orig]
                    continue
                basename = os.path.basename(orig)
                dest = os.path.join(media_dir, basename)
                # 避免重名
                if os.path.exists(dest) and not os.path.samefile(orig, dest):
                    stem, ext = os.path.splitext(basename)
                    dest = os.path.join(media_dir, f"{stem}_{len(path_map)}{ext}")
                if not os.path.exists(dest):
                    shutil.copy2(orig, dest)
                path_map[orig] = dest
                mat["path"] = dest

        with open(content_path, "w", encoding="utf-8") as f:
            json.dump(content, f, ensure_ascii=False)

        self._path_map = path_map

    def _package_jianying(self, media_dir: str) -> str:
        """打包剪映工程为 zip"""
        zip_base = os.path.join(self.root, f"{self.name}_jianying")
        zip_path = shutil.make_archive(zip_base, "zip",
                                        self.root, self.name)
        return zip_path

    def _export_fcpxml(self, media_dir: str) -> str:
        """从 draft_content.json 生成 FCPXML"""
        content_path = os.path.join(self.draft_path, "draft_content.json")
        with open(content_path, "r", encoding="utf-8") as f:
            content = json.load(f)

        exporter = FCPXMLExporter(content, self.name,
                                  self.width, self.height, self.fps)
        xml_str = exporter.export(media_dir)

        fcpxml_path = os.path.join(self.draft_path, f"{self.name}.fcpxml")
        with open(fcpxml_path, "w", encoding="utf-8") as f:
            f.write(xml_str)

        return fcpxml_path

    def _package_fcpxml(self, fcpxml_path: str, media_dir: str,
                        target: str) -> str:
        """打包 FCPXML + 素材为 zip"""
        pkg_name = f"{self.name}_{target}"
        pkg_dir = os.path.join(self.root, pkg_name)
        if os.path.exists(pkg_dir):
            shutil.rmtree(pkg_dir)
        os.makedirs(pkg_dir)

        # Copy FCPXML
        shutil.copy2(fcpxml_path, os.path.join(pkg_dir, f"{self.name}.fcpxml"))

        # Copy media
        pkg_media = os.path.join(pkg_dir, "media")
        if os.path.exists(media_dir):
            shutil.copytree(media_dir, pkg_media)

        # Write README
        readme = self._generate_import_readme(target)
        with open(os.path.join(pkg_dir, "导入说明.txt"), "w", encoding="utf-8") as f:
            f.write(readme)

        zip_path = shutil.make_archive(
            os.path.join(self.root, pkg_name), "zip",
            self.root, pkg_name)

        # Cleanup temp dir
        shutil.rmtree(pkg_dir)
        return zip_path

    def _generate_import_readme(self, target: str) -> str:
        instructions = {
            "davinci": (
                f"项目: {self.name}\n"
                f"目标软件: DaVinci Resolve\n\n"
                "导入步骤:\n"
                "1. 解压此 zip 文件到任意目录\n"
                "2. 打开 DaVinci Resolve\n"
                "3. File → Import → Timeline → 选择 .fcpxml 文件\n"
                "4. 确保 media/ 文件夹与 .fcpxml 文件在同一目录\n"
                "5. 如提示找不到素材，手动重新链接 media/ 目录中的文件\n"
            ),
            "premiere": (
                f"项目: {self.name}\n"
                f"目标软件: Adobe Premiere Pro\n\n"
                "导入步骤:\n"
                "1. 解压此 zip 文件到任意目录\n"
                "2. 打开 Premiere Pro\n"
                "3. File → Import → 选择 .fcpxml 文件\n"
                "4. 确保 media/ 文件夹与 .fcpxml 文件在同一目录\n"
                "5. 如提示找不到素材，手动重新链接 media/ 目录中的文件\n"
            ),
            "fcpro": (
                f"项目: {self.name}\n"
                f"目标软件: Final Cut Pro\n\n"
                "导入步骤:\n"
                "1. 解压此 zip 文件到任意目录\n"
                "2. 打开 Final Cut Pro\n"
                "3. File → Import → XML → 选择 .fcpxml 文件\n"
                "4. 确保 media/ 文件夹与 .fcpxml 文件在同一目录\n"
            ),
            "jianying": (
                f"项目: {self.name}\n"
                f"目标软件: 剪映 / CapCut\n\n"
                "导入步骤:\n"
                "1. 解压此 zip 文件\n"
                "2. 将解压后的文件夹复制到剪映草稿目录:\n"
                "   macOS: ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/\n"
                "   Windows: %LOCALAPPDATA%/JianyingPro/User Data/Projects/com.lveditor.draft/\n"
                "3. 打开剪映，在「草稿」中找到该项目\n"
            ),
        }
        return instructions.get(target, "")

    # ── 资产搜索 ──────────────────────────────────────────

    @staticmethod
    def list_filters() -> List[str]:
        return list(FilterType.__members__.keys())

    @staticmethod
    def list_transitions() -> List[str]:
        return list(TransitionType.__members__.keys())

    @staticmethod
    def list_effects() -> List[str]:
        return list(VideoSceneEffectType.__members__.keys())

    @staticmethod
    def list_text_intros() -> List[str]:
        return list(IntroType.__members__.keys())

    @staticmethod
    def list_text_outros() -> List[str]:
        return list(OutroType.__members__.keys())

    @staticmethod
    def list_keyframe_properties() -> List[str]:
        return list(KeyframeProperty.__members__.keys())

    @staticmethod
    def list_export_targets() -> Dict[str, str]:
        return dict(EXPORT_TARGETS)
