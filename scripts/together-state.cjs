// Execute production room/IPC and classic renderer command handling offline.
// No HTTP listener, user config, real timer or Electron window is created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { normalizeTogetherRate } = require('../server/together-state');
const root = path.resolve(__dirname, '..');
const song = id => ({ id, songName: `歌曲 ${id}`, audioPath: `/fixture/${id}.wav` });
const songs = [song(0), song(1), song(2)];
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(text) { this.messages.push(JSON.parse(text)); }
  ping() { this.emit('pong'); }
  terminate() { this.readyState = 3; this.emit('close'); }
  op(op, payload = {}) { this.emit('message', Buffer.from(JSON.stringify({ type: 'op', op, payload }))); }
  leave() { this.readyState = 3; this.emit('close'); }
  welcome() { return this.messages.find(message => message.type === 'welcome'); }
}
let room;
class Server extends EventEmitter { constructor() { super(); room = this; } close() {} }
class Desktop extends EventEmitter {
  commands = []; destroyed = false;
  isDestroyed() { return this.destroyed; }
  send(channel, command) { this.commands.push({ channel, command }); }
}
const desktop = new Desktop(), oldDesktop = new Desktop();
let mainWindow = { isDestroyed: () => false, webContents: desktop };
const ipc = new Map();
const source = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const state = source.slice(source.indexOf('let _desktopState ='), source.indexOf('// 移动端 UI 静态文件目录'));
const section = source.slice(source.indexOf('let _wss = null;'), source.indexOf('// 提取客户端真实IP'));
const ipcSection = source.slice(source.indexOf("ipcMain.handle('desktop-together-ready'"), source.indexOf('module.exports ='));
const context = { require, WebSocketServer: Server, normalizeTogetherRate,
  getMainWindow: () => mainWindow, getRawSongsSync: () => songs,
  audioPathToIndex: value => songs.findIndex(song => song.audioPath === value),
  dbgLog() {}, getClientIP: () => 'fixture', _accessLogEnabled: false,
  setInterval: () => 1, clearInterval() {}, ipcMain: { handle: (name, fn) => ipc.set(name, fn) } };
vm.createContext(context);
vm.runInContext(`${state}\n${section}\n${ipcSection}\n_ensureTogetherWss();`, context);
const join = () => { const socket = new Socket(); room.emit('connection', socket, {}); return socket; };
const update = patch => ipc.get('desktop-state-update')({ sender: desktop }, patch);
const ready = (sender, value = true) => ipc.get('desktop-together-ready')({ sender }, value);
const lastState = socket => socket.messages.filter(value => value.op === 'state').at(-1)?.payload;
const actual = (id, currentTime, isPlaying, playbackRate = 1, command) => ({ index: id, songInfo: song(id),
  currentTime, duration: 90, isPlaying, playbackRate,
  ...(command ? { togetherSeq: command.seq, togetherSession: command.session } : {}) });
