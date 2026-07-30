// =========== 在线解析模块 ===========
// 粘贴汽水音乐分享链接(支持多行) → 解析 → 检查已存在 → 下载到 output/ 目录 → 刷新歌库
// 下载前若文件夹已存在, 弹出对话框让用户选择跳过/全部覆盖/选择性更新各项文件
// 支持"对剩余所有已存在歌曲应用相同决策", 避免逐个点击

let _parsedList = [];  // 当前解析结果列表 [{ status, info, exists, items, selected }]

// 状态标识
const PS_PARSING = 'parsing';      // 解析中
const PS_PARSED = 'parsed';        // 解析成功
const PS_EXISTS = 'exists';        // 已存在待确认
const PS_DOWNLOADING = 'downloading';
const PS_DONE = 'done';
const PS_SKIPPED = 'skipped';
const PS_FAILED = 'failed';

// 显示状态提示
function setParseStatus(msg, type) {
  if (!msg) { fmLinkStatus.classList.add('hidden'); return; }
  fmLinkStatus.classList.remove('hidden');
  fmLinkStatus.textContent = msg;
  fmLinkStatus.className = 'fm-link-status' + (type ? ' ' + type : '');
}

// 从多行文本提取所有 https:// 链接
function extractLinks(text) {
  const matches = String(text || '').match(/https:\/\/[^\s"'<>\\]+/g);
  return matches ? matches : [];
}

// 更新全选框状态
function updSelectAllState() {
  const downloadable = _parsedList.filter(i => i.status === PS_PARSED || i.status === PS_EXISTS || i.status === PS_DONE);
  if (downloadable.length === 0) {
    fmLinkSelectAll.classList.remove('checked');
    return;
  }
  const allSelected = downloadable.every(i => i.selected);
  fmLinkSelectAll.classList.toggle('checked', allSelected);
}

// 更新下载按钮文案
function updDownloadBtnText() {
  const selectedCount = _parsedList.filter(i => i.selected && (i.status === PS_PARSED || i.status === PS_EXISTS || i.status === PS_DONE)).length;
  fmLinkDownloadAllBtn.textContent = selectedCount > 0 ? `添加选中到歌库 (${selectedCount})` : '添加选中到歌库';
}

// 渲染解析结果列表(表格形式: 封面/歌曲名/作者/解析状态/词库状态)
function renderParseList() {
  fmLinkList.innerHTML = '';
  _parsedList.forEach((item, idx) => {
    fmLinkList.appendChild(buildParseRow(item, idx));
  });
  fmLinkListCount.textContent = `解析结果 (${_parsedList.length})`;
  updSelectAllState();
  updDownloadBtnText();
}

// 解析按钮 - 流式并发解析, 每完成一首立即更新表格对应行
fmLinkBtn.addEventListener('click', async () => {
  const text = fmLinkInput.value.trim();
  if (!text) { setParseStatus('请粘贴分享链接', 'error'); return; }

  const links = extractLinks(text);
  if (links.length === 0) { setParseStatus('未找到有效的 https:// 链接', 'error'); return; }
  const entries = links;

  fmLinkBtn.disabled = true;
  fmLinkBtn.textContent = '解析中...';
  fmLinkProgress.classList.add('hidden');

  // 初始化所有行为"解析中"状态
  _parsedList = entries.map((entry) => ({
    status: PS_PARSING,
    info: null,
    exists: false,
    items: null,
    message: null,
    selected: false,
    _input: entry,  // 保留原始链接字符串, 供单首重试
  }));
  renderParseList();
  fmLinkListWrap.classList.remove('hidden');
  setParseStatus(`正在解析 ${entries.length} 个项目... (0/${entries.length})`, 'info');

  // 移除旧的进度监听, 避免重复触发
  window.parseAPI.removeParseProgress();

  // 监听流式进度事件, 每完成一首就更新对应行
  window.parseAPI.onParseProgress(async (p) => {
    const item = _parsedList[p.idx];
    if (!item) return;

    if (p.ok) {
      // 解析成功: 先标记为已解析
      item.status = PS_PARSED;
      item.info = p.data;
      item.selected = true;

      // 立即更新该行显示(封面/标题/作者)
      updParseRow(p.idx);

      // 异步检查是否已存在
      const checkRes = await window.parseAPI.checkExists(p.data);
      if (checkRes.ok && checkRes.data.exists) {
        item.status = PS_EXISTS;
        item.exists = true;
        item.items = checkRes.data.items;
        item.folder = checkRes.data.folder;
      }
      updParseRow(p.idx);
    } else {
      // 解析失败
      item.status = PS_FAILED;
      item.message = p.message;
      updParseRow(p.idx);
    }

    // 更新状态提示
    const okCount = _parsedList.filter(i => i.status === PS_PARSED || i.status === PS_EXISTS).length;
    const failCount = _parsedList.filter(i => i.status === PS_FAILED).length;
    const parsingCount = _parsedList.filter(i => i.status === PS_PARSING).length;
    if (parsingCount > 0) {
      setParseStatus(`正在解析... (${p.done}/${p.total}) 成功 ${okCount} 失败 ${failCount}`, 'info');
    } else {
      const msg = failCount > 0
        ? `解析完成: 成功 ${okCount} 首, 失败 ${failCount} 首`
        : `解析完成: 成功 ${okCount} 首`;
      setParseStatus(msg, failCount > 0 ? 'info' : 'success');
    }
    updSelectAllState();
    updDownloadBtnText();
  });

  // 启动流式解析: 走分享链接
  await window.parseAPI.parseStream(entries);

  fmLinkBtn.disabled = false;
  fmLinkBtn.textContent = '解析';
});

// 更新单行(根据 idx 找到对应 tr 重新渲染)
function updParseRow(idx) {
  const tbody = fmLinkList;
  const oldTr = tbody.querySelector(`tr[data-idx="${idx}"]`);
  if (!oldTr) return;

  // 用 renderParseList 的逻辑生成新行, 然后替换
  const tmp = document.createElement('tbody');
  tmp.innerHTML = '';
  const item = _parsedList[idx];
  // 内联构建(避免整体重渲染影响性能)
  const tr = buildParseRow(item, idx);
  oldTr.replaceWith(tr);
}

// 构建单行 tr(从 renderParseList 提取, 供逐行更新使用)
function buildParseRow(item, idx) {
  const tr = document.createElement('tr');
  tr.className = 'parse-row';
  tr.dataset.idx = idx;
  const canSelect = (item.status === PS_PARSED || item.status === PS_EXISTS || item.status === PS_DONE);
  if (item.selected && canSelect) tr.classList.add('selected');
  if (item.status === PS_PARSING) tr.classList.add('parsing');

  const tdCover = document.createElement('td');
  tdCover.className = 'col-cover';
  const cb = document.createElement('div');
  cb.className = 'pmi-checkbox pi-checkbox';
  if (item.selected && canSelect) cb.classList.add('checked');
  cb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  tdCover.appendChild(cb);

  const cover = document.createElement('div');
  cover.className = 'pi-cover';
  if (item.info && item.info.cover) {
    const img = document.createElement('img');
    img.src = item.info.cover;
    img.alt = '';
    cover.appendChild(img);
  } else {
    cover.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  // 已下载到歌库的歌曲: 点击封面直接播放
  if (item.status === PS_DONE && item.audioPath) {
    cover.classList.add('playable');
    cover.title = '点击播放';
    cover.addEventListener('click', async (e) => {
      e.stopPropagation();
      // 刷新歌库并通过 audioPath 定位歌曲
      songs = await window.musicAPI.getSongs();
      const playIdx = songs.findIndex(s => s.audioPath === item.audioPath);
      if (playIdx >= 0) {
        showPlayerView();
        navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'home'));
        currentView = 'home';
        play(playIdx);
      }
    });
  }
  tdCover.appendChild(cover);

  const tdTitle = document.createElement('td');
  tdTitle.className = 'col-title';
  tdTitle.textContent = (item.info && item.info.title) || (item.status === PS_PARSING ? '解析中...' : '未知歌曲');

  const tdArtist = document.createElement('td');
  tdArtist.className = 'col-artist';
  tdArtist.textContent = (item.info && item.info.artist) || (item.status === PS_PARSING ? '' : '未知歌手');

  const tdParse = document.createElement('td');
  tdParse.className = 'col-parse-status';
  const parseStatusText = {
    [PS_PARSING]: '解析中',
    [PS_PARSED]: '已解析',
    [PS_EXISTS]: '已解析',
    [PS_DOWNLOADING]: '下载中',
    [PS_DONE]: '已添加',
    [PS_SKIPPED]: '已跳过',
    [PS_FAILED]: '失败·点击重试',
  }[item.status] || '未解析';
  tdParse.innerHTML = `<span class="pi-status ${item.status === PS_FAILED ? 'retry' : ''}" data-status="${item.status}">${parseStatusText}</span>`;
  if (item.status === PS_FAILED) {
    tdParse.querySelector('.pi-status.retry').addEventListener('click', (e) => {
      e.stopPropagation();
      retryParseOne(idx);
    });
  }

  const tdLib = document.createElement('td');
  tdLib.className = 'col-lib-status';
  const libExists = item.exists === true || item.status === PS_EXISTS || item.status === PS_DONE;
  tdLib.innerHTML = `<span class="lib-status ${libExists ? 'have' : 'missing'}">${libExists ? '已拥有' : '未拥有'}</span>`;

  tr.appendChild(tdCover);
  tr.appendChild(tdTitle);
  tr.appendChild(tdArtist);
  tr.appendChild(tdParse);
  tr.appendChild(tdLib);

  tr.addEventListener('click', () => {
    if (!canSelect) return;
    item.selected = !item.selected;
    cb.classList.toggle('checked', item.selected);
    tr.classList.toggle('selected', item.selected);
    updSelectAllState();
    updDownloadBtnText();
  });

  return tr;
}

// 重新解析单首(失败后点击重试)
async function retryParseOne(idx) {
  const item = _parsedList[idx];
  if (!item || !item._input) return;

  // 标记为解析中并立即更新
  item.status = PS_PARSING;
  item.info = null;
  item.exists = false;
  item.items = null;
  item.message = null;
  item.selected = false;
  updParseRow(idx);

  try {
    // 链接模式: 直接调 parse-music-link
    const res = await window.parseAPI.parse(item._input);

    if (res.ok) {
      item.status = PS_PARSED;
      item.info = res.data;
      item.selected = true;
      updParseRow(idx);

      // 异步检查是否已存在
      const checkRes = await window.parseAPI.checkExists(res.data);
      if (checkRes.ok && checkRes.data.exists) {
        item.status = PS_EXISTS;
        item.exists = true;
        item.items = checkRes.data.items;
        item.folder = checkRes.data.folder;
        updParseRow(idx);
      }
    } else {
      item.status = PS_FAILED;
      item.message = res.message;
      updParseRow(idx);
    }
  } catch (e) {
    item.status = PS_FAILED;
    item.message = e.message;
    updParseRow(idx);
  }
  updSelectAllState();
  updDownloadBtnText();
}

// 回车快捷解析
fmLinkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    fmLinkBtn.click();
  }
});

