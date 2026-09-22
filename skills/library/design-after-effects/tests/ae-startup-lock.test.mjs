import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStartupLock, inspectStartupLock, releaseStartupLock, startupLockPath } from '../scripts/ae-startup-lock.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae lock test '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return startupLockPath(root, '/Applications/AE.app', 'darwin');
}
test('only the owner may release the lock; active owner is not reclaimed even after expiry', async t => {
  const lock = fixture(t), first = await acquireStartupLock(lock, { deadline: Date.now() + 1000 });
  releaseStartupLock(lock, randomUUID()); assert.equal(fs.existsSync(lock), true);
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'))); owner.expiresAt = 0;
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner));
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 15, pollMs: 3 });
  assert.equal(result.status, 'startup_busy'); assert.equal(fs.existsSync(lock), true);
  releaseStartupLock(lock, first.nonce); assert.equal(fs.existsSync(lock), false);
});
test('expired dead owner is reclaimed but caller must verify connection before another dispatch', async t => {
  const lock = fixture(t), nonce = randomUUID(); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ schema: 1, nonce, pid: 123456, expiresAt: 0 }));
  fs.writeFileSync(path.join(lock, `permit-${nonce}`), nonce);
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 100, alive: () => false });
  assert.equal(result.acquired, false); assert.equal(result.status, 'lock_recovered_recheck');
  assert.equal(fs.existsSync(lock), false);
});
test('unexpired dead owner retains delayed-script protection until deadline', async t => {
  const lock = fixture(t), nonce = randomUUID(); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ schema: 1, nonce, pid: 123456, expiresAt: Date.now() + 10000 }));
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 10, alive: () => false, pollMs: 2 });
  assert.equal(result.status, 'startup_busy'); assert.equal(fs.existsSync(lock), true);
});
test('legacy or malformed lock is identified separately and never deleted automatically', async t => {
  const lock = fixture(t); fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'permit'), 'old');
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 10, pollMs: 2 });
  assert.equal(result.status, 'startup_lock_unresolved');
  assert.equal(fs.readFileSync(path.join(lock, 'permit'), 'utf8'), 'old');
});
test('lock symlink is not followed or reclaimed', async t => {
  const lock = fixture(t), outside = `${lock}-outside`; fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'owner.json'), JSON.stringify({ schema: 1, nonce: randomUUID(), pid: 123456, expiresAt: 0 }));
  fs.symlinkSync(outside, lock);
  assert.equal(inspectStartupLock(lock, { alive: () => false }).state, 'unresolved');
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 10, pollMs: 2, alive: () => false });
  assert.equal(result.status, 'startup_lock_unresolved'); assert.equal(fs.existsSync(outside), true);
});
test('dangling lock symlink is bounded and does not create an infinite mkdir loop', async t => {
  const lock = fixture(t); fs.symlinkSync(`${lock}-missing`, lock);
  const result = await acquireStartupLock(lock, { deadline: Date.now() + 10, pollMs: 2 });
  assert.equal(result.status, 'startup_lock_unresolved'); assert.equal(fs.lstatSync(lock).isSymbolicLink(), true);
});
