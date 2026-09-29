// =========== 酷狗歌单导入 - 试听与导入 ===========
// 从 kugou-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 试听 (套壳到主播放器, 复用 fmPreviewMode 状态) ----
let _kgPreviewReqId = 0;
let _kgLrcReqId = 0;
let kgPreviewIdx = -1;

async function playKgPreview(idx) {
  const song = kgCurrentTracks[idx];
  if (!song) return;
  const row = kgTracks.querySelector(`tr[data-idx="${idx}"]`);
  const btn = row ? row.querySelector('.kg-preview-btn') : null;
  const reqId = ++_kgPreviewReqId;

  // 重置视频模式(防止从汽水视频试听切换过来时残留)
  if (typeof setVideoMode === 'function') setVideoMode(false);
  // 暂停本地播放器
  if (!fmPreviewMode && typeof isPlaying !== 'undefined' && isPlaying) {
    audio.pause();
    saveCurrentProgress();
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '...'; }

  try {
    const res = await window.kugouAPI.preview(song, '128');
    if (reqId !== _kgPreviewReqId) return;  // 竞态: 已被新调用取代
    if (!res.ok) throw new Error(res.message);
    const data = res.data;
    const meta = data.meta || {};

    // 进入试听模式
    fmPreviewMode = true;
    kgPreviewIdx = idx;
    const coverUrl = meta.cover && !meta.cover.includes('placeholder.com') ? meta.cover.replace('{size}', '400') : '';
    fmPreviewSong = {
      id: song.hash,
      source: 'kugou',
      name: meta.title || '未知歌曲',
      artist: meta.artist || '',
      cover: coverUrl,
      _originSong: song,
    };

    // 清空旧歌词
    lrc = [];
    lrcRaw = false;
    prevCurLine = -1;
    lineMetrics = [];
    _cachedLineEls = null;
    renderLrc();
    if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();

    // 主播放器 UI
    empty.classList.add('hidden');
    player.classList.remove('hidden');
    lyrics.classList.remove('hidden');
    titleEl.textContent = meta.title || '未知歌曲';
    artistEl.textContent = meta.artist || '';
    // 隐藏 credits (试听无作词作曲信息)
    if (creditsEl) { creditsEl.textContent = ''; creditsEl.classList.remove('missing'); }
    if (typeof updLikeBtn === 'function') updLikeBtn();
    if (typeof updNowPlaying === 'function') updNowPlaying();
    if (desktopLyricOn && typeof window.desktopLyric !== 'undefined') {
      window.desktopLyric.send({ type: 'info', info: { title: meta.title || '', artist: meta.artist || '' } });
    }

    // 封面 (coverUnify=true 时锁定首次封面状态)
    setCoverImage(coverUrl || null);
    if (coverEl) coverEl.classList.toggle('disc', appSettings.discCover);
    // 提取封面主色作为背景渐变 (酷狗封面 URL 含 {size} 占位, 已 replace 为 400)
    if (typeof applyCoverBackground === 'function') applyCoverBackground(coverUrl || null);

    // 音频
    audio.removeAttribute('src');
    audio.load();
    audio.src = data.url;
    audio.currentTime = 0;
    await audio.play();
    if (reqId !== _kgPreviewReqId) return;
    if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; }

    // 加载歌词
    console.log('[KG-PREVIEW] rawTextLen:', (data.rawText || '').length, 'lrcTextLen:', (data.lrcText || '').length, 'rawHead:', (data.rawText || '').slice(0, 80), 'lrcHead:', (data.lrcText || '').slice(0, 80));
    loadKgLyricToMain(data.rawText, data.lrcText);
  } catch (e) {
    if (reqId !== _kgPreviewReqId) return;
    if (btn) { btn.innerHTML = '✗'; btn.title = e.message; }
    if (typeof showToast === 'function') showToast('试听失败: ' + e.message, 'error');
    setTimeout(() => { if (btn) { btn.innerHTML = ICON_PREVIEW; btn.disabled = false; } }, 2000);
    // 试听失败, 退出试听模式
    if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'kugou') {
      if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
    }
  }
}

// 加载酷狗歌词到主播放器 (优先 raw 逐字, 回退 lrc)
function loadKgLyricToMain(rawText, lrcText) {
  const reqId = ++_kgLrcReqId;
  lrc = [];
  lrcRaw = false;
  renderLrc();

  // 优先尝试 raw 逐字解析(高精度)
  let parsed = [];
  let isRaw = false;
  if (rawText) {
    const rawParsed = parseRaw(rawText);
    if (rawParsed.length) {
      parsed = rawParsed;
      isRaw = true;
    }
  }
  // 回退 lrc(低精度)
  if (!parsed.length && lrcText) {
    const enhanced = parseEnhancedLRC(lrcText);
    if (enhanced.length) {
      parsed = enhanced;
      isRaw = true;
    } else {
      parsed = parseLRC(lrcText);
      isRaw = false;
    }
  }

  if (reqId !== _kgLrcReqId) return;
  lrc = parsed.length ? parsed : [{ time: 0, text: '纯音乐，请欣赏' }];
  lrcRaw = isRaw;
  prevCurLine = -1;
  lineMetrics = [];
  _cachedLineEls = null;
  renderLrc();
  syncLrc(audio.currentTime || 0);
  if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
}

