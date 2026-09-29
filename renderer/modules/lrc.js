// =========== LRC 解析 + 渲染 + 同步 ===========

function parseRaw(text) {
  const lines = [];
  const lr = /^\[(\d+),(\d+)\](.*)/;
  const cr = /<(\d+),(\d+),\d+>/g;
  const MAX_GAP = 2.0;
  for (const raw of text.split('\n')) {
    const lm = raw.trim().match(lr);
    if (!lm) continue;
    const start = parseInt(lm[1]) / 1000;
    let duration = parseInt(lm[2]) / 1000;
    const parts = lm[3].split(/<[^>]+>/);
    const offs = [];
    let m;
    // BUGFIX: cr 正则带 g 标志, 跨行复用会导致 lastIndex 错乱, 某些行匹配不到 tag
    cr.lastIndex = 0;
    while ((m = cr.exec(lm[3]))) offs.push({ offset: parseInt(m[1]) / 1000, dur: parseInt(m[2]) / 1000 });
    const chars = [];
    // krcToRaw 产生 "text<tag>text<tag>..." 格式, tag 描述其前面的 text
    // 也兼容 "<tag>text<tag>text..." 格式, tag 描述其后面的 text
    // 通过 parts[0] 是否为空来判断格式
    const startsWithTag = parts.length > 0 && parts[0] === '';
    for (let i = 0; i < offs.length; i++) {
      const textPart = startsWithTag ? parts[i + 1] : parts[i];
      if (!textPart) continue;
      const o = offs[i];
      let offset = o.offset;
      let dur = o.dur;
      if (chars.length > 0) {
        const prev = chars[chars.length - 1];
        const prevEnd = prev.offset + Math.max(prev.dur, 0);
        if (offset - prevEnd > MAX_GAP) {
          offset = prevEnd;
        }
      }
      if (!dur || dur <= 0) dur = 0.4;
      else if (dur > 0.8) dur = 0.8;
      chars.push({ offset, dur, text: textPart });
    }
    // 处理末尾无标签的文本(最后一个字), 用前一字 end 作为 offset, 默认 0.4s 时长
    // startsWithTag 格式: 主循环消耗 parts[1..offs.length], 尾部从 offs.length+1 开始
    // text<tag> 格式: 主循环消耗 parts[0..offs.length-1], 尾部从 offs.length 开始
    const trailingThreshold = startsWithTag ? offs.length + 1 : offs.length;
    if (parts.length > trailingThreshold && parts[parts.length - 1]) {
      const lastText = parts[parts.length - 1];
      let offset = 0;
      if (chars.length > 0) {
        const prev = chars[chars.length - 1];
        offset = prev.offset + Math.max(prev.dur, 0);
      }
      chars.push({ offset, dur: 0.4, text: lastText });
    }
    if (chars.length) {
      // 安全网: 检测并修复行内重复（因 krc+lrc 合并 bug 或源数据错误导致整段重复）
      // 模式: 行内有一段文字连续出现两次（如 "I'm keeping fking tryingkeeping fking trying"）
      // 策略: 从最长公共后缀/前缀中找到重复段并截断
      const fullText = chars.map(c => c.text).join('');
      const deduped = _dedupLineText(fullText);
      if (deduped !== fullText) {
        // 从前往后截取, 截断多余的 chars 并调整最后一个 char 的文本
        let acc = '';
        let cutIdx = -1;
        let cutRemain = '';
        for (let i = 0; i < chars.length; i++) {
          acc += chars[i].text;
          if (acc.length >= deduped.length) {
            cutIdx = i;
            cutRemain = acc.length - deduped.length;
            break;
          }
        }
        if (cutIdx >= 0) {
          if (cutRemain > 0 && chars[cutIdx]) {
            // 最后一个 char 截断文本, 时长等比缩减
            const origText = chars[cutIdx].text;
            const newText = origText.slice(0, origText.length - cutRemain);
            if (newText) {
              const ratio = newText.length / origText.length;
              chars[cutIdx].text = newText;
              chars[cutIdx].dur = Math.max(0.1, chars[cutIdx].dur * ratio);
              chars.length = cutIdx + 1;
            } else {
              chars.length = cutIdx;
            }
          } else {
            chars.length = cutIdx + 1;
          }
          // 重算 duration
          if (chars.length > 0) {
            const last = chars[chars.length - 1];
            duration = last.offset + last.dur;
          }
        }
      }
      if (chars.length) lines.push({ start, duration, chars });
    }
  }
  return lines;
}

