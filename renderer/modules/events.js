// =========== 所有 DOM 事件监听 ===========

// 进度条拖拽
pTrack.addEventListener('mousedown', (e) => {
  dragging = true;
  seekFromEvent(e);
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  seekFromEvent(e);
});
document.addEventListener('mouseup', () => {
  dragging = false;
});

// 播放按钮
btnPlay.addEventListener('click', () => {
  // 试听模式: 直接控制主 audio 播放/暂停
  if (fmPreviewMode) {
    isPlaying ? audio.pause() : audio.play().catch(() => {});
    return;
  }
  if (curIdx === -1 && songs.length > 0) { play(0); return; }
  // 暂停时: 启用 fadePause 则 0.5s 音量淡出, 否则直接暂停
  // 播放时: 取消可能进行中的渐变并恢复音量
  if (isPlaying) {
    if (typeof appSettings !== 'undefined' && appSettings.fadePause !== false && typeof fadePause === 'function') {
      fadePause(0.5);
    } else {
      audio.pause();
    }
  } else {
    if (typeof cancelFade === 'function') cancelFade();
    audio.play().catch(() => {});
  }
});

// 上/下一首(基于 playContext: 在"我喜欢"上下文内循环, 不跳到大歌单)
btnPrev.addEventListener('click', () => {
  // 试听模式: 走试听队列上一首
  if (fmPreviewMode) {
    if (typeof playFmPreviewNext === 'function') playFmPreviewNext(-1);
    return;
  }
  if (curIdx === -1) return;
  const idx = pickNextIdx(-1);
  // updateContext=false: 上一首按钮不改 playContext, 保持当前播放上下文
  if (idx >= 0) play(idx, true, false);
});
btnNext.addEventListener('click', () => {
  // 试听模式: 走试听队列下一首
  if (fmPreviewMode) {
    if (typeof playFmPreviewNext === 'function') playFmPreviewNext(1);
    return;
  }
  if (curIdx === -1) return;
  const idx = pickNextIdx(1);
  // updateContext=false: 下一首按钮不改 playContext, 保持当前播放上下文
  if (idx >= 0) play(idx, true, false);
});

// 播放模式
btnMode.addEventListener('click', () => {
  playMode = (playMode + 1) % 3;
  appSettings.playMode = playMode;
  btnMode.innerHTML = MODE_ICONS[playMode];
  btnMode.title = MODE_NAMES[playMode];
  // 切到随机模式: 定位当前歌在对应上下文 shuffleQueue 中的位置
  // 这样第一次点"下一首"从队列当前位置继续, 而不是跳到队列头
  if (playMode === 2 && curIdx >= 0) {
    if (playContext === 'liked' && shuffleQueueLiked.length > 0) {
      const pos = shuffleQueueLiked.indexOf(curIdx);
      if (pos >= 0) shufflePosLiked = pos;
    } else if (playContext === 'home' && shuffleQueue.length > 0) {
      const pos = shuffleQueue.indexOf(curIdx);
      if (pos >= 0) shufflePos = pos;
    }
  }
  saveUserData();
});

// 音量
// 音量条范围 0-150, 0-100 等同普通音量, 101-150 为 WebAudio 增益放大(补偿 Chromium AAC 解码偏小)
btnVol.addEventListener('click', () => volPop.classList.toggle('hidden'));
volSlider.addEventListener('input', () => {
  const v = volSlider.value / 100;  // 0 ~ 1.5
  // 用户主动调音量时取消可能进行中的暂停渐变
  if (typeof cancelFade === 'function') cancelFade();
  setVol(v);
  appSettings.volume = v;
  saveUserData();
  updVol();
});
function updVol() {
  // 从 gainNode 读取当前音量(回退时读 audio.volume)
  const v = gainNode ? gainNode.gain.value : audio.volume;
  let s;
  if (v === 0) s = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  else if (v < 0.5) s = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/>';
  else if (v <= 1.0) s = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>';
  // 超过 1.0 增益时显示高亮喇叭图标(简单区分)
  else s = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke="#fb7299"/>';
  volSvg.innerHTML = s;
}
document.addEventListener('click', e => {
  if (!volPop.contains(e.target) && e.target !== btnVol && !btnVol.contains(e.target)) volPop.classList.add('hidden');
});

// 搜索 (搜索词统一由 getFilteredList 读取, 分组按钮也复用, 保证搜索→分组 / 分组→搜索 一致)
// 性能: 加防抖, 避免快速输入时每次按键都触发完整渲染
let _searchDebounce = null;
search.addEventListener('input', () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => renderList(), 120);
});

// 切换按歌手分组 (复用当前搜索过滤, 不丢失搜索结果)
btnGroupArtist.addEventListener('click', () => {
  groupByArtist = !groupByArtist;
  btnGroupArtist.classList.toggle('active', groupByArtist);
  renderList();
});

