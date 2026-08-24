// =========== Web Audio 音效系统 (yde1) ===========
// 链路: mediaSource → [highpass → 10段EQ → lowShelf → highShelf → 立体声加宽(M/S) → 环绕声像 → 混响dry/wet] → gainNode
// 关闭音效时所有节点透明(highpass 20Hz / 增益 0dB / width 1 / wet 0), 无染色直通
// 预设由参数组合定义, 自定义模式提供 10 段 EQ 滑块, 均持久化到 appSettings.audioFx
//
// 播放栏音效按钮 → 弹窗选择预设 / 调节自定义 EQ / 保存自定义方案

// ---- 效果链节点引用 (buildFxChain 后可用) ----
let fxReady = false;
let fxHP = null;            // highpass (复古唱片削低频 / 人声去闷)
let fxEq = [];              // 10 × peaking EQ
let fxLS = null;            // lowshelf (超低频增益)
let fxHS = null;            // highshelf (高频增益)
let fxSideW = null;         // 立体声加宽 side 增益 (1=原始声场)
let fxPan = null;           // StereoPanner (环绕声像)
let fxLfo = null;           // 环绕摆动 LFO
let fxLfoDepth = null;      // LFO 调制深度 (0=不摆动)
let fxConvolver = null;     // 混响 (现场感)
let fxWet = null;           // 混响湿度 (0=干声直通)

// 10 段 EQ 中心频率 (Hz)
const FX_EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// 预设定义:
//   hp=highpass 截止(Hz)  ls/hs=shelf 增益(dB)  eq=10 段增益(dB)
//   width=立体声宽度(1=原始)  panDepth=声像摆动深度(0-1)  panRate=摆动速率(Hz)  wet=混响湿度(0-1)
const FX_PRESETS = {
  off:      { name: '关闭',       hp: 20,  ls: 0,  hs: 0,   eq: [0,0,0,0,0,0,0,0,0,0],                          width: 1,    panDepth: 0,    panRate: 0.08, wet: 0 },
  bass:     { name: '超重低音',   hp: 20,  ls: 7,  hs: 1,   eq: [5,4,2.5,1,0,0,0,0,1,1.5],                      width: 1,    panDepth: 0,    panRate: 0.08, wet: 0 },
  vocal:    { name: '清澈人声',   hp: 110, ls: -1, hs: 1.5, eq: [0,0,-1,-1.5,0,1.5,3,3,1.5,0.5],                width: 1.1,  panDepth: 0,    panRate: 0.08, wet: 0 },
  surround: { name: '360度环绕',  hp: 20,  ls: 0,  hs: 0,   eq: [0,0,0,0,0,0,0,0,0,0],                          width: 2.2,  panDepth: 0.28, panRate: 0.08, wet: 0.06 },
  d3:       { name: '3D音效',     hp: 20,  ls: 0,  hs: 2,   eq: [0,0,0,0,0,0,0.5,1,1.5,2],                      width: 1.7,  panDepth: 0.12, panRate: 0.05, wet: 0.12 },
  live:     { name: 'HIFI现场',   hp: 20,  ls: 1,  hs: 2,   eq: [0,0.5,1,0,0.5,0.5,0,1,1.5,2],                  width: 1.3,  panDepth: 0,    panRate: 0.08, wet: 0.18 },
  edm:      { name: '动感电音',   hp: 30,  ls: 5,  hs: 3,   eq: [3,2.5,2,0,0,0,0.5,1.5,3,4],                    width: 1.2,  panDepth: 0,    panRate: 0.08, wet: 0.05 },
  rock:     { name: '摇滚音效',   hp: 40,  ls: 3,  hs: 2,   eq: [3,2.5,1.5,-1,-1.5,0,1.5,2.5,2,1.5],            width: 1.15, panDepth: 0,    panRate: 0.08, wet: 0.04 },
  vinyl:    { name: '复古唱片',   hp: 120, ls: 2,  hs: -3,  eq: [1,2,2,1.5,0.5,0,-0.5,-2,-5,-9],                width: 1.08, panDepth: 0,    panRate: 0.08, wet: 0.03 },
};

