// =========== 列表 / 悬浮列表 / 统计 / 视图切换 ===========

// 拆分多歌手名 (与 music-dl.exe 的 splitArtistTokens 逻辑保持一致)
// 支持: / ／ & ＆ 、 , ， ; ； | 以及 feat./ft./featuring/with/x 关键词分隔符
function splitArtistTokens(artist) {
  let s = (artist || '').trim();
  if (!s) return [];
  // 关键词分隔符: feat./ft./featuring/with/x (前后需有空格, 大小写不敏感)
  s = s.replace(/\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+/gi, '|');
  // 通用分隔符: 、 , ， ; ； |
  s = s.replace(/[、,，;；|]/g, '|');
  // 东亚分隔符: / ／ & ＆
  s = s.replace(/[\/／&＆]/g, '|');
  const parts = s.split('|').map(p => p.trim()).filter(p => p);
  // 去重 (大小写不敏感)
  const seen = new Set();
  const result = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

function getSongsForView() {
  if (currentView === 'liked') {
    // 没有选中歌单时, 歌单列表视图不展示歌曲 (由 renderCollectionList 单独渲染)
    if (activeCollectionId === null) return [];
    const coll = collections.find(c => c.id === activeCollectionId);
    if (!coll) return [];
    // 当前歌单的歌曲, 按点赞时间降序排序(最新点赞的在前)
    const liked = songs.filter(s => coll.songs.has(s.audioPath));
    liked.sort((a, b) => (likedSet.get(b.audioPath) || 0) - (likedSet.get(a.audioPath) || 0));
    return liked;
  }
  return songs;
}

// 统一过滤: 应用当前搜索关键词到视图歌曲列表
// 搜索 input 与分组按钮 click 都调用此函数, 保证搜索→分组 / 分组→搜索 行为一致
function getFilteredList() {
  const base = getSongsForView();
  const q = (search && search.value ? search.value : '').trim().toLowerCase();
  if (!q) return base;
  return base.filter(s =>
    (s.songName || '').toLowerCase().includes(q) ||
    (s.artist || '').toLowerCase().includes(q)
  );
}

// Fisher-Yates 洗牌: 对指定上下文的 playlist 生成随机索引队列
// context: 'home' (默认, 全部 songs) | 'liked' (按点赞时间降序的 liked 列表)
// 一轮播完后调用此函数重新洗牌
function buildShuffleQueue(context) {
  context = context || 'home';
  const playlist = _getPlaylistForContext(context);
  const queue = playlist.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (context === 'liked') {
    shuffleQueueLiked = queue;
    shufflePosLiked = -1;
  } else {
    shuffleQueue = queue;
    shufflePos = -1;
  }
}

// 根据播放上下文获取当前 playlist (songs 索引数组)
// context 可选, 默认用全局 playContext
// liked 上下文: 若有激活歌单则用该歌单歌曲, 否则用所有歌单的并集(likedSet)
// 按点赞时间降序排序; home 上下文: 全部 songs 原序
function _getPlaylistForContext(context) {
  context = context || playContext;
  if (context === 'liked') {
    const playlist = [];
    // 优先用激活歌单的歌曲, 这样在某个歌单内点歌后下一首仍在该歌单内循环
    if (activeCollectionId) {
      const coll = collections.find(c => c.id === activeCollectionId);
      if (coll) {
        for (let i = 0; i < songs.length; i++) {
          if (coll.songs.has(songs[i].audioPath)) playlist.push(i);
        }
        playlist.sort((a, b) => (likedSet.get(songs[b].audioPath) || 0) - (likedSet.get(songs[a].audioPath) || 0));
        return playlist;
      }
    }
    // 回退: 所有歌单歌曲的并集
    for (let i = 0; i < songs.length; i++) {
      if (likedSet.has(songs[i].audioPath)) playlist.push(i);
    }
    // 按点赞时间降序排序(最新点赞的在前)
    playlist.sort((a, b) => (likedSet.get(songs[b].audioPath) || 0) - (likedSet.get(songs[a].audioPath) || 0));
    return playlist;
  }
  return songs.map((_, i) => i);
}

// 根据播放上下文获取下一首/上一首在 songs 中的索引
// direction: 1 = 下一首, -1 = 上一首
// 行为:
//   - playMode===0(单曲循环): 由调用方处理, pickNextIdx 不参与
//   - playMode===1(列表循环): 基于 playContext 的 playlist 顺序循环
//   - playMode===2(随机播放): home 和 liked 各自独立的 shuffle 队列
//     · 下一首: 指针++, 越界则重新洗牌回到 0
//     · 上一首: 指针--, 越界停在 0(不循环回退)
function pickNextIdx(direction) {
  const ctx = playContext;

  // 随机模式: 走对应上下文的 shuffle 队列
  if (playMode === 2) {
    const isLiked = ctx === 'liked';
    let queue = isLiked ? shuffleQueueLiked : shuffleQueue;
    let pos = isLiked ? shufflePosLiked : shufflePos;
    if (queue.length === 0) {
      buildShuffleQueue(ctx);
      queue = isLiked ? shuffleQueueLiked : shuffleQueue;
      pos = -1;
    }
    if (queue.length === 0) return -1;
    if (direction > 0) {
      // 下一首: 指针后移, 越界则重新洗牌
      pos++;
      if (pos >= queue.length) {
        // 重新洗牌
        const fresh = queue.slice();
        for (let i = fresh.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
        }
        // 避免新队列第一首等于当前歌(若队列长度>1)
        if (fresh.length > 1 && fresh[0] === curIdx) {
          [fresh[0], fresh[1]] = [fresh[1], fresh[0]];
        }
        if (isLiked) { shuffleQueueLiked = fresh; queue = fresh; }
        else { shuffleQueue = fresh; queue = fresh; }
        pos = 0;
      }
      if (isLiked) shufflePosLiked = pos; else shufflePos = pos;
      return queue[pos];
    } else {
      // 上一首: 指针前移, 越界停在 0(不循环回退)
      if (pos < 0) {
        // 首次上一首(从未播过), 定位当前歌在队列中
        pos = queue.indexOf(curIdx);
      }
      pos = Math.max(0, pos - 1);
      if (isLiked) shufflePosLiked = pos; else shufflePos = pos;
      return queue[pos];
    }
  }

  // 顺序模式: 基于 playContext 的 playlist 循环
  const playlist = _getPlaylistForContext(ctx);
  if (playlist.length === 0) return -1;
  const curInList = playlist.indexOf(curIdx);
  if (curInList === -1) return playlist[0];
  const next = (curInList + direction + playlist.length) % playlist.length;
  return playlist[next];
}

function buildSongItem(s, idx) {
  const li = document.createElement('li');
  li.className = 'song-item';
  // 性能: 由调用方传入 idx, 避免 forEach 内调用 songs.indexOf(s) 导致 O(n²)
  // 几万首歌曲时 indexOf 会让渲染卡死数十秒
  const songIdx = (typeof idx === 'number') ? idx : songs.indexOf(s);
  li.dataset.idx = songIdx;
  if (songIdx === curIdx) li.classList.add('cur');

  let thumb;
  if (s.coverPath) {
    thumb = `<img class="si-thumb" src="${toUrl(s.coverPath)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<div class="si-ph" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
  } else {
    thumb = `<div class="si-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
  }
  const liked = isLiked(s);
  const disliked = isDisliked(s);
  const heartIcon = liked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
  const thumbDownIcon = disliked ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
  const st = getStats(s);
  li.innerHTML = `${thumb}<div class="si-info"><div class="si-name">${s.songName}</div><div class="si-artist">${s.artist}</div></div>`
    + `<div class="si-stats"><span class="si-plays">播放 ${st.plays} 次</span><span class="si-dur">${fmtDuration(st.duration)}</span></div>`
    + `<button class="si-dislike ${disliked ? 'disliked' : ''}" title="不推荐">${thumbDownIcon}</button>`
    + `<button class="si-like ${liked ? 'liked' : ''}" title="收藏">${heartIcon}</button>`;
  li.addEventListener('click', (e) => {
    if (e.target.closest('.si-like')) return;
    if (e.target.closest('.si-dislike')) return;
    play(songIdx);
  });
  const likeBtn = li.querySelector('.si-like');
  likeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 复用主播放器红心逻辑: 弹出歌单选择器, 让用户选择目标歌单
    if (typeof pickCollectionsForSong === 'function') {
      await pickCollectionsForSong(s);
    } else {
      // 兜底: pickCollectionsForSong 未定义时退回旧行为
      toggleLike(s);
      const nowLiked = isLiked(s);
      likeBtn.classList.toggle('liked', nowLiked);
      likeBtn.innerHTML = nowLiked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
      if (currentView === 'liked' && activeCollectionId && !isInCollection(activeCollectionId, s.audioPath)) {
        li.style.transition = 'opacity 0.2s, transform 0.2s';
        li.style.opacity = '0';
        li.style.transform = 'translateX(20px)';
        setTimeout(() => renderList(), 200);
      }
      updLikeBtn();
    }
    // 刷新本行 dislike 按钮状态 (互斥后可能变化)
    const dislikeBtn2 = li.querySelector('.si-dislike');
    if (dislikeBtn2) {
      const nowDis = isDisliked(s);
      dislikeBtn2.classList.toggle('disliked', nowDis);
      dislikeBtn2.innerHTML = nowDis ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
    }
  });
  const dislikeBtn = li.querySelector('.si-dislike');
  if (dislikeBtn) {
    dislikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDislike(s);
      // 刷新本行 dislike + like 按钮状态 (互斥)
      const nowDis = isDisliked(s);
      dislikeBtn.classList.toggle('disliked', nowDis);
      dislikeBtn.innerHTML = nowDis ? ICON_THUMB_DOWN_FILLED : ICON_THUMB_DOWN_OUTLINE;
      const likeBtn2 = li.querySelector('.si-like');
      if (likeBtn2) {
        const nowLiked = isLiked(s);
        likeBtn2.classList.toggle('liked', nowLiked);
        likeBtn2.innerHTML = nowLiked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
      }
      updLikeBtn();
      updDislikeBtn();
    });
  }
  return li;
}

