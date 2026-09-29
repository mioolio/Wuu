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

  // 4. 生成渐变(邻近双色): 主色 + 色相距离 ≤60° 的真实邻近色(无则从主色派生)
  // 双色恒定 alpha 且色相接近, 从根源上避免远色相 sRGB 插值产生"泥色"分层带
  // 颜色调整: 亮度 clamp + 饱和色保护
  // 问题: 浅粉色 #efcdd7 (HSL 340°, 50%, 87%) 在亮度 85% 下视觉上像脏白, 丢失粉色感
  // 修复: 饱和度 >= 0.2 的有色像素, 亮度上限收紧到 0.72 (浅色主题) / 0.55 (深色主题)
  //       并适度提升饱和度 (×1.15), 让色彩倾向更明显
  // 灰度色 (s < 0.2) 维持原逻辑, 仅做亮度 clamp
  // lShift: 亮度偏移, companion 向主色反侧偏移形成同色系明暗层次(差异小, 不产生层感)
  const adjust = (c, lShift = 0) => {
    const hsl = rgbToHsl(c.r, c.g, c.b);
    if (hsl.s >= 0.2) {
      // 有色彩倾向的像素: 收紧亮度上限, 适度提饱和度
      hsl.s = Math.min(1, hsl.s * 1.15);
      if (isLightTheme()) {
        hsl.l = Math.min(0.72, Math.max(0.45, hsl.l + lShift));
      } else {
        hsl.l = Math.min(0.55, Math.max(0.28, hsl.l + lShift));
      }
    } else {
      // 灰度色: 维持原 clamp 范围
      if (isLightTheme()) {
        hsl.l = Math.min(0.85, Math.max(0.45, hsl.l + lShift));
      } else {
        hsl.l = Math.min(0.62, Math.max(0.28, hsl.l + lShift));
      }
    }
    return hslToRgb(hsl.h, hsl.s, hsl.l);
  };
  // companion 选择: 优先取封面中真实存在、与主色色相距离 ≤60° 的最大权重色
  // (weight < 2% 直接停止, colors 已按权重降序, 过滤签名等小色块杂色)
  let companionHsl = null;
  for (let i = 1; i < colors.length; i++) {
    if (colors[i].weight < 0.02) break;
    const hsl = rgbToHsl(colors[i].r, colors[i].g, colors[i].b);
    const hueDist = Math.abs(hsl.h - mainHsl.h);
    if (Math.min(hueDist, 1 - hueDist) * 360 <= 60) { companionHsl = hsl; break; }
  }
  if (!companionHsl) {
    // 无真实邻近色(单色/灰度/色相孤立封面): 从主色派生
    // 色相随机 ±30° (灰度 s≈0 时旋转无感知, 由亮度差提供过渡), 饱和度略降更柔和
    companionHsl = {
      h: (mainHsl.h + (Math.random() < 0.5 ? -30 : 30) / 360 + 1) % 1,
      s: mainHsl.s * 0.9,
      l: mainHsl.l,
    };
  }
  // companion 亮度向主色反侧偏移 0.1: 同色系明暗渐变, 有层次但无色相跳跃
  const lShift = companionHsl.l >= mainHsl.l ? 0.1 : -0.1;
  const adjustedMain = adjust(colors[0], 0);
  const adjustedComp = adjust(hslToRgb(companionHsl.h, companionHsl.s, companionHsl.l), lShift);
  const angle = Math.floor(Math.random() * 360);
  const baseAlpha = appSettings.colorIntensity;
  const gradient = `linear-gradient(${angle}deg, rgba(${adjustedMain.r},${adjustedMain.g},${adjustedMain.b},${baseAlpha}) 0%, rgba(${adjustedComp.r},${adjustedComp.g},${adjustedComp.b},${baseAlpha}) 100%)`;
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
