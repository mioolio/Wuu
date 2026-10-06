<!-- =========== 播放器主界面 =========== -->
<!-- 功能: 封面 / 播放控制 / 原生进度调节 / 歌词入口 -->
<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
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
const moreSheetRef = ref(null);
const moreButtonRef = ref(null);
let moreReturnFocus = null;
function onMoreKey(event) {
  if (!showMore.value) return;
  if (event.key === 'Escape') { event.preventDefault(); showMore.value = false; return; }
  if (event.key !== 'Tab') return;
  const buttons = moreSheetRef.value?.querySelectorAll('button:not([disabled])');
  if (!buttons?.length) return;
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(showMore, async open => {
  if (open) {
    moreReturnFocus = document.activeElement;
    document.addEventListener('keydown', onMoreKey);
    await nextTick();
    if (showMore.value) moreSheetRef.value?.querySelector('button')?.focus();
  } else {
    document.removeEventListener('keydown', onMoreKey);
    if (moreReturnFocus?.isConnected) moreReturnFocus.focus();
    moreReturnFocus = null;
  }
});
onUnmounted(() => document.removeEventListener('keydown', onMoreKey));

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
const librarySongIndex = computed(() => !currentSong.value?.preview && Number.isInteger(currentSong.value?.id) && currentSong.value.id >= 0 ? currentSong.value.id : -1);
const canManageSong = computed(() => librarySongIndex.value >= 0);
watch(canManageSong, available => { if (!available) showPicker.value = false; });
function openPicker() {
  if (!canManageSong.value) return;
  showPicker.value = true;
}
function onToggleDislike() {
  if (canManageSong.value) handleToggleDislike();
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
let touchEligible = false;

function onTouchStart(e) {
  const touch = e.touches[0];
  touchEligible = !!touch && !e.target?.closest?.('button, input, .more-sheet');
  if (!touchEligible) return;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchMoved = false;
}
function onTouchMove(e) {
  const touch = e.touches[0];
  if (!touchEligible || !touch) return;
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  // 水平滑动距离 > 垂直, 标记为有效滑动
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
    touchMoved = true;
  }
}
function onTouchEnd(e) {
  const touch = e.changedTouches[0];
  const eligible = touchEligible;
  touchEligible = false;
  if (!eligible || !touchMoved || !touch) return;
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  // 向左滑 > 80px → 切换歌词 (手指从右向左移动, dx 为负)
  if (dx < -80 && Math.abs(dx) > Math.abs(dy)) {
    emit('swipe-right');
  }
}

// ===== 进度条拖拽 =====
const isDragging = ref(false);
const dragPercent = ref(null);
const displayPercent = computed(() => {
  const value = isDragging.value ? dragPercent.value : progressPercent.value;
  return Math.max(0, Math.min(100, Number(value) || 0));
});
const displayTime = computed(() => isDragging.value ? duration.value * displayPercent.value / 100 : currentTime.value);
function onProgressInput(event) {
  if (!(duration.value > 0)) return;
  isDragging.value = true;
  dragPercent.value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
  seek(dragPercent.value);
}
function finishProgress() {
  isDragging.value = false;
  dragPercent.value = null;
}
watch(() => currentSong.value?.id, finishProgress);

// 循环模式图标已移到 template 内用 v-if 渲染 (保持与其他按钮一致的 SVG 组件方式)
</script>

<template>
  <div
    class="player-view"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="touchEligible = false"
    aria-label="音乐播放器"
  >
    <!-- 完整方形封面，不持续运动 -->
    <div class="cover-area">
      <div class="disc-wrapper" :aria-busy="isLoading">
        <div class="disc-rotator">
          <img
            v-if="cover && !coverError"
            :src="cover"
            class="cover-art"
            alt=""
            @error="coverError = true"
          />
          <div v-else class="cover-art cover-placeholder">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v12.55A4 4 0 1 0 11 19V7h8v6.55A4 4 0 1 0 21 17V3H9z"/></svg>
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
      <span v-if="isLoading" class="player-status" role="status">正在加载音频</span>
    </div>

    <!-- 进度条 -->
    <div class="progress-bar">
      <span class="time">{{ formatTime(displayTime) }}</span>
      <div class="p-track">
        <div class="p-rail" aria-hidden="true"><div class="p-fill" :style="{ width: displayPercent + '%' }"></div></div>
        <input class="progress-range" type="range" min="0" max="100" step="0.1"
          :value="displayPercent" :disabled="!(duration > 0)" aria-label="播放进度"
          :aria-valuetext="formatTime(displayTime) + ' / ' + formatTime(duration)"
          @input="onProgressInput" @change="finishProgress" @blur="finishProgress" @pointercancel="finishProgress" />
      </div>
      <span class="time">{{ formatTime(duration) }}</span>
    </div>

    <!-- 主播放操作 -->
    <div class="controls">
      <!-- 上一首 -->
      <button class="ctrl-btn" aria-label="上一首" @click="prev">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
      </button>
      <!-- 播放/暂停 -->
      <button class="ctrl-btn play-btn" :aria-label="isPlaying ? '暂停' : '播放'" :aria-busy="isLoading" @click="togglePlay">
        <svg aria-hidden="true" v-if="isPlaying" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
        <svg aria-hidden="true" v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5z"/></svg>
      </button>
      <!-- 下一首 -->
      <button class="ctrl-btn" aria-label="下一首" @click="next">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 6h2v12h-2V6zm-2.5 6L5 6v12l8.5-6z"/></svg>
      </button>
    </div>
    <div class="secondary-controls" aria-label="歌曲操作">
      <!-- 收藏 (打开歌单选择器) -->
      <button
        class="ctrl-btn like-btn"
        :class="{ active: isLiked }"
        :disabled="!canManageSong"
        :title="canManageSong ? '收藏到歌单' : '先在电脑保存到音乐库'"
        :aria-label="canManageSong ? (isLiked ? '管理歌单，已喜欢' : '收藏到歌单') : '先在电脑保存到音乐库'"
        :aria-pressed="canManageSong && isLiked"
        @click="openPicker"
      >
        <!-- 已喜欢 (实心) -->
        <svg aria-hidden="true" v-if="isLiked" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <!-- 未喜欢 (空心) -->
        <svg aria-hidden="true" v-else viewBox="0 0 24 24"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>
      </button>
      <button class="lyrics-entry" aria-label="查看歌词" @click="emit('swipe-right')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z"/></svg>
        <span>歌词</span>
      </button>
      <!-- 更多 (播放模式 / 不推荐 等低频操作) -->
      <button class="ctrl-btn" title="更多" :aria-label="'更多播放设置，' + playModeName" aria-haspopup="dialog" :aria-expanded="showMore" ref="moreButtonRef" @click="showMore = true">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>
    </div>

    <!-- 播放设置面板 (低频操作收纳) -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showMore" class="more-mask" @click.self="showMore = false">
          <Transition name="slide-up">
            <div v-if="showMore" class="more-sheet" ref="moreSheetRef" role="dialog" aria-modal="true" aria-labelledby="player-more-title">
              <div class="more-header">
                <span class="more-title" id="player-more-title">播放设置</span>
                <button class="more-close" aria-label="关闭播放设置" @click="showMore = false">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
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
                      :aria-pressed="playMode === m"
                      @click="setPlayMode(m)"
                    >
                      <svg aria-hidden="true" v-if="m === 0" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="15" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">1</text></svg>
                      <svg aria-hidden="true" v-else-if="m === 1" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
                      <svg aria-hidden="true" v-else viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                      <span>{{ name }}</span>
                    </button>
                  </div>
                </div>

                <!-- 不推荐 (与喜欢互斥) -->
                <button class="sheet-row" :disabled="!canManageSong" :title="canManageSong ? '不推荐这首歌' : '先在电脑保存到音乐库'" :aria-label="canManageSong ? '不推荐这首歌' : '先在电脑保存到音乐库'" :aria-pressed="canManageSong && isDisliked" @click="onToggleDislike">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22 3h-6v4c0 1.1-.9 2-2 2h-1v9c0 1.66 1.34 3 3 3s3-1.34 3-3v-3h3c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z"/></svg>
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
    :song-index="librarySongIndex"
    @close="closePicker"
    @changed="onPickerChanged"
  />
</template>

<style scoped>
.player-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 24px 28px;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg);
  color: var(--text);
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.cover-area {
  width: min(100%, clamp(208px, 37dvh, 320px));
  margin-inline: auto;
  flex-shrink: 0;
}
.disc-wrapper {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--bg-card-elevated);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.disc-rotator { width: 100%; height: 100%; }
.cover-art { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-placeholder { display: grid; place-items: center; color: var(--text-secondary); background: var(--bg-card-elevated); }
.cover-placeholder svg { width: 64px; height: 64px; fill: currentColor; opacity: .55; }
.song-info { width: 100%; min-width: 0; text-align: center; margin-top: 22px; flex-shrink: 0; }
.song-name { margin: 0 0 8px; font-size: 22px; line-height: 1.35; font-weight: 700; letter-spacing: -.025em; color: var(--text); overflow-wrap: anywhere; text-wrap: balance; }
.player-credits { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; margin-bottom: 6px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); overflow-wrap: anywhere; }
.player-credits span { min-width: 0; }
.song-artist { font-size: 14px; line-height: 1.5; color: var(--text-secondary); overflow-wrap: anywhere; }
.player-status { display: block; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
.progress-bar { width: 100%; max-width: 400px; display: flex; align-items: center; gap: 10px; margin-top: 20px; flex-shrink: 0; }
.time { min-width: 36px; font-size: 12px; color: var(--text-secondary); text-align: center; font-variant-numeric: tabular-nums; }
.p-track { flex: 1; min-width: 0; height: 44px; position: relative; display: flex; align-items: center; }
.p-rail { width: 100%; height: 4px; border-radius: 4px; background: var(--border); overflow: hidden; }
.p-fill { height: 100%; background: var(--accent); border-radius: inherit; }
.progress-range { position: absolute; inset: 0; width: 100%; height: 44px; padding: 0; margin: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; touch-action: pan-y; accent-color: var(--accent); }
.progress-range::-webkit-slider-runnable-track { height: 4px; background: transparent; }
.progress-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 2px solid var(--bg); border-radius: 50%; background: var(--accent); }
.progress-range::-moz-range-track { height: 4px; background: transparent; }
.progress-range::-moz-range-thumb { width: 10px; height: 10px; border: 2px solid var(--bg); border-radius: 50%; background: var(--accent); }
.progress-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }
.progress-range:disabled { opacity: .4; cursor: default; }
.controls { display: flex; align-items: center; justify-content: center; gap: 28px; margin-top: 10px; flex-shrink: 0; }
.ctrl-btn { display: grid; place-items: center; width: 48px; height: 48px; flex-shrink: 0; border: 0; border-radius: 50%; padding: 0; color: var(--text); background: transparent; cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.ctrl-btn svg { width: 26px; height: 26px; fill: currentColor; }
.ctrl-btn:active { background: var(--bg-hover); }
.ctrl-btn:focus-visible, .lyrics-entry:focus-visible, .more-close:focus-visible, .mode-option:focus-visible, .sheet-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.play-btn { width: 64px; height: 64px; color: var(--on-accent); background: var(--accent); }
.play-btn:active { color: var(--on-accent); background: var(--accent); opacity: .85; }
.play-btn svg { width: 30px; height: 30px; }
.secondary-controls { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 18px; flex-shrink: 0; }
.secondary-controls .ctrl-btn { color: var(--text-secondary); }
.secondary-controls .like-btn.active { color: var(--accent); }
.lyrics-entry { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 104px; min-height: 44px; padding: 8px 16px; border: 1px solid var(--border); border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--text); background: var(--bg-card); cursor: pointer; transition: background-color 120ms ease; }
.lyrics-entry svg { width: 20px; height: 20px; fill: currentColor; }
.lyrics-entry:active { background: var(--accent-soft); }
.more-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; background: var(--overlay); }
.more-sheet { width: 100%; max-width: 500px; max-height: calc(100dvh - 32px); overflow-y: auto; background: var(--bg-card-elevated); border: 1px solid var(--border); border-bottom: 0; border-radius: 24px 24px 0 0; padding-bottom: env(safe-area-inset-bottom); box-shadow: var(--shadow); color: var(--text); }
.more-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 12px 20px; border-bottom: 1px solid var(--border); }
.more-title { font-size: 17px; font-weight: 600; }
.more-close { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; color: var(--text-secondary); background: transparent; cursor: pointer; }
.more-close:active { background: var(--bg-hover); }
.more-close svg { width: 22px; height: 22px; fill: currentColor; }
.more-body { padding: 8px 20px 24px; }
.mode-block { padding: 12px 0 20px; }
.mode-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
.mode-options { display: flex; gap: 8px; }
.mode-option { flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; padding: 10px 4px; border: 1px solid var(--border); border-radius: 12px; color: var(--text-secondary); background: var(--bg-card); font-size: 12px; cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.mode-option svg { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; }
.mode-option.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.sheet-row { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 12px; padding: 14px 0; border: 0; border-top: 1px solid var(--border); color: var(--text); background: transparent; font-size: 14px; text-align: left; cursor: pointer; }
.sheet-row svg { width: 20px; height: 20px; fill: var(--text-secondary); flex-shrink: 0; }
.sheet-row-text { flex: 1; }
.sheet-row-state { font-size: 12px; color: var(--text-secondary); }
.sheet-row-state.on { color: var(--danger); }
.ctrl-btn:disabled, .sheet-row:disabled { opacity: .45; cursor: not-allowed; }
.fade-enter-active, .fade-leave-active { transition: opacity 160ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-up-enter-active, .slide-up-leave-active { transition: transform 220ms cubic-bezier(.22, 1, .36, 1); }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); }
@media (max-width: 360px) {
  .player-view { padding: 16px 16px 24px; }
  .controls { gap: 24px; }
  .secondary-controls { gap: 16px; }
  .song-name { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .ctrl-btn, .lyrics-entry, .mode-option, .fade-enter-active, .fade-leave-active, .slide-up-enter-active, .slide-up-leave-active { transition: none; }
}
</style>
