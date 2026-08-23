<!-- =========== 移动端 App 根组件 =========== -->
<!-- 布局: 底部导航(推荐/歌单/我的) + 播放器(右滑歌词) + 首次点击随机播放 -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { usePlayer } from './composables/usePlayer.js';
import { fetchSongsPage, coverUrl } from './api.js';
import Player from './components/Player.vue';
import LyricsView from './components/LyricsView.vue';
import SongList from './components/SongList.vue';
import Collections from './components/Collections.vue';
import BottomNav from './components/BottomNav.vue';

const {
  init,
  currentSong,
  isPlaying,
  playSong,
  playRandom,
  startDesktopSync,
  stopDesktopSync,
} = usePlayer();

// ===== 音频元素 =====
const audioRef = ref(null);

// ===== 视图状态 =====
const activeTab = ref('recommend');   // 'recommend' | 'list' | 'collections'
const showLyrics = ref(false);        // 播放器内: false=封面, true=歌词
const isSyncing = ref(true);          // 是否正在同步桌面端状态

// ===== 歌单列表 (歌单页用, 服务端分页) =====
const songs = ref([]);
const totalCount = ref(0);
const currentPage = ref(0);
const hasMore = ref(true);
const listLoading = ref(true);
const listLoadingMore = ref(false);
const listLoadError = ref('');

const PAGE_SIZE = 30;

// ===== 初始化音频 =====
onMounted(() => {
  if (audioRef.value) {
    init(audioRef.value);
  }
  loadSongs();
  // 启动桌面端状态同步
  startDesktopSync().finally(() => {
    isSyncing.value = false;
  });
});

onUnmounted(() => {
  stopDesktopSync();
});

// ===== 首次点击: 随机播放 (仅在同步模式为 isolated 或桌面端无状态时使用) =====
function onFirstClick() {
  playRandom();
}

// ===== 视图切换 =====
function switchTab(tab) {
  activeTab.value = tab;
}

// ===== 播放器右滑: 切换歌词视图 =====
function showLyricsView() {
  showLyrics.value = true;
}
// 歌词视图左滑: 返回封面
function hideLyricsView() {
  showLyrics.value = false;
}

// ===== 歌单页: 加载第一页 =====
async function loadSongs() {
  listLoading.value = true;
  listLoadError.value = '';
  songs.value = [];
  currentPage.value = 0;
  hasMore.value = true;
  try {
    const data = await fetchSongsPage(1, PAGE_SIZE);
    songs.value = data.songs;
    totalCount.value = data.total;
    currentPage.value = 1;
    hasMore.value = data.hasMore;
  } catch (e) {
    listLoadError.value = e.message;
  } finally {
    listLoading.value = false;
  }
}

// ===== 歌单页: 加载更多 =====
async function loadMore() {
  if (listLoadingMore.value || !hasMore.value) return;
  listLoadingMore.value = true;
  try {
    const data = await fetchSongsPage(currentPage.value + 1, PAGE_SIZE);
    songs.value.push(...data.songs);
    currentPage.value = data.page;
    hasMore.value = data.hasMore;
  } catch (e) {
    console.error('加载更多失败:', e);
  } finally {
    listLoadingMore.value = false;
  }
}

// ===== 歌单页: 点击歌曲播放 (切到推荐页) =====
function playFromList(song) {
  playSong(song);
  activeTab.value = 'recommend';
}

// ===== 我的歌单: 点击歌曲播放 =====
function playFromCollection(song) {
  playSong(song);
  activeTab.value = 'recommend';
}

// ===== 我的歌单: 播放全部 =====
function playAll(songsList) {
  if (songsList && songsList.length > 0) {
    playSong(songsList[0]);
    activeTab.value = 'recommend';
  }
}
</script>

<template>
  <div class="app">
    <!-- 音频元素 (全局共享) -->
    <audio ref="audioRef" preload="metadata"></audio>

    <!-- 主内容区 -->
    <main class="main">
      <!-- 推荐页 (播放器) -->
      <div v-show="activeTab === 'recommend'" class="view-container">
        <!-- 首次进入: 点击开始随机播放 -->
        <div v-if="!currentSong && !isSyncing" class="start-screen" @click="onFirstClick">
          <div class="start-disc">
            <div class="start-cover">♪</div>
          </div>
          <div class="start-title">Wuu 音乐</div>
          <div class="start-hint">点击开始播放</div>
        </div>

        <!-- 同步中状态 -->
        <div v-else-if="!currentSong && isSyncing" class="start-screen">
          <div class="start-disc syncing">
            <div class="start-cover">♪</div>
          </div>
          <div class="start-title">Wuu 音乐</div>
          <div class="start-hint">正在同步电脑端播放状态...</div>
        </div>

        <!-- 播放器 (封面 / 歌词切换) -->
        <template v-else>
          <!-- 歌词视图 (左滑返回) -->
          <LyricsView
            v-if="showLyrics"
            @swipe-left="hideLyricsView"
          />
          <!-- 播放器主界面 (右滑进歌词) -->
          <Player
            v-else
            @swipe-right="showLyricsView"
          />
        </template>
      </div>

      <!-- 歌单页 -->
      <SongList
        v-show="activeTab === 'list'"
        :songs="songs"
        :loading="listLoading"
        :loadingMore="listLoadingMore"
        :hasMore="hasMore"
        :total="totalCount"
        :loadError="listLoadError"
        :currentId="currentSong ? currentSong.id : -1"
        :isPlaying="isPlaying"
        @play="playFromList"
        @retry="loadSongs"
        @loadMore="loadMore"
      />

      <!-- 我的歌单页 -->
      <Collections
        v-show="activeTab === 'collections'"
        @play="playFromCollection"
        @playAll="playAll"
      />
    </main>

    <!-- 底部导航 -->
    <BottomNav :active="activeTab" @switch="switchTab" />
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.view-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* 首次进入: 开始屏幕 */
.start-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  gap: 24px;
}
.start-disc {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: var(--bg-card-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4),
              0 0 0 8px rgba(0, 0, 0, 0.25),
              0 0 0 9px rgba(255, 255, 255, 0.06);
}
.start-cover {
  font-size: 70px;
  color: var(--accent);
}
.start-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}
.start-hint {
  font-size: 14px;
  color: var(--text-secondary);
  opacity: 0.7;
}
</style>
