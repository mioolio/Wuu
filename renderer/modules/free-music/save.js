// =========== 免费听音乐专区 - 保存到歌库与工具函数 ===========
// 从 free-music.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// 保存到本地歌库 (无论是否有歌词都允许保存; 无歌词时仅跳过 .lrc 文件)
// btn: 触发保存的按钮元素(列表下载按钮或播放器下载按钮)
async function saveFmSongToLibrary(song, btn) {
  // 已在歌库中的歌曲不重复保存 (省带宽)
  if (isFmSongInLibrary(song)) {
    if (typeof showToast === 'function') showToast('此歌曲已在歌库中', 'info');
    if (btn) { btn.innerHTML = '✓'; btn.disabled = true; btn.classList.add('fm-dl-added'); }
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '...'; }

  // 汽水音乐源: 走 qishuiAPI.importSong 独立通道 (免费音乐后端不识别 qishui source)
  if (song.source === 'qishui' && typeof window.qishuiAPI !== 'undefined') {
    try {
      if (typeof showToast === 'function') showToast('开始保存: ' + song.name, 'info');
      // session 信息从 qishui-import 全局取
      const aid = typeof qsSession !== 'undefined' ? qsSession.aid : '';
      const sessionid = typeof qsSession !== 'undefined' ? qsSession.sessionid : '';
      const quality = typeof QS_IMPORT_QUALITY !== 'undefined' ? QS_IMPORT_QUALITY : 'high';
      // mediaType: 视频歌曲/UGC创作走 video_v2 端点, 否则走 track_v2
      const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
      const vid = song.vid || song.videoId || '';
      const songMeta = {
        name: song.name,
        artist: song.artist,
        album: song.album || '',
        cover: song.cover || '',
      };
      const res = await window.qishuiAPI.importSong(aid, sessionid, song.id, quality, songMeta, mediaType, vid);
      if (!res || !res.ok) throw new Error((res && res.message) || '导入失败');
      if (typeof showToast === 'function') showToast('已保存到歌库: ' + song.name, 'success');
      if (btn) { btn.innerHTML = '✓'; btn.disabled = true; btn.classList.add('fm-dl-added'); btn.title = '已保存'; }
      // 刷新主播放器歌库
      await refreshMainLibrary();
      // 更新搜索结果中同名歌曲的"已添加"状态
      markFmSongAsAdded(song);
      // 更新播放器右上角"添加"按钮为"已添加"状态
      if (typeof updLikeBtn === 'function') updLikeBtn();
    } catch (e) {
      console.error('[FREE-MUSIC:save] 保存失败 song=' + song.name + ':', e.message);
      if (typeof showToast === 'function') showToast('保存失败: ' + e.message, 'error');
      if (btn) { btn.innerHTML = '✗'; btn.title = e.message; }
    }
    setTimeout(() => { if (btn && !btn.classList.contains('fm-dl-added')) { btn.innerHTML = ICON_DOWNLOAD; btn.disabled = false; } }, 3000);
    return;
  }

  // 网易云音乐源: 走 neteaseAPI.importSong 独立通道 (免费音乐后端不识别 netease source, 会 404)
  if (song.source === 'netease' && typeof window.neteaseAPI !== 'undefined' && typeof window.neteaseAPI.importSong === 'function') {
    try {
      if (typeof showToast === 'function') showToast('开始保存: ' + song.name, 'info');
      const quality = typeof WY_IMPORT_QUALITY !== 'undefined' ? WY_IMPORT_QUALITY : 'high';
      // song._originSong 保留了原始 song 对象(含 id, name, artist 等), 传给后端用于元数据提取
      const originSong = song._originSong || { id: song.id, name: song.name, artist: song.artist };
      const res = await window.neteaseAPI.importSong(song.id, quality, originSong, null);
      if (!res || !res.ok) throw new Error((res && res.message) || '导入失败');
      if (typeof showToast === 'function') showToast('已保存到歌库: ' + song.name, 'success');
      if (btn) { btn.innerHTML = '✓'; btn.disabled = true; btn.classList.add('fm-dl-added'); btn.title = '已保存'; }
      await refreshMainLibrary();
      markFmSongAsAdded(song);
      if (typeof updLikeBtn === 'function') updLikeBtn();
    } catch (e) {
      console.error('[FREE-MUSIC:save] 网易云保存失败 song=' + song.name + ':', e.message);
      if (typeof showToast === 'function') showToast('保存失败: ' + e.message, 'error');
      if (btn) { btn.innerHTML = '✗'; btn.title = e.message; }
    }
    setTimeout(() => { if (btn && !btn.classList.contains('fm-dl-added')) { btn.innerHTML = ICON_DOWNLOAD; btn.disabled = false; } }, 3000);
    return;
  }

  // 判断是否当前正在试听的歌曲(复用已缓存的歌词)
  const isCurrent = fmPreviewSong && fmPreviewSong.id === song.id && fmPreviewSong.source === song.source;
  let lrcText = isCurrent ? fmPreviewLrcText : '';

  // 未试听过的歌曲, 重新获取歌词 (获取失败不影响保存, 仅跳过 .lrc 文件)
  if (!isCurrent) {
    try {
      const lrcRes = await window.freeMusicAPI.lyric(song);
      if (lrcRes.ok && lrcRes.data) {
        lrcText = lrcRes.data;
      }
    } catch (e) {
      // 歌词获取失败, 继续保存流程 (纯音乐/无歌词歌曲也允许添加)
      lrcText = '';
    }
  }

  if (typeof showToast === 'function') showToast('开始保存: ' + song.name, 'info');
  try {
    const res = await window.freeMusicAPI.saveToLibrary(song, lrcText);
    if (!res.ok) throw new Error(res.message);
    if (typeof showToast === 'function') showToast('已保存到歌库: ' + song.name, 'success');
    if (btn) { btn.innerHTML = '✓'; btn.disabled = true; btn.classList.add('fm-dl-added'); btn.title = '已保存: ' + res.data.path; }
    // 刷新主播放器歌库
    await refreshMainLibrary();
    // 更新搜索结果中同名歌曲的"已添加"状态 (省去重新搜索)
    markFmSongAsAdded(song);
    // 更新播放器右上角"添加"按钮为"已添加"状态
    if (typeof updLikeBtn === 'function') updLikeBtn();
  } catch (e) {
    console.error('[FREE-MUSIC:save] 保存失败 song=' + song.name + ':', e.message);
    if (typeof showToast === 'function') showToast('保存失败: ' + e.message, 'error');
    if (btn) { btn.innerHTML = '✗'; btn.title = e.message; }
  }
  // 保存成功时按钮保持"已添加"状态, 失败时恢复下载按钮
  setTimeout(() => { if (btn && !btn.classList.contains('fm-dl-added')) { btn.innerHTML = ICON_DOWNLOAD; btn.disabled = false; } }, 3000);
}

