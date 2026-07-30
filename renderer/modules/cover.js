// =========== 封面主色调 → 动态背景 + 进度条强调色 ===========
// 1. 提取封面主色 → 设置 --cover-accent (供进度条/强调元素使用, 任何模式都设置)
// 2. 生成渐变 → 设置 --cover-gradient (仅播放器视图/试听模式/开启"跟随配色"时应用)
let _lastAppliedCoverPath = null;  // 记录上次应用渐变的封面路径, 避免切视图时重复 fade
let _lastAppliedGradient = null;   // 记录上次生成的渐变字符串

// 判断当前是否应该应用渐变背景
// 播放器视图 / 试听模式(复用主播放器UI但 currentMode 仍是 qishui/kugou 等) / 跟随封面开关
// 试听模式下 UI 已切换到主播放器, 用户期望看到封面色背景, 因此必须纳入判断
function shouldApplyGradientNow() {
  return (currentMode === 'player')
    || (typeof fmPreviewMode !== 'undefined' && fmPreviewMode)
    || appSettings.themeFollowCover;
}

// 统一封面设置入口
// 调用点: player-core.js play() / free-music player.js playFmPreview() /
//         free-music save.js updateFmPreviewUI() / kugou/qishui preview.js
// 逻辑 (封面统一性):
//   - 非试听模式 (主页播放): 始终正常设置, 不受 coverUnify 影响
//   - 试听模式 + coverUnify=false: 正常设置
//   - 试听模式 + coverUnify=true + suppress=false (切歌): 正常更新封面
//   - 试听模式 + coverUnify=true + suppress=true (换源): 跳过封面更新, 保留原封面
// src: 有封面时传 URL 字符串; 无封面时传 null/空字符串
// suppress: true=换源场景(跳过更新), false/undefined=切歌或主页播放(正常更新)
function setCoverImage(src, suppress) {
  // 封面统一性: 试听模式下换源时不更新封面
  if (suppress && typeof fmPreviewMode !== 'undefined' && fmPreviewMode && appSettings.coverUnify !== false) {
    return;
  }
  if (src) {
    coverImg.src = src;
    coverImg.style.display = '';
    coverPH.classList.add('hidden');
  } else {
    coverImg.style.display = 'none';
    coverPH.classList.remove('hidden');
  }
}

