// Offline regression: execute the production room handler and welcome consumer.
// No listening socket, user config, Electron window or real timer is created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { mergeTogetherState } = require('../server/together-state');
const root = path.resolve(__dirname, '..');

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(text) { this.messages.push(JSON.parse(text)); }
  ping() {}
  terminate() { this.readyState = 3; }
  op(op, payload) { this.emit('message', Buffer.from(JSON.stringify({ type: 'op', op, payload }))); }
  leave() { this.readyState = 3; this.emit('close'); }
  welcome() { return this.messages.find(message => message.type === 'welcome'); }
}
let room;
class Server extends EventEmitter {
  constructor() { super(); room = this; }
  close() {}
}
const roomSource = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const section = roomSource.slice(roomSource.indexOf('let _wss = null;'), roomSource.indexOf('// 提取客户端真实IP'));
assert.ok(section.includes('mergeTogetherState('), 'production message handler uses the tested merge');
const context = {
  WebSocketServer: Server, mergeTogetherState, dbgLog() {}, getClientIP: () => 'fixture',
  _accessLogEnabled: false, setInterval: () => 1, clearInterval() {},
};
vm.runInNewContext(`${section}\n_ensureTogetherWss();`, context, { filename: 'server/index.js (room)' });
const join = () => {
  const socket = new Socket();
  room.emit('connection', socket, {});
  return socket;
};
const song = id => ({ id, songName: `歌曲 ${id}`, audioPath: `/fixture/${id}.wav` });
const host = join();
host.op('song', { song: song(0), position: 20, isPlaying: true });
host.op('pause', { position: 35 });
const pausedGuest = join();
assert.deepEqual(pausedGuest.welcome().hostSong, { song: song(0), position: 35, isPlaying: false });

host.op('seek', { songId: 0, position: 48, isPlaying: false });
const seekGuest = join();
assert.equal(seekGuest.welcome().hostSong.position, 48);
assert.equal(seekGuest.welcome().hostSong.isPlaying, false);
host.op('play', {});
const playingGuest = join();
assert.equal(playingGuest.welcome().hostSong.isPlaying, true);
assert.equal(playingGuest.welcome().hostSong.position, 48);

// Both members may control the same song. Guest progress heartbeats cannot
// overwrite the host, and a control targeting another song cannot corrupt it.
pausedGuest.op('pause', { position: 52, songId: 0 });
const controlledGuest = join();
assert.deepEqual(controlledGuest.welcome().hostSong, { song: song(0), position: 52, isPlaying: false });
pausedGuest.op('seek', { position: 57, songId: 0, isPlaying: false });
pausedGuest.op('state', { song: song(1), songId: 1, position: 80, isPlaying: true });
pausedGuest.op('seek', { songId: 1, position: 85, isPlaying: true });
pausedGuest.op('pause', { songId: 1, position: 90 });
host.op('seek', { songId: 1, position: 95, isPlaying: true });
const guardedGuest = join();
assert.deepEqual(guardedGuest.welcome().hostSong, { song: song(0), position: 57, isPlaying: false });
assert.equal(guardedGuest.welcome().lastOp.payload.position, 95, 'stale lastOp exists, but cannot replace hostSong');

// A member's explicit song selection is a legitimate room command and reaches
// the host without an echo. A join before the host's next heartbeat must see it.
pausedGuest.op('song', { song: song(3), position: 28, isPlaying: false });
const memberSwitchedGuest = join();
assert.deepEqual(memberSwitchedGuest.welcome().hostSong, { song: song(3), position: 28, isPlaying: false });
pausedGuest.op('state', { song: song(4), songId: 4, position: 80, isPlaying: true });
pausedGuest.op('seek', { songId: 0, position: 100, isPlaying: true });
const memberGuardedGuest = join();
assert.deepEqual(memberGuardedGuest.welcome().hostSong, { song: song(3), position: 28, isPlaying: false });

host.op('state', { song: song(1), songId: 1, position: 12, isPlaying: true });
host.op('seek', { songId: 0, position: 100, isPlaying: false });
const switchedGuest = join();
assert.deepEqual(switchedGuest.welcome().hostSong, { song: song(1), position: 12, isPlaying: true });
host.op('pause', { songId: 1, position: 14 });
host.op('play', { songId: 1 });
switchedGuest.leave();
const afterLeave = join();
assert.deepEqual(afterLeave.welcome().hostSong, { song: song(1), position: 14, isPlaying: false });
host.leave();
pausedGuest.op('state', { song: song(2), songId: 2, position: 7, isPlaying: true });
const afterPromotion = join();
assert.deepEqual(afterPromotion.welcome().hostSong, { song: song(2), position: 7, isPlaying: true });
assert.equal(afterPromotion.welcome().hostId, pausedGuest.welcome().id);