// 保存成功后, 更新搜索结果中同名歌曲的"已添加"状态 (避免重新搜索)
function markFmSongAsAdded(savedSong) {
  const savedName = (savedSong.name || '').trim().toLowerCase();
  const savedArtists = (typeof splitArtistTokens === 'function' ? splitArtistTokens(savedSong.artist) : [])
    .map(a => a.toLowerCase().trim());
  // 遍历搜索结果和歌单详情中的所有歌曲项
  const containers = [fmResultsEl, fmPlaylistSongsEl];
  containers.forEach(container => {
    if (!container) return;
    container.querySelectorAll('.fm-result-item').forEach(item => {
      const idx = parseInt(item.dataset.idx);
      if (isNaN(idx) || !_fmLastResults[idx]) return;
      const s = _fmLastResults[idx];
      const sName = (s.name || '').trim().toLowerCase();
      if (sName !== savedName) return;
      const sArtists = (typeof splitArtistTokens === 'function' ? splitArtistTokens(s.artist) : [])
        .map(a => a.toLowerCase().trim());
      const artistMatch = !savedArtists.length || !sArtists.length ||
        savedArtists.some(sa => sArtists.some(sa2 => sa === sa2));
      if (!artistMatch) return;
      // 添加"已添加"标记
      const nameEl = item.querySelector('.fm-result-name');
      if (nameEl && !nameEl.querySelector('.fm-added-badge')) {
        nameEl.insertAdjacentHTML('beforeend', '<span class="fm-added-badge">已添加</span>');
      }
      const dlBtn = item.querySelector('.fm-result-dl');
      if (dlBtn && !dlBtn.classList.contains('fm-dl-added')) {
        dlBtn.classList.add('fm-dl-added');
        dlBtn.innerHTML = '✓';
        dlBtn.disabled = true;
        dlBtn.title = '已在歌库中';
      }
    });
  });
}