// 全选/全不选
fmLinkSelectAll.addEventListener('click', () => {
  const downloadable = _parsedList.filter(i => i.status === PS_PARSED || i.status === PS_EXISTS);
  if (downloadable.length === 0) return;
  const allSelected = downloadable.every(i => i.selected);
  downloadable.forEach(i => { i.selected = !allSelected; });
  renderParseList();
});

// =========== 覆盖确认对话框 ===========
let _modalResolve = null;  // 当前对话框的 resolve
let _modalCheckboxes = {};  // 各项的勾选状态

function showOverwriteModal(folder, items) {
  return new Promise((resolve) => {
    _modalResolve = resolve;
    parseModalSub.textContent = `${folder}`;
    parseModalItems.innerHTML = '';
    parseModalApplyAll.checked = false;
    parseModalApplyAll.parentElement.style.display = '';

    // 各项配置: 名称 + 中文标签 + 状态描述
    const itemConfig = [
      { key: 'audio', label: '音频文件', desc: '歌曲音频(AAC/M4A/MP3)' },
      { key: 'cover', label: '封面图片', desc: 'cover.jpg/png' },
      { key: 'lrc', label: '歌词文件', desc: 'LRC 标准歌词' },
      { key: 'info', label: '信息文件', desc: 'info.json 元数据' },
      { key: 'krc', label: '轨道数据', desc: 'lyrics_krc.json 逐字歌词数据' },
    ];

    _modalCheckboxes = {};
    itemConfig.forEach(cfg => {
      const it = items[cfg.key];
      // 默认勾选有差异的项; 完全相同的项默认不勾选
      const checked = it && it.diff;
      _modalCheckboxes[cfg.key] = checked;

      const li = document.createElement('li');
      li.className = 'pmi-item' + (checked ? ' checked' : '');

      const cb = document.createElement('div');
      cb.className = 'pmi-checkbox';
      cb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

      const label = document.createElement('div');
      label.className = 'pmi-label';
      label.innerHTML = `<div class="pmi-name"></div><div class="pmi-desc"></div>`;
      label.querySelector('.pmi-name').textContent = cfg.label;
      label.querySelector('.pmi-desc').textContent = cfg.desc;

      const status = document.createElement('div');
      status.className = 'pmi-status';
      if (!it || (!it.hasOld && !it.hasNew)) {
        status.textContent = '无';
        status.dataset.state = 'none';
      } else if (!it.hasOld) {
        status.textContent = '新增';
        status.dataset.state = 'new';
      } else if (!it.diff) {
        status.textContent = '相同';
        status.dataset.state = 'same';
      } else {
        status.textContent = '不同';
        status.dataset.state = 'diff';
      }

      li.appendChild(cb);
      li.appendChild(label);
      li.appendChild(status);

      // 点击切换勾选
      li.addEventListener('click', () => {
        _modalCheckboxes[cfg.key] = !_modalCheckboxes[cfg.key];
        li.classList.toggle('checked', _modalCheckboxes[cfg.key]);
      });

      parseModalItems.appendChild(li);
    });

    parseModal.classList.remove('hidden');
  });
}

