<!-- =========== 歌单选择器 (点击红心后弹出) =========== -->
<!-- 展示所有歌单, 用户可勾选/取消指定歌单 -->
<script setup>
import { ref, onMounted, watch } from 'vue';
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
  try {
    const data = await likeToCollection(props.songIndex, col.id, !inCol);
    if (data.ok) {
      // 更新本地状态 (optimistic)
      if (!col.songs) col.songs = [];
      if (inCol) {
        col.songs = col.songs.filter(s => s.id !== props.songIndex);
      } else {
        col.songs.push({ id: props.songIndex });
      }
      // 更新歌曲数
      col.songCount = col.songs.length;
      emit('changed');
    }
  } catch (e) {
    console.warn('[picker] 操作失败:', e.message);
  } finally {
    busyCollections.value.delete(col.id);
  }
}

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

function close() {
  emit('close');
}

onMounted(() => {
  if (props.visible) loadCollections();
});

watch(() => props.visible, (v) => {
  if (v) loadCollections();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="picker-mask" @click.self="close">
        <Transition name="slide-up">
          <div v-if="visible" class="picker-sheet">
            <div class="picker-header">
              <span class="picker-title">添加到歌单</span>
              <button class="close-btn" @click="close">
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
                <p class="hint">在电脑端创建歌单后即可在此查看</p>
              </div>
              <div v-else class="collection-list">
                <div
                  v-for="col in collections"
                  :key="col.id"
                  class="collection-row"
                  :class="{ busy: busyCollections.has(col.id) }"
                  @click="toggleCollection(col)"
                >
                  <div class="check-box" :class="{ checked: isInCollection(col) }">
                    <svg v-if="isInCollection(col)" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  </div>
                  <div class="col-info">
                    <div class="col-name">{{ col.name }}</div>
                    <div class="col-count">{{ col.songCount }} 首</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.picker-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.picker-sheet {
  width: 100%;
  max-width: 500px;
  max-height: 70vh;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.picker-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
}
.close-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}
.picker-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.status-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  gap: 12px;
}
.status-box.error {
  color: #ff6b6b;
}
.hint {
  font-size: 13px;
  opacity: 0.6;
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
.collection-list {
  padding: 4px 0;
}
.collection-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.collection-row:active {
  background: var(--bg-hover);
}
.collection-row.busy {
  opacity: 0.6;
  pointer-events: none;
}
.check-box {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 2px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.check-box.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.check-box svg {
  width: 16px;
  height: 16px;
  fill: #fff;
}
.col-info {
  flex: 1;
  min-width: 0;
}
.col-name {
  font-size: 15px;
  color: var(--text);
  font-weight: 500;
}
.col-count {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* 动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.slide-up-enter-active, .slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from, .slide-up-leave-to {
  transform: translateY(100%);
}
</style>