// 新建歌单按钮 (list-head 顶部, home/liked 视图均可用)
// 复用 renderCollectionList 中的创建逻辑: 允许空名, 重名自动加序号
btnCreateCollection.addEventListener('click', async () => {
  const name = await showPromptModal({
    title: '新建歌单',
    sub: '请输入歌单名称(可留空, 默认"新建歌单")',
    defaultValue: '新建歌单',
    allowEmpty: true,
    confirmText: '创建',
  });
  if (name === null) return;  // 用户取消
  const trimmed = name.trim();
  let finalName = trimmed || '新建歌单';
  // 重名时自动加序号
  if (collections.some(c => c.name === finalName)) {
    let n = 2;
    while (collections.some(c => c.name === `${finalName} ${n}`)) n++;
    finalName = `${finalName} ${n}`;
  }
  const id = createCollection(finalName);
  if (typeof showToast === 'function') showToast(`已创建歌单: ${finalName}`, 'success');
  // 创建后跳转到"我喜欢的音乐"歌单列表视图, 让用户看到新歌单卡片
  currentView = 'liked';
  activeCollectionId = null;
  try { localStorage.setItem('sqet-current-view', 'liked'); } catch (e) {}
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'liked'));
  renderList();
});

// 歌词点击跳转
lyricsInner.addEventListener('click', (e) => {
  const line = e.target.closest('.lyric-line');
  if (!line) return;
  if (line === lyricsInner.firstElementChild) return;
  const lines = lyricsInner.querySelectorAll('.lyric-line');
  const di = Array.from(lines).indexOf(line);
  const idx = di - 1;
  if (idx < 0 || idx >= lrc.length) return;

  const dur = getDuration();
  if (!dur || !isFinite(dur)) return;

  const t = lrcRaw ? lrc[idx].start : lrc[idx].time;
  // 越界保护: 歌词时间超过音频时长时无意义 (seekInProgress + seeked 事件已处理跳变检测,
  // 点击最后一行正常 seek 后播放至 ended, 按 playMode 处理, 不再拦截)
  if (t >= dur) return;

  lastLyricClickTime = performance.now();
  seekInProgress = true;
  lastSeekTarget = Math.max(0, Math.min(dur, t));
  audio.currentTime = lastSeekTarget;

  if (!isPlaying) {
    syncLrc(audio.currentTime);
    if (!dragging) pFill.style.width = `${(audio.currentTime / dur) * 100}%`;
    tNow.textContent = fmt(audio.currentTime);
    // 暂停状态下点击歌词跳转: 同步桌面歌词, 否则桌面歌词停留在旧位置
    if (desktopLyricOn) {
      window.desktopLyric.send({ type: 'time', t: audio.currentTime, playing: false });
    }
  }
});

// 播放区喜欢按钮 → 弹出歌单选择器, 让用户选要添加到哪些歌单
btnLike.addEventListener('click', async () => {
  // 试听模式: 未添加到歌库时添加, 已添加则弹歌单选择器
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    // 酷狗试听: 已在歌库则弹选择器, 不在则导入
    if (fmPreviewSong.source === 'kugou') {
      const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
      if (localSong) {
        await pickCollectionsForSong(localSong);
      } else {
        // 不在歌库: 导入
        if (typeof importSingleTrack === 'function' && kgPreviewIdx >= 0) {
          importSingleTrack(kgPreviewIdx);
        }
      }
      return;
    }
    // 远程歌单试听: 已在歌库则弹选择器, 不在则下载到歌库
    if (fmPreviewSong.source === 'playlist') {
      const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
      if (localSong) {
        await pickCollectionsForSong(localSong);
      } else if (fmPreviewSong._originSong) {
        if (typeof window.downloadPlSongByObj === 'function') {
          window.downloadPlSongByObj(fmPreviewSong._originSong);
        }
      }
      return;
    }
    const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
    if (localSong) {
      await pickCollectionsForSong(localSong);
    } else {
      // 未添加到歌库: 添加到歌库
      if (typeof saveFmSongToLibrary === 'function') {
        saveFmSongToLibrary(fmPreviewSong, null);
      }
    }
    return;
  }
  const s = songs[curIdx];
  if (!s) return;
  await pickCollectionsForSong(s);
});

// 视频模式操作按钮: 收藏 (复用主播放器收藏逻辑)
const btnVideoLike = document.getElementById('btn-video-like');
if (btnVideoLike) {
  btnVideoLike.addEventListener('click', () => {
    // 触发主播放器收藏按钮的点击逻辑 (复用 btnLike 的处理)
    if (typeof btnLike !== 'undefined' && btnLike) btnLike.click();
  });
}

// 播放区不推荐按钮: 切换 dislikedSet 状态 (与 liked 互斥)
if (typeof btnDislike !== 'undefined' && btnDislike) {
  btnDislike.addEventListener('click', () => {
    // 试听模式: 不支持在试听状态标记 (临时歌曲, 不在歌库)
    if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
      const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
      if (localSong) {
        toggleDislike(localSong);
        updLikeBtn();
        updDislikeBtn();
        const isDis = isDisliked(localSong);
        if (typeof showToast === 'function') {
          showToast(isDis ? '已标记为不推荐' : '已取消不推荐', isDis ? 'info' : 'info');
        }
      } else {
        if (typeof showToast === 'function') showToast('该歌曲未添加到歌库, 无法标记', 'info');
      }
      return;
    }
    const s = songs[curIdx];
    if (!s) return;
    toggleDislike(s);
    updLikeBtn();
    updDislikeBtn();
    // 刷新列表行按钮状态
    const idx = songs.indexOf(s);
    if (idx >= 0) {
      const likeItem = listEl.querySelector(`.song-item[data-idx="${idx}"] .si-like`);
      const dislikeItem = listEl.querySelector(`.song-item[data-idx="${idx}"] .si-dislike`);
      if (likeItem) {
        const liked = isLiked(s);
        likeItem.classList.toggle('liked', liked);
        likeItem.innerHTML = liked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
      }
      if (dislikeItem) {
        const dis = isDisliked(s);
        dislikeItem.classList.toggle('disliked', dis);
        dislikeItem.innerHTML = dis ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
      }
    }
    const isDis = isDisliked(s);
    if (typeof showToast === 'function') {
      showToast(isDis ? '已标记为不推荐' : '已取消不推荐', 'info');
    }
  });
}

