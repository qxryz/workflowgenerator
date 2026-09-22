import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeEnvironment, parseRunningApps } from '../scripts/probe-environment.mjs';

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'AE discovery 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function file(target, content = '') {
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
}

test('first-use macOS discovery finds nested and direct apps but does not assert connection', async t => {
  const root = directory(t);
  const nested = path.join(root, 'Adobe After Effects 2026', 'Adobe After Effects 2026.app');
  const direct = path.join(root, 'Adobe After Effects 2023.app');
  for (const app of [nested, direct]) file(path.join(app, 'Contents/MacOS/After Effects'));
  fs.mkdirSync(path.join(root, 'Adobe After Effects broken.app'));
  const result = await probeEnvironment({ platform: 'darwin', applicationRoots: [root],
    processReader: async () => nested.replaceAll('\\', '/') + '/Contents/MacOS/After Effects\n/unrelated command' });
  assert.deepEqual(result.applications.sort(), [fs.realpathSync(nested), fs.realpathSync(direct)].sort());
  assert.deepEqual(result.running, [nested.replaceAll('\\', '/')]); assert.equal(result.package.state, 'not_located');
  assert.equal(result.connection, 'unverified');
});

test('Windows discovery preserves separate running instances and handles spaces', async t => {
  const root = directory(t), exe = path.join(root, 'Adobe After Effects 2026/Support Files/AfterFX.exe');
  file(exe);
  const winPath = path.join(root, 'Custom 中文', 'Support Files', 'AfterFX.exe');
  file(winPath);
  const result = await probeEnvironment({ platform: 'win32', applicationRoots: [root],
    processReader: async () => JSON.stringify([winPath, winPath]) });
  assert.deepEqual(result.applications, [fs.realpathSync(exe), fs.realpathSync(winPath)]);
  assert.deepEqual(result.running, [winPath, winPath]);
  assert.equal(result.processInspection, 'complete');
  assert.deepEqual(parseRunningApps('win32', JSON.stringify(winPath)), [winPath]);
});

test('missing package, legacy package and compatible entry remain distinct without executing entry', async t => {
  const root = directory(t), mcpRoot = path.join(root, 'package');
  const options = { platform: 'darwin', applicationRoots: [], processReader: async () => '', mcpRoot };
  assert.equal((await probeEnvironment(options)).package.state, 'missing');
  file(path.join(mcpRoot, 'package.json'), JSON.stringify({ name: 'after-effects-mcp', version: '1.13.0' }));
  assert.equal((await probeEnvironment(options)).package.state, 'startup_unsupported');
  file(path.join(mcpRoot, 'package.json'), JSON.stringify({ name: 'after-effects-mcp', version: 'test',
    designAeStartup: { protocolVersion: 1, entry: 'scripts/start.mjs' } }));
  file(path.join(mcpRoot, 'scripts/start.mjs'), 'throw Error("Probe must not execute this file")');
  const result = await probeEnvironment(options);
  assert.equal(result.package.state, 'startup_supported'); assert.equal(result.connection, 'unverified');
});

test('process query failure is unknown, not evidence that AE is stopped', async () => {
  const result = await probeEnvironment({ platform: 'win32', applicationRoots: [], processReader: async () => '[null]' });
  assert.equal(result.processInspection, 'unknown'); assert.equal(result.warnings.length, 1);
});

test('unsupported systems do not inspect processes or run Windows fallback', async () => {
  const result = await probeEnvironment({ platform: 'linux', processReader: () => { throw Error('must not run'); } });
  assert.equal(result.supported, false); assert.equal(result.processInspection, 'unknown');
});

test('custom installation paths are inspected without global scans and relative package paths rejected', async t => {
  const root = directory(t), custom = path.join(root, 'Custom/Adobe After Effects 2026.app');
  file(path.join(custom, 'Contents/MacOS/After Effects'));
  const options = { platform: 'darwin', applicationRoots: [], processReader: async () => '', aePath: custom };
  assert.deepEqual((await probeEnvironment(options)).applications, [fs.realpathSync(custom)]);
  await assert.rejects(() => probeEnvironment({ ...options, mcpRoot: 'relative' }), /absolute/);
});