// 分页渲染: 几万/几十万首歌曲一次性挂载会卡死, 分批加载避免主线程长时间阻塞
const LIST_PAGE_SIZE = 100;
let _listRenderToken = 0;   // 渲染令牌, 新一次 renderList 会使旧令牌失效, 中止未完成的分页挂载
let _listSentinel = null;   // 滚动哨兵元素, 触发加载下一页

// 渲染歌单列表视图 (currentView==='liked' 且 activeCollectionId===null 时调用)
// 展示所有歌单卡片, 支持新建/重命名/删除歌单
function renderCollectionList() {
  _listRenderToken++;
  if (_listSentinel) {
    if (_listSentinel._io) { _listSentinel._io.disconnect(); _listSentinel._io = null; }
    _listSentinel.remove(); _listSentinel = null;
  }
  listEl.innerHTML = '';
  listEmpty.classList.add('hidden');
  // 同步标题
  listTitle.textContent = '我的歌单';

  // 新建歌单按钮
  const createLi = document.createElement('li');
  createLi.className = 'coll-create';
  createLi.style.cssText = 'display:flex;align-items:center;gap:14px;padding:14px 16px;margin:6px 0;border-radius:var(--r-sm);cursor:pointer;border:1px dashed var(--border);color:var(--fg2);transition:background 0.12s,border-color 0.12s';
  createLi.innerHTML = '<div style="width:52px;height:52px;border-radius:10px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:22px;height:22px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>'
    + '<div style="font-size:14px;font-weight:600">新建歌单</div>';
  createLi.addEventListener('mouseenter', () => { createLi.style.background = 'var(--hover)'; createLi.style.borderColor = 'var(--accent)'; });
  createLi.addEventListener('mouseleave', () => { createLi.style.background = ''; createLi.style.borderColor = 'var(--border)'; });
  createLi.addEventListener('click', async () => {
    const name = await showPromptModal({
      title: '新建歌单',
      sub: '请输入歌单名称(可留空, 默认"新建歌单")',
      defaultValue: '新建歌单',
      allowEmpty: true,
      confirmText: '创建',
    });
    if (name === null) return;  // 用户取消
    // 允许空名: createCollection 内部会兜底为"新建歌单"
    const trimmed = name.trim();
    // 重名时自动加序号(2/3/4...), 避免用户搞混
    let finalName = trimmed || '新建歌单';
    if (collections.some(c => c.name === finalName)) {
      let n = 2;
      while (collections.some(c => c.name === `${finalName} ${n}`)) n++;
      finalName = `${finalName} ${n}`;
    }
    const id = createCollection(finalName);
    if (typeof showToast === 'function') showToast(`已创建歌单: ${finalName}`, 'success');
    // 创建后直接进入新歌单
    activeCollectionId = id;
    listTitle.textContent = finalName;
    renderList();
  });
  listEl.appendChild(createLi);

  if (collections.length === 0) {
    const tip = document.createElement('li');
    tip.style.cssText = 'text-align:center;color:var(--fg3);padding:40px 0;font-size:13px;list-style:none';
    tip.textContent = '还没有歌单, 点击上方"新建歌单"创建第一个吧';
    listEl.appendChild(tip);
    return;
  }

  // 按 createdAt 降序 (最新创建的在前)
  const sorted = collections.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  sorted.forEach(coll => {
    const li = document.createElement('li');
    li.className = 'coll-card';
    li.dataset.id = coll.id;
    li.style.cssText = 'display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:var(--r-sm);cursor:pointer;transition:background 0.12s';
    li.addEventListener('mouseenter', () => { li.style.background = 'var(--hover)'; });
    li.addEventListener('mouseleave', () => { li.style.background = ''; });

    // 封面占位 (用歌单首字母)
    const initial = (coll.name || '?').trim().charAt(0) || '?';
    const cover = document.createElement('div');
    cover.style.cssText = 'width:52px;height:52px;border-radius:10px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px;font-weight:700;color:var(--accent)';
    cover.textContent = initial;

    // 歌单信息
    const info = document.createElement('div');
    info.style.cssText = 'min-width:0;flex:1';
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    nameDiv.textContent = coll.name;
    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'font-size:11px;color:var(--fg3);margin-top:3px';
    const cnt = coll.songs.size;
    let dateStr = '';
    try { dateStr = new Date(coll.createdAt || Date.now()).toLocaleDateString('zh-CN'); } catch (e) { dateStr = ''; }
    metaDiv.textContent = `${cnt} 首${dateStr ? ' · ' + dateStr + ' 创建' : ''}`;
    info.appendChild(nameDiv);
    info.appendChild(metaDiv);

    // 操作按钮: 重命名 / 删除
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0';

    const renameBtn = document.createElement('button');
    renameBtn.title = '重命名';
    renameBtn.style.cssText = 'width:32px;height:32px;background:none;border:none;color:var(--fg3);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:color var(--t),background var(--t)';
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    renameBtn.addEventListener('mouseenter', () => { renameBtn.style.color = 'var(--accent)'; renameBtn.style.background = 'var(--active)'; });
    renameBtn.addEventListener('mouseleave', () => { renameBtn.style.color = 'var(--fg3)'; renameBtn.style.background = ''; });
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = await showPromptModal({
        title: '重命名歌单',
        sub: `修改 "${coll.name}" 的名称`,
        defaultValue: coll.name,
        confirmText: '保存',
      });
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === coll.name) return;
      renameCollection(coll.id, trimmed);
      renderCollectionList();
    });

    const delBtn = document.createElement('button');
    delBtn.title = '删除歌单';
    delBtn.style.cssText = 'width:32px;height:32px;background:none;border:none;color:var(--fg3);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:color var(--t),background var(--t)';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    delBtn.addEventListener('mouseenter', () => { delBtn.style.color = 'var(--accent)'; delBtn.style.background = 'var(--active)'; });
    delBtn.addEventListener('mouseleave', () => { delBtn.style.color = 'var(--fg3)'; delBtn.style.background = ''; });
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sub = document.createElement('div');
      sub.innerHTML = `歌单: <strong>${coll.name}</strong><br>${coll.songs.size} 首歌曲将从该歌单移除 (不会删除本地文件)`;
      const ok = await showConfirmModal({
        title: '删除歌单',
        sub,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      deleteCollection(coll.id);
      renderCollectionList();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    li.appendChild(cover);
    li.appendChild(info);
    li.appendChild(actions);

    // 点击卡片进入歌单歌曲视图
    li.addEventListener('click', () => {
      activeCollectionId = coll.id;
      listTitle.textContent = coll.name;
      // 进入歌单时重新洗牌 liked 上下文队列, 使其包含该歌单的歌曲
      buildShuffleQueue('liked');
      renderList();
    });

    listEl.appendChild(li);
  });
}