function closeOverwriteModal() {
  parseModal.classList.add('hidden');
  const r = _modalResolve;
  _modalResolve = null;
  return r;
}

function getModalResult(action) {
  const overwrite = {
    audio: !!_modalCheckboxes.audio,
    cover: !!_modalCheckboxes.cover,
    lrc: !!_modalCheckboxes.lrc,
    info: !!_modalCheckboxes.info,
  };
  const applyAll = parseModalApplyAll.checked;
  return { action, overwrite, applyAll };
}

// 跳过
parseModalSkip.addEventListener('click', () => {
  const r = closeOverwriteModal();
  if (r) r(getModalResult('skip'));
});

// 全部覆盖
parseModalOverwriteAll.addEventListener('click', () => {
  // 强制设置全部勾选
  _modalCheckboxes = { audio: true, cover: true, lrc: true, info: true };
  const r = closeOverwriteModal();
  if (r) r(getModalResult('overwrite'));
});

// 确认更新选中项
parseModalConfirm.addEventListener('click', () => {
  const r = closeOverwriteModal();
  if (r) r(getModalResult('selective'));
});

// 下载进度回调
window.parseAPI.onDownloadProgress((p) => {
  const stageNames = { audio: '音频', cover: '封面', lrc: '歌词', info: '信息' };
  fmLinkProgressText.textContent = `${stageNames[p.stage] || p.stage} 下载中...`;
  fmLinkProgressFill.style.width = p.pct + '%';
});

