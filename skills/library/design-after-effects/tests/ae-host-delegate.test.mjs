import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { delegate, parseArgs, resolveStartup } from '../scripts/ae-host.mjs';

function fixture(t, script = 'console.log(JSON.stringify(process.argv.slice(2)))') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ae delegation 中文 '));
  t.after(() => fs.rmSync(base, {recursive:true, force:true}));
  const root = path.join(base, 'package');
  fs.mkdirSync(path.join(root, 'scripts'), {recursive:true});
  const metadata = {name:'after-effects-mcp',version:'test',designAeStartup:{protocolVersion:1,entry:'scripts/start-bridge.mjs'}};
  fs.writeFileSync(path.join(root,'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(root,'scripts/start-bridge.mjs'), script);
  return {root,base,metadata,save(){fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(metadata));}};
}

test('delegates literal arguments to the declared package entry without changing files', async t => {
  const f=fixture(t), aePath='/Applications/AE "quoted" $value.app';
  const args=['inspect','--mcp-root',f.root,'--ae-path',aePath,'--timeout','5000'];
  const result=await delegate(args);
  assert.equal(result.exitCode,0);
  assert.deepEqual(JSON.parse(result.stdout),['inspect','--timeout','5000','--ae-path',aePath]);
  assert.deepEqual(fs.readdirSync(f.root).sort(),['package.json','scripts']);
});
test('preserves package result and failure rather than claiming readiness', async t => {
  const f=fixture(t,'console.log(JSON.stringify({ok:false,status:"busy"}));process.exitCode=7;');
  const result=await delegate(['start','--mcp-root',f.root]);
  assert.equal(result.exitCode,7);assert.deepEqual(JSON.parse(result.stdout),{ok:false,status:'busy'});
});
test('unsupported legacy package and changed protocol are rejected before launch', t => {
  const f=fixture(t);delete f.metadata.designAeStartup;f.save();
  assert.throws(()=>resolveStartup(f.root),e=>e.status==='startup_unsupported');
  f.metadata.designAeStartup={protocolVersion:2,entry:'scripts/start-bridge.mjs'};f.save();
  assert.throws(()=>resolveStartup(f.root),e=>e.status==='startup_unsupported');
});
test('path traversal and symlinks cannot redirect startup outside the registered package', t => {
  const f=fixture(t), outside=path.join(f.base,'outside.mjs');fs.writeFileSync(outside,'throw Error("must not run")');
  f.metadata.designAeStartup.entry='../outside.mjs';f.save();
  assert.throws(()=>resolveStartup(f.root),e=>e.status==='invalid_package');
  fs.symlinkSync(outside,path.join(f.root,'scripts/link.mjs'));
  f.metadata.designAeStartup.entry='scripts/link.mjs';f.save();
  assert.throws(()=>resolveStartup(f.root),e=>e.status==='invalid_package');
});
test('rejects malformed options before delegation', t => {
  const f=fixture(t);
  for(const args of [ ['start','--mcp-root',f.root,'--timeout','0'], ['start','--mcp-root',f.root,'--mcp-root',f.root], ['start','--mcp-root',f.root,'--extra','value'], ['start'], ['install','--mcp-root',f.root] ]) {
    assert.throws(()=>parseArgs(args));
  }
});

test('interrupted startup is reported as unknown rather than safe to retry', async t => {
  const f=fixture(t,'process.kill(process.pid,"SIGTERM")');
  await assert.rejects(()=>delegate(['start','--mcp-root',f.root]),e=>e.status==='outcome_unknown');
});

test('permission repair and diagnostics cannot be silently forwarded to an unknown package contract', t => {
  const f = fixture(t);
  assert.throws(() => parseArgs(['start', '--mcp-root', f.root, '--enable-script-access']), e => e.status === 'startup_unsupported');
  assert.throws(() => parseArgs(['diagnose', '--mcp-root', f.root]), e => e.status === 'startup_unsupported');
  assert.throws(() => parseArgs(['inspect', '--mcp-root', f.root, '--enable-script-access']), e => e.status === 'invalid_arguments');
});
