// =========== 歌单分享与导入 (wuu:// 协议) ===========
// 从 renderer/modules/playlist-share.js 加载, 通过 <script> 标签顺序加载, 共享全局作用域

// DOM 引用 (在 dom.js 之后加载, 使用 $ 快捷方式)
// 这些元素从 fragments/playlist.html 注入到 #view-playlist-share 容器

function initPlaylistShare() {
  // 防止重复绑定
  if (window._plInited) return;
  window._plInited = true;

  var plExportSources = $('pl-export-sources');
  var plExportBtn = $('pl-export-btn');
  var plExportName = $('pl-export-name');
  var plExportWarn = $('pl-export-warn');
  var plExportResult = $('pl-export-result');
  var plShareLink = $('pl-share-link');
  var plShareKey = $('pl-share-key');
  var plCopyLink = $('pl-copy-link');
  var plCopyKey = $('pl-copy-key');
  var plExportCrt = $('pl-export-crt');
  var plServerInfo = $('pl-server-info');
  var plImportLink = $('pl-import-link');
  var plImportKey = $('pl-import-key');
  var plParseBtn = $('pl-parse-btn');
  var plImportStatus = $('pl-import-status');
  var plImportListWrap = $('pl-import-list-wrap');
  var plPlaylistName = $('pl-playlist-name');
  var plImportList = $('pl-import-list');
  var plCheckAll = $('pl-check-all');
  var plDownloadAll = $('pl-download-all');
  var plDownloadCount = $('pl-download-count');
  var plProgressWrap = $('pl-progress-wrap');
  var plProgressFill = $('pl-progress-fill');
  var plProgressText = $('pl-progress-text');
  // 新增: 有效期 + 次数选项 + 导出 modal + 已分享卡片列表 + 懒加载 sentinel
  var plExpireOptions = $('pl-expire-options');
  var plUsesOptions = $('pl-uses-options');
  var plExportModal = $('pl-export-modal');
  var plModalSummary = $('pl-modal-summary');
  var plModalStatus = $('pl-modal-status');
  var plModalCancel = $('pl-modal-cancel');
  var plModalConfirm = $('pl-modal-confirm');
  var plRefreshShared = $('pl-refresh-shared');
  var plSharedList = $('pl-shared-list');
  var plSharedEmpty = $('pl-shared-empty');
  var plSharedSentinel = $('pl-shared-sentinel');
  var plServerBadge = $('pl-server-badge');
  // 重构后的 modal 结构: 配置态 / 结果态切换
  var plModalConfig = $('pl-modal-config');
  var plModalActionsConfig = $('pl-modal-actions-config');
  var plModalActionsResult = $('pl-modal-actions-result');
  var plModalDestroy = $('pl-modal-destroy');
  var plModalDone = $('pl-modal-done');
  var plImportCrtBtn = $('pl-import-crt-btn');

  var plParsedSongs = [];
  // 保存最近一次导出的密钥和歌单名, 用于 CRT 导出
  var plLastKey = '';
  var plLastName = '';
  // 用户选择的有效期 (毫秒) + 最大次数, 必填, 默认 -1 表示未选
  var plSelectedExpire = -1;
  var plSelectedUses = -1;
  // 已分享卡片列表分页: 每页 10 条, 滚动到底部自动加载下一页
  var SHARED_PAGE_SIZE = 10;
  var plSharedRecords = [];   // 全量记录缓存
  var plSharedRendered = 0;   // 已渲染数量
  var plSharedObserver = null; // IntersectionObserver 实例

  // === 导出: 快捷选择来源 ===
  // 快选项: "全部歌曲" + 各收藏歌单, 点击切换选中/取消
  var plSelectedSources = new Set(); // 存放选中的 source id: 'all' 或 collection.id

  function buildExportSources() {
    plExportSources.innerHTML = '';
    plSelectedSources.clear();
    // "全部歌曲" 快选项
    var allChip = document.createElement('div');
    allChip.className = 'pl-source-chip';
    allChip.dataset.source = 'all';
    allChip.innerHTML = '<span class="pl-chip-name">全部歌曲</span>'
      + '<span class="pl-chip-count">' + songs.length + '</span>';
    allChip.addEventListener('click', () => toggleChip(allChip));
    plExportSources.appendChild(allChip);
    // 各收藏歌单快选项
    var colls = (typeof getAllCollections === 'function') ? getAllCollections() : [];
    colls.forEach(c => {
      var chip = document.createElement('div');
      chip.className = 'pl-source-chip';
      chip.dataset.source = c.id;
      chip.dataset.collName = c.name;
      var count = (typeof getCollectionSongs === 'function') ? getCollectionSongs(c.id).length : c.songs.size;
      chip.innerHTML = '<span class="pl-chip-name">' + escapePlHtml(c.name) + '</span>'
        + '<span class="pl-chip-count">' + count + '</span>';
      chip.addEventListener('click', () => toggleChip(chip));
      plExportSources.appendChild(chip);
    });
    updateExportBtnState();
  }

  function toggleChip(chip) {
    var src = chip.dataset.source;
    if (plSelectedSources.has(src)) {
      plSelectedSources.delete(src);
      chip.classList.remove('selected');
    } else {
      plSelectedSources.add(src);
      chip.classList.add('selected');
    }
    updateExportBtnState();
  }

  // 收集选中的歌曲(去重)
  function collectSelectedSongs() {
    var songSet = new Set();
    var songList = [];
    plSelectedSources.forEach(src => {
      var subset;
      if (src === 'all') {
        subset = songs;
      } else {
        subset = (typeof getCollectionSongs === 'function') ? getCollectionSongs(src) : [];
      }
      subset.forEach(s => {
        if (!songSet.has(s.audioPath)) {
          songSet.add(s.audioPath);
          songList.push(s);
        }
      });
    });
    return songList;
  }

  // 自动生成歌单名称
  function autoGenName(songList) {
    var names = [];
    plSelectedSources.forEach(src => {
      if (src === 'all') names.push('全部歌曲');
      else {
        var chip = plExportSources.querySelector('[data-source="' + src + '"]');
        if (chip) names.push(chip.dataset.collName || '歌单');
      }
    });
    if (names.length === 1) return names[0];
    return names.join(' + ');
  }

  // 暴露为全局, 便于 showPlaylistShareView 每次进入视图时刷新 chip
  // (收藏歌单变化后 chip 计数/列表需更新)
  window.buildExportSources = buildExportSources;
  buildExportSources();

  // === 有效期 chip: 单选 (在 modal 内选择) ===
  function selectExpireChip(btn) {
    plExpireOptions.querySelectorAll('.pl-chip').forEach(c => c.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
      plSelectedExpire = parseInt(btn.dataset.expire, 10) || 0;
    } else {
      plSelectedExpire = -1;
    }
    updateModalConfirmState();
  }
  plExpireOptions.querySelectorAll('.pl-chip').forEach(c => {
    c.addEventListener('click', () => selectExpireChip(c));
  });

  // === 访问次数 chip: 单选 (在 modal 内选择) ===
  function selectUsesChip(btn) {
    plUsesOptions.querySelectorAll('.pl-chip').forEach(c => c.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
      plSelectedUses = parseInt(btn.dataset.uses, 10) || 0;
    } else {
      plSelectedUses = -1;
    }
    updateModalConfirmState();
  }
  plUsesOptions.querySelectorAll('.pl-chip').forEach(c => {
    c.addEventListener('click', () => selectUsesChip(c));
  });

  // 生成按钮启用条件: 选了来源即可 (有效期 + 次数在弹出的 modal 中选择)
  function updateExportBtnState() {
    var hasSongs = plSelectedSources.size > 0;
    plExportBtn.disabled = !hasSongs;
    if (!hasSongs) plExportWarn.classList.add('hidden');
  }

  // 重写 buildExportSources 末尾的按钮状态更新 (兼容旧调用)
  var _origBuild = buildExportSources;
  buildExportSources = function() {
    _origBuild();
    updateExportBtnState();
  };
  window.buildExportSources = buildExportSources;

  // === 导出: 打开二级菜单 (in-app modal) 的统一入口 ===
  // 供 plExportBtn (歌单分享页) 和 btnShare (主页分享按钮) 共同调用
  function openPlExportModal(name, songList) {
    // 在 modal 概要区显示已选内容
    plModalSummary.textContent = '将分享 "' + name + '" · 共 ' + songList.length + ' 首';
    // 重置 modal 到配置态
    plSelectedExpire = -1;
    plSelectedUses = -1;
    if (plExpireOptions) plExpireOptions.querySelectorAll('.pl-chip').forEach(c => c.classList.remove('active'));
    if (plUsesOptions) plUsesOptions.querySelectorAll('.pl-chip').forEach(c => c.classList.remove('active'));
    plModalConfirm.disabled = true;
    plModalConfirm.textContent = '确认生成';
    plModalStatus.classList.add('hidden');
    plModalStatus.className = 'qs-status hidden';
    // 显示配置区 + 配置态按钮, 隐藏结果区 + 结果态按钮
    if (plModalConfig) plModalConfig.classList.remove('hidden');
    if (plModalActionsConfig) plModalActionsConfig.classList.remove('hidden');
    plExportResult.classList.add('hidden');
    if (plModalActionsResult) plModalActionsResult.classList.add('hidden');
    // 重置销毁按钮状态 (取消二次确认状态)
    if (plModalDestroy) {
      plModalDestroy.textContent = '销毁此分享';
      plModalDestroy.classList.remove('confirm-pending');
      plModalDestroy.disabled = false;
    }
    // 暂存待生成参数 (供 modal 确认按钮使用)
    plExportModal._pendingName = name;
    plExportModal._pendingSongs = songList;
    plExportModal._lastCreatedId = null;
    plExportModal.classList.remove('hidden');
  }
  // 暴露给全局, 主页 btnShare 可直接调用
  window.openPlExportModal = openPlExportModal;

  // === 导出: 点击「生成分享链接」打开二级菜单 (in-app modal) ===
  plExportBtn.addEventListener('click', async () => {
    // 检查服务器是否已开启
    var st = await window.playlistAPI.serverStatus();
    if (!st.ok || !st.running) {
      plExportWarn.textContent = '网络服务未开启, 请先在设置中开启歌单分享服务';
      plExportWarn.classList.remove('hidden');
      return;
    }
    plExportWarn.classList.add('hidden');
    var songList = collectSelectedSongs();
    if (!songList.length) { alert('没有可导出的歌曲'); return; }
    var name = plExportName.value.trim() || autoGenName(songList);
    openPlExportModal(name, songList);
  });

  // modal 内: chip 选择变化时更新确认按钮状态
  function updateModalConfirmState() {
    var hasExpire = plSelectedExpire >= 0;
    var hasUses = plSelectedUses >= 0;
    plModalConfirm.disabled = !(hasExpire && hasUses);
  }

  // modal 取消按钮
  plModalCancel.addEventListener('click', () => {
    plExportModal.classList.add('hidden');
  });

  // modal 确认生成按钮: 真正调用 exportPlaylist
  // 生成成功后切换到结果态: 隐藏配置区 + 配置态按钮, 显示结果区 + 结果态按钮
  plModalConfirm.addEventListener('click', async () => {
    if (plSelectedExpire < 0 || plSelectedUses < 0) return;
    var name = plExportModal._pendingName;
    var songList = plExportModal._pendingSongs;
    if (!songList || !songList.length) return;
    var expireAt = plSelectedExpire === 0 ? 0 : (Date.now() + plSelectedExpire);
    var maxUses = plSelectedUses;
    plModalConfirm.disabled = true;
    plModalConfirm.textContent = '生成中...';
    plModalStatus.textContent = '正在生成分享链接...';
    plModalStatus.className = 'qs-status info';
    plModalStatus.classList.remove('hidden');
    try {
      // 对外地址: 手动模式且填入了地址时, 把 publicHost 传给主进程用于生成链接
      // 自动模式传空字符串, 主进程会自动获取本机 IP
      var publicHost = '';
      if (typeof appSettings !== 'undefined'
          && appSettings.publicHostMode === 'manual'
          && appSettings.publicHost) {
        publicHost = appSettings.publicHost.trim();
      }
      // 远程端口: frp 转发等场景下远程端口可能与本地服务端口不同
      // 0 表示使用本地服务端口
      var publicPort = 0;
      if (typeof appSettings !== 'undefined' && appSettings.publicPort > 0) {
        publicPort = appSettings.publicPort;
      }
      var result = await window.playlistAPI.exportPlaylist(name, songList, expireAt, maxUses, publicHost, publicPort);
      if (result.ok) {
        plShareLink.value = result.shareLink;
        plShareKey.value = result.key;
        plLastKey = result.key;
        plLastName = name;
        var expireText = expireAt === 0 ? '永久' : new Date(expireAt).toLocaleString();
        var usesText = maxUses === 0 ? '不限' : (maxUses + ' 次');
        plServerInfo.textContent = '本机 ' + result.host + ':' + result.port + ' · ' + songList.length + ' 首 · 有效期 ' + expireText + ' · ' + usesText;
        // 切换到结果态: 隐藏配置区 + 配置态按钮
        if (plModalConfig) plModalConfig.classList.add('hidden');
        if (plModalActionsConfig) plModalActionsConfig.classList.add('hidden');
        plModalStatus.classList.add('hidden');
        plModalStatus.className = 'qs-status hidden';
        // 显示结果区 + 结果态按钮
        plExportResult.classList.remove('hidden');
        if (plModalActionsResult) plModalActionsResult.classList.remove('hidden');
        // 记录本次创建的歌单 id (供"销毁此分享"按钮使用)
        plExportModal._lastCreatedId = result.id;
        // 重置销毁按钮
        if (plModalDestroy) {
          plModalDestroy.textContent = '销毁此分享';
          plModalDestroy.classList.remove('confirm-pending');
          plModalDestroy.disabled = false;
        }
        // 生成成功后立即刷新已分享列表
        refreshSharedList();
      } else {
        plModalStatus.textContent = '生成失败: ' + result.message;
        plModalStatus.className = 'qs-status error';
        plModalStatus.classList.remove('hidden');
        plModalConfirm.disabled = false;
        plModalConfirm.textContent = '确认生成';
      }
    } catch (e) {
      plModalStatus.textContent = '生成失败: ' + e.message;
      plModalStatus.className = 'qs-status error';
      plModalStatus.classList.remove('hidden');
      plModalConfirm.disabled = false;
      plModalConfirm.textContent = '确认生成';
    }
  });

  // === 结果态: "完成" 按钮 - 仅关闭 modal ===
  if (plModalDone) {
    plModalDone.addEventListener('click', () => {
      plExportModal.classList.add('hidden');
    });
  }

  // === 结果态: "销毁此分享" 按钮 - 内联二次确认 (不弹独立窗口) ===
  // 第一次点击: 按钮变为"确认销毁?" 红色, 3 秒内再次点击才真正销毁
  if (plModalDestroy) {
    var _destroyConfirmTimer = null;
    plModalDestroy.addEventListener('click', async () => {
      // 第一次点击: 进入二次确认状态
      if (!plModalDestroy.classList.contains('confirm-pending')) {
        plModalDestroy.classList.add('confirm-pending');
        plModalDestroy.textContent = '确认销毁?';
        if (_destroyConfirmTimer) clearTimeout(_destroyConfirmTimer);
        _destroyConfirmTimer = setTimeout(() => {
          plModalDestroy.classList.remove('confirm-pending');
          plModalDestroy.textContent = '销毁此分享';
          plModalDestroy.disabled = false;
        }, 3000);
        return;
      }
      // 第二次点击: 真正销毁
      if (_destroyConfirmTimer) { clearTimeout(_destroyConfirmTimer); _destroyConfirmTimer = null; }
      var id = plExportModal._lastCreatedId;
      if (!id) {
        plExportModal.classList.add('hidden');
        return;
      }
      plModalDestroy.disabled = true;
      plModalDestroy.textContent = '销毁中...';
      try {
        var r = await window.playlistAPI.deleteSharedPlaylist(id);
        if (r.ok) {
          plExportModal.classList.add('hidden');
          refreshSharedList();
        } else {
          plModalDestroy.textContent = '失败: ' + (r.message || '未知错误');
          setTimeout(() => {
            plModalDestroy.classList.remove('confirm-pending');
            plModalDestroy.textContent = '销毁此分享';
            plModalDestroy.disabled = false;
          }, 2000);
        }
      } catch (err) {
        plModalDestroy.textContent = '失败: ' + err.message;
        setTimeout(() => {
          plModalDestroy.classList.remove('confirm-pending');
          plModalDestroy.textContent = '销毁此分享';
          plModalDestroy.disabled = false;
        }, 2000);
      }
    });
  }

  // === 已分享列表: 拉取并渲染 ===
  function formatExpireText(record) {
    if (!record.expireAt || record.expireAt === 0) return '永久';
    var d = new Date(record.expireAt);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function formatCreatedText(record) {
    if (!record.createdAt) return '';
    var d = new Date(record.createdAt);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function formatUsesText(record) {
    if (!record.maxUses || record.maxUses === 0) return (record.usedCount || 0) + '/∞';
    return (record.usedCount || 0) + '/' + record.maxUses;
  }
  function statusBadge(record) {
    var now = Date.now();
    if (record.expireAt && record.expireAt > 0 && now > record.expireAt) {
      return '<span class="pl-status-badge pl-status-expired">已过期</span>';
    }
    if (record.maxUses && record.maxUses > 0 && (record.usedCount || 0) >= record.maxUses) {
      return '<span class="pl-status-badge pl-status-exhausted">已用完</span>';
    }
    return '<span class="pl-status-badge pl-status-active">有效</span>';
  }
  function escapePlHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 渲染单张分享卡片 (供分批渲染调用)
  function buildSharedCard(r) {
    var card = document.createElement('div');
    card.className = 'pl-shared-card';
    card.dataset.id = r.id;
    var songCount = r.songCount || 0;
    var metaText = songCount + ' 首 · ' + formatExpireText(r) + ' · ' + formatUsesText(r) + ' · ' + formatCreatedText(r);
    card.innerHTML =
      '<div class="pl-shared-card-header" data-id="' + r.id + '">'
      +   '<span class="pl-shared-card-name" title="' + escapePlHtml(r.name) + '">' + escapePlHtml(r.name) + '</span>'
      +   statusBadge(r)
      +   '<span class="pl-shared-card-meta">' + escapePlHtml(metaText) + '</span>'
      +   '<svg class="pl-shared-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
      + '</div>'
      + '<div class="pl-shared-card-body hidden" data-id="' + r.id + '">'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">歌单名称</span><span class="pl-detail-value">' + escapePlHtml(r.name) + '</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">歌曲数</span><span class="pl-detail-value">' + songCount + ' 首</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">有效期</span><span class="pl-detail-value">' + escapePlHtml(formatExpireText(r)) + '</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">访问次数</span><span class="pl-detail-value">' + escapePlHtml(formatUsesText(r)) + '</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">生成时间</span><span class="pl-detail-value">' + escapePlHtml(formatCreatedText(r)) + '</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">分享链接</span><span class="pl-detail-value pl-detail-link">•••••• (点击复制按钮获取)</span></div>'
      +   '<div class="pl-detail-row"><span class="pl-detail-label">解密密钥</span><span class="pl-detail-value pl-detail-key">•••••• (点击复制按钮获取)</span></div>'
      +   '<div class="pl-detail-actions">'
      +     '<button class="pl-btn pl-btn-mini pl-action-copylink" data-id="' + r.id + '">复制分享链接</button>'
      +     '<button class="pl-btn pl-btn-mini pl-action-copykey" data-id="' + r.id + '">复制密钥</button>'
      +     '<button class="pl-btn pl-btn-mini pl-action-destroy" data-id="' + r.id + '">立即销毁</button>'
      +   '</div>'
      + '</div>';
    // 绑定卡片折叠 (点击 header)
    var header = card.querySelector('.pl-shared-card-header');
    header.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      var body = card.querySelector('.pl-shared-card-body');
      if (!body) return;
      var expanded = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      card.classList.toggle('expanded', !expanded);
    });
    // 销毁按钮: 内联二次确认 (不弹独立 confirm 窗口)
    var destroyBtn = card.querySelector('.pl-action-destroy');
    var _cardDestroyTimer = null;
    destroyBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = destroyBtn.dataset.id;
      // 第一次点击: 进入二次确认状态
      if (!destroyBtn.classList.contains('confirm-pending')) {
        destroyBtn.classList.add('confirm-pending');
        destroyBtn.textContent = '确认销毁?';
        if (_cardDestroyTimer) clearTimeout(_cardDestroyTimer);
        _cardDestroyTimer = setTimeout(function() {
          destroyBtn.classList.remove('confirm-pending');
          destroyBtn.textContent = '立即销毁';
          destroyBtn.disabled = false;
        }, 3000);
        return;
      }
      // 第二次点击: 真正销毁
      if (_cardDestroyTimer) { clearTimeout(_cardDestroyTimer); _cardDestroyTimer = null; }
      destroyBtn.disabled = true;
      destroyBtn.textContent = '销毁中...';
      try {
        var rr = await window.playlistAPI.deleteSharedPlaylist(id);
        if (rr.ok) {
          refreshSharedList();
        } else {
          destroyBtn.textContent = '失败';
          setTimeout(function() {
            destroyBtn.classList.remove('confirm-pending');
            destroyBtn.textContent = '立即销毁';
            destroyBtn.disabled = false;
          }, 1500);
        }
      } catch (err) {
        destroyBtn.textContent = '失败';
        setTimeout(function() {
          destroyBtn.classList.remove('confirm-pending');
          destroyBtn.textContent = '立即销毁';
          destroyBtn.disabled = false;
        }, 1500);
      }
    });
    // 复制分享链接 (优先 shareLink, 兜底 accessKey)
    var copyBtn = card.querySelector('.pl-action-copylink');
    copyBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = copyBtn.dataset.id;
      copyBtn.disabled = true;
      var origText = copyBtn.textContent;
      copyBtn.textContent = '获取中...';
      try {
        var r2 = await window.playlistAPI.getSharedPlaylist(id);
        if (r2.ok && r2.record) {
          // 优先复制 shareLink (含完整 wuu:// 链接, 接收方可直接导入)
          var copyVal = r2.record.shareLink || r2.record.accessKey || '';
          if (copyVal) {
            var ta = document.createElement('textarea');
            ta.value = copyVal;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            var linkEl = card.querySelector('.pl-detail-link');
            if (linkEl) {
              linkEl.textContent = copyVal;
              linkEl.title = copyVal;
            }
            copyBtn.textContent = '已复制';
            setTimeout(function() { copyBtn.textContent = origText; copyBtn.disabled = false; }, 1500);
          } else {
            copyBtn.textContent = '无可用链接';
            setTimeout(function() { copyBtn.textContent = origText; copyBtn.disabled = false; }, 1500);
          }
        } else {
          copyBtn.textContent = '获取失败';
          setTimeout(function() { copyBtn.textContent = origText; copyBtn.disabled = false; }, 1500);
        }
      } catch (err) {
        copyBtn.textContent = '获取失败';
        setTimeout(function() { copyBtn.textContent = origText; copyBtn.disabled = false; }, 1500);
      }
    });
    // 复制解密密钥 (从持久化 JSON 中读取, 旧版分享可能为空)
    var copyKeyBtn = card.querySelector('.pl-action-copykey');
    copyKeyBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = copyKeyBtn.dataset.id;
      copyKeyBtn.disabled = true;
      var origText = copyKeyBtn.textContent;
      copyKeyBtn.textContent = '获取中...';
      try {
        var r3 = await window.playlistAPI.getSharedPlaylist(id);
        if (r3.ok && r3.record) {
          var keyVal = r3.record.key || '';
          if (keyVal) {
            var ta2 = document.createElement('textarea');
            ta2.value = keyVal;
            document.body.appendChild(ta2);
            ta2.select();
            document.execCommand('copy');
            document.body.removeChild(ta2);
            var keyEl = card.querySelector('.pl-detail-key');
            if (keyEl) {
              keyEl.textContent = keyVal;
              keyEl.title = keyVal;
            }
            copyKeyBtn.textContent = '已复制';
            setTimeout(function() { copyKeyBtn.textContent = origText; copyKeyBtn.disabled = false; }, 1500);
          } else {
            // 旧版分享未持久化密钥, 提示用户重新生成
            copyKeyBtn.textContent = '密钥不可用';
            var keyEl2 = card.querySelector('.pl-detail-key');
            if (keyEl2) keyEl2.textContent = '此分享生成于旧版, 密钥未保存, 请销毁后重新生成';
            setTimeout(function() { copyKeyBtn.textContent = origText; copyKeyBtn.disabled = false; }, 2500);
          }
        } else {
          copyKeyBtn.textContent = '获取失败';
          setTimeout(function() { copyKeyBtn.textContent = origText; copyKeyBtn.disabled = false; }, 1500);
        }
      } catch (err) {
        copyKeyBtn.textContent = '获取失败';
        setTimeout(function() { copyKeyBtn.textContent = origText; copyKeyBtn.disabled = false; }, 1500);
      }
    });
    return card;
  }

  // 渲染下一批卡片 (基于 plSharedRecords / plSharedRendered)
  function renderNextSharedBatch() {
    if (!plSharedList || !plSharedRecords.length) return;
    var end = Math.min(plSharedRendered + SHARED_PAGE_SIZE, plSharedRecords.length);
    var frag = document.createDocumentFragment();
    for (var i = plSharedRendered; i < end; i++) {
      frag.appendChild(buildSharedCard(plSharedRecords[i]));
    }
    // 将新卡片插入到 sentinel 之前 (sentinel 始终在 list 末尾)
    if (plSharedSentinel) {
      plSharedList.insertBefore(frag, plSharedSentinel);
    } else {
      plSharedList.appendChild(frag);
    }
    plSharedRendered = end;
    // 全部渲染完则隐藏 sentinel + 断开 observer
    if (plSharedRendered >= plSharedRecords.length) {
      if (plSharedSentinel) plSharedSentinel.classList.add('hidden');
      if (plSharedObserver) { plSharedObserver.disconnect(); plSharedObserver = null; }
    } else if (plSharedSentinel) {
      // 还有更多: 显示 sentinel 等待下一次观察
      plSharedSentinel.classList.remove('hidden');
    }
  }

  // 初始化 IntersectionObserver: 当 sentinel 可见时加载下一批
  function setupSharedObserver() {
    if (!plSharedSentinel || plSharedObserver) return;
    if (!('IntersectionObserver' in window)) return;
    plSharedObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && plSharedRendered < plSharedRecords.length) {
          renderNextSharedBatch();
        }
      });
    }, { root: null, rootMargin: '64px', threshold: 0 });
    plSharedObserver.observe(plSharedSentinel);
  }

  async function refreshSharedList() {
    if (!plSharedList) return;
    // 同步更新服务器状态徽章
    try {
      var st = await window.playlistAPI.serverStatus();
      if (plServerBadge) {
        if (st.ok && st.running) {
          plServerBadge.textContent = '● 服务运行中 · :' + st.port;
          plServerBadge.className = 'pl-server-badge online';
        } else {
          plServerBadge.textContent = '○ 服务未开启';
          plServerBadge.className = 'pl-server-badge offline';
        }
      }
    } catch (e) {}
    try {
      var result = await window.playlistAPI.listSharedPlaylists();
      // 重置分页状态
      if (plSharedObserver) { plSharedObserver.disconnect(); plSharedObserver = null; }
      // 清空已渲染的卡片, 但保留 sentinel 元素 (sentinel 在 list 内部)
      Array.prototype.slice.call(plSharedList.querySelectorAll('.pl-shared-card')).forEach(function(el) { el.remove(); });
      plSharedRecords = [];
      plSharedRendered = 0;
      if (!result.ok) {
        plSharedEmpty.textContent = '加载失败: ' + result.message;
        plSharedEmpty.classList.remove('hidden');
        if (plSharedSentinel) plSharedSentinel.classList.add('hidden');
        return;
      }
      plSharedRecords = result.records || [];
      if (plSharedRecords.length === 0) {
        plSharedEmpty.textContent = '尚未生成任何分享';
        plSharedEmpty.classList.remove('hidden');
        if (plSharedSentinel) plSharedSentinel.classList.add('hidden');
        return;
      }
      plSharedEmpty.classList.add('hidden');
      // 渲染首批
      renderNextSharedBatch();
      // 若还有更多, 启动 observer 监听 sentinel
      if (plSharedRendered < plSharedRecords.length) {
        setupSharedObserver();
      }
    } catch (e) {
      plSharedEmpty.textContent = '加载失败: ' + e.message;
      plSharedEmpty.classList.remove('hidden');
      if (plSharedSentinel) plSharedSentinel.classList.add('hidden');
    }
  }
  plRefreshShared.addEventListener('click', refreshSharedList);
  // 暴露给外部, 进入视图时可调用
  window.refreshSharedList = refreshSharedList;

  plCopyLink.addEventListener('click', () => {
    plShareLink.select();
    document.execCommand('copy');
    plCopyLink.textContent = '已复制';
    setTimeout(() => { plCopyLink.textContent = '复制'; }, 1500);
  });

  plCopyKey.addEventListener('click', () => {
    plShareKey.select();
    document.execCommand('copy');
    plCopyKey.textContent = '已复制';
    setTimeout(() => { plCopyKey.textContent = '复制'; }, 1500);
  });

  // 导出密钥到本地 .crt 文件
  plExportCrt.addEventListener('click', async () => {
    if (!plLastKey || !plShareLink.value) { alert('请先生成分享链接'); return; }
    plExportCrt.disabled = true;
    plExportCrt.textContent = '导出中...';
    try {
      var result = await window.playlistAPI.exportCrt(plLastKey, plShareLink.value, plLastName);
      if (result.ok) {
        plExportCrt.textContent = '已保存';
        setTimeout(() => { plExportCrt.textContent = '导出密钥到 .crt 文件'; }, 2000);
      } else if (!result.canceled) {
        alert('导出失败: ' + result.message);
      }
    } catch (e) {
      alert('导出失败: ' + e.message);
    }
    plExportCrt.disabled = false;
    if (plExportCrt.textContent === '导出中...') {
      plExportCrt.textContent = '导出密钥到 .crt 文件';
    }
  });

  // === 导入: 解析链接 (需密钥) ===
  // 远程地址直接使用链接中嵌入的 host:port (导出方已经把对外地址写进链接)
  plParseBtn.addEventListener('click', async () => {
    var link = plImportLink.value.trim();
    if (!link) { alert('请粘贴 wuu:// 链接'); return; }
    var key = plImportKey.value.trim();
    if (!key) { alert('请输入解密密钥'); return; }
    plParseBtn.disabled = true;
    plParseBtn.textContent = '解析中...';
    plImportStatus.textContent = '正在解密并连接远程服务器...';
    plImportStatus.classList.remove('hidden');
    plImportListWrap.classList.add('hidden');
    try {
      var result = await window.playlistAPI.parseLink(link, key, '');
      if (result.ok) {
        plParsedSongs = result.songs;
        plPlaylistName.textContent = result.playlistName + ' (' + result.songs.length + ' 首)';
        renderPlImportList(result.songs);
        plImportStatus.classList.add('hidden');
        plImportListWrap.classList.remove('hidden');
        updatePlDownloadCount();
      } else {
        plImportStatus.textContent = '解析失败: ' + result.message;
      }
    } catch (e) {
      plImportStatus.textContent = '解析失败: ' + e.message;
    }
    plParseBtn.disabled = false;
    plParseBtn.textContent = '解析歌单';
  });

  // === 导入: 从 .crt 文件导入 (小白友好, 自动填充 link + key) ===
  if (plImportCrtBtn) {
    plImportCrtBtn.addEventListener('click', async () => {
      plImportCrtBtn.disabled = true;
      var origText = plImportCrtBtn.textContent;
      plImportCrtBtn.textContent = '导入中...';
      try {
        var result = await window.playlistAPI.importCrt();
        if (result.ok) {
          // 自动填充到导入表单
          if (result.link) plImportLink.value = result.link;
          if (result.key) plImportKey.value = result.key;
          // 若 CRT 中含歌单名, 显示在状态区
          if (result.name) {
            plImportStatus.textContent = '已从 CRT 导入: ' + result.name;
            plImportStatus.classList.remove('hidden');
          }
          plImportCrtBtn.textContent = '已导入';
          setTimeout(function() { plImportCrtBtn.textContent = origText; plImportCrtBtn.disabled = false; }, 1500);
        } else if (result.canceled) {
          plImportCrtBtn.textContent = origText;
          plImportCrtBtn.disabled = false;
        } else {
          plImportStatus.textContent = '导入失败: ' + (result.message || 'CRT 文件无效');
          plImportStatus.classList.remove('hidden');
          plImportCrtBtn.textContent = origText;
          plImportCrtBtn.disabled = false;
        }
      } catch (e) {
        plImportStatus.textContent = '导入失败: ' + e.message;
        plImportStatus.classList.remove('hidden');
        plImportCrtBtn.textContent = origText;
        plImportCrtBtn.disabled = false;
      }
    });
  }

  function renderPlImportList(songList) {
    plImportList.innerHTML = '';
    var frag = document.createDocumentFragment();
    songList.forEach((song, i) => {
      var li = document.createElement('li');
      li.className = 'pl-item';
      li.innerHTML = '<label class="pl-check">'
        + '<input type="checkbox" class="pl-song-check" data-idx="' + i + '" checked />'
        + '</label>'
        + '<div class="pl-item-info">'
        + '<div class="pl-item-name">' + escapePlHtml(song.songName) + '</div>'
        + '<div class="pl-item-artist">' + escapePlHtml(song.artist) + '</div>'
        + '</div>'
        + '<div class="pl-item-dur">' + (song.realDuration ? fmtPlDuration(song.realDuration) : '') + '</div>'
        + '<button class="pl-item-play" data-idx="' + i + '" title="试听">▶</button>'
        + '<button class="pl-item-dl" data-idx="' + i + '" title="下载">⬇</button>';
      frag.appendChild(li);
    });
    plImportList.appendChild(frag);
    // 试听按钮
    plImportList.querySelectorAll('.pl-item-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx, 10);
        playPlPreview(idx, btn);
      });
    });
    // 单首下载按钮
    plImportList.querySelectorAll('.pl-item-dl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx, 10);
        downloadPlSong(idx);
      });
    });
    // 复选框变化
    plImportList.querySelectorAll('.pl-song-check').forEach(cb => {
      cb.addEventListener('change', updatePlDownloadCount);
    });
  }

  // === 试听远程歌单歌曲 (流式播放, 不下载到本地) ===
  // 复用主播放器 audio 元素 + 封面 + 歌词区, 设置 fmPreviewMode 让爱心按钮走保存分支
  // 慢网络下不必等待下载完成, 即时试听决定是否保存
  var _plPreviewReqId = 0;
  async function playPlPreview(idx, btn) {
    var song = plParsedSongs[idx];
    if (!song || !song.audioUrl) return;
    // 同一首再点: 切换暂停/播放
    if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'playlist'
        && fmPreviewSong.id === song.audioUrl) {
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
      return;
    }
    var reqId = ++_plPreviewReqId;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    // 清除其他歌曲的 playing 状态
    plImportList.querySelectorAll('.pl-item-play.playing').forEach(b => b.classList.remove('playing'));
    // 重置视频模式(防止从汽水视频试听切换过来时残留)
    if (typeof setVideoMode === 'function') setVideoMode(false);
    // 暂停本地播放器
    if (!fmPreviewMode && typeof isPlaying !== 'undefined' && isPlaying) {
      audio.pause();
      if (typeof saveCurrentProgress === 'function') saveCurrentProgress();
    }
    try {
      // 进入试听模式 (source='playlist' 标识, 让爱心按钮走保存分支)
      fmPreviewMode = true;
      fmPreviewSong = {
        id: song.audioUrl,           // 用 audioUrl 作为唯一 id (同链接同歌同 url)
        source: 'playlist',
        name: song.songName,
        artist: song.artist,
        album: song.album || '',
        cover: song.coverUrl || '',
        realDuration: song.realDuration || 0,
        lyricist: song.lyricist || '',
        composer: song.composer || '',
        _originSong: song,           // 保留原始对象, 保存到歌库时用
      };
      // 清空旧歌词
      lrc = [];
      lrcRaw = false;
      fmPreviewLrc = [];
      fmPreviewLrcRaw = false;
      fmPreviewLrcText = '';
      fmPreviewHasValidLrc = false;
      prevCurLine = -1;
      lineMetrics = [];
      _cachedLineEls = null;
      if (typeof renderLrc === 'function') renderLrc();
      if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
      // 主播放器 UI
      empty.classList.add('hidden');
      player.classList.remove('hidden');
      lyrics.classList.remove('hidden');
      titleEl.textContent = song.songName || '未知歌曲';
      artistEl.textContent = song.artist || '';
      if (typeof updLikeBtn === 'function') updLikeBtn();
      if (typeof updNowPlaying === 'function') updNowPlaying();
      if (typeof desktopLyricOn !== 'undefined' && desktopLyricOn && typeof window.desktopLyric !== 'undefined') {
        window.desktopLyric.send({ type: 'info', info: { title: song.songName || '', artist: song.artist || '' } });
      }
      // 封面
      if (typeof setCoverImage === 'function') setCoverImage(song.coverUrl || null);
      if (typeof coverEl !== 'undefined' && coverEl) coverEl.classList.toggle('disc', appSettings.discCover);
      // 提取封面主色作为背景渐变 (远程歌单封面是 URL, applyCoverBackground 内部自动识别)
      if (typeof applyCoverBackground === 'function') applyCoverBackground(song.coverUrl || null);
      // 音频: 直接用远程 stream URL 流式播放 (不下载到本地)
      audio.removeAttribute('src');
      audio.load();
      audio.src = song.audioUrl;
      audio.currentTime = 0;
      await audio.play();
      if (reqId !== _plPreviewReqId) return;
      if (btn) { btn.textContent = '▶'; btn.disabled = false; btn.classList.add('playing'); }
      // 异步加载远程歌词 (失败不影响试听)
      loadPlLyricToMain(song.lyricUrl);
      // 更新保存按钮
      if (typeof updateFmSaveButton === 'function') updateFmSaveButton();
    } catch (e) {
      if (reqId !== _plPreviewReqId) return;
      if (btn) { btn.textContent = '▶'; btn.disabled = false; }
      if (typeof showToast === 'function') showToast('试听失败: ' + e.message, 'error');
      // 试听失败, 退出试听模式
      if (fmPreviewMode && fmPreviewSong && fmPreviewSong.source === 'playlist') {
        if (typeof stopFreeMusicPreview === 'function') stopFreeMusicPreview();
      }
    }
  }

  // 加载远程歌单歌词到主播放器 (复用 fmPreviewLrc 缓存, 保存到歌库时直接用)
  function loadPlLyricToMain(lyricUrl) {
    if (!lyricUrl) {
      lrc = [{ time: 0, text: '纯音乐，请欣赏' }];
      lrcRaw = false;
      if (typeof renderLrc === 'function') renderLrc();
      return;
    }
    fetch(lyricUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        fmPreviewLrcText = text || '';
        var parsed = [];
        var isRaw = false;
        // 尝试逐字解析 (KRC 格式)
        if (typeof parseRaw === 'function') {
          var rawParsed = parseRaw(text);
          if (rawParsed.length) { parsed = rawParsed; isRaw = true; }
        }
        if (!parsed.length && typeof parseEnhancedLRC === 'function') {
          var enhanced = parseEnhancedLRC(text);
          if (enhanced.length) { parsed = enhanced; isRaw = true; }
        }
        if (!parsed.length && typeof parseLRC === 'function') {
          parsed = parseLRC(text);
        }
        fmPreviewLrc = parsed;
        fmPreviewLrcRaw = isRaw;
        fmPreviewHasValidLrc = parsed.length > 2;
        lrc = parsed.length ? parsed : [{ time: 0, text: '纯音乐，请欣赏' }];
        lrcRaw = isRaw;
        prevCurLine = -1;
        lineMetrics = [];
        _cachedLineEls = null;
        if (typeof renderLrc === 'function') renderLrc();
        if (typeof syncLrc === 'function') syncLrc(audio.currentTime || 0);
        if (typeof sendLyricDataToDesktop === 'function') sendLyricDataToDesktop();
      })
      .catch(function () {
        // 歌词加载失败, 显示纯音乐提示, 不影响试听
        lrc = [{ time: 0, text: '纯音乐，请欣赏' }];
        lrcRaw = false;
        if (typeof renderLrc === 'function') renderLrc();
      });
  }

  function updatePlDownloadCount() {
    var checked = plImportList.querySelectorAll('.pl-song-check:checked').length;
    plDownloadCount.textContent = checked + ' / ' + plParsedSongs.length + ' 首已选';
  }

  // 全选/取消全选
  plCheckAll.addEventListener('change', () => {
    var checked = plCheckAll.checked;
    plImportList.querySelectorAll('.pl-song-check').forEach(cb => { cb.checked = checked; });
    updatePlDownloadCount();
  });

  // === 下载选中 ===
  plDownloadAll.addEventListener('click', async () => {
    var indices = [];
    plImportList.querySelectorAll('.pl-song-check:checked').forEach(cb => {
      indices.push(parseInt(cb.dataset.idx, 10));
    });
    if (!indices.length) { alert('请选择要下载的歌曲'); return; }
    plDownloadAll.disabled = true;
    plProgressWrap.classList.remove('hidden');
    plProgressWrap.classList.remove('completed');
    plProgressFill.style.width = '0%';
    var done = 0;
    var failed = 0;
    var current = 0;
    // 注册进度回调
    var onProgress = (payload) => {
      if (payload.stage === 'error') {
        // handled per-song
      } else if (payload.pct !== undefined) {
        var overallPct = ((current + (payload.pct / 100)) / indices.length) * 100;
        plProgressFill.style.width = overallPct + '%';
        plProgressText.textContent = '下载中 ' + (done + 1) + '/' + indices.length + ' · ' + payload.stage + ' ' + Math.round(payload.pct) + '%';
      }
    };
    window.playlistAPI.onDownloadProgress(onProgress);

    for (var k = 0; k < indices.length; k++) {
      current = k;
      var idx = indices[k];
      var song = plParsedSongs[idx];
      plProgressText.textContent = '下载中 ' + (k + 1) + '/' + indices.length + ' · ' + song.songName;
      try {
        var result = await window.playlistAPI.downloadSong(song, false);
        if (result.ok) {
          done++;
          // 标记该行为已下载
          var itemEl = plImportList.querySelector('.pl-item-dl[data-idx="' + idx + '"]');
          if (itemEl) { itemEl.textContent = '✓'; itemEl.classList.add('done'); itemEl.disabled = true; }
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
    window.playlistAPI.removeDownloadProgress();
    plProgressFill.style.width = '100%';
    // 切换为完成状态: 移除流光动画, 文字变绿
    plProgressWrap.classList.add('completed');
    plProgressText.textContent = '完成: 成功 ' + done + ' 首, 失败 ' + failed + ' 首';
    plDownloadAll.disabled = false;
    // 刷新主歌库
    if (done > 0 && typeof refreshMainLibrary === 'function') refreshMainLibrary();
  });

  // 单首下载
  async function downloadPlSong(idx) {
    var song = plParsedSongs[idx];
    if (!song) return;
    var btn = plImportList.querySelector('.pl-item-dl[data-idx="' + idx + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      var result = await window.playlistAPI.downloadSong(song, false);
      if (result.ok) {
        if (btn) { btn.textContent = '✓'; btn.classList.add('done'); }
        if (typeof showToast === 'function') showToast('已保存到歌库: ' + song.songName, 'success');
      } else {
        if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
        if (typeof showToast === 'function') showToast('下载失败: ' + result.message, 'error');
      }
    } catch (e) {
      if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
      if (typeof showToast === 'function') showToast('下载失败: ' + e.message, 'error');
    }
  }

  // 通过 song 对象下载 (供爱心按钮调用: 试听后想保存到歌库)
  // 慢网络下用户已经试听过决定保存, 此处走完整下载流程
  window.downloadPlSongByObj = async function (song) {
    if (!song) return;
    // 找到对应的列表按钮, 触发同样的视觉反馈
    var idx = plParsedSongs.indexOf(song);
    var btn = idx >= 0 ? plImportList.querySelector('.pl-item-dl[data-idx="' + idx + '"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (typeof showToast === 'function') showToast('开始保存: ' + song.songName, 'info');
    try {
      var result = await window.playlistAPI.downloadSong(song, false);
      if (result.ok) {
        if (btn) { btn.textContent = '✓'; btn.classList.add('done'); }
        if (typeof showToast === 'function') showToast('已保存到歌库: ' + song.songName, 'success');
        if (typeof refreshMainLibrary === 'function') refreshMainLibrary();
        if (typeof updLikeBtn === 'function') updLikeBtn();
      } else {
        if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
        if (typeof showToast === 'function') showToast('保存失败: ' + result.message, 'error');
      }
    } catch (e) {
      if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
      if (typeof showToast === 'function') showToast('保存失败: ' + e.message, 'error');
    }
  };

  function escapePlHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtPlDuration(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
}

function showPlaylistShareView() {
  currentMode = 'playlist';
  hideAllViews();
  var v = document.getElementById('view-playlist-share');
  if (v) v.classList.remove('hidden');
  refreshCoverBackground();
  initPlaylistShare();
  // 首次 initPlaylistShare 已自动调用一次; 后续进入若已初始化, 手动刷新 chip
  // (收藏歌单可能在上次访问后已变化)
  if (window._plInited && typeof window.buildExportSources === 'function') {
    window.buildExportSources();
  }
  // 进入视图时刷新已分享列表 + 服务器状态徽章
  if (window._plInited && typeof window.refreshSharedList === 'function') {
    window.refreshSharedList();
  }
}
