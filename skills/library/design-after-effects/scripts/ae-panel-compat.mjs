// Load the installed 1.13.0 bridge through the application's scripting entrypoints.
// This adapter never implements the bridge protocol or writes MCP command files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startupLockPath, inspectStartupLock, acquireStartupLock, releaseStartupLock } from './ae-startup-lock.mjs';
const execute = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function resolveLegacyPanel(root, pkg) {
  if (pkg.name !== 'after-effects-mcp' || pkg.version !== '1.13.0') {
    throw fail('startup_unsupported', 'No declared launcher or supported 1.13.0 panel layout. Update the connector or use its documented manual panel route.');
  }
  let panel;
  try { panel = fs.realpathSync(path.join(root, 'build/scripts/mcp-bridge-auto.jsx')); }
  catch (error) {
    if (error.code === 'ENOENT') throw fail('startup_unsupported', 'The installed package does not contain the supported bridge panel layout.');
    throw error;
  }
  const relative = path.relative(root, panel);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || !fs.statSync(panel).isFile()) {
    throw fail('invalid_package', 'Bridge panel must stay inside the registered MCP package.');
  }
  const source = fs.readFileSync(panel, 'utf8');
  const version = source.match(/var BRIDGE_VERSION\s*=\s*"([^"]+)"/)?.[1];
  // These are required behavior markers for this narrow adapter, not a signature.
  if (version !== '1.13.0-mcp-enhanced' || !source.includes('initLastProcessedCommand();')
      || !source.includes('startCommandChecker();') || !source.includes('panel.show();')) {
    throw fail('startup_unsupported', 'Installed panel does not match the supported floating-panel lifecycle.');
  }
  return { root, panel, packageVersion: pkg.version, bridgeVersion: version, mode: 'installed_panel_compat' };
}

export function chooseApplication(probe, aePath, platform) {
  if (probe.processInspection !== 'complete') throw fail('inspection_failed', 'Cannot identify running AE instances; no startup was sent.');
  if (probe.running.length > 1) throw fail('ambiguous_ae', 'Multiple AE instances are running; choose one instance before loading a shared bridge.');
  const normalize = s => platform === 'win32' ? path.win32.normalize(s).toLowerCase() : path.posix.normalize(s);
  if (aePath) {
    const validPath = platform === 'win32'
      ? path.win32.isAbsolute(aePath) && /[\\/]AfterFX\.exe$/i.test(aePath)
      : path.posix.isAbsolute(aePath) && /\/Adobe After Effects[^/]*\.app$/.test(aePath);
    if (!validPath) throw fail('invalid_ae_path', 'Expected an Adobe After Effects .app or AfterFX.exe path.');
    if (!probe.applications.some(p => normalize(p) === normalize(aePath))) throw fail('invalid_ae_path', 'The selected AE executable could not be verified.');
    if (probe.running.length && normalize(probe.running[0]) !== normalize(aePath)) throw fail('different_ae_running', 'Another AE version is running; no second instance was started.');
    return aePath;
  }
  if (probe.running.length === 1) return probe.running[0];
  if (probe.applications.length !== 1) throw fail('ambiguous_ae', 'Specify the AE application path when no unique installed or running application is available.');
  return probe.applications[0];
}

export function scriptInvocation(platform, app, file) {
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args: ['-e',
    'on run argv\nset appPath to item 1 of argv\nset scriptFile to POSIX file (item 2 of argv)\ntell application appPath\n«event miscfile» scriptFile\nend tell\nend run', app, file] };
  if (platform === 'win32') return { command: app, args: ['-r', file] };
  throw fail('unsupported_platform', 'AE panel startup supports macOS and Windows only.');
}

// These functions are serialized into ES3. No JSON global or bridge is required
// to report permission errors through the macOS scripting return value.
function readiness() {
  var r = { aeVersion: String(app.version), aeLanguage: String(app.isoLanguage),
    scriptAccess: null, rendering: false, status: 'permission_unverified' };
  try {
    r.rendering = !!(app.project && app.project.renderQueue.rendering);
    var section = 'Main Pref Section v2', key = 'Pref_SCRIPTING_FILE_NETWORK_SECURITY';
    if (!app.preferences.havePref(section, key)) section = 'Main Pref Section';
    if (app.preferences.havePref(section, key)) {
      r.scriptAccess = app.preferences.getPrefAsLong(section, key) === 1;
      r.permissionSection = section;
      r.status = r.scriptAccess ? 'script_access_ready' : 'script_permission_required';
    }
    if (r.rendering) r.status = 'ae_rendering';
  } catch (e) { r.error = String(e); }
  return r;
}
function encodeResult(result) {
  var fields = [], k, v;
  function quote(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/[\x00-\x1f\u2028\u2029]/g, function(c) {
        return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
      }) + '"';
  }
  for (k in result) {
    if (!result.hasOwnProperty(k)) continue;
    v = result[k];
    fields.push(quote(k) + ':' + (v === null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : quote(v)));
  }
  return '{' + fields.join(',') + '}';
}
const runtimeHelpers = () => `var designReadiness=${readiness.toString()};\nvar designEncode=${encodeResult.toString()};\n`;

