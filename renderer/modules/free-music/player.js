// =========== 免费听音乐专区 - 试听播放与歌词 ===========
// 从 free-music.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// 试听: 套壳到主播放器 (复用主 audio 元素 + 封面 + 歌词区, 不污染本地歌库)
// skipSources: 已尝试失败被跳过的源(自动换源时使用)
// 使用请求 ID 竞态保护, 避免 audio error 和 play() reject 两条路径同时触发换源导致递归混乱
let _fmPreviewReqId = 0;
async function playFmPreview(song, itemEl, skipSources) {
  skipSources = skipSources || [];
  const reqId = ++_fmPreviewReqId;
  const btn = itemEl ? itemEl.querySelector('.fm-result-play') : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '...'; }

  // 如果正在试听同一首, 切换暂停/播放
  if (fmPreviewMode && fmPreviewSong && fmPreviewSong.id === song.id && fmPreviewSong.source === song.source && !skipSources.length) {
    if (audio.paused) {
      audio.play().catch(e => console.error('[FREE-MUSIC] 播放失败:', e.message));
    } else {
      audio.pause();
    }
    if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; }
    return;
  }

  // 如果主播放器正在播放本地歌曲, 先暂停并保存进度
  if (!fmPreviewMode && typeof isPlaying !== 'undefined' && isPlaying) {
    audio.pause();
    saveCurrentProgress();
  }
  // 重置视频模式(防止从汽水视频试听切换过来时残留)
  if (typeof setVideoMode === 'function' && !skipSources.length) setVideoMode(false);

  // 封面统一性: skipSources 非空表示换源, 标记后 updNowPlaying/setCoverImage 跳过封面更新
  _fmSwitchingSource = skipSources.length > 0;

  try {
    const urlRes = await window.freeMusicAPI.streamUrl(song);
    if (reqId !== _fmPreviewReqId) return;  // 竞态: 已被新调用取代
    if (!urlRes.ok) throw new Error(urlRes.message);
    const url = urlRes.data;

    // 进入试听模式
    fmPreviewMode = true;
    fmPreviewSong = song;
    fmPreviewSong._skipSources = skipSources;
    fmPreviewSong._originItemEl = itemEl;
    _fmCurrentSong = song;
    _fmTryingFallback = skipSources.length > 0;  // 换源时不重置守卫, 避免双重触发

    // 构建试听队列 (从当前点击位置之后的搜索结果)
    buildFmPreviewQueue(song);

    // 清空主播放器歌词 (试听模式使用 fmPreviewLrc, 但渲染复用 lrc 变量)
    lrc = [];
    lrcRaw = false;
    fmPreviewLrc = [];
    fmPreviewLrcRaw = false;
    fmPreviewLrcText = '';
    fmPreviewHasValidLrc = false;
    prevCurLine = -1;
    lineMetrics = [];
    _cachedLineEls = null;
    renderLrc();  // 立即清理上一首歌词 DOM, 避免残留
    // 同步清空桌面歌词 (避免上一首歌词残留)
    if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();

    // 设置主播放器 UI
    empty.classList.add('hidden');
    player.classList.remove('hidden');
    lyrics.classList.remove('hidden');
    titleEl.textContent = song.name || '未知歌曲';
    artistEl.textContent = song.artist || '';
    updLikeBtn();
    updNowPlaying();  // 同步左下角正在播放信息
    // 同步歌曲信息到桌面歌词
    if (desktopLyricOn && typeof window.desktopLyric !== 'undefined') {
      window.desktopLyric.send({ type: 'info', info: { title: song.name || '', artist: song.artist || '' } });
    }

    // 封面 (coverUnify=true 时换源跳过, 切歌正常更新)
    const validCover = song.cover && !song.cover.includes('placeholder.com');
    setCoverImage(validCover ? song.cover : null, _fmSwitchingSource);
    if (coverEl) coverEl.classList.toggle('disc', appSettings.discCover);
    // 提取封面主色作为背景渐变 (免费听封面是远程 URL, applyCoverBackground 内部自动识别)
    // 之前传 null 会导致背景被清空, 出现"无封面色"问题
    applyCoverBackground(validCover ? song.cover : null);

    // 音频: 用主 audio 元素播放流式 URL
    // 先清除旧 src 避免上一首的 play() Promise 被中断时触发 error 事件
    audio.removeAttribute('src');
    audio.load();
    audio.src = url;
    audio.currentTime = 0;
    await audio.play();
    if (reqId !== _fmPreviewReqId) return;  // 竞态: play() 期间已被新调用取代
    if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; }
    _fmTryingFallback = false;  // 播放成功, 重置守卫
    _fmSwitchingSource = false;  // 播放成功, 重置换源标志

    // 异步加载歌词 (复用主播放器歌词渲染)
    loadFmLyricToMain(song);

    // 更新保存按钮
    updateFmSaveButton();
  } catch (e) {
    // 竞态: 已被新调用取代, 不触发换源
    if (reqId !== _fmPreviewReqId) return;
    console.error('[FREE-MUSIC] 试听失败:', e.message, '|', song.source, song.id);
    // 尝试自动换源: 优先从搜索结果中找同名同歌手的其他源
    const alt = findFmAlternativeSong(song, skipSources);
    if (alt) {
      if (typeof showToast === 'function') showToast(`${song.source} 源不可用, 正在尝试 ${alt.song.source}...`, 'info');
      if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; }
      _fmTryingFallback = true;
      // 立即更新 UI, 让用户看到换源后的新信息
      updateFmPreviewUI(alt.song);
      return playFmPreview(alt.song, alt.itemEl, alt.skipSources);
    }
    // 搜索结果中无替代源: 调用 switch_source API 跨源搜索
    if (typeof window.freeMusicAPI.switchSource === 'function') {
      try {
        if (typeof showToast === 'function') showToast(`${song.source} 源不可用, 正在跨源搜索...`, 'info');
        if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; }
        _fmTryingFallback = true;
        // 超时保护: switchSource 服务端并行8源搜索可能很慢, 限制 20s
        const swRes = await Promise.race([
          window.freeMusicAPI.switchSource(song),
          new Promise((_, reject) => setTimeout(() => reject(new Error('换源超时')), 20000)),
        ]);
        if (reqId !== _fmPreviewReqId) return;
        if (swRes.ok && swRes.data && swRes.data.source !== song.source && !skipSources.includes(swRes.data.source)) {
          const newSkip = [...skipSources, song.source];
          // 立即更新 UI, 让用户看到换源后的新信息
          updateFmPreviewUI(swRes.data);
          return playFmPreview(swRes.data, null, newSkip);
        }
      } catch (swErr) {
        if (reqId !== _fmPreviewReqId) return;
      }
    }
    if (btn) { btn.innerHTML = '✗'; btn.title = e.message; }
    if (typeof showToast === 'function') showToast('试听失败: ' + e.message + ' (所有源均不可用)', 'error');
    setTimeout(() => { if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; } }, 2000);
    _fmTryingFallback = false;
    return;
  }
}

