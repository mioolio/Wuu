// =========== 免费听音乐专区 - 搜索与歌单浏览 ===========
// 从 free-music.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// 搜索 (支持歌曲搜索和歌单搜索)
async function doFmSearch() {
  const keyword = fmInput.value.trim();
  if (!keyword) return;
  if (_fmSearching) return;
  const sources = Array.from(fmSourcesEl.querySelectorAll('.fm-source-tag.active')).map(t => t.dataset.src);
  if (!sources.length) {
    fmSearchStatusEl.textContent = '请至少选择一个平台';
    fmSearchStatusEl.classList.remove('hidden');
    return;
  }
  _fmSearching = true;
  fmSearchStatusEl.textContent = '搜索中...';
  fmSearchStatusEl.classList.remove('hidden');
  fmSearchStatusEl.style.color = '';
  fmResultsEl.innerHTML = '';
  fmPlaylistsEl.innerHTML = '';
  fmPlaylistsEl.classList.add('hidden');
  fmPlaylistDetailEl.classList.add('hidden');

  try {
    const res = await window.freeMusicAPI.search(keyword, sources, 1, _fmSearchType);
    if (!res.ok) throw new Error(res.message);
    if (_fmSearchType === 'playlist' || _fmSearchType === 'album') {
      const items = res.data || [];
      const label = _fmSearchType === 'playlist' ? '歌单' : '专辑';
      renderFmPlaylists(items, _fmSearchType);
      fmSearchStatusEl.textContent = `找到 ${items.length} 个${label}`;
    } else {
      const songs = res.data || [];
      renderFmResults(songs);
      fmSearchStatusEl.textContent = `找到 ${songs.length} 首歌曲`;
    }
    setTimeout(() => fmSearchStatusEl.classList.add('hidden'), 3000);
  } catch (e) {
    console.error('[FREE-MUSIC] 搜索失败:', e.message);
    fmSearchStatusEl.textContent = '搜索失败: ' + e.message;
    fmSearchStatusEl.style.color = '#e81123';
  } finally {
    _fmSearching = false;
  }
}

// 渲染歌单/专辑搜索结果 (展示结构相同, 复用同一函数)
function renderFmPlaylists(items, type) {
  type = type || 'playlist';
  const emptyText = type === 'album' ? '未找到相关专辑' : '未找到相关歌单';
  const icon = type === 'album' ? '💿' : '📋';
  fmResultsEl.classList.add('hidden');
  fmPlaylistsEl.classList.remove('hidden');
  if (!items.length) {
    fmPlaylistsEl.innerHTML = '<p class="fm-empty">' + emptyText + '</p>';
    return;
  }
  fmPlaylistsEl.innerHTML = items.map((pl, i) => {
    const cover = pl.cover && !pl.cover.includes('placeholder.com') ? `<img src="${escapeFmAttr(pl.cover)}" alt="" onerror="this.outerHTML='<span class=&quot;fm-no-cover&quot;>${icon}</span>'">` : `<span class="fm-no-cover">${icon}</span>`;
    const count = pl.trackCount ? `${pl.trackCount} 首` : '';
    return `
      <div class="fm-result-item fm-playlist-item" data-idx="${i}">
        <div class="fm-result-cover">${cover}</div>
        <div class="fm-result-info">
          <div class="fm-result-name">${escapeFmHtml(pl.name)}</div>
          <div class="fm-result-artist">${escapeFmHtml(pl.creator || '')} <span class="fm-result-src">${pl.source}</span> ${count}</div>
        </div>
      </div>
    `;
  }).join('');
  fmPlaylistsEl.querySelectorAll('.fm-playlist-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    const pl = items[idx];
    item.addEventListener('click', () => showFmPlaylistDetail(pl, type));
  });
}

// 查看歌单/专辑详情 (获取内含歌曲列表)
async function showFmPlaylistDetail(playlist, type) {
  type = type || 'playlist';
  const label = type === 'album' ? '专辑' : '歌单';
  fmPlaylistsEl.classList.add('hidden');
  fmPlaylistDetailEl.classList.remove('hidden');
  fmPlaylistTitleEl.textContent = playlist.name || label;
  fmPlaylistSongsEl.innerHTML = '<p class="fm-empty">加载中...</p>';
  try {
    const res = await window.freeMusicAPI.playlistDetail(playlist.source, playlist.id, type);
    if (!res.ok) throw new Error(res.message);
    const songs = res.data || [];
    // 复用歌曲结果渲染 (作为搜索结果, 支持试听)
    _fmLastResults = songs;
    renderFmPlaylistSongs(songs);
  } catch (e) {
    console.error('[FREE-MUSIC]', label, '详情失败:', e.message);
    fmPlaylistSongsEl.innerHTML = '<p class="fm-empty">加载失败: ' + escapeFmHtml(e.message) + '</p>';
  }
}

