// =========== 汽水音乐歌单导入 - 批量导入 ===========
// 从 qishui-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域
// "导入全部": 自动拉完全歌单 (无需手动滚动), 顺序执行, 全程无人值守
// "导入选中": 基于表格勾选行
// 已有歌曲: 批量前用零带宽方式(歌名+歌手匹配歌库)预先标记并弹一次策略选择
//   (跳过已有 / 覆盖已有 / 取消), 选择对整次任务生效, 后续不再询问

const qsImportAll = $('qs-import-all');
const qsImportSelected = $('qs-import-selected');
const qsBatchStop = $('qs-batch-stop');
const qsCheckAll = $('qs-check-all');
const qsBatchModal = $('qs-batch-modal');
const qsBatchModalSub = $('qs-batch-modal-sub');
const qsBatchModalSkip = $('qs-batch-skip');
const qsBatchModalOverwrite = $('qs-batch-overwrite');
const qsBatchModalCancel = $('qs-batch-cancel');

// ---- 事件绑定 (DOM 由 import.html 同步注入, 此时已就绪) ----
qsCheckAll.addEventListener('change', () => {
  qsTrackList.querySelectorAll('.qs-row-check').forEach(cb => { cb.checked = qsCheckAll.checked; });
});
// 行勾选 → 反推全选框状态 (事件委托, 分批渲染的行无需逐条绑定)
qsTrackList.addEventListener('change', (e) => {
  if (e.target.classList && e.target.classList.contains('qs-row-check')) {
    const total = qsTrackList.querySelectorAll('.qs-row-check').length;
    const checked = qsTrackList.querySelectorAll('.qs-row-check:checked').length;
    qsCheckAll.checked = total > 0 && checked === total;
  }
});
qsImportAll.addEventListener('click', () => runQsBatchImport('all'));
qsImportSelected.addEventListener('click', () => runQsBatchImport('selected'));
qsBatchStop.addEventListener('click', () => { qsBatchAbort = true; });
qsBatchModalSkip.addEventListener('click', () => resolveQsBatchModal('skip'));
qsBatchModalOverwrite.addEventListener('click', () => resolveQsBatchModal('overwrite'));
qsBatchModalCancel.addEventListener('click', () => resolveQsBatchModal(null));

function qsSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 已有歌曲检测 (零带宽): 复用免费听模块的歌名+歌手匹配主歌库
function qsIsInLibrary(song) {
  return !!(typeof findLocalSongByFm === 'function' && findLocalSongByFm(song));
}

// 预标记已有歌曲行 (行内"已有"徽标, 便于视觉识别)
function qsMarkExistingRows(idxList) {
  idxList.forEach(idx => {
    const song = qsCurrentTracks[idx];
    if (!song || !qsIsInLibrary(song)) return;
    const row = qsTrackList.querySelector(`tr[data-idx="${idx}"]`);
    if (!row) return;
    const titleCell = row.querySelector('.col-title');
    if (titleCell && !titleCell.querySelector('.qs-existing-badge')) {
      const b = document.createElement('span');
      b.className = 'qs-existing-badge';
      b.textContent = '已有';
      titleCell.prepend(b);
    }
  });
}

// 自动拉完全歌单 (循环拉页直到 has_more 耗尽)
async function qsLoadFullPlaylist() {
  let guard = 0;
  while (qsHasMore && guard++ < 500) {
    qsProgress.classList.remove('hidden');
    qsProgressFill.style.width = '0%';
    qsProgressText.textContent = `正在拉取歌单全部数据... (已加载 ${qsCurrentTracks.length} 首)`;
    await fetchQsTracks();
    if (qsBatchAbort) return;
    await qsSleep(300);  // 限速, 避免服务端风控
  }
}

// 批量策略对话框: 返回 'skip' | 'overwrite' | null(取消)
let _qsBatchModalResolve = null;
function showQsBatchStrategyModal(existCount, total) {
  return new Promise(resolve => {
    _qsBatchModalResolve = resolve;
    qsBatchModalSub.textContent = `共 ${total} 首, 其中 ${existCount} 首已在歌库中。已存在的歌曲如何处理?`;
    qsBatchModal.classList.remove('hidden');
  });
}
function resolveQsBatchModal(result) {
  qsBatchModal.classList.add('hidden');
  const r = _qsBatchModalResolve;
  _qsBatchModalResolve = null;
  if (r) r(result);
}

// 运行中 UI 切换 (禁用批量按钮, 显示停止按钮)
function qsSetBatchUi(running) {
  qsImportAll.disabled = running;
  qsImportSelected.disabled = running;
  qsImportAll.textContent = running ? '导入中...' : '导入全部';
  qsImportSelected.textContent = running ? '导入中...' : '导入选中';
  qsBatchStop.classList.toggle('hidden', !running);
}

// 更新单行导入按钮状态
function qsSetRowStatus(idx, text, failed) {
  const row = qsTrackList.querySelector(`tr[data-idx="${idx}"]`);
  if (!row) return;
  const btn = row.querySelector('.qs-import-one');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = text;
  if (failed) {
    btn.classList.add('qs-btn-fail');
    btn.title = text;
  } else {
    btn.classList.remove('qs-btn-fail');
    btn.title = '';
  }
}