// 生成混响 impulse response (指数衰减立体声噪声)
function _makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// 构建效果链, 插入 srcNode 与 dstNode 之间 (player-core.initWebAudio 调用)
// 成功后立即应用已保存的预设; 失败时回退直通并不再尝试
function buildFxChain(ctx, srcNode, dstNode) {
  if (fxReady) return true;
  try {
    fxHP = ctx.createBiquadFilter();
    fxHP.type = 'highpass'; fxHP.frequency.value = 20; fxHP.Q.value = 0.7;

    fxEq = FX_EQ_FREQS.map(f => {
      const n = ctx.createBiquadFilter();
      n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.1; n.gain.value = 0;
      return n;
    });

    fxLS = ctx.createBiquadFilter(); fxLS.type = 'lowshelf';  fxLS.frequency.value = 90;    fxLS.gain.value = 0;
    fxHS = ctx.createBiquadFilter(); fxHS.type = 'highshelf'; fxHS.frequency.value = 12000; fxHS.gain.value = 0;

    // 立体声加宽 (M/S): mid=0.5(L+R) 直通, side=width×0.5(L−R), width=1 时输出与输入完全一致
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
    fxSideW = ctx.createGain(); fxSideW.gain.value = 1;
    sideBus.connect(fxSideW);
    fxSideW.connect(merger, 0, 0);
    const sideInv = ctx.createGain(); sideInv.gain.value = -1;
    fxSideW.connect(sideInv); sideInv.connect(merger, 0, 1);

    // 环绕声像 + LFO 摆动 (360度环绕)
    fxPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (fxPan) {
      fxLfo = ctx.createOscillator(); fxLfo.type = 'sine'; fxLfo.frequency.value = 0.08;
      fxLfoDepth = ctx.createGain(); fxLfoDepth.gain.value = 0;
      fxLfo.connect(fxLfoDepth); fxLfoDepth.connect(fxPan.pan);
      try { fxLfo.start(); } catch (e) {}
    }

    // 混响 dry/wet
    fxConvolver = ctx.createConvolver();
    fxConvolver.buffer = _makeImpulse(ctx, 1.9, 2.6);
    fxWet = ctx.createGain(); fxWet.gain.value = 0;
    const dry = ctx.createGain(); dry.gain.value = 1;

    // 串接: src → HP → EQ×10 → LS → HS → splitter ... merger → pan → (dry|convolver→wet) → dst
    srcNode.connect(fxHP);
    let node = fxHP;
    for (const eq of fxEq) { node.connect(eq); node = eq; }
    node.connect(fxLS); fxLS.connect(fxHS); fxHS.connect(splitter);
    let spatialOut = fxPan || merger;
    if (fxPan) merger.connect(fxPan);
    spatialOut.connect(dry); dry.connect(dstNode);
    spatialOut.connect(fxConvolver); fxConvolver.connect(fxWet); fxWet.connect(dstNode);

    fxReady = true;
    // 应用启动时保存的预设 (WebAudio 延迟初始化, 预设先记在设置里)
    const saved = _getFxSettings();
    applyFxPreset(saved.preset || 'off', { silent: true });
    return true;
  } catch (e) {
    console.error('[FX] 效果链构建失败, 回退直通:', e);
    fxReady = false;
    srcNode.connect(dstNode);
    return false;
  }
}

// ---- 设置读写 ----
function _getFxSettings() {
  if (typeof appSettings === 'undefined') return { preset: 'off', eq: FX_EQ_FREQS.map(() => 0), customs: [] };
  if (!appSettings.audioFx || typeof appSettings.audioFx !== 'object') {
    appSettings.audioFx = { preset: 'off', eq: FX_EQ_FREQS.map(() => 0), customs: [] };
  }
  const fx = appSettings.audioFx;
  if (!Array.isArray(fx.eq) || fx.eq.length !== 10) fx.eq = FX_EQ_FREQS.map(() => 0);
  if (!Array.isArray(fx.customs)) fx.customs = [];
  return fx;
}

function _saveFxSettings() {
  if (typeof saveUserData === 'function') saveUserData();
}

