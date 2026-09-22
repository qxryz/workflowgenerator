import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { repairWindowsDependencies } from '../scripts/windows-dependencies.mjs';

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'runtime 中文 ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'python-packages', 'blender-mcp');
  const python = path.join(base, 'python', 'python.exe');
  await mkdir(root, { recursive: true }); await mkdir(path.dirname(python)); await writeFile(python, 'never execute');
  return { base, root, python };
}
test('repair selects the managed Python, with isolation, literal paths and a bounded timeout', async t => {
  const { root, python } = await fixture(t);
  const result = await repairWindowsDependencies({ packageDir: root, env: { PATH: 'unrelated interpreter' },
    executeImpl: async (command, args, options) => {
      assert.equal(command, python); assert.deepEqual(args.slice(0, 2), ['-I', '-B']);
      assert.deepEqual(args.slice(-2), ['--repair', root]);
      assert.equal(options.windowsHide, true); assert.equal(options.timeout, 180000);
      return { stdout: JSON.stringify({ ok: true, repaired: true, code: 'dependencies_ready' }) };
    } });
  assert.equal(result.repaired, true);
});
test('unsupported package or relative interpreter never starts a repair', async t => {
  const { base, root } = await fixture(t);
  const executeImpl = () => assert.fail('unexpected execution');
  assert.equal((await repairWindowsDependencies({ packageDir: base, executeImpl })).code, 'unsupported_package_layout');
  assert.equal((await repairWindowsDependencies({ packageDir: root, env: { HUB_PYTHON: 'python.exe' }, executeImpl })).code, 'managed_python_unavailable');
});
test('a killed repair is unknown, not proof of a terminal installation failure', async t => {
  const { root } = await fixture(t);
  const result = await repairWindowsDependencies({ packageDir: root, executeImpl: async () => {
    throw Object.assign(Error('timeout'), { killed: true });
  } });
  assert.equal(result.code, 'dependency_repair_outcome_unknown'); assert.equal(result.ok, false);
});