// 构建试听队列 (整个搜索结果, 允许上一首/下一首双向导航)
function buildFmPreviewQueue(song) {
  fmPreviewQueue = [];
  fmPreviewIdx = -1;
  if (!_fmLastResults.length) return;
  const curName = (song.name || '').trim().toLowerCase();
  const curArtist = (song.artist || '').trim().toLowerCase();
  const curSource = song.source;
  // 找到当前歌曲在搜索结果中的位置
  let startIdx = -1;
  for (let i = 0; i < _fmLastResults.length; i++) {
    const s = _fmLastResults[i];
    if (s.id === song.id && s.source === song.source) { startIdx = i; break; }
    // 容错: 同名同源
    const sName = (s.name || '').trim().toLowerCase();
    const sArtist = (s.artist || '').trim().toLowerCase();
    if (sName === curName && sArtist === curArtist && s.source === curSource) { startIdx = i; break; }
  }
  if (startIdx < 0) return;
  // 队列 = 整个搜索结果, fmPreviewIdx 指向当前歌曲
  fmPreviewQueue = _fmLastResults.slice();
  fmPreviewIdx = startIdx;
}

// 试听队列下一首/上一首
function playFmPreviewNext(dir) {
  if (!fmPreviewQueue.length) {
    audio.pause();
    return;
  }
  const newIdx = fmPreviewIdx + dir;
  // 到达队列开头: 不动作 (保持当前歌曲继续播放, 不触发暂停/播放切换)
  if (newIdx < 0) return;
  // 到达队列末尾: 停止播放
  if (newIdx >= fmPreviewQueue.length) {
    audio.pause();
    return;
  }
  fmPreviewIdx = newIdx;
  const nextSong = fmPreviewQueue[fmPreviewIdx];
  const itemEl = fmResultsEl.querySelector(`.fm-result-item[data-idx="${_fmLastResults.indexOf(nextSong)}"]`);
  // 销毁上一首临时歌词 (内存回收)
  destroyFmPreviewLrc();
  playFmPreview(nextSong, itemEl);
}

// 销毁临时歌词数据 (内存回收 + 清理 DOM, 避免切歌时残留上一首歌词)
function destroyFmPreviewLrc() {
  fmPreviewLrc = [];
  fmPreviewLrcRaw = false;
  fmPreviewLrcText = '';
  fmPreviewHasValidLrc = false;
  lrc = [];
  lrcRaw = false;
  prevCurLine = -1;
  lineMetrics = [];
  _cachedLineEls = null;
  // 立即清理 DOM, 避免新歌词加载前残留上一首歌词
  if (typeof renderLrc === 'function') renderLrc();
}