// 刷新主播放器歌库(保存到 output/ 后调用)
async function refreshMainLibrary() {
  try {
    if (typeof window.musicAPI !== 'undefined' && window.musicAPI.getSongs) {
      const songList = await window.musicAPI.getSongs();
      songs = songList;
      // 歌库变化后 shuffle 队列索引失效, 重新洗牌 home 和 liked 两个队列
      if (typeof buildShuffleQueue === 'function') {
        buildShuffleQueue('home');
        buildShuffleQueue('liked');
      }
      if (typeof renderList === 'function') renderList();
      if (typeof renderFloatList === 'function') renderFloatList();
      if (typeof updCur === 'function') updCur();
    }
  } catch (e) {
    console.error('[FREE-MUSIC] 刷新歌库失败:', e.message);
  }
}

// 退出试听模式 (清理临时数据, 恢复主播放器空状态)
function exitFmPreviewMode() {
  if (!fmPreviewMode) return;
  // 使挂起的试听/歌词请求失效 (避免退出后旧请求覆盖已清空的状态)
  _fmPreviewReqId++;
  _fmLrcReqId++;
  // 停止音频
  if (!audio.paused) audio.pause();
  audio.removeAttribute('src');
  audio.load();
  // 退出视频模式 (隐藏 video 元素, 恢复封面显示)
  if (typeof setVideoMode === 'function') setVideoMode(false);
  // 销毁临时歌词 (内存回收)
  destroyFmPreviewLrc();
  // 清空桌面歌词 (避免试听歌词残留)
  if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
  // 重置试听状态
  fmPreviewMode = false;
  fmPreviewSong = null;
  fmPreviewQueue = [];
  fmPreviewIdx = -1;
  _fmCurrentSong = null;
  _fmTryingFallback = false;
  _fmSwitchingSource = false;  // 重置换源标志
  // 恢复主播放器空状态
  empty.classList.remove('hidden');
  player.classList.add('hidden');
  lyrics.classList.add('hidden');
  applyCoverBackground(null);
  // 重置 UI (左下角同步恢复)
  if (typeof updCur === 'function') updCur();
  if (typeof updNowPlaying === 'function') updNowPlaying();
  if (typeof updLikeBtn === 'function') updLikeBtn();
  updateFmSaveButton();
}

// 兼容旧调用
function stopFreeMusicPreview() { exitFmPreviewMode(); }

// 主 audio error 事件处理 (试听模式下的换源回退)
// 任意源(含 kugou)失败时均尝试 fallback 到替代源
async function handleFmAudioError() {
  if (!fmPreviewMode || !fmPreviewSong) return;
  // 远程歌单试听: 无替代源可换, 直接退出试听模式并提示
  // (playlist 源不在 _fmLastResults 中, findFmAlternativeSong 会返回 null,
  //  switchSource 跨源搜索也不适用, 直接退出避免无意义等待)
  if (fmPreviewSong.source === 'playlist') {
    if (typeof showToast === 'function') {
      showToast('远程音频加载失败, 请检查网络或对方服务', 'error');
    }
    exitFmPreviewMode();
    return;
  }
  // 守卫: 正在换源中, 不重复触发 (避免与 playFmPreview 的 catch 路径冲突)
  if (_fmTryingFallback) return;
  const err = audio.error;
  // 换源回退: 优先从搜索结果中找同名同歌手的其他源
  const skipSources = fmPreviewSong._skipSources || [];
  const alt = findFmAlternativeSong(fmPreviewSong, skipSources);
  if (alt) {
    if (typeof showToast === 'function') showToast(`${fmPreviewSong.source} 源加载失败, 正在尝试 ${alt.song.source}...`, 'info');
    _fmTryingFallback = true;
    // 立即更新 UI (封面/歌名/歌手), 让用户看到换源后的新信息, 不必等 streamUrl 返回
    updateFmPreviewUI(alt.song);
    audio.removeAttribute('src');
    audio.load();
    playFmPreview(alt.song, alt.itemEl, alt.skipSources);
    return;
  }
  // 搜索结果中无替代源: 调用 switch_source API 跨源搜索
  if (typeof window.freeMusicAPI.switchSource === 'function') {
    _fmTryingFallback = true;
    if (typeof showToast === 'function') showToast(`${fmPreviewSong.source} 源加载失败, 正在跨源搜索...`, 'info');
    audio.removeAttribute('src');
    audio.load();
    try {
      // 超时保护: switchSource 服务端并行8源搜索可能很慢, 限制 20s 避免长时间卡顿
      const swRes = await Promise.race([
        window.freeMusicAPI.switchSource(fmPreviewSong),
        new Promise((_, reject) => setTimeout(() => reject(new Error('换源超时')), 20000)),
      ]);
      if (!fmPreviewMode) return;  // 期间已退出试听
      if (swRes.ok && swRes.data && swRes.data.source !== fmPreviewSong.source && !skipSources.includes(swRes.data.source)) {
        const newSkip = [...skipSources, fmPreviewSong.source];
        // 立即更新 UI, 让用户看到换源后的新信息
        updateFmPreviewUI(swRes.data);
        playFmPreview(swRes.data, null, newSkip);
        return;
      }
    } catch (swErr) {
      if (!fmPreviewMode) return;
    }
    _fmTryingFallback = false;
  }
  if (typeof showToast === 'function') showToast('音频加载失败 (code=' + (err ? err.code : '?') + '), 所有源均不可用', 'error');
  _fmTryingFallback = false;
}

