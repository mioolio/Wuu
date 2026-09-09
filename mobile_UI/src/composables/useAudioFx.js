// ===== 移动端 Web Audio 音效系统 (桌面端 audio-fx.js 完整移植) =====
// 链路: mediaSource → [highpass → 10段EQ → lowShelf → highShelf → 立体声加宽(M/S) → 环绕声像 → 混响dry/wet] → destination
// 关闭音效时所有节点透明, 无染色直通
//
// 与桌面端的差异:
//   - 自定义方案数据存 localStorage (移动端不做多方案保存, 直接选用桌面端命名保存的方案)
//   - 混响 IR 缩短到 1.2s (移动端 CPU 优化)
//   - 预设参数与桌面端 FX_PRESETS 保持一致, 保证两端听感统一
import { ref } from 'vue';

// 10 段 EQ 默认中心频率 (Hz) 与 Q 值
const FX_EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FX_EQ_Q_DEFAULT = 1.1;
const FX_PARAMS_DEFAULT = { hp: 20, ls: 0, hs: 0, width: 1, panDepth: 0, panRate: 0.08, wet: 0 };

// 预设定义 (与桌面端 audio-fx.js 一致)
const FX_PRESETS = {
  off:      { name: '关闭',       hp: 20,  ls: 0,  hs: 0,   eq: [0,0,0,0,0,0,0,0,0,0],       width: 1,    panDepth: 0,    panRate: 0.08, wet: 0 },
  bass:     { name: '超重低音',   hp: 20,  ls: 7,  hs: 1,   eq: [4.5,4,2.5,-1.5,0,0,0,0,1,1.5], width: 1,  panDepth: 0,    panRate: 0.08, wet: 0 },
  vocal:    { name: '清澈人声',   hp: 120, ls: -1, hs: 1.5, eq: [0,0,-1,-1.5,0,1.5,3,3,1.5,0.5], width: 1.1, panDepth: 0,  panRate: 0.08, wet: 0 },
  surround: { name: '360度环绕',  hp: 20,  ls: 0,  hs: 0,   eq: [0,0,0,0,0,0,0,0,0,0],       width: 2.0,  panDepth: 0.28, panRate: 0.08, wet: 0.08 },
  d3:       { name: '3D音效',     hp: 20,  ls: 0,  hs: 2,   eq: [0,0,0,0,0,0,0.5,1,1.5,2],   width: 1.7,  panDepth: 0.12, panRate: 0.05, wet: 0.12 },
  live:     { name: 'HIFI现场',   hp: 20,  ls: 1,  hs: 2,   eq: [0,0.5,1,0,0.5,0.5,0,1,1.5,2], width: 1.3,  panDepth: 0,    panRate: 0.08, wet: 0.18 },
  edm:      { name: '动感电音',   hp: 30,  ls: 5,  hs: 3,   eq: [3,2.5,2,0,0,0,0.5,1.5,3,4], width: 1.2,  panDepth: 0,    panRate: 0.08, wet: 0.05 },
  rock:     { name: '摇滚音效',   hp: 40,  ls: 3,  hs: 2,   eq: [3,2.5,1.5,-1,-1.5,0,1.5,2.5,2,1.5], width: 1.15, panDepth: 0, panRate: 0.08, wet: 0.04 },
  vinyl:    { name: '复古唱片',   hp: 120, ls: 2,  hs: -3,  eq: [1,2,2,1.5,0.5,0,-0.5,-2,-4.5,-8], width: 1.08, panDepth: 0, panRate: 0.08, wet: 0.03 },
};

// ===== 响应式状态 =====
const activePreset = ref('off');          // 当前预设 key (off/bass/.../custom/custom:<i>)
const fxReady = ref(false);              // 效果链是否已构建
const desktopCustoms = ref([]);           // 桌面端保存的自定义方案 (跨端同步只读)

// 移动端自定义状态 (localStorage 持久化; 预设选择各端独立, 音效数据不同步)
let mobileFx = null;
function _getMobileFx() {
  if (mobileFx) return mobileFx;
  try {
    const raw = localStorage.getItem('audio-fx-custom');
    mobileFx = raw ? JSON.parse(raw) : null;
  } catch (e) { mobileFx = null; }
  if (!mobileFx || typeof mobileFx !== 'object') {
    mobileFx = {
      eq: FX_EQ_FREQS.map(() => 0),
      eqFreqs: FX_EQ_FREQS.slice(),
      eqQs: FX_EQ_FREQS.map(() => FX_EQ_Q_DEFAULT),
      params: { ...FX_PARAMS_DEFAULT },
    };
  }
  // 结构兜底
  if (!Array.isArray(mobileFx.eq) || mobileFx.eq.length !== 10) mobileFx.eq = FX_EQ_FREQS.map(() => 0);
  if (!Array.isArray(mobileFx.eqFreqs) || mobileFx.eqFreqs.length !== 10) mobileFx.eqFreqs = FX_EQ_FREQS.slice();
  if (!Array.isArray(mobileFx.eqQs) || mobileFx.eqQs.length !== 10) mobileFx.eqQs = FX_EQ_FREQS.map(() => FX_EQ_Q_DEFAULT);
  if (!mobileFx.params || typeof mobileFx.params !== 'object') mobileFx.params = { ...FX_PARAMS_DEFAULT };
  return mobileFx;
}

