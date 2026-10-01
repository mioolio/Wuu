// Offline checks run original renderer scripts in a small browser VM.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let clock = new Date(2026, 9, 2, 0, 0, 2).getTime();
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
const classList = { add() {}, remove() {}, toggle() {} };
const node = () => ({ style: {}, classList, textContent: '' });

function makeContext() {
  const saved = [], synced = [], timers = new Map(), clicks = new Map();
  const button = { disabled: false, addEventListener: (name, handler) => clicks.set(name, handler) };
  let timerId = 0, durationUpdate;
  const media = { src: '', currentTime: 42, duration: 180, paused: true, listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    play() { this.paused = false; return new Promise(resolve => { this.finishPlay = resolve; }); },
    pause() { this.paused = true; },
  };
  const context = vm.createContext({ console, Date: FixedDate, URLSearchParams, performance: { now: () => 1000 },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { search: '' },
    document: { getElementById: () => button }, audio: media,
    tEnd: node(), tNow: node(), pFill: node(), btnMode: node(), empty: node(), player: node(), lyrics: node(), titleEl: node(), artistEl: node(), creditsEl: null, coverEl: node(), listTitle: node(), navItems: [],
    MODE_NAMES: ['loop', 'list', 'shuffle'], MODE_ICONS: ['a', 'b', 'c'],
    window: { musicAPI: { onDurationUpdate: handler => { durationUpdate = handler; },
      saveUserData: async data => { saved.push(plain(data)); return true; },
      saveUserDataSync: data => { synced.push(plain(data)); return true; },
    }, desktopLyric: { send() {} }, windowAPI: { switchInterface: async () => ({ ok: true }) } },
    showToast() {}, flushDuration() {}, fmt: String,
  });
  const run = source => vm.runInContext(source, context);
  run(read('modules/state.js')); run(read('modules/data.js'));
  return { context, run, media, saved, synced, timers, clicks, button, updateDuration: payload => durationUpdate(payload) };
}

