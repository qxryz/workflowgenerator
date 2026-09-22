import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectOrLaunch, launchApp, parseProcesses } from '../scripts/blender-host.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host 首次使用 ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'Custom 安装', 'blender.exe');
  await mkdir(path.dirname(app)); await writeFile(app, 'fixture; never execute');
  return { root, app };
}
test('Windows custom running installation is reused without launching or claiming control', async t => {
  const { app } = await fixture(t);
  const result = await inspectOrLaunch({ args: ['--launch'], platform: 'win32', roots: [],
    processReader: async () => ({ known: true, matching: [app] }),
    launchImpl: () => assert.fail('duplicate launch') });
  assert.equal(result.code, 'already_running');
  assert.equal(result.selectedApplication, app);
  assert.equal(result.hostControlVerified, false);
});
test('Windows unknown, duplicate and different running instances cannot launch', async t => {
  const { root, app } = await fixture(t);
  const other = path.join(root, 'Other', 'blender.exe');
  await mkdir(path.dirname(other)); await writeFile(other, 'fixture');
  for (const [processes, code] of [
    [{ known: false, matching: [] }, 'process_inspection_unavailable'],
    [{ known: true, matching: [app, app] }, 'ambiguous_running_instances'],
    [{ known: true, matching: [other] }, 'different_application_running'],
  ]) {
    const result = await inspectOrLaunch({ args: ['--launch', '--app', app], platform: 'win32', roots: [],
      processReader: async () => processes, launchImpl: () => assert.fail('unsafe launch') });
    assert.equal(result.code, code);
  }
  assert.equal(parseProcesses('win32', '[null]').known, false);
  assert.equal(parseProcesses('win32', JSON.stringify([app, app])).matching.length, 2);
});
test('Windows custom path is validated and passed literally; status is read-only', async t => {
  const { app } = await fixture(t), calls = [];
  const options = { platform: 'win32', roots: [],
    processReader: async () => ({ known: true, matching: [] }),
    launchImpl: async (...args) => calls.push(args) };
  assert.equal((await inspectOrLaunch({ ...options, args: ['--status', '--app', app] })).code, 'inspected');
  assert.equal(calls.length, 0);
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch', '--app', app] })).code, 'launch_requested');
  assert.deepEqual(calls[0], ['win32', app, undefined]);
  assert.equal((await inspectOrLaunch({ ...options, args: ['--launch', '--app', app + '.bat'] })).code, 'application_not_discovered');
});

test('Windows launch passes the literal application path through actual PowerShell', {
  skip: process.platform !== 'win32',
}, async () => {
  const app = "C:\\Custom 安装 $dollar & 'quote\\blender.exe";
  const execute = promisify(execFile);
  let received;
  await launchApp('win32', app, undefined, async (executable, args, options) => {
    // Parse the production command in PowerShell, replacing only the process
    // creation side effect so this regression never opens a user's application.
    const intercept = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ' +
      'function Start-Process { param([ValidateNotNullOrEmpty()][string]$FilePath, [string]$WindowStyle) ' +
      '@{filePath=$FilePath; windowStyle=$WindowStyle} | ConvertTo-Json -Compress }; ';
    const { stdout } = await execute(executable, [...args.slice(0, -1), intercept + args.at(-1)], options);
    received = JSON.parse(stdout);
  });
  assert.deepEqual(received, { filePath: app, windowStyle: 'Normal' });
});

test('macOS launch keeps the existing open command and literal arguments', async () => {
  let received;
  await launchApp('darwin', '/Applications/Blender.app', undefined, async (...args) => { received = args; });
  assert.deepEqual(received, ['/usr/bin/open', ['-a', '/Applications/Blender.app'], { timeout: 15000 }]);
});
