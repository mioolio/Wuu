<!-- =========== 歌词视图 (播放器左滑进入) =========== -->
<!-- 功能: LRC 解析(逐字+标准) / 逐字走字填充 / 胶囊高亮 / 自动滚动 / 点击跳转 -->
<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { usePlayer } from '../composables/usePlayer.js';

const { lyricText, currentTime, duration, seek, getAudioEl } = usePlayer();

// 解析后的歌词行: { time, text, chars? }
// chars: [{ offset, dur, text }] 逐字格式才有, offset/dur 单位秒
const lines = ref([]);
const curIdx = ref(-1);
const listRef = ref(null);
// 当前帧的填充进度 (rAF 更新, 触发当前行重渲染)
const tick = ref(0);

// 解析 LRC: 支持逐字格式 [startMs,durMs]<offset,dur,0>text 和标准格式 [mm:ss.xx]
function parseLRC(text) {
  if (!text || !text.trim()) return [];
  const result = [];
  const rawLineRegex = /^\[(\d+),(\d+)\](.*)/;
  const stdLineRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const rawMatch = trimmed.match(rawLineRegex);
    if (rawMatch) {
      // 逐字格式: [startMs,durMs]<offset,dur,0>text<offset,dur,0>text...
      const startSec = parseInt(rawMatch[1]) / 1000;
      const chars = parseRawChars(rawMatch[3]);
      if (chars.length) {
        const fullText = chars.map(c => c.text).join('');
        result.push({ time: startSec, text: fullText, chars });
      }
      continue;
    }

    // 标准格式 [mm:ss.xx] (一行可能有多个时间戳)
    const matches = [...trimmed.matchAll(stdLineRegex)];
    if (matches.length > 0) {
      const content = trimmed.replace(stdLineRegex, '').trim();
      if (!content) continue;
      for (const m of matches) {
        const min = parseInt(m[1]);
        const sec = parseFloat(m[2]);
        result.push({ time: min * 60 + sec, text: content });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

// 解析逐字内容: 提取每个字的 offset/dur/text
// 格式1: text<tag>text<tag>...  (tag 描述其前面的 text)
// 格式2: <tag>text<tag>text...  (tag 描述其后面的 text)
function parseRawChars(content) {
  const tagRe = /<(\d+),(\d+),\d+>/g;
  const parts = content.split(/<[^>]+>/);
  const offs = [];
  let m;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(content))) {
    offs.push({
      offset: parseInt(m[1]) / 1000,
      dur: Math.max(0.1, parseInt(m[2]) / 1000),
    });
  }
  if (!offs.length) return [];

  const chars = [];
  const startsWithTag = parts.length > 0 && parts[0] === '';
  for (let i = 0; i < offs.length; i++) {
    const textPart = startsWithTag ? parts[i + 1] : parts[i];
    if (!textPart) continue;
    chars.push({
      offset: offs[i].offset,
      dur: offs[i].dur,
      text: textPart,
    });
  }
  // 尾部无标签文本
  const trailingThreshold = startsWithTag ? offs.length + 1 : offs.length;
  if (parts.length > trailingThreshold && parts[parts.length - 1]) {
    const lastOff = chars.length > 0 ? chars[chars.length - 1].offset + chars[chars.length - 1].dur : 0;
    chars.push({ offset: lastOff, dur: 0.4, text: parts[parts.length - 1] });
  }
  return chars;
}

// 歌词文本变化时重新解析
watch(lyricText, (txt) => {
  lines.value = parseLRC(txt);
  curIdx.value = -1;
}, { immediate: true });

// 根据当前播放时间高亮对应行
watch(currentTime, (t) => {
  if (!lines.value.length) return;
  let idx = -1;
  for (let i = 0; i < lines.value.length; i++) {
    if (t >= lines.value[i].time) idx = i;
    else break;
  }
  if (idx !== curIdx.value) {
    curIdx.value = idx;
    scrollToCur(idx);
  }
});

// ===== rAF 循环: 60fps 更新当前行走字进度 =====
// timeupdate 事件约 4Hz, 不够流畅; 用 rAF 读取 audio.currentTime 独立更新
let rafId = null;
function rafLoop() {
  tick.value++;  // 触发当前行重渲染
  rafId = requestAnimationFrame(rafLoop);
}
rafId = requestAnimationFrame(rafLoop);
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
});