// 视频模式操作按钮: 保存到本地 (复用试听模式的保存逻辑)
const btnVideoSave = document.getElementById('btn-video-save');
if (btnVideoSave) {
  btnVideoSave.addEventListener('click', () => {
    // 复用 fmPreviewSong 的保存逻辑 (与主播放器爱心按钮在试听模式下的行为一致)
    if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
      const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
      if (localSong) {
        if (typeof showToast === 'function') showToast('该视频已在本地歌库中', 'info');
        return;
      }
      if (typeof saveFmSongToLibrary === 'function') {
        saveFmSongToLibrary(fmPreviewSong, null);
      }
    }
  });
}

// 弹出歌单选择器并应用变更 (主播放器红心 + 列表行红心共用)
// - 取消(null) 则什么也不做
// - 空数组([]) 视为"从所有歌单移除"
// - 默认勾选"我喜欢的音乐", 首次无任何歌单时自动创建
async function pickCollectionsForSong(song) {
  // 保证至少有一个"我喜欢的音乐"歌单作为默认选项
  getOrCreateFavoritesCollection();
  const selected = await showCollectionPicker({
    song,
    title: '添加到歌单',
    sub: `${song.songName || ''} - ${song.artist || ''}`,
  });
  if (selected === null) return;  // 用户取消
  const { added, removed } = applyCollectionsToSong(song, selected);
  // 刷新播放器红心按钮状态 (含 dislike 同步)
  updLikeBtn();
  if (typeof updDislikeBtn === 'function') updDislikeBtn();
  // 刷新列表行红心 + dislike 状态
  const idx = songs.indexOf(song);
  if (idx >= 0) {
    const item = listEl.querySelector(`.song-item[data-idx="${idx}"] .si-like`);
    if (item) {
      const liked = isLiked(song);
      item.classList.toggle('liked', liked);
      item.innerHTML = liked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
    }
    const dislikeItem = listEl.querySelector(`.song-item[data-idx="${idx}"] .si-dislike`);
    if (dislikeItem) {
      const dis = isDisliked(song);
      dislikeItem.classList.toggle('disliked', dis);
      dislikeItem.innerHTML = dis ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
    }
  }
  // toast 反馈
  if (typeof showToast === 'function') {
    if (added.length && removed.length) {
      showToast(`已加入: ${added.join(', ')} · 已移除: ${removed.join(', ')}`, 'info');
    } else if (added.length) {
      showToast(`已加入: ${added.join(', ')}`, 'success');
    } else if (removed.length) {
      showToast(`已移除: ${removed.join(', ')}`, 'info');
    } else {
      showToast('未做更改', 'info');
    }
  }
  // 在歌单歌曲视图下, 若歌曲已从当前激活歌单移除则重新渲染列表
  if (currentView === 'liked' && activeCollectionId && !isInCollection(activeCollectionId, song.audioPath)) renderList();
}

// 导航切换
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    // 已在 liked 视图时再次点击: 回到歌单列表 (而不是直接 return)
    if (view === currentView) {
      if (view === 'liked' && activeCollectionId !== null) {
        activeCollectionId = null;
        listTitle.textContent = '我的歌单';
        renderList();
      }
      return;
    }
    // 离开当前视图前清理(停止免费听试听等)
    if (typeof cleanupFreeMusicViewIfActive === 'function') cleanupFreeMusicViewIfActive();
    currentView = view;
    // 持久化当前视图, F5/Ctrl+R 刷新后恢复
    try { localStorage.setItem('sqet-current-view', view); } catch (e) {}
    navItems.forEach(n => n.classList.toggle('active', n === item));
    search.value = '';

    if (view === 'home') {
      if (curIdx >= 0) {
        showPlayerView();
      } else if (songs.length > 0) {
        play(0);
        showPlayerView();
      } else {
        showListView();
      }
    } else if (view === 'stats') {
      showStatsView();
    } else if (view === 'settings') {
      showSettingsView();
    } else if (view === 'import') {
      showImportView();
    } else if (view === 'repair') {
      showRepairView();
    } else if (view === 'free-music') {
      showFreeMusicView();
    } else if (view === 'playlist') {
      showPlaylistShareView();
    } else if (view === 'management') {
      if (typeof showManagementView === 'function') showManagementView();
    } else if (view === 'liked') {
      // 进入 liked 视图: 默认展示歌单列表
      activeCollectionId = null;
      listTitle.textContent = '我的歌单';
      showListView();
      renderList();
    } else {
      listTitle.textContent = '音乐列表';
      showListView();
      renderList();
    }
  });
});

// 排行榜排序
rankingTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const sort = tab.dataset.sort;
    if (sort === rankingSort) return;
    rankingSort = sort;
    rankingTabs.forEach(t => t.classList.toggle('active', t === tab));
    renderStats();
  });
});

