// =========== 播放器核心 composable ===========
// 管理: 当前歌曲 / 播放状态 / 循环模式 / 下一首逻辑 / MediaSession API
// 数据同步: 播放次数上报 / 播放进度上报与恢复 / 点赞状态
// MediaSession: 让安卓锁屏/通知栏/状态栏显示封面+歌名+上一首下一首控制
import { ref, computed } from 'vue';
import { fetchRandomSong, streamUrl, streamByPath, coverUrl, coverByPath, fetchLyric, reportPlayCount, reportProgress, fetchProgress, toggleLike, fetchLiked, fetchDisliked, toggleDislike, fetchDesktopState, fetchSyncMode } from '../api.js';

// ===== 播放状态 =====
const currentSong = ref(null);       // 当前歌曲对象
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const isLoading = ref(false);

// ===== 循环模式: 0=单曲循环, 1=列表循环, 2=随机 =====
const playMode = ref(1);  // 默认列表循环 (同步电脑端)
const MODE_NAMES = ['单曲循环', '列表循环', '随机播放'];
const MODE_ICONS = ['repeat-one', 'repeat', 'shuffle'];

// ===== 歌词 =====
const lyricText = ref('');

// ===== 点赞状态 =====
const likedSet = ref(new Set());     // 已喜欢歌曲的 index 集合
const isLiked = ref(false);          // 当前歌曲是否已喜欢

// ===== 不推荐状态 (与喜欢互斥: 标记不推荐时自动取消喜欢) =====
const dislikedSet = ref(new Set()); // 已不推荐歌曲的 index 集合
const isDisliked = ref(false);      // 当前歌曲是否已不推荐

// ===== 内部状态 =====
let audioEl = null;
let songRequest = 0; // 只有当前歌曲的异步结果可以更新播放器
let seekRevision = 0;
let pendingSeek = null;
let removeAudioListeners = null;

// ===== 一起听广播 hook =====
// useListenTogether 注册: 本地播放操作 → WS 广播给其他端
let _opNotifier = null;
function setOpNotifier(fn) { _opNotifier = fn; }
function _notifyOp(op, payload) {
  if (typeof _opNotifier === 'function') _opNotifier(op, payload);
}

// 远端操作应用期间标志: 跳过本地进度恢复等与同步冲突的逻辑
let _remoteApplying = false;
// 远端应用后的宽限窗口: 'play'/'pause' 事件异步触发时仍视为远端引起, 不回声广播
let _remoteApplyUntil = 0;
function setRemoteApplying(v) {
  _remoteApplying = !!v;
  if (v) _remoteApplyUntil = Date.now() + 800;
}

// ===== 一起听状态查询 (useListenTogether 注册, 避免循环依赖) =====
// 返回 { connected, isHost } 或 null (未启用一起听)
let _listenStatus = null;
function setListenStatusProvider(fn) { _listenStatus = fn; }
function _listenSync() {
  return typeof _listenStatus === 'function' ? _listenStatus() : null;
}

// 播放态同步去重: pause()/resume() 已主动广播, 事件监听只需补发"非受控"变化
// (锁屏/耳机拔插/来电中断等系统直接暂停 audio 元素, 不经过 pause()/resume())
let _lastSyncedPaused = null;

// 非主持端歌曲播完后的待切歌标记: 等待 host 广播切歌;
// 若 host 退出使本地成为新 host, 由 flushPendingAdvance() 补切;
// 超时 (房间已解散/host 失联) 则本地兜底切歌
let _pendingHostAdvance = false;
let _pendingAdvanceTimer = null;
let lastIndex = -1;       // 上一首的 index (用于列表循环下一首)
let totalSongs = 0;       // 歌库总数 (从 /api/random 返回)
let progressTimer = null; // 进度上报定时器
let lastReportedTime = 0; // 上次上报的进度时间 (避免重复上报)
let hasReportedPlay = false;  // 当前歌曲是否已上报播放次数

// 获取 audio 元素 (供 LyricsView 等组件 rAF 读取 currentTime)
function getAudioEl() {
  return audioEl;
}

