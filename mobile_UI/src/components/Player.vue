<!-- =========== 播放器主界面 =========== -->
<!-- 功能: 圆形封面(不抠洞) / 播放控制 / 循环模式 / 左滑切歌词 -->
<script setup>
import { ref, computed, watch } from 'vue';
import { usePlayer } from '../composables/usePlayer.js';
import { coverUrl, coverByPath } from '../api.js';
import { lyricCredits } from '../services/lyrics.js';
import CollectionPicker from './CollectionPicker.vue';

const emit = defineEmits(['swipe-right']);

const {
  currentSong,
  lyricText,
  isPlaying,
  currentTime,
  duration,
  isLoading,
  playMode,
  playModeName,
  progressPercent,
  isLiked,
  isDisliked,
  togglePlay,
  next,
  prev,
  seek,
  setPlayMode,
  refreshLikedSet,
  handleToggleDislike,
} = usePlayer();

const creditRows = computed(() => {
  if (!currentSong.value) return [];
  const fallback = lyricCredits(lyricText.value);
  const namedCredit = value => typeof value === 'string' ? value.trim() : '';
  const lyricist = namedCredit(currentSong.value.lyricist) || fallback.lyricist;
  const composer = namedCredit(currentSong.value.composer) || fallback.composer;
  if (lyricist && lyricist === composer) return [{ label: '作词 / 作曲', name: lyricist }];
  return [
    ...(lyricist ? [{ label: '作词', name: lyricist }] : []),
    ...(composer ? [{ label: '作曲', name: composer }] : []),
  ];
});

// 播放模式选项 (与 usePlayer 中 playMode 0/1/2 对应)
const MODE_NAMES = ['单曲循环', '列表循环', '随机播放'];

// ===== 播放设置面板 (更多菜单) =====
const showMore = ref(false);

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
      <h2 class="song-name">{{ currentSong?.songName || '未在播放' }}</h2>
      <div v-if="creditRows.length" class="player-credits" aria-label="词曲信息">
        <span v-for="credit in creditRows" :key="credit.label">{{ credit.label }} {{ credit.name }}</span>
      </div>
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

    <!-- 控制按钮: 高频操作单行排列, 低频功能收进"更多"面板 -->
    <div class="controls">
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
      <!-- 更多 (播放模式 / 不推荐 等低频操作) -->
      <button class="ctrl-btn" title="更多" @click="showMore = true">
        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>
    </div>

    <!-- 播放设置面板 (低频操作收纳) -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showMore" class="more-mask" @click.self="showMore = false">
          <Transition name="slide-up">
            <div v-if="showMore" class="more-sheet">
              <div class="more-header">
                <span class="more-title">播放设置</span>
                <button class="more-close" @click="showMore = false">
                  <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>

              <div class="more-body">
                <!-- 播放模式 -->
                <div class="mode-block">
                  <div class="mode-label">播放模式</div>
                  <div class="mode-options">
                    <button
                      v-for="(name, m) in MODE_NAMES"
                      :key="m"
                      class="mode-option"
                      :class="{ active: playMode === m }"
                      @click="setPlayMode(m)"
                    >
                      <svg v-if="m === 0" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="15" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">1</text></svg>
                      <svg v-else-if="m === 1" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
                      <svg v-else viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                      <span>{{ name }}</span>
                    </button>
                  </div>
                </div>

                <!-- 不推荐 (与喜欢互斥) -->
                <button class="sheet-row" @click="handleToggleDislike">
                  <svg viewBox="0 0 24 24"><path d="M22 3h-6v4c0 1.1-.9 2-2 2h-1v9c0 1.66 1.34 3 3 3s3-1.34 3-3v-3h3c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z"/></svg>
                  <span class="sheet-row-text">不推荐这首歌</span>
                  <span class="sheet-row-state" :class="{ on: isDisliked }">
                    {{ isDisliked ? '已不推荐' : '未标记' }}
                  </span>
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
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
/* margin-top: auto 与 .controls 的 margin-bottom: auto 配对:
   长屏 (如 iPhone 16 Pro Max) 下剩余空间上下均分, 内容整体垂直居中;
   短屏内容溢出时 auto 归零, 不影响滚动 */
.cover-area {
  display: flex;
  justify-content: center;
  padding: calc(20px + env(safe-area-inset-top)) 20px 20px;
  flex-shrink: 0;
  margin-top: auto;
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
  width: 100%;
  min-width: 0;
  text-align: center;
  margin-top: 20px;
  flex-shrink: 0;
}
.song-name {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 6px;
  overflow-wrap: anywhere;
}
.player-credits {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 16px;
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.player-credits span {
  min-width: 0;
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

/* 控制按钮: 5 个 (4×44 + 64 + 4×20 = 340 ≤ 382 可用宽), 430px 宽单行放下 */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 30px;
  margin-bottom: auto;
  flex-shrink: 0;
}
/* 窄屏 (360px 级) 收紧间距保持单行: 240 + 4×14 = 296 ≤ 312 可用宽 */
@media (max-width: 380px) {
  .controls {
    gap: 14px;
  }
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
.dislike-btn.active {
  color: #ff4d4f;
}
/* 6 个控制按钮时收紧间距, 避免小屏溢出 */
.controls {
  flex-wrap: wrap;
  row-gap: 10px;
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

/* ===== 播放设置面板 (更多菜单) ===== */
.more-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.more-sheet {
  width: 100%;
  max-width: 500px;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
.more-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.more-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.more-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
}
.more-close svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}
.more-body {
  padding: 8px 20px 24px;
}

/* 播放模式三选一 */
.mode-block {
  padding: 12px 0;
}
.mode-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.mode-options {
  display: flex;
  gap: 10px;
}
.mode-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.mode-option svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
  flex-shrink: 0;
}
.mode-option.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(251, 114, 153, 0.08);
}

/* 不推荐行 */
.sheet-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border);
  color: var(--text);
  font-size: 15px;
  cursor: pointer;
  text-align: left;
}
.sheet-row svg {
  width: 20px;
  height: 20px;
  fill: var(--text-secondary);
  flex-shrink: 0;
}
.sheet-row-text {
  flex: 1;
}
.sheet-row-state {
  font-size: 13px;
  color: var(--text-secondary);
}
.sheet-row-state.on {
  color: #ff4d4f;
}

/* 面板过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
