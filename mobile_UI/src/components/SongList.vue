<!-- =========== 歌曲列表组件 =========== -->
<!-- 性能: 服务端分页按需加载, 滚动到底部时 emit loadMore 触发父组件请求下一页 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { coverUrl } from '../api.js';

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

const emit = defineEmits(['play', 'retry', 'loadMore']);

const scrollContainer = ref(null);

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
      <h1>Wuu 音乐</h1>
      <p class="subtitle" v-if="!loading && !loadError">
        {{ songs.length }} / {{ total }} 首
      </p>
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
      <p>歌库为空</p>
    </div>

    <!-- 歌曲列表 -->
    <div v-else class="list" :class="{ 'has-mini-player': currentId >= 0 }">
      <div
        v-for="song in songs"
        :key="song.id"
        class="song-item"
        :class="{ active: song.id === currentId }"
        @click="$emit('play', song)"
      >
        <img
          v-if="song.hasCover"
          :src="coverUrl(song.id)"
          class="song-cover"
          loading="lazy"
          alt=""
        />
        <div v-else class="song-cover song-cover-placeholder">♪</div>
        <div class="song-info">
          <div class="song-name">{{ song.songName || '未知歌曲' }}</div>
          <div class="song-artist">{{ song.artist || '未知艺人' }}</div>
        </div>
        <div class="song-status">
          <span v-if="song.id === currentId && isPlaying" class="playing-icon">▶</span>
        </div>
      </div>
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
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.header {
  padding: 60px 20px 16px;
  padding-top: calc(60px + env(safe-area-inset-top));
  background: var(--bg-card);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border);
}
.header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 0;
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
  color: #ff6b6b;
  text-align: center;
}
.retry-btn {
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
  padding: 8px 0;
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
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.song-item:active {
  background: var(--bg-hover);
}
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
}
.song-artist {
  font-size: 12px;
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
  font-size: 12px;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