function _saveMobileFx() {
  try { localStorage.setItem('audio-fx-custom', JSON.stringify(_getMobileFx())); } catch (e) { /* 忽略 */ }
}

// ===== 效果链节点 =====
let ctx = null;
let nHP = null, nEq = [], nLS = null, nHS = null, nSideW = null;
let nPan = null, nLfo = null, nLfoDepth = null, nConv = null, nWet = null;
let attachedEl = null;

// 生成混响 impulse response (移动端 1.2s, 比桌面端短省 CPU)
function _makeImpulse(context, seconds, decay) {
  const rate = context.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = context.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// 挂载音频元素并构建效果链 (App 初始化 audioEl 后调用一次)
function attachAudioFx(audioEl) {
  if (!audioEl || fxReady.value || attachedEl === audioEl) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    const src = ctx.createMediaElementSource(audioEl);
    attachedEl = audioEl;
    // 音频播放时激活 AudioContext (iOS/安卓需用户手势, play 事件在手势上下文内)
    audioEl.addEventListener('play', resumeCtx);
    audioEl.addEventListener('playing', resumeCtx);

    nHP = ctx.createBiquadFilter();
    nHP.type = 'highpass'; nHP.frequency.value = 20; nHP.Q.value = 0.7;

    nEq = FX_EQ_FREQS.map(f => {
      const n = ctx.createBiquadFilter();
      n.type = 'peaking'; n.frequency.value = f; n.Q.value = FX_EQ_Q_DEFAULT; n.gain.value = 0;
      return n;
    });

    nLS = ctx.createBiquadFilter(); nLS.type = 'lowshelf';  nLS.frequency.value = 90;    nLS.gain.value = 0;
    nHS = ctx.createBiquadFilter(); nHS.type = 'highshelf'; nHS.frequency.value = 12000; nHS.gain.value = 0;

    // 立体声加宽 (M/S)
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const lHalf = ctx.createGain(); lHalf.gain.value = 0.5;
    const rHalf = ctx.createGain(); rHalf.gain.value = 0.5;
    splitter.connect(lHalf, 0); splitter.connect(rHalf, 1);
    const midBus = ctx.createGain();
    lHalf.connect(midBus); rHalf.connect(midBus);
    midBus.connect(merger, 0, 0); midBus.connect(merger, 0, 1);
    const sNeg = ctx.createGain(); sNeg.gain.value = -0.5;
    rHalf.connect(sNeg);
    const sideBus = ctx.createGain();
    lHalf.connect(sideBus); sNeg.connect(sideBus);
    nSideW = ctx.createGain(); nSideW.gain.value = 1;
    sideBus.connect(nSideW);
    nSideW.connect(merger, 0, 0);
    const sideInv = ctx.createGain(); sideInv.gain.value = -1;
    nSideW.connect(sideInv); sideInv.connect(merger, 0, 1);

    // 环绕声像 + LFO
    nPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (nPan) {
      nLfo = ctx.createOscillator(); nLfo.type = 'sine'; nLfo.frequency.value = 0.08;
      nLfoDepth = ctx.createGain(); nLfoDepth.gain.value = 0;
      nLfo.connect(nLfoDepth); nLfoDepth.connect(nPan.pan);
      try { nLfo.start(); } catch (e) { /* 忽略 */ }
    }

    // 混响 dry/wet
    nConv = ctx.createConvolver();
    nConv.buffer = _makeImpulse(ctx, 1.2, 2.6);
    nWet = ctx.createGain(); nWet.gain.value = 0;
    const dry = ctx.createGain(); dry.gain.value = 1;

    // 串接
    src.connect(nHP);
    let node = nHP;
    for (const eq of nEq) { node.connect(eq); node = eq; }
    node.connect(nLS); nLS.connect(nHS); nHS.connect(splitter);
    let spatialOut = nPan || merger;
    if (nPan) merger.connect(nPan);
    spatialOut.connect(dry); dry.connect(ctx.destination);
    spatialOut.connect(nConv); nConv.connect(nWet); nWet.connect(ctx.destination);

    fxReady.value = true;
    // 应用启动时保存的预设
    applyPreset(activePreset.value, { silent: true });
  } catch (e) {
    console.warn('[AudioFx] 效果链构建失败, 直通播放:', e);
    fxReady.value = false;
  }
}

