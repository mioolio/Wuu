import { test } from 'node:test';
import assert from 'node:assert/strict';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const response = value => ({ ok: true, json: async () => value, text: async () => value });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let sequence = 0;

class AudioFixture extends EventTarget {
  paused = true;
  readyState = 0;
  duration = NaN;
  currentTime = 0;
  playbackRate = 1;
  playCalls = [];
  playResult = null;
  set src(value) {
    this.source = value;
    this.currentTime = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.paused = true;
  }
  async play() {
    this.playCalls.push(this.source);
    if (this.playResult) await this.playResult;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }
  pause() {
    const wasPlaying = !this.paused;
    this.paused = true;
    if (wasPlaying) this.dispatchEvent(new Event('pause'));
  }
  metadata(duration = 90) {
    this.duration = duration;
    this.readyState = 1;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
}

async function fixture(t, route = () => undefined) {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push([String(url), options]);
    const custom = route(String(url), options);
    if (custom !== undefined) return custom;
    if (url === '/api/sync-mode') return response({ mode: 'merged' });
    if (url === '/api/liked') return response({ ok: true, likedIndices: [] });
    if (url === '/api/disliked') return response({ ok: true, dislikedIndices: [] });
    if (String(url).startsWith('/api/songs')) return response({ ok: true, total: 3, songs: [] });
    if (String(url).startsWith('/api/lyric')) return response(`[00:00]歌词 ${url}`);
    return response({ ok: true, progress: 0 });
  };
  const { usePlayer } = await import(`../src/composables/usePlayer.js?test=${++sequence}`);
  const player = usePlayer();
  const audio = new AudioFixture();
  player.init(audio);
  t.after(() => { player.stopDesktopSync(); globalThis.fetch = previousFetch; });
  return { player, audio, requests };
}
const song = id => ({ id, songName: `歌曲 ${id}`, audioPath: `/fixture/${id}.wav` });

test('首次同步在元数据前提供桌面进度，元数据到达后真正seek且不自动播放', async t => {
  const { player, audio, requests } = await fixture(t, url => url === '/api/state'
    ? response({ ok: true, state: { index: 0, songInfo: song(0), audioPath: '/fixture/0.wav', currentTime: 35, duration: 90, playMode: 1, isPlaying: true } }) : undefined);
  await player.startDesktopSync();
  await flush();
  assert.equal(player.currentTime.value, 35);
  assert.equal(player.duration.value, 90);
  assert.match(player.lyricText.value, /lyric\/0/);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCalls.length, 0);
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(player.currentTime.value, 35, '加载期事件不能清零目标进度');
  audio.metadata();
  assert.equal(audio.currentTime, 35);
  assert.equal(player.currentTime.value, 35);
  assert.equal(player.isPlaying.value, false);
  assert.equal(requests.filter(([url]) => url === '/api/play-count').length, 0);
  await player.resume();
  assert.equal(player.isPlaying.value, true);
  assert.equal(requests.filter(([url]) => url === '/api/play-count').length, 1, '首次真正播放才计数');
});

test('连续切歌丢弃旧歌词和旧进度响应', async t => {
  const oldLyric = deferred(), oldProgress = deferred();
  const { player, audio } = await fixture(t, url => {
    if (url === '/api/lyric/0') return oldLyric.promise;
    if (url === '/api/progress/0') return oldProgress.promise;
    if (url === '/api/lyric/1') return response('[00:00]最后选择的歌');
  });
  const first = player.playSong(song(0));
  await flush();
  await player.playSong(song(1));
  audio.metadata();
  player.seekTo(12);
  oldLyric.resolve(response('[00:00]已经切走的歌'));
  oldProgress.resolve(response({ ok: true, progress: 48 }));
  await first;
  await flush();
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(player.lyricText.value, '[00:00]最后选择的歌');
  assert.equal(audio.currentTime, 12);
});

test('旧play promise失败晚到不覆盖新歌曲状态或请求旧进度', async t => {
  const oldPlay = deferred();
  const { player, audio, requests } = await fixture(t);
  audio.playResult = oldPlay.promise;
  const first = player.playSong(song(0));
  audio.playResult = null;
  await player.playSong(song(1));
  audio.metadata();
  oldPlay.reject(new Error('source was replaced'));
  await first;
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(player.isPlaying.value, true);
  assert.equal(player.isLoading.value, false);
  assert.equal(requests.filter(([url]) => url === '/api/progress/0').length, 0);
});

test('手动seek优先于晚到的历史进度', async t => {
  const history = deferred();
  const { player, audio } = await fixture(t, url => url === '/api/progress/0' ? history.promise : undefined);
  const playing = player.playSong(song(0));
  await flush();
  audio.metadata();
  player.seek(80);
  history.resolve(response({ ok: true, progress: 15 }));
  await playing;
  assert.equal(player.currentTime.value, 72);
  assert.equal(audio.currentTime, 72);
});

