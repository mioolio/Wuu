// =========== 启动初始化 ===========
(async () => {
  btnMode.title = MODE_NAMES[playMode];

  const [songList, userData] = await Promise.all([
    window.musicAPI.getSongs(),
    window.musicAPI.getUserData(),
  ]);
  songs = songList;
  genreOverrides = userData.genreOverrides && typeof userData.genreOverrides === 'object' && !Array.isArray(userData.genreOverrides) ? userData.genreOverrides : {};
  if (_pendingDurUpdates.length) {
    _pendingDurUpdates.forEach(_applyDurationPayload);
    _pendingDurUpdates = [];
  }

  // 老数据迁移 + 持久化加载
  // 兼容多种历史格式:
  //   1) localStorage 旧格式: [path, ...]  (sqet-likes)
  //   2) userdata.json 旧格式: likes: [path, ...]
  //   3) userdata.json 中间格式: likes: [{path, ts}, ...]
  //   4) userdata.json 新格式: collections: [{id, name, songs: [...], createdAt}]
  const legacyLocalLikes = JSON.parse(localStorage.getItem('sqet-likes') || '[]');
  likedSet = new Map();
  collections = [];
  activeCollectionId = null;
  const _migrateNow = Date.now();

  // 收集旧格式 likes 数据 (用于迁移到默认歌单)
  const _legacyLikesArr = [];  // [{path, ts}]
  if (Array.isArray(userData.likes) && userData.likes.length > 0) {
    if (typeof userData.likes[0] === 'string') {
      // 旧格式: [path, ...]  补当前时间作为点赞时间
      userData.likes.forEach((path, i) => _legacyLikesArr.push({ path, ts: _migrateNow - i }));
    } else {
      // 中间格式: [{path, ts}, ...]
      userData.likes.forEach(item => {
        if (item && item.path) _legacyLikesArr.push({ path: item.path, ts: item.ts || _migrateNow });
      });
    }
  } else if (legacyLocalLikes.length > 0) {
    // 无 userdata 但有 localStorage 旧数据
    legacyLocalLikes.forEach((path, i) => _legacyLikesArr.push({ path, ts: _migrateNow - i }));
    localStorage.removeItem('sqet-likes');
  }

  // 加载新格式 collections
  if (Array.isArray(userData.collections) && userData.collections.length > 0) {
    userData.collections.forEach(c => {
      if (c && c.id && c.name) {
        // 兼容 songs 为数组或 Set 序列化结果
        const songsArr = Array.isArray(c.songs) ? c.songs : [];
        collections.push({
          id: c.id,
          name: c.name,
          songs: new Set(songsArr),
          createdAt: c.createdAt || _migrateNow,
        });
      }
    });
  }

  // 加载不推荐列表 (dislikes)
  // 兼容两种格式: [path, ...] (旧) 或 [{path, ts}, ...] (新)
  dislikedSet = new Map();
  if (Array.isArray(userData.dislikes) && userData.dislikes.length > 0) {
    if (typeof userData.dislikes[0] === 'string') {
      userData.dislikes.forEach((path, i) => dislikedSet.set(path, _migrateNow - i));
    } else {
      userData.dislikes.forEach(item => {
        if (item && item.path) dislikedSet.set(item.path, item.ts || _migrateNow);
      });
    }
  }

  // 如果没有 collections 但有旧 likes 数据, 迁移到默认歌单 "我喜欢的音乐"
  if (collections.length === 0 && _legacyLikesArr.length > 0) {
    const defaultColl = {
      id: _genCollectionId(),
      name: '我喜欢的音乐',
      songs: new Set(_legacyLikesArr.map(x => x.path)),
      createdAt: _migrateNow,
    };
    collections.push(defaultColl);
    // 保留原始点赞时间戳到 likedSet (rebuildLikedSet 不会覆盖已有 timestamp)
    _legacyLikesArr.forEach(x => likedSet.set(x.path, x.ts));
    saveUserData();
  }

  // 重建 likedSet (所有歌单歌曲的并集), 保留已设置的 timestamp
  rebuildLikedSet();
  stats = Object.fromEntries(Object.entries(userData.stats || {}).map(([path, entry]) => [path, _normalizeSongStats(entry)]));
  progress = userData.progress || {};
  lastSession = userData.lastSession || null;
  actualDuration = userData.actualDuration || {};

  if (userData.settings) {
    // Keep settings used by the newer renderer when saving from the original UI.
    appSettings = { ...appSettings, ...userData.settings, interfaceMode: 'classic' };
    appSettings.showFloatListBtn = userData.settings.showFloatListBtn !== false;
    appSettings.glassOpacity = typeof userData.settings.glassOpacity === 'number'
      ? userData.settings.glassOpacity : 0.72;
    appSettings.discCover = userData.settings.discCover !== false;
    appSettings.colorIntensity = typeof userData.settings.colorIntensity === 'number'
      ? userData.settings.colorIntensity : 0.85;
    appSettings.lyricDone = typeof userData.settings.lyricDone === 'number'
      ? userData.settings.lyricDone : 0.90;
    appSettings.lyricWait = typeof userData.settings.lyricWait === 'number'
      ? userData.settings.lyricWait : 0.55;
    appSettings.lyricSize = typeof userData.settings.lyricSize === 'number'
      ? userData.settings.lyricSize : 15;
    // 持久化恢复新增设置项
    appSettings.themeFollowCover = userData.settings.themeFollowCover === true;
    appSettings.progressColorEnabled = userData.settings.progressColorEnabled === true;
    appSettings.progressColor = typeof userData.settings.progressColor === 'string'
      ? userData.settings.progressColor : '#fb7299';
    appSettings.progressColor2 = typeof userData.settings.progressColor2 === 'string'
      ? userData.settings.progressColor2 : '#ff5e8a';
    appSettings.simulateLrcProgress = userData.settings.simulateLrcProgress === true;
    appSettings.artistGroupMode = userData.settings.artistGroupMode === 'split' ? 'split' : 'bucket';
    appSettings.serverEnabled = userData.settings.serverEnabled === true;
    appSettings.serverPort = typeof userData.settings.serverPort === 'number'
      ? userData.settings.serverPort : 30967;
    appSettings.serverBindIP = typeof userData.settings.serverBindIP === 'string'
      ? userData.settings.serverBindIP : '0.0.0.0';
    appSettings.serverWhitelist = Array.isArray(userData.settings.serverWhitelist)
      ? userData.settings.serverWhitelist : [];
    appSettings.serverRateLimit = typeof userData.settings.serverRateLimit === 'number'
      ? userData.settings.serverRateLimit : 0;
    appSettings.serverAccessLog = userData.settings.serverAccessLog === true;
    appSettings.mobileEnabled = userData.settings.mobileEnabled === true;
    appSettings.coverUnify = userData.settings.coverUnify !== false;
    appSettings.desktopLyricPersist = userData.settings.desktopLyricPersist === true;
    if (Array.isArray(userData.settings.desktopLyricBounds) && userData.settings.desktopLyricBounds.length === 2) {
      appSettings.desktopLyricBounds = userData.settings.desktopLyricBounds;
    }
    // 恢复穿透锁定状态 (在 toggleDesktopLyric 之前恢复, 使启动时自动应用锁定)
    appSettings.desktopLyricLocked = userData.settings.desktopLyricLocked === true;
    desktopLyricLocked = appSettings.desktopLyricLocked;
    // 跑马灯设置
    appSettings.marqueeEnabled = userData.settings.marqueeEnabled !== false;
    appSettings.marqueeSpeed = typeof userData.settings.marqueeSpeed === 'number'
      ? userData.settings.marqueeSpeed : 60;
    appSettings.marqueeThreshold = typeof userData.settings.marqueeThreshold === 'number'
      ? userData.settings.marqueeThreshold : 1.0;
    appSettings.marqueePause = typeof userData.settings.marqueePause === 'number'
      ? userData.settings.marqueePause : 1.5;
    // 对外地址设置 (导出分享链接时使用)
    appSettings.publicHostMode = userData.settings.publicHostMode === 'manual' ? 'manual' : 'auto';
    appSettings.publicHost = typeof userData.settings.publicHost === 'string'
      ? userData.settings.publicHost : '';
    appSettings.publicPort = typeof userData.settings.publicPort === 'number'
      && userData.settings.publicPort > 0 ? userData.settings.publicPort : 0;
    // 音效设置 (audio-fx.js 管理, 加载时整体替换并做结构兜底)
    // v2 结构: eq/eqFreqs/eqQs/params/customs (缺省字段由 _getFxSettings 补默认)
    if (userData.settings.audioFx && typeof userData.settings.audioFx === 'object') {
      const saved = userData.settings.audioFx;
      appSettings.audioFx = {
        preset: typeof saved.preset === 'string' ? saved.preset : 'off',
        eq: Array.isArray(saved.eq) && saved.eq.length === 10 ? saved.eq.map(Number) : [0,0,0,0,0,0,0,0,0,0],
        eqFreqs: Array.isArray(saved.eqFreqs) && saved.eqFreqs.length === 10 ? saved.eqFreqs.map(Number) : undefined,
        eqQs: Array.isArray(saved.eqQs) && saved.eqQs.length === 10 ? saved.eqQs.map(Number) : undefined,
        params: saved.params && typeof saved.params === 'object' ? { ...saved.params } : undefined,
        customs: Array.isArray(saved.customs)
          ? saved.customs.filter(c => c && Array.isArray(c.eq))
          : [],
      };
    }
    if (typeof userData.settings.playMode === 'number') {
      playMode = userData.settings.playMode;
      appSettings.playMode = playMode;
      btnMode.innerHTML = MODE_ICONS[playMode];
      btnMode.title = MODE_NAMES[playMode];
    }
  }
  _userDataReady = true;
  applySettings();
  const interfaceParams = new URLSearchParams(location.search);
  const pauseAfterInterfaceSwitch = interfaceParams.get('interfacePaused') === '1';

  // 初始化歌单分享模块 (绑定 modal 事件, 供主页分享按钮直接调用)
  // 必须在 songs + collections 加载完成后调用, 因为 buildExportSources 依赖它们
  if (typeof initPlaylistShare === 'function') {
    initPlaylistShare();
  }

  showListView();
  renderList();

  // 启动洗牌: home 和 liked 各自独立的 shuffle 队列
  buildShuffleQueue('home');
  buildShuffleQueue('liked');

  // 桌面歌词持久化: 启动时自动打开桌面歌词 (用户在设置中开启了持久化)
  // 必须在 lastSession play() 之前执行, 避免被后续 return 跳过
  // 桌面歌词窗口创建后, 后续 play() 会通过 RAF 同步歌词数据
  if ((appSettings.desktopLyricPersist || interfaceParams.get('desktopLyrics') === '1') && typeof toggleDesktopLyric === 'function' && !desktopLyricOn) {
    try {
      await toggleDesktopLyric();
    } catch (e) {
      console.error('[init] 桌面歌词自动开启失败:', e.message);
    }
  }

  if (lastSession && lastSession.audioPath) {
    const lastIdx = songs.findIndex(s => s.audioPath === lastSession.audioPath);
    if (lastIdx >= 0) {
      // playContext: 上次那首歌若在 likedSet, 视为 liked 上下文继续; 否则 home
      const ctx = likedSet.has(lastSession.audioPath) ? 'liked' : 'home';
      // updateContext=false: 不让 play() 用 currentView 覆盖刚设好的 playContext
      playContext = ctx;
      await play(lastIdx, true, false, interfaceParams.get('interfaceSwitch') !== '1');
      if (pauseAfterInterfaceSwitch) audio.pause();
      // 恢复刷新前所在的视图(F12/Ctrl+R 后不再强制回到播放器)
      const savedView = (() => { try { const view = localStorage.getItem('sqet-current-view'); return view === 'player' ? 'home' : view; } catch (e) { return null; } })();
      if (savedView && savedView !== 'home' && savedView !== 'liked') {
        // 非列表类视图: 恢复到该视图, 后台仍正常播放
        currentView = savedView;
        navItems.forEach(n => n.classList.toggle('active', n.dataset.view === savedView));
        if (savedView === 'list') { listTitle.textContent = '音乐列表'; showListView(); renderList(); }
        else if (savedView === 'stats') showStatsView();
        else if (savedView === 'settings') showSettingsView();
        else if (savedView === 'repair') showRepairView();
        else if (savedView === 'free-music') showFreeMusicView();
        else if (savedView === 'import' || savedView === 'kugou' || savedView === 'qishui') showImportView();
        else if (savedView === 'playlist') showPlaylistShareView();
        else if (savedView === 'management') { if (typeof showManagementView === 'function') showManagementView(); else showPlayerView(); }
        else showPlayerView();
      } else if (savedView === 'liked') {
        currentView = 'liked';
        activeCollectionId = null;
        navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'liked'));
        listTitle.textContent = '我的歌单';
        showListView();
        renderList();
      } else {
        showPlayerView();
      }
      return;
    }
  }
  if (songs.length > 0) {
    playContext = 'home';
    // updateContext=false: 启动时已手动设置 playContext
    await play(0, true, false);
    if (pauseAfterInterfaceSwitch) audio.pause();
    // 恢复刷新前所在的视图(无上次播放记录时也恢复)
    const savedView2 = (() => { try { const view = localStorage.getItem('sqet-current-view'); return view === 'player' ? 'home' : view; } catch (e) { return null; } })();
    if (savedView2 && savedView2 !== 'home') {
      currentView = savedView2;
      navItems.forEach(n => n.classList.toggle('active', n.dataset.view === savedView2));
      if (savedView2 === 'list') { listTitle.textContent = '音乐列表'; showListView(); renderList(); }
      else if (savedView2 === 'liked') { activeCollectionId = null; listTitle.textContent = '我的歌单'; showListView(); renderList(); }
      else if (savedView2 === 'stats') showStatsView();
      else if (savedView2 === 'settings') showSettingsView();
      else if (savedView2 === 'repair') showRepairView();
      else if (savedView2 === 'free-music') showFreeMusicView();
      else if (savedView2 === 'import' || savedView2 === 'kugou' || savedView2 === 'qishui') showImportView();
      else if (savedView2 === 'playlist') showPlaylistShareView();
      else if (savedView2 === 'management') { if (typeof showManagementView === 'function') showManagementView(); else showPlayerView(); }
      else showPlayerView();
    } else {
      showPlayerView();
    }
  }
})();
