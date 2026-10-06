import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick(); };
const song = id => ({ id, songName: `远端歌曲 ${id}`, audioPath: `/fixture/${id}.wav` });
const snapshot = (id, position, isPlaying = false, playbackRate = 1) => ({ song: song(id), songId: id,
  audioPath: song(id).audioPath, position, duration: 90, isPlaying, playbackRate, desktopConnected: true });

test('真正与电脑一起听：显式加入、双向控制、倍速、重连与自动播放限制', async t => {
  const keys = ['fetch', 'localStorage', 'location', 'WebSocket', 'setTimeout', 'clearTimeout'];
  const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map(), sockets = [], timers = new Map();
  let blockedStorage = true, timerId = 0;
  globalThis.localStorage = { getItem: key => { if (blockedStorage) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (blockedStorage) throw Error('blocked'); storage.set(key, value); } };
  globalThis.location = { protocol: 'http:', host: 'localhost:30967' };
  globalThis.setTimeout = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.fetch = async url => ({ ok: true, json: async () => ({ ok: true, total: 3,
    songs: [song(0), song(1), song(2)], likedIndices: [], dislikedIndices: [], progress: 45 }),
    text: async () => `[00:00]${url}` });
  globalThis.WebSocket = class {
    readyState = 1; messages = [];
    constructor() { sockets.push(this); }
    send(text) { this.messages.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
  };
  class AudioFixture extends EventTarget {
    paused = true; currentTime = 0; readyState = 0; duration = NaN; playbackRate = 1;
    defaultPlaybackRate = 1; preservesPitch = false; playCount = 0; playResult = null;
    set src(value) { this.source = value; this.currentTime = 0; this.readyState = 0; this.duration = NaN;
      this.paused = true; this.playbackRate = this.defaultPlaybackRate; }
    async play() { this.playCount++; if (this.playResult) await this.playResult;
      this.paused = false; this.dispatchEvent(new Event('play')); }
    pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
    metadata() { this.readyState = 1; this.duration = 90; this.dispatchEvent(new Event('loadedmetadata')); }
  }
  const { usePlayer } = await import('../src/composables/usePlayer.js');
  const player = usePlayer(), audio = new AudioFixture(); player.init(audio);
  const { useListenTogether } = await import('../src/composables/useListenTogether.js');
  const together = useListenTogether();
  t.after(async () => {
    together.enabled.value = false; await flush(); player.stopDesktopSync();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const message = (socket, value) => socket.onmessage?.({ data: JSON.stringify(value) });
  const join = value => {
    together.enabled.value = false; together.enabled.value = true;
    const socket = sockets.at(-1); socket.onopen();
    message(socket, { type: 'welcome', id: 2, seq: 0, hostId: 0, peers: 2,
      desktopConnected: true, hostSong: value }); return socket;
  };

  await t.test('禁用浏览器存储仍默认关闭；不开WS、不控制电脑', async () => {
    assert.equal(together.enabled.value, false); assert.equal(sockets.length, 0);
    await player.playSong(song(2), { autoplay: false, restoreProgress: false });
    player.seekTo(4); assert.equal(sockets.length, 0);
    together.enabled.value = true; together.enabled.value = false;
    blockedStorage = false;
  });
  await t.test('加入以桌面暂停短进度为准；慢metadata和2倍速保持，不回声', async () => {
    const socket = join(snapshot(0, 2, false, 2)); await flush();
    assert.equal(player.currentSong.value.id, 0); assert.equal(player.currentTime.value, 2);
    assert.equal(audio.paused, true); audio.metadata(); assert.equal(audio.currentTime, 2);
    assert.equal(audio.playbackRate, 2); assert.equal(audio.defaultPlaybackRate, 2);
    assert.equal(audio.preservesPitch, true); assert.equal(socket.messages.length, 0);
    assert.equal(together.desktopConnected.value, true); assert.equal(together.peerCount.value, 2);
    assert.equal(together.isHost.value, false);
  });
  await t.test('手机播放暂停、歌词seek与调速带实际歌曲路径发给桌面', async () => {
    const socket = sockets.at(-1); await player.resume(); player.pause(); player.seekTo(18); player.setPlaybackRate(.5);
    const messages = socket.messages.filter(value => value.type === 'op');
    assert.deepEqual(messages.map(value => value.op), ['play', 'pause', 'seek', 'rate']);
    for (const value of messages) assert.equal(value.payload.audioPath, song(0).audioPath);
    assert.equal(messages.at(-1).payload.playbackRate, .5);
  });
  await t.test('连续桌面切歌仅末首生效，旧seq不回跳；暂停与倍率立即对齐', async () => {
    const socket = sockets.at(-1); socket.messages.length = 0;
    message(socket, { type: 'op', from: 0, seq: 8, op: 'state', payload: snapshot(1, 60, false, 2) });
    message(socket, { type: 'op', from: 0, seq: 9, op: 'state', payload: snapshot(2, 12, false, .5) });
    audio.metadata(); await flush(); assert.equal(player.currentSong.value.id, 2); assert.equal(audio.currentTime, 12);
    message(socket, { type: 'op', from: 0, seq: 8, op: 'state', payload: snapshot(1, 80, true) });
    assert.equal(player.currentSong.value.id, 2); assert.equal(audio.playbackRate, .5);
    message(socket, { type: 'op', from: 0, seq: 10, op: 'state', payload: snapshot(2, 18, false, 2) });
    await flush(); assert.equal(audio.currentTime, 18); assert.equal(audio.paused, true); assert.equal(socket.messages.length, 0);
  });
  await t.test('同路径重新编号合并最新id/署名并按歌曲路径重取歌词，不重开音频', async () => {
    const socket = sockets.at(-1), source = audio.source, plays = audio.playCount;
    const value = snapshot(2, 18, false, 2);
    value.song = { ...value.song, id: 0, lyricist: 'Latest real writer' };
    value.songId = 0;
    message(socket, { type: 'op', from: 0, seq: 11, op: 'state', payload: value }); await flush();
    assert.equal(player.currentSong.value.id, 0); assert.equal(player.currentSong.value.lyricist, 'Latest real writer');
    assert.equal(audio.source, source); assert.equal(audio.playCount, plays); assert.equal(audio.currentTime, 18);
    assert.ok(player.lyricText.value.includes('/api/lyric-by-path?path=%2Ffixture%2F2.wav'));
    player.pause(); assert.equal(socket.messages.at(-1).payload.songId, 0);
    assert.equal(socket.messages.at(-1).payload.audioPath, song(2).audioPath);
  });
  await t.test('autoplay拒绝显示受限，用户点击恢复后真实播放；普通校准不重试受限播放', async () => {
    audio.playResult = Promise.reject(Object.assign(Error('gesture required'), { name: 'NotAllowedError' }));
    const socket = join(snapshot(0, 35, true, 2)); await flush(); audio.metadata();
    assert.equal(audio.paused, true); assert.equal(together.autoplayBlocked.value, true);
    const plays = audio.playCount;
    message(socket, { type: 'op', from: 0, seq: 1, op: 'state', payload: snapshot(0, 40, true, 2) });
    await flush(); assert.equal(audio.playCount, plays); assert.equal(audio.currentTime, 40);
    audio.playResult = null; assert.equal(await together.resumeTogether(), true);
    assert.equal(audio.paused, false); assert.equal(together.autoplayBlocked.value, false); assert.equal(audio.playbackRate, 2);
    assert.equal(socket.messages.length, 0, '解除手机autoplay限制不回声桌面play');
  });
  await t.test('关闭不会暂停当前播放；在途远端结果与旧socket不覆盖新本地选歌', async () => {
    const socket = sockets.at(-1), oldMessage = socket.onmessage;
    let release; audio.playResult = new Promise(resolve => { release = resolve; });
    message(socket, { type: 'op', from: 0, seq: 2, op: 'state', payload: snapshot(1, 45, true, 2) });
    together.enabled.value = false; audio.playResult = null;
    await player.playSong(song(2), { restoreProgress: false }); audio.metadata();
    release(); await flush(); oldMessage({ data: JSON.stringify({ type: 'op', from: 0, seq: 100,
      op: 'state', payload: snapshot(0, 80, false) }) });
    assert.equal(player.currentSong.value.id, 2); assert.equal(audio.paused, false);
    assert.equal(together.connected.value, false); assert.equal(socket.onmessage, null);
    const count = socket.messages.length; player.pause(); player.setPlaybackRate(1); assert.equal(socket.messages.length, count);
  });
  await t.test('断线重连以最新桌面快照和新seq为准；旧连接close不影响新连接', async () => {
    const first = join(snapshot(0, 10, false)); await flush(); const staleClose = first.onclose;
    first.onclose(); assert.equal(together.connected.value, false);
    const reconnect = [...timers.values()].at(-1); timers.clear(); reconnect();
    const next = sockets.at(-1); next.onopen(); message(next, { type: 'welcome', id: 3, seq: 0,
      desktopConnected: true, peers: 2, hostSong: snapshot(1, 22, false, .5) }); await flush(); audio.metadata();
    staleClose(); assert.equal(together.connected.value, true); assert.equal(player.currentSong.value.id, 1);
    message(next, { type: 'op', from: 0, seq: 1, op: 'state', payload: snapshot(1, 25, false, .5) });
    await flush(); assert.equal(audio.currentTime, 25);
    together.alignNow(); assert.equal(next.messages.at(-1).type, 'get-state');
    message(next, { type: 'peers', count: 1, desktopConnected: false });
    assert.equal(together.desktopConnected.value, false);
  });
});
