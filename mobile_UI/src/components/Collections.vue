<!-- =========== 我的歌单组件 =========== -->
<!-- 展示用户歌单列表, 点击进入歌单详情播放 -->
<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { fetchCollections, createCollection, coverUrl, coverByPath } from '../api.js';

const emit = defineEmits(['play', 'playAll']);

const collections = ref([]);
const loading = ref(true);
const loadError = ref('');
const activeCollection = ref(null);  // null=列表视图, 非null=歌单详情
let collectionRequest = 0;

// ===== 创建歌单 =====
const showCreate = ref(false);
const newName = ref('');
const creating = ref(false);
const createError = ref('');
const nameInput = ref(null);
const createDialog = ref(null);
let returnFocus = null;

function openCreate(event) {
  returnFocus = event?.currentTarget || document.activeElement;
  newName.value = '';
  createError.value = '';
  showCreate.value = true;
  // 等弹层渲染后聚焦输入框
  nextTick(() => {
    if (nameInput.value) nameInput.value.focus();
  });
}
watch(showCreate, visible => {
  if (visible) document.addEventListener('keydown', trapCreateFocus);
  else {
    document.removeEventListener('keydown', trapCreateFocus);
    nextTick(() => { if (returnFocus?.isConnected) returnFocus.focus(); });
  }
});
function trapCreateFocus(event) {
  if (!showCreate.value || event.defaultPrevented) return;
  if (event.key === 'Escape') { event.preventDefault(); showCreate.value = false; return; }
  if (event.key !== 'Tab') return;
  const items = [...(createDialog.value?.querySelectorAll('input,button:not(:disabled)') || [])];
  const target = event.shiftKey ? items.at(-1) : items[0];
  if (!createDialog.value?.contains(document.activeElement) || event.shiftKey && document.activeElement === items[0] || !event.shiftKey && document.activeElement === items.at(-1)) {
    event.preventDefault(); target?.focus();
  }
}

async function confirmCreate() {
  const name = newName.value.trim();
  if (!name) {
    createError.value = '请输入歌单名称';
    return;
  }
  if (creating.value) return;
  creating.value = true;
  createError.value = '';
  try {
    await createCollection(name);
    showCreate.value = false;
    await loadCollections();
  } catch (e) {
    createError.value = e.message || '创建失败';
  } finally {
    creating.value = false;
  }
}

async function loadCollections() {
  const request = ++collectionRequest;
  loading.value = true;
  loadError.value = '';
  try {
    const data = await fetchCollections();
    if (request !== collectionRequest) return;
    const list = data.collections || [];
    // "我喜欢"固定置顶, 其余按创建时间排序
    collections.value = [
      ...list.filter(c => c.id === 'mobile-liked' || c.name === '我喜欢'),
      ...list.filter(c => c.id !== 'mobile-liked' && c.name !== '我喜欢'),
    ];
    if (activeCollection.value) activeCollection.value = collections.value.find(col => col.id === activeCollection.value.id) || null;
  } catch (e) {
    if (request === collectionRequest) loadError.value = e.message;
  } finally {
    if (request === collectionRequest) loading.value = false;
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
  window.addEventListener('wuu-collections-updated', loadCollections);
});
onBeforeUnmount(() => { collectionRequest++; window.removeEventListener('wuu-collections-updated', loadCollections); document.removeEventListener('keydown', trapCreateFocus); });
</script>