export function diagnosticScript() {
  return `(function(){${runtimeHelpers()}return designEncode(designReadiness());})()`;
}

export function diagnosticInvocation(app) {
  return { command: '/usr/bin/osascript', args: ['-e',
    'on run argv\ntell application (item 1 of argv)\nreturn «event miscdosc» (item 2 of argv)\nend tell\nend run', app, diagnosticScript()] };
}

export function bootstrap({ panel, permit, ack, nonce, expiresAt, enableScriptAccess = false,
  keepApplicationOpen = false }) {
  const literal = s => JSON.stringify(s.replaceAll('\\', '/')).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // Keep evalFile at global scope: this panel schedules checkForCommands by name.
  return `${runtimeHelpers()}
var designPanelLoadResult={nonce:${literal(nonce)},loaded:false,status:"startup_expired"};
if(new Date().getTime()<${expiresAt} && (new File(${literal(permit)})).exists){
// AfterFX -r cold launches otherwise exit after evaluating this file.
// This is a process lifecycle flag, not a saved preference or script permission.
if(${keepApplicationOpen === true}) app.exitAfterLaunchAndEval=false;
designPanelLoadResult=designReadiness();
designPanelLoadResult.nonce=${literal(nonce)};
designPanelLoadResult.loaded=false;
try {
  if(designPanelLoadResult.rendering) throw new Error("AE is rendering; bridge was not reloaded.");
  if(${enableScriptAccess === true} && designPanelLoadResult.scriptAccess === false){
    app.preferences.savePrefAsLong(designPanelLoadResult.permissionSection,"Pref_SCRIPTING_FILE_NETWORK_SECURITY",1);
    app.preferences.saveToDisk();
    designPanelLoadResult=designReadiness();
    designPanelLoadResult.nonce=${literal(nonce)};
    designPanelLoadResult.loaded=false;
  }
  if(designPanelLoadResult.scriptAccess === true){
    $.evalFile(new File(${literal(panel)}));
    designPanelLoadResult.loaded=true;
    designPanelLoadResult.status="panel_loaded_unverified";
    designPanelLoadResult.bridgeVersion=BRIDGE_VERSION;
  }
} catch(designPanelLoadError) {
  if(designPanelLoadResult.status === "script_access_ready") designPanelLoadResult.status="panel_load_failed";
  designPanelLoadResult.error=String(designPanelLoadError);
}
if(designPanelLoadResult.scriptAccess === true){
var designPanelAck=new File(${literal(ack)});
designPanelAck.encoding="UTF-8";
if(designPanelAck.open("w")){
designPanelAck.write(designEncode(designPanelLoadResult));designPanelAck.close();
} else { designPanelLoadResult.status="ack_write_failed"; designPanelLoadResult.error="Cannot write panel acknowledgement."; }
}
}
designEncode(designPanelLoadResult);
`;
}

