<template>
  <div class="settings-group">
    <div class="group-title">音效</div>

    <!-- 预设选择: 内置 + 自定义 + 桌面端保存的方案 -->
    <div class="fx-chips">
      <button
        v-for="(p, key) in FX_PRESETS"
        :key="key"
        class="fx-chip"
        :class="{ active: activePreset === key }"
        @click="applyPreset(key)"
      >{{ p.name }}</button>
      <button
        class="fx-chip"
        :class="{ active: activePreset === 'custom' }"
        @click="applyPreset('custom')"
      >自定义</button>
      <button
        v-for="(c, i) in desktopCustoms"
        :key="'dc' + i"
        class="fx-chip"
        :class="{ active: activePreset === 'custom:' + i }"
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
            :value="custom.eqFreqs[selectedBand]"
            @input="onFreqInput($event)" />
          <span class="fx-slider-val">{{ fmtHz(custom.eqFreqs[selectedBand]) }}</span>
        </div>
        <div class="fx-sub-title">Q 值 (越大越窄)</div>
        <div class="fx-slider-row">
          <input type="range" min="0.1" max="6" step="0.05"
            :value="custom.eqQs[selectedBand]"
            @input="onQInput($event)" />
          <span class="fx-slider-val">{{ custom.eqQs[selectedBand].toFixed(2) }}</span>
        </div>
      </div>

      <!-- 效果参数 (可折叠) -->
      <div class="fx-sub">
        <button class="fx-collapse" @click="showParams = !showParams">
          <span class="fx-sub-title">效果参数</span>
          <span class="fx-collapse-arrow" :class="{ open: showParams }">›</span>
        </button>
        <template v-if="showParams">
          <div v-for="def in PARAM_DEFS" :key="def.key" class="fx-slider-row">
            <input type="range"
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
.fx-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 0;
}
.fx-chip {
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.fx-chip.active {
  color: #ff4d4f;
  border-color: #ff4d4f;
  background: rgba(255, 77, 79, 0.12);
}

/* EQ 10 段竖直滑块 */
.fx-eq {
  display: flex;
  justify-content: space-between;
  gap: 2px;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  margin-bottom: 10px;
}
.fx-eq-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.fx-eq-cell.selected .fx-eq-label { color: #ff4d4f; font-weight: 600; }
.fx-eq-val {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  height: 12px;
  line-height: 12px;
}
.fx-eq-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.4);
  height: 12px;
  line-height: 12px;
}
.fx-eq-cell input[type="range"] {
  -webkit-appearance: slider-vertical;
  width: 20px;
  height: 88px;
  cursor: pointer;
}

/* 子区块 */
.fx-sub {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  margin-bottom: 10px;
}
.fx-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin: 6px 0;
}
.fx-collapse {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.fx-collapse .fx-sub-title { margin: 0; }
.fx-collapse-arrow {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.4);
  transform: rotate(90deg);
  transition: transform 0.2s;
}
.fx-collapse-arrow.open { transform: rotate(-90deg); }

/* 横向滑块行 */
.fx-slider-row {
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.fx-slider-row input[type="range"] {
  width: 100%;
  accent-color: #ff4d4f;
}
.fx-slider-label { font-size: 10px; color: rgba(255, 255, 255, 0.5); }
.fx-slider-val {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: right;
}

.tip { padding: 6px 0 10px; }
</style>