// 去重: 检测文本末尾是否有重复的前半段, 截断到第一个完整周期
// 例: "I'm keeping fking tryingkeeping fking trying" → "I'm keeping fking trying"
// 例: "abcabcabc" → "abcabc" (只去最后一个重复段)
function _dedupLineText(text) {
  if (!text || text.length < 6) return text;
  const len = text.length;
  // 从后往前找: 寻找最大的 k 使得 text 末尾 k 个字符 == text 中前一个 k 长度的段
  // 只检测重复段长度 >= 总长度 1/3 的情况, 避免误判
  const minK = Math.max(4, Math.floor(len / 3));
  const maxK = Math.floor(len / 2);
  for (let k = maxK; k >= minK; k--) {
    const suffix = text.slice(len - k);
    const prev = text.slice(len - 2 * k, len - k);
    if (suffix === prev) {
      return text.slice(0, len - k);
    }
  }
  return text;
}

// 预处理: 把内联时间戳格式 "在[2:10.87]那[2.11.29]片[2.11.70]" 转为标准 LRC 多行
// 时间戳标记的是其前面文字的开始时间, 拆成 [mm:ss.xx]文字 的独立行
// 支持混合分隔符: [分:秒.毫秒] 和 [分.秒.毫秒]
function normalizeInlineTimestampLrc(text) {
  const lines = text.split('\n');
  const result = [];
  // 匹配 [数字:数字.数字] 或 [数字.数字.数字] 或 [数字:数字] 等变体
  const tsRe = /\[(\d+)[.:](\d+)(?:[.:](\d+))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 标准 LRC 行 (行首就是时间戳): 直接保留
    if (/^\[(\d+)[.:](\d+)(?:[.:](\d+))?\]/.test(trimmed)) {
      result.push(trimmed);
      continue;
    }

    // 查找行内所有时间戳
    const matches = [];
    let m;
    tsRe.lastIndex = 0;
    while ((m = tsRe.exec(trimmed))) matches.push(m);
    if (matches.length === 0) {
      // 无时间戳行, 保留原文本
      result.push(trimmed);
      continue;
    }

    // 内联时间戳: 每个时间戳跟它前面的文字配对
    for (let i = 0; i < matches.length; i++) {
      const ts = matches[i];
      const textStart = i === 0 ? 0 : matches[i - 1].index + matches[i - 1][0].length;
      const textEnd = ts.index;
      const word = trimmed.substring(textStart, textEnd);
      if (!word) continue;

      // 标准化时间戳为 [mm:ss.xx]
      const min = ts[1].padStart(2, '0');
      const sec = ts[2].padStart(2, '0');
      let ms = ts[3] || '0';
      ms = ms.length === 1 ? ms + '00' : ms.length === 2 ? ms + '0' : ms;
      result.push(`[${min}:${sec}.${ms}]${word}`);
    }
  }
  return result.join('\n');
}

// 解析逐字 LRC 格式 (enhanced LRC): [00:24.08]半[00:24.36]夜[00:24.57]睡...
// 每个时间戳标记其后面文字的开始时间, 转为 {start, duration, chars} 结构走逐字渲染
function parseEnhancedLRC(text) {
  const lines = [];
  const tsRe = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const stamps = [];
    let m;
    tsRe.lastIndex = 0;
    while ((m = tsRe.exec(line))) {
      const ms = m[3].length === 2 ? m[3] + '0' : m[3];
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(ms) / 1000;
      stamps.push({ time: t, index: m.index, end: m.index + m[0].length });
    }
    // 少于2个时间戳: 不是逐字LRC, 交给 parseLRC 处理
    if (stamps.length < 2) continue;
    const start = stamps[0].time;
    const chars = [];
    for (let i = 0; i < stamps.length; i++) {
      const st = stamps[i];
      const textEnd = i + 1 < stamps.length ? stamps[i + 1].index : line.length;
      const chText = line.substring(st.end, textEnd);
      if (!chText) continue;
      let dur = i + 1 < stamps.length ? stamps[i + 1].time - st.time : 0.4;
      if (!dur || dur <= 0) dur = 0.4;
      else if (dur > 0.8) dur = 0.8;
      chars.push({ offset: st.time - start, dur, text: chText });
    }
    if (chars.length) {
      lines.push({ start, duration: stamps[stamps.length - 1].time - start, chars });
    }
  }
  return lines;
}