async function run() {
  assert.equal((await ready(oldDesktop)).ok, false, 'only the actual main renderer can register');
  assert.equal((await ipc.get('desktop-state-update')({ sender: oldDesktop }, actual(2, 80, true))).ok, false);
  const before = join(); assert.equal(before.welcome().desktopConnected, false);
  await ready(desktop); await update(actual(0, 35, false, 2));
  const phone = join(); assert.equal(phone.welcome().desktopConnected, true);
  assert.equal(phone.welcome().hostId, 0); assert.equal(phone.welcome().hostSong.song.audioPath, song(0).audioPath);
  assert.equal(phone.welcome().hostSong.position, 35); assert.equal(phone.welcome().hostSong.isPlaying, false);
  assert.equal(phone.welcome().hostSong.playbackRate, 2);
  assert.equal(phone.welcome().peers, 3, 'desktop is a real participant plus two phones');

  phone.op('song', { song: song(1), position: 20, isPlaying: false, playbackRate: .5 });
  let command = desktop.commands.at(-1).command;
  assert.equal(command.op, 'song'); assert.equal(command.payload.audioPath, song(1).audioPath);
  const states = before.messages.filter(value => value.op === 'state').length;
  await update(actual(1, 0, false, .5));
  assert.equal(before.messages.filter(value => value.op === 'state').length, states, 'loading intermediate state waits for matching completion');
  await update(actual(1, 20, false, .5, command));
  assert.equal(lastState(before).position, 20); assert.equal(lastState(before).playbackRate, .5);
  assert.equal(join().welcome().hostSong.position, 20, 'late join uses actual desktop completion');

  for (const [op, payload, position, playing, rate] of [
    ['play', { position: 20, songId: 1, audioPath: song(1).audioPath }, 20, true, .5],
    ['seek', { position: 48, songId: 1, audioPath: song(1).audioPath }, 48, true, .5],
    ['rate', { playbackRate: 2, songId: 1 }, 48, true, 2],
    ['pause', { position: 52, songId: 1 }, 52, false, 2],
  ]) {
    phone.op(op, payload); command = desktop.commands.at(-1).command;
    assert.equal(command.op, op); await update(actual(1, position, playing, rate, command));
    assert.equal(lastState(before).isPlaying, playing); assert.equal(lastState(before).playbackRate, rate);
  }
  const count = desktop.commands.length;
  for (const [op, payload] of [['song', { song: { ...song(0), audioPath: '/arbitrary/private.wav' } }],
    ['song', { song: { ...song(0), id: 2 } }], ['seek', { songId: 0, position: 80 }],
    ['seek', { position: Infinity }], ['rate', { playbackRate: 8 }], ['state', { song: song(2) }]]) phone.op(op, payload);
  assert.equal(desktop.commands.length, count, 'invalid paths/ids/rates and phone heartbeats cannot control desktop');
  phone.op('song', { song: song(2), position: 30, isPlaying: true });
  const oldSongCommand = desktop.commands.at(-1).command;
  phone.op('pause', { audioPath: song(2).audioPath, songId: 2, position: 30 });
  command = desktop.commands.at(-1).command;
  const previousStates = before.messages.filter(value => value.op === 'state').length;
  await update(actual(2, 30, true, 2, oldSongCommand));
  assert.equal(before.messages.filter(value => value.op === 'state').length, previousStates, 'older source completion cannot release a newer paused load');
  phone.leave();
  assert.equal(command.op, 'song'); assert.equal(command.payload.isPlaying, false, 'pause during a pending song refines the load rather than playing the old source');
  assert.equal(desktop.commands.at(-1).command.op, 'cancel');
  assert.equal(lastState(before).isPlaying, false, 'leaving does not emit a fabricated play/pause operation');
  await update(actual(1, 55, true, 2)); assert.equal(lastState(before).isPlaying, true, 'desktop continues independently after a phone leaves');
  await ready(desktop, false); assert.equal(before.messages.at(-1).desktopConnected, false);
  mainWindow = { isDestroyed: () => false, webContents: oldDesktop };
  assert.equal((await ready(desktop)).ok, false, 'old interface window cannot register after switching');
  assert.equal((await ipc.get('desktop-state-update')({ sender: desktop }, actual(0, 1, true))).ok, false);
  mainWindow = { isDestroyed: () => false, webContents: desktop }; await ready(desktop);
  const oldSession = command.session;
  vm.runInContext('_stopTogether(); _ensureTogetherWss();', context);
  const restarted = join(); restarted.op('pause', { position: 12, songId: 1 });
  command = desktop.commands.at(-1).command;
  assert.notEqual(command.session, oldSession); assert.ok(command.seq <= 2, 'server restart gets a new session and low seq');

  // Classic production command handler, with only media/library boundaries
  // replaced. Source/metadata playback itself is covered by native together QA.
  const classicSource = fs.readFileSync(path.join(root, 'renderer/modules/player-core.js'), 'utf8');
  const handler = classicSource.slice(classicSource.indexOf('async function applyTogetherCommand('),
    classicSource.indexOf('if (window.stateAPI?.onTogetherCommand)'));
  const calls = []; let release;
  const audio = { paused: false, currentTime: 4, readyState: 1,
    pause() { this.paused = true; calls.push('pause'); }, async play() { this.paused = false; calls.push('play'); } };
  const classic = { Number, songs, audio, appSettings: { playbackRate: 1 },
    _togetherRequest: 0, _togetherAcknowledged: 0, _togetherSession: '', _togetherGeneration: 0,
    _classicPlayRequest: 0, _togetherSeek: null, _lastSyncTime: 0,
    playContext: 'liked', playMode: 1, shuffleQueue: [], shufflePos: 0,
    cancelFade() {}, getDuration: () => 90, syncLrc() {}, saveUserData() { calls.push('save'); },
    applyPlaybackRate() { audio.playbackRate = classic.appSettings.playbackRate; },
    syncDesktopState() { calls.push(['ack', classic._togetherSession, classic._togetherAcknowledged]); },
    pickNextIdx: () => 0,
    async play(index, resume, context, count, options) { calls.push(['song', index, options]); if (release) await release.promise; } };
  vm.createContext(classic); vm.runInContext(handler, classic);
  await classic.applyTogetherCommand({ session: 'a', seq: 10, op: 'song', payload: { audioPath: song(1).audioPath, position: 35, isPlaying: false, playbackRate: 2 } });
  assert.equal(calls.find(value => Array.isArray(value) && value[0] === 'song')[2].autoplay, false);
  assert.equal(audio.playbackRate, 2);
  await classic.applyTogetherCommand({ session: 'a', seq: 11, op: 'pause', payload: { position: 40 } });
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, 40);
  await classic.applyTogetherCommand({ session: 'b', seq: 1, op: 'rate', payload: { playbackRate: .5 } });
  assert.equal(audio.playbackRate, .5, 'low sequence from restarted server is accepted');
  const completion = {}; completion.promise = new Promise(resolve => { completion.resolve = resolve; }); release = completion;
  const pending = classic.applyTogetherCommand({ session: 'b', seq: 2, op: 'song', payload: { audioPath: song(2).audioPath, isPlaying: true } });
  await classic.applyTogetherCommand({ session: 'b', seq: 2, op: 'cancel' });
  const ackCount = calls.filter(value => Array.isArray(value) && value[0] === 'ack').length;
  completion.resolve(); await pending;
  assert.equal(calls.filter(value => Array.isArray(value) && value[0] === 'ack').length, ackCount, 'departed request cannot acknowledge later');
  for (const value of [NaN, Infinity, '2', null, {}, []]) assert.equal(normalizeTogetherRate(value), 1);
  console.log(JSON.stringify({ ok: true, checks: [
    'actual desktop participation and authoritative paused/rate welcome',
    'mobile commands reach only the real desktop and await matching actual completion',
    'desktop song/play/pause/seek/rate reaches phones with a consistent clock',
    'path/id/rate/sender validation and phone state rejection',
    'leaving stays independent; interface switch invalidates old renderer',
    'server restart session accepts low sequence in classic renderer',
    'classic paused song/rate/seek and cancellation do not replay stale completion',
  ] }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
