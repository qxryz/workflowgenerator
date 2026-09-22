#!/usr/bin/env node
// Standalone with the skill: installation discovery and non-destructive launch.
import { readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const config = {"vendor":"Blender Foundation","exe":"blender.exe","macName":"blender"};
const execute = promisify(execFile);
const rootsFor = (platform, env) => platform === 'darwin'
  ? ['/Applications', path.join(os.homedir(), 'Applications')]
  : [...new Set([env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
    .filter(Boolean).map(root => path.join(root, config.vendor)))];
const samePath = (a, b, platform) => platform === 'win32'
  ? path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()
  : path.posix.normalize(a) === path.posix.normalize(b);

async function verifiedApp(app, platform) {
  try {
    if (!path.isAbsolute(app)) return null;
    if (platform === 'win32') {
      if (path.basename(app).toLowerCase() !== config.exe.toLowerCase() || !(await stat(app)).isFile()) return null;
    } else if (!path.basename(app).toLowerCase().includes(config.macName)
        || !app.endsWith('.app') || !(await stat(path.join(app, 'Contents/Info.plist'))).isFile()
        || !(await stat(path.join(app, 'Contents/MacOS'))).isDirectory()) return null;
    return await realpath(app);
  } catch { return null; }
}

export async function discoverApps({ platform = process.platform, roots = rootsFor(platform, process.env) } = {}) {
  if (!['darwin', 'win32'].includes(platform)) return [];
  const found = new Set();
  async function visit(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (/uninstall|installer/i.test(entry.name) || entry.isSymbolicLink()) continue;
      const candidate = path.join(dir, entry.name);
      if ((platform === 'win32' && entry.isFile() && entry.name.toLowerCase() === config.exe.toLowerCase())
          || (platform === 'darwin' && entry.isDirectory() && entry.name.endsWith('.app'))) {
        const verified = await verifiedApp(candidate, platform);
        if (verified) found.add(verified);
      } else if (entry.isDirectory() && depth > 0) await visit(candidate, depth - 1);
    }
  }
  for (const root of roots) await visit(root, platform === 'darwin' ? 1 : 2);
  return [...found].sort();
}

export function parseProcesses(platform, output) {
  if (platform === 'darwin') {
    return { known: true, matching: output.split(/\r?\n/).map(s => s.trim())
      .filter(s => s.includes('.app/Contents/MacOS/') && s.split('/').at(-1).toLowerCase().includes(config.macName))
      .map(s => s.slice(0, s.indexOf('.app/Contents/') + 4)) };
  }
  const value = JSON.parse(output.trim() || '[]');
  const rows = Array.isArray(value) ? value : [value];
  // Preserve duplicates and unreadable process paths; neither means no process.
  if (rows.some(s => typeof s !== 'string' || !s.trim())) return { known: false, matching: [] };
  return { known: true, matching: rows };
}

async function readProcesses(platform) {
  try {
    const call = platform === 'darwin' ? ['/bin/ps', ['-axo', 'comm=']]
      : ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; $p=@(Get-CimInstance Win32_Process -Filter "Name = \'' +
        config.exe + '\'" | ForEach-Object {$_.ExecutablePath}); ConvertTo-Json -InputObject $p -Compress']];
    return parseProcesses(platform, (await execute(...call, {
      timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    })).stdout);
  } catch { return { known: false, matching: [] }; }
}

export async function launchApp(platform, app, file, run = execute) {
  if (platform === 'darwin') {
    await run('/usr/bin/open', ['-a', app, ...(file ? [file] : [])], { timeout: 15000 });
  } else {
    // The application window is intentional. No shell or visible console helper.
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference="Stop"; Start-Process -FilePath $env:HILO_BLENDER_LAUNCH_APP -WindowStyle Normal'], {
      env: { ...process.env, HILO_BLENDER_LAUNCH_APP: app }, windowsHide: true, timeout: 15000,
    });
  }
}

