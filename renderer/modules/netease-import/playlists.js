// =========== 网易云音乐歌单导入 - 歌单与曲目列表 ===========
// 从 netease-import/init.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 歌单列表 ----
async function fetchWyPlaylists() {
  if (!wyUserInfo) return;
  wyPlaylistGrid.innerHTML = '<p class="wy-loading-hint">加载中...</p>';
  try {
    const res = await window.neteaseAPI.userPlaylists(1, 200);
    if (!res || !res.ok) {
      wyPlaylistGrid.innerHTML = '<p class="wy-loading-hint">加载失败: ' + (res && res.message ? res.message : '') + '</p>';
      return;
    }
    wyAllPlaylists = {
      created: Array.isArray(res.data.created) ? res.data.created : [],
      collected: Array.isArray(res.data.collected) ? res.data.collected : [],
    };
    renderWyPlaylists();
  } catch (e) {
    wyPlaylistGrid.innerHTML = '<p class="wy-loading-hint">加载失败: ' + e.message + '</p>';
  }
}

function renderWyPlaylists() {
  const list = wyCurrentPlTab === 'collected' ? wyAllPlaylists.collected : wyAllPlaylists.created;
  wyPlaylistGrid.innerHTML = '';
  if (!list || list.length === 0) {
    wyPlaylistGrid.innerHTML = '<p class="wy-loading-hint">暂无歌单</p>';
    return;
  }
  list.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'wy-pl-card';
    const id = pl.id || '';
    const title = pl.title || '未知歌单';
    const cover = pl.cover || '';
    const count = pl.count || 0;
    card.innerHTML = `
      <div class="wy-pl-cover">
        ${cover ? `<img src="${cover}" alt="" onerror="this.style.display='none'" />` : '<div class="wy-pl-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      </div>
      <div class="wy-pl-info">
        <div class="wy-pl-name">${escapeWyHtml(title)}</div>
        <div class="wy-pl-count">${count} 首</div>
      </div>
    `;
    card.addEventListener('click', () => selectWyPlaylist(id, title));
    wyPlaylistGrid.appendChild(card);
  });
}

// ---- 歌单曲目 ----
async function selectWyPlaylist(playlistId, title) {
  if (!playlistId) return;
  wyCurrentPlaylist = { id: playlistId, title };
  wyPlaylistsEl.classList.add('hidden');
  wyTrackListWrap.classList.remove('hidden');
  wyPlaylistTitle.textContent = title;
  wyTrackList.innerHTML = '<tr><td colspan="7" class="wy-loading-cell">加载中...</td></tr>';
  wyCurrentTracks = [];
  try {
    const res = await window.neteaseAPI.playlistTracks(playlistId);
    if (!res || !res.ok) {
      wyTrackList.innerHTML = `<tr><td colspan="7" class="wy-error-cell">加载失败: ${res && res.message ? res.message : ''}</td></tr>`;
      return;
    }
    const tracks = Array.isArray(res.data.songs) ? res.data.songs : [];
    wyCurrentTracks = tracks;
    renderWyTracks(tracks);
  } catch (e) {
    wyTrackList.innerHTML = `<tr><td colspan="7" class="wy-error-cell">加载失败: ${e.message}</td></tr>`;
  }
}

function renderWyTracks(tracks) {
  wyTrackList.innerHTML = '';
  if (!tracks.length) {
    wyTrackList.innerHTML = '<tr><td colspan="7" class="wy-loading-cell">暂无歌曲</td></tr>';
    return;
  }
  tracks.forEach((song, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    const title = song.name || '未知歌曲';
    const artist = song.artist || '';
    const album = song.album || '';
    const cover = song.cover || '';
    const duration = formatWyDuration(song.duration) || '0:00';
    const tagsHtml = buildWyTags(song);
    tr.innerHTML = `
      <td class="col-cover">${cover ? `<img src="${cover}" alt="" class="wy-song-cover wy-clickable" title="点击试听" onerror="this.style.display='none'" />` : '<div class="wy-song-cover-ph wy-clickable" title="点击试听"></div>'}</td>
      <td class="col-title wy-clickable" title="${escapeWyHtml(title)} - 点击试听">${escapeWyHtml(title)}</td>
      <td class="col-artist" title="${escapeWyHtml(artist)}">${escapeWyHtml(artist)}</td>
      <td class="col-album" title="${escapeWyHtml(album)}">${escapeWyHtml(album)}</td>
      <td class="col-duration">${duration}</td>
      <td class="col-tags">${tagsHtml}</td>
      <td class="col-action">
        <button class="wy-import-one wy-btn">导入</button>
        <button class="wy-copy-name wy-btn-icon" title="复制名称"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </td>
    `;
    // 封面/歌名点击 → 试听
    tr.querySelector('.wy-song-cover, .wy-song-cover-ph').addEventListener('click', () => playWyPreview(i));
    tr.querySelector('.col-title.wy-clickable').addEventListener('click', () => playWyPreview(i));
    // 单首导入按钮
    tr.querySelector('.wy-import-one').addEventListener('click', () => importSingleWyTrack(i));
    // 复制名称
    tr.querySelector('.wy-copy-name').addEventListener('click', () => {
      navigator.clipboard.writeText(title).then(() => {
        if (typeof showToast === 'function') showToast('已复制: ' + title, 'success');
      }).catch(() => {
        if (typeof showToast === 'function') showToast('复制失败', 'error');
      });
    });
    wyTrackList.appendChild(tr);
  });
}

// ---- 字段提取辅助 ----
function formatWyDuration(ms) {
  if (!ms) return '0:00';
  // 网易云 duration 单位是毫秒
  let s;
  if (ms > 10000) {
    s = Math.floor(ms / 1000);
  } else {
    s = Math.floor(ms);
  }
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

// ---- 标签 (VIP/付费) ----
function buildWyTags(song) {
  const tags = [];
  // fee: 0=免费, 1=VIP, 4=专辑购买, 8=低音质免费
  if (song.isVip || song.fee === 1) {
    tags.push('<span class="wy-tag wy-tag-vip" style="background:rgba(128,128,128,0.15);color:#d4a017;padding:1px 6px;border-radius:4px;font-size:11px;">VIP</span>');
  }
  if (song.fee === 4) {
    tags.push('<span class="wy-tag wy-tag-album" style="background:rgba(128,128,128,0.15);color:#e53e3e;padding:1px 6px;border-radius:4px;font-size:11px;">数字专辑</span>');
  }
  return tags.join(' ');
}