function playbackPosition() {
  if (pendingSeek?.request === songRequest) return pendingSeek.position;
  return Number.isFinite(audioEl?.currentTime) ? Math.max(0, audioEl.currentTime) : 0;
}

// ===== 初始化音频元素 =====
function init(audio) {
  if (audioEl === audio) return;
  if (removeAudioListeners) removeAudioListeners();
  audioEl = audio;
  if (!audioEl) return;

  const listeners = [];
  const on = (event, handler) => {
    audio.addEventListener(event, handler);
    listeners.push([event, handler]);
  };
  removeAudioListeners = () => {
    for (const [event, handler] of listeners) audio.removeEventListener(event, handler);
  };

  on('play', () => {
    isPlaying.value = true;
    updateMediaPlaybackState();
    if (currentSong.value && !hasReportedPlay) {
      hasReportedPlay = true;
      reportPlayCount(currentSong.value.id);
    }
    startProgressTimer();
    // 一起听: 补发"非受控"播放变化 (系统自动播放等不经过 resume() 的场景)
    if (!_remoteApplying && Date.now() > _remoteApplyUntil && _lastSyncedPaused !== false) {
      _lastSyncedPaused = false;
      _notifyOp('play', {});
    }
  });
  on('pause', () => {
    isPlaying.value = false;
    updateMediaPlaybackState();
    // 暂停时同步进度 (定格当前位置), 确保系统通知栏保留控件并显示正确进度
    updateMediaPositionState();
    // 一起听: 补发"非受控"暂停 (锁屏/耳机拔插/来电中断直接暂停 audio 元素)
    if (!_remoteApplying && Date.now() > _remoteApplyUntil && _lastSyncedPaused !== true) {
      _lastSyncedPaused = true;
      _notifyOp('pause', { position: playbackPosition() });
    }
  });
  const syncPosition = () => {
    if (!pendingSeek) currentTime.value = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
    // 同步 MediaSession 位置 (节流: 每 500ms 更新一次)
    if (isPlaying.value) {
      updateMediaPositionState();
    }
  };
  on('timeupdate', syncPosition);
  on('seeking', syncPosition);
  on('seeked', syncPosition);
  on('loadedmetadata', () => {
    duration.value = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
    applyPendingSeek();
    syncPosition();
    updateMediaPositionState();
  });
  on('ended', () => {
    handleEnded();
  });
  on('error', (e) => {
    console.error('[audio error]', e);
    isPlaying.value = false;
    isLoading.value = false;
    updateMediaPlaybackState();
  });

  setupMediaSession();
  // 加载已喜欢/不推荐列表
  refreshLikedSet();
  refreshDislikedSet();
}

// ===== 桌面端状态同步 =====
let _syncDone = false;  // 是否已完成首次同步

// 启动桌面状态同步 (仅首次同步一次, 不轮询)
async function startDesktopSync() {
  if (_syncDone) return;
  _syncDone = true;
  const initialRequest = songRequest;

  // 一起听开启时房间状态优先: 等待 WS welcome 应用 host 的歌曲与进度 (最长 3s)。
  // 否则"桌面启动同步"与"一起听房间同步"会同时设置歌曲互相覆盖 (两个同步打架)
  const listen = _listenSync();
  if (listen && listen.enabled) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !currentSong.value) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (currentSong.value) return;  // 房间已提供歌曲, 跳过桌面同步
    // 房间无状态 (空房/连接失败): 回退桌面同步
  }

  // 检查同步模式
  try {
    const modeResp = await fetchSyncMode();
    if (modeResp.mode === 'isolated') return;  // 分桶存储模式, 不同步
  } catch (_) {}

  // 仅同步一次当前歌曲信息
  try {
    const state = await fetchDesktopState();
    // 用户已经主动选歌时，迟到的启动请求不能覆盖它。
    if (songRequest !== initialRequest) return;
    if (!state || !state.songInfo || state.index < 0) return;

    const song = {
      id: state.index,
      songName: state.songInfo.songName || '',
      artist: state.songInfo.artist || '',
      album: state.songInfo.album || '',
      hasCover: state.songInfo.hasCover || false,
      coverPath: state.songInfo.coverPath || '',
      audioPath: state.audioPath || state.songInfo.audioPath || '',
    };
    playMode.value = state.playMode != null ? state.playMode : 1;
    // 首次进入保留浏览器的点击播放行为，但先对齐桌面的歌词和进度。
    const syncRequest = songRequest + 1;
    await playSong(song, { position: state.currentTime, autoplay: false, restoreProgress: false, notify: false });
    if (songRequest === syncRequest && !duration.value && Number.isFinite(state.duration)) duration.value = Math.max(0, state.duration);
  } catch (e) {
    console.warn('[sync] 桌面状态同步失败:', e.message);
  }
}

