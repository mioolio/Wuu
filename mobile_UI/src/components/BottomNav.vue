<!-- =========== 底部导航栏 (网易云音乐风格) =========== -->
<!-- 标签: 推荐 / 歌单 / 我的 -->
<script setup>
defineProps({
  active: { type: String, default: 'recommend' },
});
const emit = defineEmits(['switch']);
</script>

<template>
  <nav class="bottom-nav">
    <button
      class="nav-item"
      :class="{ active: active === 'recommend' }"
      @click="emit('switch', 'recommend')"
    >
      <svg viewBox="0 0 24 24" class="nav-icon">
        <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
      </svg>
      <span class="nav-label">推荐</span>
    </button>
    <button
      class="nav-item"
      :class="{ active: active === 'list' }"
      @click="emit('switch', 'list')"
    >
      <svg viewBox="0 0 24 24" class="nav-icon">
        <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z"/>
      </svg>
      <span class="nav-label">歌单</span>
    </button>
    <button
      class="nav-item"
      :class="{ active: active === 'collections' }"
      @click="emit('switch', 'collections')"
    >
      <svg viewBox="0 0 24 24" class="nav-icon">
        <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-7-1h5v-5h-5v5zm-4-5h4V6H9v4z"/>
      </svg>
      <span class="nav-label">我的</span>
    </button>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: flex;
  flex-shrink: 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 20;
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;
}
.nav-item.active {
  color: var(--accent);
}
.nav-icon {
  width: 22px;
  height: 22px;
  fill: currentColor;
}
.nav-label {
  font-size: 11px;
}
</style>
