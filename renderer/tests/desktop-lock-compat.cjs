// Test native lock replay and the original desktop renderer without launching Electron.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const handles = new Map(), listeners = new Map(), mainMessages = [];
let lyricWin = null;
class WindowStub {
  constructor() {
    this.events = new Map(); this.ignored = []; this.messages = [];
    this.webContents = { on: (name, callback) => this.events.set(name, callback),
      send: (name, payload) => this.messages.push({ name, payload }) };
  }
  isDestroyed() { return this.destroyed === true; }
  destroy() { this.destroyed = true; }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents(value) { this.ignored.push(value); }
  on() {}
}
const state = {
  getLyricWin: () => lyricWin, setLyricWin: value => { lyricWin = value; },
  sendToMain: (name, payload) => mainMessages.push({ name, payload }), sendToLyric() {},
};
const native = vm.createContext({ module: { exports: {} }, __dirname: path.join(root, 'window'), console,
  require: name => {
    if (name === 'electron') return { BrowserWindow: WindowStub, ipcMain: {
      handle: (channel, callback) => handles.set(channel, callback),
      on: (channel, callback) => listeners.set(channel, callback),
    }, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) } };
    if (name === '../core/state') return state;
    if (name === '../core/storage') return { readUserData: () => ({ settings: {} }), writeUserData() {} };
    if (name === './renderer-entry') return { loadRenderer: async () => {} };
    return require(name);
  },
});
const runNative = code => vm.runInContext(code, native);
runNative(read('window/desktop-lyric.js'));
native.module.exports.createDesktopLyricWindow();
handles.get('lyric-lock')({}, true);
assert.equal(runNative(`latestLyricPayloads.get('lock').locked`), true);
assert.equal(lyricWin.messages.length, 0, 'native lock must not add a duplicate update broadcast');
listeners.get('lyric-lock-changed')({}, { locked: false });
assert.equal(runNative(`latestLyricPayloads.get('lock').locked`), false);
assert.deepEqual(mainMessages.at(-1), { name: 'lyric-lock-changed', payload: false });
native.module.exports.destroyDesktopLyricWindow(); native.module.exports.createDesktopLyricWindow();
lyricWin.events.get('did-finish-load')();
assert.equal(lyricWin.messages.at(-1).payload.locked, false, 'replacement renderer receives the latest unlock');

const nodes = new Map();
function node() {
  return { handlers: new Map(), style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(name, callback) { this.handlers.set(name, callback); },
    querySelector: () => node() };
}
const getNode = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
let receive;
const renderer = vm.createContext({ console,
  document: { getElementById: getNode, documentElement: node() },
  window: { lyricReceiver: { onUpdate: callback => { receive = callback; } }, desktopLyric: {
    lock: async locked => handles.get('lyric-lock')({}, locked),
    setInteractive: async interactive => handles.get('lyric-set-interactive')({}, interactive),
    notifyLockChanged: locked => listeners.get('lyric-lock-changed')({}, { locked }),
  } },
});
const runRenderer = code => vm.runInContext(code, renderer);
runRenderer(read('renderer/desktop-lyric.js'));
(async () => {
  handles.get('lyric-lock')({}, true); receive({ type: 'lock', locked: true });
  getNode('bar').handlers.get('mouseenter')();
  assert.equal(runRenderer('hoverInteractive'), true);
  assert.equal(lyricWin.ignored.at(-1), false, 'locked controls temporarily accept input');
  handles.get('lyric-lock')({}, false); receive({ type: 'lock', locked: false });
  assert.equal(runRenderer('hoverInteractive'), false);
  assert.equal(lyricWin.ignored.at(-1), false, 'main-window unlock keeps the lyric window interactive');

  handles.get('lyric-lock')({}, true); receive({ type: 'lock', locked: true });
  getNode('bar').handlers.get('mouseenter')();
  await getNode('btn-lock').handlers.get('click')();
  getNode('bar').handlers.get('mouseleave')();
  assert.equal(runRenderer('locked'), false);
  assert.equal(runRenderer('hoverInteractive'), false);
  assert.equal(lyricWin.ignored.at(-1), false, 'unlocking from hovered controls cannot re-enable click-through');
  assert.equal(runNative(`latestLyricPayloads.get('lock').locked`), false);
  console.log(JSON.stringify({ ok: true, checks: ['latest native lock cached without duplicate broadcasts', 'desktop unlock replaces stale replay before switching', 'main-window unlock while hovering keeps interaction', 'original lyric button unlock resets hover state and keeps interaction'] }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
