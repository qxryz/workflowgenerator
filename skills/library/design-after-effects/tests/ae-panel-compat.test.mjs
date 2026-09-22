import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { resolveStartup } from '../scripts/ae-host.mjs';
import { runLegacyPanel, chooseApplication, scriptInvocation, bootstrap, diagnosticScript, diagnosticInvocation } from '../scripts/ae-panel-compat.mjs';

const app = '/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app';
const probe = { applications: [app], running: [app], processInspection: 'complete' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae panel 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'build/scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'after-effects-mcp', version: '1.13.0' }));
  fs.writeFileSync(path.join(root, 'build/scripts/mcp-bridge-auto.jsx'), 'var BRIDGE_VERSION = "1.13.0-mcp-enhanced"; initLastProcessedCommand(); startCommandChecker(); panel.show();');
  return { root, ...resolveStartup(root), action: 'start', timeoutMs: 1000 };
}
function evaluate(file, { rendering = false, expired = false, panelError = false, access = true,
  returnResult = false, changes = [], language = 'en_US', jsonAvailable = true, persistChange = true,
  host = {}, onPanelLoad = () => {} } = {}) {
  const loaded = [];
  function File(name) {
    this.exists = fs.existsSync(name);
    this.open = () => { assert.equal(access, true, 'No file writes while permission is off'); return true; };
    this.write = data => fs.writeFileSync(name, data);
    this.close = () => {};
    this.name = name;
  }
  const context = vm.createContext({ File, Date: expired ? class extends Date { getTime() { return Number.MAX_SAFE_INTEGER; } } : Date,
    app: Object.assign(host, { version: '26.0', isoLanguage: language, project: { renderQueue: { rendering } },
      preferences: { havePref: () => true, getPrefAsLong: () => access ? 1 : 0,
        savePrefAsLong: (section, key, value) => { changes.push([section, key, value]); if (persistChange) access = value === 1; },
        saveToDisk: () => { changes.push('saved'); } } }), JSON: jsonAvailable ? JSON : undefined,
    $: { evalFile: panel => {
      onPanelLoad(host);
      if (panelError) throw Error('Panel load failure');
      loaded.push(path.normalize(panel.name)); context.BRIDGE_VERSION = '1.13.0-mcp-enhanced';
    } } });
  const returned = vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return returnResult ? returned : loaded;
}

