// =========== Video 元素(兼容音频) + 事件 + RAF + 播放核心 + 进度条 + Tick ===========
// 使用 <video> 元素而非 <audio>: 视频类型歌曲可在 .cover 区域显示画面
// 音频模式时不挂载到 DOM, 行为等同于 audio 元素
const audio = document.createElement('video');
audio.id = 'media-player';
audio.playsInline = true;
// 音量通过 WebAudio GainNode 控制, 允许 >1.0 增益
// 原因: Chromium 的 AAC 解码输出比 Windows Media Foundation 小声(已知现象)
// HTMLMediaElement.volume 最大 1.0 无法补偿, 用 GainNode 让用户可调高至 1.5x
// audio.volume 固定 1.0, 所有音量控制通过 gainNode.gain
audio.volume = 1.0;

// 视频模式标记: true 时进入沉浸式视频模式, 独占 player-main 区域
let videoMode = false;
const videoMountEl = document.getElementById('video-mount');
const videoStageEl = document.getElementById('video-stage');
const videoTitleEl = document.getElementById('video-title');
const videoArtistEl = document.getElementById('video-artist');
const videoLikeBtn = document.getElementById('btn-video-like');
const videoSaveBtn = document.getElementById('btn-video-save');

// 切换视频模式: show=true 时独占 player-main 显示视频画面, 隐藏封面/歌词/元信息
// show=false 时总是执行重置(即使 videoMode 已是 false), 确保从汽水视频试听切换到其他试听模块时正确清理
function setVideoMode(show) {
  if (show === videoMode && show === true) return;
  videoMode = show;
  if (show) {
    // 挂载 video 元素到 #video-mount (在 #video-stage 内)
    if (videoMountEl) {
      videoMountEl.appendChild(audio);
    }
    // 显示视频舞台, body 加 class 触发 CSS 隐藏封面/歌词/元信息
    if (videoStageEl) videoStageEl.classList.remove('hidden');
    document.body.classList.add('video-mode');
    // 填充作者信息 (从当前播放歌曲的标题/作者)
    if (videoTitleEl && typeof titleEl !== 'undefined') videoTitleEl.textContent = titleEl.textContent || '';
    if (videoArtistEl && typeof artistEl !== 'undefined') videoArtistEl.textContent = artistEl.textContent || '';
    // 同步收藏按钮状态 (复用主播放器的收藏状态)
    if (videoLikeBtn && typeof btnLike !== 'undefined' && btnLike) {
      videoLikeBtn.classList.toggle('liked', btnLike.classList.contains('liked'));
    }
  } else {
    // 卸载 video 元素(回到纯音频模式)
    if (audio.parentNode === videoMountEl) {
      videoMountEl.removeChild(audio);
    }
    if (videoStageEl) videoStageEl.classList.add('hidden');
    document.body.classList.remove('video-mode');
    // 清空作者信息
    if (videoTitleEl) videoTitleEl.textContent = '';
    if (videoArtistEl) videoArtistEl.textContent = '';
  }
}

// 延迟初始化 AudioContext: 首次 play() 时创建(createMediaElementSource 后音频改走 WebAudio 路径)
let audioCtx = null;
let gainNode = null;
let mediaSource = null;

// 初始化 WebAudio 增益链: audio → MediaElementSource → GainNode → destination
// 必须延迟到用户手势后(Electron 通常无此限制, 但保险起见在首次 play 调用)
function initWebAudio() {
  if (audioCtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;  // 不支持 WebAudio 时回退到 audio.volume
    audioCtx = new Ctx();
    mediaSource = audioCtx.createMediaElementSource(audio);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.0;
    mediaSource.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    // 初始化完成后恢复保存的音量值(此前 setVol 回退到 audio.volume 被 1.0 限制)
    if (typeof appSettings !== 'undefined' && typeof appSettings.volume === 'number') {
      setVol(appSettings.volume);
    }
    if (typeof updVol === 'function') updVol();
  } catch (e) {
    console.error('[WebAudio] 初始化失败, 回退到 audio.volume:', e);
    audioCtx = null; gainNode = null; mediaSource = null;
  }
}

