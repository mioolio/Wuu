// =========== 用户数据: 喜欢列表 / 播放统计 / 进度 / 时长 ===========

function _applyDurUpdate(idx, duration) {
  if (idx < 0 || idx >= songs.length) return;
  const s = songs[idx];
  const _old = s.realDuration;
  s.realDuration = duration;
  // 调试: 后台解析推送的时长覆盖了原有值
  console.log('[DBG:onDurationUpdate]', {
    idx,
    song: `${s.songName} - ${s.artist}`,
    oldRealDuration: _old,
    newDuration: duration,
    isCurrent: idx === curIdx,
  });
  if (idx === curIdx) {
    const dur = getDuration();
    tEnd.textContent = fmt(dur);
    if (!dragging && dur > 0) {
      pFill.style.width = `${(audio.currentTime / dur) * 100}%`;
    }
  }
}
window.musicAPI.onDurationUpdate(({ idx, duration }) => {
  if (songs.length === 0) { _pendingDurUpdates.push({ idx, duration }); return; }
  _applyDurUpdate(idx, duration);
});

function isLiked(s) { return s && likedSet.has(s.audioPath); }
function isDisliked(s) { return s && dislikedSet.has(s.audioPath); }

// 切换不推荐状态 (倒点赞按钮)
// 与 liked 互斥: 标记不喜欢时从所有歌单移除 + 清 likedSet; 取消不喜欢时仅删 dislikedSet
function toggleDislike(s) {
  if (!s || !s.audioPath) return;
  if (dislikedSet.has(s.audioPath)) {
    dislikedSet.delete(s.audioPath);
  } else {
    dislikedSet.set(s.audioPath, Date.now());
    // 互斥: 从所有歌单移除
    collections.forEach(c => c.songs.delete(s.audioPath));
    likedSet.delete(s.audioPath);
  }
  saveUserData();
}

function getStats(s) {
  if (!s) return { plays: 0, duration: 0 };
  return stats[s.audioPath] || { plays: 0, duration: 0 };
}

// =========== 多歌单(collections)管理 ===========
// 生成歌单 ID: 优先 crypto.randomUUID, 回退到 时间戳+随机数
function _genCollectionId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// 重建 likedSet (所有歌单歌曲的并集), 用于 isLiked() 快速判断
// 保留已存在的 timestamp, 仅对新加入的 path 用歌单 createdAt 兜底
function rebuildLikedSet() {
  const allPaths = new Set();
  collections.forEach(c => c.songs.forEach(p => allPaths.add(p)));
  // 移除已不在任何歌单中的 path
  for (const path of likedSet.keys()) {
    if (!allPaths.has(path)) likedSet.delete(path);
  }
  // 补齐歌单中有但 likedSet 没有的 path (用歌单 createdAt 作为点赞时间兜底)
  const now = Date.now();
  collections.forEach(c => {
    const ts = c.createdAt || now;
    c.songs.forEach(path => {
      if (!likedSet.has(path)) likedSet.set(path, ts);
    });
  });
}

// 获取当前激活歌单, 没有则返回第一个, 都没有则返回 null
function _getActiveCollection() {
  if (activeCollectionId) {
    const c = collections.find(c => c.id === activeCollectionId);
    if (c) return c;
  }
  return collections[0] || null;
}

// 判断 path 是否在指定歌单中
function isInCollection(collId, audioPath) {
  const c = collections.find(c => c.id === collId);
  return !!(c && c.songs.has(audioPath));
}

// 创建新歌单, 返回 id
function createCollection(name) {
  name = (name || '').trim() || '新建歌单';
  const coll = {
    id: _genCollectionId(),
    name: name,
    songs: new Set(),
    createdAt: Date.now(),
  };
  collections.push(coll);
  rebuildLikedSet();
  saveUserData();
  return coll.id;
}

// 删除歌单
function deleteCollection(id) {
  const idx = collections.findIndex(c => c.id === id);
  if (idx < 0) return;
  collections.splice(idx, 1);
  if (activeCollectionId === id) activeCollectionId = null;
  rebuildLikedSet();
  saveUserData();
}

// 重命名歌单
function renameCollection(id, name) {
  const c = collections.find(c => c.id === id);
  if (!c) return;
  c.name = (name || '').trim() || c.name;
  saveUserData();
}

// 添加歌曲到指定歌单
function addToCollection(collId, audioPath) {
  const c = collections.find(c => c.id === collId);
  if (!c) return;
  c.songs.add(audioPath);
  // 同步更新 likedSet (保留已存在 timestamp, 否则用当前时间)
  if (!likedSet.has(audioPath)) likedSet.set(audioPath, Date.now());
  saveUserData();
}

