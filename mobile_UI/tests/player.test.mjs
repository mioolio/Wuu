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
const libraryResponse = (url, songs) => {
  if (!url.startsWith('/api/songs?')) return undefined;
  const params = new URL(url, 'http://fixture').searchParams;
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  assert.ok(Number.isInteger(page) && page > 0, '分页必须在有效范围内');
  return response({ ok: true, total: songs.length, songs: songs.slice((page - 1) * size, page * size) });
};

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

test('桌面同步保留歌曲词曲署名，再同步无署名歌曲时不会沿用旧作者', async t => {
  let songInfo = { ...song(0), lyricist: '真实作词', composer: '真实作曲' };
  const { player, audio } = await fixture(t, url => url === '/api/state'
    ? response({ ok: true, state: { index: songInfo.id, songInfo, currentTime: 35, duration: 90 } }) : undefined);
  await player.syncFromDesktop();
  assert.equal(player.currentSong.value.lyricist, '真实作词');
  assert.equal(player.currentSong.value.composer, '真实作曲');
  songInfo = song(1);
  player.stopDesktopSync();
  player.init(audio);
  await player.syncFromDesktop();
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(player.currentSong.value.lyricist, '');
  assert.equal(player.currentSong.value.composer, '');
  assert.equal(audio.playCalls.length, 0, 'reading credits during desktop sync must not start playback');
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

test('随机上一首返回真实听过的歌，回退后下一首沿历史前进而不重新抽歌', async t => {
  const songs = Array.from({ length: 3 }, (_, id) => song(id));
  const random = [songs[2], songs[1]];
  const { player, audio, requests } = await fixture(t, url => url === '/api/random'
    ? response({ ok: true, total: songs.length, song: random.shift() }) : libraryResponse(url, songs));
  player.setPlayMode(2);
  await player.playSong(songs[0]);
  await player.next();
  await player.next();
  assert.equal(player.currentSong.value.id, 1);
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
  await player.prev();
  assert.equal(player.currentSong.value.id, 0);
  audio.metadata();
  player.seekTo(17);
  await player.prev();
  assert.equal(player.currentSong.value.id, 0, '历史开头不凭空抽取另一首');
  assert.equal(audio.currentTime, 17);
  await player.next();
  assert.equal(player.currentSong.value.id, 2);
  await player.next();
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(requests.filter(([url]) => url === '/api/random').length, 2);
});

test('切换模式和点歌保留实际历史，回退后的新选择切断旧前进分支', async t => {
  const songs = Array.from({ length: 5 }, (_, id) => song(id));
  const { player } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[0]);
  await player.playSong(songs[2]);
  await player.playSong(songs[1]);
  player.setPlayMode(2);
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
  await player.playSong(songs[3]);
  player.setPlayMode(0);
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
  await player.next();
  assert.equal(player.currentSong.value.id, 3, '单曲模式也能返回刚才的前进历史');
  player.setPlayMode(1);
  await player.next();
  assert.equal(player.currentSong.value.id, 4, '旧分支中的歌曲1不能再次冒出来');
});

test('首次列表点歌仍可顺序上一首，随后优先回到真实历史', async t => {
  const songs = Array.from({ length: 4 }, (_, id) => song(id));
  const { player } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[2]);
  await player.prev();
  assert.equal(player.currentSong.value.id, 1);
  // 回退后直接点选第一首，切断前进分支，但仍保留过去实际听过的歌曲。
  await player.playSong(songs[0]);
  await player.prev();
  assert.equal(player.currentSong.value.id, 1, '有真实历史时优先回到听过的歌曲');
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
});

test('列表首次播放第一首时，上一首循环到歌库末首', async t => {
  const songs = Array.from({ length: 4 }, (_, id) => song(id));
  const { player } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[0]);
  await player.prev();
  assert.equal(player.currentSong.value.id, 3);
  await player.next();
  assert.equal(player.currentSong.value.id, 0);
});

test('首次暂停或单曲模式的上一首仍顺序导航，首项向前循环并跳过不推荐', async t => {
  const songs = Array.from({ length: 4 }, (_, id) => song(id));
  const { player } = await fixture(t, url => url === '/api/disliked'
    ? response({ ok: true, dislikedIndices: [3] }) : libraryResponse(url, songs));
  player.setPlayMode(0);
  await player.playSong(songs[0], { autoplay: false, notify: false });
  await player.prev();
  assert.equal(player.currentSong.value.id, 2, '首项向前循环，跳过不推荐的末项3');
  assert.equal(player.isPlaying.value, true);
});

test('历史按路径重新定位，跳过已删除与不推荐项，前进也使用新的歌库index', async t => {
  let songs = Array.from({ length: 4 }, (_, id) => song(id));
  let disliked = [];
  const { player } = await fixture(t, url => url === '/api/disliked'
    ? response({ ok: true, dislikedIndices: disliked }) : libraryResponse(url, songs));
  for (const item of songs) await player.playSong(item);
  songs = [songs[0], { ...songs[2], id: 1 }, { ...songs[3], id: 2 }];
  disliked = [1];
  await player.refreshDislikedSet();
  await player.prev();
  assert.equal(player.currentSong.value.audioPath, '/fixture/0.wav');
  await player.next();
  assert.equal(player.currentSong.value.audioPath, '/fixture/3.wav');
  assert.equal(player.currentSong.value.id, 2);
});