function renderList(filtered) {
  // 歌单列表视图: 当处于 liked 视图且未选中具体歌单时, 展示歌单卡片
  if (currentView === 'liked' && activeCollectionId === null) {
    renderCollectionList();
    return;
  }
  // 默认应用搜索过滤, 保证搜索→分组 / 分组→搜索 行为一致
  const list = filtered || getFilteredList();
  // 使未完成的分页挂载失效
  _listRenderToken++;
  const myToken = _listRenderToken;
  // 移除旧哨兵
  if (_listSentinel) {
    if (_listSentinel._io) { _listSentinel._io.disconnect(); _listSentinel._io = null; }
    _listSentinel.remove(); _listSentinel = null;
  }
  listEl.innerHTML = '';
  // 性能: 预建 song→index 映射, 替代循环内 songs.indexOf(s) 的 O(n²) 调用
  // 几万首歌曲时 indexOf 会让渲染卡死数秒
  const idxMap = new Map();
  for (let i = 0; i < songs.length; i++) idxMap.set(songs[i], i);
  if (!list.length) {
    listEmpty.classList.remove('hidden');
    return;
  }
  listEmpty.classList.add('hidden');

  if (groupByArtist) {
      // 按歌手分组: 歌手名排序, 每组内按原排序
      // artistGroupMode: 'bucket' (桶包含, 原样分组) | 'split' (拆分多歌手)
      const groups = {};
      const mode = appSettings.artistGroupMode || 'bucket';
      list.forEach(s => {
        const rawArtist = (s.artist || '未知艺人').trim();
        if (mode === 'split') {
          // 拆分模式: 按 / ／ & ＆ 、 , ， ; ； | feat./ft./with/x 拆分歌手名, 歌曲同时归入各分组
          const parts = splitArtistTokens(rawArtist);
          const keys = parts.length ? parts : [rawArtist];
          keys.forEach(key => {
            if (!groups[key]) groups[key] = [];
            groups[key].push(s);
          });
        } else {
          // 桶包含模式: 原样分组 (K8 / K9 作为一个整体分组)
          if (!groups[rawArtist]) groups[rawArtist] = [];
          groups[rawArtist].push(s);
        }
      });
      const sortedArtists = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh'));
      // 分组模式: 每个展开组创建 body 容器, 歌曲挂到对应 body 保持分组顺序
      // 索引由 idxMap 预算(O(1)), 避免 O(n²)
      sortedArtists.forEach(artistName => {
        const isCollapsed = collapsedArtists.has(artistName);
        const header = document.createElement('div');
        header.className = 'artist-group-header' + (isCollapsed ? ' collapsed' : '');
        header.innerHTML = `<svg class="agh-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg><span class="agh-name">${artistName}</span><span class="agh-count">${groups[artistName].length} 首</span>`;
        header.addEventListener('click', () => {
          if (collapsedArtists.has(artistName)) {
            collapsedArtists.delete(artistName);
          } else {
            collapsedArtists.add(artistName);
          }
          renderList();
        });
        listEl.appendChild(header);
        if (!isCollapsed) {
          // 展开组: 歌曲挂到 body 容器, 保持分组头与歌曲的视觉顺序
          const groupBody = document.createElement('div');
          groupBody.className = 'artist-group-body';
          listEl.appendChild(groupBody);
          const frag = document.createDocumentFragment();
          groups[artistName].forEach(s => {
            frag.appendChild(buildSongItem(s, idxMap.get(s)));
          });
          groupBody.appendChild(frag);
        }
      });
  } else {
    // 非分组模式: 直接对 list 分页
    const items = list.map(s => ({ s, idx: idxMap.get(s) }));
    _appendPaged(items, myToken);
  }
}

