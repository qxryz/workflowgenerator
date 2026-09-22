// Serialize bridge startup across conversations. This is not a project-edit lock.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function readOwner(lock) {
  try {
    if (!fs.lstatSync(lock).isDirectory() || fs.lstatSync(lock).isSymbolicLink()) return null;
    const file = path.join(lock, 'owner.json');
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value?.schema === 1 && Number.isInteger(value.pid) && value.pid > 0
      && typeof value.nonce === 'string' && /^[a-f0-9-]{36}$/.test(value.nonce)
      && Number.isFinite(value.expiresAt) ? value : null;
  } catch { return null; }
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; } // denied/unknown is never proof of death
}
export function startupLockPath(root, app, platform) {
  return path.join(root, `design-ae-panel-${createHash('sha256')
    .update(platform === 'win32' ? app.toLowerCase() : app).digest('hex').slice(0, 24)}.lock`);
}
export function inspectStartupLock(lock, { alive = processAlive, now = Date.now } = {}) {
  try { fs.lstatSync(lock); }
  catch (error) { return { state: error.code === 'ENOENT' ? 'absent' : 'unresolved' }; }
  const owner = readOwner(lock);
  if (!owner) return { state: 'unresolved' };
  return { state: owner.expiresAt < now() && !alive(owner.pid) ? 'stale' : 'active',
    pid: owner.pid, expiresAt: owner.expiresAt, nonce: owner.nonce };
}

function recover(lock, observed, dependencies) {
  // Only one reclaimer may inspect/delete a dead owner's directory. Unknown old
  // locks have no ownership proof and are deliberately left for diagnosis.
  const guard = path.join(lock, 'recovery');
  try { fs.mkdirSync(guard); } catch { return false; }
  let moved = false;
  try {
    const current = inspectStartupLock(lock, dependencies);
    if (current.state !== 'stale' || current.nonce !== observed.nonce) return false;
    fs.rmSync(path.join(lock, `permit-${current.nonce}`), { force: true });
    const retired = `${lock}.retired-${randomUUID()}`;
    fs.renameSync(lock, retired);
    moved = true;
    fs.rmSync(retired, { recursive: true, force: true });
    return true;
  } finally {
    if (!moved) fs.rmSync(guard, { recursive: true, force: true });
  }
}

export async function acquireStartupLock(lock, { deadline, alive = processAlive,
  now = Date.now, sleep = pause, pollMs = 250 } = {}) {
  let waited = false;
  for (;;) {
    const state = inspectStartupLock(lock, { alive, now });
    if (state.state === 'absent') {
      // Another task's completion is a reason to check MCP, not reload its panel.
      if (waited) return { acquired: false, status: 'startup_finished_recheck' };
      if (now() >= deadline) return { acquired: false, status: 'startup_busy' };
      try { fs.mkdirSync(lock, { mode: 0o700 }); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      const owner = { schema: 1, pid: process.pid, nonce: randomUUID(), expiresAt: deadline };
      try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); }
      catch (error) { fs.rmSync(lock, { recursive: true, force: true }); throw error; }
      return { acquired: true, ...owner };
    }
    if (state.state === 'stale' && recover(lock, state, { alive, now })) {
      return { acquired: false, status: 'lock_recovered_recheck' };
    }
    if (now() >= deadline) return { acquired: false,
      status: state.state === 'unresolved' ? 'startup_lock_unresolved' : 'startup_busy' };
    waited = true;
    await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
  }
}

export function releaseStartupLock(lock, nonce) {
  if (readOwner(lock)?.nonce !== nonce) return;
  fs.rmSync(path.join(lock, `permit-${nonce}`), { force: true });
  fs.rmSync(lock, { recursive: true, force: true });
}
