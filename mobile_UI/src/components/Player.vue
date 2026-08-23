<!-- =========== 播放器主界面 =========== -->
<!-- 功能: 圆形封面(不抠洞) / 播放控制 / 循环模式 / 左滑切歌词 -->
<script setup>
import { ref, computed, watch } from 'vue';
import { usePlayer } from '../composables/usePlayer.js';
import { coverUrl, coverByPath } from '../api.js';
import CollectionPicker from './CollectionPicker.vue';

const emit = defineEmits(['swipe-right']);

const {
  currentSong,
  isPlaying,
  currentTime,
  duration,
  isLoading,
  playMode,
  playModeName,
  progressPercent,
  isLiked,
  togglePlay,
  next,
  prev,
  seek,
  cyclePlayMode,
  refreshLikedSet,
} = usePlayer();

// ===== 封面 URL (优先使用 coverPath 直接路径, 保证封面正确显示) =====
const cover = computed(() => {
  if (!currentSong.value) return '';
  // 优先使用桌面端同步的 coverPath
  if (currentSong.value.coverPath && currentSong.value.hasCover) {
    return coverByPath(currentSong.value.coverPath);
  }
  // 回退: 使用歌曲 ID 查询
  return currentSong.value.hasCover
    ? coverUrl(currentSong.value.id)
    : '';
});

// ===== 封面加载失败 (切歌时重置) =====
const coverError = ref(false);
watch(() => currentSong.value?.id, () => {
  coverError.value = false;
});

// ===== 歌单选择器 =====
const showPicker = ref(false);
function openPicker() {
  if (!currentSong.value) return;
  showPicker.value = true;
}
function closePicker() {
  showPicker.value = false;
}
function onPickerChanged() {
  refreshLikedSet();
}

// ===== 时间格式化 =====
function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ===== 左滑手势: 切换到歌词视图 (手指从右向左移动) =====
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

function onTouchStart(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchMoved = false;
}
function onTouchMove(e) {
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  // 水平滑动距离 > 垂直, 标记为有效滑动
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
    touchMoved = true;
  }
}
function onTouchEnd(e) {
  if (!touchMoved) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  // 向左滑 > 80px → 切换歌词 (手指从右向左移动, dx 为负)
  if (dx < -80) {
    emit('swipe-right');
  }
}

// ===== 进度条拖拽 =====
const progressBarRef = ref(null);
const isDragging = ref(false);
const dragPercent = ref(null);
const displayPercent = computed(() => {
  return isDragging.value ? dragPercent.value : progressPercent.value;
});

function seekFromEvent(e) {
  if (!progressBarRef.value || !duration.value) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
  dragPercent.value = percent;
  if (!isDragging.value) seek(percent);
}
function onProgressDown(e) {
  isDragging.value = true;
  seekFromEvent(e);
}
function onProgressMove(e) {
  if (!isDragging.value) return;
  seekFromEvent(e);
}
function onProgressUp() {
  if (!isDragging.value) return;
  if (dragPercent.value != null) seek(dragPercent.value);
  isDragging.value = false;
  dragPercent.value = null;
}

// 循环模式图标已移到 template 内用 v-if 渲染 (保持与其他按钮一致的 SVG 组件方式)
</script>

