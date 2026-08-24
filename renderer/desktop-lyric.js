// =========== 桌面歌词: 两层文字叠加 + width 截断 + 本地时间插值 + 保留上一句 + 过渡动画 ===========
const curRow = document.getElementById('cur-row');
const curBase = curRow.querySelector('.lyric-base');
const curFill = curRow.querySelector('.lyric-fill');
const curText = curRow.querySelector('.lyric-text');  // 当前行文字容器(用于跑马灯 class 切换)
const nextRow = document.getElementById('next-row');
const nextBase = nextRow.querySelector('.lyric-base');
const idleEl = document.getElementById('idle');
const btnLock = document.getElementById('btn-lock');
const btnClose = document.getElementById('btn-close');
const ghostEl = document.getElementById('ghost');

// 跑马灯设置 (从主窗口同步, 默认值与主窗口 appSettings 一致)
let marqueeEnabled = true;
let marqueeThreshold = 1.0;
// 跑马灯状态 (进度跟随模式, 与主窗口 lrc.js 逻辑一致)
// { lineIdx, scrollW, fillPx, curOffset }
let marqueeState = null;

// 旧歌词滑出 + 淡出动画
function showGhost(text) {
  ghostEl.textContent = text;
  // 定位到当前行位置
  ghostEl.style.top = curRow.offsetTop + 'px';
  // 重置状态
  ghostEl.classList.remove('slide-out');
  ghostEl.classList.add('visible');
  // 强制 reflow 确保过渡生效
  void ghostEl.offsetWidth;
  // 下一帧触发滑出
  requestAnimationFrame(() => {
    ghostEl.classList.add('slide-out');
  });
  // 动画结束后清理
  setTimeout(() => {
    ghostEl.classList.remove('visible', 'slide-out');
    ghostEl.textContent = '';
  }, 420);
}

// 当前行新文字淡入
function triggerCurIn() {
  curRow.classList.remove('cur-in');
  void curRow.offsetWidth;
  curRow.classList.add('cur-in');
}
// 下一行新文字滑入
function triggerNextIn() {
  nextRow.classList.remove('next-in');
  void nextRow.offsetWidth;
  nextRow.classList.add('next-in');
}

let lrcData = null;
let simulate = false;  // 低精度歌词模拟走字
let locked = false;

// 时间插值
let lastT = 0;
let lastWall = 0;
let playing = false;
let localRaf = null;       // 标记是否已启动
let localRafRaf = null;    // RAF 句柄
let localRafInterval = null; // setInterval 兜底句柄

// 当前行测量缓存
let curIdx = -1;          // 当前渲染的行索引, -1 表示还没渲染过
let curLineWidth = 0;
let curTokens = [];

// 前奏信息: 在第一句歌词之前显示歌曲名/歌手
let introInfo = null;     // { title, artist }
let introActive = false;  // 是否正在显示前奏信息

// 锁定/解锁
btnLock.addEventListener('click', async () => {
  locked = !locked;
  await window.desktopLyric.lock(locked);
  btnLock.innerHTML = locked
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
  btnLock.title = locked ? '解锁' : '锁定(鼠标穿透)';
});

// 锁定状态下悬停控制按钮区: 临时恢复交互让按钮可点击, 离开后恢复穿透
// 原理: setIgnoreMouseEvents(true, {forward:true}) 只转发 mousemove(用于 hover 显示按钮),
// 点击仍然穿透, 所以鼠标进入按钮区时必须显式切回可交互, 离开时再恢复穿透
const bar = document.getElementById('bar');
let hoverInteractive = false;
async function setHoverInteractive(on) {
  if (hoverInteractive === on) return;
  hoverInteractive = on;
  try { await window.desktopLyric.setInteractive(on); } catch (e) {}
}
bar.addEventListener('mouseenter', () => { if (locked) setHoverInteractive(true); });
bar.addEventListener('mouseleave', () => { if (locked) setHoverInteractive(false); });
// 兜底: 鼠标快速划出窗口时 mouseleave 可能丢失, 窗口级 mouseleave 时恢复穿透
document.documentElement.addEventListener('mouseleave', () => { if (locked) setHoverInteractive(false); });

btnClose.addEventListener('click', async () => {
  await window.desktopLyric.toggle(false);
  // 通知主窗口同步状态(否则主窗口的 desktopLyricOn 仍为 true, 按钮仍显示激活)
  window.desktopLyric.notifyClosed();
});