// 设置音量增益 (0 ~ 1.5)
// v <= 1.0: GainNode.gain = v (等同于普通音量)
// v > 1.0: GainNode.gain = v (放大, 可能失真, 由用户负责)
// WebAudio 不可用时回退到 audio.volume (受 1.0 上限限制)
function setVol(v) {
  v = Math.max(0, Math.min(1.5, v));
  if (gainNode) {
    gainNode.gain.value = v;
  } else {
    // 回退: WebAudio 未初始化时用 audio.volume (最大 1.0)
    audio.volume = Math.min(1, v);
  }
}

// =========== 暂停渐变 (0.5s 音量淡出, 类似网易云音乐) ===========
// fadeTimer: 渐变定时器引用; fadeTargetVol: 渐变开始前的目标音量 (用于取消时恢复)
// 渐变期间 isPlaying 仍为 true, 避免 UI 提前切换为暂停态造成视觉抖动
let fadeTimer = null;
let fadeTargetVol = 0;

// 取消正在进行的渐变 (切歌/重新播放/拖动音量时调用)
function cancelFade() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  if (fadeTargetVol > 0) {
    setVol(fadeTargetVol);
    fadeTargetVol = 0;
  }
}

// 暂停渐变: 在 duration 内将音量从当前值线性渐变到 0, 然后暂停
// 期间用户可再次点击恢复播放 (cancelFade 会自动取消渐变并恢复音量)
function fadePause(duration = 0.5) {
  // WebAudio 不可用: 直接暂停 (无渐变)
  if (!gainNode) {
    audio.pause();
    return;
  }
  // 已有渐变进行中: 不重复启动, 直接触发最终暂停
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
    setVol(0);
    audio.pause();
    // 恢复音量 (在暂停后, 下次 play 时 setVol 会被调用)
    if (fadeTargetVol > 0) { setVol(fadeTargetVol); fadeTargetVol = 0; }
    return;
  }
  const startVol = gainNode.gain.value;
  fadeTargetVol = startVol;
  // 渐变步进: 60fps, 每帧减少 startVol * (16.67 / (duration*1000))
  const stepMs = 16;
  const totalSteps = Math.max(1, Math.round(duration * 1000 / stepMs));
  const volStep = startVol / totalSteps;
  let stepCount = 0;
  fadeTimer = setInterval(() => {
    stepCount++;
    const newVol = startVol - volStep * stepCount;
    if (newVol <= 0 || stepCount >= totalSteps) {
      // 渐变完成: 暂停并恢复音量
      clearInterval(fadeTimer);
      fadeTimer = null;
      setVol(0);
      audio.pause();
      // 恢复音量到渐变前水平 (此时 audio 已暂停, 设置 gain 不影响输出)
      setVol(fadeTargetVol);
      fadeTargetVol = 0;
    } else {
      setVol(newVol);
    }
  }, stepMs);
}

function dbgAudio(evt) { /* no-op */ }

