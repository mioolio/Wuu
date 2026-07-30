// =========== 汽水音乐歌单导入 - 歌单与曲目列表 ===========
// 从 qishui-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 歌单列表 ----
async function loadQsPlaylists() {
  if (!qsSession) return;
  qsPlaylistGrid.innerHTML = '<p class="qs-loading-hint">加载中...</p>';
  try {
    const res = await window.qishuiAPI.getPlaylists(qsSession.aid, qsSession.sessionid);
    if (!res || !res.ok) {
      qsPlaylistGrid.innerHTML = '<p class="qs-loading-hint">加载失败: ' + (res && res.message ? res.message : '') + '</p>';
      return;
    }
    // 后端返回 { ok, created: [...], collected: [...] } 在根级别
    qsAllPlaylists = {
      created: Array.isArray(res.created) ? res.created : [],
      collected: Array.isArray(res.collected) ? res.collected : [],
    };
    renderQsPlaylists();
  } catch (e) {
    qsPlaylistGrid.innerHTML = '<p class="qs-loading-hint">加载失败: ' + e.message + '</p>';
  }
}

function renderQsPlaylists() {
  const list = qsCurrentPlTab === 'collected' ? qsAllPlaylists.collected : qsAllPlaylists.created;
  qsPlaylistGrid.innerHTML = '';
  if (!list || list.length === 0) {
    qsPlaylistGrid.innerHTML = '<p class="qs-loading-hint">暂无歌单</p>';
    return;
  }
  list.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'qs-pl-card';
    const id = pl.id || '';
    const title = pl.title || '未知歌单';
    const cover = pl.cover || '';
    const count = pl.count_tracks || 0;
    card.innerHTML = `
      <div class="qs-pl-cover">
        ${cover ? `<img src="${cover}" alt="" onerror="this.style.display='none'" />` : '<div class="qs-pl-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      </div>
      <div class="qs-pl-info">
        <div class="qs-pl-name">${escapeHtml(title)}</div>
        <div class="qs-pl-count">${count} 首</div>
      </div>
    `;
    card.addEventListener('click', () => selectQsPlaylist(id, title));
    qsPlaylistGrid.appendChild(card);
  });
}

// ---- 歌单曲目 ----
async function selectQsPlaylist(playlistId, title) {
  if (!qsSession || !playlistId) return;
  qsCurrentPlaylist = { id: playlistId, title };
  qsPlaylistsEl.classList.add('hidden');
  qsTrackListWrap.classList.remove('hidden');
  qsPlaylistTitle.textContent = title;
  qsTrackList.innerHTML = '<tr><td colspan="7" class="qs-loading-cell">加载中...</td></tr>';
  qsCurrentTracks = [];
  qsCursor = '';
  qsHasMore = false;
  qsLoadingMore = false;
  await fetchQsTracks();
}

async function fetchQsTracks() {
  if (!qsSession || !qsCurrentPlaylist) return;
  if (qsLoadingMore) return;
  qsLoadingMore = true;
  try {
    const res = await window.qishuiAPI.getPlaylistDetail(
      qsSession.aid,
      qsSession.sessionid,
      qsCurrentPlaylist.id,
      qsCursor
    );
    if (!res || !res.ok) {
      qsTrackList.innerHTML = `<tr><td colspan="7" class="qs-error-cell">加载失败: ${res && res.message ? res.message : ''}</td></tr>`;
      return;
    }
    // 后端返回 { ok, has_more, next_cursor, songs: [...] } 在根级别
    const tracks = Array.isArray(res.songs) ? res.songs : [];
    qsHasMore = !!res.has_more;
    qsCursor = res.next_cursor || '';
    if (qsCurrentTracks.length === 0) {
      qsCurrentTracks = tracks;
    } else {
      qsCurrentTracks = qsCurrentTracks.concat(tracks);
    }
    renderQsTracks(tracks, qsCurrentTracks.length - tracks.length);
  } catch (e) {
    qsTrackList.innerHTML = `<tr><td colspan="7" class="qs-error-cell">加载失败: ${e.message}</td></tr>`;
  } finally {
    qsLoadingMore = false;
  }
}

async function loadMoreQsTracks() {
  if (!qsHasMore || qsLoadingMore) return;
  await fetchQsTracks();
}

