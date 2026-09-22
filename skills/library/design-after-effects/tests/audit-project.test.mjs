import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = fs.readFileSync(new URL('../scripts/audit-project.jsx', import.meta.url), 'utf8');
class CompItem {
  constructor(id, layers = []) { Object.assign(this, {id, name: `Comp ${id}`, width: 1920, height: 1080, duration: 4, frameRate: 25, numLayers: layers.length, useProxy: false, layer: i => layers[i - 1]}); }
}
class FootageItem {
  constructor(id, exists) { Object.assign(this, {id, name: 'Media', file: {fsName: '/fixture/media.mp4', exists}, hasVideo: true, hasAudio: false, useProxy: false}); }
}
class TextLayer {}
function layer(id, source = null, properties = []) {
  return {id, name: `Layer ${id}`, matchName: 'ADBE Vector Layer', enabled: true, parent: null,
    source, numProperties: properties.length, property: i => properties[i - 1]};
}
function run(items, prefix = '', hasProject = true) {
  const project = {file: null, numItems: items.length, item: i => items[i - 1],
    save() { throw Error('Audit must not save'); }, close() { throw Error('Audit must not close'); }};
  const context = {app: {project: hasProject ? project : null}, CompItem, FootageItem, TextLayer, PropertyType: {PROPERTY: 1}};
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(function(){${prefix}\n${script}\n})()`, context)));
}
test('no open project and unsaved empty project are not reported as inspected', () => {
  assert.equal(run([], '', false).status, 'no-project');
  assert.equal(run([]).status, 'empty');
  assert.equal(run([]).projectPath, null);
});
test('target closure detects missing media, deduplicates shared sources and excludes unrelated media', () => {
  const media = new FootageItem(9, false), unrelated = new FootageItem(10, true);
  const r = run([new CompItem(1, [layer(2, media), layer(3, media)]), media, unrelated], 'var AUDIT_COMP_IDS=[1];');
  assert.equal(r.status, 'issues-found');
  assert.equal(r.files.length, 1);
  assert.deepEqual(r.missingFiles, ['/fixture/media.mp4']);
});
test('expression failures are reported with object identity', () => {
  const prop = {propertyType: 1, numKeys: 2, canSetExpression: true, expressionEnabled: true, expressionError: 'Missing controller'};
  const r = run([new CompItem(1, [layer(2, null, [prop])])]);
  assert.equal(r.status, 'issues-found');
  assert.equal(r.counts.keyframes, 2);
  assert.match(r.expressionErrors[0].at, /comp:1\/layer:2/);
});
test('unresolvable scope and unreadable properties cannot pass', () => {
  assert.equal(run([new CompItem(1)], 'var AUDIT_COMP_IDS=[999];').status, 'incomplete');
  assert.equal(run([new CompItem(1)], 'var AUDIT_COMP_IDS=[];').status, 'incomplete');
  const prop = {get propertyType() {throw Error('Unavailable');}};
  assert.equal(run([new CompItem(1, [layer(2, null, [prop])])]).status, 'incomplete');
});
test('oversized projects are explicitly truncated', () => {
  const r = run([new CompItem(1, Array.from({length: 3001}, (_, i) => layer(i + 2)))]);
  assert.equal(r.status, 'incomplete');
  assert.equal(r.truncated, true);
});
test('valid unsaved composition inspection retains null path without saving', () => {
  const r = run([new CompItem(1, [layer(2)])]);
  assert.equal(r.status, 'inspected');
  assert.equal(r.projectPath, null);
});