audio.addEventListener('loadedmetadata', () => {
  seekInProgress = false;
  lastSeekTarget = -1;
  const dur = getDuration();
  // 调试: loadedmetadata 是 audio.duration 可用的时刻, 可能覆盖 realDuration
  const s = songs[curIdx];
  console.log('[DBG:loadedmetadata]', {
    song: s ? `${s.songName} - ${s.artist}` : '(null)',
    audioPath: s ? s.audioPath : '(null)',
    audioSrc: audio.src ? audio.src.slice(0, 80) : '(empty)',
    audioDuration: audio.duration,
    realDuration: s ? s.realDuration : '(null)',
    getDurationResult: dur,
    fmPreviewMode,
  });
  tEnd.textContent = fmt(dur);
});
audio.addEventListener('timeupdate', onTick);
audio.addEventListener('play', () => {
  isPlaying = true; btnPlay.innerHTML = ICON_PAUSE;
  startLrcRAF();
  startDesktopLyricRAF();
  lastTickWall = performance.now();
  if (coverEl) coverEl.classList.add('playing');
});
audio.addEventListener('pause', () => {
  dbgAudio('pause');
  isPlaying = false; btnPlay.innerHTML = ICON_PLAY; stopLrcRAF();
  stopDesktopLyricRAF();
  flushDuration();
  saveCurrentProgress();
  if (coverEl) coverEl.classList.remove('playing');
});
audio.addEventListener('ended', () => {
  dbgAudio('ended');
  if (snapEndedPending) {
    snapEndedPending = false;
    return;
  }
  onEnd();
});
audio.addEventListener('error', (e) => {
  dbgAudio('error');
  // 详细错误信息: code/message 能区分解码失败(MEDIA_ERR_DECODE=3) / 网络失败 / 源不支持等
  const err = audio.error || {};
  const errCodeMap = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
  };
  const s = songs[curIdx];
  console.error('[AUDIO:error]', {
    code: err.code,
    codeName: errCodeMap[err.code] || '(unknown)',
    message: err.message || '',
    song: s ? `${s.songName} - ${s.artist}` : '(null)',
    audioSrc: audio.src ? audio.src.slice(0, 120) : '(empty)',
    audioPath: s ? s.audioPath : '(null)',
    fmPreviewMode,
    fmPreviewSong: fmPreviewSong ? `${fmPreviewSong.name} - ${fmPreviewSong.artist} (source=${fmPreviewSong.source})` : '(null)',
    readyState: audio.readyState,
    networkState: audio.networkState,
    duration: audio.duration,
  });
  isPlaying = false; btnPlay.innerHTML = ICON_PLAY; stopLrcRAF(); stopDesktopLyricRAF();
  // 试听模式: 触发换源回退
  if (fmPreviewMode && typeof handleFmAudioError === 'function') handleFmAudioError();
});
audio.addEventListener('seeking', () => dbgAudio('seeking'));
audio.addEventListener('seeked', () => {
  dbgAudio('seeked');
  if (lastSeekTarget >= 0 && audio.currentTime > lastSeekTarget + 0.5) {
    snapEndedPending = true;
    const dur = getDuration();
    if (dur > 0 && lastSeekTarget <= dur) {
      const safeT = Math.max(0, lastSeekTarget - 1);
      audio.currentTime = safeT;
      tNow.textContent = fmt(safeT);
      pFill.style.width = `${(safeT / dur) * 100}%`;
    }
  }
  seekInProgress = false;
  lastSeekTarget = -1;
  lastAudioTime = audio.currentTime;
});