// 从最近搜索结果中查找同名同歌手的其他源歌曲(用于换源回退)
// 返回 { song, itemEl, skipSources } 或 null
function findFmAlternativeSong(currentSong, skipSources) {
  skipSources = skipSources || [];
  const tried = new Set([currentSong.source, ...skipSources]);
  const curName = (currentSong.name || '').trim().toLowerCase();
  const curArtist = (currentSong.artist || '').trim().toLowerCase();
  for (let i = 0; i < _fmLastResults.length; i++) {
    const s = _fmLastResults[i];
    if (tried.has(s.source)) continue;
    const sName = (s.name || '').trim().toLowerCase();
    const sArtist = (s.artist || '').trim().toLowerCase();
    // 名字必须完全一致, 歌手包含匹配(容错"周杰伦 / 方文山"这种)
    if (sName === curName && sArtist && curArtist && (sArtist.includes(curArtist) || curArtist.includes(sArtist))) {
      const itemEl = fmResultsEl.querySelector(`.fm-result-item[data-idx="${i}"]`);
      if (itemEl) {
        return { song: s, itemEl, skipSources: [...skipSources, currentSong.source] };
      }
    }
  }
  return null;
}

// 加载歌词到主播放器 (复用 lrc/lrcRaw + renderLrc/syncLrc)
// 使用请求 ID 竞态保护, 避免快速切歌时旧请求覆盖新请求
let _fmLrcReqId = 0;
async function loadFmLyricToMain(song) {
  const reqId = ++_fmLrcReqId;
  fmPreviewLrc = [];
  fmPreviewLrcRaw = false;
  fmPreviewLrcText = '';
  fmPreviewHasValidLrc = false;
  lrc = [];
  lrcRaw = false;
  renderLrc();
  updateFmSaveButton();
  try {
    const res = await window.freeMusicAPI.lyric(song);
    // 竞态检查: 如果期间已切到其他歌曲, 丢弃本次结果
    if (reqId !== _fmLrcReqId) return;
    if (!res.ok || !res.data) {
      lrc = [{ time: 0, text: '纯音乐，请欣赏' }];
      lrcRaw = false;
      renderLrc();
      updateFmSaveButton();
      // 同步桌面歌词 (纯音乐也需更新, 避免上一首残留)
      if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
      return;
    }
    fmPreviewLrcText = res.data;
    // 尝试逐字解析 (KRC 格式)
    const rawParsed = parseRaw(res.data);
    if (rawParsed.length) {
      fmPreviewLrc = rawParsed;
      fmPreviewLrcRaw = true;
      fmPreviewHasValidLrc = rawParsed.length > 2;
    } else {
      // 尝试逐字LRC格式 ([mm:ss.xx]字[mm:ss.xx]字...)
      const enhanced = parseEnhancedLRC(res.data);
      if (enhanced.length) {
        fmPreviewLrc = enhanced;
        fmPreviewLrcRaw = true;
        fmPreviewHasValidLrc = enhanced.length > 2;
      } else {
        // 回退到普通 LRC
        const lrcParsed = parseLRC(res.data);
        fmPreviewLrc = lrcParsed;
        fmPreviewLrcRaw = false;
        fmPreviewHasValidLrc = lrcParsed.length > 2;
      }
    }
    // 再次竞态检查 (解析耗时)
    if (reqId !== _fmLrcReqId) return;
    // 同步到主播放器歌词变量 (复用渲染逻辑)
    lrc = fmPreviewLrc.length ? fmPreviewLrc : [{ time: 0, text: '纯音乐，请欣赏' }];
    lrcRaw = fmPreviewLrcRaw;
    prevCurLine = -1;
    lineMetrics = [];
    _cachedLineEls = null;
    renderLrc();
    syncLrc(audio.currentTime || 0);
    updateFmSaveButton();
    // 同步桌面歌词 (试听歌词加载完成, 推送到桌面歌词窗口)
    if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
  } catch (e) {
    if (reqId !== _fmLrcReqId) return;
    lrc = [{ time: 0, text: '纯音乐，请欣赏' }];
    lrcRaw = false;
    renderLrc();
    updateFmSaveButton();
    // 同步桌面歌词 (错误时也需更新, 避免上一首残留)
    if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
    console.error('[FREE-MUSIC] 歌词获取失败:', e.message);
  }
}

// 更新保存按钮状态 (无论是否有歌词都允许保存)
function updateFmSaveButton() {
  if (!fmDownload) return;
  // 优先检测是否已在歌库
  if (fmPreviewSong && isFmSongInLibrary(fmPreviewSong)) {
    fmDownload.disabled = true;
    fmDownload.textContent = '已添加';
    fmDownload.title = '此歌曲已在本地歌库中';
    return;
  }
  // 不在歌库中即可保存 (纯音乐/无歌词歌曲也允许添加, 保存时仅跳过 .lrc 文件)
  fmDownload.disabled = false;
  fmDownload.textContent = '保存到歌库';
  fmDownload.title = '保存到本地歌库';
}

// 简单 LRC 解析
function parseFmLrc(text) {
  const lines = [];
  const re = /\[(\d+):(\d+)\.(\d+)\](.*)/;
  text.split('\n').forEach(line => {
    const m = re.exec(line.trim());
    if (m) {
      const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 1000;
      const t = m[4].trim();
      if (t) lines.push({ time, text: t });
    }
  });
  return lines.sort((a, b) => a.time - b.time);
}