// 更新试听 UI (歌名/歌手/封面/桌面歌词信息), 用于换源时立即反馈
// 封面统一性: updateFmPreviewUI 仅在换源流程中被调用, 始终传 suppress=true
// 让 setCoverImage 跳过封面更新, 保留原封面 (切歌时由 playFmPreview 走 suppress=false 路径)
function updateFmPreviewUI(song) {
  fmPreviewSong = song;
  titleEl.textContent = song.name || '未知歌曲';
  artistEl.textContent = song.artist || '';
  // 换源中标志, 让 updNowPlaying 也跳过左下角小封面更新
  _fmSwitchingSource = true;
  updNowPlaying();
  if (desktopLyricOn && typeof window.desktopLyric !== 'undefined') {
    window.desktopLyric.send({ type: 'info', info: { title: song.name || '', artist: song.artist || '' } });
  }
  const validCover = song.cover && !song.cover.includes('placeholder.com');
  setCoverImage(validCover ? song.cover : null, true);
}

// 试听播放器事件 (精简: 只保留保存按钮和关闭按钮)
function initFmPlayerEvents() {
  fmDownload.addEventListener('click', async () => {
    if (!fmPreviewSong) return;
    // 无论是否有歌词都允许保存 (无歌词时仅跳过 .lrc 文件)
    saveFmSongToLibrary(fmPreviewSong, fmDownload);
  });
}

// 工具函数
function fmtFmTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// 异步探测歌曲大小/码率并填充到 meta 容器
// 探测失败时自动换源重试 (与 exe 网页面板行为一致), 最多重试 2 次避免死循环
// 探测并发限制: 避免搜索结果过多时同时发起大量请求阻塞主进程
let _inspectConcurrent = 0;
const _inspectQueue = [];
const INSPECT_MAX_CONCURRENT = 3;
async function inspectFmSong(song, metaEl) {
  if (!metaEl) return;
  // 排队等待, 限制并发数
  if (_inspectConcurrent >= INSPECT_MAX_CONCURRENT) {
    await new Promise(resolve => _inspectQueue.push(resolve));
  }
  _inspectConcurrent++;
  try {
    let currentSong = song;
    const triedSources = new Set([song.source]);
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const r = await window.freeMusicAPI.inspect(currentSong);
        if (r.ok && r.data.valid) {
          const parts = [];
          if (r.data.size) parts.push(`<span class="fm-meta-size">${escapeFmHtml(r.data.size)}</span>`);
          if (r.data.bitrate && r.data.bitrate !== '-') parts.push(`<span class="fm-meta-bitrate">${escapeFmHtml(r.data.bitrate)}</span>`);
          metaEl.innerHTML = parts.length ? parts.join('<span class="fm-meta-sep">·</span>') : '<span class="fm-meta-err">无信息</span>';
          return;
        }
      } catch (e) { /* 忽略, 继续换源 */ }
      if (attempt >= 2) break;
      if (triedSources.size >= 8) break;
      try {
        const sw = await window.freeMusicAPI.switchSource(currentSong);
        if (!sw.ok || !sw.data || triedSources.has(sw.data.source)) break;
        currentSong = { ...currentSong, ...sw.data };
        triedSources.add(currentSong.source);
        if (metaEl.closest('.fm-result-item')) {
          const idx = parseInt(metaEl.closest('.fm-result-item').dataset.idx);
          if (!isNaN(idx) && _fmLastResults[idx]) {
            _fmLastResults[idx] = { ..._fmLastResults[idx], ...sw.data };
          }
        }
      } catch (e) {
        break;
      }
    }
    metaEl.innerHTML = '<span class="fm-meta-err">不可用</span>';
  } finally {
    _inspectConcurrent--;
    if (_inspectQueue.length > 0) {
      const next = _inspectQueue.shift();
      next();
    }
  }
}
function escapeFmHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function escapeFmAttr(s) {
  if (!s) return '';
  return String(s).replace(/"/g, '&quot;');
}