function stopDesktopSync() {
  songRequest++;
  pendingSeek = null;
  stopProgressTimer();
  if (_pendingAdvanceTimer) clearTimeout(_pendingAdvanceTimer);
  _pendingAdvanceTimer = null;
  if (removeAudioListeners) removeAudioListeners();
  removeAudioListeners = null;
  audioEl = null;
  _syncDone = false;
}

// 从桌面端同步状态 (保留供外部调用, 行为同 startDesktopSync)
async function syncFromDesktop() {
  await startDesktopSync();
}

// ===== MediaSession API: 安卓锁屏/通知栏/状态栏媒体控件 =====
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;

  // 声明支持的媒体操作 (必须显式声明, 否则系统会将按钮置灰禁用)
  try {
    navigator.mediaSession.setSupportedMediaActions([
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekto',
      'stop',
    ]);
  } catch (e) {
    console.warn('[MediaSession] setSupportedMediaActions 失败:', e.message);
  }

  // 设置可控制的操作按钮
  navigator.mediaSession.setActionHandler('play', () => {
    resume();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    isPlaying.value = false;
    updateMediaPlaybackState();
    pause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null && audioEl) {
      seekTo(details.seekTime);
    }
  });
  navigator.mediaSession.setActionHandler('stop', () => {
    isPlaying.value = false;
    updateMediaPlaybackState();
    pause();
  });
}

// 更新 MediaSession 元数据 (封面/歌名/艺人)
function updateMediaMetadata() {
  if (!('mediaSession' in navigator) || !currentSong.value) return;
  const song = currentSong.value;
  const artwork = song.hasCover
    ? [{
        src: song.coverPath ? coverByPath(song.coverPath) : coverUrl(song.id),
        sizes: '512x512',
        type: 'image/jpeg',
      }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.songName || '未知歌曲',
    artist: song.artist || '未知艺人',
    album: song.album || '',
    artwork,
  });
  updateMediaPlaybackState();
  updateMediaPositionState();
}

// 更新 MediaSession 播放状态 (playing/paused)
function updateMediaPlaybackState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused';
}

// 更新 MediaSession 位置状态 (进度条同步, 支持系统进度条拖动)
function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !audioEl) return;
  const dur = audioEl.duration;
  // duration 无效 (NaN/0/负数, 切歌中间态) 时不设置:
  // 规范要求 duration 为正数, 无效值会抛错并使系统会话进入异常状态 (暂停后通知栏控件消失)
  if (!isFinite(dur) || dur <= 0) return;
  const pos = Math.min(playbackPosition(), dur);
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: audioEl.playbackRate || 1,
      position: pos,
    });
  } catch (e) { /* 个别浏览器对 position 越界等仍可能抛错, 忽略不影响播放 */ }
}

// ===== 刷新喜欢列表 =====
async function refreshLikedSet() {
  try {
    const data = await fetchLiked();
    likedSet.value = new Set(data.likedIndices || []);
    updateLikeState();
  } catch (e) {
    console.warn('[sync] 加载喜欢列表失败:', e.message);
  }
}

// 更新当前歌曲的点赞状态
function updateLikeState() {
  if (currentSong.value) {
    isLiked.value = likedSet.value.has(currentSong.value.id);
  } else {
    isLiked.value = false;
  }
  updateDislikeState();
}

