<!-- =========== 底部导航栏 (网易云音乐风格) =========== -->
<!-- 标签: 推荐 / 歌单  (预留扩展) -->
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
    <!-- 预留扩展位 -->
    <button class="nav-item disabled" disabled>
      <svg viewBox="0 0 24 24" class="nav-icon">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span class="nav-label">更多</span>
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
.nav-item.disabled {
  opacity: 0.3;
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