// 从指定歌单移除歌曲
function removeFromCollection(collId, audioPath) {
  const c = collections.find(c => c.id === collId);
  if (!c) return;
  c.songs.delete(audioPath);
  // 仅当不在任何歌单时才从 likedSet 移除
  if (!collections.some(cc => cc.songs.has(audioPath))) likedSet.delete(audioPath);
  saveUserData();
}

// 返回指定歌单中的歌曲数组 (按 songs 顺序, 调用方通常再用 likedSet 排序)
function getCollectionSongs(collId) {
  const c = collections.find(c => c.id === collId);
  if (!c) return [];
  return songs.filter(s => c.songs.has(s.audioPath));
}

// 返回所有歌单数组
function getAllCollections() {
  return collections;
}

// 获取或创建"我喜欢的音乐"歌单(红心按钮的默认目标歌单)
// 红心始终进这个歌单, 不受当前激活歌单影响
function getOrCreateFavoritesCollection() {
  let coll = collections.find(c => c.name === '我喜欢的音乐');
  if (!coll) {
    const id = createCollection('我喜欢的音乐');
    coll = collections.find(c => c.id === id);
  }
  return coll;
}

// toggleLike: 兼容旧调用方, 行为退化为"切换'我喜欢的音乐'歌单成员"
// 新代码请用 applyCollectionsToSong 做多歌单同步
function toggleLike(s) {
  if (!s) return;
  const coll = getOrCreateFavoritesCollection();
  if (!coll) return;
  if (coll.songs.has(s.audioPath)) {
    coll.songs.delete(s.audioPath);
    if (!collections.some(cc => cc.songs.has(s.audioPath))) likedSet.delete(s.audioPath);
  } else {
    coll.songs.add(s.audioPath);
    if (!likedSet.has(s.audioPath)) likedSet.set(s.audioPath, Date.now());
    // 互斥: 收藏后清除不推荐标记
    if (dislikedSet.has(s.audioPath)) dislikedSet.delete(s.audioPath);
  }
  saveUserData();
}

// 批量同步歌曲到选中歌单 (红心按钮点击 → 弹歌单选择器后的实际操作)
//   targetCollIds: 用户最终勾选的歌单 id 数组
//   行为: 对每个歌单, 加入(原本不在)/移除(原本在但用户取消勾选)
//   并重建 likedSet, 返回 { added: string[], removed: string[] } 记录变更
function applyCollectionsToSong(song, targetCollIds) {
  if (!song || !song.audioPath) return { added: [], removed: [] };
  const target = new Set(targetCollIds);
  const added = [], removed = [];
  collections.forEach(c => {
    const wasIn = c.songs.has(song.audioPath);
    const shouldBeIn = target.has(c.id);
    if (wasIn && !shouldBeIn) {
      c.songs.delete(song.audioPath);
      removed.push(c.name);
    } else if (!wasIn && shouldBeIn) {
      c.songs.add(song.audioPath);
      added.push(c.name);
    }
  });
  // 重建 likedSet (任一歌单含此 path 即视为已收藏)
  const inAny = collections.some(c => c.songs.has(song.audioPath));
  if (inAny) {
    if (!likedSet.has(song.audioPath)) likedSet.set(song.audioPath, Date.now());
    // 互斥: 收藏后清除不推荐标记
    if (dislikedSet.has(song.audioPath)) dislikedSet.delete(song.audioPath);
  } else {
    likedSet.delete(song.audioPath);
  }
  saveUserData();
  return { added, removed };
}

// 序列化 collections 为可保存格式 (Set → Array)
function _serializeCollections() {
  return collections.map(c => ({
    id: c.id,
    name: c.name,
    songs: [...c.songs],
    createdAt: c.createdAt,
  }));
}

function saveUserData() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.musicAPI.saveUserData({
      likes: [...likedSet.entries()].map(([path, ts]) => ({ path, ts })),
      dislikes: [...dislikedSet.entries()].map(([path, ts]) => ({ path, ts })),
      collections: _serializeCollections(),
      stats: stats,
      progress: progress,
      lastSession: lastSession,
      actualDuration: actualDuration,
      settings: appSettings,
    });
    saveTimer = null;
  }, 1200);
}

function saveUserDataImmediate() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  window.musicAPI.saveUserData({
    likes: [...likedSet.entries()].map(([path, ts]) => ({ path, ts })),
    dislikes: [...dislikedSet.entries()].map(([path, ts]) => ({ path, ts })),
    collections: _serializeCollections(),
    stats: stats,
    progress: progress,
    lastSession: lastSession,
    actualDuration: actualDuration,
    settings: appSettings,
  });
}