// 读取当前播放时间 (优先用 audioEl.currentTime, rAF 级别流畅)
function getNow() {
  const el = getAudioEl();
  return el ? el.currentTime : currentTime.value;
}

// 计算某个字的填充进度 (0-1)
function charProgress(ch, lineTime, now) {
  const start = lineTime + ch.offset;
  const end = start + ch.dur;
  if (now >= end) return 1;
  if (now <= start) return 0;
  return (now - start) / ch.dur;
}

// 字的样式: 已唱=强调色, 正在唱=渐变填充, 未唱=半透明
function charStyle(ch, line) {
  // tick.value 触发重算 (rAF 每帧 +1)
  void tick.value;
  const now = getNow();
  const p = charProgress(ch, line.time, now);
  if (p >= 1) {
    // 已唱完: 强调色
    return { color: 'var(--accent)' };
  }
  if (p <= 0) {
    // 未开始: 半透明默认色
    return { color: 'var(--text-secondary)', opacity: 0.6 };
  }
  // 正在唱: 渐变填充 (已唱部分强调色, 未唱部分半透明)
  const pct = (p * 100).toFixed(1);
  return {
    backgroundImage: `linear-gradient(to right, var(--accent) ${pct}%, var(--text-secondary) ${pct}%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };
}

// 无 chars 的当前行: 用行级进度填充
function lineProgress(line) {
  void tick.value;
  const now = getNow();
  const next = nextLineTime(line);
  const span = next - line.time;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (now - line.time) / span));
}

function nextLineTime(line) {
  const idx = lines.value.indexOf(line);
  if (idx < 0 || idx + 1 >= lines.value.length) {
    return duration.value || line.time + 5;
  }
  return lines.value[idx + 1].time;
}

// 时间格式化 mm:ss
function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// 滚动到当前行
function scrollToCur(idx) {
  if (idx < 0 || !listRef.value) return;
  nextTick(() => {
    const el = listRef.value.children[idx];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// 点击歌词行跳转
function onLineClick(line) {
  if (line.time != null && duration.value > 0) {
    seek((line.time / duration.value) * 100);
  }
}

const showEmpty = computed(() => !lines.value.length);

// 已唱/未唱 样式 class
function lineClass(i) {
  if (i === curIdx.value) return 'cur';
  if (i < curIdx.value) return 'sung';
  return 'unsung';
}

// ===== 右滑手势: 返回封面视图 =====
const emit = defineEmits(['swipe-left']);
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
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
    touchMoved = true;
  }
}
function onTouchEnd(e) {
  if (!touchMoved) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (dx > 80) {
    emit('swipe-left');
  }
}
</script>

<template>
  <div
    class="lyrics-view"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- 无歌词 -->
    <div v-if="showEmpty" class="empty">
      <span>纯音乐,请欣赏</span>
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
        <span v-if="i === curIdx && line.chars" class="lyric-text char-fill">
          <span
            v-for="(ch, ci) in line.chars"
            :key="ci"
            class="char"
            :style="charStyle(ch, line)"
          >{{ ch.text }}</span>
        </span>
        <!-- 当前行 + 无逐字数据: 行级渐变填充 -->
        <span
          v-else-if="i === curIdx"
          class="lyric-text"
          :style="{
            backgroundImage: `linear-gradient(to right, var(--accent) ${(lineProgress(line) * 100).toFixed(1)}%, var(--text-secondary) ${(lineProgress(line) * 100).toFixed(1)}%)`,
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
        <div v-else class="hover-meta">
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
  scroll-behavior: smooth;
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
</style>