window.lyricReceiver.onUpdate((payload) => {
  if (payload.type === 'data') {
    lrcData = payload.lrc;
    simulate = payload.simulate === true;  // 低精度歌词模拟走字
    curIdx = -1;  // 强制重新测量
    introActive = false;  // 新歌词数据到达, 重置前奏状态
    marqueeState = null;  // 新歌词, 清除跑马灯状态
    startLocalRAF();
  } else if (payload.type === 'time') {
    lastT = payload.t;
    lastWall = performance.now();
    playing = payload.playing;
    if (!localRaf) startLocalRAF();
  } else if (payload.type === 'color') {
    applyLyricColor(payload.color);
  } else if (payload.type === 'info') {
    // 接收歌曲信息(用于前奏期间显示)
    introInfo = payload.info;
  } else if (payload.type === 'settings') {
    // 接收跑马灯设置 (与主窗口同步)
    if (payload.settings) {
      marqueeEnabled = payload.settings.marqueeEnabled !== false;
      marqueeThreshold = typeof payload.settings.marqueeThreshold === 'number'
        ? payload.settings.marqueeThreshold : 1.0;
    }
  } else if (payload.type === 'clear') {
    lrcData = null;
    curRow.classList.add('empty');
    nextRow.classList.add('empty');
    idleEl.classList.remove('hidden');
    curIdx = -1;
    introActive = false;
    marqueeState = null;
    // 清除跑马灯模式
    if (curText) curText.classList.remove('marquee');
    _removeDesktopMarqueeTrack();
    stopLocalRAF();
  }
});

// 应用封面主色到已唱文字(.lyric-fill)
// 桌面歌词悬浮在任意背景上, 需提升亮度/饱和度保证可读性
function applyLyricColor(color) {
  const root = document.documentElement;
  if (!color) {
    root.style.removeProperty('--lyric-color');
    return;
  }
  // RGB -> HSL, 提升亮度到至少 0.72, 饱和度至少 0.55 (灰度色除外)
  const hsl = rgbToHsl(color.r, color.g, color.b);
  if (hsl.s > 0.08) hsl.s = Math.max(0.55, hsl.s);
  hsl.l = Math.min(0.82, Math.max(0.62, hsl.l));
  const c = hslToRgb(hsl.h, hsl.s, hsl.l);
  root.style.setProperty('--lyric-color', `rgb(${c.r},${c.g},${c.b})`);
}

// RGB <-> HSL 转换 (输入输出均为 0-255 / 0-1)
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function startLocalRAF() {
  if (localRaf !== null) return;
  // 优先用 RAF(可见时 60fps), 但加 setInterval 兜底(窗口不可见时 RAF 被节流)
  const tick = () => {
    let t = lastT;
    if (playing && lastWall > 0) {
      const elapsed = (performance.now() - lastWall) / 1000;
      t = lastT + elapsed;
    }
    render(t);
  };
  // RAF 用于可见时的高帧率
  const rafLoop = () => {
    tick();
    localRafRaf = requestAnimationFrame(rafLoop);
  };
  // setInterval 兜底: 窗口被遮挡/最小化时 RAF 可能暂停
  localRafInterval = setInterval(tick, 250);
  localRafRaf = requestAnimationFrame(rafLoop);
  localRaf = true;  // 标记已启动
}
function stopLocalRAF() {
  if (localRafRaf !== null) { cancelAnimationFrame(localRafRaf); localRafRaf = null; }
  if (localRafInterval !== null) { clearInterval(localRafInterval); localRafInterval = null; }
  localRaf = null;
}

// 测量当前行: 用临时隐藏 span 逐 token 测量, 不污染 curBase
function measureLine(lineData) {
  const chars = lineData.chars || [];
  if (!chars.length) { curTokens = []; curLineWidth = 0; return; }

  // 设置底层文字(完整一行)
  const text = chars.map(c => c.text).join('');
  curBase.textContent = text;
  curFill.textContent = text;
  curLineWidth = curBase.offsetWidth;

  // 用临时隐藏容器逐 token 测量, 不修改 curBase 内容
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;visibility:hidden;position:absolute;white-space:nowrap;';
  probe.style.font = getComputedStyle(curBase).font;
  document.body.appendChild(probe);
  let accX = 0;
  curTokens = chars.map(c => {
    probe.textContent = c.text;
    const w = probe.offsetWidth;
    const tok = {
      start: lineData.start + c.offset,
      end: lineData.start + c.offset + c.dur,
      x: accX,
      w: w
    };
    accX += w;
    return tok;
  });
  document.body.removeChild(probe);
}

function calcFillPx(t) {
  const ts = curTokens;
  if (!ts.length || curLineWidth <= 0) return 0;
  for (let j = 0; j < ts.length; j++) {
    if (t >= ts[j].start && t < ts[j].end) {
      const span = ts[j].end - ts[j].start;
      const p = span > 0 ? (t - ts[j].start) / span : 1;
      return ts[j].x + Math.max(0, Math.min(1, p)) * ts[j].w;
    }
  }
  const last = ts[ts.length - 1];
  if (t >= last.end) return curLineWidth;  // 已唱完该行, 填充 100%
  if (t < ts[0].start) return 0;
  // token 间隙: 停在前一个 token 末尾
  for (let j = 0; j < ts.length - 1; j++) {
    if (t >= ts[j].end && t < ts[j + 1].start) return ts[j].x + ts[j].w;
  }
  return 0;
}