function getDuration() {
  // 试听模式: 直接用 audio.duration (流式播放无本地缓存时长)
  if (fmPreviewMode) {
    return (audio.duration && isFinite(audio.duration) && audio.duration > 0) ? audio.duration : 0;
  }
  const s = songs[curIdx];
  if (!s) return 0;
  const ad = (audio.duration && isFinite(audio.duration) && audio.duration > 0) ? audio.duration : 0;
  // 优先用 AAC/MP3/FLAC 帧解析的真实时长
  if (s.realDuration && s.realDuration > 0 && isFinite(s.realDuration)) {
    // 修复: 当 audio.duration 明显大于 realDuration 时(差>30秒),
    // 说明 realDuration 解析错误(如 FLAC 被误当 AAC/MP3 解析),
    // 应信任 Chromium 实际解码的 audio.duration
    if (ad > 0 && ad - s.realDuration > 30) {
      console.warn('[DBG:getDuration] realDuration 可疑, 改用 audio.duration', {
        song: `${s.songName} - ${s.artist}`,
        realDuration: s.realDuration,
        audioDuration: ad,
      });
      return ad;
    }
    return s.realDuration;
  }
  // 兜底: 浏览器解码的 audio.duration (loadedmetadata 后可用)
  return ad;
}

function saveCurrentProgress() {
  // 试听模式: 不保存进度到本地
  if (fmPreviewMode) return;
  const s = songs[curIdx];
  if (!s) return;
  const dur = getDuration();
  if (!dur || !isFinite(dur)) return;
  const t = audio.currentTime;
  progress[s.audioPath] = (dur - t < 3) ? 0 : t;
  lastSession = { audioPath: s.audioPath, t: progress[s.audioPath] };
  saveUserDataImmediate();
}

function incrPlay(s) {
  if (!s) return;
  const k = s.audioPath;
  if (!stats[k]) stats[k] = { plays: 0, duration: 0 };
  stats[k].plays += 1;
  saveUserData();
}

function addDuration(s, sec) {
  if (!s || sec <= 0) return;
  const k = s.audioPath;
  if (!stats[k]) stats[k] = { plays: 0, duration: 0 };
  stats[k].duration += sec;
  saveUserData();
}

function updLikeBtn() {
  // 试听模式: 未添加到歌库时显示"+"添加按钮, 已添加则显示红心收藏按钮
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    const localSong = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
    if (localSong) {
      // 已添加到歌库: 显示红心收藏按钮 (根据收藏状态切换)
      btnLike.classList.remove('fm-add-btn');
      const liked = isLiked(localSong);
      btnLike.classList.toggle('liked', liked);
      btnLike.innerHTML = liked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
      btnLike.title = liked ? '取消收藏' : '收藏';
    } else {
      // 未添加到歌库: 显示"+"添加到歌库按钮
      btnLike.classList.remove('liked');
      btnLike.classList.add('fm-add-btn');
      btnLike.innerHTML = ICON_PLUS;
      btnLike.title = '添加到歌库';
      // 试听模式且未在歌库: 重置 dislike 按钮状态
      if (typeof btnDislike !== 'undefined' && btnDislike) {
        btnDislike.classList.remove('disliked');
        btnDislike.innerHTML = ICON_THUMB_DOWN_OUTLINE;
        btnDislike.title = '不推荐';
      }
    }
    // 同步倒点赞按钮状态 (试听模式已添加到歌库时)
    if (typeof btnDislike !== 'undefined' && btnDislike && localSong) {
      btnDislike.classList.toggle('disliked', isDisliked(localSong));
      btnDislike.innerHTML = isDisliked(localSong) ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
      btnDislike.title = isDisliked(localSong) ? '取消不推荐' : '不推荐';
    }
    return;
  }
  btnLike.classList.remove('fm-add-btn');
  const s = songs[curIdx];
  btnLike.classList.toggle('liked', isLiked(s));
  btnLike.innerHTML = isLiked(s) ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
  btnLike.title = '收藏';
  // 同步倒点赞按钮状态
  if (typeof btnDislike !== 'undefined' && btnDislike) {
    btnDislike.classList.toggle('disliked', isDisliked(s));
    btnDislike.innerHTML = isDisliked(s) ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
    btnDislike.title = isDisliked(s) ? '取消不推荐' : '不推荐';
  }
}

// 更新倒点赞按钮状态 (单独刷新用)
function updDislikeBtn() {
  if (typeof btnDislike === 'undefined' || !btnDislike) return;
  let s = null;
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode && fmPreviewSong) {
    s = typeof findLocalSongByFm === 'function' ? findLocalSongByFm(fmPreviewSong) : null;
  } else {
    s = songs[curIdx];
  }
  btnDislike.classList.toggle('disliked', isDisliked(s));
  btnDislike.innerHTML = isDisliked(s) ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
  btnDislike.title = isDisliked(s) ? '取消不推荐' : '不推荐';
}
