"""Run inside the intended Blender UI. No file switch, save, render or modeling."""
import hashlib
import json
import os
from pathlib import Path
import time


def start_service(job, bpy, addon_utils):
    result = {'ok': False, 'hostControlVerified': False, 'nonce': job['nonce']}
    if time.time() * 1000 >= job['expiresAt'] or not Path(job['permit']).is_file():
        return {**result, 'code': 'startup_expired'}
    if Path(job['permit']).read_text(encoding='utf-8') != job['nonce']:
        return {**result, 'code': 'startup_expired'}
    if job.get('processId') and os.getpid() != job['processId']:
        return {**result, 'code': 'different_blender_instance'}
    if bpy.app.background or bpy.app.is_job_running('RENDER'):
        return {**result, 'code': 'blender_busy'}
    before = {'filepath': bpy.data.filepath, 'isDirty': bpy.data.is_dirty,
              'scene': bpy.context.scene.name, 'objectCount': len(bpy.data.objects)}
    result['projectBefore'] = before
    installed = (Path(bpy.utils.user_resource('SCRIPTS', path='addons')) / 'blender_mcp.py').resolve()
    if not installed.is_file() or hashlib.sha256(installed.read_bytes()).hexdigest() != job['addonSha256']:
        return {**result, 'code': 'installed_addon_mismatch'}
    loaded = __import__('sys').modules.get('blender_mcp')
    if loaded and Path(getattr(loaded, '__file__', '')).resolve() != installed:
        return {**result, 'code': 'loaded_addon_mismatch'}
    port = int(getattr(bpy.context.scene, 'blendermcp_port', job['port']))
    if port != job['port']:
        return {**result, 'code': 'addon_port_mismatch'}
    # Enabling is session-local. Never save all preferences or change global
    # automatic script execution/security settings to make a connection work.
    if not addon_utils.check('blender_mcp')[1]:
        addon_utils.modules(refresh=True)
        module = addon_utils.enable('blender_mcp', default_set=False, persistent=True)
        if module is None or not addon_utils.check('blender_mcp')[1]:
            return {**result, 'code': 'addon_enable_failed'}
    server = getattr(bpy.types, 'blendermcp_server', None)
    if not server or not server.running:
        bpy.ops.blendermcp.start_server()
        server = getattr(bpy.types, 'blendermcp_server', None)
    if not server or not server.running or server.port != job['port']:
        return {**result, 'code': 'service_start_failed'}
    after = {'filepath': bpy.data.filepath, 'isDirty': bpy.data.is_dirty,
             'scene': bpy.context.scene.name, 'objectCount': len(bpy.data.objects)}
    unchanged = all(before[key] == after[key] for key in ['filepath', 'scene', 'objectCount'])
    return {**result, 'ok': unchanged, 'code': 'service_started' if unchanged else 'project_changed',
            'processId': os.getpid(), 'projectAfter': after, 'sceneReadRequired': True}


def run(job_path):
    import bpy
    import addon_utils
    job = json.loads(Path(job_path).read_text(encoding='utf-8'))
    try:
        result = start_service(job, bpy, addon_utils)
    except Exception as error:
        result = {'ok': False, 'code': 'service_start_failed', 'nonce': job['nonce'],
                  'errorType': type(error).__name__, 'hostControlVerified': False}
    # Late executions have no authority to write into a later attempt's files.
    if Path(job['permit']).is_file() and time.time() * 1000 < job['expiresAt']:
        ack = Path(job_path).with_name('ack.json')
        ack.write_text(json.dumps(result), encoding='utf-8')
    return result