// Feed the real welcome handler with snapshots above. Mock only the transport
// and player boundary so we can assert the playSong position/autoplay contract.
const requireMobile = createRequire(path.join(root, 'mobile_UI/package.json'));
const { ref, computed, watch } = requireMobile('vue');
function consumeWelcome(welcome, currentSong = null) {
  let client;
  const calls = [];
  const audio = { paused: true, currentTime: 0, playbackRate: 1 };
  const player = {
    currentSong: ref(currentSong), getAudioEl: () => audio, setRemoteApplying() {},
    setOpNotifier() {}, setListenStatusProvider() {}, flushPendingAdvance() {},
    playSong(value, options) { calls.push({ method: 'playSong', song: value, options }); },
    seekTo(position) { audio.currentTime = position; calls.push({ method: 'seekTo', position }); },
    pause() { audio.paused = true; calls.push({ method: 'pause' }); },
    resume() { audio.paused = false; calls.push({ method: 'resume' }); },
  };
  class Client {
    readyState = 1;
    constructor() { client = this; }
    send() {}
    close() {}
  }
  const source = fs.readFileSync(path.join(root, 'mobile_UI/src/composables/useListenTogether.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function useListenTogether()', 'function useListenTogether()');
  const consumer = {
    ref, computed, watch, usePlayer: () => player, WebSocket: Client,
    localStorage: { getItem: () => '1', setItem() {} },
    location: { protocol: 'http:', host: 'fixture' },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  };
  vm.runInNewContext(source, consumer, { filename: 'useListenTogether.js (welcome)' });
  client.onopen();
  client.onmessage({ data: JSON.stringify(welcome) });
  return JSON.parse(JSON.stringify(calls));
}
assert.deepEqual(consumeWelcome(pausedGuest.welcome()), [{
  method: 'playSong', song: song(0),
  options: { position: 35, autoplay: false, restoreProgress: false, notify: false },
}]);
assert.deepEqual(consumeWelcome(playingGuest.welcome()), [{
  method: 'playSong', song: song(0),
  options: { position: 48, autoplay: true, restoreProgress: false, notify: false },
}]);
assert.deepEqual(consumeWelcome(guardedGuest.welcome(), song(0)), [{ method: 'seekTo', position: 57 }],
  'same-song welcome consumes merged hostSong rather than wrong-song lastOp');
assert.deepEqual(consumeWelcome(memberSwitchedGuest.welcome()), [{
  method: 'playSong', song: song(3),
  options: { position: 28, autoplay: false, restoreProgress: false, notify: false },
}], 'member song selection reaches the real welcome consumer immediately');
assert.deepEqual(consumeWelcome(afterLeave.welcome()), [{
  method: 'playSong', song: song(1),
  options: { position: 14, autoplay: false, restoreProgress: false, notify: false },
}]);

assert.deepEqual(mergeTogetherState(null, { op: 'seek', payload: { position: 33 } }, true), null);
const state = { song: song(0), position: 20, isPlaying: false };
for (const position of [NaN, Infinity, '90']) {
  assert.equal(mergeTogetherState(state, { op: 'seek', payload: { songId: 0, position } }, true).position, 20);
}
assert.equal(mergeTogetherState(state, { op: 'seek', payload: { songId: 0, position: -5 } }, true).position, 0);
vm.runInNewContext('_stopTogether(); _ensureTogetherWss();', context);
assert.deepEqual(join().welcome().hostSong, null, 'empty/stopped room drops prior context');
console.log(JSON.stringify({ ok: true, checks: [
  'actual room pause/seek/play update late-join snapshots',
  'member controls merge only the current song; guest state cannot replace room context',
  'member song selection updates welcome immediately before the next host heartbeat',
  'wrong-song seeks and stale lastOp cannot corrupt welcome progress',
  'host song change, peer-left pause, host promotion and room reset stay consistent',
  'production mobile welcome consumer receives exact position and autoplay state',
  'nonfinite positions preserve progress and negative positions clamp to zero',
] }, null, 2));