// 设置项
settingShowFloatBtn.addEventListener('change', () => {
  appSettings.showFloatListBtn = settingShowFloatBtn.checked;
  applySettings();
  saveUserData();
});
settingGlassOpacity.addEventListener('input', () => {
  appSettings.glassOpacity = parseFloat(settingGlassOpacity.value);
  glassOpacityVal.textContent = Math.round(appSettings.glassOpacity * 100) + '%';
  document.documentElement.style.setProperty('--glass-opacity', appSettings.glassOpacity);
});
settingGlassOpacity.addEventListener('change', () => {
  appSettings.glassOpacity = parseFloat(settingGlassOpacity.value);
  saveUserData();
});
settingDiscCover.addEventListener('change', () => {
  appSettings.discCover = settingDiscCover.checked;
  applySettings();
  saveUserData();
});
settingColorIntensity.addEventListener('input', () => {
  appSettings.colorIntensity = parseFloat(settingColorIntensity.value);
  colorIntensityVal.textContent = Math.round(appSettings.colorIntensity * 100) + '%';
  if (currentMode === 'player' && songs[curIdx]) {
    applyCoverBackground(songs[curIdx].coverPath);
  }
});
settingColorIntensity.addEventListener('change', () => {
  appSettings.colorIntensity = parseFloat(settingColorIntensity.value);
  saveUserData();
});
settingThemeFollowCover.addEventListener('change', () => {
  appSettings.themeFollowCover = settingThemeFollowCover.checked;
  saveUserData();
  // 切换开关时重新评估当前视图的背景
  refreshCoverBackground();
});
settingCoverChange.addEventListener('change', () => {
  appSettings.coverUnify = settingCoverChange.checked;
  saveUserData();
});
settingLyricPersist.addEventListener('change', () => {
  appSettings.desktopLyricPersist = settingLyricPersist.checked;
  saveUserData();
});
// 重置桌面歌词位置到默认居中
settingLyricReset.addEventListener('click', async () => {
  appSettings.desktopLyricBounds = null;
  saveUserData();
  // 如果桌面歌词当前打开, 立即应用默认位置
  if (typeof window.desktopLyric !== 'undefined' && window.desktopLyric && window.desktopLyric.setPosition) {
    try {
      await window.desktopLyric.setPosition(null);
    } catch (e) {}
  }
  settingLyricReset.textContent = '已重置';
  setTimeout(() => { settingLyricReset.textContent = '重置位置'; }, 1500);
});
settingSimulateLrc.addEventListener('change', () => {
  appSettings.simulateLrcProgress = settingSimulateLrc.checked;
  saveUserData();
  // 切换开关时重新渲染歌词(应用/取消模拟走字)
  if (typeof renderLrc === 'function') renderLrc();
});
settingArtistGroupMode.addEventListener('change', () => {
  appSettings.artistGroupMode = settingArtistGroupMode.value;
  saveUserData();
  // 切换分组模式时重新渲染列表
  if (typeof renderList === 'function') renderList();
});
// 进度条颜色: 启用开关 + 两色渐变
settingProgressColorEnabled.addEventListener('change', () => {
  appSettings.progressColorEnabled = settingProgressColorEnabled.checked;
  applyProgressColor();
  saveUserData();
});
settingProgressColor.addEventListener('input', () => {
  appSettings.progressColor = settingProgressColor.value;
  if (appSettings.progressColorEnabled) applyProgressColor();
});
settingProgressColor.addEventListener('change', () => {
  appSettings.progressColor = settingProgressColor.value;
  saveUserData();
});
settingProgressColor2.addEventListener('input', () => {
  appSettings.progressColor2 = settingProgressColor2.value;
  if (appSettings.progressColorEnabled) applyProgressColor();
});
settingProgressColor2.addEventListener('change', () => {
  appSettings.progressColor2 = settingProgressColor2.value;
  saveUserData();
});
// 重置进度条颜色为默认粉色
progressColorReset.addEventListener('click', () => {
  appSettings.progressColor = '#fb7299';
  appSettings.progressColor2 = '#ff5e8a';
  settingProgressColor.value = '#fb7299';
  settingProgressColor2.value = '#ff5e8a';
  applyProgressColor();
  saveUserData();
});
settingLyricDone.addEventListener('input', () => {
  appSettings.lyricDone = parseFloat(settingLyricDone.value);
  // 已唱色必须始终深于未唱色, 否则两者视觉无区分
  if (appSettings.lyricDone <= appSettings.lyricWait) {
    appSettings.lyricWait = Math.max(0.1, appSettings.lyricDone - 0.1);
    settingLyricWait.value = appSettings.lyricWait;
    lyricWaitVal.textContent = Math.round(appSettings.lyricWait * 100) + '%';
    document.documentElement.style.setProperty('--lyric-wait-opacity', appSettings.lyricWait);
  }
  lyricDoneVal.textContent = Math.round(appSettings.lyricDone * 100) + '%';
  document.documentElement.style.setProperty('--lyric-done-opacity', appSettings.lyricDone);
});
settingLyricDone.addEventListener('change', () => {
  appSettings.lyricDone = parseFloat(settingLyricDone.value);
  saveUserData();
});
settingLyricWait.addEventListener('input', () => {
  appSettings.lyricWait = parseFloat(settingLyricWait.value);
  // 未唱色不能深于已唱色
  if (appSettings.lyricWait >= appSettings.lyricDone) {
    appSettings.lyricDone = Math.min(1.0, appSettings.lyricWait + 0.1);
    settingLyricDone.value = appSettings.lyricDone;
    lyricDoneVal.textContent = Math.round(appSettings.lyricDone * 100) + '%';
    document.documentElement.style.setProperty('--lyric-done-opacity', appSettings.lyricDone);
  }
  lyricWaitVal.textContent = Math.round(appSettings.lyricWait * 100) + '%';
  document.documentElement.style.setProperty('--lyric-wait-opacity', appSettings.lyricWait);
});
settingLyricWait.addEventListener('change', () => {
  appSettings.lyricWait = parseFloat(settingLyricWait.value);
  saveUserData();
});
settingLyricSize.addEventListener('input', () => {
  appSettings.lyricSize = parseInt(settingLyricSize.value);
  lyricSizeVal.textContent = appSettings.lyricSize + 'px';
  document.documentElement.style.setProperty('--lyric-size', appSettings.lyricSize + 'px');
  lineMetrics = [];
  _cachedLineEls = null;
});
settingLyricSize.addEventListener('change', () => {
  appSettings.lyricSize = parseInt(settingLyricSize.value);
  saveUserData();
});

