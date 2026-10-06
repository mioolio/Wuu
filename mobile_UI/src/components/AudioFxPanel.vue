<template>
  <div class="settings-group audio-fx-panel">
    <h3 class="group-title">预设</h3>

    <!-- 预设选择: 内置 + 自定义 + 桌面端保存的方案 -->
    <div class="fx-chips">
      <button
        v-for="(p, key) in FX_PRESETS"
        :key="key"
        class="fx-chip"
        :class="{ active: activePreset === key }"
        :aria-pressed="activePreset === key"
        @click="applyPreset(key)"
      >{{ p.name }}</button>
      <button
        class="fx-chip"
        :class="{ active: activePreset === 'custom' }"
        :aria-pressed="activePreset === 'custom'"
        @click="applyPreset('custom')"
      >自定义</button>
      <button
        v-for="(c, i) in desktopCustoms"
        :key="'dc' + i"
        class="fx-chip"
        :class="{ active: activePreset === 'custom:' + i }"
        :aria-pressed="activePreset === 'custom:' + i"
        @click="applyPreset('custom:' + i)"
      >{{ c.name }}</button>
    </div>

    <!-- 仅自定义模式显示编辑区 -->
    <template v-if="isCustomMode">
      <!-- EQ 10 段竖直滑块 -->
      <div class="fx-eq">
        <div
          v-for="(f, i) in custom.eqFreqs"
          :key="i"
          class="fx-eq-cell"
          :class="{ selected: selectedBand === i }"
          @click="selectedBand = i"
        >
          <span class="fx-eq-val">{{ fmtDb(custom.eq[i]) }}</span>
          <input
            type="range"
            orient="vertical"
            min="-12" max="12" step="0.5"
            :value="custom.eq[i]"
            :aria-label="fmtHz(f) + ' 频段增益'"
            :aria-valuetext="fmtDb(custom.eq[i]) + ' dB'"
            @focus="selectedBand = i"
            @input="onEqInput(i, $event)"
          />
          <span class="fx-eq-label">{{ fmtHz(f) }}</span>
        </div>
      </div>

      <!-- 选中频段: 中心频率 + Q 值 -->
      <div class="fx-sub">
        <div class="fx-sub-title">频段 {{ selectedBand + 1 }} · 中心频率</div>
        <div class="fx-slider-row">
          <input type="range" min="20" max="20000" step="1"
            aria-label="选中频段中心频率"
            :value="custom.eqFreqs[selectedBand]"
            @input="onFreqInput($event)" />
          <span class="fx-slider-val">{{ fmtHz(custom.eqFreqs[selectedBand]) }}</span>
        </div>
        <div class="fx-sub-title">Q 值 (越大越窄)</div>
        <div class="fx-slider-row">
          <input type="range" min="0.1" max="6" step="0.05"
            aria-label="选中频段 Q 值"
            :value="custom.eqQs[selectedBand]"
            @input="onQInput($event)" />
          <span class="fx-slider-val">{{ custom.eqQs[selectedBand].toFixed(2) }}</span>
        </div>
      </div>

      <!-- 效果参数 (可折叠) -->
      <div class="fx-sub">
        <button class="fx-collapse" :aria-expanded="showParams" @click="showParams = !showParams">
          <span class="fx-sub-title">效果参数</span>
          <span class="fx-collapse-arrow" :class="{ open: showParams }">›</span>
        </button>
        <template v-if="showParams">
          <div v-for="def in PARAM_DEFS" :key="def.key" class="fx-slider-row">
            <input type="range"
              :aria-label="def.name"
              :min="def.min" :max="def.max" :step="def.step"
              :value="custom.params[def.key]"
              @input="onParamInput(def.key, $event)" />
            <span class="fx-slider-label">{{ def.name }}</span>
            <span class="fx-slider-val">{{ def.fmt(custom.params[def.key]) }}</span>
          </div>
        </template>
      </div>
    </template>

    <div class="setting-desc tip">预设选择仅对本机生效；桌面端保存的方案可在此直接选用</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAudioFx } from '../composables/useAudioFx.js';

const { activePreset, desktopCustoms, FX_PRESETS, applyPreset, getCustom, setEqBand, setEqFreq, setEqQ, setParam, loadDesktopCustoms } = useAudioFx();

