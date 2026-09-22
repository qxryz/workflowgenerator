"""Repair only missing pywin32 files in the registered Blender package.

CPython 3.12 x64 is the managed bundle supported here. The fixed wheel and hash
come from https://pypi.org/pypi/pywin32/310/json. No pip, postinstall, registry,
global site-packages or Blender preferences are modified.
"""
import hashlib
import io
import json
import os
import platform
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

WHEEL_URL = 'https://files.pythonhosted.org/packages/e3/e5/b0627f8bb84e06991bea89ad8153a9e50ace40b2e1195d68e9dff6b03d0f/pywin32-310-cp312-cp312-win_amd64.whl'
WHEEL_SHA256 = 'bf5c397c9a9a19a6f62f3fb821fbf36cac08f03770056711f765ec1503972060'
ALLOWED = {'win32', 'win32com', 'win32comext', 'pythonwin', 'pywin32_system32',
           'pywin32-310.dist-info', 'pythoncom.py', 'pywin32.pth', 'adodbapi', 'isapi'}


def probe(root):
    # Separate process: do not reuse modules from a failed import after repair.
    source = '''import sys,json
from pathlib import Path
r=Path(sys.argv[1]); sys.path[:0]=[str(r),str(r/'win32'),str(r/'win32/lib'),str(r/'pythonwin')]
try:
 import blender_mcp.server
 print(json.dumps({'ok':True,'code':'dependencies_ready'}))
except ModuleNotFoundError as e:
 print(json.dumps({'ok':False,'code':'missing_module','module':e.name}))
except Exception:
 print(json.dumps({'ok':False,'code':'dependency_import_failed'}))
'''
    result = subprocess.run([sys.executable, '-I', '-B', '-c', source, str(root)],
                            capture_output=True, text=True, encoding='utf-8', timeout=30,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        return {'ok': False, 'code': 'dependency_probe_failed'}
    return json.loads(result.stdout)


def download():
    with urllib.request.urlopen(WHEEL_URL, timeout=60) as response:
        if response.url != WHEEL_URL:
            raise ValueError('Unexpected wheel redirect')
        data = response.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != WHEEL_SHA256:
        raise ValueError('Wheel integrity check failed')
    return data


def wheel_files(data):
    """Validate every archive path before accepting a subset of runtime files."""
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(item.file_size for item in archive.infolist()) > 80 * 1024 * 1024:
            raise ValueError('Wheel exceeds unpacked size limit')
        for item in archive.infolist():
            p = PurePosixPath(item.filename)
            if (p.is_absolute() or '..' in p.parts or '\\' in item.orig_filename or '\x00' in item.orig_filename
                    or ':' in item.filename or (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('Unsafe wheel member')
            if item.is_dir() or not p.parts or p.parts[0] not in ALLOWED:
                continue
            if str(p).lower() in {name.lower() for name in files}:
                raise ValueError('Duplicate wheel member')
            files[str(p)] = archive.read(item)
    if not {'win32/lib/pywintypes.py', 'pywin32_system32/pywintypes312.dll'} <= files.keys():
        raise ValueError('Incomplete pywin32 wheel')
    return files


def install_missing(root, files):
    """Never overwrite different existing content or follow a junction outside root."""
    missing = []
    for name, data in files.items():
        target = root / name
        if not target.resolve().is_relative_to(root):
            raise ValueError('Dependency path escapes package')
        if target.exists():
            if not target.is_file() or target.read_bytes() != data:
                raise FileExistsError('Existing dependency differs from pinned wheel')
        else:
            missing.append((target, data))
    stage = Path(tempfile.mkdtemp(prefix='.skill-dependency-stage-', dir=root))
    try:
        for index, (target, data) in enumerate(missing):
            temp = stage / str(index)
            temp.write_bytes(data)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.resolve().is_relative_to(root):
                raise ValueError('Dependency path changed')
            # Exclusive create preserves another writer's files; a retry verifies
            # already written bytes before completing an interrupted extraction.
            with target.open('xb') as output:
                output.write(temp.read_bytes())
    finally:
        if stage.resolve().is_relative_to(root):
            shutil.rmtree(stage)


def repair(root, repair_requested=False, probe_impl=probe, download_impl=download):
    root = root.resolve(strict=True)
    for member in ['blender_mcp/__init__.py', 'blender_mcp/server.py']:
        item = root / member
        if not item.is_file() or not item.resolve().is_relative_to(root):
            return {'ok': False, 'code': 'unsupported_package_layout'}
    before = probe_impl(root)
    if before['ok'] or not repair_requested:
        return before
    if before.get('code') != 'missing_module' or before.get('module') not in {
            'pywintypes', 'win32api', 'win32job', 'win32process', 'win32event', 'win32con'}:
        return before
    lock = root / '.skill-windows-repair.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        return {'ok': False, 'code': 'dependency_repair_busy'}
    try:
        # Recheck under the lock in case another request just finished.
        current = probe_impl(root)
        if current['ok'] or current.get('code') != before.get('code') or current.get('module') != before.get('module'):
            return current
        install_missing(root, wheel_files(download_impl()))
        result = probe_impl(root)
        return {**result, 'repaired': result['ok'], 'dependency': 'pywin32==310'}
    except FileExistsError:
        return {'ok': False, 'code': 'dependency_conflict'}
    except Exception:
        return {'ok': False, 'code': 'dependency_repair_failed'}
    finally:
        lock.rmdir()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in {'--status', '--repair'}:
            result = {'ok': False, 'code': 'invalid_arguments'}
        elif (sys.platform != 'win32' or sys.version_info[:2] != (3, 12)
              or struct.calcsize('P') != 8 or platform.machine().lower() not in {'amd64', 'x86_64'}):
            result = {'ok': False, 'code': 'unsupported_python_runtime'}
        else:
            result = repair(Path(sys.argv[2]), sys.argv[1] == '--repair')
    except Exception:
        result = {'ok': False, 'code': 'dependency_probe_failed'}
    print(json.dumps(result))
