<!-- =========== 歌词视图 (播放器左滑进入) =========== -->
<!-- 功能: LRC 解析(逐字+标准) / 逐字走字填充 / 当前字号 / 自动滚动 / 点击跳转 -->
<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { usePlayer } from '../composables/usePlayer.js';
import { parseLyrics, readLyricTime, activeLyricIndex, isCurrentLyric, lyricCharProgress, lyricLineProgress } from '../services/lyrics.js';
import { useLyricPreferences } from '../composables/useLyricPreferences.js';

const { currentSong, lyricText, currentTime, duration, isPlaying, seek, seekTo, getAudioEl } = usePlayer();
const lines = ref([]);
const curIdx = ref(-1);
const listRef = ref(null);
const viewRef = ref(null);
const frameTime = ref(0);
const { lyricSize, currentLyricSize } = useLyricPreferences();
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
    const containerTop = container.getBoundingClientRect().top;
    // Tall phrases start at the top instead of hiding their opening words offscreen.
    const target = bottom - top > container.clientHeight * .8
      ? container.scrollTop + top - containerTop - 16
      : container.scrollTop + (top + bottom) / 2 - containerTop - container.clientHeight / 2;
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
  else { bindAudio(); syncPosition(followAllowed(), 'auto'); startFrames(); }
}
function onResize() { syncPosition(followAllowed(), 'auto'); }
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
watch([lyricSize, currentLyricSize], () => {
  if (followAllowed()) syncPosition(true, 'auto');
  else pendingFollow = true;
}, { flush: 'post' });
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
      if (viewVisible) { syncPosition(followAllowed(), 'auto'); startFrames(); }
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
  if (progress >= 1) return { color: 'var(--lyric-sung)' };
  if (progress <= 0) return { color: 'var(--lyric-wait)' };
  const percent = (progress * 100).toFixed(1);
  return { backgroundImage: `linear-gradient(to right, var(--lyric-sung) ${percent}%, var(--lyric-wait) ${percent}%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' };
}
function lineProgress(i) { return lyricLineProgress(lines.value, i, frameTime.value, duration.value); }
function onLineClick(line) {
  if (touchMoved || !Number.isFinite(line.time)) return;
  if (duration.value > 0) seek(Math.max(0, Math.min(100, line.time / duration.value * 100)));
  else if (typeof seekTo === 'function') seekTo(Math.max(0, line.time));
  else return;
  manualUntil = 0;
  syncPosition(true);
}
function onLineKey(line) { touchMoved = false; onLineClick(line); }
function resumeFollow() { manualUntil = 0; pendingFollow = false; syncPosition(true); }
function onWheel() { manualUntil = performance.now() + 6000; pendingFollow = true; }
function onScrollKey(event) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onWheel();
}
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
  <section class="lyrics-shell" :style="{ '--lyric-size': lyricSize + 'px', '--current-lyric-size': currentLyricSize + 'px' }" aria-label="歌词播放器">
  <div class="lyrics-header">
    <button class="lyrics-back" aria-label="返回播放器" @click="emit('swipe-left')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.4 5.4-1.4-1.4-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6z"/></svg>
      <span>返回</span>
    </button>
    <h2 class="lyrics-title" :title="currentSong?.songName || '歌词'">{{ currentSong?.songName || '歌词' }}</h2>
    <button class="lyrics-follow" aria-label="回到当前歌词" :disabled="curIdx < 0" @click="resumeFollow">当前</button>
  </div>
  <div
    class="lyrics-view"
    tabindex="0"
    role="region"
    aria-label="歌词"
    ref="viewRef"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
    @wheel.passive="onWheel"
    @keydown="onScrollKey"
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
        :role="Number.isFinite(line.time) ? 'button' : undefined"
        :tabindex="Number.isFinite(line.time) ? 0 : undefined"
        :aria-label="Number.isFinite(line.time) ? '跳到歌词 ' + line.text : undefined"
        :aria-current="isCurrent(i) ? 'true' : undefined"
        @click="onLineClick(line)"
        @keydown.enter.stop.prevent="onLineKey(line)"
        @keydown.space.stop.prevent="onLineKey(line)"
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
            backgroundImage: `linear-gradient(to right, var(--lyric-sung) ${(lineProgress(i) * 100).toFixed(1)}%, var(--lyric-wait) ${(lineProgress(i) * 100).toFixed(1)}%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }"
        >{{ line.text }}</span>
        <!-- 非当前行: 普通显示 -->
        <span v-else class="lyric-text">{{ line.text }}</span>
      </div>
    </div>
  </div>
  </section>
</template>

<style scoped>
.lyrics-shell {
  --lyric-sung: var(--accent);
  --lyric-wait: var(--text);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
.lyrics-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-shrink: 0; }
.lyrics-back, .lyrics-follow { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 44px; min-height: 44px; padding: 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: background-color 120ms ease; }
.lyrics-back svg { width: 18px; height: 18px; fill: currentColor; }
.lyrics-back:active, .lyrics-follow:active { background: var(--bg-hover); }
.lyrics-back:focus-visible, .lyrics-follow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lyrics-follow { color: var(--accent); }
.lyrics-follow:disabled { opacity: .4; cursor: default; }
.lyrics-title { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; font-size: 14px; line-height: 1.4; font-weight: 500; color: var(--text-secondary); }
.lyrics-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 24px 16px 48px;
  scroll-behavior: auto;
  position: relative;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
}
.lyrics-view:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

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
  gap: 18px;
  min-height: 100%;
  max-width: 640px;
  margin-inline: auto;
}

.lyric-line {
  flex-shrink: 0;
  position: relative;
  font-size: var(--lyric-size, 22px);
  line-height: 1.5;
  text-align: left;
  padding: 8px 4px;
  min-height: 44px;
  transition: color 0.2s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  font-weight: 400;
}
.lyric-line:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

.lyric-line.sung {
  color: var(--lyric-sung);
  opacity: 1;
}

.lyric-line.unsung {
  color: var(--lyric-wait);
  opacity: 1;
}

.lyric-line.plain { color: var(--lyric-wait); cursor: default; }

/* Only the current timestamp group uses the independent, larger font. */
.lyric-line.cur {
  color: var(--lyric-wait);
  font-size: var(--current-lyric-size, 28px);
  font-weight: 700;
  line-height: 1.45;
}
.lyric-text { flex: 1; min-width: 0; max-height: none; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-wrap: balance; }

/* 逐字填充: 每个 char 独立 span */
.char-fill .char {
  display: inline;
}

@media (prefers-reduced-motion: reduce) {
  .lyrics-view { scroll-behavior: auto; }
  .lyric-line { transition: none; transform: none; }
  .lyrics-back, .lyrics-follow { transition: none; }
}
</style>
