// =========== 应用设置 + 迷你条更新 ===========
function applySettings() {
  const root = document.documentElement;
  settingShowFloatBtn.checked = appSettings.showFloatListBtn;
  settingGlassOpacity.value = appSettings.glassOpacity;
  glassOpacityVal.textContent = Math.round(appSettings.glassOpacity * 100) + '%';
  settingDiscCover.checked = appSettings.discCover;
  settingColorIntensity.value = appSettings.colorIntensity;
  colorIntensityVal.textContent = Math.round(appSettings.colorIntensity * 100) + '%';
  settingThemeFollowCover.checked = appSettings.themeFollowCover;
  settingCoverChange.checked = appSettings.coverUnify !== false;
  settingLyricPersist.checked = appSettings.desktopLyricPersist === true;
  settingSimulateLrc.checked = appSettings.simulateLrcProgress;
  settingArtistGroupMode.value = appSettings.artistGroupMode || 'bucket';
  // 进度条颜色: 启用开关 + 两色渐变; 关闭时跟随封面色
  settingProgressColorEnabled.checked = appSettings.progressColorEnabled === true;
  settingProgressColor.value = appSettings.progressColor || '#fb7299';
  settingProgressColor2.value = appSettings.progressColor2 || '#ff5e8a';

  // 应用进度条颜色到 CSS 变量
  applyProgressColor();
  // 已唱色必须深于未唱色, 防止两者视觉无区分
  if (appSettings.lyricDone <= appSettings.lyricWait) {
    appSettings.lyricWait = Math.max(0.1, appSettings.lyricDone - 0.1);
  }
  settingLyricDone.value = appSettings.lyricDone;
  lyricDoneVal.textContent = Math.round(appSettings.lyricDone * 100) + '%';
  settingLyricWait.value = appSettings.lyricWait;
  lyricWaitVal.textContent = Math.round(appSettings.lyricWait * 100) + '%';
  settingLyricSize.value = appSettings.lyricSize;
  lyricSizeVal.textContent = appSettings.lyricSize + 'px';
  // 跑马灯设置
  if (settingMarqueeEnabled) settingMarqueeEnabled.checked = appSettings.marqueeEnabled !== false;
  if (settingMarqueeSpeed) {
    settingMarqueeSpeed.value = appSettings.marqueeSpeed;
    marqueeSpeedVal.textContent = appSettings.marqueeSpeed + ' px/s';
  }
  if (settingMarqueeThreshold) {
    settingMarqueeThreshold.value = appSettings.marqueeThreshold;
    marqueeThresholdVal.textContent = appSettings.marqueeThreshold.toFixed(1) + 'x';
  }
  if (settingMarqueePause) {
    settingMarqueePause.value = appSettings.marqueePause;
    marqueePauseVal.textContent = appSettings.marqueePause.toFixed(1) + 's';
  }
  // 暂停音量淡出开关 (默认开启: appSettings.fadePause !== false)
  if (settingFadePause) settingFadePause.checked = appSettings.fadePause !== false;
  // 对外地址设置
  if (settingPublicHostMode) settingPublicHostMode.value = appSettings.publicHostMode === 'manual' ? 'manual' : 'auto';
  if (settingPublicHost) {
    settingPublicHost.value = appSettings.publicHost || '';
    // 自动获取模式下禁用输入框
    settingPublicHost.disabled = appSettings.publicHostMode !== 'manual';
  }
  if (settingPublicPort) settingPublicPort.value = appSettings.publicPort > 0 ? appSettings.publicPort : '';

  // 网络服务
  settingServerEnabled.checked = appSettings.serverEnabled === true;
  if (settingMobileEnabled) settingMobileEnabled.checked = appSettings.mobileEnabled === true;
  settingServerPort.value = appSettings.serverPort || 30967;
  // 高级网络设置: IP 绑定 + 白名单 + 频率限制 + 日志开关 (可折叠菜单栏, 默认收起)
  if (settingServerBindIP) settingServerBindIP.value = appSettings.serverBindIP || '0.0.0.0';
  if (settingServerWhitelist) {
    const wl = Array.isArray(appSettings.serverWhitelist) ? appSettings.serverWhitelist : [];
    settingServerWhitelist.value = wl.join('\n');
  }
  if (settingServerRateLimit) settingServerRateLimit.value = appSettings.serverRateLimit || 0;
  if (settingServerAccessLog) settingServerAccessLog.checked = appSettings.serverAccessLog === true;
  updServerStatusText();

  root.style.setProperty('--glass-opacity', appSettings.glassOpacity);
  root.style.setProperty('--color-intensity', appSettings.colorIntensity);
  root.style.setProperty('--lyric-done-opacity', appSettings.lyricDone);
  root.style.setProperty('--lyric-wait-opacity', appSettings.lyricWait);
  root.style.setProperty('--lyric-size', appSettings.lyricSize + 'px');

  if (currentMode === 'player' && currentView === 'home') {
    btnFloatList.classList.toggle('hidden', !appSettings.showFloatListBtn);
  }

  if (coverEl) {
    coverEl.classList.toggle('disc', appSettings.discCover);
  }

  // 恢复保存的音量值 (WebAudio 增益, 0 ~ 1.5)
  // applySettings 在启动时调用, 此时 gainNode 尚未初始化(延迟到首次 play)
  // setVol 内部会判断: gainNode 不可用时回退到 audio.volume, 首次 play 初始化后需重新设置
  if (typeof appSettings.volume === 'number') {
    setVol(appSettings.volume);
    const volSlider = $('vol-slider');
    if (volSlider) volSlider.value = Math.round(appSettings.volume * 100);
    if (typeof updVol === 'function') updVol();
  }
}