// 解析 fx key → 完整参数 (custom / custom:<索引> 用 EQ 数组, 其余用预设)
function _resolveFxConfig(key) {
  const fx = _getFxSettings();
  if (key === 'custom') {
    return { ...FX_PRESETS.off, eq: fx.eq.slice() };
  }
  if (typeof key === 'string' && key.startsWith('custom:')) {
    const c = fx.customs[parseInt(key.slice(7), 10)];
    if (!c || !Array.isArray(c.eq)) return null;
    return { ...FX_PRESETS.off, eq: c.eq.slice() };
  }
  return FX_PRESETS[key] || FX_PRESETS.off;
}

// 参数平滑设置 (避免切换预设时爆音)
function _setAudioParam(param, value) {
  try { param.setTargetAtTime(value, audioCtx.currentTime, 0.03); }
  catch (e) { param.value = value; }
}

// 应用音效预设 (fxReady 前仅记录设置, initWebAudio 后会自动补应用)
function applyFxPreset(key, opts) {
  const conf = _resolveFxConfig(key);
  if (!conf) return;
  const fx = _getFxSettings();
  fx.preset = key;
  if (fxReady) {
    _setAudioParam(fxHP.frequency, conf.hp);
    _setAudioParam(fxLS.gain, conf.ls);
    _setAudioParam(fxHS.gain, conf.hs);
    fxEq.forEach((n, i) => _setAudioParam(n.gain, conf.eq[i] || 0));
    _setAudioParam(fxSideW.gain, conf.width);
    _setAudioParam(fxWet.gain, conf.wet);
    if (fxPan) {
      _setAudioParam(fxLfoDepth.gain, conf.panDepth);
      _setAudioParam(fxLfo.frequency, conf.panRate);
    }
  }
  if (!opts || !opts.silent) _saveFxSettings();
  updFxUI(key);
}

// 自定义 EQ 实时调节 (滑块 input 事件)
function applyFxEqBand(i, db) {
  const fx = _getFxSettings();
  fx.eq[i] = db;
  if (fxReady && fxEq[i]) _setAudioParam(fxEq[i].gain, db);
}

// =========== 音效弹窗 UI ===========
const fxModal = document.getElementById('fx-modal');
const fxPresetGrid = document.getElementById('fx-preset-grid');
const fxEqSection = document.getElementById('fx-eq-section');
const fxEqSliders = document.getElementById('fx-eq-sliders');
const fxEqNameInput = document.getElementById('fx-eq-name');
const btnFx = document.getElementById('btn-fx');

// 渲染预设按钮 (内置预设 + 自定义 + 已保存方案)
function renderFxPresets() {
  if (!fxPresetGrid) return;
  const fx = _getFxSettings();
  fxPresetGrid.innerHTML = '';
  const mkChip = (key, label, deletable) => {
    const chip = document.createElement('button');
    chip.className = 'fx-chip' + (fx.preset === key ? ' active' : '');
    chip.dataset.fx = key;
    const span = document.createElement('span');
    span.textContent = label;
    chip.appendChild(span);
    if (deletable) {
      const del = document.createElement('i');
      del.className = 'fx-chip-del';
      del.title = '删除方案';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(key.slice(7), 10);
        fx.customs.splice(idx, 1);
        // 当前删除的正在使用 → 回到关闭
        if (fx.preset === key) fx.preset = 'off';
        _saveFxSettings();
        renderFxPresets();
        updFxUI(fx.preset);
        renderFxEqSliders();
      });
      chip.appendChild(del);
    }
    chip.addEventListener('click', () => {
      applyFxPreset(key);
      renderFxPresets();
      renderFxEqSliders();
    });
    return chip;
  };
  for (const key of Object.keys(FX_PRESETS)) {
    fxPresetGrid.appendChild(mkChip(key, FX_PRESETS[key].name, false));
  }
  fxPresetGrid.appendChild(mkChip('custom', '自定义', false));
  fx.customs.forEach((c, i) => {
    fxPresetGrid.appendChild(mkChip('custom:' + i, c.name, true));
  });
}