(async () => {
  const test = makeContext();
  const { context, run } = test;
  run(`songs = [{audioPath:'a', songName:'A', realDuration:180}]; curIdx = 0;
    stats = { a:{plays:2,duration:20,recentDays:{'2026-10-01':{plays:1,duration:12}},extra:'keep'}, old:7 };
    genreOverrides = {a:[],other:['Jazz']}; _userDataReady = true;`);
  run('addDuration(songs[0], 4)');
  assert.deepEqual(plain(run('stats.a')), { plays: 2, duration: 24, extra: 'keep', recentDays: { '2026-10-01': { plays: 1, duration: 14 }, '2026-10-02': { plays: 0, duration: 2 } } });
  run(`incrPlay({audioPath:'old'})`);
  assert.equal(run('stats.old.plays'), 8);
  assert.equal(run(`stats.old.recentDays['2026-10-02'].plays`), 1);
  await run('saveUserDataImmediate()');
  assert.deepEqual(test.saved.at(-1).genreOverrides, { a: [], other: ['Jazz'] });
  assert.deepEqual(test.saved.at(-1).stats.a.recentDays, plain(run('stats.a.recentDays')));
  run('saveUserData()');
  [...test.timers.values()].forEach(callback => callback()); test.timers.clear();
  assert.deepEqual(test.saved.at(-1).genreOverrides, { a: [], other: ['Jazz'] });
  const events = read('modules/events.js');
  let beforeUnload;
  context.window.addEventListener = (name, handler) => { if (name === 'beforeunload') beforeUnload = handler; };
  run(events.slice(events.lastIndexOf("window.addEventListener('beforeunload'")));
  beforeUnload();
  assert.deepEqual(test.synced.at(-1).genreOverrides, { a: [], other: ['Jazz'] });
  const savesBefore = test.saved.length, syncsBefore = test.synced.length;
  run('_userDataReady = false'); beforeUnload(); await run('saveUserDataImmediate()');
  assert.equal(test.saved.length, savesBefore); assert.equal(test.synced.length, syncsBefore);
  run('_userDataReady = true');
  test.updateDuration({ audioPath: 'a', realDuration: 200 });
  assert.equal(run('songs[0].realDuration'), 200);
  test.updateDuration({ idx: 0, duration: 180 }); assert.equal(run('songs[0].realDuration'), 180);

  let switched;
  context.window.windowAPI.switchInterface = async (mode, session) => { switched = { mode, session: plain(session), snapshot: test.synced.at(-1) }; return { ok: true }; };
  run(read('modules/interface-switch.js')); context.audio.paused = false;
  await test.clicks.get('click')();
  assert.deepEqual(switched.session, { playing: true }); assert.equal(switched.mode, 'modern');
  assert.equal(switched.snapshot.settings.interfaceMode, 'modern');
  assert.deepEqual(switched.snapshot.genreOverrides, { a: [], other: ['Jazz'] });
  context.window.windowAPI.switchInterface = async () => ({ ok: false, message: 'fixture rejection' });
  run(`appSettings.interfaceMode = 'classic'`);
  const oldError = context.console; context.console = { ...console, error() {} };
  await test.clicks.get('click')(); context.console = oldError;
  assert.equal(run('appSettings.interfaceMode'), 'classic'); assert.equal(test.button.disabled, false);

  async function verifyStartup(savedView = null, restoreLastSession = true) {
  const startup = makeContext();
  const c = startup.context;
  const song = { audioPath: 'restored', songName: 'Restored', artist: 'Fixture', realDuration: 180 };
  const userData = { stats: { restored: { plays: 9, duration: 600, recentDays: { '2026-10-01': { plays: 1, duration: 10 } } } }, genreOverrides: { restored: [] }, progress: { restored: 42 }, lastSession: { audioPath: 'restored', t: 42 }, settings: { interfaceMode: 'classic', desktopLyricPersist: false, unknownSetting: 'keep' } };
  if (!restoreLastSession) userData.lastSession = null;
  c.window.musicAPI.getSongs = async () => [song]; c.window.musicAPI.getUserData = async () => userData;
  c.localStorage.getItem = key => key === 'sqet-current-view' ? savedView : null;
  c.location.search = '?interfacePaused=1&desktopLyrics=1&interfaceSwitch=1';
  let desktopOpened = 0;
  c.toggleDesktopLyric = async () => { desktopOpened++; startup.run('desktopLyricOn = true'); };
  for (const name of ['applySettings', 'showListView', 'renderList', 'buildShuffleQueue', 'showPlayerView', 'initWebAudio', 'cancelFade', 'updLikeBtn', 'updNowPlaying', 'setCoverImage', 'applyCoverBackground', 'renderLrc', 'sendSongInfoToDesktop', 'sendLyricDataToDesktop', 'syncDesktopState', 'syncLrc', 'updCur', 'scrollCur']) c[name] = () => {};
  let visibleView = null;
  c.showListView = () => { visibleView = 'list'; }; c.showPlayerView = () => { visibleView = 'player'; };
  c.toUrl = value => 'file:///' + value; c.fmt = String;
  const player = read('modules/player-core.js');
  startup.run(player.slice(player.indexOf('async function play('), player.indexOf('\nfunction onEnd()')));
  const initialized = startup.run(read('modules/init.js'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(desktopOpened, 1); assert.equal(startup.media.paused, true, 'restored playback waits for deferred metadata');
  startup.media.listeners.get('loadedmetadata')();
  assert.equal(startup.media.currentTime, 42);
  startup.media.finishPlay(); await initialized;
  assert.equal(startup.media.paused, true, 'interfacePaused is applied after the actual play promise');
  assert.equal(startup.run('stats.restored.plays'), restoreLastSession ? 9 : 10, 'switch restoration does not increment a song play');
  assert.equal(startup.run('appSettings.unknownSetting'), 'keep');
  assert.deepEqual(plain(startup.run('genreOverrides')), { restored: [] });
  if (savedView === 'list') {
    assert.equal(startup.run('currentView'), 'list'); assert.equal(visibleView, 'list');
    assert.equal(c.listTitle.textContent, '音乐列表');
  }
  if (savedView === 'player') { assert.equal(startup.run('currentView'), 'home'); assert.equal(visibleView, 'player'); }
  }
  await verifyStartup(); await verifyStartup('list'); await verifyStartup('list', false); await verifyStartup('player');
  assert.ok(read('index.html').indexOf('modules/interface-switch.js') < read('index.html').indexOf('modules/init.js'));
  console.log(JSON.stringify({ ok: true, checks: ['old/new duration payloads accepted', 'numeric and dated statistics preserved with midnight attribution', 'genre overrides survive all three save paths', 'unhydrated close cannot write empty user data', 'interface switch saves before reloading and handles rejection', 'original startup restores progress, paused state and visible desktop lyrics without extra plays', 'list and modern player views restore to the matching original view'] }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
