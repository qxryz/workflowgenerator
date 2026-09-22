#!/usr/bin/env node
// Start only the already installed connector addon; never replace a project.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir, realpath, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { inspectOrLaunch } from './blender-host.mjs';
import { prepareConnector } from './prepare-connector.mjs';

const execute = promisify(execFile);
const script = name => fileURLToPath(new URL(name, import.meta.url));
const fail = code => ({ ok: false, code, hostControlVerified: false });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function ensureService({ args = [], env = process.env, platform = process.platform,
  prepare = prepareConnector, inspect = inspectOrLaunch, run = execute,
  tempRoot = os.tmpdir(), wait = pause, budgetMs = 20000 } = {}) {
  const action = args[0] || '--status';
  if (!['--status', '--start'].includes(action)) return fail('invalid_arguments');
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    if (!['--package', '--app'].includes(args[i]) || !args[i + 1] || options[args[i]]) return fail('invalid_arguments');
    options[args[i]] = args[i + 1];
  }
  // Existing macOS launch behavior remains owned by blender-host.mjs.
  if (platform !== 'win32') return fail('service_startup_unsupported_platform');
  let lock, jobDir;
  try {
    let supplied = options['--package'];
    if (!supplied) {
      const prepared = await prepare({ args: ['--status'], env });
      if (!prepared.ok || prepared.state !== 'installed' || !prepared.packageDir) return fail('installed_package_required');
      supplied = prepared.packageDir;
    }
    if (!path.isAbsolute(supplied)) return fail('invalid_package_path');
    const root = await realpath(supplied);
    if (path.basename(root) !== 'blender-mcp' || path.basename(path.dirname(root)) !== 'python-packages') return fail('unsupported_package_layout');
    const python = env.HUB_PYTHON?.trim() || path.resolve(root, '../../python/python.exe');
    if (!path.isAbsolute(python) || !(await stat(python)).isFile()) return fail('managed_python_unavailable');
    async function pythonJson(file, parameters, timeout = 10000) {
      const { stdout } = await run(python, ['-I', '-B', script(file), ...parameters],
        { env, windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
      const value = JSON.parse(stdout);
      if (typeof value.ok !== 'boolean' || typeof value.code !== 'string') throw Error('invalid_helper_response');
      return value;
    }
    const probe = () => pythonJson('blender-service-probe.py', ['--status', root]);
    let observed = await probe();
    if (action === '--status') return observed;
    if (observed.code !== 'service_not_connected' && observed.hostControlVerified !== true) return observed;
    if (!/^[a-f0-9]{64}$/.test(observed.addonSha256) || !Number.isInteger(observed.port)) return fail('invalid_package_metadata');
    const appArgs = options['--app'] ? ['--app', options['--app']] : [];
    const inspected = await inspect({ args: ['--status', ...appArgs], platform });
    if (!inspected.ok || !inspected.processes?.known) return fail('application_state_unknown');
    if (inspected.processes.matching.length > 1) return fail('ambiguous_running_instances');
    if (options['--app'] && inspected.processes.matching.length === 1 &&
        path.normalize(options['--app']).toLowerCase() !== path.normalize(inspected.processes.matching[0]).toLowerCase()) return fail('different_application_running');
    if (observed.hostControlVerified === true) return inspected.processes.matching.length === 1 ? observed : fail('application_state_unknown');
    const app = options['--app'] || inspected.processes.matching[0] || (inspected.candidates.length === 1 ? inspected.candidates[0] : null);
    if (!app) return fail('select_application');
    const lockPath = path.join(tempRoot, 'blender-service-' + createHash('sha256').update(app.toLowerCase()).digest('hex').slice(0, 24) + '.lock');
    try { await mkdir(lockPath); lock = lockPath; } catch (error) {
      if (error.code === 'EEXIST') return fail('startup_busy');
      throw error;
    }
    observed = await probe();
    if (observed.hostControlVerified === true || observed.code !== 'service_not_connected') return observed;
    const launched = await inspect({ args: ['--launch', '--app', app], platform });
    if (!launched.ok) return launched;
    // Never repeat a dispatch with an unknown outcome.
    jobDir = await mkdtemp(path.join(tempRoot, 'blender-service-job-'));
    const nonce = randomUUID(), permit = path.join(jobDir, 'permit');
    const jobPath = path.join(jobDir, 'job.json');
    await writeFile(permit, nonce, { flag: 'wx' });
    await writeFile(jobPath, JSON.stringify({ nonce, permit, expiresAt: Date.now() + budgetMs,
      launched: launched.code === 'launch_requested',
      addonSha256: observed.addonSha256, port: observed.port }));
    const code = `import runpy; runpy.run_path(${JSON.stringify(script('blender-service-bootstrap.py'))})['run'](${JSON.stringify(jobPath)})`;
    // ASCII avoids keyboard-layout and non-BMP path issues in console dispatch.
    const command = `exec(bytes.fromhex('${Buffer.from(code).toString('hex')}').decode('utf-8'))`;
    const request = path.join(jobDir, 'dispatch.json');
    await writeFile(request, JSON.stringify({ command }));
    if (launched.code === 'launch_requested') await wait(2000);
    const dispatched = await pythonJson('blender-console-windows.py', [app, request, jobPath], 15000);
    if (!dispatched.ok) return dispatched;
    const deadline = JSON.parse(await readFile(jobPath, 'utf8')).expiresAt;
    while (Date.now() < deadline) {
      let ack;
      try { ack = JSON.parse(await readFile(path.join(jobDir, 'ack.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (ack) {
        if (ack.nonce !== nonce) return fail('startup_identity_mismatch');
        if (!ack.ok) return { ...ack, hostControlVerified: false };
        const verified = await probe();
        return { ...verified, startup: ack.code, sceneReadRequired: true };
      }
      await wait(250);
    }
    return fail('startup_outcome_unknown');
  } catch (error) {
    return fail(error.killed || error.signal ? 'startup_outcome_unknown' : 'service_preparation_failed');
  } finally {
    // Retain diagnostics, but revoke late console execution and release only our lock.
    if (jobDir) await unlink(path.join(jobDir, 'permit')).catch(() => {});
    if (lock) await rmdir(lock).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--help') console.log(`Usage: node blender-service.mjs [--status | --start] [--package REGISTERED_PACKAGE_DIR] [--app ABSOLUTE_APP_PATH]
Windows: inspect the installed connector, open/reuse Blender, enable its matching addon for this session and start its service.
Without --package, obtain the registered package from the current Design conversation.
Allow 120000 ms for --start. Keep Blender free of dialogs; dispatch briefly uses its Python Console.
No project switching, saving, rendering, downloads or global preference changes. Unknown outcomes must be inspected before retrying.
Success requires a real addon and scene read; re-read through the current conversation before creative edits.
Other platforms retain the existing blender-host.mjs workflow.`);
  else {
    const result = await ensureService({ args: process.argv.slice(2) });
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 2;
  }
}