test('远端暂停歌曲在慢加载后对齐目标，不播放或恢复历史进度', async t => {
  const { player, audio, requests } = await fixture(t);
  await player.playSong(song(0), { position: 2, autoplay: false, restoreProgress: false, notify: false });
  assert.equal(player.currentTime.value, 2);
  assert.equal(audio.playCalls.length, 0);
  audio.metadata();
  assert.equal(audio.currentTime, 2, '小于3秒也需要同步');
  assert.equal(requests.filter(([url]) => url.startsWith('/api/progress/')).length, 0);
  assert.equal(player.isPlaying.value, false);
});

test('元数据未到时暂停广播和保存仍使用待对齐的35秒', async t => {
  const { player, audio, requests } = await fixture(t);
  await player.playSong(song(0), { position: 35, autoplay: false, notify: false });
  const operations = [];
  player.setOpNotifier((...args) => operations.push(args));
  player.pause();
  assert.equal(audio.currentTime, 0);
  assert.equal(player.currentTime.value, 35);
  assert.deepEqual(operations.at(-1), ['pause', { position: 35 }]);
  const saved = requests.find(([url]) => url === '/api/progress');
  assert.deepEqual(JSON.parse(saved[1].body), { index: 0, time: 35 });
  // 系统直接暂停（耳机/锁屏）同样不能广播加载期元素的0秒。
  await player.resume();
  operations.length = 0;
  audio.pause();
  assert.deepEqual(operations.at(-1), ['pause', { position: 35 }]);
  audio.metadata();
  assert.equal(audio.currentTime, 35);
});

test('换歌清除前歌等待中的seek；边界进度裁剪到歌曲范围', async t => {
  const { player, audio } = await fixture(t);
  await player.playSong(song(0), { position: 60, autoplay: false, notify: false });
  await player.playSong(song(1), { autoplay: false, notify: false });
  audio.metadata(20);
  assert.equal(audio.currentTime, 0);
  player.seek(250);
  assert.equal(audio.currentTime, 20);
  player.seekTo(-9);
  assert.equal(audio.currentTime, 0);
  player.seekTo(NaN);
  assert.equal(audio.currentTime, 0);
});

test('浏览器拒绝播放时保持暂停，不虚报次数或播放广播', async t => {
  const { player, audio, requests } = await fixture(t);
  await player.playSong(song(0), { autoplay: false, notify: false });
  const operations = [];
  player.setOpNotifier((...args) => operations.push(args));
  audio.playResult = Promise.reject(new Error('autoplay denied'));
  await player.resume();
  assert.equal(player.isPlaying.value, false);
  assert.equal(requests.filter(([url]) => url === '/api/play-count').length, 0);
  assert.equal(operations.length, 0);
});

test('迟到的桌面启动同步不能覆盖用户已选择的歌曲', async t => {
  const desktopState = deferred();
  const { player } = await fixture(t, url => url === '/api/state' ? desktopState.promise : undefined);
  const syncing = player.startDesktopSync();
  await flush();
  await player.playSong(song(1), { autoplay: false, notify: false });
  desktopState.resolve(response({ ok: true, state: { index: 0, songInfo: song(0), currentTime: 60 } }));
  await syncing;
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(player.currentTime.value, 0);
});

test('初始化去重且暂停后的原生seek更新共享时钟', async t => {
  const { player, audio, requests } = await fixture(t);
  player.init(audio);
  await player.playSong(song(0), { autoplay: false, notify: false });
  audio.metadata();
  audio.currentTime = 24;
  audio.dispatchEvent(new Event('seeked'));
  assert.equal(player.currentTime.value, 24);
  await player.resume();
  assert.equal(requests.filter(([url]) => url === '/api/play-count').length, 1);
});

test('暂停和seek调用系统媒体进度API而不是写无效属性', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  const metadataDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaMetadata');
  const positions = [];
  const actions = new Map();
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: {
    setSupportedMediaActions() {},
    setActionHandler: (name, handler) => actions.set(name, handler),
    setPositionState: position => positions.push(position),
  } });
  globalThis.MediaMetadata = class { constructor(value) { Object.assign(this, value); } };
  t.after(() => {
    if (descriptor) Object.defineProperty(navigator, 'mediaSession', descriptor);
    else delete navigator.mediaSession;
    if (metadataDescriptor) Object.defineProperty(globalThis, 'MediaMetadata', metadataDescriptor);
    else delete globalThis.MediaMetadata;
  });
  const { player, audio } = await fixture(t);
  await player.playSong(song(0), { autoplay: false, notify: false });
  audio.metadata();
  actions.get('seekto')({ seekTime: 36 });
  player.pause();
  assert.deepEqual(positions.at(-1), { duration: 90, playbackRate: 1, position: 36 });
  assert.equal(player.currentTime.value, 36);
});