// RAF 歌词循环
function startLrcRAF() {
  if (rafId !== null) return;
  const loop = () => {
    // try-catch 保护: syncLrc 内部任何异常不能导致 RAF 永久停止
    try { syncLrc(audio.currentTime); } catch (e) { console.error('[LRC:syncLrc]', e); }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}
function stopLrcRAF() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function flushDuration() {
  // 试听模式: 不记录本地时长
  if (fmPreviewMode) return;
  const s = songs[curIdx];
  if (!s || !isPlaying) return;
  const now = performance.now();
  const delta = (now - lastTickWall) / 1000;
  lastTickWall = now;
  if (delta > 0 && delta < 5) addDuration(s, delta);
}

// =========== 播放核心 ===========
// updateContext: 是否用 currentView 更新 playContext
//   - true: 用户从列表/排行榜手动点歌, playContext = currentView
//   - false: 自动续播(onEnd) / 上一首下一首按钮, 保持当前 playContext
async function play(idx, autoResume = true, updateContext = true) {
  // 首次播放时初始化 WebAudio 增益链 (延迟初始化避开浏览器自动播放策略)
  initWebAudio();
  // 取消可能进行中的暂停渐变 (避免切歌时音量被留在 0)
  cancelFade();
  // 若处于试听模式, 先退出 (用户点击了本地歌曲列表)
  if (fmPreviewMode && typeof exitFmPreviewMode === 'function') exitFmPreviewMode();
  if (idx < 0 || idx >= songs.length) return;
  const s0 = songs[idx];
  if (curIdx !== idx && curIdx >= 0) { flushDuration(); saveCurrentProgress(); }
  curIdx = idx;
  const s = songs[idx];
  seekInProgress = false;
  lastSeekTarget = -1;
  snapEndedPending = false;
  lastAudioTime = 0;
  // 重置进度保存计时: 避免上一首的高水位 lastProgressSave 导致新歌前几十秒不保存进度
  // (例如上一首在 50s 处切歌, lastProgressSave=50, 新歌要播放到 52s 才首次保存进度)
  lastProgressSave = -9999;

  // 播放上下文: 仅用户手动点歌时更新为 currentView
  // 自动续播/上一首下一首保持当前 playContext, 修复"liked 视图点歌后切首页, 下一首跳到大列表"的 bug
  if (updateContext) playContext = currentView;

  // 随机模式: 手动点歌时把对应上下文的 shufflePos 跳到该歌在队列中的位置
  // 这样下一首就是队列里它的下一首, 符合用户直觉
  if (updateContext && playMode === 2) {
    if (playContext === 'liked' && shuffleQueueLiked.length > 0) {
      const pos = shuffleQueueLiked.indexOf(idx);
      if (pos >= 0) shufflePosLiked = pos;
    } else if (playContext === 'home' && shuffleQueue.length > 0) {
      const pos = shuffleQueue.indexOf(idx);
      if (pos >= 0) shufflePos = pos;
    }
  }

  // 预加载歌词
  let newLrc = [];
  let newLrcRaw = false;
  // lrcTagCredits: 从 LRC 头部 tag 提取的作词/作曲 (后备来源)
  let lrcTagCredits = { lyricist: '', composer: '' };
  if (s.rawPath) {
    try {
      const txt = await window.musicAPI.getLyrics(s.rawPath);
      const p = parseRaw(txt);
      // [DEBUG] 诊断 rawPath 解析
      console.log('[RAW LRC DEBUG] rawPath=' + s.rawPath +
        ' txtLen=' + (txt ? txt.length : 0) +
        ' parsedLen=' + p.length +
        ' firstLine="' + (txt ? txt.split('\n')[0].slice(0, 80) : '') + '"');
      if (p.length) { newLrc = p; newLrcRaw = true; }
    } catch (e) {
      console.log('[RAW LRC DEBUG] rawPath 读取异常: ' + e.message);
    }
  }
  if (!newLrcRaw && s.lrcPath) {
    try {
      const txt = await window.musicAPI.getLyrics(s.lrcPath);
      // 先尝试逐字LRC格式 ([mm:ss.xx]字[mm:ss.xx]字...), 再回退普通行级LRC
      const enhanced = parseEnhancedLRC(txt);
      if (enhanced.length) { newLrc = enhanced; newLrcRaw = true; }
      else { newLrc = parseLRC(txt); }
      // 从 LRC 头部 tag 提取作词/作曲 (供 info.json 缺失时后备)
      // 支持 [lyricist:] [composer:] 以及中文 [词:] [曲:] tag
      const mLyricist = txt.match(/^\s*\[(?:lyricist|词)\s*:\s*([^\]]+)\]/im);
      const mComposer = txt.match(/^\s*\[(?:composer|曲)\s*:\s*([^\]]+)\]/im);
      if (mLyricist) lrcTagCredits.lyricist = mLyricist[1].trim();
      if (mComposer) lrcTagCredits.composer = mComposer[1].trim();
    } catch (e) {}
  }
  // 纯音乐: 无时间戳歌词时显示提示文案, 而非空白
  // 视频类型歌曲: 改为"视频请欣赏" (视频模式时歌词区已隐藏, 仅用于桌面歌词显示)
  // 检测视频类型: 没有歌词文件 (lrcPath/rawPath 都没有) 且有视频标识 (videoId/vid), 或已处于视频模式
  const isVideoSong = !!(s.videoId || s.vid) || (!s.lrcPath && !s.rawPath && s.audioPath && /\.(mp4|webm|mov|avi|mkv)$/i.test(s.audioPath));
  if (!newLrc.length) {
    newLrc = [{ time: 0, text: isVideoSong ? '视频请欣赏' : '纯音乐，请欣赏' }];
    newLrcRaw = false;
  }

  // 视频类型歌曲: 自动进入沉浸式视频模式 (无需歌词, 独占播放区域显示画面)
  // 非视频歌曲: 退出视频模式 (回到转盘封面布局)
  if (typeof setVideoMode === 'function') {
    setVideoMode(isVideoSong);
  }

  // 预加载封面
  if (s.coverPath) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = toUrl(s.coverPath);
    });
  }

  // 替换显示
  lrc = newLrc;
  lrcRaw = newLrcRaw;

  empty.classList.add('hidden');
  player.classList.remove('hidden');
  lyrics.classList.remove('hidden');

  titleEl.textContent = s.songName;
  artistEl.textContent = s.artist;
  // 作词/作曲显示: 优先 info.json(网页提取), 缺失则用 LRC tag 后备, 都缺失显示"作家缺失"
  // 用户需求: 若 lrc 无作词作曲, 从网页提取信息; 网页也无则提示缺失
  if (creditsEl) {
    let lyricist = (s.lyricist || '').trim();
    let composer = (s.composer || '').trim();
    // 后备: 从 LRC 头部 tag 提取
    if (!lyricist) lyricist = lrcTagCredits.lyricist;
    if (!composer) composer = lrcTagCredits.composer;
    if (lyricist || composer) {
      const parts = [];
      if (lyricist) parts.push('作词: ' + lyricist);
      if (composer) parts.push('作曲: ' + composer);
      creditsEl.textContent = parts.join('  ·  ');
      creditsEl.classList.remove('missing');
    } else {
      // 都缺失: 不显示任何文字
      creditsEl.textContent = '';
      creditsEl.classList.remove('missing');
    }
  }
  updLikeBtn();
  updNowPlaying();

  if (s.coverPath) {
    setCoverImage(toUrl(s.coverPath));
  } else {
    setCoverImage(null);
  }
  if (coverEl) {
    coverEl.classList.toggle('disc', appSettings.discCover);
  }
  applyCoverBackground(s.coverPath);
  renderLrc();

  if (desktopLyricOn) {
    sendSongInfoToDesktop();
    sendLyricDataToDesktop();
  }

  // 音频
  const src = toUrl(s.audioPath);
  const srcChanged = audio.src !== src;
  if (srcChanged) audio.src = src;
  // 调试: 切歌时记录关键信息
  console.log('[DBG:play]', {
    song: `${s.songName} - ${s.artist}`,
    audioPath: s.audioPath,
    src: src.slice(0, 80),
    realDuration: s.realDuration,
    fmPreviewMode,
  });

  const savedT = autoResume && progress[s.audioPath] ? progress[s.audioPath] : 0;
  const doPlay = () => {
    const dur = getDuration();
    if (savedT > 0 && dur && isFinite(dur) && savedT < dur) {
      audio.currentTime = savedT;
    }
    audio.play().catch(() => {});
  };
  if (srcChanged && savedT > 0) {
    let played = false;
    const playOnce = () => { if (played) return; played = true; doPlay(); };
    audio.addEventListener('loadedmetadata', playOnce, { once: true });
    setTimeout(playOnce, 3000);
  } else {
    doPlay();
  }

  if (srcChanged) incrPlay(s);
  syncLrc(audio.currentTime || 0);
  // 切歌时立即重置进度条显示, 避免残留上一首的进度 (onTick 尚未触发时尤为重要)
  {
    const dur = getDuration();
    const ct = audio.currentTime || 0;
    if (!dragging) pFill.style.width = (dur && isFinite(dur) && dur > 0) ? `${(ct / dur) * 100}%` : '0%';
    tNow.textContent = fmt(ct);
  }
  // 桌面歌词: 发送时间更新, 让桌面歌词立即同步到新歌位置 (暂停切歌时尤为重要)
  if (desktopLyricOn) {
    window.desktopLyric.send({ type: 'time', t: audio.currentTime || 0, playing: false });
  }
  updCur(); scrollCur();
}

