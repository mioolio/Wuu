<template>
  <div class="settings-page">
    <h2 class="settings-title">设置</h2>

    <section class="settings-group" aria-label="歌词设置">
      <div class="group-title">歌词</div>
      <label class="setting-row" for="mobile-lyric-size"><span class="setting-info"><span class="setting-name">歌词字号</span><span class="setting-desc">立即应用，在此浏览器中保存</span></span><output for="mobile-lyric-size" class="lyric-size-value">{{ lyricSize }} px</output></label>
      <input id="mobile-lyric-size" class="lyric-size-range" type="range" aria-label="歌词字号" :aria-valuetext="lyricSize + ' 像素'" :min="MIN_LYRIC_SIZE" :max="MAX_LYRIC_SIZE" step="1" :value="lyricSize" @input="setLyricSize(Number($event.target.value))" />
    </section>

    <!-- 一起听 -->
    <div class="settings-group">
      <div class="group-title">一起听</div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">启用一起听</div>
          <div class="setting-desc">与连接本服务的其他设备实时同步播放，双方都能控制；关闭后各听各的</div>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="enabled" />
          <span class="slider"></span>
        </label>
      </div>

      <div class="setting-row status-row">
        <div class="setting-info">
          <div class="setting-name">连接状态</div>
          <div class="setting-desc">
            <span :class="['status-dot', enabled ? (connected ? 'on' : 'off') : 'disabled']"></span>
            {{ statusText }}
          </div>
        </div>
      </div>

      <div class="setting-row" v-if="enabled && connected">
        <div class="setting-info">
          <div class="setting-name">当前房间</div>
          <div class="setting-desc">{{ peerCount }} 台设备在线（含本机）</div>
        </div>
      </div>

      <div class="setting-row tip-row">
        <div class="setting-desc tip">
          默认关闭。开启后会立即与房间内最先加入的设备对齐歌曲和进度。
          开启期间任意一方播放、暂停、切歌、拖动进度，另一端都会毫秒级跟随，点赞状态也会同步；
          歌曲自然播完由先加入的一端负责切歌，另一端跟随；两端歌曲不一致时会自动切回同一首；
          任意一端退出时，另一端自动暂停。关闭后各听各的。
        </div>
      </div>
    </div>

    <!-- 音效 (桌面端 audio-fx 完整移植) -->
    <AudioFxPanel />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useListenTogether } from '../composables/useListenTogether.js';
import AudioFxPanel from './AudioFxPanel.vue';
import { useLyricPreferences } from '../composables/useLyricPreferences.js';
import { MIN_LYRIC_SIZE, MAX_LYRIC_SIZE } from '../services/lyricPreferences.js';

const { enabled, connected, peerCount } = useListenTogether();
const { lyricSize, setLyricSize } = useLyricPreferences();

const statusText = computed(() => {
  if (!enabled.value) return '未启用';
  if (connected.value) return '已连接';
  return '连接中…（请确认电脑端服务已开启）';
});
</script>

<style scoped>
.settings-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 20px 16px 100px;
  max-width: 560px;
  margin: 0 auto;
}

.settings-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 16px;
  color: #fff;
}

.settings-group {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 8px 16px;
  margin-bottom: 16px;
}

.group-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  padding: 10px 0 4px;
  letter-spacing: 1px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.setting-row:last-child { border-bottom: none; }
.lyric-size-value { color: var(--text-secondary); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lyric-size-range { display: block; width: 100%; height: 44px; margin: 4px 0; padding: 0; border: 0; background: transparent; accent-color: var(--accent); cursor: pointer; }
.lyric-size-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

.setting-info { flex: 1; min-width: 0; }
.setting-name { font-size: 15px; color: #fff; margin-bottom: 3px; }
.setting-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 状态指示点 */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.status-dot.on { background: #52c41a; box-shadow: 0 0 6px rgba(82, 196, 26, 0.6); }
.status-dot.off { background: #faad14; }
.status-dot.disabled { background: rgba(255, 255, 255, 0.25); }

/* 提示块 */
.tip-row .tip { color: rgba(255, 255, 255, 0.4); }

/* 开关 (与桌面端风格一致的滑动开关) */
.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
}
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 26px;
  transition: background 0.25s;
}
.slider::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s;
}
.switch input:checked + .slider { background: #ff4d4f; }
.switch input:checked + .slider::before { transform: translateX(22px); }
</style>
