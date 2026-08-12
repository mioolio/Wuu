// =========== 不推荐管理界面 ===========
// 展示 dislikedSet 中的歌曲, 支持从磁盘彻底删除文件夹
// 数据来源: dislikedSet (Map<audioPath, ts>), 与 songs 数组匹配获取元数据

const mgmtList = () => document.getElementById('mgmt-list');
const mgmtEmpty = () => document.getElementById('mgmt-empty');
const mgmtCount = () => document.getElementById('mgmt-count');
const mgmtSize = () => document.getElementById('mgmt-size');

// 渲染不推荐列表 (currentView === 'management' 时调用)
function renderManagementList() {
  const list = mgmtList();
  const empty = mgmtEmpty();
  const countEl = mgmtCount();
  const sizeEl = mgmtSize();
  if (!list || !empty || !countEl) return;

  // 清空旧列表
  list.innerHTML = '';
  const dislikedPaths = [...dislikedSet.keys()];
  // 仅保留 songs 中存在的歌曲 (磁盘已删除的不显示)
  const dislikedSongs = dislikedPaths
    .map(p => songs.find(s => s && s.audioPath === p))
    .filter(Boolean);

  // 按倒赞时间降序排序 (最新标记的在前)
  dislikedSongs.sort((a, b) => {
    const ta = dislikedSet.get(a.audioPath) || 0;
    const tb = dislikedSet.get(b.audioPath) || 0;
    return tb - ta;
  });

  if (dislikedSongs.length === 0) {
    empty.style.display = 'flex';
    countEl.textContent = '共 0 首';
    if (sizeEl) sizeEl.textContent = '';
    return;
  }
  empty.style.display = 'none';
  countEl.textContent = `共 ${dislikedSongs.length} 首`;

  // 计算总文件大小 (异步)
  calcDislikedTotalSize(dislikedSongs).then(sizeStr => {
    if (sizeEl) sizeEl.textContent = sizeStr;
  });

  dislikedSongs.forEach(s => {
    const li = document.createElement('li');
    li.className = 'mgmt-item';
    li.dataset.path = s.audioPath;

    let thumb;
    if (s.coverPath) {
      thumb = `<img class="mgmt-thumb" src="${toUrl(s.coverPath)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<div class="mgmt-ph" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    } else {
      thumb = `<div class="mgmt-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    }

    const ts = dislikedSet.get(s.audioPath) || 0;
    const tsStr = ts ? _fmtDislikeDate(ts) : '';
    li.innerHTML = `${thumb}`
      + `<div class="mgmt-info">`
      +   `<div class="mgmt-name" title="${_escHtml(s.songName)}">${_escHtml(s.songName)}</div>`
      +   `<div class="mgmt-artist" title="${_escHtml(s.artist)}">${_escHtml(s.artist)}</div>`
      +   `<div class="mgmt-meta">`
      +     `<span class="mgmt-time">标记于 ${tsStr}</span>`
      +     `<span class="mgmt-path" title="${_escHtml(s.audioPath)}">${_escHtml(_shortenPath(s.audioPath))}</span>`
      +   `</div>`
      + `</div>`
      + `<div class="mgmt-row-actions">`
      +   `<button class="mgmt-action-undo" data-act="undo" title="取消不推荐标记(不删文件)">取消标记</button>`
      +   `<button class="mgmt-action-delete" data-act="delete" title="从磁盘彻底删除该歌曲文件夹">彻底删除</button>`
      + `</div>`;

    li.querySelector('[data-act="undo"]').addEventListener('click', (e) => {
      e.stopPropagation();
      _undoDislike(s);
    });
    li.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await _deleteDislikedSong(s, li);
    });

    list.appendChild(li);
  });
}

// 取消单首歌曲的不推荐标记 (仅删 dislikedSet, 不删文件)
function _undoDislike(s) {
  if (!s) return;
  dislikedSet.delete(s.audioPath);
  saveUserData();
  renderManagementList();
  updDislikeBtn();
  if (typeof showToast === 'function') showToast('已取消不推荐标记', 'info');
}

