// =========== 修复模块 ===========
// 扫描曲库中损坏的歌曲(解密失败/音频缺失/文件过小/歌词精度不足)
// 根据 info.json 中的 trackId 重新调用 track_v2 API 获取新的 url + playAuth
// 然后重新下载并解密, 覆盖现有损坏文件
// 歌词精度不足时: 优先从 lyrics_krc.json 重新生成 raw; 无 krc.json 时弹出手动修复对话框

let _damagedList = [];  // 扫描出的损坏歌曲列表

// HTML 转义(避免错误信息里的 < > & 破坏 DOM)
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 显示"已复制"小提示(在点击位置附近)
function showCopyToast(anchor, text) {
  const rect = anchor.getBoundingClientRect();
  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = text;
  toast.style.left = (rect.left + rect.width / 2) + 'px';
  toast.style.top = (rect.top - 4) + 'px';
  document.body.appendChild(toast);
  // 触发动画后移除
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 800);
}

// 歌词手动修复模态对话框(Electron 不支持原生 prompt)
// 返回用户输入的链接字符串; 用户取消时返回 null
let _lyricsRepairResolve = null;
function showLyricsRepairModal(folder) {
  return new Promise((resolve) => {
    _lyricsRepairResolve = resolve;
    lyricsRepairSub.textContent = folder || '';
    lyricsRepairInput.value = '';
    lyricsRepairModal.classList.remove('hidden');
    setTimeout(() => lyricsRepairInput.focus(), 50);
  });
}
// 确认按钮
lyricsRepairConfirm.addEventListener('click', () => {
  const link = lyricsRepairInput.value.trim();
  if (!link) { lyricsRepairInput.focus(); return; }
  lyricsRepairModal.classList.add('hidden');
  if (_lyricsRepairResolve) { _lyricsRepairResolve(link); _lyricsRepairResolve = null; }
});
// 取消按钮
lyricsRepairCancel.addEventListener('click', () => {
  lyricsRepairModal.classList.add('hidden');
  if (_lyricsRepairResolve) { _lyricsRepairResolve(null); _lyricsRepairResolve = null; }
});
// 按 Enter 确认
lyricsRepairInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); lyricsRepairConfirm.click(); }
  if (e.key === 'Escape') { e.preventDefault(); lyricsRepairCancel.click(); }
});

// 修复状态
const RS_PENDING = 'pending';      // 待修复
const RS_REPAIRING = 'repairing';  // 修复中
const RS_DONE = 'done';            // 修复成功
const RS_FAILED = 'failed';        // 修复失败

// 显示状态提示
function setRepairStatus(msg, type) {
  if (!msg) { repairStatus.classList.add('hidden'); return; }
  repairStatus.classList.remove('hidden');
  repairStatus.textContent = msg;
  repairStatus.className = 'repair-status' + (type ? ' ' + type : '');
}

// 扫描按钮: 扫描所有损坏歌曲
repairScanBtn.addEventListener('click', async () => {
  repairScanBtn.disabled = true;
  repairScanBtn.textContent = '扫描中...';
  repairListWrap.classList.add('hidden');
  repairAllBtn.classList.add('hidden');
  setRepairStatus('正在扫描曲库...', 'info');

  try {
    _damagedList = await window.repairAPI.scan();
    if (_damagedList.length === 0) {
      setRepairStatus('未发现损坏的歌曲', 'success');
      return;
    }

    // 初始化状态
    _damagedList.forEach(item => { item._status = RS_PENDING; item._message = ''; });
    renderRepairList();
    repairListWrap.classList.remove('hidden');
    repairAllBtn.classList.remove('hidden');
    setRepairStatus(`发现 ${_damagedList.length} 首损坏歌曲`, 'info');
  } catch (e) {
    setRepairStatus(`扫描失败: ${e.message}`, 'error');
  } finally {
    repairScanBtn.disabled = false;
    repairScanBtn.textContent = '扫描损坏歌曲';
  }
});