// ===== 切换点赞 =====
async function handleToggleLike() {
  if (!currentSong.value) return;
  const index = currentSong.value.id;
  try {
    const data = await toggleLike(index);
    if (data.ok) {
      if (data.liked) {
        likedSet.value.add(index);
        // 互斥: 本地同步清除不推荐态 (服务端已清除标记)
        dislikedSet.value.delete(index);
        dislikedSet.value = new Set(dislikedSet.value);
        isDisliked.value = false;
      } else {
        likedSet.value.delete(index);
      }
      // 触发响应式更新
      likedSet.value = new Set(likedSet.value);
      isLiked.value = data.liked;
      // 一起听: 广播点赞变化, 他端红心立即同步
      _notifyOp('like', { index, liked: data.liked });
    }
  } catch (e) {
    console.warn('[sync] 点赞失败:', e.message);
  }
}

// 应用他端点赞变化 (一起听广播, 不回传服务器)
function applyRemoteLike(index, liked) {
  if (typeof index !== 'number' || index < 0) return;
  if (liked) {
    likedSet.value.add(index);
  } else {
    likedSet.value.delete(index);
  }
  likedSet.value = new Set(likedSet.value);
  if (currentSong.value && currentSong.value.id === index) {
    isLiked.value = liked;
  }
}

// ===== 不推荐 =====
// 刷新不推荐列表
async function refreshDislikedSet() {
  try {
    const data = await fetchDisliked();
    dislikedSet.value = new Set(data.dislikedIndices || []);
    updateDislikeState();
  } catch (e) {
    console.warn('[sync] 加载不推荐列表失败:', e.message);
  }
}

// 更新当前歌曲的不推荐状态 (切歌时调用)
function updateDislikeState() {
  if (currentSong.value) {
    isDisliked.value = dislikedSet.value.has(currentSong.value.id);
  } else {
    isDisliked.value = false;
  }
}

// 切换不推荐 (与喜欢互斥: 服务端标记不推荐时已从歌单移除, 本地同步清理喜欢态)
async function handleToggleDislike() {
  if (!currentSong.value) return;
  const index = currentSong.value.id;
  try {
    const data = await toggleDislike(index);
    if (data.ok) {
      if (data.disliked) {
        dislikedSet.value.add(index);
        // 互斥: 本地同步清理喜欢态 (服务端已从所有歌单移除)
        likedSet.value.delete(index);
        likedSet.value = new Set(likedSet.value);
        isLiked.value = false;
      } else {
        dislikedSet.value.delete(index);
      }
      dislikedSet.value = new Set(dislikedSet.value);
      isDisliked.value = data.disliked;
    }
  } catch (e) {
    console.warn('[sync] 不推荐操作失败:', e.message);
  }
}

// ===== 进度上报定时器 =====
function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (isPlaying.value && currentSong.value && audioEl) {
      const t = Math.floor(playbackPosition());
      // 每 5 秒上报一次, 或进度变化超过 5 秒
      if (Math.abs(t - lastReportedTime) >= 5) {
        lastReportedTime = t;
        reportProgress(currentSong.value.id, t);
      }
    }
  }, 3000);
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

