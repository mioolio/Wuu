<script setup>
defineProps({ active: { type: String, default: 'recommend' } });
const emit = defineEmits(['switch']);
const tabs = [
  { key: 'recommend', label: '播放', path: 'm9 5 11 7-11 7V5Z' },
  { key: 'list', label: '音乐库', path: 'M4 5h16M4 12h16M4 19h10' },
  { key: 'collections', label: '歌单', path: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h4' },
  { key: 'settings', label: '设置', path: 'M4 7h16M4 17h16M8 4v6M16 14v6' },
];
</script>
<template>
  <nav class="bottom-nav" aria-label="主导航">
    <button v-for="tab in tabs" :key="tab.key" class="nav-item" :class="{ active: active === tab.key }" :aria-current="active === tab.key ? 'page' : undefined" @click="emit('switch', tab.key)">
      <span class="nav-icon-wrap"><svg viewBox="0 0 24 24" class="nav-icon" aria-hidden="true"><path :d="tab.path" /></svg></span>
      <span class="nav-label">{{ tab.label }}</span>
    </button>
  </nav>
</template>
<style scoped>
.bottom-nav { display: flex; flex-shrink: 0; background: var(--bg); border-top: 1px solid var(--border); padding: 6px max(12px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); z-index: 20; }
.nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 58px; padding: 4px 0; background: transparent; border: none; border-radius: 12px; color: var(--text-secondary); transition: color .18s, background .18s; }
.nav-icon-wrap { display: flex; align-items: center; justify-content: center; width: 48px; height: 30px; border-radius: 12px; }
.nav-item.active { color: var(--accent); font-weight: 600; }
.nav-item.active .nav-icon-wrap { background: var(--accent-soft); }
.nav-icon { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.nav-label { font-size: 12px; }
@media (hover: hover) { .nav-item:hover { background: var(--bg-hover); } }
@media (min-width: 768px) { .bottom-nav { padding-inline: max(12px, calc((100% - 640px) / 2)); } }
</style>