// === 跑马灯设置 ===
if (settingMarqueeEnabled) {
  settingMarqueeEnabled.addEventListener('change', () => {
    appSettings.marqueeEnabled = settingMarqueeEnabled.checked;
    // 清除跑马灯状态, 让 syncLrc 重新判断
    marqueeState = null;
    if (_cachedLineEls) {
      _cachedLineEls.forEach(el => {
        el.classList.remove('marquee');
        el.style.transform = '';
      });
    }
    saveUserData();
    // 同步到桌面歌词窗口
    if (typeof sendMarqueeSettingsToDesktop === 'function') sendMarqueeSettingsToDesktop();
  });
}
if (settingMarqueeSpeed) {
  settingMarqueeSpeed.addEventListener('input', () => {
    appSettings.marqueeSpeed = parseInt(settingMarqueeSpeed.value);
    marqueeSpeedVal.textContent = appSettings.marqueeSpeed + ' px/s';
  });
  settingMarqueeSpeed.addEventListener('change', () => {
    appSettings.marqueeSpeed = parseInt(settingMarqueeSpeed.value);
    saveUserData();
  });
}
if (settingMarqueeThreshold) {
  settingMarqueeThreshold.addEventListener('input', () => {
    appSettings.marqueeThreshold = parseFloat(settingMarqueeThreshold.value);
    marqueeThresholdVal.textContent = appSettings.marqueeThreshold.toFixed(1) + 'x';
  });
  settingMarqueeThreshold.addEventListener('change', () => {
    appSettings.marqueeThreshold = parseFloat(settingMarqueeThreshold.value);
    saveUserData();
    // 同步到桌面歌词窗口
    if (typeof sendMarqueeSettingsToDesktop === 'function') sendMarqueeSettingsToDesktop();
  });
}
if (settingMarqueePause) {
  settingMarqueePause.addEventListener('input', () => {
    appSettings.marqueePause = parseFloat(settingMarqueePause.value);
    marqueePauseVal.textContent = appSettings.marqueePause.toFixed(1) + 's';
  });
  settingMarqueePause.addEventListener('change', () => {
    appSettings.marqueePause = parseFloat(settingMarqueePause.value);
    saveUserData();
  });
}

// === 暂停音量淡出开关 ===
if (settingFadePause) {
  settingFadePause.addEventListener('change', () => {
    appSettings.fadePause = settingFadePause.checked;
    saveUserData();
    // 关闭开关时若有进行中的渐变, 立即取消并恢复音量
    if (!appSettings.fadePause && typeof cancelFade === 'function') cancelFade();
  });
}

// === 对外地址设置 (导出生成分享链接时使用的 host) ===
if (settingPublicHostMode) {
  settingPublicHostMode.addEventListener('change', () => {
    appSettings.publicHostMode = settingPublicHostMode.value === 'manual' ? 'manual' : 'auto';
    // 切换输入框启用状态
    if (settingPublicHost) settingPublicHost.disabled = appSettings.publicHostMode !== 'manual';
    saveUserData();
  });
}
if (settingPublicHost) {
  settingPublicHost.addEventListener('change', () => {
    // 仅保留地址部分, 移除用户误填的协议/端口/路径
    var v = settingPublicHost.value.trim();
    v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').trim();
    appSettings.publicHost = v;
    settingPublicHost.value = v;
    saveUserData();
  });
}
// 远程端口 (frp 转发等场景: 远程端口可能与本地服务端口不同)
if (settingPublicPort) {
  settingPublicPort.addEventListener('change', () => {
    var p = parseInt(settingPublicPort.value, 10);
    if (isNaN(p) || p <= 0) {
      appSettings.publicPort = 0;
      settingPublicPort.value = '';
    } else if (p > 65535) {
      appSettings.publicPort = 65535;
      settingPublicPort.value = '65535';
    } else {
      appSettings.publicPort = p;
    }
    saveUserData();
  });
}

