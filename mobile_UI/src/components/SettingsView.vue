<script setup>
import { computed } from 'vue';
import { useListenTogether } from '../composables/useListenTogether.js';
import { useTheme } from '../composables/useTheme.js';
import { usePlayer } from '../composables/usePlayer.js';
import AudioFxPanel from './AudioFxPanel.vue';
import { useLyricPreferences } from '../composables/useLyricPreferences.js';
import { MIN_LYRIC_SIZE, MAX_LYRIC_SIZE, MAX_CURRENT_LYRIC_SIZE } from '../services/lyricPreferences.js';

const together = useListenTogether();
const { enabled, connected, peerCount } = together;
const { preference, setTheme } = useTheme();
const { playbackRate, setPlaybackRate } = usePlayer();
const { lyricSize, setLyricSize, currentLyricSize, setCurrentLyricSize } = useLyricPreferences();
const statusText = computed(() => !enabled.value ? '各听各的' : !connected.value ? '正在连接电脑…' : together.desktopConnected?.value ? '已连接电脑' : '已连接服务，等待电脑播放器');
const blocked = computed(() => together.autoplayBlocked?.value === true);
</script>

<template>
  <div class="settings-page">
    <div class="page-heading"><h1 class="settings-title">设置</h1><p>按你的习惯，让音乐更舒服。</p></div>
    <section class="settings-group" aria-label="外观设置">
      <h2 class="group-title">外观</h2>
      <label class="setting-row theme-row" for="mobile-theme">
        <span class="setting-info"><span class="setting-name">手机配色</span><span class="setting-desc">自动跟随系统，也可以单独选择</span></span>
        <select id="mobile-theme" aria-label="手机配色" :value="preference" @change="setTheme($event.target.value)">
          <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
        </select>
      </label>
    </section>

    <section class="settings-group" aria-label="播放设置">
      <h2 class="group-title">播放</h2>
      <label class="setting-row theme-row" for="mobile-playback-rate"><span class="setting-info"><span class="setting-name">播放倍速</span><span class="setting-desc">{{ enabled ? '一起听时也会同步到电脑' : '调整速度，保留原来的音高' }}</span></span><select id="mobile-playback-rate" aria-label="播放倍速" :value="playbackRate" @change="setPlaybackRate(Number($event.target.value))"><option v-for="rate in [.5, .75, 1, 1.25, 1.5, 1.75, 2]" :key="rate" :value="rate">{{ rate }}×</option></select></label>
    </section>

    <section class="settings-group" aria-label="一起听设置">
      <h2 class="group-title">一起听</h2>
      <label class="setting-row together-row" for="mobile-together">
        <span class="setting-info"><span class="setting-name">与电脑一起听</span><span class="setting-desc">歌曲、进度和播放控制同步；关闭后独立播放</span></span>
        <span class="switch"><input id="mobile-together" type="checkbox" v-model="enabled" role="switch" aria-label="与电脑一起听" /><span class="slider" aria-hidden="true"></span></span>
      </label>
      <div class="sync-status" role="status"><span class="status-dot" :class="{ on: enabled && connected, disabled: !enabled }" aria-hidden="true"></span><span>{{ statusText }}</span><span v-if="enabled && connected && peerCount > 1" class="peer-count">{{ peerCount }} 台设备</span></div>
      <div v-if="blocked" class="sync-notice"><p>手机尚未加入播放，请点击继续。</p><button class="join-button" @click="together.resumeTogether()">加入播放</button></div>
      <details class="setting-details"><summary>连接说明</summary><p>在电脑的设置 → 网络服务中开启手机访问，用手机打开电脑提供的地址，再开启此选项。首次加入会跟随电脑当前的歌曲和进度。</p><button v-if="enabled && connected" class="secondary-button" @click="together.alignNow()">重新对齐电脑</button></details>
    </section>

    <section class="settings-group" aria-label="歌词设置">
      <h2 class="group-title">歌词</h2>
      <label class="setting-row" for="mobile-current-lyric-size"><span class="setting-info"><span class="setting-name">当前歌词字号</span><span class="setting-desc">下一句开始后，上句恢复普通字号</span></span><output for="mobile-current-lyric-size" class="lyric-size-value">{{ currentLyricSize }} px</output></label>
      <input id="mobile-current-lyric-size" class="lyric-size-range" type="range" aria-label="当前歌词字号" :aria-valuetext="currentLyricSize + ' 像素'" :min="lyricSize" :max="MAX_CURRENT_LYRIC_SIZE" step="1" :value="currentLyricSize" @input="setCurrentLyricSize(Number($event.target.value))" />
      <details class="lyric-advanced setting-details">
        <summary>高级歌词设置</summary>
        <label class="setting-row" for="mobile-lyric-size"><span class="setting-info"><span class="setting-name">普通歌词字号</span><span class="setting-desc">用于当前句以外的歌词</span></span><output for="mobile-lyric-size" class="lyric-size-value">{{ lyricSize }} px</output></label>
        <input id="mobile-lyric-size" class="lyric-size-range" type="range" aria-label="普通歌词字号" :aria-valuetext="lyricSize + ' 像素'" :min="MIN_LYRIC_SIZE" :max="MAX_LYRIC_SIZE" step="1" :value="lyricSize" @input="setLyricSize(Number($event.target.value))" />
      </details>
    </section>
    <details class="audio-settings settings-group"><summary><span>音效</span><span class="summary-hint">均衡器、空间与混响</span></summary><AudioFxPanel /></details>
  </div>
