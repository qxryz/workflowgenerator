import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverApps, inspectOrLaunch } from '../scripts/ps-host.mjs';

async function fixture(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ps-host-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function macApp(root, name) {
  const app = path.join(root, name, `${name}.app`);
  await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(app, 'Contents', 'Info.plist'), 'fixture');
  return app;
}
const processReader = async () => ({ known: true, matching: [] });

test('macOS discovers nested bundles but ignores incomplete and installer bundles', async t => {
  const root = await fixture(t);
  const app = await macApp(root, 'Photoshop 2026');
  await macApp(root, 'Photoshop Installer');
  await mkdir(path.join(root, 'Photoshop Broken.app'));
  assert.deepEqual(await discoverApps({ platform: 'darwin', roots: [root] }), [app]);
});

test('status never launches and a process is not document control', async t => {
  const root = await fixture(t);
  const app = await macApp(root, 'Photoshop 2026');
  const result = await inspectOrLaunch({ platform: 'darwin', roots: [root],
    processReader: async () => ({ known: true, matching: [app] }), launchImpl: () => assert.fail('launch') });
  assert.equal(result.code, 'inspected');
  assert.equal(result.documentControlVerified, false);
});

test('multiple versions require a discovered selection; an arbitrary path cannot launch', async t => {
  const root = await fixture(t);
  const app = await macApp(root, 'Photoshop 2026');
  await macApp(root, 'Photoshop 2025');
  const options = { platform: 'darwin', roots: [root], processReader, launchImpl: () => assert.fail('launch') };
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch'] })).code, 'select_application');
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch', '--app', '/tmp/untrusted.app'] })).code,
    'application_not_discovered');
  let selected;
  const result = await inspectOrLaunch({ ...options, args: ['--launch', '--app', app],
    launchImpl: async (platform, value) => { selected = [platform, value]; } });
  assert.deepEqual(selected, ['darwin', app]);
  assert.equal(result.code, 'launch_requested');
  assert.equal(result.documentControlVerified, false);
});

test('Windows finds executable at standard nesting and passes a spaced path unchanged', async t => {
  const root = await fixture(t);
  const folder = path.join(root, 'Vendor', 'Photoshop 2026');
  await mkdir(folder, { recursive: true });
  const app = path.join(folder, 'Photoshop.exe');
  await writeFile(app, 'fixture, never executed');
  let called;
  const result = await inspectOrLaunch({ args: ['--launch'], platform: 'win32', roots: [root], processReader,
    launchImpl: async (platform, value) => { called = [platform, value]; } });
  assert.deepEqual(called, ['win32', app]);
  assert.equal(result.code, 'launch_requested');
  assert.equal(result.documentControlVerified, false);
});

test('missing application, launch failure and unsupported platform remain explicit', async t => {
  const root = await fixture(t);
  const options = { platform: 'darwin', roots: [root], processReader };
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch'] })).code, 'application_not_found');
  await macApp(root, 'Photoshop 2026');
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch'], launchImpl: async () => { throw Error(); } })).code,
    'launch_failed');
  assert.equal((await inspectOrLaunch({ platform: 'linux' })).code, 'unsupported_platform');
  assert.equal((await inspectOrLaunch({ args: ['--run-script', 'anything'] })).code, 'invalid_arguments');
});
