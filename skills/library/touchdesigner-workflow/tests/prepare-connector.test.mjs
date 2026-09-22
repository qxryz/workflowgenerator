import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { prepareConnector } from '../scripts/prepare-connector.mjs';

const context = {
  GATEWAY_URL: 'http://127.0.0.1:8123',
  HILO_WORKSPACE_CLAIM: 'a'.repeat(64),
  HILO_WORKSPACE_INSTANCE_ID: 'b31f0ea8-9baa-4b0d-bf47-c1fdcd4298c5',
  HILO_WORKSPACE_GENERATION: '1',
};
const status = (state, connected = false) => ({ ok: true, connectorId: 'touchdesigner',
  state, startupSupported: false, mcpConnected: connected, hostControlVerified: false });

test('missing/remote/unbound context fails without network access', async () => {
  for (const env of [{}, { ...context, GATEWAY_URL: 'https://example.com' },
    { ...context, HILO_WORKSPACE_INSTANCE_ID: '' },
    { ...context, GATEWAY_URL: 'http://user:password@127.0.0.1:8123' }]) {
    const result = await prepareConnector({ env, args: ['--install'], fetchImpl: () => assert.fail('network') });
    assert.equal(result.code, 'desktop_context_unavailable');
  }
});

test('status only inspects and carries current workspace headers', async () => {
  let calls = 0;
  const result = await prepareConnector({ env: context, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url.href, 'http://127.0.0.1:8123/api/connectors/prepare');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['x-hilo-workspace'], context.HILO_WORKSPACE_CLAIM);
    assert.equal(init.headers['x-hilo-workspace-instance'], context.HILO_WORKSPACE_INSTANCE_ID);
    assert.deepEqual(JSON.parse(init.body), { connectorId: 'touchdesigner', action: 'status' });
    return Response.json({ ...status('not_installed'), token: 'must-not-echo' });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, status('not_installed'));
});

test('real HTTP round trip installs missing package, then skips an already connected installation', async () => {
  const actions = [];
  let installed = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    actions.push(request.action);
    if (request.action === 'install') installed = true;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(status(installed ? 'installed' : 'not_installed', installed)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const env = { ...context, GATEWAY_URL: `http://127.0.0.1:${server.address().port}` };
    assert.deepEqual(await prepareConnector({ env, args: ['--install'] }), status('installed', true));
    assert.deepEqual(await prepareConnector({ env, args: ['--install'] }), status('installed', true));
    assert.deepEqual(actions, ['status', 'install', 'status']);
  } finally { server.closeAllConnections(); server.close(); }
});

test('unsupported endpoint and stale binding do not start installation', async () => {
  for (const [http, code] of [[404, 'desktop_update_required'], [409, 'workspace_binding_changed'], [403, 'desktop_access_denied']]) {
    let calls = 0;
    const result = await prepareConnector({ env: context, args: ['--install'], fetchImpl: async () => {
      calls++; return new Response('private internal details', { status: http });
    } });
    assert.equal(calls, 1);
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('busy state, forged TouchDesigner verification and invalid arguments do not install', async () => {
  for (const body of [{ ...status('installing'), ok: false, code: 'busy' }, { ...status('installed'), hostControlVerified: true }]) {
    let calls = 0;
    const result = await prepareConnector({ env: context, args: ['--install'], fetchImpl: async () => {
      calls++; return Response.json(body);
    } });
    assert.equal(calls, 1);
    assert.equal(result.hostControlVerified, false);
    assert.equal(result.ok, false);
  }
  const result = await prepareConnector({ env: context, args: ['--url', 'anything'], fetchImpl: () => assert.fail('network') });
  assert.equal(result.code, 'invalid_arguments');
});

test('unknown installation outcome is never retried automatically', async () => {
  let calls = 0;
  const result = await prepareConnector({ env: context, args: ['--install'], fetchImpl: async () => {
    if (++calls === 1) return Response.json(status('not_installed'));
    throw new Error('connection closed after install request');
  } });
  assert.equal(calls, 2);
  assert.equal(result.code, 'preparation_result_unavailable');
});

// A successful response for another application must not authorize this install.
test('rejects a different connector identity without installing', async () => {
  let calls = 0;
  const result = await prepareConnector({ env: context, args: ['--install'], fetchImpl: async () => {
    calls++; return Response.json({ ...status('installed', true), connectorId: 'after-effects' });
  } });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'preparation_result_unavailable');
});