// 修复全部按钮: 顺序修复(避免触发风控)
repairAllBtn.addEventListener('click', async () => {
  const pending = _damagedList.filter(i => i._status === RS_PENDING);
  if (pending.length === 0) return;

  repairAllBtn.disabled = true;
  repairScanBtn.disabled = true;
  repairAllBtn.textContent = '修复中...';

  let okCount = 0, failCount = 0;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    item._status = RS_REPAIRING;
    updRepairRow(_damagedList.indexOf(item));
    setRepairStatus(`正在修复... (${i + 1}/${pending.length})`, 'info');

    const res = await window.repairAPI.repair(item);
    if (res.ok) {
      item._status = RS_DONE;
      okCount++;
    } else {
      item._status = RS_FAILED;
      item._message = res.message;
      console.error(`[REPAIR] 修复失败: ${item.title} - ${res.message}`);
      failCount++;
    }
    updRepairRow(_damagedList.indexOf(item));

    // 修复间隔 500ms (避免风控)
    if (i < pending.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  setRepairStatus(
    failCount > 0 ? `修复完成: 成功 ${okCount} 首, 失败 ${failCount} 首` : `修复完成: 成功 ${okCount} 首`,
    failCount > 0 ? 'info' : 'success'
  );
  repairAllBtn.disabled = false;
  repairScanBtn.disabled = false;
  repairAllBtn.textContent = '修复全部';

  // 刷新歌库(保留当前播放位置)
  const curAudioPath = songs[curIdx] ? songs[curIdx].audioPath : null;
  songs = await window.musicAPI.getSongs();
  if (curAudioPath) {
    const newIdx = songs.findIndex(s => s.audioPath === curAudioPath);
    if (newIdx >= 0) curIdx = newIdx;
  }
  renderList();
});

// 构建删除按钮(无法修复/修复失败时, 用户可选择删除或保留)
function buildDeleteBtn(item, idx) {
  const btn = document.createElement('button');
  btn.className = 'repair-del-btn';
  btn.textContent = '删除';
  btn.title = '从磁盘删除该歌曲文件夹';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!item.audioPath) { showToast && showToast('该条目无音频路径, 无法删除', 'error'); return; }
    if (!window.confirm(`确定要彻底删除「${item.title || item.folder}」吗?\n这将删除磁盘上该歌曲的整个文件夹(含音频/封面/歌词), 且无法恢复。`)) return;
    btn.disabled = true;
    const res = await window.musicAPI.deleteSongFolder(item.audioPath);
    if (res && res.ok) {
      _damagedList.splice(idx, 1);
      renderRepairList();
      setRepairStatus(`已删除「${item.title || item.folder}」`, 'info');
      // 刷新歌库(保留当前播放位置)
      const curAudioPath = songs[curIdx] ? songs[curIdx].audioPath : null;
      songs = await window.musicAPI.getSongs();
      if (curAudioPath) {
        const newIdx = songs.findIndex(s => s.audioPath === curAudioPath);
        if (newIdx >= 0) curIdx = newIdx;
        else if (songs.length > 0) curIdx = 0;
      }
      renderList();
    } else {
      btn.disabled = false;
      setRepairStatus(`删除失败: ${(res && res.error) || '未知错误'}`, 'error');
    }
  });
  return btn;
}

// 渲染损坏歌曲列表
function renderRepairList() {
  repairList.innerHTML = '';
  _damagedList.forEach((item, idx) => {
    repairList.appendChild(buildRepairRow(item, idx));
  });
}