// 渲染歌单详情中的歌曲列表 (复用 fm-result-item 结构)
function renderFmPlaylistSongs(songs) {
  if (!songs.length) {
    fmPlaylistSongsEl.innerHTML = '<p class="fm-empty">歌单内暂无歌曲</p>';
    return;
  }
  fmPlaylistSongsEl.innerHTML = songs.map((song, i) => {
    const cover = song.cover && !song.cover.includes('placeholder.com') ? `<img src="${escapeFmAttr(song.cover)}" alt="" onerror="this.outerHTML='<span class=&quot;fm-no-cover&quot;>🎵</span>'">` : '<span class="fm-no-cover">🎵</span>';
    const dur = song.duration ? fmtFmTime(parseInt(song.duration)) : '';
    const inLib = isFmSongInLibrary(song);
    const addedBadge = inLib ? '<span class="fm-added-badge">已添加</span>' : '';
    const dlBtn = inLib
      ? `<button class="fm-result-dl fm-dl-added" title="已在歌库中" disabled>✓</button>`
      : `<button class="fm-result-dl" title="下载">${ICON_DOWNLOAD}</button>`;
    return `
      <div class="fm-result-item" data-idx="${i}">
        <div class="fm-result-cover">${cover}</div>
        <div class="fm-result-info">
          <div class="fm-result-name">${escapeFmHtml(song.name)}${addedBadge}</div>
          <div class="fm-result-artist">${escapeFmHtml(song.artist)} <span class="fm-result-src">${song.source}</span></div>
          <div class="fm-result-meta" data-song-idx="${i}"><span class="fm-meta-loading">探测中...</span></div>
        </div>
        <div class="fm-result-dur">${dur}</div>
        <div class="fm-result-actions">
          <button class="fm-result-play" title="试听">${ICON_PREVIEW}</button>
          ${dlBtn}
        </div>
      </div>
    `;
  }).join('');
  fmPlaylistSongsEl.querySelectorAll('.fm-result-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    const song = songs[idx];
    item.querySelector('.fm-result-play').addEventListener('click', (e) => {
      e.stopPropagation();
      playFmPreview(song, item);
    });
    const dlBtn = item.querySelector('.fm-result-dl');
    if (!dlBtn.disabled) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveFmSongToLibrary(song, dlBtn);
      });
    }
    item.addEventListener('click', () => playFmPreview(song, item));
    // 异步探测大小/码率
    inspectFmSong(song, item.querySelector('.fm-result-meta'));
  });
}

// 渲染搜索结果
function renderFmResults(songs) {
  _fmLastResults = songs || [];
  if (!songs.length) {
    fmResultsEl.innerHTML = '<p class="fm-empty">未找到相关歌曲</p>';
    return;
  }
  fmResultsEl.innerHTML = songs.map((song, i) => {
    const cover = song.cover && !song.cover.includes('placeholder.com') ? `<img src="${escapeFmAttr(song.cover)}" alt="" onerror="this.outerHTML='<span class=&quot;fm-no-cover&quot;>🎵</span>'">` : '<span class="fm-no-cover">🎵</span>';
    const dur = song.duration ? fmtFmTime(parseInt(song.duration)) : '';
    const inLib = isFmSongInLibrary(song);
    const addedBadge = inLib ? '<span class="fm-added-badge">已添加</span>' : '';
    const dlBtn = inLib
      ? `<button class="fm-result-dl fm-dl-added" title="已在歌库中" disabled>✓</button>`
      : `<button class="fm-result-dl" title="下载">${ICON_DOWNLOAD}</button>`;
    return `
      <div class="fm-result-item" data-idx="${i}">
        <div class="fm-result-cover">${cover}</div>
        <div class="fm-result-info">
          <div class="fm-result-name">${escapeFmHtml(song.name)}${addedBadge}</div>
          <div class="fm-result-artist">${escapeFmHtml(song.artist)} <span class="fm-result-src">${song.source}</span></div>
          <div class="fm-result-meta" data-song-idx="${i}"><span class="fm-meta-loading">探测中...</span></div>
        </div>
        <div class="fm-result-dur">${dur}</div>
        <div class="fm-result-actions">
          <button class="fm-result-play" title="试听">${ICON_PREVIEW}</button>
          ${dlBtn}
        </div>
      </div>
    `;
  }).join('');

  // 绑定事件
  fmResultsEl.querySelectorAll('.fm-result-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    const song = songs[idx];
    item.querySelector('.fm-result-play').addEventListener('click', (e) => {
      e.stopPropagation();
      playFmPreview(song, item);
    });
    const dlBtn = item.querySelector('.fm-result-dl');
    if (!dlBtn.disabled) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveFmSongToLibrary(song, dlBtn);
      });
    }
    item.addEventListener('click', () => playFmPreview(song, item));
    // 异步探测大小/码率
    inspectFmSong(song, item.querySelector('.fm-result-meta'));
  });
}
