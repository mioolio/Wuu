// Offline regression for mobile play counts and real userdata persistence.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Module, createRequire } = require('module');
const { incrementPlayCount } = require('../server/play-count');
const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, '.test-artifacts');
fs.mkdirSync(artifactRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(artifactRoot, 'play-count-'));
const config = path.join(fixture, 'config');
const target = 'C:/music/one.wav';

const legacy = { stats: { [target]: 7 } };
assert.equal(incrementPlayCount(legacy, target), 8);
assert.deepEqual(legacy.stats[target], { plays: 8, duration: 0 });
const empty = {};
assert.equal(incrementPlayCount(empty, target), 1);
assert.deepEqual(empty.stats[target], { plays: 1, duration: 0 });
for (const value of [NaN, Infinity, -2, '[object Object]1', null]) {
  const invalid = { stats: { [target]: value } };
  assert.equal(incrementPlayCount(invalid, target), 1);
}

const initial = {
  stats: {
    [target]: { plays: 4, duration: 900, recentDays: { '2026-10-01': { plays: 2, duration: 120 } }, custom: 'preserved' },
    other: { plays: 1, duration: 22 },
  },
  genreOverrides: { [target]: [], other: ['Folk'] },
  collections: [{ id: 'a', name: 'Saved', songs: [target] }],
  progress: { [target]: 42 }, settings: { syncMode: 'merged' },
};
const data = structuredClone(initial);
assert.equal(incrementPlayCount(data, target), 5);
assert.deepEqual(data.stats[target], { ...initial.stats[target], plays: 5 });
assert.deepEqual(data.genreOverrides, initial.genreOverrides);
assert.deepEqual(data.stats.other, initial.stats.other);
assert.deepEqual(data.progress, initial.progress);

// Load the production storage module with only its config directory and Electron
// registration redirected, then exercise write/read rather than a JSON-only mock.
const filename = path.join(root, 'core', 'storage.js');
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = Module._nodeModulePaths(path.dirname(filename));
const requireLocal = createRequire(filename);
isolated.require = name => {
  if (name === 'electron') return { ipcMain: { handle: () => {}, on: () => {} } };
  if (name === 'path') return { ...path, join: (...parts) => {
    const joined = path.join(...parts);
    return joined === path.join(root, 'config') ? config : joined;
  } };
  return requireLocal(name);
};
isolated._compile(fs.readFileSync(filename, 'utf8'), filename);
const storage = isolated.exports;
assert.equal(storage.writeUserData(data), true);
const persisted = storage.readUserData();
assert.deepEqual(persisted.stats, data.stats);
assert.deepEqual(persisted.genreOverrides, initial.genreOverrides);
assert.deepEqual(persisted.collections, initial.collections);
assert.deepEqual(persisted.progress, initial.progress);
assert.equal(incrementPlayCount(persisted, target), 6);
assert.equal(storage.writeUserData(persisted), true);
const reloaded = storage.readUserData();
assert.equal(reloaded.stats[target].plays, 6);
assert.equal(reloaded.stats[target].duration, 900);
assert.deepEqual(reloaded.stats[target].recentDays, initial.stats[target].recentDays);
assert.deepEqual(reloaded.genreOverrides, initial.genreOverrides);
console.log(JSON.stringify({ ok: true, checks: ['numeric legacy counts become SongStats', 'object updates preserve duration, recentDays and extra fields', 'corrupt counters return a numeric count', 'real storage roundtrip preserves manual genre clearing and other user data', 'repeat reports increment without losing prior history'], fixture }, null, 2));