async function applyCoverBackground(coverPath) {
  const root = document.documentElement;

  // 1. 提取颜色(任何模式都执行, 进度条需要主色)
  if (!coverPath) {
    root.style.removeProperty('--cover-accent');
    root.style.removeProperty('--cover-progress-gradient');
    _lastCoverColor = null;
    _lastAppliedCoverPath = null;
    _lastAppliedGradient = null;
    sendCoverColorToDesktop();
    // 渐变也清空
    if (shouldApplyGradientNow()) {
      root.style.setProperty('--cover-opacity', '0');
      if (_bgFadeTimer) clearTimeout(_bgFadeTimer);
      _bgFadeTimer = setTimeout(() => {
        root.style.removeProperty('--cover-gradient');
        _bgFadeTimer = null;
      }, 300);
    }
    return;
  }
  const colors = await (
    /^https?:\/\//i.test(coverPath) || coverPath.startsWith('data:')
      ? window.musicAPI.extractCoverColorFromURL(coverPath)
      : window.musicAPI.extractCoverColor(coverPath)
  );
  if (!colors || colors.length === 0) {
    root.style.removeProperty('--cover-accent');
    root.style.removeProperty('--cover-progress-gradient');
    _lastCoverColor = null;
    _lastAppliedCoverPath = null;
    _lastAppliedGradient = null;
    sendCoverColorToDesktop();
    if (shouldApplyGradientNow()) {
      root.style.setProperty('--cover-opacity', '0');
    }
    return;
  }

  // 2. 设置进度条/强调色(主色, 未经亮度调整, 保持饱和度显眼)
  const mainColor = colors[0];
  _lastCoverColor = { r: mainColor.r, g: mainColor.g, b: mainColor.b };
  root.style.setProperty('--cover-accent', `rgb(${mainColor.r},${mainColor.g},${mainColor.b})`);
  // 进度条渐变: 主色 + 提亮变体 (2 色同色相过渡, 避免多色彩虹条效果)
  // 之前用最多5色按像素数排序(非色相顺序), 等分插值, 视觉上形成色相跳跃的"彩虹条"
  const mainHsl = rgbToHsl(mainColor.r, mainColor.g, mainColor.b);
  const lightHsl = { h: mainHsl.h, s: mainHsl.s, l: Math.min(0.85, mainHsl.l + 0.18) };
  const lightColor = hslToRgb(lightHsl.h, lightHsl.s, lightHsl.l);
  const progressGradient = `linear-gradient(90deg, rgb(${mainColor.r},${mainColor.g},${mainColor.b}), rgb(${lightColor.r},${lightColor.g},${lightColor.b}))`;
  root.style.setProperty('--cover-progress-gradient', progressGradient);
  sendCoverColorToDesktop();

  // 3. 渐变背景: 播放器视图/试听模式始终应用; 其他视图仅在开关开启时应用
  const shouldApplyGradient = shouldApplyGradientNow();
  if (!shouldApplyGradient) {
    root.style.setProperty('--cover-opacity', '0');
    if (_bgFadeTimer) clearTimeout(_bgFadeTimer);
    _bgFadeTimer = setTimeout(() => {
      root.style.removeProperty('--cover-gradient');
      _bgFadeTimer = null;
    }, 300);
    return;
  }

  // 4. 生成渐变(对背景色做亮度调整, 避免过亮/过暗)
  // 按权重过滤: 仅保留占比 >= MIN_WEIGHT_THRESHOLD 的颜色 (默认 3%)
  // 避免少量异色 (如作者签名红色) 被错误地纳入渐变造成主色调被稀释
  // 若过滤后只剩 1 种, 则放宽阈值到 1% 以保留至少 2 色渐变
  const MIN_WEIGHT_THRESHOLD = 0.03;
  const MIN_WEIGHT_FALLBACK = 0.01;
  let top = colors.filter(c => c.weight >= MIN_WEIGHT_THRESHOLD);
  if (top.length < 2) {
    top = colors.filter(c => c.weight >= MIN_WEIGHT_FALLBACK);
  }
  if (top.length === 0) top = colors.slice(0, 1);
  // 最多取前 4 种, 避免色相过多导致彩虹效果
  top = top.slice(0, Math.min(4, top.length));
  // 颜色调整: 亮度 clamp + 饱和色保护
  // 问题: 浅粉色 #efcdd7 (HSL 340°, 50%, 87%) 在亮度 85% 下视觉上像脏白, 丢失粉色感
  // 修复: 饱和度 >= 0.2 的有色像素, 亮度上限收紧到 0.72 (浅色主题) / 0.55 (深色主题)
  //       并适度提升饱和度 (×1.15), 让色彩倾向更明显
  // 灰度色 (s < 0.2) 维持原逻辑, 仅做亮度 clamp
  const adjust = (c) => {
    const hsl = rgbToHsl(c.r, c.g, c.b);
    if (hsl.s >= 0.2) {
      // 有色彩倾向的像素: 收紧亮度上限, 适度提饱和度
      hsl.s = Math.min(1, hsl.s * 1.15);
      if (isLightTheme()) {
        hsl.l = Math.min(0.72, Math.max(0.45, hsl.l));
      } else {
        hsl.l = Math.min(0.55, Math.max(0.28, hsl.l));
      }
    } else {
      // 灰度色: 维持原 clamp 范围
      if (isLightTheme()) {
        hsl.l = Math.min(0.85, Math.max(0.45, hsl.l));
      } else {
        hsl.l = Math.min(0.62, Math.max(0.28, hsl.l));
      }
    }
    return hslToRgb(hsl.h, hsl.s, hsl.l);
  };
  const adjusted = top.map(c => ({ ...adjust(c), weight: c.weight }));
  const angle = Math.floor(Math.random() * 360);
  const baseAlpha = appSettings.colorIntensity;
  let stops;
  if (adjusted.length === 1) {
    const c = adjusted[0];
    stops = `rgba(${c.r},${c.g},${c.b},${baseAlpha}) 0%, rgba(${c.r},${c.g},${c.b},${baseAlpha}) 100%`;
  } else {
    // 按权重分配位置: 权重大的颜色占据更大区间
    // 总权重归一化后, 累积分配百分比位置, 避免等分导致低占比色被过度放大
    const totalWeight = adjusted.reduce((s, c) => s + c.weight, 0);
    let cumPct = 0;
    stops = adjusted.map((c, i) => {
      const w = c.weight / totalWeight;
      let pct;
      if (i === 0) {
        pct = 0;
      } else if (i === adjusted.length - 1) {
        pct = 100;
      } else {
        cumPct += w;
        pct = Math.round(cumPct * 100);
      }
      const alpha = Math.max(baseAlpha * 0.5, baseAlpha - i * 0.13);
      return `rgba(${c.r},${c.g},${c.b},${alpha}) ${pct}%`;
    }).join(', ');
  }
  const gradient = `linear-gradient(${angle}deg, ${stops})`;
  // 优化: 同一封面不重复 fade (切视图时歌曲未变, 渐变应保持)
  if (_lastAppliedCoverPath === coverPath && _lastAppliedGradient && root.style.getPropertyValue('--cover-opacity') === '1') {
    return;
  }
  _lastAppliedCoverPath = coverPath;
  _lastAppliedGradient = gradient;
  // 交叉过渡: 先设新渐变再淡出旧渐变, 避免中间空白期导致深色模式闪黑
  root.style.setProperty('--cover-gradient', gradient);
  // 如果当前 opacity 已为 1, 保持不变 (无感切换); 否则淡入
  if (root.style.getPropertyValue('--cover-opacity') !== '1') {
    root.style.setProperty('--cover-opacity', '1');
  }
  if (_bgFadeTimer) clearTimeout(_bgFadeTimer);
  _bgFadeTimer = null;
}

// 切换视图或切换开关时调用: 根据当前模式+开关决定是否保留渐变背景
function refreshCoverBackground() {
  const root = document.documentElement;
  const shouldApplyGradient = shouldApplyGradientNow();
  if (shouldApplyGradient) {
    // 需要应用渐变: 若当前已有渐变在显示(切视图, 歌曲未变), 保持不变避免闪黑
    if (root.style.getPropertyValue('--cover-opacity') === '1' && _lastAppliedCoverPath) {
      return;
    }
    // 首次应用或重新应用 → 提取颜色
    if (songs[curIdx]) {
      applyCoverBackground(songs[curIdx].coverPath);
    } else {
      root.style.removeProperty('--cover-gradient');
      root.style.setProperty('--cover-opacity', '0');
      _lastAppliedCoverPath = null;
      _lastAppliedGradient = null;
    }
  } else {
    // 不需要渐变 → 移除
    root.style.setProperty('--cover-opacity', '0');
    _lastAppliedCoverPath = null;
    _lastAppliedGradient = null;
    if (_bgFadeTimer) clearTimeout(_bgFadeTimer);
    _bgFadeTimer = setTimeout(() => {
      root.style.removeProperty('--cover-gradient');
      _bgFadeTimer = null;
    }, 300);
  }
}