// 下载单首歌(自动处理已存在对话框)
// batchDecision: 缓存的批量决策 { action, overwrite } (applyAll 触发后缓存, 后续直接使用)
async function downloadOneSong(item, batchDecision) {
  let overwrite = null;
  let nextBatchDecision = batchDecision;

  if (item.exists && item.items) {
    if (batchDecision) {
      // 已有批量决策, 直接应用
      if (batchDecision.action === 'skip') {
        item.status = PS_SKIPPED;
        renderParseList();
        return { skipped: true, batchDecision };
      }
      overwrite = batchDecision.overwrite;
      // 如果用户全部不勾选且点了"确认更新", 也视为跳过
      if (batchDecision.action === 'selective' && !overwrite.audio && !overwrite.cover && !overwrite.lrc && !overwrite.info) {
        item.status = PS_SKIPPED;
        renderParseList();
        return { skipped: true, batchDecision };
      }
    } else {
      // 首次弹出对话框让用户选择
      const result = await showOverwriteModal(item.folder, item.items);
      if (!result) {
        item.status = PS_SKIPPED;
        renderParseList();
        return { skipped: true, batchDecision };
      }
      // 如果用户勾选了"应用到所有", 缓存决策
      if (result.applyAll) {
        nextBatchDecision = { action: result.action, overwrite: result.overwrite };
      }
      if (result.action === 'skip') {
        item.status = PS_SKIPPED;
        renderParseList();
        return { skipped: true, batchDecision: nextBatchDecision };
      }
      overwrite = result.overwrite;
      if (result.action === 'selective' && !overwrite.audio && !overwrite.cover && !overwrite.lrc && !overwrite.info) {
        item.status = PS_SKIPPED;
        renderParseList();
        return { skipped: true, batchDecision: nextBatchDecision };
      }
    }
  }

  item.status = PS_DOWNLOADING;
  renderParseList();
  fmLinkProgress.classList.remove('hidden');
  fmLinkProgressFill.style.width = '0%';
  fmLinkProgressText.textContent = `下载: ${item.info.title} - ${item.info.artist}`;

  const res = await window.parseAPI.download(item.info, overwrite);

  if (!res.ok) {
    item.status = PS_FAILED;
    item.message = res.message;
    renderParseList();
    return { skipped: false, failed: true, message: res.message, batchDecision: nextBatchDecision };
  }

  item.status = PS_DONE;
  item.folder = res.data.folder;
  item.audioPath = res.data.audioPath;  // 保存路径供点击封面播放
  renderParseList();
  return { skipped: false, failed: false, data: res.data, batchDecision: nextBatchDecision };
}