test('删除导致历史歌曲跨分页移动时，不能把同index的另一首误当作上一首', async t => {
  let songs = Array.from({ length: 61 }, (_, id) => song(id));
  const { player, requests } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[30]);
  await player.playSong(songs[60]);
  songs = songs.slice(1).map((item, id) => ({ ...item, id }));
  const before = requests.length;
  await player.prev();
  assert.equal(player.currentSong.value.audioPath, '/fixture/30.wav');
  assert.equal(player.currentSong.value.id, 29);
  const pages = requests.slice(before).filter(([url]) => url.includes('pageSize=30')).map(([url]) => new URL(url, 'http://fixture').searchParams.get('page'));
  assert.deepEqual(pages, ['2', '1']);
});

test('无有效历史或空歌库不改变当前音频，也不会改成随机播放', async t => {
  let songs = [song(0), song(1)];
  const { player, audio, requests } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[0]);
  await player.playSong(songs[1]);
  audio.metadata();
  player.seekTo(23);
  const source = audio.source;
  songs = [];
  await player.prev();
  await player.next();
  await player.playSong({ id: -1 });
  await player.playSong({ id: NaN });
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(audio.source, source);
  assert.equal(audio.currentTime, 23);
  assert.equal(player.isPlaying.value, true);
  assert.equal(requests.filter(([url]) => url === '/api/random').length, 0);
});

test('上一首读取失败保留当前歌与进度，重试仍返回同一真实历史项', async t => {
  const songs = [song(0), song(1), song(2)];
  let fail = false;
  const { player, audio, requests } = await fixture(t, url => {
    if (fail && url.includes('pageSize=30')) return Promise.reject(new Error('offline'));
    return libraryResponse(url, songs);
  });
  for (const item of songs) await player.playSong(item);
  audio.metadata();
  player.seekTo(28);
  const source = audio.source;
  fail = true;
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
  assert.equal(audio.source, source);
  assert.equal(audio.currentTime, 28);
  assert.equal(player.isPlaying.value, true);
  fail = false;
  await player.prev();
  assert.equal(player.currentSong.value.id, 1);
  assert.equal(requests.filter(([url]) => url === '/api/random').length, 0);
});

test('旧上一首请求晚到不能覆盖新的手动点歌或改写新历史', async t => {
  const songs = Array.from({ length: 4 }, (_, id) => song(id));
  const pending = deferred();
  let delay = false;
  const { player } = await fixture(t, url => delay && url.includes('pageSize=30') ? pending.promise : libraryResponse(url, songs));
  for (const item of songs.slice(0, 3)) await player.playSong(item);
  delay = true;
  const previous = player.prev();
  await flush();
  await player.playSong(songs[3]);
  delay = false;
  pending.resolve(response({ ok: true, total: songs.length, songs }));
  await previous;
  assert.equal(player.currentSong.value.id, 3);
  await player.prev();
  assert.equal(player.currentSong.value.id, 2);
  await player.next();
  assert.equal(player.currentSong.value.id, 3);
});

test('旧随机请求晚到不能覆盖手动选择或插入其历史', async t => {
  const songs = [song(0), song(1), song(2)];
  const pending = deferred();
  const { player } = await fixture(t, url => url === '/api/random' ? pending.promise : libraryResponse(url, songs));
  await player.playSong(songs[0]);
  const random = player.playRandom();
  await player.playSong(songs[2]);
  pending.resolve(response({ ok: true, total: songs.length, song: songs[1] }));
  await random;
  assert.equal(player.currentSong.value.id, 2);
  await player.prev();
  assert.equal(player.currentSong.value.id, 0);
  await player.next();
  assert.equal(player.currentSong.value.id, 2);
});

test('暂停同步不入听歌历史，恢复成功和远端实际播放才记录且暂停恢复不重复', async t => {
  const songs = [song(0), song(1), song(2)];
  const { player } = await fixture(t, url => libraryResponse(url, songs));
  player.setPlayMode(2);
  await player.playSong(songs[0], { autoplay: false, notify: false });
  await player.playSong(songs[1]);
  await player.prev();
  assert.equal(player.currentSong.value.id, 1, '未听过的同步歌曲0不是上一首');
  await player.playSong(songs[2], { autoplay: false, notify: false });
  await player.prev();
  assert.equal(player.currentSong.value.id, 1, '未播放的新选中歌曲可以返回最近真正听过的歌');
  await player.playSong(songs[2], { autoplay: false, notify: false });
  await player.resume();
  player.pause();
  await player.resume();
  await player.prev();
  assert.equal(player.currentSong.value.id, 1);
  await player.next();
  assert.equal(player.currentSong.value.id, 2);
  player.setRemoteApplying(true);
  await player.playSong(songs[0], { notify: false, restoreProgress: false });
  player.setRemoteApplying(false);
  await player.prev();
  assert.equal(player.currentSong.value.id, 2, '远端实际播放也遵循本机的真实听歌顺序');
});

test('play事件后解码失败的promise也不会被写入成功听歌历史', async t => {
  const songs = [song(0), song(1), song(2)];
  const { player, audio } = await fixture(t, url => libraryResponse(url, songs));
  await player.playSong(songs[0]);
  const originalPlay = audio.play;
  audio.play = async function () {
    // 原生 play 只表示 paused 已解除，音源不可用时仍可能随后拒绝 Promise。
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.paused = true;
    throw new Error('no playable source');
  };
  await player.playSong(songs[1]);
  assert.equal(player.isPlaying.value, false);
  audio.play = originalPlay;
  await player.playSong(songs[2]);
  await player.prev();
  assert.equal(player.currentSong.value.id, 0);
  await player.next();
  assert.equal(player.currentSong.value.id, 2);
});