function onEnd() {
  // 试听模式: 不写入本地 progress, 走试听队列的下一首
  if (fmPreviewMode) {
    if (playMode === 0) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    // 酷狗试听: 无换源队列, 直接暂停
    if (fmPreviewSong && fmPreviewSong.source === 'kugou') {
      audio.pause();
      return;
    }
    // 尝试播放试听队列下一首
    if (typeof playFmPreviewNext === 'function') playFmPreviewNext(1);
    return;
  }
  const s = songs[curIdx];
  flushDuration();
  if (s) { progress[s.audioPath] = 0; }
  if (playMode === 0) {
    // 单曲循环: 播放完重新播放也算一次新的播放
    incrPlay(s);
    audio.currentTime = 0; audio.play().catch(() => {});
  }
  else {
    // 顺序/随机模式都基于 playContext 决定 playlist
    // updateContext=false: 自动续播不改 playContext, 保持用户点歌时的上下文
    const idx = pickNextIdx(1);
    if (idx >= 0) play(idx, true, false);
  }
}

// =========== 进度条 ===========
function seekFromEvent(e) {
  const dur = getDuration();
  if (!dur || !isFinite(dur)) return;
  const r = pTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const targetT = pct * dur;
  seekInProgress = true;
  lastSeekTarget = targetT;
  audio.currentTime = targetT;
  pFill.style.width = `${pct * 100}%`;
  if (!isPlaying) syncLrc(audio.currentTime);
}