// 从磁盘彻底删除歌曲文件 (调用 IPC: delete-song-folder)
// 删除成功后: 从 dislikedSet / likedSet / collections / stats / progress / actualDuration / duration_cache 中清除
async function _deleteDislikedSong(s, liEl) {
  if (!s || !s.audioPath) return;
  // 二次确认 (避免误删)
  const confirmed = await _confirmDeleteDialog(s);
  if (!confirmed) return;

  // 添加删除中状态
  if (liEl) {
    liEl.classList.add('deleting');
    liEl.style.opacity = '0.5';
    liEl.style.pointerEvents = 'none';
  }

  try {
    const result = await window.musicAPI.deleteSongFolder(s.audioPath);
    if (!result.ok) {
      if (result.error === 'not_found') {
        // 文件已不存在, 视为成功 (清理元数据)
      } else {
        if (typeof showToast === 'function') showToast(`删除失败: ${result.error}`, 'error');
        if (liEl) { liEl.classList.remove('deleting'); liEl.style.opacity = ''; liEl.style.pointerEvents = ''; }
        return;
      }
    }
    // 清理所有相关元数据
    dislikedSet.delete(s.audioPath);
    likedSet.delete(s.audioPath);
    collections.forEach(c => c.songs.delete(s.audioPath));
    if (stats[s.audioPath]) delete stats[s.audioPath];
    if (progress[s.audioPath]) delete progress[s.audioPath];
    if (actualDuration[s.audioPath]) delete actualDuration[s.audioPath];
    // 从 songs 数组移除
    const idx = songs.findIndex(x => x && x.audioPath === s.audioPath);
    if (idx >= 0) songs.splice(idx, 1);
    saveUserData();
    if (typeof showToast === 'function') {
      const txt = result.removed === 'file' ? '已删除文件' : '已删除文件夹';
      showToast(`${txt}: ${s.songName}`, 'success');
    }
    renderManagementList();
    updDislikeBtn();
  } catch (e) {
    if (typeof showToast === 'function') showToast(`删除异常: ${e.message || e}`, 'error');
    if (liEl) { liEl.classList.remove('deleting'); liEl.style.opacity = ''; liEl.style.pointerEvents = ''; }
  }
}

// 删除确认对话框 (复用项目现有的 dialog/modal 模式)
function _confirmDeleteDialog(s) {
  return new Promise(resolve => {
    // 优先使用项目现有的 modal 系统, 没有则用原生 confirm
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog({
        title: '彻底删除',
        message: `确定从磁盘彻底删除 "${s.songName}" 吗?\n该操作会删除整个文件夹 (含音频/封面/歌词/info.json), 且不可恢复。`,
        confirmText: '彻底删除',
        cancelText: '取消',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
      return;
    }
    // 兜底: 原生 confirm
    const ok = confirm(`确定从磁盘彻底删除 "${s.songName}" 吗?\n该操作会删除整个文件夹, 且不可恢复。`);
    resolve(ok);
  });
}

// 清空所有不推荐标记 (不删除文件, 仅清 dislikedSet)
function clearAllDislikeMarks() {
  if (dislikedSet.size === 0) {
    if (typeof showToast === 'function') showToast('暂无可清空的标记', 'info');
    return;
  }
  const cnt = dislikedSet.size;
  dislikedSet.clear();
  saveUserData();
  renderManagementList();
  updDislikeBtn();
  if (typeof showToast === 'function') showToast(`已清空 ${cnt} 条不推荐标记`, 'success');
}

// 计算不推荐列表总文件大小 (异步遍历)
async function calcDislikedTotalSize(songArr) {
  if (!songArr || songArr.length === 0) return '';
  let totalBytes = 0;
  let counted = 0;
  for (const s of songArr) {
    try {
      // 估算: 取父文件夹大小 (需要 IPC), 这里简化为单文件大小
      // 通过 file:// 协议 fetch HEAD 获取 Content-Length
      const url = toUrl(s.audioPath);
      if (!url || !url.startsWith('file://')) continue;
      const resp = await fetch(url, { method: 'HEAD' });
      const len = parseInt(resp.headers.get('Content-Length') || '0', 10);
      if (len > 0) { totalBytes += len; counted++; }
    } catch (e) {}
  }
  if (totalBytes === 0) return '';
  return `· 约 ${_fmtBytes(totalBytes)}`;
}

// 格式化字节数为人类可读
function _fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// 格式化时间戳为日期
function _fmtDislikeDate(ts) {
  try {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) { return ''; }
}

// 缩短路径显示 (仅保留最后两级目录)
function _shortenPath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}

// HTML 转义
function _escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 视图切换函数 (由 events.js 导航处理调用)
function showManagementView() {
  currentMode = 'management';
  hideAllViews();
  const v = document.getElementById('view-management');
  if (v) v.classList.remove('hidden');
  refreshCoverBackground();
  renderManagementList();
}

// 绑定按钮事件 (DOMContentLoaded 后已可访问 fragment)
window.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('mgmt-refresh');
  const clearBtn = document.getElementById('mgmt-clear');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      // 重新扫描歌库, 同步 dislikedSet 中已删除的文件
      try {
        songs = await window.musicAPI.getSongs();
      } catch (e) {}
      renderManagementList();
      if (typeof showToast === 'function') showToast('已刷新', 'info');
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (dislikedSet.size === 0) {
        if (typeof showToast === 'function') showToast('暂无可清空的标记', 'info');
        return;
      }
      if (!confirm(`确定清空所有 ${dislikedSet.size} 条不推荐标记吗?\n(此操作仅清除标记, 不会删除磁盘文件)`)) return;
      clearAllDislikeMarks();
    });
  }
});
