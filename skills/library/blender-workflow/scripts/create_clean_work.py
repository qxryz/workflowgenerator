"""Create an independent work file in a fresh Blender background process.

Run with Blender --background --factory-startup --disable-autoexec
--python-exit-code 1 --python <this script> -- --output <absolute .blend path>.
Never execute this helper through the user's live Blender MCP instance.
"""

import argparse
import json
from pathlib import Path
import sys
import uuid

import bpy


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--name', default='Work')
    options = parser.parse_args(args)

    blender_args = sys.argv[:sys.argv.index('--')] if '--' in sys.argv else sys.argv
    if not bpy.app.background or '--factory-startup' not in blender_args:
        raise RuntimeError('Requires a separate factory-startup background process')
    if '--disable-autoexec' not in blender_args or bpy.data.filepath:
        raise RuntimeError('Automatic scripts must be disabled; no existing file may be loaded')

    target = Path(options.output).expanduser()
    if not target.is_absolute() or target.suffix.lower() != '.blend':
        raise ValueError('--output must be an absolute .blend path')
    target = target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)

    # Reserve this unique destination without overwriting an existing work.
    # Keep the reservation on failure so an uncertain retry cannot replace it.
    with target.open('xb'):
        pass

    # Factory reset is safe only here: this process has no user work or MCP host.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = options.name
    work_id = uuid.uuid4().hex
    scene['hub_work_id'] = work_id
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    assert len(bpy.data.objects) == 0
    # Do not create a .blend1 backup of the empty reservation. This preference
    # is process-local; the helper never saves preferences or a startup file.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    if Path(bpy.data.filepath).resolve() != target or target.stat().st_size == 0:
        raise RuntimeError('Work file could not be verified')
    print('HUB_BLENDER_WORK ' + json.dumps({
        'path': str(target),
        'work_id': work_id,
        'scene': scene.name,
        'object_count': len(bpy.data.objects),
        'blender_version': bpy.app.version_string,
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
