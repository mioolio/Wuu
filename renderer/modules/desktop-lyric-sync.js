// =========== 桌面歌词同步 ===========
function sendLyricDataToDesktop() {
  if (!desktopLyricOn) return;
  if (!lrc.length) {
    window.desktopLyric.send({ type: 'clear' });
    return;
  }
  window.desktopLyric.send({
    type: 'data',
    lrc: { raw: lrcRaw, lines: lrc },
    // 传递模拟走字设置, 让桌面歌词对低精度歌词也按时间进度填充
    simulate: !lrcRaw && appSettings.simulateLrcProgress,
  });
  // 同步跑马灯设置 (与歌词数据一起发送, 确保桌面歌词用最新设置渲染)
  sendMarqueeSettingsToDesktop();
  desktopLyricDataSent = true;
}

// 发送跑马灯设置到桌面歌词窗口
// 桌面歌词是独立窗口, 有自己的渲染循环, 需主动推送设置变更
function sendMarqueeSettingsToDesktop() {
  if (!desktopLyricOn) return;
  window.desktopLyric.send({
    type: 'settings',
    settings: {
      marqueeEnabled: appSettings.marqueeEnabled !== false,
      marqueeThreshold: typeof appSettings.marqueeThreshold === 'number'
        ? appSettings.marqueeThreshold : 1.0,
    },
  });
}

function sendCoverColorToDesktop() {
  if (!desktopLyricOn) return;
  window.desktopLyric.send({ type: 'color', color: _lastCoverColor });
}

function sendSongInfoToDesktop() {
  if (!desktopLyricOn) return;
  // 试听模式: 使用试听歌曲信息 (非本地歌库歌曲)
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    window.desktopLyric.send({ type: 'info', info: { title: fmPreviewSong.name || '', artist: fmPreviewSong.artist || '' } });
    return;
  }
  const s = songs[curIdx];
  if (!s) return;
  window.desktopLyric.send({ type: 'info', info: { title: s.songName, artist: s.artist } });
}

function startDesktopLyricRAF() {
  if (!desktopLyricOn || desktopLyricRaf !== null) return;
  window.desktopLyric.send({ type: 'time', t: audio.currentTime, playing: isPlaying });
  desktopLyricRaf = setInterval(() => {
    window.desktopLyric.send({ type: 'time', t: audio.currentTime, playing: isPlaying });
  }, 200);
}

function stopDesktopLyricRAF() {
  if (desktopLyricRaf !== null) {
    clearInterval(desktopLyricRaf);
    desktopLyricRaf = null;
  }
  if (desktopLyricOn) {
    window.desktopLyric.send({ type: 'time', t: audio.currentTime, playing: false });
  }
}

async function toggleDesktopLyric() {
  desktopLyricOn = !desktopLyricOn;
  btnDesktopLyric.classList.toggle('active', desktopLyricOn);
  if (desktopLyricOn) {
    await window.desktopLyric.toggle(true);
    sendLyricDataToDesktop();
    sendCoverColorToDesktop();
    sendSongInfoToDesktop();
    if (isPlaying) startDesktopLyricRAF();
    btnLyricLock.classList.remove('hidden');
    if (desktopLyricLocked) await window.desktopLyric.lock(true);
  } else {
    stopDesktopLyricRAF();
    await window.desktopLyric.toggle(false);
    desktopLyricDataSent = false;
    btnLyricLock.classList.add('hidden');
  }
}

// 桌面歌词窗口通过X按钮关闭时, 同步主窗口状态
// (不调用 stopDesktopLyricRAF, 避免向已隐藏的窗口发送多余的 time 消息)
window.desktopLyric.onClosed(() => {
  if (desktopLyricRaf !== null) {
    clearInterval(desktopLyricRaf);
    desktopLyricRaf = null;
  }
  desktopLyricOn = false;
  btnDesktopLyric.classList.remove('active');
  desktopLyricDataSent = false;
  btnLyricLock.classList.add('hidden');
});

// 桌面歌词窗口位置同步: 主进程 moved 事件已写入 userdata, 通知渲染进程同步 appSettings
// 避免下次 saveUserData() 用 appSettings.desktopLyricBounds=null 覆盖主进程写入的位置
window.desktopLyric.onBoundsSaved((pos) => {
  appSettings.desktopLyricBounds = pos;
});

async function toggleDesktopLyricLock() {
  desktopLyricLocked = !desktopLyricLocked;
  await window.desktopLyric.lock(desktopLyricLocked);
  btnLyricLock.innerHTML = desktopLyricLocked
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
  btnLyricLock.classList.toggle('active', desktopLyricLocked);
  btnLyricLock.title = desktopLyricLocked ? '关闭鼠标穿透' : '开启鼠标穿透';
  // 持久化穿透锁定状态 (重启后恢复)
  appSettings.desktopLyricLocked = desktopLyricLocked;
  saveUserData();
}