// 渲染 10 段 EQ 滑块 (当前激活的方案决定初始值)
function renderFxEqSliders() {
  if (!fxEqSliders) return;
  const fx = _getFxSettings();
  const conf = _resolveFxConfig(fx.preset) || FX_PRESETS.off;
  const editable = fx.preset === 'custom' || (typeof fx.preset === 'string' && fx.preset.startsWith('custom:'));
  fxEqSliders.innerHTML = '';
  fxEqSection.classList.toggle('readonly', !editable);
  FX_EQ_FREQS.forEach((freq, i) => {
    const cell = document.createElement('div');
    cell.className = 'fx-eq-cell';
    const val = document.createElement('span');
    val.className = 'fx-eq-val';
    const fmtDb = v => (v > 0 ? '+' : '') + v.toFixed(1);
    val.textContent = fmtDb(conf.eq[i] || 0);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = -12; input.max = 12; input.step = 0.5;
    input.value = conf.eq[i] || 0;
    input.setAttribute('orient', 'vertical');
    input.disabled = !editable;
    input.addEventListener('input', () => {
      const db = parseFloat(input.value);
      val.textContent = fmtDb(db);
      // 拖动滑块: 以当前方案为起点切换到自定义模式实时调节
      if (fx.preset !== 'custom') {
        fx.eq = conf.eq.slice();
        fx.eq[i] = db;
        fx.preset = 'custom';
        if (fxReady) {
          // 平滑应用整套自定义参数 (原预设可能带 hp/shelf/宽度等染色, 一并复位)
          applyFxPreset('custom', { silent: true });
        }
        _saveFxSettings();
        renderFxPresets();
        renderFxEqSliders();
        return;
      }
      applyFxEqBand(i, db);
      _saveFxSettings();
    });
    const label = document.createElement('span');
    label.className = 'fx-eq-label';
    label.textContent = freq >= 1000 ? (freq / 1000) + 'k' : String(freq);
    cell.appendChild(val);
    cell.appendChild(input);
    cell.appendChild(label);
    fxEqSliders.appendChild(cell);
  });
}

// 更新播放栏按钮状态 (激活非 off 时高亮)
function updFxUI(key) {
  if (!btnFx) return;
  const active = key && key !== 'off';
  btnFx.classList.toggle('fx-active', active);
  const label = _resolveFxConfig(key);
  btnFx.title = active && label ? '音效: ' + (label.name || '自定义') : '音效';
}

// 弹窗开关
function toggleFxModal(show) {
  if (!fxModal) return;
  const willShow = (show !== undefined) ? show : fxModal.classList.contains('hidden');
  if (willShow) {
    renderFxPresets();
    renderFxEqSliders();
    fxModal.classList.remove('hidden');
  } else {
    fxModal.classList.add('hidden');
  }
}

if (btnFx) {
  btnFx.addEventListener('click', () => toggleFxModal());
}
const fxCloseBtn = document.getElementById('fx-close');
if (fxCloseBtn) fxCloseBtn.addEventListener('click', () => toggleFxModal(false));
// 点击遮罩关闭
if (fxModal) {
  fxModal.addEventListener('click', (e) => { if (e.target === fxModal) toggleFxModal(false); });
}

// 保存自定义方案 (当前 EQ 滑块值 → 命名方案)
const fxEqSaveBtn = document.getElementById('fx-eq-save');
if (fxEqSaveBtn) {
  fxEqSaveBtn.addEventListener('click', () => {
    const fx = _getFxSettings();
    let name = (fxEqNameInput.value || '').trim();
    if (!name) name = '方案' + (fx.customs.length + 1);
    fx.customs.push({ name, eq: fx.eq.slice() });
    fx.preset = 'custom:' + (fx.customs.length - 1);
    _saveFxSettings();
    fxEqNameInput.value = '';
    renderFxPresets();
    renderFxEqSliders();
    updFxUI(fx.preset);
    if (typeof showToast === 'function') showToast(`音效方案「${name}」已保存`, 'success');
  });
}

// 重置自定义 EQ 为全平直
const fxEqResetBtn = document.getElementById('fx-eq-reset');
if (fxEqResetBtn) {
  fxEqResetBtn.addEventListener('click', () => {
    const fx = _getFxSettings();
    fx.eq = FX_EQ_FREQS.map(() => 0);
    if (fx.preset !== 'custom' && !String(fx.preset).startsWith('custom:')) fx.preset = 'custom';
    applyFxPreset(fx.preset);
    renderFxPresets();
    renderFxEqSliders();
  });
}

// 启动时同步按钮状态 (效果链延迟初始化, 参数待 initWebAudio 后应用)
updFxUI(_getFxSettings().preset);
