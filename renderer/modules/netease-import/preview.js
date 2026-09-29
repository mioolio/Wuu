// =========== 网易云音乐歌单导入 - 试听与导入 ===========
// 从 netease-import/init.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 试听 (套壳到主播放器, 复用 fmPreviewMode 状态) ----
async function playWyPreview(idx) {
  const song = wyCurrentTracks[idx];
  if (!song) return;
  const songId = song.id;
  if (!songId) {
    if (typeof showToast === 'function') showToast('无法试听: 该歌曲缺少 ID', 'error');
    return;
  }
  const reqId = ++_wyPreviewReqId;

  // 重置视频模式(防止从汽水视频试听切换过来时残留)
  if (typeof setVideoMode === 'function') setVideoMode(false);
  // 暂停本地播放器
  if (!fmPreviewMode && typeof isPlaying !== 'undefined' && isPlaying) {
    audio.pause();
    if (typeof saveCurrentProgress === 'function') saveCurrentProgress();
  }

  try {
    const res = await window.neteaseAPI.preview(songId, WY_PREVIEW_QUALITY);
    if (reqId !== _wyPreviewReqId) return;  // 竞态: 已被新调用取代
    if (!res || !res.ok) {
      const msg = (res && res.message) || '试听失败';
      throw new Error(msg);
    }
    // 后端返回 { ok, data: { url, rawText, lrcText, meta, isPreview, vipWarning, needRelogin } }
    const data = res.data || {};
    const url = data.url || '';
    if (!url) throw new Error('未获取到试听地址(可能需要VIP或已下架)');

    // VIP歌曲试听检测: 登录态可能失效, 提示用户重新登录
    if (data.needRelogin && data.vipWarning) {
      if (typeof showToast === 'function') showToast(data.vipWarning, 'error');
    }

    // 进入试听模式
    fmPreviewMode = true;
    wyPreviewIdx = idx;
    const meta = data.meta || {};
    const coverUrl = meta.cover || song.cover || '';
    const title = meta.title || song.name || '未知歌曲';
    const artist = meta.artist || song.artist || '';
    fmPreviewSong = {
      id: String(songId),
      source: 'netease',
      name: title,
      artist: artist,
      cover: coverUrl,
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
    titleEl.textContent = title;
    artistEl.textContent = artist;
    // 显示作词/作曲信息
    if (creditsEl) {
      const parts = [];
      if (meta.lyricist) parts.push('作词: ' + meta.lyricist);
      if (meta.composer) parts.push('作曲: ' + meta.composer);
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
      window.desktopLyric.send({ type: 'info', info: { title, artist } });
    }

    // 封面 (网易云封面是远程 URL, applyCoverBackground 内部自动识别)
    setCoverImage(coverUrl || null);
    if (coverEl) coverEl.classList.toggle('disc', appSettings.discCover);
    if (typeof applyCoverBackground === 'function') applyCoverBackground(coverUrl || null);

    // 音频
    audio.removeAttribute('src');
    audio.load();
    audio.src = url;
    audio.currentTime = 0;
    await audio.play();
    if (reqId !== _wyPreviewReqId) return;

    // 加载歌词 - 网易云无逐字 krc, 仅 LRC; rawText 为空
    loadWyLyricToMain(data.lrcText || '');
  } catch (e) {
    if (reqId !== _wyPreviewReqId) return;
    if (typeof showToast === 'function') showToast('试听失败: ' + e.message, 'error');
    // 试听失败, 退出试听模式
    if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'netease') {
      if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
    }
  }
}

// 加载歌词到主播放器 (网易云仅 LRC 格式)
function loadWyLyricToMain(lrcText) {
  if (typeof parseLRC !== 'function') return;
  lrc = [];
  lrcRaw = false;
  if (typeof renderLrc === 'function') renderLrc();

  let parsed = [];
  if (lrcText) {
    // 优先尝试增强 LRC (逐字)
    if (typeof parseEnhancedLRC === 'function') {
      const enhanced = parseEnhancedLRC(lrcText);
      if (enhanced.length) { parsed = enhanced; lrcRaw = true; }
      else { parsed = parseLRC(lrcText); }
    } else {
      parsed = parseLRC(lrcText);
    }
  }

  lrc = parsed.length ? parsed : [{ time: 0, text: '纯音乐，请欣赏' }];
  prevCurLine = -1;
  lineMetrics = [];
  _cachedLineEls = null;
  if (typeof renderLrc === 'function') renderLrc();
  if (typeof syncLrc === 'function') syncLrc(audio.currentTime || 0);
  if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
}

// 退出网易云试听
function exitWyPreview() {
  if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'netease') {
    if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
  }
  wyPreviewIdx = -1;
}

// ---- 单首导入 ----
async function importSingleWyTrack(idx) {
  if (wyImporting) {
    if (typeof showToast === 'function') showToast('正在导入中, 请稍候', 'info');
    return;
  }
  const song = wyCurrentTracks[idx];
  if (!song) return;
  if (!wyUserInfo) {
    if (typeof showToast === 'function') showToast('请先登录', 'error');
    return;
  }
  const songId = song.id;
  if (!songId) {
    if (typeof showToast === 'function') showToast('无法导入: 缺少歌曲 ID', 'error');
    return;
  }
  const row = wyTrackList.querySelector(`tr[data-idx="${idx}"]`);
  const btn = row ? row.querySelector('.wy-import-one') : null;
  if (btn) { btn.disabled = true; btn.textContent = '导入中'; }

  wyImporting = true;
  wyProgress.classList.remove('hidden');
  wyProgressFill.style.width = '0%';
  wyProgressText.textContent = '正在导入: ' + (song.name || '未知歌曲');

  // 读取音质选择
  const quality = wyQualitySelect ? wyQualitySelect.value : WY_IMPORT_QUALITY;

  try {
    const res = await window.neteaseAPI.importSong(songId, quality, song, null);
    if (res && res.ok) {
      if (btn) { btn.textContent = '已导入'; btn.disabled = true; }
      wyProgressFill.style.width = '100%';
      wyProgressText.textContent = '已导入: ' + (song.name || '未知歌曲');
      // 刷新主歌库, 使 findLocalSongByFm 能匹配到新导入的歌曲
      if (typeof refreshMainLibrary === 'function') await refreshMainLibrary();
      // 如果是当前试听的歌曲, 更新收藏按钮状态 (+ → 红心)
      if (wyPreviewIdx === idx && typeof updLikeBtn === 'function') updLikeBtn();
      if (typeof showToast === 'function') showToast('已导入: ' + (song.name || '未知歌曲'), 'success');
      // 如果导入的是试听版本(VIP登录态失效), 额外提示用户
      if (res.info && res.info._neteaseMeta && res.info._neteaseMeta.previewHits && res.info._neteaseMeta.previewHits.length) {
        if (typeof showToast === 'function') showToast('警告: 导入的可能是试听版本, 建议重新登录后再次导入', 'error');
      }
    } else {
      const msg = (res && res.message) || '未知错误';
      if (btn) { btn.disabled = false; btn.textContent = '导入'; }
      wyProgressText.textContent = '导入失败: ' + msg;
      if (typeof showToast === 'function') showToast('导入失败: ' + msg, 'error');
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '导入'; }
    wyProgressText.textContent = '导入失败: ' + e.message;
    if (typeof showToast === 'function') showToast('导入失败: ' + e.message, 'error');
  } finally {
    wyImporting = false;
    // 2 秒后隐藏进度条
    setTimeout(() => {
      if (wyProgress) wyProgress.classList.add('hidden');
    }, 2000);
  }
}
