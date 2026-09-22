"""Run inside Blender. Defaults to a new isolated scene; never saves a file.
CLI: blender --background --python prepare_scene.py -- --seconds 12
Reuse is explicit and preserves timing, active camera, and existing transforms.
Both modes set native 2560x1440 full-frame preview output.
"""
import argparse
import json
import sys
import bpy

COLLECTIONS = ["01_ENVIRONMENT", "02_SUBJECTS", "03_MOTION_RIGS", "04_FX",
               "05_CAMERAS", "06_LIGHTING", "07_REFERENCES"]


def prepare_scene(seconds=12, fps=24, reuse_current=False):
    if not 10 <= seconds <= 15 or fps <= 0:
        raise ValueError("seconds must be 10–15 and fps must be positive")
    scene = bpy.context.scene if reuse_current else bpy.data.scenes.new("CF3D_SCENE")
    if not reuse_current:
        scene.render.fps = fps
        scene.render.fps_base = 1
        scene.frame_start = 1
        scene.frame_end = round(seconds * fps)
        scene.unit_settings.system = "METRIC"
        scene.unit_settings.scale_length = 1
    scene.render.resolution_x = 2560
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1
    scene.render.pixel_aspect_y = 1
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    collections = {}
    for name in COLLECTIONS:
        collection = next((c for c in scene.collection.children
                           if c.get("cf3d_role") == name or c.name == name), None)
        if collection is None:
            collection = bpy.data.collections.new(name)
            collection["cf3d_role"] = name
            scene.collection.children.link(collection)
        collections[name] = collection
    cam = scene.camera
    target = None
    if cam is None:
        data = bpy.data.cameras.new("CF3D_CAMERA_DATA")
        cam = bpy.data.objects.new("CF3D_CAMERA", data)
        collections["05_CAMERAS"].objects.link(cam)
        cam.location = (0, -10, 3)
        data.lens = 24
        target = bpy.data.objects.new("CF3D_CAMERA_TARGET", None)
        collections["03_MOTION_RIGS"].objects.link(target)
        target.location = (0, 0, 2)
        track = cam.constraints.new("TRACK_TO")
        track.target = target
        track.track_axis = "TRACK_NEGATIVE_Z"
        track.up_axis = "UP_Y"
        scene.camera = cam
    else:
        target = next((c.target for c in cam.constraints
                       if c.type == "TRACK_TO" and c.target), None)
    if bpy.context.window:
        bpy.context.window.scene = scene
    return {"scene": scene.name, "fps": scene.render.fps / scene.render.fps_base,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "resolution_percentage": scene.render.resolution_percentage,
            "range": [scene.frame_start, scene.frame_end], "camera": cam.name,
            "target": target.name if target else None, "reused": reuse_current}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=12)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--reuse-current", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    print(json.dumps(prepare_scene(args.seconds, args.fps, args.reuse_current), ensure_ascii=False))


if __name__ == "__main__":
    main()
