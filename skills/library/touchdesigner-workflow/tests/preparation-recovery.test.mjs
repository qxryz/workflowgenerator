import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConnector } from '../scripts/prepare-connector.mjs';

const env = {
  GATEWAY_URL: 'http://127.0.0.1:8123',
  HILO_WORKSPACE_CLAIM: 'a'.repeat(64),
  HILO_WORKSPACE_INSTANCE_ID: 'b31f0ea8-9baa-4b0d-bf47-c1fdcd4298c5',
  HILO_WORKSPACE_GENERATION: '1',
};
const state = (state, extra = {}) => ({ ok: true, connectorId: 'touchdesigner',
  state, startupSupported: false, mcpConnected: false, hostControlVerified: false, ...extra });
const missing = state('not_installed');
const failed = state('failed', { ok: false, code: 'package_download_failed' });
const ready = state('installed', { mcpConnected: true });

async function run(replies) {
  const actions = [];
  const result = await prepareConnector({ args: ['--install'], env,
    fetchImpl: async (_url, init) => {
      actions.push(JSON.parse(init.body).action);
      assert.ok(replies.length, 'unexpected retry');
      return Response.json(replies.shift());
    } });
  return { actions, result };
}

test('terminal package failure is rechecked and retried once, then resumes readiness', async () => {
  const { actions, result } = await run([missing, failed, missing, ready]);
  assert.deepEqual(actions, ['status', 'install', 'status', 'install']);
  assert.equal(result.ok, true);
  assert.equal(result.preparationRetried, true);
  assert.equal(result.hostControlVerified, false);
});

test('repeated package failure exhausts the budget without an install loop', async () => {
  const { actions, result } = await run([missing, failed, missing, failed]);
  assert.equal(actions.length, 4);
  assert.equal(result.code, 'package_download_failed');
  assert.equal(result.preparationRetried, true);
});

test('another session installing, connected or failed status prevents duplicate retry', async () => {
  for (const current of [state('installing', { ok: false, code: 'busy' }), ready,
    state('failed', { ok: false, code: 'desktop_access_denied' })]) {
    const { actions, result } = await run([missing, failed, current]);
    assert.deepEqual(actions, ['status', 'install', 'status']);
    assert.deepEqual(result, current);
  }
});

test('authorization, addon failure and unknown results are not replayed', async () => {
  for (const code of ['desktop_access_denied', 'addon_install_failed', 'preparation_result_unavailable']) {
    const failure = state('failed', { ok: false, code });
    const { actions, result } = await run([missing, failure]);
    assert.deepEqual(actions, ['status', 'install']);
    assert.equal(result.code, code);
  }
});

test('already connected installations are not changed', async () => {
  const { actions, result } = await run([ready]);
  assert.deepEqual(actions, ['status']);
  assert.deepEqual(result, ready);
});
