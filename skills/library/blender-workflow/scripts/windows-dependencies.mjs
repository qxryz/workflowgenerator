// Narrow recovery for the managed Windows Blender bundle. No global pip install.
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);

export async function repairWindowsDependencies({ packageDir, env = process.env,
  executeImpl = execute } = {}) {
  try {
    if (!packageDir || !path.isAbsolute(packageDir)) return { ok: false, code: 'package_path_unavailable' };
    const root = await realpath(packageDir);
    if (path.basename(root) !== 'blender-mcp' || path.basename(path.dirname(root)) !== 'python-packages') {
      return { ok: false, code: 'unsupported_package_layout' };
    }
    // Match the managed interpreter, never a different Python found on PATH.
    const python = env.HUB_PYTHON?.trim() || path.resolve(root, '../../python/python.exe');
    if (!path.isAbsolute(python) || !(await stat(python)).isFile()) {
      return { ok: false, code: 'managed_python_unavailable' };
    }
    const { stdout } = await executeImpl(python, ['-I', '-B',
      fileURLToPath(new URL('./windows-dependencies.py', import.meta.url)), '--repair', root], {
      env, windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (typeof result.ok !== 'boolean' || typeof result.code !== 'string') throw Error('Invalid repair response');
    return result;
  } catch (error) {
    return { ok: false, code: error.killed || error.signal ? 'dependency_repair_outcome_unknown' : 'dependency_repair_unavailable' };
  }
}