// =========== 桌面歌词跑马灯 (与主窗口 lrc.js 逻辑一致: 进度跟随模式) ==========
// 双层结构: .lyric-text (外层裁剪) > .marquee-track (内层滚动) > .lyric-base/.lyric-fill
function _ensureDesktopMarqueeTrack() {
  if (!curText.querySelector('.marquee-track')) {
    const track = document.createElement('div');
    track.className = 'marquee-track';
    // 把 .lyric-base 和 .lyric-fill 移到 track 里
    while (curText.firstChild) track.appendChild(curText.firstChild);
    curText.appendChild(track);
  }
  return curText.querySelector('.marquee-track');
}
function _removeDesktopMarqueeTrack() {
  const track = curText.querySelector('.marquee-track');
  if (track) {
    const frag = document.createDocumentFragment();
    while (track.firstChild) frag.appendChild(track.firstChild);
    curText.removeChild(track);
    curText.appendChild(frag);
  }
  curText.style.transform = '';
}
function updateDesktopMarquee(fillPx) {
  if (!marqueeState) return;
  // 容器宽度 = .lyric-text 可视宽度 (外层裁剪)
  const containerW = curText.clientWidth || 0;
  // 文字总宽度 = curLineWidth (measureLine 测量得到)
  const textWidth = curLineWidth || 0;
  // 需要滚动的距离 = 文字宽度 - 容器宽度
  const scrollW = Math.max(0, textWidth - containerW);
  if (scrollW <= 0) {
    // 文字未超出容器, 不需要跑马灯
    if (curText.classList.contains('marquee')) {
      curText.classList.remove('marquee');
      _removeDesktopMarqueeTrack();
    }
    return;
  }
  // 进入跑马灯模式
  if (!curText.classList.contains('marquee')) {
    curText.classList.add('marquee');
    _ensureDesktopMarqueeTrack();
  }
  // 更新 scrollW
  marqueeState.scrollW = scrollW;
  marqueeState.fillPx = fillPx;
  // 进度跟随: 当 fillPx 超过容器 70% 时开始滚动
  const triggerPx = containerW * 0.7;
  let targetOffset = 0;
  if (fillPx > triggerPx) {
    targetOffset = Math.min(scrollW, fillPx - triggerPx);
  }
  // lerp 缓动 (与主窗口一致, 系数 0.18)
  if (typeof marqueeState.curOffset !== 'number') marqueeState.curOffset = 0;
  const lerp = 0.18;
  const delta = targetOffset - marqueeState.curOffset;
  if (Math.abs(delta) < 0.5) {
    marqueeState.curOffset = targetOffset;
  } else {
    marqueeState.curOffset += delta * lerp;
  }
  const track = curText.querySelector('.marquee-track');
  if (track) {
    track.style.transform = `translateX(${-marqueeState.curOffset.toFixed(2)}px)`;
  }
}