// 快速分享当前歌曲 (爱心旁边的分享按钮)
// 重构: 不再直接生成默认永久链接, 而是打开 pl-export-modal 让用户选择有效期 + 次数
let _qsLastKey = '';
let _qsLastLink = '';
let _qsLastName = '';
btnShare.addEventListener('click', async () => {
  // 检查服务器是否已开启
  let st;
  try { st = await window.playlistAPI.serverStatus(); }
  catch (e) { st = { ok: false, running: false }; }
  if (!st.ok || !st.running) {
    alert('网络服务未开启。请到设置 → 网络服务中开启"歌单分享服务"后再使用快速分享。');
    return;
  }
  // 获取当前播放的歌曲对象
  let song = null;
  let songTitle = '';
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    // 试听模式: 优先用本地歌库版本 (如果已保存), 否则提示需先添加到歌库
    const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
    if (!localSong) {
      alert('当前试听歌曲尚未添加到歌库, 无法分享。请先点击爱心按钮添加到歌库后再分享。');
      return;
    }
    song = localSong;
    songTitle = (localSong.songName || '未知歌曲') + ' - ' + (localSong.artist || '');
  } else {
    if (curIdx < 0 || !songs[curIdx]) return;
    song = songs[curIdx];
    songTitle = (song.songName || '未知歌曲') + ' - ' + (song.artist || '');
  }
  // 打开 pl-export-modal 让用户选择有效期 + 访问次数 (不再默认永久)
  if (typeof window.openPlExportModal === 'function') {
    window.openPlExportModal(songTitle, [song]);
  } else {
    alert('分享模块尚未初始化, 请先进入"歌单分享"页面后再使用快速分享。');
  }
});

// 复制链接 / 密钥
qsCopyLink.addEventListener('click', () => {
  qsShareLink.select();
  document.execCommand('copy');
  qsCopyLink.textContent = '已复制';
  setTimeout(() => { qsCopyLink.textContent = '复制'; }, 1500);
});
qsCopyKey.addEventListener('click', () => {
  qsShareKey.select();
  document.execCommand('copy');
  qsCopyKey.textContent = '已复制';
  setTimeout(() => { qsCopyKey.textContent = '复制'; }, 1500);
});

// 导出 .crt 文件 (密钥隐写)
qsExportCrt.addEventListener('click', async () => {
  if (!_qsLastKey || !_qsLastLink) { return; }
  qsExportCrt.disabled = true;
  qsExportCrt.textContent = '导出中...';
  try {
    const result = await window.playlistAPI.exportCrt(_qsLastKey, _qsLastLink, _qsLastName);
    if (result.ok) {
      qsExportCrt.textContent = '已保存';
      setTimeout(() => { qsExportCrt.textContent = '导出 .crt'; }, 2000);
    } else if (!result.canceled) {
      alert('导出失败: ' + result.message);
    }
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
  qsExportCrt.disabled = false;
  if (qsExportCrt.textContent === '导出中...') {
    qsExportCrt.textContent = '导出 .crt';
  }
});

// 关闭快速分享模态框
qsClose.addEventListener('click', () => {
  quickShareModal.classList.add('hidden');
});
// 点击模态框外部关闭
quickShareModal.addEventListener('click', (e) => {
  if (e.target === quickShareModal) quickShareModal.classList.add('hidden');
});
// ESC 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !quickShareModal.classList.contains('hidden')) {
    quickShareModal.classList.add('hidden');
  }
});