// 退出酷狗试听
function exitKgPreview() {
  if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'kugou') {
    if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
  }
  kgPreviewIdx = -1;
}

// ---- 单首导入 ----
async function importSingleTrack(idx) {
  if (kgImporting) return;
  const song = kgCurrentTracks[idx];
  if (!song) return;
  const row = kgTracks.querySelector(`tr[data-idx="${idx}"]`);
  if (row) {
    const btn = row.querySelector('.kg-import-one');
    if (btn) { btn.disabled = true; btn.textContent = '导入中'; }
    const statusCell = row.querySelector('.col-import-status');
    statusCell.innerHTML = '<span class="kg-status-active">导入中...</span>';
  }
  const quality = kgQualitySelect.value;
  try {
    const res = await window.kugouAPI.importSong(song, quality, { audio: true, cover: true, lrc: true, info: true, krc: true });
    if (row) {
      const statusCell = row.querySelector('.col-import-status');
      if (res.ok) {
        statusCell.innerHTML = '<span class="kg-status-done">已导入</span>';
        // 刷新主歌库, 使 findLocalSongByFm 能匹配到新导入的歌曲
        if (typeof refreshMainLibrary === 'function') await refreshMainLibrary();
        // 如果是当前试听的歌曲, 更新收藏按钮状态 (+ → 红心)
        if (kgPreviewIdx === idx && typeof updLikeBtn === 'function') updLikeBtn();
      } else {
        statusCell.innerHTML = `<span class="kg-status-fail" title="${res.message || ''}">失败</span>`;
      }
      const btn = row.querySelector('.kg-import-one');
      if (btn) { btn.disabled = false; btn.textContent = '导入'; }
    }
    const { title: cleanTitle } = kgParseName(song.name || '');
    if (typeof showToast === 'function') {
      showToast(res.ok ? `已导入: ${cleanTitle}` : `导入失败: ${res.message || ''}`, res.ok ? 'success' : 'error');
    }
  } catch (e) {
    if (row) {
      const statusCell = row.querySelector('.col-import-status');
      statusCell.innerHTML = `<span class="kg-status-fail" title="${e.message}">失败</span>`;
      const btn = row.querySelector('.kg-import-one');
      if (btn) { btn.disabled = false; btn.textContent = '导入'; }
    }
    if (typeof showToast === 'function') showToast(`导入失败: ${e.message}`, 'error');
  }
}

// ---- 批量导入(全部 / 选中) ----
async function importTracks(mode) {
  if (kgImporting || kgCurrentTracks.length === 0) return;
  // 选中模式: 收集勾选的行索引
  let idxList = [];
  if (mode === 'selected') {
    kgTracks.querySelectorAll('.kg-row-check').forEach((cb, i) => {
      if (cb.checked) idxList.push(i);
    });
    if (idxList.length === 0) {
      if (typeof showToast === 'function') showToast('请先勾选要导入的歌曲', 'info');
      return;
    }
  } else {
    idxList = kgCurrentTracks.map((_, i) => i);
  }
  kgImporting = true;
  kgImportAll.disabled = true;
  kgImportSelected.disabled = true;
  kgImportAll.textContent = '导入中...';
  kgImportSelected.textContent = '导入中...';
  kgImportProgress.classList.remove('hidden');
  kgProgressFill.style.width = '0%';

  const quality = kgQualitySelect.value;
  const total = idxList.length;
  let success = 0;
  let failed = 0;

  // 监听单首下载进度(用于显示子阶段)
  window.kugouAPI.onDownloadProgress(() => {});

  for (let n = 0; n < total; n++) {
    const idx = idxList[n];
    const song = kgCurrentTracks[idx];
    const row = kgTracks.querySelector(`tr[data-idx="${idx}"]`);
    if (row) {
      const statusCell = row.querySelector('.col-import-status');
      statusCell.innerHTML = '<span class="kg-status-active">导入中...</span>';
    }
    kgProgressText.textContent = `${n + 1}/${total} - ${song.name || ''}`;

    try {
      const res = await window.kugouAPI.importSong(song, quality, { audio: true, cover: true, lrc: true, info: true, krc: true });
      if (res.ok) {
        success++;
        if (row) {
          const statusCell = row.querySelector('.col-import-status');
          statusCell.innerHTML = '<span class="kg-status-done">已导入</span>';
        }
      } else {
        failed++;
        if (row) {
          const statusCell = row.querySelector('.col-import-status');
          statusCell.innerHTML = `<span class="kg-status-fail" title="${res.message}">失败</span>`;
        }
      }
    } catch (e) {
      failed++;
      if (row) {
        const statusCell = row.querySelector('.col-import-status');
        statusCell.innerHTML = `<span class="kg-status-fail" title="${e.message}">失败</span>`;
      }
    }
    kgProgressFill.style.width = `${Math.round(((n + 1) / total) * 100)}%`;
  }

  kgProgressText.textContent = `完成: 成功 ${success} 首, 失败 ${failed} 首`;
  kgImportAll.disabled = false;
  kgImportSelected.disabled = false;
  kgImportAll.textContent = '导入全部';
  kgImportSelected.textContent = '导入选中';
  kgImporting = false;
  window.kugouAPI.removeDownloadProgress();
  if (typeof showToast === 'function') {
    showToast(`导入完成: ${success} 首成功, ${failed} 首失败`, failed > 0 ? 'error' : 'success');
  }
}