// ===== 播放指定歌曲 =====
async function playSong(song, options = {}) {
  if (!audioEl || !song) return;
  // 进入时捕获远端应用标志: playSong 是异步的, 广播时窗口可能已关闭,
  // 远端触发的切歌若回声广播会导致房间内 song 操作互相反弹
  const suppressNotify = options.notify === false || _remoteApplying;
  const request = ++songRequest;
  const audio = audioEl;
  const stillCurrent = () => request === songRequest && audio === audioEl;
  const autoplay = options.autoplay !== false;
  isLoading.value = true;
  lastIndex = currentSong.value ? currentSong.value.id : -1;
  currentSong.value = song;
  hasReportedPlay = false;
  stopProgressTimer();
  pendingSeek = null;
  seekRevision++;

  // 后台预热歌库总数 (不阻塞播放), 确保下一首/上一首能顺序切换
  ensureTotalSongs();

  // 切换歌曲前重置进度, 避免上一首进度残留到新歌
  currentTime.value = 0;
  duration.value = 0;
  lyricText.value = '';
  lastReportedTime = 0;

  // 更新点赞状态
  updateLikeState();

  audio.playbackRate = 1;
  isPlaying.value = false;
  audio.src = song.audioPath
    ? streamByPath(song.audioPath)
    : streamUrl(song.id);
  // 'song' 广播已携带 isPlaying, 标记同步态抑制 'play' 事件的重复广播
  _lastSyncedPaused = !autoplay;
  // 本地/远端切歌均视为已处理, 清除非主持端待切歌标记及其超时兜底
  _pendingHostAdvance = false;
  if (_pendingAdvanceTimer) {
    clearTimeout(_pendingAdvanceTimer);
    _pendingAdvanceTimer = null;
  }
  if (Number.isFinite(options.position)) seekTo(options.position);
  const restoreRevision = seekRevision;
  // 歌词不必等待音频开始播放（移动浏览器可能禁止自动播放）。
  loadLyric(song.id, request);
  updateMediaMetadata();
  refreshLikedSet();
  try {
    if (autoplay) await audio.play();
    else audio.pause();
  } catch (e) {
    if (stillCurrent()) console.warn('播放失败:', e);
  } finally {
    if (stillCurrent()) {
      isLoading.value = false;
      isPlaying.value = !audio.paused;
      _lastSyncedPaused = audio.paused;
      updateMediaPlaybackState();
    }
  }
  if (!stillCurrent()) return;

  // 尝试恢复上次播放进度 (一起听远端切歌时跳过, 进度由对端同步)
  if (!suppressNotify && options.restoreProgress !== false && !Number.isFinite(options.position)) {
    try {
      const savedProgress = await fetchProgress(song.id);
      if (!stillCurrent()) return;
      // 用户在请求期间跳转过时，保留用户的新位置。
      if (seekRevision === restoreRevision && savedProgress > 5 && savedProgress < (audio.duration || 9999) - 5) {
        seekTo(savedProgress);
        lastReportedTime = Math.floor(savedProgress);
      }
    } catch (e) { /* 忽略进度恢复失败 */ }
  }
  if (!stillCurrent()) return;

  // 一起听: 广播切歌 (含完整歌曲对象+当前进度, 对端可直接对齐);
  // 远端应用触发的切歌不回声广播
  if (!suppressNotify) {
    _notifyOp('song', {
      song,
      position: currentTime.value,
      isPlaying: !audio.paused,
    });
  }

  // 启动进度上报
  if (!audio.paused) startProgressTimer();
}

// ===== 随机播放一首 (推荐页用) =====
async function playRandom() {
  try {
    const data = await fetchRandomSong();
    totalSongs = data.total;
    await playSong(data.song);
  } catch (e) {
    console.error('随机播放失败:', e);
  }
}

// ===== 播放控制 =====
function pause() {
  _lastSyncedPaused = true;
  stopProgressTimer();
  // 加载中音频元素仍可能处于0秒，保留已经同步到界面的目标进度。
  const position = playbackPosition();
  if (audioEl && !audioEl.paused) {
    audioEl.pause();
  }
  // 立即更新 MediaSession 状态 (不等事件触发)
  isPlaying.value = false;
  updateMediaPlaybackState();
  // 暂停时定格进度, 确保系统通知栏保留媒体控件并显示正确位置
  updateMediaPositionState();
  // 暂停时上报当前进度
  if (currentSong.value && audioEl) {
    reportProgress(currentSong.value.id, Math.floor(position));
  }
  // 一起听: 广播暂停 (标记同步态, 'pause' 事件不重复广播)
  _lastSyncedPaused = true;
  _notifyOp('pause', { position });
}

