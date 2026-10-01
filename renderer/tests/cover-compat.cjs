// Exercise the original cover renderer with real backend palettes and legacy RGB replies.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jpeg = require('jpeg-js');
const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

const backend = { exports: {} };
vm.runInNewContext(read('cover/color.js'), {
  module: backend, exports: backend.exports, console, Buffer, Uint8Array,
  require: name => name === 'electron' ? { ipcMain: { handle() {} } } : require(name),
});
const pixels = Buffer.from([220, 70, 100, 255, 190, 80, 140, 255]);
const encoded = jpeg.encode({ width: 2, height: 1, data: pixels }, 100).data;
const backendPalette = backend.exports.extractColorFromBuffer(encoded);
assert.ok(Array.isArray(backendPalette) && backendPalette.length > 0);
assert.ok(backendPalette.every(color => Number.isFinite(color.weight)));

const properties = new Map();
const style = {
  setProperty: (key, value) => properties.set(key, value),
  removeProperty: key => properties.delete(key),
  getPropertyValue: key => properties.get(key) || '',
};
let response, rejection, sent = 0, remoteReads = 0, localReads = 0;
const readColor = async () => { if (rejection) throw rejection; return response; };
const context = vm.createContext({
  console: { ...console, warn() {} },
  document: { documentElement: { style } },
  window: { matchMedia: () => ({ matches: false }), musicAPI: {
    extractCoverColor: () => { localReads++; return readColor(); },
    extractCoverColorFromURL: () => { remoteReads++; return readColor(); },
  } },
  setTimeout: () => 1, clearTimeout() {},
  currentMode: 'player', appSettings: { colorIntensity: 0.85, themeFollowCover: false },
  _lastCoverColor: null, _bgFadeTimer: null, sendCoverColorToDesktop: () => { sent++; },
});
const run = source => vm.runInContext(source, context);
run(read('renderer/modules/utils.js')); run(read('renderer/modules/cover.js'));

(async () => {
  response = backendPalette;
  await run(`applyCoverBackground('D:/fixture.jpg')`);
  assert.deepEqual(plain(run('_lastCoverColor')), {
    r: backendPalette[0].r, g: backendPalette[0].g, b: backendPalette[0].b,
  });
  assert.equal(localReads, 1);
  assert.equal(properties.get('--cover-opacity'), '1');
  assert.ok(!properties.get('--cover-gradient').includes('NaN'));
  assert.deepEqual(plain(run('normalizeCoverPalette([])')), []);

  response = { r: 212, g: 117, b: 158 };
  await run(`applyCoverBackground('data:image/png;base64,fixture')`);
  assert.deepEqual(plain(run('_lastCoverColor')), response);
  assert.equal(remoteReads, 1);
  assert.equal(properties.get('--cover-accent'), 'rgb(212,117,158)');
  for (const invalid of [null, [], {}, [null, { r: 1, g: NaN, b: 2 }]]) {
    response = invalid;
    await run(`applyCoverBackground('D:/invalid.jpg')`);
    assert.equal(run('_lastCoverColor'), null);
    assert.equal(properties.has('--cover-accent'), false);
    assert.equal(properties.get('--cover-opacity'), '0');
  }
  response = [null, { r: 300, g: -10, b: 120.6, weight: 0.7 }];
  await run(`applyCoverBackground('D:/clamped.jpg')`);
  assert.deepEqual(plain(run('_lastCoverColor')), { r: 255, g: 0, b: 121 });
  rejection = new Error('fixture extraction failure');
  await run(`applyCoverBackground('D:/unreadable.jpg')`);
  assert.equal(run('_lastCoverColor'), null);
  assert.ok(sent >= 8, 'clearing unusable colors also updates desktop lyrics');

  for (const url of ['data:image/svg+xml,%3Csvg%3E', 'https://example.test/cover.jpg', 'file:///D:/cover%20art.jpg', 'music://local/cover.jpg', 'blob:fixture-cover']) {
    assert.equal(run(`toUrl(${JSON.stringify(url)})`), url);
  }
  context.inputPath = 'D:\\Music\\cover art.jpg';
  assert.equal(run('toUrl(inputPath)'), 'file:///D:/Music/cover%20art.jpg');
  console.log(JSON.stringify({ ok: true, checks: ['actual backend JPEG weighted palette accepted', 'single RGB bridge reply accepted', 'empty or damaged colors safely clear previous accent', 'extraction rejection cannot break startup', 'existing cover URLs preserved and local paths encoded'] }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
