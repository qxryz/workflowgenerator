import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConnector } from '../scripts/prepare-connector.mjs';
const env = { GATEWAY_URL: 'http://127.0.0.1:8123', HILO_WORKSPACE_CLAIM: 'a'.repeat(64),
  HILO_WORKSPACE_INSTANCE_ID: 'b31f0ea8-9baa-4b0d-bf47-c1fdcd4298c5', HILO_WORKSPACE_GENERATION: '1' };
const state = (state, extra = {}) => ({ ok: true, connectorId: 'blender', state,
  startupSupported: false, mcpConnected: false, hostControlVerified: false, ...extra });
const missing = state('not_installed');
const staged = state('not_installed', { packageDir: 'C:\\中文 包\\blender-mcp' });
const failed = state('failed', { ok: false, code: 'addon_install_failed' });
const ready = state('installed', { mcpConnected: true });
async function run(replies, recovery) {
  const actions = [];
  const result = await prepareConnector({ args: ['--install'], env, platform: 'win32',
    repairImpl: async ({ packageDir }) => { assert.equal(packageDir, staged.packageDir); actions.push('repair'); return recovery; },
    fetchImpl: async (_url, init) => { actions.push(JSON.parse(init.body).action); assert.ok(replies.length); return Response.json(replies.shift()); } });
  return { result, actions };
}
test('clean Windows addon failure diagnoses, repairs and retries once after rechecking ownership', async () => {
  const { result, actions } = await run([missing, failed, staged, staged, ready], { ok: true, repaired: true });
  assert.deepEqual(actions, ['status', 'install', 'status', 'repair', 'status', 'install']);
  assert.equal(result.preparationRetried, true); assert.equal(result.hostControlVerified, false);
});
test('unrelated failures and unverified repairs never replay installation', async () => {
  for (const recovery of [{ ok: false, code: 'dependency_conflict' }, { ok: true, code: 'dependencies_ready' }]) {
    const { result, actions } = await run([missing, failed, staged], recovery);
    assert.equal(result.code, 'addon_install_failed'); assert.equal(actions.filter(a => a === 'install').length, 1);
  }
});
test('busy or changed workspace after repair prevents retry; repeated addon failure stops', async () => {
  const recovery = { ok: true, repaired: true };
  for (const current of [state('installing', { ok: false }), state('not_installed', { packageDir: 'C:\\other' }), ready]) {
    const { result, actions } = await run([missing, failed, staged, current], recovery);
    assert.equal(actions.filter(a => a === 'install').length, 1);
    if (current.packageDir === 'C:\\other') {
      assert.equal(result.ok, false); assert.equal(result.code, 'package_changed');
    }
  }
  const { result, actions } = await run([missing, failed, staged, staged, failed], recovery);
  assert.equal(result.code, 'addon_install_failed'); assert.equal(actions.filter(a => a === 'install').length, 2);
});