async function resume() {
  const audio = audioEl;
  const request = songRequest;
  const suppressNotify = _remoteApplying;
  _lastSyncedPaused = false;
  if (audioEl && audioEl.paused) {
    // 恢复正常速率 (清除进度校准的微调)
    audioEl.playbackRate = 1;
    try {
      await audio.play();
    } catch (_) {
      if (audio === audioEl && request === songRequest) {
        isPlaying.value = false;
        _lastSyncedPaused = true;
        updateMediaPlaybackState();
      }
      return;
    }
  }
  if (!audio || audio !== audioEl || request !== songRequest || audio.paused) return;
  // 立即更新 MediaSession 状态
  isPlaying.value = !audio.paused;
  updateMediaPlaybackState();
  // 一起听: 广播播放 (标记同步态, 'play' 事件不重复广播)
  _lastSyncedPaused = false;
  if (!suppressNotify) _notifyOp('play', {});
}

function togglePlay() {
  if (!audioEl) return;
  if (audioEl.paused) resume(); else pause();
}

// ===== 确保歌库总数已知 =====
// totalSongs 只在 playRandom 时赋值; 从列表点歌/桌面同步后播放时为 0,
// 导致点"下一首"误走随机兜底 (表现为重置播放状态而非顺序切换)
async function ensureTotalSongs() {
  if (totalSongs > 0) return;
  try {
    const { fetchSongsPage } = await import('../api.js');
    const data = await fetchSongsPage(1, 1);
    totalSongs = data.total || 0;
  } catch (e) { /* 获取失败保持 0, next/prev 走随机兜底 */ }
}

// ===== 下一首 (根据循环模式) =====
async function next() {
  if (!currentSong.value) {
    await playRandom();
    return;
  }
  await ensureTotalSongs();
  switch (playMode.value) {
    case 0: // 单曲循环: 重播当前
      if (audioEl) {
        seekTo(0);
        resume();
      }
      break;
    case 2: // 随机: 拉一首随机
      await playRandom();
      break;
    case 1: // 列表循环: 下一首 (用 index+1, 超界回 0)
    default:
      await playNextSequential();
      break;
  }
}

// 列表循环: 顺序下一首
async function playNextSequential() {
  if (!currentSong.value || totalSongs === 0) {
    await playRandom();
    return;
  }
  const nextIdx = (currentSong.value.id + 1) % totalSongs;
  // 复用 playSong, 需要歌曲对象; 这里用 fetchSongsPage 拿单首
  try {
    const { fetchSongsPage } = await import('../api.js');
    const page = Math.floor(nextIdx / 30) + 1;
    const data = await fetchSongsPage(page, 30);
    const song = data.songs.find(s => s.id === nextIdx);
    if (song) await playSong(song);
    else await playRandom();
  } catch (e) {
    await playRandom();
  }
}

// ===== 上一首 =====
async function prev() {
  if (!currentSong.value) {
    await playRandom();
    return;
  }
  await ensureTotalSongs();
  // 简化: 随机模式下也随机, 列表模式下顺序上一首
  if (playMode.value === 2 || totalSongs === 0) {
    await playRandom();
  } else {
    const prevIdx = (currentSong.value.id - 1 + totalSongs) % totalSongs;
    try {
      const { fetchSongsPage } = await import('../api.js');
      const page = Math.floor(prevIdx / 30) + 1;
      const data = await fetchSongsPage(page, 30);
      const song = data.songs.find(s => s.id === prevIdx);
      if (song) await playSong(song);
      else await playRandom();
    } catch (e) {
      await playRandom();
    }
  }
}

// ===== 播放结束处理 =====
function handleEnded() {
  // 上报最终进度
  if (currentSong.value && audioEl) {
    reportProgress(currentSong.value.id, Math.floor(audioEl.currentTime));
  }
  stopProgressTimer();
  // 一起听开启期间: 只有 host 自动切歌, 非主持端等待 host 广播后跟随
  // (两台设备几乎同时播完时各自切歌, 会因强制同步互相覆盖、乱跳或无法播放)
  const listen = _listenSync();
  if (listen && listen.enabled) {
    if (listen.isHost) {
      next();
      return;
    }
    _pendingHostAdvance = true;
    // 超时兜底: host 5s 内没有广播 (房间已解散/host 失联), 本地自行切歌
    if (_pendingAdvanceTimer) clearTimeout(_pendingAdvanceTimer);
    _pendingAdvanceTimer = setTimeout(() => {
      _pendingAdvanceTimer = null;
      if (!_pendingHostAdvance) return;
      _pendingHostAdvance = false;
      if (currentSong.value && audioEl && audioEl.ended) next();
    }, 5000);
    return;
  }
  next();
}

