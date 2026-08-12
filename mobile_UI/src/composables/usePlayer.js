// =========== 播放器核心 composable ===========
// 管理: 当前歌曲 / 播放状态 / 循环模式 / 下一首逻辑 / MediaSession API
// MediaSession: 让安卓锁屏/通知栏/状态栏显示封面+歌名+上一首下一首控制
import { ref, computed } from 'vue';
import { fetchRandomSong, streamUrl, coverUrl, fetchLyric } from '../api.js';

// ===== 播放状态 =====
const currentSong = ref(null);       // 当前歌曲对象
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const isLoading = ref(false);

// ===== 循环模式: 0=单曲循环, 1=列表循环, 2=随机 =====
const playMode = ref(2);  // 默认随机 (推荐页)
const MODE_NAMES = ['单曲循环', '列表循环', '随机播放'];
const MODE_ICONS = ['repeat-one', 'repeat', 'shuffle'];

// ===== 歌词 =====
const lyricText = ref('');

// ===== 内部状态 =====
let audioEl = null;
let lastIndex = -1;       // 上一首的 index (用于列表循环下一首)
let totalSongs = 0;       // 歌库总数 (从 /api/random 返回)

// 获取 audio 元素 (供 LyricsView 等组件 rAF 读取 currentTime)
function getAudioEl() {
  return audioEl;
}

// ===== 初始化音频元素 =====
function init(audio) {
  audioEl = audio;
  if (!audioEl) return;

  audioEl.addEventListener('play', () => { isPlaying.value = true; });
  audioEl.addEventListener('pause', () => { isPlaying.value = false; });
  audioEl.addEventListener('timeupdate', () => {
    currentTime.value = audioEl.currentTime;
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
  });

  setupMediaSession();
}

// ===== MediaSession API: 安卓锁屏/通知栏/状态栏媒体控件 =====
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;

  // 设置可控制的操作按钮
  navigator.mediaSession.setActionHandler('play', () => resume());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null && audioEl) {
      audioEl.currentTime = details.seekTime;
      currentTime.value = audioEl.currentTime;
    }
  });
}

// 更新 MediaSession 元数据 (封面/歌名/艺人)
function updateMediaMetadata() {
  if (!('mediaSession' in navigator) || !currentSong.value) return;
  const song = currentSong.value;
  const artwork = song.hasCover
    ? [{ src: coverUrl(song.id), sizes: '512x512', type: 'image/jpeg' }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.songName || '未知歌曲',
    artist: song.artist || '未知艺人',
    album: song.album || '',
    artwork,
  });
  navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused';
}

// ===== 播放指定歌曲 =====
async function playSong(song) {
  if (!audioEl || !song) return;
  isLoading.value = true;
  lastIndex = currentSong.value ? currentSong.value.id : -1;
  currentSong.value = song;

  // 切换歌曲前重置进度, 避免上一首进度残留到新歌
  currentTime.value = 0;
  duration.value = 0;
  lyricText.value = '';

  audioEl.src = streamUrl(song.id);
  try {
    await audioEl.play();
  } catch (e) {
    console.error('播放失败:', e);
  } finally {
    isLoading.value = false;
  }

  // 加载歌词
  loadLyric(song.id);
  // 更新状态栏媒体信息
  updateMediaMetadata();
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
  if (audioEl && !audioEl.paused) audioEl.pause();
}

function resume() {
  if (audioEl && audioEl.paused) {
    audioEl.play().catch(() => {});
  }
}

function togglePlay() {
  if (!audioEl) return;
  if (audioEl.paused) resume(); else pause();
}

// ===== 下一首 (根据循环模式) =====
async function next() {
  if (!currentSong.value) {
    await playRandom();
    return;
  }
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
  // 简化: 随机模式下也随机, 列表模式下顺序上一首
  if (playMode.value === 2) {
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
  next();
}

// ===== 进度跳转 =====
function seek(percent) {
  if (!audioEl || !duration.value) return;
  audioEl.currentTime = (percent / 100) * duration.value;
  currentTime.value = audioEl.currentTime;
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
  };
}
