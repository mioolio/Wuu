// =========== 酷狗歌单导入 - 歌单与曲目列表 ===========
// 从 kugou-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 歌单列表 ----
async function fetchPlaylists() {
  kgPlaylistsEl.innerHTML = '<p class="kg-loading-hint">加载中...</p>';
  kgPlaylistEmpty.classList.add('hidden');
  try {
    const res = await window.kugouAPI.playlists(1, 100);
    if (res.ok && res.data && res.data.info) {
      renderPlaylists(res.data.info);
    } else {
      kgPlaylistsEl.innerHTML = '';
      kgPlaylistEmpty.classList.remove('hidden');
    }
  } catch (e) {
    kgPlaylistsEl.innerHTML = '';
    kgPlaylistEmpty.textContent = '加载失败: ' + e.message;
    kgPlaylistEmpty.classList.remove('hidden');
  }
}

function renderPlaylists(playlists) {
  kgPlaylistsEl.innerHTML = '';
  kgPlaylistCount.textContent = `${playlists.length} 个歌单`;
  if (playlists.length === 0) {
    kgPlaylistEmpty.classList.remove('hidden');
    return;
  }
  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'kg-playlist-card';
    const pic = (pl.pic || pl.create_user_pic || '').replace('{size}', '150');
    card.innerHTML = `
      <div class="kg-pl-cover">
        ${pic ? `<img src="${pic}" alt="" onerror="this.style.display='none'" />` : '<div class="kg-pl-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      </div>
      <div class="kg-pl-info">
        <div class="kg-pl-name">${pl.name || '未知歌单'}</div>
        <div class="kg-pl-count">${pl.count || 0} 首</div>
      </div>
    `;
    card.addEventListener('click', () => selectPlaylist(pl));
    kgPlaylistsEl.appendChild(card);
  });
}

// ---- 歌单曲目 ----
async function selectPlaylist(playlist) {
  kgTracksSection.classList.remove('hidden');
  document.querySelector('.kg-playlist-section').classList.add('hidden');
  kgCurrentPlaylist.textContent = playlist.name;
  kgTracks.innerHTML = '<tr><td colspan="9" class="kg-loading-cell">加载中...</td></tr>';
    kgCurrentTracks = [];

  try {
    const res = await window.kugouAPI.tracks(playlist.listid);
    if (res.ok && res.data) {
      kgCurrentTracks = res.data.songs;
      renderTracks(res.data.songs);
    } else {
      kgTracks.innerHTML = `<tr><td colspan="9" class="kg-error-cell">加载失败: ${res.message || ''}</td></tr>`;
    }
  } catch (e) {
    kgTracks.innerHTML = `<tr><td colspan="9" class="kg-error-cell">加载失败: ${e.message}</td></tr>`;
  }
}

function renderTracks(songs) {
  kgTracks.innerHTML = '';
  kgCheckAll.checked = false;
  songs.forEach((song, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    // 解析歌曲名: song.name 可能是 "薛之谦 - 木偶人.mp3" 格式, 需提取干净标题
    const { title: cleanTitle } = kgParseName(song.name || '');
    const artists = (song.singerinfo || []).map(s => s.name).filter(Boolean).join(', ');
    const album = (song.albuminfo && song.albuminfo.name) || '';
    const cover = (song.cover || '').replace('{size}', '120');
    const duration = formatDuration(song.timelen || 0);
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="kg-row-check" /></td>
      <td class="col-idx">${idx + 1}</td>
      <td class="col-cover">${cover ? `<img src="${cover}" alt="" class="kg-song-cover kg-clickable" title="点击试听" onerror="this.style.display='none'" />` : '<div class="kg-song-cover-ph kg-clickable" title="点击试听"></div>'}</td>
      <td class="col-name kg-clickable" title="${cleanTitle} - 点击试听">${cleanTitle}</td>
      <td class="col-artist" title="${artists}">${artists}</td>
      <td class="col-album" title="${album}">${album}</td>
      <td class="col-duration">${duration}</td>
      <td class="col-action">
        <button class="kg-import-one kg-btn">导入</button>
        <button class="kg-copy-name kg-btn-icon" title="复制名称"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </td>
      <td class="col-import-status"><span class="kg-status-pending">待导入</span></td>
    `;
    // 封面/歌名点击 → 试听
    tr.querySelector('.kg-song-cover, .kg-song-cover-ph').addEventListener('click', () => playKgPreview(idx));
    tr.querySelector('.col-name.kg-clickable').addEventListener('click', () => playKgPreview(idx));
    // 单首导入按钮
    tr.querySelector('.kg-import-one').addEventListener('click', () => importSingleTrack(idx));
    // 复制名称 (只复制干净歌名)
    tr.querySelector('.kg-copy-name').addEventListener('click', () => {
      navigator.clipboard.writeText(cleanTitle).then(() => {
        if (typeof showToast === 'function') showToast('已复制: ' + cleanTitle, 'success');
      }).catch(() => {
        if (typeof showToast === 'function') showToast('复制失败', 'error');
      });
    });
    kgTracks.appendChild(tr);
  });
}

// 解析歌曲名: 去掉扩展名和 "艺人 - " 前缀
function kgParseName(name) {
  let s = String(name || '').trim();
  s = s.replace(/\.(mp3|m4a|aac|flac|wav|ogg)$/i, '');
  if (!s) return { title: '未知歌曲', artist: '' };
  const li = s.lastIndexOf(' - ');
  if (li > 0) {
    const artist = s.slice(0, li).trim();
    const title = s.slice(li + 3).trim();
    if (artist && title) return { title, artist };
  }
  return { title: s, artist: '' };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
