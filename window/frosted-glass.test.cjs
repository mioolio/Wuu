const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFrostedGlassSupport, applyFrostedGlass, configureFrostedGlass } = require('./frosted-glass');

function fixture() {
  const materials = [], vibrancy = [];
  return { materials, vibrancy, setBackgroundMaterial(value) { materials.push(value); }, setVibrancy(value) { vibrancy.push(value); } };
}

test('Windows support requires the native API and Windows 11 22H2 build', () => {
  const win = fixture();
  for (const version of ['10.0.19045', '10.0.22000', 'invalid']) assert.equal(getFrostedGlassSupport(win, 'win32', version).supported, false);
  assert.equal(getFrostedGlassSupport(win, 'win32', '10.0.22621').supported, true);
  assert.equal(getFrostedGlassSupport(win, 'win32', '10.0.26200').supported, true);
  assert.equal(getFrostedGlassSupport({}, 'win32', '10.0.26200').supported, false);
  assert.equal(getFrostedGlassSupport(win, 'linux').supported, false);
});

test('unsupported Windows never invokes an ineffective native material', () => {
  const win = fixture();
  assert.equal(applyFrostedGlass(win, true, 'win32', '10.0.19045').ok, false);
  assert.equal(applyFrostedGlass(win, false, 'win32', '10.0.19045').ok, true);
  assert.deepEqual(win.materials, []);
});

test('on/off changes only the native backdrop and duplicate updates are harmless', () => {
  const win = fixture();
  assert.equal(applyFrostedGlass(win, true, 'win32', '10.0.22621').enabled, true);
  applyFrostedGlass(win, true, 'win32', '10.0.22621');
  assert.equal(applyFrostedGlass(win, false, 'win32', '10.0.22621').enabled, false);
  assert.deepEqual(win.materials, ['acrylic', 'none']);
});

test('only literal true enables the experiment', () => {
  const win = fixture();
  for (const value of ['true', 1, undefined, null]) assert.equal(applyFrostedGlass(win, value, 'win32', '10.0.22621').enabled, false);
  assert.deepEqual(win.materials, ['none']);
});

test('macOS enables behind-window vibrancy and removes it with null', () => {
  const win = fixture();
  assert.equal(applyFrostedGlass(win, true, 'darwin').enabled, true);
  assert.equal(applyFrostedGlass(win, false, 'darwin').enabled, false);
  assert.deepEqual(win.vibrancy, ['under-window', null]);
});

test('classic mode blocks stale enable requests and returning modern restores preference', () => {
  const win = fixture();
  configureFrostedGlass(win, { interfaceMode: 'modern', experimentalFrostedGlass: true }, 'win32', '10.0.22621');
  configureFrostedGlass(win, { interfaceMode: 'classic', experimentalFrostedGlass: true }, 'win32', '10.0.22621');
  const result = applyFrostedGlass(win, true, 'win32', '10.0.22621');
  assert.equal(result.enabled, false);
  assert.deepEqual(win.materials, ['acrylic', 'none']);
  configureFrostedGlass(win, { interfaceMode: 'modern', experimentalFrostedGlass: true }, 'win32', '10.0.22621');
  assert.equal(applyFrostedGlass(win, true, 'win32', '10.0.22621').enabled, true);
  assert.equal(win.materials.at(-1), 'acrylic');
});

test('a failed material update does not mark the requested state as applied', () => {
  const win = fixture();
  win.setBackgroundMaterial = () => { throw new Error('native failure'); };
  const result = applyFrostedGlass(win, true, 'win32', '10.0.22621');
  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  win.setBackgroundMaterial = value => win.materials.push(value);
  assert.equal(applyFrostedGlass(win, true, 'win32', '10.0.22621').ok, true);
  assert.deepEqual(win.materials, ['acrylic']);
});