// 非主持端继任为 host 后补切 pending 的下一首 (前 host 在切歌瞬间退出的兜底)
function flushPendingAdvance() {
  if (_pendingAdvanceTimer) {
    clearTimeout(_pendingAdvanceTimer);
    _pendingAdvanceTimer = null;
  }
  if (!_pendingHostAdvance) return;
  _pendingHostAdvance = false;
  if (currentSong.value && audioEl && audioEl.ended) next();
}

// ===== 进度跳转 =====
function applyPendingSeek() {
  if (!pendingSeek || !audioEl || audioEl.readyState < 1) return;
  if (pendingSeek.request !== songRequest) {
    pendingSeek = null;
    return;
  }
  const limit = Number.isFinite(audioEl.duration) ? Math.max(0, audioEl.duration) : Infinity;
  const target = Math.min(pendingSeek.position, limit);
  try {
    audioEl.currentTime = target;
    currentTime.value = target;
    pendingSeek = null;
  } catch (_) { /* 元数据尚未可用于seek，下一次loadedmetadata再对齐 */ }
}

// 元数据到达前也保存目标时间；不依赖固定延时，对慢连接同样有效。
function seekTo(position) {
  if (!audioEl || !Number.isFinite(position)) return;
  seekRevision++;
  const target = Math.max(0, position);
  pendingSeek = { request: songRequest, position: target };
  currentTime.value = target;
  applyPendingSeek();
  updateMediaPositionState();
}

function seek(percent) {
  if (!audioEl || !duration.value || !Number.isFinite(percent)) return;
  seekTo((Math.min(100, Math.max(0, percent)) / 100) * duration.value);
  // 同步 MediaSession 位置
  updateMediaPositionState();
  // 一起听: 广播进度跳转 (带 songId, 对端歌不同时忽略, 防止跨歌同步时间)
  _notifyOp('seek', {
    position: currentTime.value,
    isPlaying: !audioEl.paused,
    songId: currentSong.value ? currentSong.value.id : null,
  });
}

// ===== 循环模式切换 =====
function cyclePlayMode() {
  playMode.value = (playMode.value + 1) % 3;
}
function setPlayMode(m) {
  const v = ((m % 3) + 3) % 3;
  playMode.value = v;
}

const playModeName = computed(() => MODE_NAMES[playMode.value]);
const playModeIcon = computed(() => MODE_ICONS[playMode.value]);
const progressPercent = computed(() => {
  if (!duration.value) return 0;
  return (currentTime.value / duration.value) * 100;
});

// ===== 歌词加载 =====
async function loadLyric(id, request = songRequest) {
  lyricText.value = '';
  try {
    const text = await fetchLyric(id);
    if (request === songRequest && currentSong.value?.id === id) lyricText.value = text;
  } catch (e) {
    console.warn('歌词加载失败:', e);
  }
}

export function usePlayer() {
  return {
    // 状态
    currentSong,
    isPlaying,
    currentTime,
    duration,
    isLoading,
    playMode,
    playModeName,
    playModeIcon,
    progressPercent,
    lyricText,
    isLiked,
    likedSet,
    isDisliked,
    dislikedSet,
    // 方法
    init,
    playSong,
    playRandom,
    pause,
    resume,
    togglePlay,
    next,
    prev,
    seek,
    seekTo,
    cyclePlayMode,
    setPlayMode,
    getAudioEl,
    handleToggleLike,
    applyRemoteLike,
    refreshLikedSet,
    handleToggleDislike,
    refreshDislikedSet,
    setOpNotifier,
    setRemoteApplying,
    setListenStatusProvider,
    flushPendingAdvance,
    startDesktopSync,
    stopDesktopSync,
    syncFromDesktop,
  };
}