// 分批挂载: 每批 LIST_PAGE_SIZE 项, 用 requestAnimationFrame 让出主线程
// items: [{s, idx}]; myToken: 渲染令牌, 失效则中止
function _appendPaged(items, myToken) {
  let i = 0;
  const total = items.length;
  // 首批直接挂载, 避免空列表闪烁
  const firstBatch = Math.min(LIST_PAGE_SIZE, total);
  for (let k = 0; k < firstBatch; k++) {
    const it = items[k];
    listEl.appendChild(buildSongItem(it.s, it.idx));
  }
  i = firstBatch;
  if (i >= total) return;

  // 哨兵元素: 滚动到可视区时加载下一批
  _listSentinel = document.createElement('div');
  _listSentinel.className = 'list-sentinel';
  _listSentinel.textContent = `滚动加载更多 (${i}/${total})`;
  listEl.appendChild(_listSentinel);

  const loadNext = () => {
    if (myToken !== _listRenderToken) return;  // 已被新渲染取代
    if (i >= total) {
      if (_listSentinel) { _listSentinel.remove(); _listSentinel = null; }
      return;
    }
    // 移除哨兵后挂载下一批, 再重新插入哨兵
    if (_listSentinel) _listSentinel.remove();
    const end = Math.min(i + LIST_PAGE_SIZE, total);
    const frag = document.createDocumentFragment();
    for (let k = i; k < end; k++) {
      const it = items[k];
      frag.appendChild(buildSongItem(it.s, it.idx));
    }
    listEl.appendChild(frag);
    i = end;
    if (i < total) {
      _listSentinel.textContent = `滚动加载更多 (${i}/${total})`;
      listEl.appendChild(_listSentinel);
    } else {
      _listSentinel = null;
    }
  };
  // IntersectionObserver 监听哨兵进入视口
  // 滚动容器是 .list-body (overflow-y:auto), 不是 #list 本身
  if ('IntersectionObserver' in window) {
    const scrollRoot = listEl.closest('.list-body') || listEl.parentElement || null;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadNext();
    }, { root: scrollRoot, rootMargin: '200px' });
    io.observe(_listSentinel);
    _listSentinel._io = io;
  }
}