// 添加选中到歌库按钮
fmLinkDownloadAllBtn.addEventListener('click', async () => {
  const toDownload = _parsedList.filter(i => i.selected && (i.status === PS_PARSED || i.status === PS_EXISTS));
  if (toDownload.length === 0) {
    setParseStatus('请先勾选要添加的歌曲', 'error');
    return;
  }

  fmLinkDownloadAllBtn.disabled = true;
  fmLinkDownloadAllBtn.textContent = '下载中...';
  fmLinkSelectAll.style.pointerEvents = 'none';
  // 显示主动刷新按钮: 下载过程中用户可随时刷新歌库查看已下载的歌曲
  fmLinkRefreshLibraryBtn.classList.remove('hidden');

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let needRefresh = false;
  let batchDecision = null;  // 批量覆盖决策缓存

  for (const item of _parsedList) {
    if (!item.selected) continue;
    if (item.status === PS_DONE || item.status === PS_SKIPPED || item.status === PS_FAILED) continue;

    const result = await downloadOneSong(item, batchDecision);
    // 更新批量决策缓存(首次对话框时可能被设置)
    if (result.batchDecision) batchDecision = result.batchDecision;

    if (result.skipped) skipped++;
    else if (result.failed) failed++;
    else { downloaded++; needRefresh = true; }
  }

  fmLinkDownloadAllBtn.disabled = false;
  fmLinkDownloadAllBtn.textContent = '添加选中到歌库';
  fmLinkSelectAll.style.pointerEvents = '';
  fmLinkRefreshLibraryBtn.classList.add('hidden');

  // 刷新歌库: 重新扫描并保持当前播放位置
  if (needRefresh) {
    await refreshLibraryFromParse();
  }

  const parts = [];
  if (downloaded) parts.push(`已添加 ${downloaded}`);
  if (skipped) parts.push(`已跳过 ${skipped}`);
  if (failed) parts.push(`失败 ${failed}`);
  setParseStatus(parts.length ? parts.join('，') : '无新歌曲需要下载', failed > 0 ? 'info' : 'success');

  // 下载完成后隐藏进度条, 避免留下空白区域
  fmLinkProgress.classList.add('hidden');
});

// 刷新歌库(保持当前播放位置): 供下载过程中主动刷新和下载完成后复用
async function refreshLibraryFromParse() {
  const curAudioPath = (curIdx >= 0 && songs[curIdx]) ? songs[curIdx].audioPath : null;
  const songList = await window.musicAPI.getSongs();
  songs = songList;
  if (curAudioPath) {
    const newIdx = songs.findIndex(s => s.audioPath === curAudioPath);
    if (newIdx >= 0) curIdx = newIdx;
  }
  renderList();
  renderFloatList();
  updCur();
}

// 主动刷新歌库按钮: 下载过程中用户可随时点击查看已下载的歌曲
fmLinkRefreshLibraryBtn.addEventListener('click', async () => {
  fmLinkRefreshLibraryBtn.disabled = true;
  fmLinkRefreshLibraryBtn.textContent = '刷新中...';
  try {
    await refreshLibraryFromParse();
  } catch (e) {}
  fmLinkRefreshLibraryBtn.disabled = false;
  fmLinkRefreshLibraryBtn.textContent = '刷新歌库';
});

// 切换到链接解析视图: 切换到免费听音乐视图并激活"链接解析"标签
function showParseView() {
  // 激活免费听音乐导航项
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === 'free-music'));
  currentView = 'free-music';
  // 显示免费听音乐视图
  if (typeof showFreeMusicView === 'function') {
    showFreeMusicView();
  } else {
    hideAllViews();
    viewFreeMusic.classList.remove('hidden');
  }
  // 激活"链接解析"标签面板
  const linkTab = document.querySelector('[data-fm-mode="link"]');
  const searchTab = document.querySelector('[data-fm-mode="search"]');
  if (linkTab) linkTab.classList.add('active');
  if (searchTab) searchTab.classList.remove('active');
  const linkPanel = document.getElementById('fm-link-panel');
  const searchPanel = document.getElementById('fm-search-panel');
  if (linkPanel) linkPanel.classList.remove('hidden');
  if (searchPanel) searchPanel.classList.add('hidden');
  // 开关开启时保留渐变背景跟随封面
  refreshCoverBackground();
}