function render(t) {
  if (!lrcData || !lrcData.lines || !lrcData.lines.length) {
    // 没有歌词数据: 显示前奏信息或 idle
    if (introInfo && introInfo.title) {
      const displayText = introInfo.artist ? `${introInfo.title} - ${introInfo.artist}` : introInfo.title;
      if (curBase.textContent !== displayText) {
        curBase.textContent = displayText;
        curFill.textContent = displayText;
        curFill.style.width = '0px';
        curRow.classList.remove('empty');
        idleEl.classList.add('hidden');
        triggerCurIn();
        introActive = true;
      }
      nextRow.classList.add('empty');
    } else {
      curRow.classList.add('empty');
      nextRow.classList.add('empty');
      idleEl.classList.remove('hidden');
    }
    return;
  }
  idleEl.classList.add('hidden');

  const lines = lrcData.lines;

  // 找当前行: t 落在 [start, end) 内
  let idx = -1;
  if (lrcData.raw) {
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.chars || !ln.chars.length) continue;
      const last = ln.chars[ln.chars.length - 1];
      const end = ln.start + last.offset + last.dur;
      if (t >= ln.start && t < end) { idx = i; break; }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].time) idx = i; else break;
    }
  }

  // 行间空白或前奏: 不清空, 保留上一句状态
  if (idx === -1) {
    const firstStart = lrcData.raw
      ? (lines[0].start || 0)
      : (lines[0].time || 0);

    if (t < firstStart) {
      // 前奏: 第一句歌词之前, 显示歌曲信息
      if (!introActive && introInfo && introInfo.title) {
        const displayText = introInfo.artist ? `${introInfo.title} - ${introInfo.artist}` : introInfo.title;
        curBase.textContent = displayText;
        curFill.textContent = displayText;
        curFill.style.width = '0px';
        curRow.classList.remove('empty');
        nextRow.classList.add('empty');
        triggerCurIn();
        introActive = true;
      } else if (!introActive) {
        // 没有歌曲信息, 也不清空(保留上一曲的最后状态)
        // 只有完全没有渲染过时才显示 idle
        if (curIdx === -1) {
          curRow.classList.add('empty');
          nextRow.classList.add('empty');
        }
      }
      return;
    }

    // 行间空白: 保留上一句, 填充 100%, 不清空
    if (curIdx >= 0) {
      if (lrcData.raw && curTokens.length) {
        curFill.style.width = curLineWidth + 'px';
      }
      // 保留下一行显示
      return;
    }
    // 还没渲染过, 直接返回
    return;
  }

  // 切到新行: 触发过渡动画 + 重新测量 + 更新文字
  if (idx !== curIdx) {
    // 保存旧文字, 创建幽灵滑出(包括从前奏信息切换到歌词)
    const oldText = curBase.textContent;
    const wasIntro = introActive;
    if (oldText && (curIdx >= 0 || wasIntro)) {
      showGhost(oldText);
    }
    introActive = false;

    curIdx = idx;
    const curLine = lines[idx];
    if (lrcData.raw) {
      measureLine(curLine);
    } else {
      curBase.textContent = curLine.text;
      curFill.textContent = curLine.text;
      curLineWidth = curBase.offsetWidth;
    }

    // 行切换: 重置跑马灯状态 (清除上一行的滚动偏移)
    if (curText.classList.contains('marquee')) {
      curText.classList.remove('marquee');
      _removeDesktopMarqueeTrack();
    }
    marqueeState = null;

    // 触发当前行淡入
    triggerCurIn();
  }

  curRow.classList.remove('empty');

  // 计算填充
  let fillPx = 0;
  if (lrcData.raw && curTokens.length) {
    fillPx = calcFillPx(t);
    curFill.style.width = fillPx + 'px';
  } else if (simulate) {
    // 低精度模拟走字: 按时间进度填充宽度
    const lineStart = lines[idx].time;
    const lineEnd = (idx + 1 < lines.length) ? lines[idx + 1].time : lineStart + 5;
    const span = lineEnd - lineStart;
    const progress = span > 0 ? Math.max(0, Math.min(1, (t - lineStart) / span)) : 1;
    fillPx = curLineWidth * progress;
    curFill.style.width = fillPx + 'px';
  } else {
    curFill.style.width = curLineWidth + 'px';
    fillPx = curLineWidth;
  }

  // 跑马灯: 长歌词超出容器时启用横向滚动 (仅逐字歌词 raw 模式)
  // 与主窗口 lrc.js 一致: 进度跟随模式, 滚动跟随填充位置
  if (lrcData.raw && marqueeEnabled && curLineWidth > 0) {
    const containerW = (curText.parentElement && curText.parentElement.clientWidth) || curRow.clientWidth || 0;
    // threshold 判断: 文字宽度 > 容器宽度 * threshold (默认 1.0)
    const shouldMarquee = curLineWidth > containerW * marqueeThreshold && containerW > 0;
    if (shouldMarquee) {
      if (!marqueeState) {
        marqueeState = { scrollW: 0, fillPx: fillPx, curOffset: 0 };
      } else {
        marqueeState.fillPx = fillPx;
      }
      updateDesktopMarquee(fillPx);
    } else if (marqueeState) {
      // 文字未超出, 清除跑马灯
      marqueeState = null;
      if (curText.classList.contains('marquee')) {
        curText.classList.remove('marquee');
        _removeDesktopMarqueeTrack();
      }
    }
  } else if (marqueeState) {
    // 跑马灯关闭或非逐字模式, 清除
    marqueeState = null;
    if (curText.classList.contains('marquee')) {
      curText.classList.remove('marquee');
      _removeDesktopMarqueeTrack();
    }
  }

  // 下一行
  const nextLine = lines[idx + 1];
  if (nextLine) {
    const newText = lrcData.raw
      ? (nextLine.chars || []).map(c => c.text).join('')
      : nextLine.text;
    // 文字变化时触发滑入动画
    if (nextBase.textContent !== newText) {
      nextBase.textContent = newText;
      triggerNextIn();
    }
    nextRow.classList.remove('empty');
  } else {
    // 最后一行已无下一行: 清空第二行, 避免与当前行内容重叠
    if (nextBase.textContent !== '') {
      nextBase.textContent = '';
      nextRow.classList.add('empty');
    }
  }
}
