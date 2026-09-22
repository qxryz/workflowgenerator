// Prefer MCP-owned startup; narrowly adapt the installed 1.13.0 floating panel.
// Usage: node ae-host.mjs inspect|start --mcp-root <registered absolute package path>
//        [--ae-path <application path>] [--timeout 120000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveLegacyPanel, runLegacyPanel } from './ae-panel-compat.mjs';
const execute = promisify(execFile);

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

export function resolveStartup(mcpRoot) {
  if (!mcpRoot || !path.isAbsolute(mcpRoot)) throw fail('invalid_package', '--mcp-root must be the registered absolute MCP package path.');
  const root = fs.realpathSync(mcpRoot);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const descriptor = pkg.designAeStartup;
  if (descriptor === undefined) return resolveLegacyPanel(root, pkg);
  if (pkg.name !== 'after-effects-mcp' || descriptor?.protocolVersion !== 1 || typeof descriptor.entry !== 'string') {
    throw fail('startup_unsupported', 'This installed MCP package does not expose a compatible startup entry. Update the connector package; do not reuse an old bridge launcher.');
  }
  if (path.isAbsolute(descriptor.entry)) throw fail('invalid_package', 'Startup entry must be relative to its MCP package.');
  const entry = fs.realpathSync(path.resolve(root, descriptor.entry));
  const relative = path.relative(root, entry);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || !fs.statSync(entry).isFile() || path.extname(entry) !== '.mjs') {
    throw fail('invalid_package', 'Startup entry must be an existing .mjs file inside its MCP package.');
  }
  return { root, entry, packageVersion: pkg.version };
}

export function parseArgs(input) {
  const [action, ...args] = input;
  if (!['inspect', 'diagnose', 'start'].includes(action)) throw fail('invalid_arguments', 'Expected inspect, diagnose or start.');
  const flags = new Map();
  for (let i = 0; i < args.length;) {
    const flag = args[i], value = args[i + 1];
    if (flag === '--enable-script-access') {
      if (flags.has(flag) || action !== 'start') throw fail('invalid_arguments', 'Permission changes are only accepted with start.');
      flags.set(flag, true); i++; continue;
    }
    if (!['--mcp-root', '--ae-path', '--timeout'].includes(flag) || !value || flags.has(flag)) throw fail('invalid_arguments', 'Unknown, missing or duplicated option: ' + flag);
    flags.set(flag, value); i += 2;
  }
  const timeoutMs = Number(flags.get('--timeout') ?? 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 180000) throw fail('invalid_arguments', '--timeout must be 5000–180000 ms.');
  const target = resolveStartup(flags.get('--mcp-root'));
  if (target.mode !== 'installed_panel_compat' && (action === 'diagnose' || flags.has('--enable-script-access'))) {
    throw fail('startup_unsupported', 'This declared package launcher has no advertised diagnostic/permission contract. Use its supported interface or inspect the active AE settings through UI.');
  }
  const forwarded = [action, '--timeout', String(timeoutMs)];
  if (flags.has('--ae-path')) forwarded.push('--ae-path', flags.get('--ae-path'));
  return { ...target, forwarded, timeoutMs, action, aePath: flags.get('--ae-path'),
    enableScriptAccess: flags.get('--enable-script-access') === true };
}

export async function delegate(input) {
  const options = parseArgs(input);
  if (options.mode === 'installed_panel_compat') {
    const result = await runLegacyPanel(options);
    return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
  }
  try {
    const result = await execute(process.execPath, [options.entry, ...options.forwarded], {
      cwd: options.root, timeout: options.timeoutMs + 10000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error.killed || error.signal) throw fail(options.action === 'start' ? 'outcome_unknown' : 'inspection_failed', 'The package startup entry was interrupted or exceeded its time budget. Inspect actual state before retrying.');
    // Windows termination can surface as a numeric exit code without a signal.
    // Only a structured terminal failure is evidence that a retry is safe.
    if (options.action === 'start' && Number.isInteger(error.code)) {
      let reported;
      try { reported = JSON.parse(error.stdout); } catch { /* Unknown outcome. */ }
      if (reported?.ok !== false || typeof reported.status !== 'string') {
        throw fail('outcome_unknown', 'Startup exited without a verified failure result. Inspect the running application and connection before retrying.');
      }
    }
    if (Number.isInteger(error.code)) return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(`Usage: node ae-host.mjs inspect|diagnose|start --mcp-root <registered absolute package path> [--ae-path <application path>] [--timeout 120000] [--enable-script-access]
inspect is local/read-only and reports package compatibility and startup-lock state. startupSupported=false from the installer only means no declared launcher; still inspect.
For the supported 1.13.0 layout (including 1.13.0+fix.1), diagnose reads the running AE permission/version/language via macOS DoScript without loading a panel or needing file-write permission. It never launches AE. Windows has no synchronous scripting return channel: use available UI to inspect the active Scripting & Expressions setting when diagnosis is unverified.
start uses macOS DoScriptFile or Windows AfterFX.exe -r to load this package's panel. The bootstrap checks live script permission and rendering BEFORE loading. On macOS, permission errors return directly without an acknowledgement file. On Windows, no ack can also mean blocked file permission; inspect UI before retrying.
Windows cold startup keeps the new AE process open after script evaluation and detaches it from the command's console. Existing AE instances and macOS retain their current lifecycle. This does not enable script access or repair missing system environment variables.
Only with the user's authorization for Allow Scripts to Write Files and Access Network, pass --enable-script-access with start. It enables only that setting in the active AE preferences, saves and reads it back before loading. Without this explicit flag no preferences are changed. Never infer current permission from an old language/version preferences file.
Concurrent starts wait within --timeout. startup_finished_recheck and lock_recovered_recheck mean check the current conversation MCP connection and project, then diagnose if needed; they do NOT mean reload. Only expired locks with a recorded dead owner are reclaimed; unknown old locks are preserved. startup_busy means still occupied; startup_lock_unresolved means ownership is unknown. Neither requires reinstalling.
Allow the outer command runner at least --timeout plus 30000 ms (150000 ms by default). A command interrupted by its outer timeout has an unknown result: inspect/diagnose first, do not force-remove locks.
Reuse the intended instance; ambiguous multiple instances are rejected. Keep the floating panel open. Panel acknowledgement, permission readiness and recovered locks are NOT verified MCP connections: check the current conversation AE MCP check-bridge and read its project before editing. This helper never installs/registers a connector or edits a project. Diagnose/permission flags are not forwarded to package launchers that do not advertise them.`);
  } else delegate(process.argv.slice(2)).then(result => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }).catch(error => {
    console.error(JSON.stringify({ ok: false, status: error.status ?? 'environment_error', message: error.message }));
    process.exitCode = 1;
  });
}
