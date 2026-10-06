<!-- =========== 歌曲列表组件 =========== -->
<!-- 性能: 服务端分页按需加载, 滚动到底部时 emit loadMore 触发父组件请求下一页 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { coverUrl, coverByPath } from '../api.js';

const props = defineProps({
  songs: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  loadingMore: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: false },
  total: { type: Number, default: 0 },
  loadError: { type: String, default: '' },
  currentId: { type: Number, default: -1 },
  isPlaying: { type: Boolean, default: false },
});

const emit = defineEmits(['play', 'retry', 'loadMore', 'search']);

const scrollContainer = ref(null);

// ===== 搜索 (300ms 防抖, 服务端过滤分页) =====
const query = ref('');
let searchTimer = null;

function onSearchInput(e) {
  query.value = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    emit('search', query.value.trim());
  }, 300);
}

function clearSearch() {
  clearTimeout(searchTimer);
  query.value = '';
  emit('search', '');
}

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
});

// 计算封面 URL (优先使用 coverPath)
function getCoverUrl(song) {
  if (!song) return '';
  if (song.coverPath && song.hasCover) {
    return coverByPath(song.coverPath);
  }
  return song.hasCover ? coverUrl(song.id) : '';
}

// 滚动到底部时触发加载更多
function onScroll() {
  if (!scrollContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  // 距底部 200px 时预加载下一页
  if (scrollHeight - scrollTop - clientHeight < 200) {
    emit('loadMore');
  }
}

onMounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.addEventListener('scroll', onScroll, { passive: true });
  }
});
onBeforeUnmount(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', onScroll);
  }
});
</script>

<template>
  <div class="song-list-view" ref="scrollContainer">
    <!-- 顶部标题栏 -->
    <header class="header">
      <div class="title-row">
        <h1>音乐库</h1>
        <p class="subtitle" v-if="!loading && !loadError">
          {{ songs.length }} / {{ total }} 首
        </p>
      </div>
      <!-- 搜索框 -->
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input
          class="search-input"
          type="text"
          :value="query"
          placeholder="搜索歌曲 / 歌手"
          aria-label="搜索歌曲或歌手"
          @input="onSearchInput"
        />
        <button v-if="query" class="clear-btn" aria-label="清除搜索" @click="clearSearch">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="status-box">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadError" class="status-box">
      <p class="error-text">{{ loadError }}</p>
      <button class="retry-btn" @click="$emit('retry')">重试</button>
    </div>

    <!-- 空列表 -->
    <div v-else-if="!songs.length" class="status-box">
      <template v-if="query">
        <p>未找到"{{ query }}"相关歌曲</p>
        <button class="retry-btn" @click="clearSearch">清除搜索</button>
      </template>
      <p v-else>歌库为空</p>
    </div>

    <!-- 歌曲列表 -->
    <div v-else class="list" :class="{ 'has-mini-player': currentId >= 0 }">
      <button
        v-for="song in songs"
        :key="song.id"
        class="song-item"
        :class="{ active: song.id === currentId }"
        type="button"
        :aria-current="song.id === currentId ? 'true' : undefined"
        @click="$emit('play', song)"
      >
        <img
          v-if="song.hasCover"
          :src="getCoverUrl(song)"
          class="song-cover"
          loading="lazy"
          alt=""
        />
        <div v-else class="song-cover song-cover-placeholder"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>
        <div class="song-info">
          <div class="song-name">{{ song.songName || '未知歌曲' }}</div>
          <div class="song-artist">{{ song.artist || '未知艺人' }}</div>
        </div>
        <div class="song-status">
          <svg v-if="song.id === currentId && isPlaying" class="playing-icon" role="img" aria-label="正在播放" viewBox="0 0 24 24"><path d="M5 6h3v12H5zm5-3h3v18h-3zm5 5h3v8h-3z"/></svg>
        </div>
      </button>
      <!-- 加载更多提示 -->
      <div v-if="loadingMore" class="load-more">
        <div class="spinner-small"></div>
        <span>加载中...</span>
      </div>
      <div v-else-if="hasMore" class="load-more-hint">
        <span>滚动加载更多</span>
      </div>
      <div v-else-if="songs.length > 0" class="load-end">
        <span>没有更多了</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.song-list-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
  -webkit-overflow-scrolling: touch;
}

.header {
  padding: 20px 16px 16px;
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border);
}
.title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  justify-content: space-between;
}
.header h1 {
  font-size: 25px;
  font-weight: 720;
  color: var(--text);
  margin: 0;
}
.subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 0;
}

/* 搜索框 */
.search-box {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-card-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0 4px 0 14px;
  min-height: 48px;
  background: var(--bg-card);
}
.search-box:focus-within { border-color: var(--accent); }
.search-icon {
  width: 18px;
  height: 18px;
  fill: var(--text-secondary);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 16px;
  min-height: 46px;
}
.search-input::placeholder {
  color: var(--text-secondary);
}
.clear-btn {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.clear-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.status-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  gap: 16px;
}
.error-text {
  color: var(--danger);
  text-align: center;
}
.retry-btn {
  min-height: 44px;
  padding: 8px 24px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.list {
  padding: 8px 12px 16px;
}
.list.has-mini-player {
  padding-bottom: 60px;
}

.load-more,
.load-more-hint,
.load-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
}

.song-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 72px;
  padding: 10px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s;
}
.song-item:active {
  background: var(--bg-hover);
}
.song-item.active { background: var(--accent-soft); }
.song-item:focus-visible, .clear-btn:focus-visible, .retry-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.song-item.active .song-name {
  color: var(--accent);
}

.song-cover {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-card-elevated);
}
.song-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--text-secondary);
}
.song-cover-placeholder svg { width: 24px; height: 24px; fill: currentColor; }

.song-info {
  flex: 1;
  min-width: 0;
}
.song-name {
  font-size: 15px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.song-artist {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.song-status {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.playing-icon {
  color: var(--accent);
  fill: currentColor;
  width: 20px;
  height: 20px;
}
@media (prefers-reduced-motion: reduce) {
  .song-item { transition: none; }
  .spinner, .spinner-small { animation: none; }
}
</style>