// 排行榜分页: 每批 50 项, 滚动到底部自动加载下一批
const RANK_PAGE_SIZE = 50;
let _rankRenderToken = 0;
let _rankSentinel = null;
let _rankOffset = 0;
let _rankTotal = 0;

function renderStats() {
  let totalDur = 0, totalPlays = 0;
  for (const k in stats) {
    if (stats[k] && typeof stats[k] === 'object') {
      totalDur += stats[k].duration || 0;
      totalPlays += stats[k].plays || 0;
    }
  }
  $('stat-total-duration').textContent = fmtDurationCompact(totalDur);
  $('stat-total-duration-sub').textContent = `共 ${Math.floor(totalDur)} 秒`;
  $('stat-total-plays').textContent = totalPlays;
  $('stat-liked-count').textContent = likedSet.size;
  $('stat-song-count').textContent = songs.length;

  // 收集所有有播放记录的歌曲, 按当前排序方式排序(不再 slice 截断)
  const ranked = songs
    .map(s => ({ s, st: getStats(s) }))
    .filter(x => x.st.plays > 0 || x.st.duration > 0)
    .sort((a, b) => rankingSort === 'plays'
      ? b.st.plays - a.st.plays || b.st.duration - a.st.duration
      : b.st.duration - a.st.duration || b.st.plays - a.st.plays);

  // 清空旧内容与哨兵
  rankingList.innerHTML = '';
  _rankRenderToken++;
  const myToken = _rankRenderToken;
  if (_rankSentinel) {
    if (_rankSentinel._io) { _rankSentinel._io.disconnect(); _rankSentinel._io = null; }
    _rankSentinel = null;
  }
  _rankOffset = 0;
  _rankTotal = ranked.length;

  if (!ranked.length) {
    rankingEmpty.classList.remove('hidden');
    return;
  }
  rankingEmpty.classList.add('hidden');

  // 排名第一的值用于计算进度条百分比
  const maxVal = rankingSort === 'plays'
    ? ranked[0].st.plays
    : ranked[0].st.duration;

  // 性能: 预建 song→index 映射, 避免 O(n²) 的 songs.indexOf(s)
  const idxMap = new Map();
  for (let i = 0; i < songs.length; i++) idxMap.set(songs[i], i);

  // 构建单个排行榜条目
  const buildRankItem = (x, i) => {
    const s = x.s;
    const st = x.st;
    const idx = idxMap.get(s);
    const val = rankingSort === 'plays' ? st.plays : st.duration;
    const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
    const valText = rankingSort === 'plays'
      ? `${st.plays} 次`
      : fmtDuration(st.duration);
    const subText = rankingSort === 'plays'
      ? fmtDuration(st.duration)
      : `${st.plays} 次`;

    let thumb;
    if (s.coverPath) {
      thumb = `<img class="rank-thumb" src="${toUrl(s.coverPath)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<div class="rank-ph" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    } else {
      thumb = `<div class="rank-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    }

    const li = document.createElement('li');
    li.className = 'rank-item' + (idx === curIdx ? ' cur' : '');
    li.dataset.idx = idx;
    li.innerHTML = `<div class="rank-num">${i + 1}</div>`
      + thumb
      + `<div class="rank-info"><div class="rk-name">${s.songName}</div><div class="rk-artist">${s.artist}</div></div>`
      + `<div class="rank-stats">`
      + `<div class="rk-value">${valText}</div>`
      + `<div class="rk-sub">${subText}</div>`
      + `<div class="rk-bar"><div class="rk-bar-fill" style="width:${pct}%"></div></div>`
      + `</div>`;
    li.addEventListener('click', () => {
      if (currentView !== 'home') {
        currentView = 'home';
        try { localStorage.setItem('sqet-current-view', 'home'); } catch (e) {}
        navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'home'));
      }
      showPlayerView();
      play(idx);
    });
    return li;
  };

  // 首批直接挂载
  const firstBatch = Math.min(RANK_PAGE_SIZE, _rankTotal);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < firstBatch; k++) {
    frag.appendChild(buildRankItem(ranked[k], k));
  }
  rankingList.appendChild(frag);
  _rankOffset = firstBatch;

  if (_rankOffset >= _rankTotal) return;

  // 哨兵元素: 滚动到可视区时加载下一批
  _rankSentinel = document.createElement('div');
  _rankSentinel.className = 'list-sentinel';
  _rankSentinel.textContent = `滚动加载更多 (${_rankOffset}/${_rankTotal})`;
  rankingList.appendChild(_rankSentinel);

  const loadNext = () => {
    if (myToken !== _rankRenderToken) return;
    if (_rankOffset >= _rankTotal) {
      if (_rankSentinel) { _rankSentinel.remove(); _rankSentinel = null; }
      return;
    }
    if (_rankSentinel) _rankSentinel.remove();
    const end = Math.min(_rankOffset + RANK_PAGE_SIZE, _rankTotal);
    const frag2 = document.createDocumentFragment();
    for (let k = _rankOffset; k < end; k++) {
      frag2.appendChild(buildRankItem(ranked[k], k));
    }
    rankingList.appendChild(frag2);
    _rankOffset = end;
    if (_rankOffset < _rankTotal) {
      _rankSentinel.textContent = `滚动加载更多 (${_rankOffset}/${_rankTotal})`;
      rankingList.appendChild(_rankSentinel);
    } else {
      _rankSentinel = null;
    }
  };

  if ('IntersectionObserver' in window) {
    // 滚动容器是 .stats-body, 不是 #ranking-list 本身
    const scrollRoot = rankingList.closest('.stats-body') || null;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadNext();
    }, { root: scrollRoot, rootMargin: '200px' });
    io.observe(_rankSentinel);
    _rankSentinel._io = io;
  }
}