async function dispatch(platform, app, file, timeoutMs, alreadyRunning) {
  if (platform === 'darwin') {
    if (!alreadyRunning) await execute('/usr/bin/open', ['-a', app], { timeout: Math.min(10000, timeoutMs) });
    const call = scriptInvocation(platform, app, file);
    return (await execute(call.command, call.args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 })).stdout;
  } else {
    const call = scriptInvocation(platform, app, file);
    // AfterFX can stay alive after dispatch. Await spawn, then wait for JSX's ack.
    await new Promise((resolve, reject) => {
      const child = spawn(call.command, call.args, {
        stdio: 'ignore', windowsHide: false, shell: false, detached: !alreadyRunning,
      });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
}

async function diagnose(app, timeoutMs) {
  const call = diagnosticInvocation(app);
  return (await execute(call.command, call.args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 })).stdout;
}

function response(result, evidence) {
  const status = result.status || (result.loaded ? 'panel_loaded_unverified' : 'panel_load_failed');
  const messages = {
    script_permission_required: 'The running AE has Allow Scripts to Write Files and Access Network OFF. A language/version switch can select different preferences. With authorization for this setting, use start --enable-script-access; otherwise request that one permission change. Do not reinstall the connector.',
    permission_unverified: 'AE script permission could not be verified. Inspect Scripting & Expressions in the active AE preferences; do not infer permission from an old language/version preference file.',
    ae_rendering: 'AE is rendering. Wait for completion; do not reload its panel.',
  };
  const ok = result.loaded === true && status === 'panel_loaded_unverified' && result.bridgeVersion === evidence.bridgeVersion;
  return { ok, ...evidence, status: result.loaded && result.bridgeVersion !== evidence.bridgeVersion ? 'panel_version_mismatch' : status,
    aeVersion: result.aeVersion, aeLanguage: result.aeLanguage, scriptAccess: result.scriptAccess,
    message: messages[status] || result.error,
    next: ok ? 'Keep the panel open. Check the current conversation AE MCP connection and read its project before editing.' : undefined };
}

export async function runLegacyPanel(options, { platform = process.platform, probe, send = dispatch, readReadiness = diagnose,
  temporaryRoot = os.tmpdir() } = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw fail('unsupported_platform', 'AE panel startup supports macOS and Windows only.');
  probe ??= await (await import('./probe-environment.mjs')).probeEnvironment({ aePath: options.aePath, platform });
  const app = chooseApplication(probe, options.aePath, platform);
  const evidence = { mode: options.mode, aePath: app, panelPath: options.panel,
    packageVersion: options.packageVersion, bridgeVersion: options.bridgeVersion,
    bridgeResponding: false, hostControlVerified: false };
  const lock = startupLockPath(temporaryRoot, app, platform);
  if (options.action === 'inspect') return { ok: true, status: 'launch_available', ...evidence,
    startupLock: inspectStartupLock(lock), scriptAccess: 'unverified' };
  if (options.action === 'diagnose') {
    if (!probe.running.length) return { ok: false, ...evidence, status: 'ae_not_running' };
    if (platform === 'win32') return { ok: false, ...evidence, status: 'permission_unverified',
      message: 'The Windows command-line entry has no synchronous scripting return channel. Inspect the running AE Scripting & Expressions setting using available UI capability. Do not treat a saved preference file as live evidence.' };
    try {
      const result = JSON.parse(await readReadiness(app, Math.min(options.timeoutMs, 15000)));
      if (typeof result.scriptAccess !== 'boolean') return response(result, evidence);
      return { ...response(result, evidence), ok: result.status === 'script_access_ready' };
    } catch { return { ok: false, ...evidence, status: 'ae_readiness_unavailable',
      message: 'AE did not return readiness. Check startup progress, system automation authorization and modal windows; no panel was reloaded.' }; }
  }
  const expiresAt = Date.now() + options.timeoutMs;
  const ownership = await acquireStartupLock(lock, { deadline: expiresAt });
  if (!ownership.acquired) return { ok: false, ...evidence, status: ownership.status,
    next: 'Check the current conversation AE MCP connection and project first. If still disconnected, run diagnose and resolve its specific blocker. A recovered lock is not proof that the previous panel failed. Do not create a second panel blindly.' };
  const nonce = ownership.nonce;
  // Unique paths ensure an old queued event cannot execute a newer attempt.
  const permit = path.join(lock, `permit-${nonce}`), ack = path.join(lock, `ack-${nonce}.json`), file = path.join(lock, `load-${nonce}.jsx`);
  try {
    fs.writeFileSync(permit, nonce, { mode: 0o600 });
    fs.writeFileSync(file, bootstrap({ panel: options.panel, permit, ack, nonce, expiresAt,
      enableScriptAccess: options.enableScriptAccess,
      keepApplicationOpen: platform === 'win32' && probe.running.length === 0 }), { mode: 0o600 });
    const output = await send(platform, app, file, Math.max(1, expiresAt - Date.now()), probe.running.length === 1);
    // macOS returns diagnostics even when permission prevents writing an ack.
    let returned;
    try { returned = JSON.parse(output); } catch { /* Windows uses the ack file */ }
    if (returned?.nonce === nonce) return response(returned, evidence);
    while (Date.now() < expiresAt) {
      let result;
      try { result = JSON.parse(fs.readFileSync(ack, 'utf8')); } catch { /* not written yet */ }
      if (result?.nonce === nonce) {
        return response(result, evidence);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw fail('outcome_unknown', 'No panel acknowledgement before timeout. Check the existing AE MCP connection, then run diagnose. On Windows check the active Scripting & Expressions permission through available UI; its command-line entry cannot return a permission error without file access. Do not immediately reload or reinstall.');
  } catch (error) {
    if (error.status) throw error;
    throw fail('outcome_unknown', `Panel dispatch did not produce a verified result: ${error.message}. Inspect AE before retrying.`);
  } finally {
    // Revokes a delayed Windows/AppleEvent execution before removing our files.
    releaseStartupLock(lock, nonce);
  }
}