// 应用进度条颜色: 启用时用两色渐变, 关闭时清除自定义色跟随封面多彩渐变
function applyProgressColor() {
  const root = document.documentElement;
  if (appSettings.progressColorEnabled) {
    const c1 = appSettings.progressColor || '#fb7299';
    const c2 = appSettings.progressColor2 || c1;
    // 用 --progress-bg 直接设置完整渐变, CSS 中 background 引用
    root.style.setProperty('--progress-bg', `linear-gradient(90deg, ${c1}, ${c2})`);
  } else {
    // 关闭: 清除自定义色, 回退到封面多彩渐变(--cover-progress-gradient)或主色
    root.style.removeProperty('--progress-bg');
  }
}

// 更新网络服务状态文本
async function updServerStatusText() {
  if (!serverStatusText) return;
  // 服务器在 歌单分享 或 手机版 任一开启时运行
  const serverShouldRun = appSettings.serverEnabled || appSettings.mobileEnabled;
  if (serverShouldRun) {
    try {
      const st = await window.playlistAPI.serverStatus();
      if (st.ok && st.running) {
        serverStatusText.textContent = `运行中 · 端口 ${st.port}`;
        serverStatusText.style.color = '#4caf50';
      } else {
        serverStatusText.textContent = '已关闭';
        serverStatusText.style.color = 'var(--fg2, #888)';
      }
    } catch (e) {
      serverStatusText.textContent = '状态未知';
      serverStatusText.style.color = 'var(--fg2, #888)';
    }
  } else {
    serverStatusText.textContent = '已关闭';
    serverStatusText.style.color = 'var(--fg2, #888)';
  }
}

function updNowPlaying() {
  // 试听模式: 用试听歌曲信息更新左下角
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    nowPlaying.classList.remove('hidden');
    npTitle.textContent = fmPreviewSong.name || '未知歌曲';
    npArtist.textContent = fmPreviewSong.artist || '';
    // 封面统一性: 换源中(_fmSwitchingSource=true)时跳过左下角小封面更新, 保留原封面
    const skipCover = appSettings.coverUnify !== false && typeof _fmSwitchingSource !== 'undefined' && _fmSwitchingSource;
    if (!skipCover) {
      if (fmPreviewSong.cover) {
        npCover.src = fmPreviewSong.cover;
        npCover.style.display = '';
        npPh.classList.add('hidden');
      } else {
        npCover.style.display = 'none';
        npPh.classList.remove('hidden');
      }
    }
    return;
  }
  const s = songs[curIdx];
  if (!s) { nowPlaying.classList.add('hidden'); return; }
  nowPlaying.classList.remove('hidden');
  npTitle.textContent = s.songName;
  npArtist.textContent = s.artist;
  if (s.coverPath) {
    npCover.src = toUrl(s.coverPath);
    npCover.style.display = '';
    npPh.classList.add('hidden');
  } else {
    npCover.style.display = 'none';
    npPh.classList.remove('hidden');
  }
}