// 分页渲染悬浮播放列表, 避免一次性挂载 1900+ DOM 元素导致卡顿
const FL_PAGE_SIZE = 200;
let _flRenderToken = 0;
let _flSentinel = null;

function renderFloatList() {
  const q = (flSearch.value || '').trim().toLowerCase();
  flList.innerHTML = '';
  _flRenderToken++;
  const myToken = _flRenderToken;
  if (_flSentinel) {
    if (_flSentinel._io) { _flSentinel._io.disconnect(); _flSentinel._io = null; }
    _flSentinel.remove(); _flSentinel = null;
  }
  // 收集匹配项
  const items = [];
  for (let idx = 0; idx < songs.length; idx++) {
    const s = songs[idx];
    if (q && !(s.songName.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q))) continue;
    items.push(idx);
  }
  if (!items.length) return;
  // 首批直接挂载
  const firstBatch = Math.min(FL_PAGE_SIZE, items.length);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < firstBatch; k++) {
    frag.appendChild(_buildFlItem(items[k]));
  }
  flList.appendChild(frag);
  if (firstBatch >= items.length) return;
  // 哨兵元素: 滚动到可视区时加载下一批
  _flSentinel = document.createElement('div');
  _flSentinel.className = 'list-sentinel';
  _flSentinel.textContent = `滚动加载更多 (${firstBatch}/${items.length})`;
  flList.appendChild(_flSentinel);
  let i = firstBatch;
  const loadNext = () => {
    if (myToken !== _flRenderToken) return;
    if (i >= items.length) { if (_flSentinel) { _flSentinel.remove(); _flSentinel = null; } return; }
    if (_flSentinel) _flSentinel.remove();
    const end = Math.min(i + FL_PAGE_SIZE, items.length);
    const frag2 = document.createDocumentFragment();
    for (let k = i; k < end; k++) {
      frag2.appendChild(_buildFlItem(items[k]));
    }
    flList.appendChild(frag2);
    i = end;
    if (i < items.length) {
      _flSentinel.textContent = `滚动加载更多 (${i}/${items.length})`;
      flList.appendChild(_flSentinel);
    } else {
      _flSentinel = null;
    }
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadNext();
    }, { root: flList, rootMargin: '200px' });
    io.observe(_flSentinel);
    _flSentinel._io = io;
  }
}