function parseLRC(text) {
  // 预处理内联时间戳格式 (服务端可能返回 "在[2:10.87]那[2.11.29]片[2.11.70]")
  text = normalizeInlineTimestampLrc(text);
  const lines = [];
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3].length === 2 ? m[3] + '0' : m[3]) / 1000;
    const txt = m[4].trim();
    if (txt) lines.push({ time: t, text: txt });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function renderLrc() {
  lyricsInner.innerHTML = '';
  prevCurLine = -1;
  lineMetrics = [];
  _cachedLineEls = null;  // 清除缓存, renderLrc 结束后由 syncLrc 重建
  marqueeState = null;    // 清除跑马灯状态, 避免旧状态影响新歌

  const pad = document.createElement('div');
  pad.className = 'lyric-line'; pad.style.visibility = 'hidden'; pad.textContent = '·';
  lyricsInner.appendChild(pad);

  if (lrcRaw) {
    for (const line of lrc) {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      for (const ch of line.chars) {
        const sp = document.createElement('span');
        sp.className = 'lyric-char';
        sp.textContent = ch.text;
        sp.dataset.st = line.start + ch.offset;
        sp.dataset.en = line.start + ch.offset + ch.dur;
        div.appendChild(sp);
      }
      lyricsInner.appendChild(div);
    }
  } else {
    for (const l of lrc) {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      // 模拟走字: 将整行拆成字符 span, 用 --p 渐变填充模拟逐字进度
      if (appSettings.simulateLrcProgress) {
        div.classList.add('lyric-simulated');
        // 按字符拆分(保留空格), 每个字符一个 span
        for (const ch of l.text) {
          const sp = document.createElement('span');
          sp.className = 'lyric-char';
          sp.textContent = ch;
          div.appendChild(sp);
        }
      } else {
        div.textContent = l.text;
      }
      lyricsInner.appendChild(div);
    }
  }
}

function measureLine(lineEl, lineData) {
  // 跑马灯模式: .lyric-char 在 .marquee-track 内
  const track = lineEl.querySelector('.marquee-track');
  const charContainer = track || lineEl;
  // 优先用 children 缓存, 避免 querySelectorAll (每帧调用时性能开销大)
  const charEls = lineEl._charEls && !track ? lineEl._charEls : charContainer.querySelectorAll('.lyric-char');
  if (!track) lineEl._charEls = charEls;
  // offsetWidth/offsetLeft 是布局属性, 不受 CSS transform 影响, 避免 scale 反馈循环
  const lineWidth = lineEl.offsetWidth;
  const tokens = [];
  const n = Math.min(charEls.length, lineData.chars.length);
  for (let i = 0; i < n; i++) {
    const cd = lineData.chars[i];
    // parseRaw 已保证 dur > 0, 这里额外防御: dur<=0 时按 0.4s 补全
    const dur = (cd.dur && cd.dur > 0) ? cd.dur : 0.4;
    tokens.push({
      start: lineData.start + cd.offset,
      end: lineData.start + cd.offset + dur,
      x: charEls[i].offsetLeft,
      w: charEls[i].offsetWidth
    });
  }
  // 文字总宽度: 跑马灯模式下 = track 宽度, 非跑马灯模式 = 用首尾 token 计算
  let textWidth = lineWidth;
  if (track) {
    textWidth = track.offsetWidth;
  } else if (tokens.length > 0) {
    textWidth = (tokens[tokens.length - 1].x + tokens[tokens.length - 1].w) - tokens[0].x;
  }
  return { width: lineWidth, textWidth, tokens };
}

function calcFillPx(m, t) {
  const ts = m.tokens;
  if (!ts.length || m.width <= 0) return 0;
  for (let j = 0; j < ts.length; j++) {
    if (t >= ts[j].start && t < ts[j].end) {
      const span = ts[j].end - ts[j].start;
      const p = span > 0 ? (t - ts[j].start) / span : 1;
      return ts[j].x + Math.max(0, Math.min(1, p)) * ts[j].w;
    }
  }
  const last = ts[ts.length - 1];
  if (t >= last.end) return last.x + last.w;
  if (t < ts[0].start) return 0;
  for (let j = 0; j < ts.length - 1; j++) {
    if (t >= ts[j].end && t < ts[j + 1].start) return ts[j].x + ts[j].w;
  }
  return 0;
}

