// =========== 播放器核心 composable ===========
// 管理: 当前歌曲 / 播放状态 / 循环模式 / 下一首逻辑 / MediaSession API
// 数据同步: 播放次数上报 / 播放进度上报与恢复 / 点赞状态
// MediaSession: 让安卓锁屏/通知栏/状态栏显示封面+歌名+上一首下一首控制
import { ref, computed } from 'vue';
import { fetchRandomSong, streamUrl, streamByPath, coverUrl, coverByPath, fetchLyric, reportPlayCount, reportProgress, fetchProgress, toggleLike, fetchLiked, fetchDesktopState, fetchSyncMode } from '../api.js';

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

// ===== 内部状态 =====
let audioEl = null;
let lastIndex = -1;       // 上一首的 index (用于列表循环下一首)
let totalSongs = 0;       // 歌库总数 (从 /api/random 返回)
let progressTimer = null; // 进度上报定时器
let lastReportedTime = 0; // 上次上报的进度时间 (避免重复上报)
let hasReportedPlay = false;  // 当前歌曲是否已上报播放次数

// 获取 audio 元素 (供 LyricsView 等组件 rAF 读取 currentTime)
function getAudioEl() {
  return audioEl;
}

// ===== 初始化音频元素 =====
function init(audio) {
  audioEl = audio;
  if (!audioEl) return;

  audioEl.addEventListener('play', () => {
    isPlaying.value = true;
    updateMediaPlaybackState();
  });
  audioEl.addEventListener('pause', () => {
    isPlaying.value = false;
    updateMediaPlaybackState();
    // 暂停时同步进度 (定格当前位置), 确保系统通知栏保留控件并显示正确进度
    updateMediaPositionState();
  });
  audioEl.addEventListener('timeupdate', () => {
    currentTime.value = audioEl.currentTime;
    // 同步 MediaSession 位置 (节流: 每 500ms 更新一次)
    if (isPlaying.value) {
      updateMediaPositionState();
    }
  });
  audioEl.addEventListener('loadedmetadata', () => {
    duration.value = audioEl.duration || 0;
  });
  audioEl.addEventListener('ended', () => {
    handleEnded();
  });
  audioEl.addEventListener('error', (e) => {
    console.error('[audio error]', e);
    isPlaying.value = false;
    isLoading.value = false;
    updateMediaPlaybackState();
  });

  setupMediaSession();
  // 加载已喜欢列表
  refreshLikedSet();
}

// ===== 桌面端状态同步 =====
let _syncDone = false;  // 是否已完成首次同步

// 启动桌面状态同步 (仅首次同步一次, 不轮询)
async function startDesktopSync() {
  if (_syncDone) return;
  _syncDone = true;

  // 检查同步模式
  try {
    const modeResp = await fetchSyncMode();
    if (modeResp.mode === 'isolated') return;  // 分桶存储模式, 不同步
  } catch (_) {}

  // 仅同步一次当前歌曲信息
  try {
    const state = await fetchDesktopState();
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
    currentSong.value = song;
    playMode.value = state.playMode != null ? state.playMode : 1;
    updateLikeState();
    loadLyric(song.id);
    updateMediaMetadata();

    // 设置音频源: 优先使用 audioPath (保证与桌面端播放的是同一首歌)
    if (audioEl) {
      audioEl.src = song.audioPath
        ? streamByPath(song.audioPath)
        : streamUrl(song.id);
    }
  } catch (e) {
    console.warn('[sync] 桌面状态同步失败:', e.message);
  }
}

function stopDesktopSync() {
  // 已简化为一次性同步, 无需清理定时器
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
    isPlaying.value = true;
    updateMediaPlaybackState();
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
      audioEl.currentTime = details.seekTime;
      currentTime.value = audioEl.currentTime;
      updateMediaPositionState();
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
  const pos = Math.min(Math.max(audioEl.currentTime || 0, 0), dur);
  try {
    // 用普通对象字面量赋值 (标准用法); MediaPositionState 构造函数在多数浏览器不存在,
    // new 调用会抛 ReferenceError
    navigator.mediaSession.positionState = {
      duration: dur,
      playbackRate: audioEl.playbackRate || 1,
      position: pos,
    };
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
      } else {
        likedSet.value.delete(index);
      }
      // 触发响应式更新
      likedSet.value = new Set(likedSet.value);
      isLiked.value = data.liked;
    }
  } catch (e) {
    console.warn('[sync] 点赞失败:', e.message);
  }
}

// ===== 进度上报定时器 =====
function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (isPlaying.value && currentSong.value && audioEl) {
      const t = Math.floor(audioEl.currentTime);
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
async function playSong(song) {
  if (!audioEl || !song) return;
  isLoading.value = true;
  lastIndex = currentSong.value ? currentSong.value.id : -1;
  currentSong.value = song;
  hasReportedPlay = false;

  // 后台预热歌库总数 (不阻塞播放), 确保下一首/上一首能顺序切换
  ensureTotalSongs();

  // 切换歌曲前重置进度, 避免上一首进度残留到新歌
  currentTime.value = 0;
  duration.value = 0;
  lyricText.value = '';
  lastReportedTime = 0;

  // 更新点赞状态
  updateLikeState();

  audioEl.src = song.audioPath
    ? streamByPath(song.audioPath)
    : streamUrl(song.id);
  try {
    await audioEl.play();
  } catch (e) {
    console.error('播放失败:', e);
  } finally {
    isLoading.value = false;
    isPlaying.value = !audioEl.paused;
    updateMediaPlaybackState();
  }

  // 加载歌词
  loadLyric(song.id);
  // 更新 MediaSession 元数据和状态
  updateMediaMetadata();

  // 尝试恢复上次播放进度
  try {
    const savedProgress = await fetchProgress(song.id);
    if (savedProgress > 5 && savedProgress < (audioEl.duration || 9999) - 5) {
      audioEl.currentTime = savedProgress;
      currentTime.value = savedProgress;
      lastReportedTime = Math.floor(savedProgress);
      updateMediaPositionState();
    }
  } catch (e) { /* 忽略进度恢复失败 */ }

  // 上报播放次数 (仅一次)
  if (!hasReportedPlay) {
    hasReportedPlay = true;
    reportPlayCount(song.id);
  }

  // 启动进度上报
  startProgressTimer();
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
    reportProgress(currentSong.value.id, Math.floor(audioEl.currentTime));
  }
}

function resume() {
  if (audioEl && audioEl.paused) {
    audioEl.play().catch(() => {});
  }
  // 立即更新 MediaSession 状态
  isPlaying.value = true;
  updateMediaPlaybackState();
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
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
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
  next();
}

// ===== 进度跳转 =====
function seek(percent) {
  if (!audioEl || !duration.value) return;
  audioEl.currentTime = (percent / 100) * duration.value;
  currentTime.value = audioEl.currentTime;
  // 同步 MediaSession 位置
  updateMediaPositionState();
}

// ===== 循环模式切换 =====
function cyclePlayMode() {
  playMode.value = (playMode.value + 1) % 3;
}

const playModeName = computed(() => MODE_NAMES[playMode.value]);
const playModeIcon = computed(() => MODE_ICONS[playMode.value]);
const progressPercent = computed(() => {
  if (!duration.value) return 0;
  return (currentTime.value / duration.value) * 100;
});

// ===== 歌词加载 =====
async function loadLyric(id) {
  lyricText.value = '';
  try {
    lyricText.value = await fetchLyric(id);
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
    cyclePlayMode,
    getAudioEl,
    handleToggleLike,
    refreshLikedSet,
    startDesktopSync,
    stopDesktopSync,
    syncFromDesktop,
  };
}