// =========== Tick ===========
function onTick() {
  // 自恢复: 如果 audio 在播放但 RAF 歌词循环停了(异常/后台节流), 重新启动
  if (isPlaying && rafId === null) {
    startLrcRAF();
  }

  const dur = getDuration();
  if (!dur || !isFinite(dur)) return;
  // seek 进行中: 不计时长, 但必须更新 lastTickWall
  // 否则 seek 完成后下次 onTick 的 delta 会包含整个 seek 期间
  // (要么 >5s 被丢弃, 要么 <5s 被错误计入 seek 期间的"未播放"时长)
  if (seekInProgress) {
    if (isPlaying) lastTickWall = performance.now();
    return;
  }

  const currTime = audio.currentTime;

  // 播放跳变检测 (试听模式跳过: 流式缓冲可能导致时间跳变)
  // 注意: dur > 0 条件必须满足, 否则 currTime > 0.5 就会误触发
  if (isPlaying && lastAudioTime > 0 && !fmPreviewMode && dur > 0) {
    const now = performance.now();
    const sinceUserJump = now - lastLyricClickTime;
    if (sinceUserJump > 500) {
      const jump = currTime - lastAudioTime;
      if (jump > 2 || currTime > dur + 0.5) {
        audio.pause();
        onEnd();
        lastAudioTime = 0;
        return;
      }
    }
  }
  lastAudioTime = currTime;

  // 补充同步: timeupdate(~250ms) 作为 RAF 的备份, 防止后台节流导致歌词停滞
  // 仅在 RAF 未运行时补偿, 避免与 RAF 重复调用
  if (isPlaying && rafId === null) {
    try { syncLrc(currTime); } catch (e) { console.error('[LRC:syncLrc:tick]', e); }
  }

  if (!dragging) {
    pFill.style.width = `${(currTime / dur) * 100}%`;
  }
  tNow.textContent = fmt(currTime);

  if (isPlaying && lastTickWall > 0) {
    const now = performance.now();
    const delta = (now - lastTickWall) / 1000;
    // 试听模式: 不记录本地时长
    if (delta > 0 && delta < 5 && !fmPreviewMode) addDuration(songs[curIdx], delta);
    lastTickWall = now;
  }

  // 试听模式: 不保存进度到本地
  if (!fmPreviewMode) {
    const s = songs[curIdx];
    if (s && isPlaying) {
      const sec = Math.floor(currTime);
      if (sec - lastProgressSave >= 2) {
        lastProgressSave = sec;
        progress[s.audioPath] = sec;
        lastSession = { audioPath: s.audioPath, t: sec };
        saveUserDataImmediate();
      }
    }
  }
}
