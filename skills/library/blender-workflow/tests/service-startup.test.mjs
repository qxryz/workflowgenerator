import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureService } from '../scripts/blender-service.mjs';

async function fixture(t, mode = 'success') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'service 测试 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'python-packages', 'blender-mcp');
  const python = path.join(root, 'python', 'python.exe');
  await mkdir(pkg, { recursive: true }); await mkdir(path.dirname(python)); await writeFile(python, 'fixture');
  const app = path.join(root, 'Blender 安装', 'blender.exe');
  let started = mode === 'connected', dispatches = 0, launches = 0;
  const result = () => ({ ok: started, code: started ? 'scene_read' : 'service_not_connected',
    hostControlVerified: started, addonSha256: 'a'.repeat(64), port: 9876 });
  const options = { args: ['--start', '--package', pkg], platform: 'win32', tempRoot: root,
    env: {}, budgetMs: mode === 'timeout' ? 0 : 20000,
    inspect: async ({ args }) => {
      if (args[0] === '--launch') { launches++; return { ok: true, code: mode === 'cold' ? 'launch_requested' : 'already_running' }; }
      return { ok: true, processes: { known: true, matching: mode === 'multiple' ? [app, app] : mode === 'cold' ? [] : [app] }, candidates: [app] };
    },
    wait: async () => {},
    run: async (_, args) => {
      if (args[2].endsWith('blender-service-probe.py')) return { stdout: JSON.stringify(result()) };
      dispatches++;
      const jobPath = args.at(-1), job = JSON.parse(await readFile(jobPath, 'utf8'));
      if (mode !== 'timeout') await writeFile(path.join(path.dirname(jobPath), 'ack.json'), JSON.stringify({
        ok: mode !== 'addon_error', code: mode === 'addon_error' ? 'addon_enable_failed' : 'service_started',
        nonce: mode === 'wrong_nonce' ? 'other-attempt' : job.nonce,
      }));
      started = mode !== 'unresponsive';
      return { stdout: JSON.stringify({ ok: true, code: 'console_dispatched' }) };
    },
  };
  return { options, root, counts: () => ({ dispatches, launches }) };
}

test('startup verifies a real scene and revokes its permit, including spaced paths', async t => {
  const f = await fixture(t); const r = await ensureService(f.options);
  assert.equal(r.hostControlVerified, true); assert.equal(r.code, 'scene_read');
  assert.deepEqual(f.counts(), { launches: 1, dispatches: 1 });
  const names = await readdir(f.root); assert.equal(names.some(n => n.endsWith('.lock')), false);
  const job = names.find(n => n.startsWith('blender-service-job-'));
  await assert.rejects(readFile(path.join(f.root, job, 'permit')), { code: 'ENOENT' });
});
test('connected service and status do not launch or dispatch', async t => {
  for (const mode of ['connected', 'success']) {
    const f = await fixture(t, mode);
    if (mode === 'success') f.options.args[0] = '--status';
    await ensureService(f.options); assert.deepEqual(f.counts(), { launches: 0, dispatches: 0 });
  }
});
test('only a new launch authorizes cold-window preparation', async t => {
  for (const mode of ['cold', 'success']) {
    const f = await fixture(t, mode), originalRun = f.options.run;
    let launched;
    f.options.run = async (python, args, options) => {
      if (args[2].endsWith('blender-console-windows.py')) {
        launched = JSON.parse(await readFile(args.at(-1), 'utf8')).launched;
        assert.equal(options.timeout, 15000);
      }
      return originalRun(python, args, options);
    };
    assert.equal((await ensureService(f.options)).code, 'scene_read');
    assert.equal(launched, mode === 'cold');
    assert.deepEqual(f.counts(), { launches: 1, dispatches: 1 });
  }
});
test('multiple instances block startup without dispatch', async t => {
  const f = await fixture(t, 'multiple'); assert.equal((await ensureService(f.options)).code, 'ambiguous_running_instances');
  assert.deepEqual(f.counts(), { launches: 0, dispatches: 0 });
});
for (const [mode, code] of [['wrong_nonce', 'startup_identity_mismatch'], ['addon_error', 'addon_enable_failed'],
  ['unresponsive', 'service_not_connected'], ['timeout', 'startup_outcome_unknown']]) {
  test(`startup reports ${mode} without claiming scene access`, async t => {
    const f = await fixture(t, mode); const r = await ensureService(f.options);
    assert.equal(r.code, code); assert.equal(r.hostControlVerified, false); assert.equal(f.counts().dispatches, 1);
  });
}
test('macOS remains outside the Windows service dispatcher', async () => {
  const result = await ensureService({ args: ['--start'], platform: 'darwin', prepare: () => assert.fail('must not prepare') });
  assert.equal(result.code, 'service_startup_unsupported_platform');
});