function renderQsTracks(tracks, startIdx) {
  // 首次加载清空 (移除 loading/error 行)
  if (startIdx === 0) {
    qsTrackList.innerHTML = '';
  } else {
    // 移除可能的 loading 行
    const loadingRow = qsTrackList.querySelector('.qs-loading-cell');
    if (loadingRow && loadingRow.parentElement) loadingRow.parentElement.remove();
  }
  tracks.forEach((song, i) => {
    const idx = startIdx + i;
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    const title = qsGetTrackTitle(song);
    const artist = qsGetTrackArtist(song);
    const album = qsGetTrackAlbum(song);
    const cover = qsGetTrackCover(song);
    // 后端已返回格式化好的 "mm:ss" 字符串, 直接使用
    const duration = qsGetTrackDuration(song) || '0:00';
    const tagsHtml = buildQsTags(song);
    tr.innerHTML = `
      <td class="col-cover">${cover ? `<img src="${cover}" alt="" class="qs-song-cover qs-clickable" title="点击试听" onerror="this.style.display='none'" />` : '<div class="qs-song-cover-ph qs-clickable" title="点击试听"></div>'}</td>
      <td class="col-title qs-clickable" title="${escapeHtml(title)} - 点击试听">${escapeHtml(title)}</td>
      <td class="col-artist" title="${escapeHtml(artist)}">${escapeHtml(artist)}</td>
      <td class="col-album" title="${escapeHtml(album)}">${escapeHtml(album)}</td>
      <td class="col-duration">${duration}</td>
      <td class="col-tags">${tagsHtml}</td>
      <td class="col-action">
        <button class="qs-import-one qs-btn">导入</button>
        <button class="qs-copy-name qs-btn-icon" title="复制名称"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </td>
    `;
    // 封面/歌名点击 → 试听
    tr.querySelector('.qs-song-cover, .qs-song-cover-ph').addEventListener('click', () => playQsPreview(idx));
    tr.querySelector('.col-title.qs-clickable').addEventListener('click', () => playQsPreview(idx));
    // 单首导入按钮
    tr.querySelector('.qs-import-one').addEventListener('click', () => importSingleQsTrack(idx));
    // 复制名称
    tr.querySelector('.qs-copy-name').addEventListener('click', () => {
      navigator.clipboard.writeText(title).then(() => {
        if (typeof showToast === 'function') showToast('已复制: ' + title, 'success');
      }).catch(() => {
        if (typeof showToast === 'function') showToast('复制失败', 'error');
      });
    });
    qsTrackList.appendChild(tr);
  });
}

// ---- 字段提取辅助 (后端已统一为驼峰命名字段) ----
function qsGetTrackId(song) {
  // 后端返回 id 就是 track.id (如果 track 不存在则为空字符串)
  // 不使用 resource.id 作为 fallback, 因为 track_v2 端点需要的是 track_id
  return song.id || '';
}
function qsGetTrackTitle(song) {
  return song.name || '未知歌曲';
}
function qsGetTrackArtist(song) {
  return song.artist || '';
}
function qsGetTrackAlbum(song) {
  return song.album || '';
}
function qsGetTrackCover(song) {
  return song.cover || '';
}
function qsGetTrackDuration(song) {
  // 后端已格式化为 "mm:ss" 字符串, 直接返回
  return song.duration || '';
}

// ---- 标签 (VIP/已下架/视频音乐, 后端返回 isVip/isUnavailable/isVideo) ----
function buildQsTags(song) {
  const tags = [];
  if (song.isVip) {
    tags.push('<span class="qs-tag qs-tag-vip" style="background:rgba(128,128,128,0.15);color:#d4a017;padding:1px 6px;border-radius:4px;font-size:11px;">VIP</span>');
  }
  if (song.isUnavailable) {
    tags.push('<span class="qs-tag qs-tag-offshelf" style="background:rgba(128,128,128,0.15);color:#e53e3e;padding:1px 6px;border-radius:4px;font-size:11px;">已下架</span>');
  }
  if (song.isVideo) {
    tags.push('<span class="qs-tag qs-tag-video" style="background:rgba(128,128,128,0.15);color:#3182ce;padding:1px 6px;border-radius:4px;font-size:11px;">视频音乐</span>');
  }
  return tags.join(' ');
}

function formatQsDuration(ms) {
  if (!ms) return '0:00';
  // 若数值过小, 可能已经是秒
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

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
