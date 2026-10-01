<!-- =========== 歌词视图 (播放器左滑进入) =========== -->
<!-- 功能: LRC 解析(逐字+标准) / 逐字走字填充 / 胶囊高亮 / 自动滚动 / 点击跳转 -->
<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { usePlayer } from '../composables/usePlayer.js';
import { parseLyrics, readLyricTime, activeLyricIndex, isCurrentLyric, lyricCharProgress, lyricLineProgress } from '../services/lyrics.js';

const { lyricText, currentTime, duration, isPlaying, seek, seekTo, getAudioEl } = usePlayer();
const lines = ref([]);
const curIdx = ref(-1);
const listRef = ref(null);
const viewRef = ref(null);
const frameTime = ref(0);
const emit = defineEmits(['swipe-left']);
const showEmpty = computed(() => !lines.value.length);
let mounted = false;
let disposed = false;
let viewVisible = true;
let visibilityObserver = null;
let rafId = null;
let boundAudio = null;
let scrollVersion = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;
let touchActive = false;
let manualUntil = 0;
let pendingFollow = false;

function stopFrames() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}
function canAnimate() {
  const audio = getAudioEl();
  return mounted && !disposed && viewVisible && !document.hidden && lines.value.some(line => Number.isFinite(line.time)) && (audio ? !audio.paused && !audio.ended : isPlaying.value);
}
function startFrames() {
  if (!canAnimate()) { stopFrames(); return; }
  if (rafId === null) rafId = requestAnimationFrame(rafLoop);
}
function rafLoop() {
  rafId = null;
  syncPosition();
  startFrames();
}
function followAllowed() { return !touchActive && performance.now() >= manualUntil; }
function syncPosition(force = false, behavior = 'smooth') {
  frameTime.value = readLyricTime(getAudioEl(), currentTime.value);
  const idx = activeLyricIndex(lines.value, frameTime.value);
  const changed = idx !== curIdx.value;
  curIdx.value = idx;
  if (changed || force || pendingFollow) {
    if (force || followAllowed()) {
      pendingFollow = false;
      scrollToCur(idx, behavior);
    } else pendingFollow = true;
  }
}
function scrollToCur(idx, behavior) {
  const request = ++scrollVersion;
  nextTick(() => {
    if (!mounted || disposed || !viewVisible || document.hidden || request !== scrollVersion || idx !== curIdx.value || idx < 0) return;
    const container = viewRef.value, list = listRef.value;
    const first = list?.children[idx];
    if (!container || !first) return;
    let last = idx;
    while (last + 1 < lines.value.length && isCurrentLyric(lines.value, last + 1, idx)) last++;
    const top = first.getBoundingClientRect().top;
    const bottom = list.children[last].getBoundingClientRect().bottom;
    const target = container.scrollTop + (top + bottom) / 2 - container.getBoundingClientRect().top - container.clientHeight / 2;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: Math.max(0, target), behavior: reduced ? 'auto' : behavior });
  });
}
const mediaEvents = ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'playing', 'play', 'pause', 'ended', 'emptied'];
function onMediaChange() { syncPosition(); startFrames(); }
function bindAudio() {
  const audio = getAudioEl();
  if (audio === boundAudio) return;
  if (boundAudio) mediaEvents.forEach(event => boundAudio.removeEventListener(event, onMediaChange));
  boundAudio = audio;
  if (boundAudio) mediaEvents.forEach(event => boundAudio.addEventListener(event, onMediaChange));
}
function onVisibilityChange() {
  if (document.hidden) stopFrames();
  else { bindAudio(); syncPosition(true, 'auto'); startFrames(); }
}
function onResize() { syncPosition(true, 'auto'); }
watch(lyricText, text => {
  lines.value = parseLyrics(text);
  manualUntil = 0;
  pendingFollow = false;
  syncPosition(true, 'auto');
  bindAudio();
  startFrames();
}, { immediate: true });
watch(currentTime, () => { bindAudio(); syncPosition(); startFrames(); });
watch(isPlaying, onMediaChange);
watch(duration, () => syncPosition());
watch(listRef, () => syncPosition(true, 'auto'), { flush: 'post' });
onMounted(() => {
  mounted = true;
  bindAudio();
  syncPosition(true, 'auto');
  startFrames();
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onResize);
  if (typeof IntersectionObserver === 'function' && viewRef.value) {
    visibilityObserver = new IntersectionObserver(entries => {
      if (disposed) return;
      viewVisible = entries.some(entry => entry.isIntersecting);
      if (viewVisible) { syncPosition(true, 'auto'); startFrames(); }
      else stopFrames();
    }, { threshold: 0.01 });
    visibilityObserver.observe(viewRef.value);
  }
});
onUnmounted(() => {
  disposed = true;
  mounted = false;
  scrollVersion++;
  stopFrames();
  visibilityObserver?.disconnect();
  if (boundAudio) mediaEvents.forEach(event => boundAudio.removeEventListener(event, onMediaChange));
  boundAudio = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('resize', onResize);
});
function isCurrent(i) { return isCurrentLyric(lines.value, i, curIdx.value); }
function lineClass(i) {
  if (!Number.isFinite(lines.value[i].time)) return 'plain';
  if (isCurrent(i)) return 'cur';
  return i < curIdx.value ? 'sung' : 'unsung';
}
function charStyle(char, line) {
  const progress = lyricCharProgress(char, line.time, frameTime.value);
  if (progress >= 1) return { color: 'var(--accent)' };
  if (progress <= 0) return { color: 'var(--text)', opacity: 0.8 };
  const percent = (progress * 100).toFixed(1);
  return { backgroundImage: `linear-gradient(to right, var(--accent) ${percent}%, var(--text) ${percent}%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' };
}
function lineProgress(i) { return lyricLineProgress(lines.value, i, frameTime.value, duration.value); }
function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function onLineClick(line) {
  if (touchMoved || !Number.isFinite(line.time)) return;
  if (duration.value > 0) seek(Math.max(0, Math.min(100, line.time / duration.value * 100)));
  else if (typeof seekTo === 'function') seekTo(Math.max(0, line.time));
  else return;
  manualUntil = 0;
  syncPosition(true);
}
function onWheel() { manualUntil = performance.now() + 6000; pendingFollow = true; }
function onTouchStart(event) {
  const touch = event.touches[0];
  if (!touch) return;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchMoved = false;
  touchActive = true;
}
function onTouchMove(event) {
  const touch = event.touches[0];
  if (!touch) return;
  const dx = touch.clientX - touchStartX, dy = touch.clientY - touchStartY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 10) touchMoved = true;
  if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 10) onWheel();
}
function onTouchEnd(event) {
  touchActive = false;
  const touch = event.changedTouches[0];
  if (!touch || !touchMoved) return;
  const dx = touch.clientX - touchStartX, dy = touch.clientY - touchStartY;
  if (dx > 80 && Math.abs(dx) > Math.abs(dy)) emit('swipe-left');
  else if (Math.abs(dy) >= Math.abs(dx)) onWheel();
}
function onTouchCancel() { touchActive = false; touchMoved = false; }
</script>

<template>
  <div
    class="lyrics-view"
    ref="viewRef"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
    @wheel.passive="onWheel"
  >
    <!-- 无歌词 -->
    <div v-if="showEmpty" class="empty">
      <span>暂无歌词</span>
    </div>
    <!-- 歌词列表 -->
    <div v-else class="lyric-list" ref="listRef">
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="lyric-line"
        :class="lineClass(i)"
        @click="onLineClick(line)"
      >
        <!-- 当前行 + 有逐字数据: 每个字独立 span, 逐字填充 -->
        <span v-if="isCurrent(i) && line.chars" class="lyric-text char-fill">
          <span
            v-for="(ch, ci) in line.chars"
            :key="ci"
            class="char"
            :style="charStyle(ch, line)"
          >{{ ch.text }}</span>
        </span>
        <!-- 当前行 + 无逐字数据: 行级渐变填充 -->
        <span
          v-else-if="isCurrent(i)"
          class="lyric-text"
          :style="{
            backgroundImage: `linear-gradient(to right, var(--accent) ${(lineProgress(i) * 100).toFixed(1)}%, var(--text) ${(lineProgress(i) * 100).toFixed(1)}%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }"
        >{{ line.text }}</span>
        <!-- 非当前行: 普通显示 -->
        <span v-else class="lyric-text">{{ line.text }}</span>
        <!-- 当前行: 右侧播放图标 + 时间戳 -->
        <div v-if="i === curIdx" class="cur-meta">
          <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <span class="line-time">{{ formatTime(line.time) }}</span>
        </div>
        <!-- hover 时显示的时间戳(非当前行) -->
        <div v-else-if="Number.isFinite(line.time)" class="hover-meta">
          <span class="line-time">{{ formatTime(line.time) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyrics-view {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 60px 28px;
  scroll-behavior: auto;
  position: relative;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 15px;
}

.lyric-list {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-height: 100%;
  padding-right: 4px;
}

.lyric-line {
  position: relative;
  font-size: 22px;
  line-height: 1.6;
  text-align: left;
  padding: 8px 14px;
  border-radius: 14px;
  transition: background 0.2s ease, color 0.2s ease, transform 0.3s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 400;
}

.lyric-line:hover:not(.cur) {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.hover-meta {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-secondary);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.lyric-line:hover:not(.cur) .hover-meta {
  opacity: 0.6;
}

.lyric-line.sung {
  color: color-mix(in srgb, var(--text) 55%, var(--text-secondary) 45%);
  opacity: 0.72;
}

.lyric-line.unsung {
  color: var(--text-secondary);
  opacity: 0.5;
}

.lyric-line.plain { color: var(--text); cursor: default; }

/* 当前行: 胶囊背景 + 放大 */
.lyric-line.cur {
  color: var(--text);
  font-weight: 700;
  background: color-mix(in srgb, var(--text) 12%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transform: scale(1.02);
  transform-origin: left center;
}

/* 逐字填充: 每个 char 独立 span */
.char-fill .char {
  display: inline;
}

.cur-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.9;
}
.play-icon {
  width: 18px;
  height: 18px;
}
.line-time {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
@media (prefers-reduced-motion: reduce) {
  .lyrics-view { scroll-behavior: auto; }
  .lyric-line { transition: none; transform: none; }
}
</style>