// =========== 长歌词跑马灯 ==========
// 进度跟随模式: 跑马灯偏移量根据当前填充位置(fillPx)动态计算
// 当填充位置接近容器右边缘时, 自动滚动让"已唱到的位置"保持在可视区域内
// 类似 QQ 音乐/网易云音乐, 滚动与歌词进度完全同步, 无机械往返感
//
// 实现方式 (双层结构):
//   外层: .lyric-line.cur.marquee (overflow:hidden, text-align:left, 作为裁剪容器)
//   内层: .marquee-track (display:inline-block, white-space:nowrap, transform:translateX)
// 所有 .lyric-char span 都在 track 内, track 宽度 = 文字实际宽度
// 滚动时只移动 track, 外层容器不动, 避免 transform 与 overflow:hidden 在同一元素上的兼容性问题
function _ensureMarqueeTrack(el) {
  if (!el.querySelector('.marquee-track')) {
    const track = document.createElement('div');
    track.className = 'marquee-track';
    // 把所有子节点(.lyric-char)移到 track 里
    while (el.firstChild) track.appendChild(el.firstChild);
    el.appendChild(track);
  }
  return el.querySelector('.marquee-track');
}
function _removeMarqueeTrack(el) {
  const track = el.querySelector('.marquee-track');
  if (track) {
    // 把 track 内的子节点移回 el
    const frag = document.createDocumentFragment();
    while (track.firstChild) frag.appendChild(track.firstChild);
    el.removeChild(track);
    el.appendChild(frag);
  }
  // 清理内联样式
  el.style.transform = '';
  el.style.transformOrigin = '';
}
function updateMarquee(el, st, now) {
  if (!st || !el) return;
  const track = _ensureMarqueeTrack(el);
  const scrollW = Math.max(0, st.scrollW || 0);
  if (scrollW <= 0) {
    track.style.transform = '';
    return;
  }

  // 进度跟随模式: 跑马灯偏移量根据当前填充位置动态计算
  // 目标: 让"已唱到的位置"(fillPx) 始终保持在容器可视区域内, 类似 QQ 音乐/网易云音乐
  // 策略:
  //   1. 当 fillPx 还在容器前 70% 区域时, 不滚动 (offset = 0, 让用户看到行首)
  //   2. 当 fillPx 超过容器 70% 时, 开始滚动, 滚动量 = fillPx - 容器宽度 * 0.7
  //   3. 滚动量不超过 scrollW (即文字末尾不超出容器右边缘)
  //   4. 用 easeInOut 缓动让滚动更平滑, 避免突跳
  // st.fillPx 由 syncLrc 每帧更新 (而非用闭包传递, 避免函数签名变化)
  const containerW = el.clientWidth || 0;
  const fillPx = st.fillPx || 0;
  // 触发滚动的阈值: 容器宽度的 70% (留 30% 缓冲让用户看到即将唱到的字)
  const triggerPx = containerW * 0.7;
  let targetOffset = 0;
  if (fillPx > triggerPx) {
    targetOffset = Math.min(scrollW, fillPx - triggerPx);
  }
  // 缓动: 平滑过渡到目标偏移, 避免突跳 (lerp 系数 0.18, 约 6 帧达到 90%)
  // 60fps 下约 100ms 完成过渡, 既有响应感又不突兀
  if (typeof st.curOffset !== 'number') st.curOffset = 0;
  const lerp = 0.18;
  const delta = targetOffset - st.curOffset;
  if (Math.abs(delta) < 0.5) {
    st.curOffset = targetOffset;
  } else {
    st.curOffset += delta * lerp;
  }
  track.style.transform = `translateX(${-st.curOffset.toFixed(2)}px)`;
}

