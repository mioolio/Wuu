// =========== 汽水音乐歌单导入 - 试听与导入 ===========
// 从 qishui-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 试听 (套壳到主播放器, 复用 fmPreviewMode 状态) ----
async function playQsPreview(idx) {
  const song = qsCurrentTracks[idx];
  if (!song) return;
  const trackId = qsGetTrackId(song);
  // UGC 创作歌曲(isUgcClip=true)和视频类型(isVideo=true)用 vid 走 video_v2 端点
  const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
  // vid: UGC 创作歌曲的关键标识, 用于 video_v2 端点请求
  const vid = song.vid || song.videoId || '';
  console.log('[QS-DEBUG] playQsPreview idx=' + idx + ' trackId=' + trackId + ' vid=' + vid + ' mediaType=' + mediaType + ' isUgcClip=' + !!song.isUgcClip);
  if (!trackId && !vid) {
    if (typeof showToast === 'function') showToast('无法试听: 该歌曲缺少 trackId/vid (可能已下架)', 'error');
    return;
  }
  const reqId = ++_qsPreviewReqId;

  // 暂停本地播放器
  if (!fmPreviewMode && typeof isPlaying !== 'undefined' && isPlaying) {
    audio.pause();
    if (typeof saveCurrentProgress === 'function') saveCurrentProgress();
  }

  try {
    const songMeta = {
      name: qsGetTrackTitle(song),
      artist: qsGetTrackArtist(song),
      album: qsGetTrackAlbum(song),
      cover: qsGetTrackCover(song),
    };
    const res = await window.qishuiAPI.preview(
      qsSession.aid,
      qsSession.sessionid,
      trackId,
      QS_PREVIEW_QUALITY,
      mediaType,
      songMeta,
      vid  // 传递 vid (UGC 创作歌曲的关键标识)
    );
    if (reqId !== _qsPreviewReqId) return;  // 竞态: 已被新调用取代
    if (!res || !res.ok) {
      const msg = (res && res.message) || '试听失败';
      // 常见错误友好提示
      if (msg.includes('quality') && msg.includes('not found')) {
        throw new Error('该歌曲没有可用的音质');
      }
      if (msg.includes('video_model not found') || msg.includes('no downloadable')) {
        throw new Error('该歌曲暂无可用音频(可能需要VIP或已下架)');
      }
      throw new Error(msg);
    }
    // 后端返回 { ok, data: { url, title, artist, cover, duration, krc, lrc, isVideo } }
    const data = res.data || {};
    const url = data.url || '';
    if (!url) throw new Error('未获取到试听地址');
    // 视频类型: 切换到视频模式(显示画面)
    const isVideoContent = !!data.isVideo;
    if (typeof setVideoMode === 'function') setVideoMode(isVideoContent);

    // 进入试听模式
    fmPreviewMode = true;
    qsPreviewIdx = idx;
    const coverUrl = qsGetTrackCover(song) || (data.cover && !data.cover.includes('placeholder.com') ? data.cover : '');
    fmPreviewSong = {
      id: trackId,
      source: 'qishui',
      name: data.title || qsGetTrackTitle(song),
      artist: data.artist || qsGetTrackArtist(song),
      cover: coverUrl,
      mediaType: mediaType,  // 保存时传给 qishuiAPI.importSong
      vid: vid,  // 保存时传给 qishuiAPI.importSong (UGC 创作歌曲的关键标识)
      isVideo: song.isVideo || false,
      isUgcClip: song.isUgcClip || false,
      isVideoContent: isVideoContent,  // 后端返回的视频内容标记
      _originSong: song,
    };

    // 清空旧歌词
    lrc = [];
    lrcRaw = false;
    prevCurLine = -1;
    lineMetrics = [];
    _cachedLineEls = null;
    if (typeof renderLrc === 'function') renderLrc();
    if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();

    // 主播放器 UI
    empty.classList.add('hidden');
    player.classList.remove('hidden');
    lyrics.classList.remove('hidden');
    titleEl.textContent = data.title || qsGetTrackTitle(song);
    artistEl.textContent = data.artist || qsGetTrackArtist(song);
    // 显示作词/作曲信息 (来自 track.song_maker_team)
    if (creditsEl) {
      const parts = [];
      if (data.lyricist) parts.push('作词: ' + data.lyricist);
      if (data.composer) parts.push('作曲: ' + data.composer);
      if (parts.length) {
        creditsEl.textContent = parts.join('  ');
        creditsEl.classList.remove('missing');
      } else {
        creditsEl.textContent = '';
        creditsEl.classList.remove('missing');
      }
    }
    if (typeof updLikeBtn === 'function') updLikeBtn();
    if (typeof updNowPlaying === 'function') updNowPlaying();
    if (typeof desktopLyricOn !== 'undefined' && desktopLyricOn && typeof window.desktopLyric !== 'undefined') {
      window.desktopLyric.send({ type: 'info', info: { title: data.title || qsGetTrackTitle(song), artist: data.artist || qsGetTrackArtist(song) } });
    }

    // 封面 (coverUnify=true 时锁定首次封面状态)
    setCoverImage(coverUrl || null);
    if (coverEl) coverEl.classList.toggle('disc', appSettings.discCover);
    // 提取封面主色作为背景渐变 (汽水封面是远程 URL, applyCoverBackground 内部自动识别)
    // 之前传 null 会导致背景被清空, 出现"无封面色"问题
    if (typeof applyCoverBackground === 'function') applyCoverBackground(coverUrl || null);

    // 音频
    audio.removeAttribute('src');
    audio.load();
    audio.src = url;
    audio.currentTime = 0;
    await audio.play();
    if (reqId !== _qsPreviewReqId) return;

    // 加载歌词 (若有) - 后端返回 data.krc (raw格式) 和 data.lrc (LRC格式)
    loadQsLyricToMain(data.krc, data.lrc, null);
  } catch (e) {
    if (reqId !== _qsPreviewReqId) return;
    if (typeof showToast === 'function') showToast('试听失败: ' + e.message, 'error');
    // 试听失败, 退出试听模式 + 重置视频模式
    if (typeof setVideoMode === 'function') setVideoMode(false);
    if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'qishui') {
      if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
    }
  }
}