// 网络服务开关
settingServerEnabled.addEventListener('change', async () => {
  appSettings.serverEnabled = settingServerEnabled.checked;
  saveUserData();
  if (appSettings.serverEnabled) {
    // 开启: 用配置端口 + 绑定IP + 白名单 + 频率限制 + 日志开关启动服务器
    await window.playlistAPI.startServer(
      appSettings.serverPort,
      appSettings.serverBindIP,
      appSettings.serverWhitelist,
      appSettings.serverRateLimit,
      appSettings.serverAccessLog
    );
  } else {
    // 关闭: 停止服务器
    await window.playlistAPI.stopServer();
  }
  updServerStatusText();
});
// 端口修改: 仅在服务已开启时实时重启
settingServerPort.addEventListener('change', async () => {
  var port = parseInt(settingServerPort.value);
  if (isNaN(port) || port < 1 || port > 65535) {
    alert('端口范围 1-65535');
    settingServerPort.value = appSettings.serverPort || 30967;
    return;
  }
  appSettings.serverPort = port;
  saveUserData();
  if (appSettings.serverEnabled) {
    await window.playlistAPI.stopServer();
    await window.playlistAPI.startServer(port, appSettings.serverBindIP, appSettings.serverWhitelist, appSettings.serverRateLimit, appSettings.serverAccessLog);
    updServerStatusText();
  }
});
// 高级网络设置: 可折叠菜单栏 toggle
settingServerAdvancedToggle.addEventListener('click', () => {
  const body = settingServerAdvancedToggle.nextElementSibling;
  const icon = settingServerAdvancedToggle.querySelector('.settings-collapse-icon');
  if (body) body.classList.toggle('hidden');
  if (icon) icon.textContent = body && body.classList.contains('hidden') ? '▼' : '▲';
});
// IP 源绑定修改: 实时重启服务器 (如正在运行)
settingServerBindIP.addEventListener('change', async () => {
  appSettings.serverBindIP = settingServerBindIP.value;
  saveUserData();
  if (appSettings.serverEnabled) {
    await window.playlistAPI.stopServer();
    await window.playlistAPI.startServer(appSettings.serverPort, appSettings.serverBindIP, appSettings.serverWhitelist, appSettings.serverRateLimit, appSettings.serverAccessLog);
    updServerStatusText();
  }
});
// 客户端 IP 白名单修改: 按行解析, 实时重启服务器 (如正在运行)
settingServerWhitelist.addEventListener('change', async () => {
  const lines = settingServerWhitelist.value.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  appSettings.serverWhitelist = lines;
  saveUserData();
  if (appSettings.serverEnabled) {
    await window.playlistAPI.stopServer();
    await window.playlistAPI.startServer(appSettings.serverPort, appSettings.serverBindIP, appSettings.serverWhitelist, appSettings.serverRateLimit, appSettings.serverAccessLog);
    updServerStatusText();
  }
});
// 频率限制修改: 实时重启服务器 (如正在运行)
settingServerRateLimit.addEventListener('change', async () => {
  var rl = parseInt(settingServerRateLimit.value);
  if (isNaN(rl) || rl < 0 || rl > 10000) {
    alert('频率限制范围 0-10000 (0=不限制)');
    settingServerRateLimit.value = appSettings.serverRateLimit || 0;
    return;
  }
  appSettings.serverRateLimit = rl;
  saveUserData();
  if (appSettings.serverEnabled) {
    await window.playlistAPI.stopServer();
    await window.playlistAPI.startServer(appSettings.serverPort, appSettings.serverBindIP, appSettings.serverWhitelist, appSettings.serverRateLimit, appSettings.serverAccessLog);
    updServerStatusText();
  }
});
// 访问日志开关: 实时重启服务器 (如正在运行)
settingServerAccessLog.addEventListener('change', async () => {
  appSettings.serverAccessLog = settingServerAccessLog.checked;
  saveUserData();
  if (appSettings.serverEnabled) {
    await window.playlistAPI.stopServer();
    await window.playlistAPI.startServer(appSettings.serverPort, appSettings.serverBindIP, appSettings.serverWhitelist, appSettings.serverRateLimit, appSettings.serverAccessLog);
    updServerStatusText();
  }
});
// 查看访问日志按钮: 打开模态框 + 拉取最新日志
settingServerViewLogs.addEventListener('click', async () => {
  accessLogModal.classList.remove('hidden');
  await refreshAccessLogs();
});
// 刷新访问日志
accessLogRefresh.addEventListener('click', refreshAccessLogs);
// 清空访问日志
accessLogClear.addEventListener('click', async () => {
  if (!confirm('确定清空所有访问日志? 此操作不可撤销')) return;
  try {
    await window.playlistAPI.clearAccessLogs();
    await refreshAccessLogs();
  } catch (e) {
    alert('清空失败: ' + e.message);
  }
});
// 关闭访问日志模态框
accessLogClose.addEventListener('click', () => {
  accessLogModal.classList.add('hidden');
});
// 点击模态框外部关闭
accessLogModal.addEventListener('click', (e) => {
  if (e.target === accessLogModal) accessLogModal.classList.add('hidden');
});

// 拉取并渲染访问日志列表
async function refreshAccessLogs() {
  try {
    const result = await window.playlistAPI.getAccessLogs();
    if (!result.ok) {
      accessLogCount.textContent = '加载失败';
      return;
    }
    if (!result.enabled) {
      accessLogCount.textContent = '日志记录未开启';
      accessLogList.innerHTML = '';
      accessLogEmpty.classList.remove('hidden');
      accessLogEmpty.textContent = '请先在高级网络设置中开启"访问日志记录"';
      return;
    }
    const logs = result.logs || [];
    accessLogCount.textContent = `共 ${logs.length} 条记录 (最多保留 500 条)`;
    if (logs.length === 0) {
      accessLogList.innerHTML = '';
      accessLogEmpty.classList.remove('hidden');
      accessLogEmpty.textContent = '暂无访问记录';
      return;
    }
    accessLogEmpty.classList.add('hidden');
    // 渲染日志列表
    const frag = document.createDocumentFragment();
    logs.forEach(log => {
      const li = document.createElement('li');
      li.className = 'access-log-item action-' + getActionClass(log.action);
      const timeStr = formatLogTime(log.ts);
      const actionColor = getActionColor(log.action);
      li.innerHTML =
        '<span class="al-time">' + escapeAlHtml(timeStr) + '</span>'
        + '<span class="al-ip">' + escapeAlHtml(log.ip || '') + '</span>'
        + '<span class="al-action" style="color:' + actionColor + '">' + escapeAlHtml(log.action || '') + '</span>'
        + '<span class="al-detail">' + escapeAlHtml(log.detail || '') + '</span>';
      frag.appendChild(li);
    });
    accessLogList.innerHTML = '';
    accessLogList.appendChild(frag);
  } catch (e) {
    accessLogCount.textContent = '加载失败: ' + e.message;
  }
}

