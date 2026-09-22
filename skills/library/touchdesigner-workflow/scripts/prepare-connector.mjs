#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Adapter for the desktop connector-preparation contract. The desktop owns
// download sources, elevation, registration and hot-apply; this script owns none.
const endpoint = '/api/connectors/prepare';
const help = `Usage: node prepare-connector.mjs [--status | --install]
Run inside the current Design conversation's local command environment.
No arguments (or --status): inspect without installing.
--install: inspect first, then install/enable only if not already connected.
Uses the host-provided GATEWAY_URL and HILO_WORKSPACE_* binding; never scans
ports or reads credentials/config files. Missing binding requires a supported
Design runtime. No endpoint/password arguments are accepted.
Installation can show a system authorization dialog. Handle passwords there.
If a command runner needs a timeout, allow at least 1260000 ms for --install.
After a confirmed package failure, recheck status and retry preparation once.
Never retry an unknown outcome, authorization failure or an active installation.
The retry budget is already included; do not loop this command on failure.
After timeout/interruption, check --status before deciding whether to retry.
Installed/MCP-connected does not prove TouchDesigner is running or network control responds.
Read the actual project and target network through the current conversation before editing.
This helper prepares the registered TouchDesigner connector; it does not install TouchDesigner itself or import its in-project connection component.`;

function failure(code, message) {
  return { ok: false, code, message, hostControlVerified: false };
}

function binding(env) {
  const url = new URL(env.GATEWAY_URL);
  const generation = env.HILO_WORKSPACE_GENERATION;
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !/^[a-f0-9]{64}$/.test(env.HILO_WORKSPACE_CLAIM || '')
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(env.HILO_WORKSPACE_INSTANCE_ID || '')
      || !/^[1-9][0-9]*$/.test(generation || '') || !Number.isSafeInteger(Number(generation))) {
    throw new Error('Missing current workspace binding');
  }
  return {
    url: new URL(endpoint, url),
    headers: {
      'Content-Type': 'application/json',
      'x-hilo-workspace': env.HILO_WORKSPACE_CLAIM,
      'x-hilo-workspace-instance': env.HILO_WORKSPACE_INSTANCE_ID,
      'x-hilo-workspace-generation': generation,
    },
  };
}

function parseResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.connectorId !== 'touchdesigner' || typeof value.ok !== 'boolean'
      || !['not_installed', 'installing', 'installed', 'failed'].includes(value.state)
      || typeof value.startupSupported !== 'boolean' || typeof value.mcpConnected !== 'boolean'
      || value.hostControlVerified !== false) throw new Error('Invalid response');
  const result = { ok: value.ok, connectorId: 'touchdesigner', state: value.state,
    startupSupported: value.startupSupported, mcpConnected: value.mcpConnected,
    hostControlVerified: false };
  for (const key of ['packageDir', 'packageVersion', 'code']) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string') throw new Error('Invalid response');
      result[key] = value[key];
    }
  }
  return result;
}

export async function prepareConnector({ args = [], env = process.env, fetchImpl = fetch,
  timeoutMs = 600000 } = {}) {
  if (args.length > 1 || (args.length === 1 && !['--status', '--install'].includes(args[0]))) {
    return failure('invalid_arguments', 'Use --help. Only --status or --install is accepted.');
  }
  let target;
  try { target = binding(env); } catch {
    return failure('desktop_context_unavailable',
      'Run from the current Design conversation. A compatible desktop workspace binding is required; do not guess ports or copy credentials.');
  }
  async function request(action) {
    try {
      const response = await fetchImpl(target.url, {
        method: 'POST', headers: target.headers, redirect: 'error',
        body: JSON.stringify({ connectorId: 'touchdesigner', action }),
        signal: AbortSignal.timeout(action === 'install' ? timeoutMs : Math.min(timeoutMs, 15000)),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 404 ? 'desktop_update_required'
          : [409, 428].includes(response.status) ? 'workspace_binding_changed'
          : response.status === 401 || response.status === 403 ? 'desktop_access_denied'
          : 'preparation_result_unavailable';
        return failure(code, 'Installation was not verified. Check --status before retrying; use the connector page if the desktop does not support this entry.');
      }
      return parseResult(await response.json());
    } catch {
      return failure('preparation_result_unavailable',
        'No verified result. Installation may still be running: check --status before retrying. No TouchDesigner control has been verified.');
    }
  }
  const status = await request('status');
  if (args[0] !== '--install' || !status.ok || status.state === 'installing'
      || (status.state === 'installed' && status.mcpConnected)) return status;
  const installed = await request('install');
  if (installed.ok || installed.state !== 'failed'
      || installed.code !== 'package_download_failed') return installed;
  const current = await request('status');
  if (!current.ok || current.state === 'installing'
      || (current.state === 'installed' && current.mcpConnected)) return current;
  if (current.state !== 'not_installed') return installed;
  return { ...await request('install'), preparationRetried: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(help);
  } else {
    const result = await prepareConnector({ args: process.argv.slice(2) });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 2;
  }
}
