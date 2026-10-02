// Offline startup regression: real scanner/preload, isolated disk and deferred tags.
// Run: node --test audio/library-startup.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Module, createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, '.test-artifacts');

function load(filename, stubs, prefix = '') {
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = Module._nodeModulePaths(path.dirname(filename));
  const localRequire = createRequire(filename);
  isolated.require = name => Object.hasOwn(stubs, name) ? stubs[name] : localRequire(name);
  isolated._compile(prefix + fs.readFileSync(filename, 'utf8'), filename);
  return isolated.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Deferred metadata condition did not settle');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

function fixture(t, parse) {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(artifactRoot, 'library-startup-'));
  const library = path.join(directory, 'library');
  fs.mkdirSync(library);
  t.after(() => {
    assert.equal(path.dirname(directory), artifactRoot);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const events = [], calls = [], durationBatches = [], timers = new Map();
  let sequence = 0, active = 0, maxActive = 0;
  const schedule = (kind, callback, delay) => {
    const id = ++sequence;
    timers.set(id, { kind, callback, delay });
    return id;
  };
  const genres = load(path.join(root, 'audio', 'genres.js'), {
    'music-metadata': { parseFile: async (file, options) => {
      assert.deepEqual(options, { skipCovers: true, duration: false });
      calls.push(file); active++; maxActive = Math.max(maxActive, active);
      try { return await parse(file, calls.filter(item => item === file).length); }
      finally { active--; }
    } },
  });
  const handlers = new Map();
  const scanner = load(path.join(root, 'audio', 'scanner.js'), {
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    '../core/logger': { dbgLog: () => {} },
    '../core/storage': { getCachedDuration: () => 0 },
    '../core/state': { sendToMain: (channel, payload) => events.push({ channel, ...payload }) },
    './duration': { parseDurationsInBackground: songs => durationBatches.push(songs) },
    './genres': genres,
    path: { ...path, join: (...parts) => {
      const result = path.join(...parts);
      return result === path.join(root, 'output') ? library : result;
    } },
    'fixture-scheduler': {
      setImmediate: callback => schedule('genre', callback),
      clearImmediate: id => timers.delete(id),
      setTimeout: (callback, delay) => schedule('duration', callback, delay),
      clearTimeout: id => timers.delete(id),
    },
  }, "const { setImmediate, clearImmediate, setTimeout, clearTimeout } = require('fixture-scheduler');\n");
  const run = kind => {
    for (const [id, job] of [...timers]) if (job.kind === kind) { timers.delete(id); job.callback(); }
  };
  return {
    library, events, calls, durationBatches, timers, scanner, genres,
    get active() { return active; }, get maxActive() { return maxActive; },
    getSongs: () => handlers.get('get-songs')(), runGenres: () => run('genre'), runDurations: () => run('duration'),
    add(name, duration = 180000) {
      const folder = path.join(library, name); fs.mkdirSync(folder);
      const file = path.join(folder, 'song.wav'); fs.writeFileSync(file, 'isolated audio ' + name);
      fs.writeFileSync(path.join(folder, 'info.json'), JSON.stringify({ title: name, artist: 'Fixture', duration }));
      return file;
    },
  };
}

test('get-songs returns a playable list before tags finish, then publishes one update and reuses cache', async t => {
  const gate = deferred();
  const f = fixture(t, () => gate.promise);
  const file = f.add('Tagged');
  const songs = f.getSongs();
  assert.ok(Array.isArray(songs), 'The real IPC handler returns its base array without awaiting metadata');
  assert.equal(songs[0].audioPath, file);
  assert.equal(songs[0].realDuration, 180);
  assert.deepEqual(songs[0].genre, []);
  assert.equal(f.calls.length, 0);
  assert.equal([...f.timers.values()].find(job => job.kind === 'duration').delay, 300);
  f.runGenres();
  await until(() => f.calls.length === 1);
  assert.equal(f.events.length, 0, 'An unresolved tag read cannot hold the already returned song list');
  gate.resolve({ common: { genre: [' Jazz ', 'JAZZ', 'Ambient'] } });
  await until(() => f.events.length === 1);
  assert.deepEqual(f.events, [{ channel: 'song-metadata-update', audioPath: file, genre: ['Jazz', 'Ambient'] }]);
  const cached = f.getSongs();
  assert.deepEqual(cached[0].genre, ['Jazz', 'Ambient']);
  cached[0].genre.push('not a tag');
  f.runGenres(); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.events.length, 1);
  assert.deepEqual(f.genres.getCachedGenres(file), ['Jazz', 'Ambient']);
  f.runDurations(); assert.equal(f.durationBatches.length, 1, 'Repeated refreshes coalesce the pending duration schedule');
});

test('concurrent refresh and explicit full scan share reads and a global four-file limit', async t => {
  const gates = new Map();
  const f = fixture(t, file => gates.get(file).promise);
  for (let index = 0; index < 7; index++) gates.set(f.add('Song ' + index), deferred());
  f.getSongs(); f.runGenres();
  await until(() => f.calls.length === 4);
  f.getSongs(); f.getSongs(); f.runGenres();
  const full = f.scanner.scanMusicFilesWithGenres(f.library);
  await settle(); assert.equal(f.calls.length, 4, 'Pending paths are not reparsed by concurrent callers');
  const first = [...f.calls];
  first.forEach(file => gates.get(file).resolve({ common: { genre: ['Pop'] } }));
  await until(() => f.calls.length === 7);
  f.calls.filter(file => !first.includes(file)).forEach(file => gates.get(file).resolve({ common: { genre: ['Pop'] } }));
  const enriched = await full;
  await until(() => f.events.length === 7);
  assert.ok(enriched.every(song => song.genre[0] === 'Pop'));
  assert.equal(new Set(f.calls).size, 7); assert.equal(f.calls.length, 7);
  assert.ok(f.maxActive <= 4 && f.maxActive > 1);
  assert.equal(new Set(f.events.map(event => event.audioPath)).size, 7);
  f.getSongs(); f.runGenres(); await settle();
  assert.equal(f.calls.length, 7); assert.equal(f.events.length, 7);
});

test('bad files do not block healthy updates and only failed paths retry on refresh', async t => {
  const f = fixture(t, async (file, attempt) => {
    if (file.includes('Broken') && attempt === 1) throw new Error('invalid audio');
    return { common: { genre: [file.includes('Broken') ? 'Blues' : 'Folk'] } };
  });
  const broken = f.add('Broken'), healthy = f.add('Healthy');
  assert.equal(f.getSongs().length, 2); f.runGenres();
  await until(() => f.calls.length === 2 && f.active === 0 && f.events.length === 1);
  assert.equal(f.events[0].audioPath, healthy);
  f.getSongs(); f.runGenres();
  await until(() => f.events.length === 2);
  assert.equal(f.calls.filter(file => file === healthy).length, 1);
  assert.equal(f.calls.filter(file => file === broken).length, 2);
  assert.deepEqual(f.genres.getCachedGenres(broken), ['Blues']);
});

test('deleted files cannot publish late tags, even without another refresh', async t => {
  const gate = deferred();
  const f = fixture(t, () => gate.promise);
  const file = f.add('Deleted');
  f.getSongs(); f.runGenres(); await until(() => f.calls.length === 1);
  fs.unlinkSync(file);
  gate.resolve({ common: { genre: ['Old tag'] } });
  await until(() => f.active === 0); await settle();
  assert.deepEqual(f.events, []); assert.deepEqual(f.genres.getCachedGenres(file), []);
  assert.deepEqual(f.getSongs(), []); f.runGenres(); await settle();
  assert.deepEqual(f.events, []);
});

test('replacement files discard old completion and publish only new metadata', async t => {
  const old = deferred(), fresh = deferred();
  const f = fixture(t, (_file, attempt) => (attempt === 1 ? old : fresh).promise);
  const file = f.add('Replaced');
  f.getSongs(); f.runGenres(); await until(() => f.calls.length === 1);
  fs.writeFileSync(file, 'different replacement audio with a new byte size');
  f.getSongs(); f.runGenres(); await until(() => f.calls.length === 2);
  old.resolve({ common: { genre: ['Stale'] } });
  await until(() => f.active === 1); await settle(); assert.deepEqual(f.events, []);
  fresh.resolve({ common: { genre: ['Electronic'] } });
  await until(() => f.events.length === 1);
  assert.deepEqual(f.events[0].genre, ['Electronic']); assert.deepEqual(f.genres.getCachedGenres(file), ['Electronic']);
});

test('refresh removal cancels old queued files and never restores deleted songs', async t => {
  const gates = new Map();
  const f = fixture(t, file => gates.get(file).promise);
  for (let index = 0; index < 6; index++) gates.set(f.add('Queued ' + index), deferred());
  f.getSongs(); f.runGenres(); await until(() => f.calls.length === 4);
  const waiting = [...gates.keys()].filter(file => !f.calls.includes(file));
  waiting.forEach(file => fs.unlinkSync(file));
  assert.equal(f.getSongs().length, 4); f.runGenres();
  f.calls.forEach(file => gates.get(file).resolve({ common: { genre: ['Jazz'] } }));
  await until(() => f.events.length === 4);
  assert.equal(f.calls.length, 4); assert.ok(f.events.every(event => !waiting.includes(event.audioPath)));
});

test('preload metadata subscriptions unsubscribe independently and forward the real payload', () => {
  const ipcRenderer = new EventEmitter();
  const exposed = {};
  load(path.join(root, 'preload.js'), { electron: {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer,
  } });
  const first = [], second = [];
  const disposeFirst = exposed.musicAPI.onSongMetadataUpdate(payload => first.push(payload));
  const disposeSecond = exposed.musicAPI.onSongMetadataUpdate(payload => second.push(payload));
  const payload = { audioPath: 'isolated/song.wav', genre: ['Jazz'] };
  ipcRenderer.emit('song-metadata-update', {}, payload); disposeFirst();
  ipcRenderer.emit('song-metadata-update', {}, payload);
  assert.deepEqual(first, [payload]); assert.deepEqual(second, [payload, payload]);
  disposeSecond(); assert.equal(ipcRenderer.listenerCount('song-metadata-update'), 0);
});
