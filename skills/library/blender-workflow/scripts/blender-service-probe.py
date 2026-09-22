"""Read the installed connector's own endpoint, addon and scene interfaces."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys


def inspect(root, connect=True):
    root = Path(root).resolve(strict=True)
    sys.path[:0] = [str(root), str(root / 'win32'), str(root / 'win32/lib'), str(root / 'pythonwin')]
    with contextlib.redirect_stdout(sys.stderr):
        from blender_mcp import server
        from blender_mcp.addon_manager import get_bundled_addon_path
        addon = get_bundled_addon_path().resolve(strict=True)
        if not addon.is_relative_to(root):
            raise ValueError('Bundled addon escapes the registered package')
        host = os.getenv('BLENDER_HOST', server.DEFAULT_HOST)
        port = int(os.getenv('BLENDER_PORT', server.DEFAULT_PORT))
        if host not in {'localhost', '127.0.0.1'} or not 1024 <= port <= 65535:
            return {'ok': False, 'code': 'unsupported_endpoint', 'hostControlVerified': False}
        result = {'ok': True, 'code': 'package_inspected', 'hostControlVerified': False,
                  'host': host, 'port': port, 'addonSha256': hashlib.sha256(addon.read_bytes()).hexdigest()}
        if not connect:
            return result
        connection = server.BlenderConnection(host=host, port=port)
        try:
            if not connection.connect():
                return {**result, 'ok': False, 'code': 'service_not_connected'}
            # Validate the addon before accepting an unrelated listener as Blender.
            info = connection.send_command('get_addon_info')
            if not isinstance(info, dict) or 'get_scene_info' not in info.get('capabilities', []):
                return {**result, 'ok': False, 'code': 'addon_identity_unverified'}
            scene = connection.send_command('get_scene_info')
            if not isinstance(scene, dict) or not isinstance(scene.get('object_count'), int) or not isinstance(scene.get('name'), str):
                return {**result, 'ok': False, 'code': 'scene_unverified'}
            return {**result, 'code': 'scene_read', 'hostControlVerified': True,
                    'blenderVersion': info.get('blender_version'),
                    'scene': {'name': scene['name'], 'objectCount': scene['object_count']}}
        except Exception:
            return {**result, 'ok': False, 'code': 'service_read_failed'}
        finally:
            connection.disconnect()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in {'--metadata', '--status'}:
            raise ValueError('Expected --metadata/--status and the registered package directory')
        result = inspect(sys.argv[2], sys.argv[1] == '--status')
    except Exception:
        result = {'ok': False, 'code': 'package_probe_failed', 'hostControlVerified': False}
    print(json.dumps(result))