<template>
  <div class="collections-view">
    <!-- 歌单详情视图 -->
    <template v-if="activeCollection">
      <header class="header">
        <button class="back-btn" aria-label="返回歌单列表" @click="backToList">
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
        <button
          v-for="(song, i) in activeCollection.songs"
          :key="i"
          class="song-item"
          type="button"
          @click="playSong(song)"
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
        </button>
        <div v-if="!activeCollection.songs || activeCollection.songs.length === 0" class="empty-hint">
          歌单为空
        </div>
      </div>
    </template>

    <!-- 歌单列表视图 -->
    <template v-else>
      <header class="header">
        <h1>我的歌单</h1>
        <button class="add-btn" title="新建歌单" aria-label="新建歌单" @click="openCreate">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        </button>
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
        <p class="hint">点击右上角 + 创建一个空歌单开始分类</p>
        <button class="retry-btn" @click="openCreate">新建歌单</button>
      </div>

      <div v-else class="collection-list">
        <button
          v-for="col in collections"
          :key="col.id"
          class="collection-item"
          type="button"
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
        </button>
      </div>
    </template>

    <!-- 创建歌单弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showCreate" class="create-mask" @click.self="showCreate = false">
          <div ref="createDialog" class="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-collection-title">
            <div id="create-collection-title" class="create-title">新建歌单</div>
            <input
              ref="nameInput"
              v-model="newName"
              class="create-input"
              type="text"
              maxlength="50"
              placeholder="输入歌单名称"
              aria-label="歌单名称"
              :aria-invalid="!!createError"
              :aria-describedby="createError ? 'create-collection-error' : undefined"
              @keyup.enter="confirmCreate"
            />
            <div v-if="createError" id="create-collection-error" class="create-error" role="alert">{{ createError }}</div>
            <div class="create-actions">
              <button class="create-btn cancel" @click="showCreate = false">取消</button>
              <button class="create-btn confirm" :disabled="creating" @click="confirmCreate">
                {{ creating ? '创建中…' : '创建' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.collections-view { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; background: var(--bg); -webkit-overflow-scrolling: touch; }
.header { display: flex; align-items: center; gap: 8px; padding: 20px 16px 16px; position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: var(--bg); }
.header h1 { flex: 1; min-width: 0; margin: 0; font-size: 25px; font-weight: 720; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-info { flex: 1; min-width: 0; }
.header-info h1 { font-size: 20px; }
.subtitle { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); }
.add-btn, .back-btn { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--text); cursor: pointer; }
.add-btn { border: 1px solid var(--border); color: var(--accent); background: var(--accent-soft); }
.add-btn svg, .back-btn svg { width: 24px; height: 24px; fill: currentColor; }
.play-all-btn, .retry-btn { min-height: 44px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-size: 14px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.status-box { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 48px 20px; color: var(--text-secondary); text-align: center; }
.error-text, .create-error { color: var(--danger); }
.hint { font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
.spinner { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.collection-list, .song-list { padding: 8px 12px 16px; }
.collection-item, .song-item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 76px; padding: 12px 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: inherit; line-height: 1.4; text-align: left; cursor: pointer; transition: background .15s; }
.collection-item:active, .song-item:active, .add-btn:active, .back-btn:active { background: var(--bg-hover); }
.collection-cover { flex-shrink: 0; width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--bg-card-elevated); }
.cover-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder { display: grid; place-items: center; color: var(--text-secondary); }
.cover-placeholder svg { width: 26px; height: 26px; fill: currentColor; }
.collection-info, .song-info { flex: 1; min-width: 0; }
.collection-name, .song-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 16px; font-weight: 600; }
.collection-count, .song-artist { margin-top: 4px; color: var(--text-secondary); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arrow { flex-shrink: 0; width: 20px; height: 20px; fill: var(--text-secondary); }
.song-item { min-height: 72px; padding-block: 10px; }
.song-cover { flex-shrink: 0; width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: var(--bg-card-elevated); }
.song-cover-placeholder { display: grid; place-items: center; color: var(--text-secondary); }
.song-cover-placeholder svg { width: 24px; height: 24px; fill: currentColor; }
.empty-hint { padding: 48px 20px; color: var(--text-secondary); text-align: center; font-size: 14px; }
.create-mask { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: var(--overlay); }
.create-dialog { width: 100%; max-width: 360px; max-height: calc(100dvh - 32px); box-sizing: border-box; overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-card-elevated); color: var(--text); box-shadow: var(--shadow); }
.create-title { margin-bottom: 16px; font-size: 18px; font-weight: 650; text-align: left; }
.create-input { width: 100%; min-height: 48px; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 16px; }
.create-input::placeholder { color: var(--text-secondary); }
.create-error { margin-top: 8px; font-size: 13px; }
.create-actions { display: flex; gap: 12px; margin-top: 20px; }
.create-btn { flex: 1; min-height: 44px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); color: var(--text); font-size: 14px; cursor: pointer; }
.create-btn.confirm { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.create-btn:disabled { opacity: .6; cursor: default; }
.collections-view button:focus-visible, .create-btn:focus-visible, .create-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .collection-item, .song-item, .fade-enter-active, .fade-leave-active { transition: none; } .spinner { animation: none; } }
</style>
