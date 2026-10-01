// Offline integration: real RIFF genre tags -> scanner -> get-songs IPC payload.
// Isolated fixtures and dependency stubs keep user music/configuration untouched.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Module, createRequire } = require('module');
const { parseFile } = require('music-metadata');
const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, '.test-artifacts');
fs.mkdirSync(artifactRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(artifactRoot, 'genre-tags-'));
const library = path.join(fixture, 'library');
fs.mkdirSync(library);
const report = { checks: [], firstParseCount: 0, cachedParseCount: 0, maxConcurrentParses: 0, firstScanMs: 0 };
let parses = 0, active = 0;

function loadWithStubs(filename, stubs) {
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireLocal = createRequire(filename);
  isolated.require = name => Object.hasOwn(stubs, name) ? stubs[name] : requireLocal(name);
  isolated._compile(fs.readFileSync(filename, 'utf8'), filename);
  return isolated.exports;
}

function chunk(name, data) {
  const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function taggedWav(genres) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(16000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const info = Buffer.concat([Buffer.from('INFO'), ...genres.map(genre => chunk('IGNR', Buffer.from(genre + '\0', 'utf8')))]);
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', format), chunk('LIST', info), chunk('data', Buffer.alloc(1600))]);
  const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function addSong(folder, genres, corrupt = false) {
  const dir = path.join(library, folder); fs.mkdirSync(dir);
  const audioPath = path.join(dir, 'song.wav');
  fs.writeFileSync(audioPath, corrupt ? Buffer.from('invalid audio') : taggedWav(genres));
  // An existing library entry with cached duration and no genre field.
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ title: folder, artist: 'Fixture', duration: 180000 }));
  return audioPath;
}

(async () => {
  const genres = loadWithStubs(path.join(root, 'audio', 'genres.js'), {
    'music-metadata': { parseFile: async (...args) => {
      parses++; active++; report.maxConcurrentParses = Math.max(report.maxConcurrentParses, active);
      assert.deepEqual(args[1], { skipCovers: true, duration: false });
      try { return await parseFile(...args); } finally { active--; }
    } },
  });
  const handlers = new Map();
  const scanner = loadWithStubs(path.join(root, 'audio', 'scanner.js'), {
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    '../core/logger': { dbgLog: () => {} },
    '../core/storage': { getCachedDuration: () => 180 },
    './duration': { parseDurationsInBackground: () => {} },
    './genres': genres,
    path: { ...path, join: (...parts) => {
      const joined = path.join(...parts);
      return joined === path.join(root, 'output') ? library : joined;
    } },
  });
  assert.deepEqual(genres.normalizeGenres(['  Jazz ', 'JAZZ', '', null, 'R&B / Soul', ' Indie\nRock ', 123]), ['Jazz', 'R&B / Soul', 'Indie Rock']);
  assert.deepEqual(genres.normalizeGenres(undefined), []);
  report.checks.push('normalization trims labels and deduplicates without guessing genre names');

  const tagged = addSong('tagged', ['  Jazz  ', 'Jazz', 'Ambient']);
  const plain = addSong('untagged', []);
  const broken = addSong('broken', [], true);
  for (let i = 0; i < 6; i++) addSong('additional-' + i, ['Pop']);
  const encrypted = path.join(library, 'encrypted'); fs.mkdirSync(encrypted);
  fs.writeFileSync(path.join(encrypted, 'song.enc.m4a'), Buffer.from('encrypted'));
  const beforeBytes = fs.readFileSync(tagged);
  const syncSongs = scanner.scanMusicFiles(library);
  assert.ok(Array.isArray(syncSongs), 'existing synchronous scanner callers still receive an array');
  assert.ok(syncSongs.every(song => Array.isArray(song.genre)));
  assert.equal(syncSongs.length, 9, 'encrypted unresolved audio remains excluded');

  const started = performance.now();
  const first = await handlers.get('get-songs')();
  report.firstScanMs = Math.round(performance.now() - started);
  report.firstParseCount = parses;
  assert.deepEqual(first.find(song => song.audioPath === tagged).genre, ['Jazz', 'Ambient']);
  assert.deepEqual(first.find(song => song.audioPath === plain).genre, []);
  assert.deepEqual(first.find(song => song.audioPath === broken).genre, []);
  assert.equal(first.find(song => song.audioPath === tagged).realDuration, 180, 'old duration data does not suppress reading genre tags');
  assert.deepEqual(fs.readFileSync(tagged), beforeBytes, 'scanning never rewrites the media');
  assert.ok(report.maxConcurrentParses <= 4 && report.maxConcurrentParses > 1);
  report.checks.push('get-songs returns real embedded genres for old library entries', 'untagged/corrupt media remains usable with genre []', 'metadata parsing uses at most four concurrent reads and skips covers', 'scan does not alter audio bytes');

  const beforeCache = parses;
  const cached = await scanner.scanMusicFilesWithGenres(library);
  report.cachedParseCount = parses - beforeCache;
  assert.equal(report.cachedParseCount, 1, 'only the failed read is retried; successful empty tags are cached');
  cached.find(song => song.audioPath === tagged).genre.push('not a real tag');
  assert.deepEqual(await genres.readSongGenres(tagged), ['Jazz', 'Ambient'], 'returned arrays cannot mutate the cache');
  assert.deepEqual(scanner.scanMusicFiles(library).find(song => song.audioPath === tagged).genre, ['Jazz', 'Ambient']);
  report.checks.push('unchanged tagged and untagged files use cache; failed reads remain retryable');

  fs.writeFileSync(tagged, taggedWav(['Electronic']));
  assert.deepEqual(await genres.readSongGenres(tagged), ['Electronic'], 'changed file size/mtime invalidates the previous genre');
  fs.writeFileSync(broken, taggedWav(['Folk']));
  assert.deepEqual(await genres.readSongGenres(broken), ['Folk'], 'replacing broken media recovers its tags');
  const deleted = addSong('deleted', ['Blues']);
  assert.deepEqual(await genres.readSongGenres(deleted), ['Blues']);
  fs.unlinkSync(deleted);
  assert.deepEqual(genres.getCachedGenres(deleted), [], 'deleted files invalidate cached tags');
  const beforeUnsupported = parses;
  assert.deepEqual(await genres.readSongGenres(path.join(encrypted, 'song.enc.m4a')), []);
  assert.deepEqual(await genres.readSongGenres(path.join(library, 'notes.txt')), []);
  assert.equal(parses, beforeUnsupported, 'unsupported and encrypted files are never parsed');
  report.checks.push('changed/deleted files invalidate cache and repaired media is retried', 'unsupported and encrypted paths skip metadata parsing');
  report.ok = true;
  fs.writeFileSync(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: path.join(fixture, 'report.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