test('installed 1.13.0 layout is supported; changed and escaped panels are rejected', t => {
  const f = fixture(t);
  assert.equal(f.mode, 'installed_panel_compat');
  fs.writeFileSync(f.panel, 'var BRIDGE_VERSION="old";');
  assert.throws(() => resolveStartup(f.root), e => e.status === 'startup_unsupported');
  fs.unlinkSync(f.panel);
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.jsx`);
  fs.writeFileSync(outside, ''); t.after(() => fs.rmSync(outside));
  fs.symlinkSync(outside, f.panel);
  assert.throws(() => resolveStartup(f.root), e => e.status === 'invalid_package');
});

test('inspect is read-only; start waits for matching acknowledgement without claiming MCP readiness', async t => {
  const f = fixture(t);
  const before = fs.readdirSync(f.root);
  const inspect = await runLegacyPanel({ ...f, action: 'inspect' }, { platform: 'darwin', probe, send: () => assert.fail('dispatch') });
  assert.equal(inspect.status, 'launch_available');
  assert.deepEqual(fs.readdirSync(f.root), before);
  const result = await runLegacyPanel(f, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (platform, target, file, timeout, running) => {
      assert.equal(target, app); assert.equal(running, true);
      assert.deepEqual(evaluate(file), [f.panel]);
    } });
  assert.equal(result.status, 'panel_loaded_unverified');
  assert.equal(result.hostControlVerified, false);
  assert.equal(result.bridgeResponding, false);
  assert.equal(result.aeVersion, '26.0');
  assert.deepEqual(fs.readdirSync(f.root), before);
});

test('OS arguments keep paths as data; Windows dispatch uses existing AfterFX without waiting for exit', async t => {
  const f = fixture(t), win = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
  const file = '/tmp/中文 "quote" $dollar.jsx';
  assert.deepEqual(scriptInvocation('darwin', app, file).args.slice(-2), [app, file]);
  assert.deepEqual(scriptInvocation('win32', win, file), { command: win, args: ['-r', file] });
  const result = await runLegacyPanel({ ...f, aePath: win }, { platform: 'win32', temporaryRoot: f.root,
    probe: { ...probe, applications: [win], running: [win] }, send: async (_p, target, file) => {
      assert.equal(target, win); evaluate(file);
    } });
  assert.equal(result.status, 'panel_loaded_unverified');
});

test('multiple instances, unknown process state and another running version block startup', () => {
  assert.throws(() => chooseApplication({ ...probe, running: [app, app] }, app, 'darwin'), e => e.status === 'ambiguous_ae');
  assert.throws(() => chooseApplication({ ...probe, processInspection: 'unknown' }, app, 'darwin'), e => e.status === 'inspection_failed');
  assert.throws(() => chooseApplication({ ...probe, running: ['/Applications/Adobe After Effects 2023.app'] }, app, 'darwin'), e => e.status === 'different_ae_running');
});

test('Windows cold startup keeps AE alive before loading its panel, including recovery failures', async t => {
  const f = fixture(t), win = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
  for (const setup of [{}, { panelError: true }, { access: false }]) {
    const host = { exitAfterLaunchAndEval: true }, changes = [];
    const result = await runLegacyPanel({ ...f, aePath: win }, {
      platform: 'win32', probe: { ...probe, applications: [win], running: [] }, temporaryRoot: f.root,
      send: async (_p, _a, file, _timeout, running) => {
        assert.equal(running, false);
        return evaluate(file, { ...setup, host, changes, returnResult: true,
          onPanelLoad: live => assert.equal(live.exitAfterLaunchAndEval, false) });
      },
    });
    assert.equal(host.exitAfterLaunchAndEval, false, 'AE must remain open for connection or recovery');
    assert.deepEqual(changes, [], 'Keeping AE open must not change saved preferences');
    assert.equal(result.status, setup.access === false ? 'script_permission_required'
      : setup.panelError ? 'panel_load_failed' : 'panel_loaded_unverified');
    assert.equal(result.hostControlVerified, false);
  }
});

test('macOS startup and an existing Windows AE retain their lifecycle setting', async t => {
  const f = fixture(t), win = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
  for (const [platform, target, running] of [['darwin', app, []], ['darwin', app, [app]], ['win32', win, [win]]]) {
    const host = {};
    Object.defineProperty(host, 'exitAfterLaunchAndEval', { get: () => true,
      set: () => assert.fail('Only a newly launched Windows host may change its exit behavior') });
    const result = await runLegacyPanel({ ...f, aePath: target }, {
      platform, probe: { ...probe, applications: [target], running }, temporaryRoot: f.root,
      send: async (_p, _a, file) => evaluate(file, { host, returnResult: true }),
    });
    assert.equal(result.status, 'panel_loaded_unverified');
  }
});

test('an expired or revoked Windows cold startup cannot change AE lifecycle', t => {
  const f = fixture(t), permit = path.join(f.root, 'permit'), ack = path.join(f.root, 'ack');
  const file = path.join(f.root, 'load.jsx');
  fs.writeFileSync(file, bootstrap({ panel: f.panel, permit, ack, nonce: 'test',
    expiresAt: Date.now() + 10000, keepApplicationOpen: true }));
  for (const expired of [false, true]) {
    if (expired) fs.writeFileSync(permit, 'yes');
    const host = { exitAfterLaunchAndEval: true };
    assert.deepEqual(evaluate(file, { host, expired }), []);
    assert.equal(host.exitAfterLaunchAndEval, true);
    assert.equal(fs.existsSync(ack), false);
  }
});

test('rendering and panel errors are reported without modifying the project', async t => {
  const f = fixture(t);
  for (const setup of [{ rendering: true }, { panelError: true }]) {
    const result = await runLegacyPanel(f, { platform: 'darwin', probe, temporaryRoot: f.root,
      send: async (_p, _a, file) => { assert.deepEqual(evaluate(file, setup), []); } });
    assert.equal(result.ok, false);
    assert.equal(result.status, setup.rendering ? 'ae_rendering' : 'panel_load_failed');
  }
});

test('expired bootstrap never executes, and timeout revokes delayed work without retry', async t => {
  const f = fixture(t); let sends = 0, saved;
  await assert.rejects(() => runLegacyPanel({ ...f, timeoutMs: 1000 }, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (_p, _a, file) => { sends++; saved = file; assert.deepEqual(evaluate(file, { expired: true }), []); } }), e => e.status === 'outcome_unknown');
  assert.equal(sends, 1); assert.equal(fs.existsSync(saved), false);
});

test('a simultaneous startup waits for completion and asks for connection verification without reloading', async t => {
  const f = fixture(t); let unblock, dispatched;
  const ready = new Promise(r => { dispatched = r; });
  const first = runLegacyPanel(f, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (_p, _a, file) => { dispatched(); await new Promise(r => { unblock = r; }); evaluate(file); } });
  await ready;
  const second = runLegacyPanel(f, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: () => assert.fail('must reuse first attempt') });
  unblock(); assert.equal((await first).status, 'panel_loaded_unverified');
  assert.equal((await second).status, 'startup_finished_recheck');
});

test('bootstrap preserves quotes and unicode paths without embedding shell code', t => {
  const f = fixture(t), permit = path.join(f.root, 'permit'), ack = path.join(f.root, 'ack');
  fs.writeFileSync(permit, 'yes');
  const file = path.join(f.root, 'load.jsx'), panel = '/tmp/中文 "quote" $test\u2028.jsx';
  fs.writeFileSync(file, bootstrap({ panel, permit, ack, nonce: 'test', expiresAt: Date.now() + 10000 }));
  assert.deepEqual(evaluate(file), [path.normalize(panel)]);
});

test('permission-off returns directly on macOS, without JSON globals, panel loading or file writes', async t => {
  const f = fixture(t), changes = [];
  const result = await runLegacyPanel(f, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (_p, _a, file) => evaluate(file, { access: false, returnResult: true, jsonAvailable: false, changes }) });
  assert.equal(result.status, 'script_permission_required');
  assert.equal(result.scriptAccess, false);
  assert.equal(result.aeLanguage, 'en_US');
  assert.equal(result.hostControlVerified, false);
  assert.deepEqual(changes, []);
});

test('explicit permission flag enables only the live setting and reads back before Windows acknowledgement', async t => {
  const f = fixture(t), win = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
  const changes = [];
  const result = await runLegacyPanel({ ...f, enableScriptAccess: true, aePath: win }, {
    platform: 'win32', probe: { ...probe, applications: [win], running: [win] }, temporaryRoot: f.root,
    send: async (_p, _a, file) => { assert.deepEqual(evaluate(file, { access: false, changes }), [f.panel]); } });
  assert.equal(result.ok, true);
  assert.equal(result.scriptAccess, true);
  assert.deepEqual(changes, [['Main Pref Section v2', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY', 1], 'saved']);
});

test('rendering blocks even explicitly authorized preference changes', async t => {
  const f = fixture(t), changes = [];
  const result = await runLegacyPanel({ ...f, enableScriptAccess: true }, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (_p, _a, file) => evaluate(file, { access: false, rendering: true, changes, returnResult: true }) });
  assert.equal(result.status, 'ae_rendering'); assert.deepEqual(changes, []);
});

test('diagnosis uses active version/language permission, never historical prefs or a working bridge', async t => {
  const f = fixture(t);
  const appMock = { version: '26.0', isoLanguage: 'en_US', preferences: {
    havePref: () => true, getPrefAsLong: section => section === 'Main Pref Section v2' ? 0 : 1,
  } };
  const output = vm.runInNewContext(diagnosticScript(), { app: appMock, JSON: undefined });
  const result = await runLegacyPanel({ ...f, action: 'diagnose' }, { platform: 'darwin', probe,
    readReadiness: async () => output, send: () => assert.fail('panel reload') });
  assert.equal(result.status, 'script_permission_required'); assert.equal(result.scriptAccess, false);
  assert.deepEqual(diagnosticInvocation(app).args.slice(-2), [app, diagnosticScript()]);
  const unavailable = await runLegacyPanel({ ...f, action: 'diagnose' }, { platform: 'darwin',
    probe: { ...probe, running: [] }, readReadiness: () => assert.fail('must not launch') });
  assert.equal(unavailable.status, 'ae_not_running');
});

test('a missing permission key is unverified instead of assumed enabled', () => {
  const result = JSON.parse(vm.runInNewContext(diagnosticScript(), {
    app: { version: '26.0', isoLanguage: 'en_US', preferences: { havePref: () => false } }, JSON: undefined,
  }));
  assert.equal(result.status, 'permission_unverified'); assert.equal(result.scriptAccess, null);
});

test('a permission change that fails readback cannot proceed to the panel', async t => {
  const f = fixture(t);
  const result = await runLegacyPanel({ ...f, enableScriptAccess: true }, { platform: 'darwin', probe, temporaryRoot: f.root,
    send: async (_p, _a, file) => evaluate(file, { access: false, persistChange: false, returnResult: true }) });
  assert.equal(result.status, 'script_permission_required'); assert.equal(result.ok, false);
});
