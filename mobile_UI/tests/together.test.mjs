import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';

test('一起听首次加入保留暂停和短进度，异步切歌没有旧延时seek，重连可接收新序号', async t => {
  const originals = Object.fromEntries(['fetch', 'localStorage', 'location', 'WebSocket'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map([['listen-together', '1']]);
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.location = { protocol: 'http:', host: 'localhost:30967' };
  globalThis.fetch = async url => ({ ok: true,
    json: async () => ({ ok: true, total: 3, likedIndices: [], dislikedIndices: [], progress: 45 }),
    text: async () => `[00:00]${url}`,
  });
  const sockets = [];
  globalThis.WebSocket = class {
    readyState = 1;
    constructor() { sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  };
  class AudioFixture extends EventTarget {
    paused = true; currentTime = 0; readyState = 0; duration = NaN; playbackRate = 1; playCount = 0;
    set src(value) { this.source = value; this.currentTime = 0; this.readyState = 0; this.duration = NaN; this.paused = true; }
    async play() { this.playCount++; this.paused = false; this.dispatchEvent(new Event('play')); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    metadata() { this.readyState = 1; this.duration = 90; this.dispatchEvent(new Event('loadedmetadata')); }
  }
  const { usePlayer } = await import('../src/composables/usePlayer.js');
  const player = usePlayer(), audio = new AudioFixture();
  player.init(audio);
  const { useListenTogether } = await import('../src/composables/useListenTogether.js');
  const together = useListenTogether();
  t.after(async () => {
    together.enabled.value = false;
    await nextTick();
    player.stopDesktopSync();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const socket = sockets[0];
  socket.onopen();
  const message = value => socket.onmessage({ data: JSON.stringify(value) });
  const song = id => ({ id, songName: `远端歌曲 ${id}`, audioPath: `/fixture/${id}.wav` });
  message({ type: 'welcome', id: 2, hostId: 1, peers: 2, hostSong: { song: song(0), position: 2, isPlaying: false } });
  await nextTick();
  assert.equal(audio.playCount, 0);
  assert.equal(player.currentTime.value, 2);
  audio.metadata();
  assert.equal(audio.currentTime, 2);

  message({ type: 'op', seq: 8, op: 'song', payload: { song: song(1), position: 60, isPlaying: false } });
  message({ type: 'op', seq: 9, op: 'song', payload: { song: song(2), position: 12, isPlaying: false } });
  audio.metadata();
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(player.currentSong.value.id, 2);
  assert.equal(audio.currentTime, 12, '上一首的500ms定时器不能跳转当前歌');
  message({ type: 'op', seq: 10, op: 'pause', payload: { position: 18 } });
  assert.equal(player.currentTime.value, 18, '远端暂停也要对齐共享时钟');
  message({ type: 'op', seq: 9, op: 'seek', payload: { songId: 2, position: 80 } });
  assert.equal(audio.currentTime, 18, '同连接丢弃过期消息');
  socket.onopen();
  message({ type: 'op', seq: 1, op: 'seek', payload: { songId: 2, position: 25 } });
  assert.equal(audio.currentTime, 25, '服务重连后接受从头开始的序号');
});
