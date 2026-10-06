<!-- =========== 移动端 App 根组件 =========== -->
<!-- 底部导航、常驻音频、跨页面迷你播放器；歌词支持按钮和滑动切换。 -->
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { usePlayer } from './composables/usePlayer.js';
import { useListenTogether } from './composables/useListenTogether.js';
import { useAudioFx } from './composables/useAudioFx.js';
import { fetchSongsPage, coverUrl, coverByPath } from './api.js';
import Player from './components/Player.vue';
import LyricsView from './components/LyricsView.vue';
import SongList from './components/SongList.vue';
import Collections from './components/Collections.vue';
import SettingsView from './components/SettingsView.vue';
import BottomNav from './components/BottomNav.vue';

const {
  init,
  currentSong,
  isPlaying,
  isLoading,
  togglePlay,
  progressPercent,
  playSong,
  playRandom,
  startDesktopSync,
  stopDesktopSync,
} = usePlayer();

// 一起听: 应用启动即初始化 (设置项开启时自动连接 WS 房间)
const together = useListenTogether();
const togetherBlocked = computed(() => together.enabled.value && together.autoplayBlocked?.value);

// ===== 音频元素 =====
const audioRef = ref(null);

// ===== 视图状态 =====
const activeTab = ref('recommend');   // 'recommend' | 'list' | 'collections' | 'settings'
const showLyrics = ref(false);        // 播放器内: false=封面, true=歌词
const isSyncing = ref(true);          // 是否正在同步桌面端状态
const miniCover = computed(() => currentSong.value?.hasCover
  ? (currentSong.value.coverPath ? coverByPath(currentSong.value.coverPath) : coverUrl(currentSong.value.id)) : '');
const miniCoverError = ref(false);
const miniCoverSource = ref('');
function miniImageFailed() { miniCoverSource.value = miniCover.value; miniCoverError.value = true; }
const showMiniCover = computed(() => miniCover.value && (!miniCoverError.value || miniCoverSource.value !== miniCover.value));
let libraryRequest = 0;

// ===== 歌单列表 (歌单页用, 服务端分页) =====
const songs = ref([]);
const totalCount = ref(0);
const currentPage = ref(0);
const hasMore = ref(true);
const listLoading = ref(true);
const listLoadingMore = ref(false);
const listLoadError = ref('');

const PAGE_SIZE = 30;

// ===== 歌单页搜索关键词 (空 = 全部) =====
const searchQuery = ref('');