const custom = getCustom();
const selectedBand = ref(0);
const showParams = ref(false);

const isCustomMode = computed(() => activePreset.value === 'custom');

const PARAM_DEFS = [
  { key: 'hp',       name: '低频截止', min: 20,   max: 400,  step: 1,    fmt: v => Math.round(v) + 'Hz' },
  { key: 'ls',       name: '低架增益', min: -12,  max: 12,   step: 0.5,  fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + 'dB' },
  { key: 'hs',       name: '高架增益', min: -12,  max: 12,   step: 0.5,  fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + 'dB' },
  { key: 'width',    name: '空间宽度', min: 1,    max: 3,    step: 0.05, fmt: v => v.toFixed(2) + 'x' },
  { key: 'panDepth', name: '声像深度', min: 0,    max: 0.6,  step: 0.01, fmt: v => Math.round(v * 100) + '%' },
  { key: 'panRate',  name: '声像速率', min: 0.02, max: 0.5,  step: 0.01, fmt: v => v.toFixed(2) + 'Hz' },
  { key: 'wet',      name: '混响湿度', min: 0,    max: 0.5,  step: 0.01, fmt: v => Math.round(v * 200) + '%' },
];

const fmtDb = v => (v > 0 ? '+' : '') + (v || 0).toFixed(1);
const fmtHz = v => v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v));

function onEqInput(i, ev) {
  custom.eq[i] = parseFloat(ev.target.value);
  setEqBand(i, custom.eq[i]);
}
function onFreqInput(ev) {
  custom.eqFreqs[selectedBand.value] = parseFloat(ev.target.value);
  setEqFreq(selectedBand.value, custom.eqFreqs[selectedBand.value]);
}
function onQInput(ev) {
  custom.eqQs[selectedBand.value] = parseFloat(ev.target.value);
  setEqQ(selectedBand.value, custom.eqQs[selectedBand.value]);
}
function onParamInput(key, ev) {
  custom.params[key] = parseFloat(ev.target.value);
  setParam(key, custom.params[key]);
}

onMounted(() => {
  loadDesktopCustoms();
});
</script>

<style scoped>
.settings-group { min-width: 0; }
.audio-fx-panel.settings-group { padding: 0; margin: 0; border: 0; border-radius: 0; background: transparent; }
.group-title { color: var(--text); font-size: 14px; font-weight: 600; }
.fx-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0; }
.fx-chip { min-height: 44px; min-width: 44px; padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; color: var(--text-secondary); font-size: 14px; cursor: pointer; transition: background .15s, border-color .15s; }
.fx-chip.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.fx-chip:active { background: var(--bg-hover); }
.fx-eq { display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap: 16px 8px; padding: 12px 8px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
.fx-eq-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; cursor: pointer; }
.fx-eq-val, .fx-eq-label { color: var(--text-secondary); font-size: 12px; line-height: 1.4; font-variant-numeric: tabular-nums; }
.fx-eq-cell.selected .fx-eq-label { color: var(--accent); font-weight: 650; }
.fx-eq-cell input[type="range"] { -webkit-appearance: slider-vertical; width: 44px; height: 88px; accent-color: var(--accent); cursor: pointer; }
.fx-sub { padding: 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
.fx-sub-title { margin: 8px 0 0; color: var(--text); font-size: 14px; font-weight: 600; }
.fx-collapse { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.fx-collapse .fx-sub-title { margin: 0; }
.fx-collapse-arrow { font-size: 22px; color: var(--text-secondary); transform: rotate(90deg); transition: transform .18s; }
.fx-collapse-arrow.open { transform: rotate(-90deg); }
.fx-slider-row { display: grid; grid-template-columns: minmax(0, 1fr) 64px; align-items: center; column-gap: 8px; margin: 8px 0; }
.fx-slider-row input[type="range"] { width: 100%; min-width: 0; min-height: 44px; margin: 0; accent-color: var(--accent); }
.fx-slider-label { grid-column: 1 / -1; order: -1; color: var(--text); font-size: 13px; }
.fx-slider-val { color: var(--text-secondary); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.tip { padding: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 340px) { .fx-eq { padding-inline: 4px; column-gap: 4px; } .fx-sub { padding: 10px; } }
@media (prefers-reduced-motion: reduce) { .fx-chip, .fx-collapse-arrow { transition: none; } }
</style>