// iOS/部分浏览器: AudioContext 需用户手势激活, 播放时确保 resume
function resumeCtx() {
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// 参数平滑设置 (防爆音)
function _set(param, value) {
  try { param.setTargetAtTime(value, ctx.currentTime, 0.03); }
  catch (e) { param.value = value; }
}

// 解析 preset key → 完整参数
function _resolve(key) {
  if (key === 'custom') {
    const m = _getMobileFx();
    return { ...FX_PRESETS.off, eq: m.eq.slice(), eqFreqs: m.eqFreqs.slice(), eqQs: m.eqQs.slice(), ...m.params };
  }
  if (typeof key === 'string' && key.startsWith('custom:')) {
    const c = desktopCustoms.value[parseInt(key.slice(7), 10)];
    if (!c || !Array.isArray(c.eq)) return null;
    return {
      ...FX_PRESETS.off,
      eq: c.eq.slice(),
      eqFreqs: Array.isArray(c.eqFreqs) && c.eqFreqs.length === 10 ? c.eqFreqs.slice() : FX_EQ_FREQS.slice(),
      eqQs: Array.isArray(c.eqQs) && c.eqQs.length === 10 ? c.eqQs.slice() : FX_EQ_FREQS.map(() => FX_EQ_Q_DEFAULT),
      ...(c.params || {}),
    };
  }
  return FX_PRESETS[key] || FX_PRESETS.off;
}

// 应用预设
function applyPreset(key, opts) {
  const conf = _resolve(key);
  if (!conf) return;
  activePreset.value = key;
  if (!opts || !opts.silent) {
    try { localStorage.setItem('audio-fx-preset', key); } catch (e) { /* 忽略 */ }
  }
  if (!fxReady.value) return;
  resumeCtx();
  _set(nHP.frequency, conf.hp);
  _set(nLS.gain, conf.ls);
  _set(nHS.gain, conf.hs);
  nEq.forEach((n, i) => {
    _set(n.gain, conf.eq[i] || 0);
    _set(n.frequency, conf.eqFreqs ? conf.eqFreqs[i] : FX_EQ_FREQS[i]);
    _set(n.Q, conf.eqQs ? conf.eqQs[i] : FX_EQ_Q_DEFAULT);
  });
  _set(nSideW.gain, conf.width);
  _set(nWet.gain, conf.wet);
  if (nPan) {
    _set(nLfoDepth.gain, conf.panDepth);
    _set(nLfo.frequency, conf.panRate);
  }
}

// 自定义 EQ 调节 (滑块 input 实时调用)
function setEqBand(i, db) {
  _getMobileFx().eq[i] = db;
  if (fxReady.value && nEq[i]) _set(nEq[i].gain, db);
  _saveMobileFx();
}
function setEqFreq(i, hz) {
  _getMobileFx().eqFreqs[i] = hz;
  if (fxReady.value && nEq[i]) _set(nEq[i].frequency, hz);
  _saveMobileFx();
}
function setEqQ(i, q) {
  _getMobileFx().eqQs[i] = q;
  if (fxReady.value && nEq[i]) _set(nEq[i].Q, q);
  _saveMobileFx();
}
// 效果参数调节 (key: hp/ls/hs/width/panDepth/panRate/wet)
function setParam(key, value) {
  _getMobileFx().params[key] = value;
  if (!fxReady.value) return;
  switch (key) {
    case 'hp': _set(nHP.frequency, value); break;
    case 'ls': _set(nLS.gain, value); break;
    case 'hs': _set(nHS.gain, value); break;
    case 'width': _set(nSideW.gain, value); break;
    case 'wet': _set(nWet.gain, value); break;
    case 'panDepth': if (nPan) _set(nLfoDepth.gain, value); break;
    case 'panRate': if (nPan) _set(nLfo.frequency, value); break;
  }
  _saveMobileFx();
}
// 当前自定义数据 (UI 初始化用)
function getCustom() { return _getMobileFx(); }

// 加载桌面端命名方案 (预设跨端同步: 桌面端保存 → 移动端选用)
async function loadDesktopCustoms() {
  try {
    const resp = await fetch('/api/audio-fx-presets');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.ok && Array.isArray(data.customs)) {
      desktopCustoms.value = data.customs;
      // 当前选中的方案索引失效 (桌面端删除) → 回退关闭
      if (typeof activePreset.value === 'string' && activePreset.value.startsWith('custom:')) {
        const idx = parseInt(activePreset.value.slice(7), 10);
        if (!desktopCustoms.value[idx]) applyPreset('off');
      }
    }
  } catch (e) { /* 服务未开启时静默 */ }
}

// 启动时恢复预设选择
try {
  const saved = localStorage.getItem('audio-fx-preset');
  if (saved && (FX_PRESETS[saved] || saved === 'custom' || saved.startsWith('custom:'))) {
    activePreset.value = saved;
  }
} catch (e) { /* 忽略 */ }

export function useAudioFx() {
  return {
    // 状态
    activePreset,
    fxReady,
    desktopCustoms,
    FX_PRESETS,
    // 初始化
    attachAudioFx,
    resumeCtx,
    loadDesktopCustoms,
    // 控制
    applyPreset,
    // 自定义调节
    getCustom,
    setEqBand,
    setEqFreq,
    setEqQ,
    setParam,
  };
}