function _buildFlItem(idx) {
  const s = songs[idx];
  const li = document.createElement('li');
  li.className = 'fl-item' + (idx === curIdx ? ' cur' : '');
  li.dataset.idx = idx;
  let thumb;
  if (s.coverPath) {
    thumb = `<img class="fl-thumb" src="${toUrl(s.coverPath)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<div class="fl-ph" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
  } else {
    thumb = `<div class="fl-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
  }
  li.innerHTML = `${thumb}<div class="fl-info"><div class="fl-name">${s.songName}</div><div class="fl-artist">${s.artist}</div></div>`;
  li.addEventListener('click', () => {
    play(idx);
  });
  return li;
}

function updFloatListCur() {
  // 性能: 仅更新旧/新当前项, 避免遍历全部 .fl-item
  flList.querySelectorAll('.fl-item.cur').forEach(el => el.classList.remove('cur'));
  const cur = flList.querySelector(`.fl-item[data-idx="${curIdx}"]`);
  if (cur) cur.classList.add('cur');
}

function updCur() {
  // 性能: 仅更新旧/新当前项, 避免遍历全部 .song-item
  listEl.querySelectorAll('.song-item.cur').forEach(el => el.classList.remove('cur'));
  const cur = listEl.querySelector(`.song-item[data-idx="${curIdx}"]`);
  if (cur) cur.classList.add('cur');
  updFloatListCur();
}

function scrollCur() {
  const el = listEl.querySelector('.song-item.cur');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setFloatListExpanded(expanded) {
  if (expanded) {
    floatListWrap.classList.add('expanded');
    btnFloatList.classList.add('hidden');
    flSearch.value = '';
    renderFloatList();
    flSearch.focus();
  } else {
    floatListWrap.classList.remove('expanded');
    btnFloatList.classList.remove('hidden');
  }
}