function syncLrc(t) {
  if (!lrc.length) return;
  // 缓存歌词行元素, 避免每帧 querySelectorAll (60fps 下每秒 60 次 DOM 查询)
  if (!_cachedLineEls) _cachedLineEls = lyricsInner.querySelectorAll('.lyric-line');
  const lineEls = _cachedLineEls;

  if (lrcRaw) {
    let curLineIdx = -1;
    for (let i = 0; i < lrc.length; i++) {
      const ln = lrc[i];
      const last = ln.chars[ln.chars.length - 1];
      let charEnd;
      if (last.dur && last.dur > 0) {
        charEnd = ln.start + last.offset + last.dur;
      } else {
        charEnd = ln.start + ln.chars.length * 0.4;
      }
      if (ln.duration && ln.duration > 0) {
        const lineEndByDuration = ln.start + ln.duration;
        if (lineEndByDuration > charEnd) charEnd = lineEndByDuration;
      }
      // 钳制: 当前行结束时间不得超过下一行的开始时间
      // 防止 KRC 源数据 duration 异常膨胀导致歌词卡死无法推进
      // (如酷狗 KRC 中某些行的 duration 远超实际歌唱时长)
      if (i < lrc.length - 1) {
        const nextStart = lrc[i + 1].start;
        if (charEnd > nextStart) charEnd = nextStart;
      }
      if (t >= ln.start && t < charEnd) { curLineIdx = i; break; }
    }

    if (curLineIdx === -1) {
      if (lrc.length > 0 && t >= lrc[0].start) {
        if (prevCurLine >= 0) {
          const prevDi = prevCurLine + 1;
          const prevEl = lineEls[prevDi];
          if (prevEl) prevEl.style.setProperty('--p', '100%');
        }
        return;
      }
      lineEls.forEach(el => el.classList.remove('cur', 'done'));
      prevCurLine = -1;
      return;
    }

    const di = curLineIdx + 1;
    const curEl = lineEls[di];
    if (!curEl) return;

    // 行切换时才更新 classList, 避免每帧遍历所有行
    if (curLineIdx !== prevCurLine) {
      lineEls.forEach((el, i) => {
        if (i === di) {
          el.classList.add('cur');
          el.classList.remove('done');
        } else if (i < di) {
          // 退出跑马灯时还原 DOM 结构 (track 移回, 清理内联样式)
          if (el.classList.contains('marquee')) _removeMarqueeTrack(el);
          el.classList.remove('cur', 'marquee');
          el.classList.add('done');
          el.style.transform = '';
          el.style.whiteSpace = '';
        } else {
          if (el.classList.contains('marquee')) _removeMarqueeTrack(el);
          el.classList.remove('cur', 'done', 'marquee');
          el.style.transform = '';
          el.style.whiteSpace = '';
        }
      });
      // 行切换时清除跑马灯状态, 由后续 shouldMarquee 判断重新启动
      marqueeState = null;
    }

    // font-size 过渡期间位置会变化, 需要每帧重新测量当前行
    lineMetrics[di] = measureLine(curEl, lrc[curLineIdx]);

    const m = lineMetrics[di];
    if (m) {
      const fillPx = calcFillPx(m, t);
      const pPct = Math.max(0, Math.min(100, (fillPx / m.width) * 100));
      curEl.style.setProperty('--p', pPct + '%');

      const containerW = lyricsInner.clientWidth - 24;
      const textWidth = m.textWidth || m.width;
      // 长歌词处理: 跑马灯 (默认) 或字号缩放 (跑马灯关闭时)
      const shouldMarquee = appSettings.marqueeEnabled
        && textWidth > containerW * appSettings.marqueeThreshold
        && containerW > 0
        && textWidth > 0;
      if (shouldMarquee) {
        // 启动/更新跑马灯
        // 计算需要滚动的距离 = 文字宽度 - 容器宽度
        const scrollW = Math.max(0, textWidth - containerW);
        // 行切换时重置跑马灯状态
        if (curLineIdx !== prevCurLine || !marqueeState || marqueeState.lineIdx !== curLineIdx) {
          marqueeState = {
            lineIdx: curLineIdx,
            scrollW: scrollW,
            // 进度跟随模式: 当前的填充位置 (每帧由 syncLrc 更新)
            fillPx: fillPx,
            // 当前滚动偏移 (lerp 缓动用)
            curOffset: 0,
          };
          curEl.classList.add('marquee');
          // 进入跑马灯模式后重新测量 (DOM 结构变化: 多了 .marquee-track 包裹层)
          lineMetrics[di] = measureLine(curEl, lrc[curLineIdx]);
        } else {
          // 更新 scrollW (容器宽度变化时)
          if (marqueeState.scrollW !== scrollW) marqueeState.scrollW = scrollW;
          // 更新当前填充位置 (跑马灯滚动跟随此值)
          marqueeState.fillPx = fillPx;
        }
        // 跑马灯模式下: 渐变填充移到 .marquee-track 内层
        // --p 基于外层宽度, 需改为基于文字总宽度的 --track-p, 让渐变跟着文字滚动
        const track = curEl.querySelector('.marquee-track');
        if (track) {
          const trackP = textWidth > 0 ? Math.max(0, Math.min(100, (fillPx / textWidth) * 100)) : 0;
          track.style.setProperty('--track-p', trackP + '%');
        }
        updateMarquee(curEl, marqueeState, performance.now());
      } else {
        // 短歌词或跑马灯关闭: 清除跑马灯状态
        if (marqueeState) {
          marqueeState = null;
        }
        if (curEl.classList.contains('marquee')) {
          curEl.classList.remove('marquee');
          _removeMarqueeTrack(curEl);
          lineMetrics[di] = measureLine(curEl, lrc[curLineIdx]);
        }
        curEl.style.transform = '';
        // 跑马灯关闭时, 回退到字号缩放 (保持原有逻辑)
        if (!appSettings.marqueeEnabled && textWidth > containerW && containerW > 0) {
          const scale = containerW / textWidth;
          if (scale >= 0.5) {
            curEl.style.transform = `scale(${scale.toFixed(3)})`;
            curEl.style.transformOrigin = 'center center';
          } else {
            curEl.style.transform = '';
            curEl.style.whiteSpace = 'normal';
          }
        }
      }
    }

    if (curLineIdx !== prevCurLine) {
      const containerH = lyricsInner.clientHeight;
      const lineTop = curEl.offsetTop;
      const lineH = curEl.offsetHeight;
      lyricsInner.scrollTo({
        top: lineTop - containerH / 2 + lineH / 2,
        behavior: 'smooth'
      });
    }

    prevCurLine = curLineIdx;

  } else {
    let cur = -1;
    for (let i = 0; i < lrc.length; i++) {
      if (t >= lrc[i].time) cur = i; else break;
    }
    if (cur === -1) return;
    const di = cur + 1;
    const curEl = lineEls[di];
    // 行切换时才更新 classList 和清除其他行缩放, 避免每帧遍历
    if (cur !== prevCurLine) {
      lineEls.forEach((el, i) => {
        if (i === di) {
          el.classList.add('cur');
          el.classList.remove('done');
        } else if (i < di) {
          el.classList.remove('cur');
          el.classList.add('done');
          el.style.whiteSpace = '';
        } else {
          el.classList.remove('cur', 'done');
          el.style.whiteSpace = '';
        }
      });
      lineEls.forEach((el, i) => { if (i !== di) el.style.transform = ''; });
    }
    if (curEl) {
      const containerW = lyricsInner.clientWidth - 24;
      const lineW = curEl.offsetWidth;
      if (lineW > containerW && containerW > 0) {
        const scale = containerW / lineW;
        if (scale >= 0.5) {
          curEl.style.transform = `scale(${scale.toFixed(3)})`;
          curEl.style.transformOrigin = 'center center';
          curEl.style.whiteSpace = '';
        } else {
          curEl.style.transform = '';
          curEl.style.whiteSpace = 'normal';
        }
      } else {
        curEl.style.transform = '';
        curEl.style.whiteSpace = '';
      }

      if (appSettings.simulateLrcProgress && curEl.classList.contains('lyric-simulated')) {
        const lineStart = lrc[cur].time;
        const charCount = lrc[cur].text ? lrc[cur].text.length : 5;
        const lineEnd = (cur + 1 < lrc.length) ? lrc[cur + 1].time : lineStart + Math.max(2, charCount * 0.4);
        const span = lineEnd - lineStart;
        const progress = span > 0 ? Math.max(0, Math.min(1, (t - lineStart) / span)) : 1;
        const pPct = progress * 100;
        curEl.style.setProperty('--p', pPct.toFixed(2) + '%');
      }
    }
    if (curEl && cur !== prevCurLine) {
      const containerH = lyricsInner.clientHeight;
      const lineTop = curEl.offsetTop;
      const lineH = curEl.offsetHeight;
      lyricsInner.scrollTo({
        top: lineTop - containerH / 2 + lineH / 2,
        behavior: 'smooth'
      });
    }
    prevCurLine = cur;
  }
}