</template>

<style scoped>
.settings-page { flex: 1; min-height: 0; width: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 24px 32px; }
.page-heading { margin-bottom: 24px; }
.settings-title { font-size: 28px; font-weight: 650; letter-spacing: -.6px; color: var(--text); }
.page-heading p { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }
.settings-group { background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; padding: 16px; margin-bottom: 16px; }
.group-title { font-size: 16px; font-weight: 600; color: var(--text); padding-bottom: 8px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.setting-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.setting-name { font-size: 15px; color: var(--text); }
.setting-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
.theme-row { flex-wrap: wrap; }
.theme-row .setting-info { min-width: 140px; }
select { min-height: 48px; max-width: 100%; padding: 8px 12px; border: 1px solid var(--control-border); border-radius: 12px; background: var(--bg-card-elevated); color: var(--text); cursor: pointer; }
.lyric-size-value { color: var(--accent); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lyric-size-range { display: block; width: 100%; height: 44px; margin: 4px 0; padding: 0; border: 0; background: transparent; accent-color: var(--accent); cursor: pointer; }
.setting-details { border-top: 1px solid var(--border); margin-top: 8px; }
.setting-details summary { min-height: 48px; padding: 12px 0; cursor: pointer; color: var(--text-secondary); font-size: 14px; }
.setting-details p { color: var(--text-secondary); font-size: 13px; line-height: 1.7; padding: 0 0 12px; }
.sync-status { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; padding: 4px 0 8px; flex-wrap: wrap; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-secondary); }
.status-dot.on { background: var(--accent); }
.status-dot.disabled { background: var(--border); }
.peer-count { margin-left: auto; }
.switch { position: relative; display: inline-flex; align-items: center; width: 52px; height: 48px; flex-shrink: 0; }
.switch input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; cursor: pointer; z-index: 1; }
.slider { width: 52px; height: 30px; background: var(--control-border); border-radius: 30px; transition: background .2s; }
.slider::before { content: ''; position: absolute; width: 24px; height: 24px; left: 3px; top: 12px; background: var(--switch-thumb); border-radius: 50%; transition: transform .2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(22px); background: var(--on-accent); }
.switch input:focus-visible + .slider { outline: 2px solid var(--accent); outline-offset: 3px; }
.sync-notice { margin-top: 8px; border-radius: 12px; padding: 12px; background: var(--accent-soft); color: var(--text); font-size: 13px; }
.join-button, .secondary-button { min-height: 44px; padding: 8px 16px; border: 0; border-radius: 12px; font-size: 14px; }
.join-button { margin-top: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; }
.secondary-button { background: var(--bg-card-elevated); color: var(--text); }
.audio-settings > summary { min-height: 48px; cursor: pointer; color: var(--text); font-size: 16px; font-weight: 600; padding: 8px 0; }
.summary-hint { display: block; font-size: 13px; color: var(--text-secondary); font-weight: 400; padding-left: 18px; margin-top: 4px; }
.audio-settings :deep(.audio-fx-panel) { margin-bottom: 0; }
@media (max-width: 359px) { .settings-page { padding-inline: 16px; } .settings-group { padding: 14px; } }
</style>