// 批量导入主流程
async function runQsBatchImport(mode) {
  if (qsBatchRunning) return;
  if (!qsSession) {
    if (typeof showToast === 'function') showToast('请先登录', 'error');
    return;
  }
  qsBatchRunning = true;
  qsBatchAbort = false;
  qsSetBatchUi(true);
  qsProgress.classList.remove('hidden');

  // 1. 全部模式: 先自动拉完整个歌单
  if (mode === 'all') {
    try { await qsLoadFullPlaylist(); } catch (e) {}  // 拉取异常时用已加载数据继续
  }

  // 2. 目标列表
  let targets = [];
  if (mode === 'selected') {
    qsTrackList.querySelectorAll('.qs-row-check:checked').forEach(cb => {
      const row = cb.closest('tr');
      if (row && row.dataset.idx !== undefined) targets.push(parseInt(row.dataset.idx));
    });
  } else {
    targets = qsCurrentTracks.map((_, i) => i);
  }
  // 排除单首导入已完成的行
  targets = targets.filter(i => {
    const row = qsTrackList.querySelector(`tr[data-idx="${i}"]`);
    const btn = row && row.querySelector('.qs-import-one');
    return !(btn && btn.textContent === '已导入');
  });
  if (!targets.length) {
    qsProgressText.textContent = mode === 'selected' ? '未勾选歌曲' : '歌单无歌曲';
    qsBatchRunning = false;
    qsSetBatchUi(false);
    qsProgress.classList.add('hidden');
    if (typeof showToast === 'function') showToast('没有可导入的歌曲', 'info');
    return;
  }

  // 3. 已有歌曲预检 + 一次性策略选择 (选择后对整次任务生效, 支持无人值守)
  qsMarkExistingRows(targets);
  let strategy = 'none';
  const existCount = targets.filter(i => qsIsInLibrary(qsCurrentTracks[i])).length;
  if (existCount > 0) {
    const choice = await showQsBatchStrategyModal(existCount, targets.length);
    if (choice === null || qsBatchAbort) {
      qsProgressText.textContent = '已取消';
      qsProgress.classList.add('hidden');
      qsBatchRunning = false;
      qsSetBatchUi(false);
      return;
    }
    strategy = choice;
  }

  // 4. 顺序执行
  const total = targets.length;
  let success = 0, skipped = 0, failed = 0;
  for (let n = 0; n < total; n++) {
    if (qsBatchAbort) break;
    const idx = targets[n];
    const song = qsCurrentTracks[idx];
    if (!song) { failed++; continue; }
    const title = qsGetTrackTitle(song);
    const exists = qsIsInLibrary(song);

    if (exists && strategy === 'skip') {
      skipped++;
      qsSetRowStatus(idx, '已跳过');
      qsProgressText.textContent = `[${n + 1}/${total}] 已有, 跳过: ${title}`;
      qsProgressFill.style.width = Math.round(((n + 1) / total) * 100) + '%';
      continue;
    }

    const trackId = qsGetTrackId(song);
    const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
    const vid = song.vid || song.videoId || '';
    if (!trackId && !vid) {
      failed++;
      qsSetRowStatus(idx, '缺ID', true);
      qsProgressText.textContent = `[${n + 1}/${total}] 缺少 trackId/vid, 无法导入: ${title}`;
      qsProgressFill.style.width = Math.round(((n + 1) / total) * 100) + '%';
      continue;
    }

    qsSetRowStatus(idx, '导入中');
    qsProgressText.textContent = `[${n + 1}/${total}] ${title}` + (exists ? ' (覆盖)' : '');
    try {
      const res = await window.qishuiAPI.importSong(
        qsSession.aid, qsSession.sessionid, trackId, QS_IMPORT_QUALITY, song, mediaType, vid
      );
      if (res && res.ok) {
        success++;
        qsSetRowStatus(idx, '已导入');
      } else {
        failed++;
        qsSetRowStatus(idx, '失败', true);
        const row = qsTrackList.querySelector(`tr[data-idx="${idx}"]`);
        if (row) {
          const btn = row.querySelector('.qs-import-one');
          if (btn) btn.title = (res && res.message) || '未知错误';
        }
      }
    } catch (e) {
      failed++;
      qsSetRowStatus(idx, '失败', true);
      const row = qsTrackList.querySelector(`tr[data-idx="${idx}"]`);
      if (row) {
        const btn = row.querySelector('.qs-import-one');
        if (btn) btn.title = e.message;
      }
    }
    qsProgressFill.style.width = Math.round(((n + 1) / total) * 100) + '%';
  }

  // 5. 一次性刷新歌库 (避免每首 O(n²) 全量扫描)
  if (success > 0 && typeof refreshMainLibrary === 'function') {
    try { await refreshMainLibrary(); } catch (e) {}
  }
  qsProgressText.textContent = `完成: 导入 ${success} 首, 跳过 ${skipped} 首, 失败 ${failed} 首`
    + (qsBatchAbort ? ' (已停止)' : '');
  qsBatchRunning = false;
  qsBatchAbort = false;
  qsSetBatchUi(false);
  if (typeof showToast === 'function') {
    showToast(`批量导入完成: 成功 ${success}, 跳过 ${skipped}, 失败 ${failed}`, failed > 0 ? 'error' : 'success');
  }
}