export async function inspectOrLaunch({ args = [], platform = process.platform,
  roots = rootsFor(platform, process.env), processReader = readProcesses, launchImpl = launchApp } = {}) {
  const base = { platform, hostControlVerified: false, documentControlVerified: false };
  const action = args[0] || '--status', options = {};
  if (!['--status', '--launch'].includes(action)) return { ...base, ok: false, code: 'invalid_arguments' };
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--app', ...(config.files ? ['--file'] : [])].includes(flag) || !args[i + 1]
        || options[flag] || (flag === '--file' && action !== '--launch')) {
      return { ...base, ok: false, code: 'invalid_arguments' };
    }
    options[flag] = args[i + 1];
  }
  if (!['darwin', 'win32'].includes(platform)) return { ...base, ok: false, code: 'unsupported_platform' };
  const candidates = await discoverApps({ platform, roots });
  let processes;
  try { processes = await processReader(platform); } catch { processes = { known: false, matching: [] }; }
  const requested = options['--app'];
  // Explicit host/user paths and current processes also cover custom installs.
  for (const supplied of [...processes.matching, ...(requested ? [requested] : [])]) {
    const verified = await verifiedApp(supplied, platform);
    if (verified && !candidates.some(p => samePath(p, verified, platform))) candidates.push(verified);
  }
  const evidence = { ...base, candidates, processes };
  if (requested && !candidates.some(p => samePath(p, requested, platform))) {
    return { ...evidence, ok: false, code: 'application_not_discovered' };
  }
  if (action === '--status') return { ...evidence, ok: true, code: candidates.length ? 'inspected' : 'application_not_found' };
  if (!processes.known) return { ...evidence, ok: false, code: 'process_inspection_unavailable' };
  if (processes.matching.length > 1) return { ...evidence, ok: false, code: 'ambiguous_running_instances' };
  if (processes.matching.length === 1) {
    const running = processes.matching[0];
    if (requested && !samePath(requested, running, platform)) return { ...evidence, ok: false, code: 'different_application_running' };
    if (!candidates.some(p => samePath(p, running, platform))) return { ...evidence, ok: false, code: 'running_application_unverified' };
    return { ...evidence, ok: true, code: 'already_running', selectedApplication: running,
      ...(options['--file'] ? { fileNotOpened: true } : {}) };
  }
  if (!candidates.length) return { ...evidence, ok: false, code: 'application_not_found' };
  const app = candidates.find(p => requested && samePath(p, requested, platform))
    || (candidates.length === 1 ? candidates[0] : null);
  if (!app) return { ...evidence, ok: false, code: 'select_application' };
  const file = options['--file'];
  if (file) {
    try {
      if (!path.isAbsolute(file) || !config.files.includes(path.extname(file).toLowerCase())
          || !(await stat(file)).isFile()) throw Error();
    } catch { return { ...evidence, ok: false, code: 'invalid_project_file' }; }
  }
  try {
    await launchImpl(platform, app, file);
    return { ...evidence, ok: true, code: 'launch_requested', selectedApplication: app,
      ...(file ? { requestedFile: file } : {}) };
  } catch { return { ...evidence, ok: false, code: 'launch_failed', selectedApplication: app }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node ' + path.basename(process.argv[1]) +
      ' [--status | --launch] [--app ABSOLUTE_APP_PATH]' + (config.files ? ' [--file ABSOLUTE_TOE_OR_TOX_PATH]' : '') +
      '\nRead-only status discovers standard/custom installations and running instances on macOS/Windows.' +
      '\nLaunch reuses a running instance; unknown or multiple processes block a new launch. No application download, process killing, plugin injection or preference changes.' +
      (config.files ? '\n--file opens an existing trusted .toe/.tox only when no instance is running. Keep all companion resources together. In a running application, use its existing import controls; this helper does not switch projects.' : '') +
      '\nLaunch acceptance is not host control. Read the actual project through the current conversation before editing.');
  } else {
    const result = await inspectOrLaunch({ args: process.argv.slice(2) });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 2;
  }
}