// 构建单行
function buildRepairRow(item, idx) {
  const tr = document.createElement('tr');
  tr.className = 'repair-row';
  tr.dataset.idx = idx;
  if (item._status === RS_REPAIRING) tr.classList.add('repairing');
  if (item._status === RS_DONE) tr.classList.add('done');
  if (item._status === RS_FAILED) tr.classList.add('failed');

  // 1. 封面(显示本地封面图片, 无封面时显示占位图标)
  const tdCover = document.createElement('td');
  tdCover.className = 'col-cover';
  if (item.coverPath) {
    const img = document.createElement('img');
    img.src = 'file:///' + item.coverPath;
    img.alt = '';
    img.className = 'repair-cover-img';
    img.addEventListener('error', () => {
      tdCover.innerHTML = '<div class="repair-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';
    });
    tdCover.appendChild(img);
  } else {
    tdCover.innerHTML = '<div class="repair-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';
  }

  // 2. 歌曲名(点击复制到剪贴板)
  const tdTitle = document.createElement('td');
  tdTitle.className = 'col-title copyable';
  tdTitle.textContent = item.title || '未知歌曲';
  tdTitle.title = '点击复制歌曲名';
  tdTitle.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.title || '');
      showCopyToast(tdTitle, '已复制');
    } catch (err) {
      // 降级方案: 用 execCommand
      const ta = document.createElement('textarea');
      ta.value = item.title || '';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showCopyToast(tdTitle, '已复制'); } catch (_) {}
      document.body.removeChild(ta);
    }
  });

  // 3. 作者(点击复制到剪贴板)
  const tdArtist = document.createElement('td');
  tdArtist.className = 'col-artist copyable';
  tdArtist.textContent = item.artist || '未知歌手';
  tdArtist.title = '点击复制作者名';
  tdArtist.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.artist || '');
      showCopyToast(tdArtist, '已复制');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = item.artist || '';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showCopyToast(tdArtist, '已复制'); } catch (_) {}
      document.body.removeChild(ta);
    }
  });

  // 4. 问题
  const tdIssue = document.createElement('td');
  tdIssue.className = 'col-issue';
  tdIssue.innerHTML = `<span class="issue-badge">${item.issue}</span>`;

  // 5. Track ID
  const tdTrackId = document.createElement('td');
  tdTrackId.className = 'col-trackid';
  tdTrackId.textContent = item.trackId || '(无)';
  if (!item.trackId) tdTrackId.classList.add('no-trackid');

  // 6. 修复状态
  const tdStatus = document.createElement('td');
  tdStatus.className = 'col-repair-status';
  const statusText = {
    [RS_PENDING]: '待修复',
    [RS_REPAIRING]: '修复中',
    [RS_DONE]: '已修复',
    [RS_FAILED]: '失败',
  }[item._status] || '待修复';
  if (item._status === RS_FAILED && item._message) {
    // 失败时直接显示错误信息(截断过长文本, hover 看完整)
    tdStatus.innerHTML = `<span class="repair-status-badge failed" title="${escapeHtml(item._message)}">${escapeHtml(item._message).slice(0, 30)}</span>`;
  } else {
    tdStatus.innerHTML = `<span class="repair-status-badge ${item._status}">${statusText}</span>`;
  }

  // 7. 操作按钮
  const tdAction = document.createElement('td');
  tdAction.className = 'colAction';
  const isLyricsIssue = item.issue && item.issue.includes('歌词');
  const isNameIssue = item.issue === '名称异常';
  const needsReparse = item.issue && item.issue.includes('需重新解析');
  // 可修复: 歌词问题(有 krc.json) 或 音频问题(有 trackId) 或 名称异常(FLAC 元数据修复)
  const canRepair = !needsReparse && (isLyricsIssue || isNameIssue || item.trackId);
  if (canRepair && (item._status === RS_PENDING || item._status === RS_FAILED)) {
    const btn = document.createElement('button');
    btn.className = 'repair-one-btn';
    btn.textContent = item._status === RS_FAILED ? '重试' : '修复';
    // 修复失败后追加删除按钮(无法修复时用户可选择删除或保留)
    if (item._status === RS_FAILED) tdAction.appendChild(buildDeleteBtn(item, idx));
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      item._status = RS_REPAIRING;
      updRepairRow(idx);
      const res = await window.repairAPI.repair(item);
      if (res.ok) {
        item._status = RS_DONE;
      } else {
        item._status = RS_FAILED;
        item._message = res.message;
        console.error(`[REPAIR] 修复失败: ${item.title} - ${res.message}`);
      }
      updRepairRow(idx);
      // 刷新歌库
      const curAudioPath = songs[curIdx] ? songs[curIdx].audioPath : null;
      songs = await window.musicAPI.getSongs();
      if (curAudioPath) {
        const newIdx = songs.findIndex(s => s.audioPath === curAudioPath);
        if (newIdx >= 0) curIdx = newIdx;
      }
      renderList();
    });
    tdAction.appendChild(btn);
  } else if (item._status === RS_DONE) {
    tdAction.innerHTML = '<span class="repair-done-mark">✓</span>';
  } else if (needsReparse) {
    // 需重新解析的歌词问题: 显示"手动修复"按钮, 点击后输入分享链接
    const btn = document.createElement('button');
    btn.className = 'repair-one-btn manual';
    btn.textContent = item._status === RS_FAILED ? '重试' : '手动修复';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const shareLink = await showLyricsRepairModal(item.folder);
      if (!shareLink) return;
      btn.disabled = true;
      item._status = RS_REPAIRING;
      updRepairRow(idx);
      const res = await window.repairAPI.repairLyricsManual(item.folder, shareLink);
      if (res.ok) {
        item._status = RS_DONE;
      } else {
        item._status = RS_FAILED;
        item._message = res.message;
        console.error(`[REPAIR] 手动修复失败: ${item.title} - ${res.message}`);
      }
      updRepairRow(idx);
      // 刷新歌库
      const curAudioPath = songs[curIdx] ? songs[curIdx].audioPath : null;
      songs = await window.musicAPI.getSongs();
      if (curAudioPath) {
        const newIdx = songs.findIndex(s => s.audioPath === curAudioPath);
        if (newIdx >= 0) curIdx = newIdx;
      }
      renderList();
    });
    tdAction.appendChild(btn);
  } else if (!item.trackId && !isLyricsIssue) {
    tdAction.innerHTML = '<span class="no-trackid-tip">无法修复</span>';
    // 无法修复: 提供删除按钮(用户可选择删除或保留)
    tdAction.appendChild(buildDeleteBtn(item, idx));
  }

  tr.appendChild(tdCover);
  tr.appendChild(tdTitle);
  tr.appendChild(tdArtist);
  tr.appendChild(tdIssue);
  tr.appendChild(tdTrackId);
  tr.appendChild(tdStatus);
  tr.appendChild(tdAction);
  return tr;
}

// 更新单行
function updRepairRow(idx) {
  const oldTr = repairList.querySelector(`tr[data-idx="${idx}"]`);
  if (!oldTr) return;
  const item = _damagedList[idx];
  if (!item) return;
  const newTr = buildRepairRow(item, idx);
  oldTr.replaceWith(newTr);
}