<template>
  <div
    class="player-view"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- 封面区 (圆形, 不抠洞, 保持完整) -->
    <div class="cover-area">
      <div class="disc-wrapper" :class="{ playing: isPlaying }">
        <div class="disc-rotator">
          <img
            v-if="cover && !coverError"
            :src="cover"
            class="cover-art"
            alt=""
            @error="coverError = true"
          />
          <div v-else class="cover-art cover-placeholder">
            <span>♪</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 歌曲信息 -->
    <div class="song-info">
      <div class="song-name">{{ currentSong?.songName || '未在播放' }}</div>
      <div class="song-artist">{{ currentSong?.artist || '' }}</div>
    </div>

    <!-- 进度条 -->
    <div class="progress-bar">
      <span class="time">{{ formatTime(currentTime) }}</span>
      <div
        class="p-track"
        ref="progressBarRef"
        @mousedown="onProgressDown"
        @touchstart="onProgressDown"
        @touchmove="onProgressMove"
        @touchend="onProgressUp"
      >
        <div class="p-fill" :style="{ width: displayPercent + '%' }"></div>
      </div>
      <span class="time">{{ formatTime(duration) }}</span>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <!-- 循环模式 -->
      <button
        class="ctrl-btn mode-btn active"
        :title="playModeName"
        @click="cyclePlayMode"
      >
        <!-- 单曲循环 (带"1"标记) -->
        <svg v-if="playMode === 0" viewBox="0 0 24 24">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
          <text x="12" y="15" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">1</text>
        </svg>
        <!-- 列表循环 -->
        <svg v-else-if="playMode === 1" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
        <!-- 随机 -->
        <svg v-else viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
      </button>
      <!-- 上一首 -->
      <button class="ctrl-btn" @click="prev">
        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
      </button>
      <!-- 播放/暂停 -->
      <button class="ctrl-btn play-btn" @click="togglePlay">
        <svg v-if="isPlaying" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5z"/></svg>
      </button>
      <!-- 下一首 -->
      <button class="ctrl-btn" @click="next">
        <svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2V6zm-2.5 6L5 6v12l8.5-6z"/></svg>
      </button>
      <!-- 点赞 (打开歌单选择器) -->
      <button
        class="ctrl-btn like-btn"
        :class="{ active: isLiked }"
        @click="openPicker"
      >
        <!-- 已喜欢 (实心) -->
        <svg v-if="isLiked" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <!-- 未喜欢 (空心) -->
        <svg v-else viewBox="0 0 24 24"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>
      </button>
    </div>
  </div>

  <!-- 歌单选择器 -->
  <CollectionPicker
    :visible="showPicker"
    :song-index="currentSong?.id ?? -1"
    @close="closePicker"
    @changed="onPickerChanged"
  />
</template>

<style scoped>
.player-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 24px 40px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* 封面: 圆形, 不抠洞, 保持完整 */
.cover-area {
  display: flex;
  justify-content: center;
  padding: 30px 20px 20px;
  flex-shrink: 0;
}
/* 外层: 处理 scale 过渡 (暂停时 0.92, 播放时 1, 0.3s 过渡) */
.disc-wrapper {
  position: relative;
  width: 280px;
  height: 280px;
  max-width: 70vw;
  max-height: 70vw;
  border-radius: 50%;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5),
              0 0 0 8px rgba(0, 0, 0, 0.25),
              0 0 0 9px rgba(255, 255, 255, 0.06);
  transform: scale(0.92);
  transition: transform 0.3s ease;
}
.disc-wrapper.playing {
  transform: scale(1);
}
/* 内层: 处理旋转, 用 animation-play-state 暂停 (柔滑停下, 不归位) */
.disc-rotator {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  animation: rotate 20s linear infinite;
  animation-play-state: paused;
}
.disc-wrapper.playing .disc-rotator {
  animation-play-state: running;
}
.cover-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 80px;
  color: var(--text-secondary);
  background: var(--bg-card-elevated);
}
@keyframes rotate {
  to { transform: rotate(360deg); }
}

/* 歌曲信息 */
.song-info {
  text-align: center;
  margin-top: 20px;
  flex-shrink: 0;
}
.song-name {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.song-artist {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 进度条 */
.progress-bar {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  flex-shrink: 0;
}
.time {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.p-track {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.p-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.1s linear;
}

/* 控制按钮 */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 30px;
  flex-shrink: 0;
}
.ctrl-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.ctrl-btn:active {
  color: var(--accent);
}
.ctrl-btn svg {
  width: 26px;
  height: 26px;
  fill: currentColor;
}
.ctrl-btn.placeholder {
  width: 44px;
  height: 44px;
}
.like-btn.active {
  color: #ff4d4f;
}
.mode-btn {
  color: var(--text-secondary);
}
.mode-btn.active {
  color: var(--accent);
}
.mode-btn svg {
  width: 22px;
  height: 22px;
}
.play-btn {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
}
.play-btn:active {
  color: #fff;
}
.play-btn svg {
  width: 30px;
  height: 30px;
}
</style>
