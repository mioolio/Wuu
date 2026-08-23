<!-- =========== 我的歌单组件 =========== -->
<!-- 展示用户歌单列表, 点击进入歌单详情播放 -->
<script setup>
import { ref, onMounted } from 'vue';
import { fetchCollections, coverUrl, coverByPath } from '../api.js';

const emit = defineEmits(['play', 'playAll']);

const collections = ref([]);
const loading = ref(true);
const loadError = ref('');
const activeCollection = ref(null);  // null=列表视图, 非null=歌单详情

async function loadCollections() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await fetchCollections();
    collections.value = data.collections || [];
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openCollection(col) {
  activeCollection.value = col;
}

function backToList() {
  activeCollection.value = null;
}

// 计算封面 URL (优先使用 coverPath)
function getCoverUrl(song) {
  if (!song) return '';
  if (song.coverPath && song.hasCover) {
    return coverByPath(song.coverPath);
  }
  return song.hasCover ? coverUrl(song.id) : '';
}

function playSong(song) {
  emit('play', song);
}

function playAll(songs) {
  if (songs && songs.length > 0) {
    emit('playAll', songs);
  }
}

onMounted(() => {
  loadCollections();
});
</script>

<template>
  <div class="collections-view">
    <!-- 歌单详情视图 -->
    <template v-if="activeCollection">
      <header class="header">
        <button class="back-btn" @click="backToList">
          <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        <div class="header-info">
          <h1>{{ activeCollection.name }}</h1>
          <p class="subtitle">{{ activeCollection.songCount }} 首</p>
        </div>
        <button
          v-if="activeCollection.songs && activeCollection.songs.length > 0"
          class="play-all-btn"
          @click="playAll(activeCollection.songs)"
        >
          播放全部
        </button>
      </header>

      <div class="song-list">
        <div
          v-for="(song, i) in activeCollection.songs"
          :key="i"
          class="song-item"
          @click="playSong(song)"
        >
          <img
            v-if="song.hasCover"
            :src="getCoverUrl(song)"
            class="song-cover"
            loading="lazy"
            alt=""
          />
          <div v-else class="song-cover song-cover-placeholder">♪</div>
          <div class="song-info">
            <div class="song-name">{{ song.songName || '未知歌曲' }}</div>
            <div class="song-artist">{{ song.artist || '未知艺人' }}</div>
          </div>
        </div>
        <div v-if="!activeCollection.songs || activeCollection.songs.length === 0" class="empty-hint">
          歌单为空
        </div>
      </div>
    </template>

    <!-- 歌单列表视图 -->
    <template v-else>
      <header class="header">
        <h1>我的歌单</h1>
      </header>

      <div v-if="loading" class="status-box">
        <div class="spinner"></div>
        <p>加载中...</p>
      </div>

      <div v-else-if="loadError" class="status-box">
        <p class="error-text">{{ loadError }}</p>
        <button class="retry-btn" @click="loadCollections">重试</button>
      </div>

      <div v-else-if="collections.length === 0" class="status-box">
        <p>暂无歌单</p>
        <p class="hint">在电脑端创建歌单后即可在此查看</p>
      </div>

      <div v-else class="collection-list">
        <div
          v-for="col in collections"
          :key="col.id"
          class="collection-item"
          @click="openCollection(col)"
        >
          <div class="collection-cover">
            <img
              v-if="col.songs && col.songs.length > 0 && col.songs[0].hasCover"
              :src="getCoverUrl(col.songs[0])"
              class="cover-img"
              loading="lazy"
              alt=""
            />
            <div v-else class="cover-img cover-placeholder">
              <svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
            </div>
          </div>
          <div class="collection-info">
            <div class="collection-name">{{ col.name }}</div>
            <div class="collection-count">{{ col.songCount }} 首</div>
          </div>
          <svg class="arrow" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.collections-view {
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
  display: flex;
  align-items: center;
  gap: 12px;
}
.header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  flex: 1;
}
.header-info {
  flex: 1;
  min-width: 0;
}
.header-info h1 {
  font-size: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 0;
}
.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.back-btn svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}
.play-all-btn {
  padding: 6px 16px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
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
.hint {
  font-size: 13px;
  opacity: 0.6;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 歌单列表 */
.collection-list {
  padding: 8px 0;
}
.collection-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.collection-item:active {
  background: var(--bg-hover);
}
.collection-cover {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-card-elevated);
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover-placeholder svg {
  width: 28px;
  height: 28px;
  fill: var(--text-secondary);
  opacity: 0.4;
}
.collection-info {
  flex: 1;
  min-width: 0;
}
.collection-name {
  font-size: 16px;
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.collection-count {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 3px;
}
.arrow {
  width: 20px;
  height: 20px;
  fill: var(--text-secondary);
  opacity: 0.4;
  flex-shrink: 0;
}

/* 歌单详情歌曲列表 */
.song-list {
  padding: 8px 0;
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
.empty-hint {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