// 加载歌词到主播放器 (优先 raw 逐字, 回退 lrc)
function loadQsLyricToMain(rawText, lrcText, lrcDirect) {
  if (typeof parseRaw !== 'function' && typeof parseLRC !== 'function') return;
  lrc = [];
  lrcRaw = false;
  if (typeof renderLrc === 'function') renderLrc();

  let parsed = [];
  let isRaw = false;
  // 直接传入已解析歌词
  if (Array.isArray(lrcDirect) && lrcDirect.length) {
    parsed = lrcDirect;
  } else if (rawText && typeof parseRaw === 'function') {
    const rawParsed = parseRaw(rawText);
    if (rawParsed.length) { parsed = rawParsed; isRaw = true; }
  }
  if (!parsed.length && lrcText) {
    if (typeof parseEnhancedLRC === 'function') {
      const enhanced = parseEnhancedLRC(lrcText);
      if (enhanced.length) { parsed = enhanced; isRaw = true; }
      else if (typeof parseLRC === 'function') { parsed = parseLRC(lrcText); }
    } else if (typeof parseLRC === 'function') {
      parsed = parseLRC(lrcText);
    }
  }

  lrc = parsed.length ? parsed : [{ time: 0, text: videoMode ? '视频请欣赏' : '纯音乐，请欣赏' }];
  lrcRaw = isRaw;
  prevCurLine = -1;
  lineMetrics = [];
  _cachedLineEls = null;
  if (typeof renderLrc === 'function') renderLrc();
  if (typeof syncLrc === 'function') syncLrc(audio.currentTime || 0);
  if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
}

// 退出汽水试听
function exitQsPreview() {
  if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'qishui') {
    if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
  }
  qsPreviewIdx = -1;
}

// ---- 单首导入 ----
async function importSingleQsTrack(idx) {
  if (qsImporting) return;
  const song = qsCurrentTracks[idx];
  if (!song) return;
  if (!qsSession) {
    if (typeof showToast === 'function') showToast('请先登录', 'error');
    return;
  }
  const trackId = qsGetTrackId(song);
  const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
  const vid = song.vid || song.videoId || '';
  if (!trackId && !vid) {
    if (typeof showToast === 'function') showToast('无法导入: 缺少 trackId/vid', 'error');
    return;
  }
  const row = qsTrackList.querySelector(`tr[data-idx="${idx}"]`);
  const btn = row ? row.querySelector('.qs-import-one') : null;
  if (btn) { btn.disabled = true; btn.textContent = '导入中'; }

  qsProgress.classList.remove('hidden');
  qsProgressFill.style.width = '0%';
  qsProgressText.textContent = '正在导入: ' + qsGetTrackTitle(song);

  try {
    const res = await window.qishuiAPI.importSong(
      qsSession.aid,
      qsSession.sessionid,
      trackId,
      QS_IMPORT_QUALITY,
      song,
      mediaType,
      vid  // 传递 vid (UGC 创作歌曲的关键标识)
    );
    if (res && res.ok) {
      if (btn) { btn.textContent = '已导入'; btn.disabled = true; }
      qsProgressFill.style.width = '100%';
      qsProgressText.textContent = '已导入: ' + qsGetTrackTitle(song);
      // 刷新主歌库, 使 findLocalSongByFm 能匹配到新导入的歌曲
      if (typeof refreshMainLibrary === 'function') await refreshMainLibrary();
      // 如果是当前试听的歌曲, 更新收藏按钮状态 (+ → 红心)
      if (qsPreviewIdx === idx && typeof updLikeBtn === 'function') updLikeBtn();
      if (typeof showToast === 'function') showToast('已导入: ' + qsGetTrackTitle(song), 'success');
    } else {
      const msg = (res && res.message) || '未知错误';
      if (btn) { btn.disabled = false; btn.textContent = '导入'; }
      qsProgressText.textContent = '导入失败: ' + msg;
      if (typeof showToast === 'function') showToast('导入失败: ' + msg, 'error');
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '导入'; }
    qsProgressText.textContent = '导入失败: ' + e.message;
    if (typeof showToast === 'function') showToast('导入失败: ' + e.message, 'error');
  }
  // 2 秒后隐藏进度条
  setTimeout(() => {
    if (qsProgress && !qsImporting) qsProgress.classList.add('hidden');
  }, 2000);
}
