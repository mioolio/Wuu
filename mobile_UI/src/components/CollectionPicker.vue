<!-- =========== 歌单选择器 (点击红心后弹出) =========== -->
<!-- 展示所有歌单, 用户可勾选/取消指定歌单 -->
<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { fetchCollections, likeToCollection } from '../api.js';

const props = defineProps({
  visible: Boolean,
  songIndex: { type: Number, default: -1 },
});

const emit = defineEmits(['close', 'changed']);

const collections = ref([]);
const loading = ref(false);
const loadError = ref('');
const busyCollections = ref(new Set());  // 正在操作的歌单 ID
const sheet = ref(null);
const closeButton = ref(null);
let returnFocus = null;
let opening = 0, loadRequest = 0;

// 检查歌曲是否在指定歌单中
function isInCollection(col) {
  if (!col.songs) return false;
  return col.songs.some(s => s.id === props.songIndex);
}

// 切换歌单选择 (添加或移除)
async function toggleCollection(col) {
  if (busyCollections.value.has(col.id)) return;
  busyCollections.value.add(col.id);

  const inCol = isInCollection(col);
  const songIndex = props.songIndex, requestOpening = opening;
  try {
    const data = await likeToCollection(songIndex, col.id, !inCol);
    // 服务端已保存时刷新歌单页；关闭弹层或换歌不会撤销这次修改。
    if (data.ok) window.dispatchEvent(new Event('wuu-collections-updated'));
    if (data.ok && props.visible && opening === requestOpening && props.songIndex === songIndex) {
      // 更新本地状态 (optimistic)
      if (!col.songs) col.songs = [];
      if (inCol) {
        col.songs = col.songs.filter(s => s.id !== songIndex);
      } else {
        col.songs.push({ id: songIndex });
      }
      // 更新歌曲数
      col.songCount = col.songs.length;
      emit('changed');
    }
  } catch (e) {
    console.warn('[picker] 操作失败:', e.message);
    if (opening === requestOpening && props.visible) loadError.value = e.message || '操作失败，请重试';
  } finally {
    if (opening === requestOpening) busyCollections.value.delete(col.id);
  }
}

async function loadCollections() {
  const request = ++loadRequest;
  loading.value = true;
  loadError.value = '';
  try {
    const data = await fetchCollections();
    if (request === loadRequest && props.visible) collections.value = data.collections || [];
  } catch (e) {
    if (request === loadRequest && props.visible) loadError.value = e.message;
  } finally {
    if (request === loadRequest) loading.value = false;
  }
}

function close() {
  emit('close');
}
function trapFocus(event) {
  if (!props.visible || event.defaultPrevented) return;
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key !== 'Tab') return;
  const items = [...(sheet.value?.querySelectorAll('button:not(:disabled)') || [])];
  // Disabling the focused save button can move native focus to the body.
  // Keep the next Tab inside this dialog even when that happens.
  if (!sheet.value?.contains(document.activeElement) || event.shiftKey && document.activeElement === items[0] || !event.shiftKey && document.activeElement === items.at(-1)) {
    event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus();
  }
}
function prepareOpening() {
  nextTick(() => closeButton.value?.focus());
  loadCollections();
}

onMounted(() => {
  if (props.visible) { opening++; returnFocus = document.activeElement; document.addEventListener('keydown', trapFocus); prepareOpening(); }
});

watch(() => [props.visible, props.songIndex], ([visible], previous) => {
  opening++; loadRequest++; busyCollections.value.clear();
  if (visible) {
    if (!previous?.[0]) returnFocus = document.activeElement;
    document.addEventListener('keydown', trapFocus);
    prepareOpening();
  } else {
    document.removeEventListener('keydown', trapFocus);
    if (previous?.[0]) nextTick(() => { if (returnFocus?.isConnected) returnFocus.focus(); });
  }
});
onBeforeUnmount(() => { opening++; loadRequest++; document.removeEventListener('keydown', trapFocus); if (props.visible && returnFocus?.isConnected) returnFocus.focus(); });
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="picker-mask" @click.self="close">
        <Transition name="slide-up">
          <div ref="sheet" v-if="visible" class="picker-sheet" role="dialog" aria-modal="true" aria-labelledby="collection-picker-title">
            <div class="picker-header">
              <span id="collection-picker-title" class="picker-title">添加到歌单</span>
              <button ref="closeButton" class="close-btn" aria-label="关闭歌单选择" @click="close">
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>

            <div class="picker-body">
              <div v-if="loading" class="status-box">加载中...</div>
              <div v-else-if="loadError" class="status-box error">
                <p>{{ loadError }}</p>
                <button class="retry-btn" @click="loadCollections">重试</button>
              </div>
              <div v-else-if="collections.length === 0" class="status-box">
                <p>暂无歌单</p>
                <p class="hint">在「歌单」页创建后即可在这里选择</p>
              </div>
              <div v-else class="collection-list">
                <button
                  v-for="col in collections"
                  :key="col.id"
                  class="collection-row"
                  :class="{ busy: busyCollections.has(col.id) }"
                  type="button"
                  :aria-pressed="isInCollection(col)"
                  :disabled="busyCollections.has(col.id)"
                  @click="toggleCollection(col)"
                >
                  <div class="check-box" :class="{ checked: isInCollection(col) }">
                    <svg v-if="isInCollection(col)" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  </div>
                  <div class="col-info">
                    <div class="col-name">{{ col.name }}</div>
                    <div class="col-count">{{ col.songCount }} 首</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.picker-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; background: var(--overlay); }
.picker-sheet { width: 100%; max-width: 500px; max-height: min(75dvh, calc(100dvh - 32px)); display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; padding-bottom: env(safe-area-inset-bottom); border: 1px solid var(--border); border-bottom: 0; border-radius: 20px 20px 0 0; background: var(--bg-card-elevated); color: var(--text); box-shadow: var(--shadow); }
.picker-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.picker-title { font-size: 18px; font-weight: 650; color: var(--text); }
.close-btn { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 10px; background: var(--bg-card); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
.close-btn svg { width: 22px; height: 22px; fill: currentColor; }
.picker-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.status-box { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 20px; color: var(--text-secondary); text-align: center; }
.status-box.error { color: var(--danger); }
.hint { font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
.retry-btn { min-height: 44px; padding: 8px 24px; border: 1px solid var(--border); border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-size: 14px; cursor: pointer; }
.collection-list { padding: 8px 12px 16px; }
.collection-row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 72px; padding: 12px 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text); text-align: left; font: inherit; cursor: pointer; transition: background .15s; }
.collection-row:active, .close-btn:active { background: var(--bg-hover); }
.collection-row[aria-pressed="true"] { background: var(--accent-soft); }
.collection-row.busy { opacity: .6; cursor: default; }
.check-box { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border: 1px solid var(--text-secondary); border-radius: 7px; background: var(--bg-card); transition: background .15s, border-color .15s; }
.check-box.checked { background: var(--accent); border-color: var(--accent); }
.check-box svg { width: 18px; height: 18px; fill: var(--on-accent); }
.col-info { flex: 1; min-width: 0; }
.col-name { color: var(--text); font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.col-count { margin-top: 4px; font-size: 13px; color: var(--text-secondary); }
.picker-sheet button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-up-enter-active, .slide-up-leave-active { transition: transform .24s ease; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .fade-enter-active, .fade-leave-active, .slide-up-enter-active, .slide-up-leave-active, .collection-row, .check-box { transition: none; } }
</style>