// ===== 初始化音频 =====
const { attachAudioFx, resumeCtx } = useAudioFx();
onMounted(() => {
  if (audioRef.value) {
    init(audioRef.value);
    // 音效链挂载 (Web Audio: EQ/空间/混响, 设置页可调)
    attachAudioFx(audioRef.value);
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
  resumeCtx();
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

// ===== 歌单页: 加载第一页 (按当前搜索关键词) =====
async function loadSongs() {
  const request = ++libraryRequest;
  listLoading.value = true;
  listLoadingMore.value = false;
  listLoadError.value = '';
  songs.value = [];
  currentPage.value = 0;
  hasMore.value = true;
  try {
    const data = await fetchSongsPage(1, PAGE_SIZE, searchQuery.value);
    if (request !== libraryRequest) return;
    songs.value = data.songs;
    totalCount.value = data.total;
    currentPage.value = 1;
    hasMore.value = data.hasMore;
  } catch (e) {
    if (request !== libraryRequest) return;
    listLoadError.value = e.message;
  } finally {
    if (request === libraryRequest) listLoading.value = false;
  }
}

// ===== 歌单页: 加载更多 =====
async function loadMore() {
  if (listLoading.value || listLoadingMore.value || !hasMore.value) return;
  const request = libraryRequest;
  listLoadingMore.value = true;
  try {
    const data = await fetchSongsPage(currentPage.value + 1, PAGE_SIZE, searchQuery.value);
    if (request !== libraryRequest) return;
    songs.value.push(...data.songs);
    currentPage.value = data.page;
    hasMore.value = data.hasMore;
  } catch (e) {
    console.error('加载更多失败:', e);
  } finally {
    if (request === libraryRequest) listLoadingMore.value = false;
  }
}

// ===== 歌单页: 搜索 (SongList 防抖后触发) =====
function onSearch(q) {
  searchQuery.value = q;
  loadSongs();
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

    <header class="app-header">
      <span class="wordmark" aria-label="Wuu 音乐">Wuu<span class="brand-dot" aria-hidden="true"></span></span>
      <div v-if="activeTab === 'recommend' && currentSong" class="view-switch" aria-label="播放视图">
        <button :class="{ selected: !showLyrics }" :aria-pressed="!showLyrics" @click="hideLyricsView">封面</button>
        <button :class="{ selected: showLyrics }" :aria-pressed="showLyrics" @click="showLyricsView">歌词</button>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="main">
      <div v-if="togetherBlocked && activeTab !== 'settings'" class="join-notice" role="status"><span>点击加入电脑当前的播放</span><button @click="together.resumeTogether()">加入播放</button></div>
      <!-- 推荐页 (播放器) -->
      <div v-show="activeTab === 'recommend'" class="view-container">
        <!-- 首次进入: 点击开始随机播放 -->
        <div v-if="!currentSong" class="start-screen">
          <div class="start-art" aria-hidden="true"><svg viewBox="0 0 96 96"><path d="M37 65V24l36-7v41M37 33l36-7"/><ellipse cx="27" cy="65" rx="10" ry="7"/><ellipse cx="63" cy="58" rx="10" ry="7"/></svg></div>
          <div><h1 class="start-title">把音乐带在身边</h1><p class="start-hint">从你的音乐库，开启今天的第一首。</p></div>
          <button class="start-button" :disabled="isLoading" @click="onFirstClick">{{ isLoading ? '正在准备音乐…' : '随机播放' }}</button>
          <button class="browse-button" @click="switchTab('list')">浏览音乐库</button>
          <p v-if="isSyncing" class="sync-hint" role="status">正在读取电脑的歌曲，可以直接开始播放</p>
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
        :currentId="Number.isSafeInteger(currentSong?.id) ? currentSong.id : -1"
        :isPlaying="isPlaying"
        @play="playFromList"
        @retry="loadSongs"
        @loadMore="loadMore"
        @search="onSearch"
      />

      <!-- 我的歌单页 -->
      <Collections
        v-show="activeTab === 'collections'"
        @play="playFromCollection"
        @playAll="playAll"
      />

      <!-- 设置页 -->
      <SettingsView v-show="activeTab === 'settings'" />
    </main>

    <div v-if="currentSong && activeTab !== 'recommend'" class="mini-player">
      <button class="mini-open" aria-label="打开播放页" @click="switchTab('recommend')">
        <img v-if="showMiniCover" :src="miniCover" alt="" @error="miniImageFailed" />
        <span v-else class="mini-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg></span>
        <span class="mini-info"><strong>{{ currentSong.songName }}</strong><span>{{ currentSong.artist || '未知歌手' }}</span></span>
      </button>
      <button class="mini-toggle" :aria-label="isPlaying ? '暂停' : '播放'" @click="togglePlay">
        <svg v-if="isPlaying" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>
      </button>
      <div class="mini-progress" aria-hidden="true"><span :style="{ width: progressPercent + '%' }"></span></div>
    </div>

    <!-- 底部导航 -->
    <BottomNav :active="activeTab" @switch="switchTab" />
  </div>
</template>

<style scoped>
.app { height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.app-header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: calc(64px + env(safe-area-inset-top)); padding: calc(8px + env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) 8px max(24px, env(safe-area-inset-left)); width: 100%; max-width: 720px; margin-inline: auto; }
.wordmark { display: inline-flex; align-items: baseline; gap: 3px; font-size: 26px; font-weight: 750; letter-spacing: -1.2px; color: var(--text); }
.brand-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
.view-switch { display: flex; padding: 3px; border-radius: 14px; background: var(--bg-card-elevated); }
.view-switch button { min-width: 56px; min-height: 44px; padding: 8px 14px; border: 0; border-radius: 11px; background: transparent; color: var(--text-secondary); font-size: 14px; }
.view-switch button.selected { background: var(--bg-card); color: var(--text); font-weight: 600; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; width: 100%; max-width: 720px; margin-inline: auto; }
.join-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; margin: 4px 24px 12px; padding: 8px 12px; background: var(--accent-soft); border-radius: 14px; color: var(--text); font-size: 13px; }
.join-notice button { min-height: 44px; padding: 8px 12px; background: var(--accent); color: var(--on-accent); border: 0; border-radius: 10px; white-space: nowrap; font-weight: 600; }
.view-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.start-screen { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow-y: auto; padding: 32px 24px; gap: 12px; text-align: center; }
.start-art { display: grid; place-items: center; width: min(48vw, 200px); aspect-ratio: 1; flex-shrink: 0; border-radius: 32px; background: var(--accent-soft); color: var(--accent); margin-bottom: 24px; }
.start-art svg { width: 50%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.start-title { font-size: 25px; font-weight: 650; letter-spacing: -.6px; color: var(--text); }
.start-hint { font-size: 14px; color: var(--text-secondary); margin-top: 8px; }
.start-button { min-height: 48px; width: min(100%, 240px); border: 0; border-radius: 14px; background: var(--accent); color: var(--on-accent); font-size: 16px; font-weight: 600; margin-top: 24px; }
.browse-button { border: 0; background: transparent; color: var(--text-secondary); min-height: 48px; padding: 8px 20px; }
.sync-hint { color: var(--text-secondary); font-size: 12px; }
.mini-player { display: flex; align-items: center; position: relative; flex-shrink: 0; min-height: 68px; background: var(--bg-card); border-top: 1px solid var(--border); padding: 8px max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left)); gap: 12px; }
.mini-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 48px; border: 0; background: transparent; text-align: left; }
.mini-open img, .mini-placeholder { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.mini-placeholder { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.mini-placeholder svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.mini-info { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mini-info strong { font-size: 14px; font-weight: 600; }
.mini-info span { font-size: 12px; color: var(--text-secondary); }
.mini-info strong, .mini-info span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini-toggle { display: grid; place-items: center; width: 48px; height: 48px; border: 0; background: transparent; color: var(--text); border-radius: 50%; }
.mini-toggle svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.mini-progress { position: absolute; height: 2px; left: 0; right: 0; bottom: 0; background: var(--border); }
.mini-progress span { display: block; height: 100%; background: var(--accent); }
@media (min-width: 768px) { .mini-player { padding-inline: max(16px, calc((100% - 640px) / 2)); } }
@media (max-height: 600px) { .start-art { width: 100px; margin-bottom: 8px; } .start-screen { justify-content: flex-start; padding-block: 16px; } .start-button { margin-top: 8px; } }
</style>