function getActionClass(action) {
  if (!action) return 'other';
  if (action === '下载歌曲') return 'download';
  if (action === '访问歌单') return 'playlist';
  if (action === '获取封面') return 'cover';
  if (action === '获取歌词') return 'lyric';
  if (action === '拒绝访问' || action === '频率超限') return 'reject';
  return 'other';
}
function getActionColor(action) {
  switch (action) {
    case '下载歌曲': return '#4caf50';  // 绿色 (重要行为)
    case '访问歌单': return '#5aa9ff';  // 蓝色
    case '获取封面': return '#a78bfa';  // 紫色
    case '获取歌词': return '#fbbf24';  // 黄色
    case '拒绝访问': return '#ef4444';  // 红色 (异常)
    case '频率超限': return '#f97316';  // 橙色 (异常)
    default: return 'var(--fg2, #888)';
  }
}
function formatLogTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function escapeAlHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 列表 ↔ 播放器 视图切换
// 左下角头像点击: 只切换 UI 视图到首页(方便看歌词), 不改 playContext
// 修复 bug: 用户在"我喜欢"视图点歌后切首页看歌词, 下一首仍应在 liked 列表内循环
// 试听模式下也允许切回播放器视图 (curIdx 可能为 -1, 但试听仍在进行)
nowPlaying.addEventListener('click', () => {
  if (curIdx < 0 && !(typeof fmPreviewMode !== 'undefined' && fmPreviewMode)) return;
  if (currentView !== 'home') {
    currentView = 'home';
    try { localStorage.setItem('sqet-current-view', 'home'); } catch (e) {}
    navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'home'));
  }
  // 注意: 不修改 playContext, 保持用户点歌时的播放上下文
  showPlayerView();
});

// 桌面歌词开关
btnDesktopLyric.addEventListener('click', toggleDesktopLyric);
btnLyricLock.addEventListener('click', toggleDesktopLyricLock);

// 悬浮播放列表
btnFloatList.addEventListener('click', () => setFloatListExpanded(true));
btnFlClose.addEventListener('click', () => setFloatListExpanded(false));
// 性能: 加防抖, 避免快速输入时每次按键都触发完整渲染
let _flSearchDebounce = null;
flSearch.addEventListener('input', () => {
  clearTimeout(_flSearchDebounce);
  _flSearchDebounce = setTimeout(() => renderFloatList(), 120);
});
flSearch.addEventListener('click', e => e.stopPropagation());

// 窗口控制
$('btn-minimize').addEventListener('click', () => window.windowAPI.minimize());
btnMax.addEventListener('click', async () => {
  const isMax = await window.windowAPI.toggleMaximize();
  btnMax.innerHTML = isMax ? ICON_RESTORE : ICON_MAXIMIZE;
  btnMax.title = isMax ? '还原' : '最大化';
});
$('btn-close').addEventListener('click', () => window.windowAPI.close());
document.querySelector('.drag-region').addEventListener('dblclick', async () => {
  const isMax = await window.windowAPI.toggleMaximize();
  btnMax.innerHTML = isMax ? ICON_RESTORE : ICON_MAXIMIZE;
  btnMax.title = isMax ? '还原' : '最大化';
});
window.windowAPI.onWindowState((isMax) => {
  btnMax.innerHTML = isMax ? ICON_RESTORE : ICON_MAXIMIZE;
  btnMax.title = isMax ? '还原' : '最大化';
});

// 键盘
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); btnPlay.click(); break;
    case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); if (!isPlaying) syncLrc(audio.currentTime); break;
    case 'ArrowRight': audio.currentTime = Math.min(getDuration() || 0, audio.currentTime + 5); if (!isPlaying) syncLrc(audio.currentTime); break;
    case 'ArrowUp': e.preventDefault(); {
      const cur = gainNode ? gainNode.gain.value : audio.volume;
      const nv = Math.min(1.5, cur + 0.05);
      if (typeof cancelFade === 'function') cancelFade();
      setVol(nv); volSlider.value = Math.round(nv * 100);
      appSettings.volume = nv; saveUserData(); updVol();
      break;
    }
    case 'ArrowDown': e.preventDefault(); {
      const cur = gainNode ? gainNode.gain.value : audio.volume;
      const nv = Math.max(0, cur - 0.05);
      if (typeof cancelFade === 'function') cancelFade();
      setVol(nv); volSlider.value = Math.round(nv * 100);
      appSettings.volume = nv; saveUserData(); updVol();
      break;
    }
  }
});

// 兜底
coverImg.addEventListener('error', () => { coverImg.style.display = 'none'; coverPH.classList.remove('hidden'); });
npCover.addEventListener('error', () => { npCover.style.display = 'none'; npPh.classList.remove('hidden'); });
let _resizeTimer = null;
window.addEventListener('resize', () => {
  lineMetrics = [];
  _cachedLineEls = null;
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { _resizeTimer = null; }, 150);
});
window.addEventListener('beforeunload', () => {
  flushDuration();
  saveCurrentProgress();
  // 同步写盘: beforeunload 触发时渲染进程即将销毁, async invoke 可能来不及到达主进程
  // sendSync 阻塞直到主进程 writeFileSync 完成, 确保进度不丢
  if (typeof window.musicAPI.saveUserDataSync === 'function') {
    window.musicAPI.saveUserDataSync({
      likes: [...likedSet.entries()].map(([path, ts]) => ({ path, ts })),
      collections: (typeof _serializeCollections === 'function') ? _serializeCollections() : [],
      stats: stats,
      progress: progress, lastSession: lastSession,
      actualDuration: actualDuration, settings: appSettings,
    });
  }
});
