// Read-only first-use discovery. Does not install, launch, change preferences or contact AE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveStartup } from './ae-host.mjs';
const execute = promisify(execFile);

export function parseRunningApps(platform, output) {
  if (platform === 'darwin') {
    return output.split(/\r?\n/).map(s => s.trim())
      .filter(s => /\/Adobe After Effects[^/]*\.app\/Contents\/MacOS\/After Effects$/.test(s))
      .map(s => s.slice(0, s.indexOf('.app/Contents/') + 4));
  }
  const rows = JSON.parse(output.trim() || '[]');
  const values = Array.isArray(rows) ? rows : [rows];
  if (values.some(s => typeof s !== 'string' || !s.trim())) throw new Error('A running AE process has an unreadable executable path.');
  return values;
}

async function readProcesses(platform) {
  const args = platform === 'darwin'
    ? ['/bin/ps', ['-axo', 'command=']]
    : ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference="Stop"; $p=@(Get-CimInstance Win32_Process -Filter "Name=\'AfterFX.exe\'" | ForEach-Object {$_.ExecutablePath}); ConvertTo-Json -InputObject $p -Compress']];
  return (await execute(...args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
}

export async function probeEnvironment({ platform = process.platform, mcpRoot, aePath,
  applicationRoots, processReader = readProcesses } = {}) {
  const result = { platform, supported: ['darwin', 'win32'].includes(platform),
    applications: [], running: [], processInspection: 'unknown', warnings: [],
    package: { state: 'not_located' }, connection: 'unverified' };
  if (!result.supported) return result;
  const roots = applicationRoots ?? (platform === 'darwin'
    ? ['/Applications', path.join(os.homedir(), 'Applications')]
    : [...new Set([process.env.ProgramW6432, process.env.ProgramFiles,
      process.env['ProgramFiles(x86)']].filter(Boolean).map(p => path.join(p, 'Adobe')))]);
  const candidates = new Set();
  if (aePath) {
    if (!path.isAbsolute(aePath)) throw new Error('--ae-path must be an absolute application path.');
    candidates.add(aePath);
  }
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        if (!/^Adobe After Effects(?:\s|$)/.test(entry)) continue;
        if (platform === 'win32') candidates.add(path.join(root, entry, 'Support Files', 'AfterFX.exe'));
        else if (entry.endsWith('.app')) candidates.add(path.join(root, entry));
        else {
          for (const child of fs.readdirSync(path.join(root, entry))) {
            if (/^Adobe After Effects.*\.app$/.test(child)) candidates.add(path.join(root, entry, child));
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') result.warnings.push(`Application scan incomplete: ${root} (${error.code || 'read failed'})`);
    }
  }
  for (const candidate of candidates) {
    const executable = platform === 'darwin' ? path.join(candidate, 'Contents', 'MacOS', 'After Effects') : candidate;
    try { if (fs.statSync(executable).isFile()) result.applications.push(fs.realpathSync(candidate)); }
    catch { if (candidate === aePath) result.warnings.push('The supplied AE application path could not be verified.'); }
  }
  result.applications = [...new Set(result.applications)];
  try {
    result.running = parseRunningApps(platform, await processReader(platform));
    result.processInspection = 'complete';
    // A running custom installation is stronger evidence than the standard
    // directory scan. Keep duplicate process paths: two instances are ambiguous.
    for (const running of result.running) {
      const executable = platform === 'darwin' ? path.join(running, 'Contents', 'MacOS', 'After Effects') : running;
      if (platform === 'win32' && !/AfterFX\.exe$/i.test(running)) throw Error('Unexpected AE executable');
      try {
        if (fs.statSync(executable).isFile()) result.applications.push(fs.realpathSync(running));
      } catch { /* Process evidence remains distinct from a verified installation. */ }
    }
    result.applications = [...new Set(result.applications)];
  } catch (error) {
    result.processInspection = 'unknown';
    result.warnings.push(`Process inspection failed: ${error.message}`);
  }
  if (mcpRoot) {
    if (!path.isAbsolute(mcpRoot)) throw new Error('--mcp-root must be the registered absolute package path.');
    try {
      const target = resolveStartup(mcpRoot);
      result.package = { state: 'startup_supported', root: target.root, version: target.packageVersion };
    } catch (error) {
      result.package = { state: !fs.existsSync(mcpRoot) ? 'missing' : error.status || 'invalid_package', root: mcpRoot, message: error.message };
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node probe-environment.mjs [--mcp-root <registered absolute package path>] [--ae-path <absolute application path>]\nRead-only macOS/Windows discovery. Omit unknown package paths; not_located does not mean uninstalled. Never reports a verified AE connection.');
  } else {
    try {
      const options = {}, seen = new Set();
      for (let i = 0; i < args.length; i += 2) {
        if (!['--mcp-root', '--ae-path'].includes(args[i]) || !args[i + 1] || seen.has(args[i])) throw new Error('Unknown, missing or duplicated option. Use --help.');
        seen.add(args[i]); options[args[i] === '--mcp-root' ? 'mcpRoot' : 'aePath'] = args[i + 1];
      }
      console.log(JSON.stringify(await probeEnvironment(options), null, 2));
    } catch (error) { console.error(JSON.stringify({ ok: false, message: error.message })); process.exitCode = 1; }
  }
}
