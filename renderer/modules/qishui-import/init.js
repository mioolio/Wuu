// =========== 汽水音乐歌单导入 - 初始化 ===========
// 从 qishui-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 状态 ----
let qsInitialized = false;
let qsQrToken = '';
let qsQrTimer = null;
let qsCurrentTracks = [];
let qsImporting = false;
let qsPreviewIdx = -1;
let _qsPreviewReqId = 0;
let qsSession = null;            // { aid, sessionid }
let qsProfile = null;            // 用户信息
let qsAllPlaylists = { created: [], collected: [] };   // 缓存两类歌单
let qsCurrentPlaylist = null;    // { id, title }
let qsCursor = '';               // 分页游标
let qsHasMore = false;
let qsLoadingMore = false;       // 正在加载更多(防止重复触发)
let qsCurrentPlTab = 'created';  // 当前歌单 tab
let qsSelectedFile = null;       // 文件登录: 选中的文件对象
let qsUserInfo = null;           // { userId, nickname, pic, vipType, aid, sessionid }
let qsPeekLoaded = false;        // 是否已预读取本地汽水音乐用户信息(避免重复请求)

// ---- DOM (qs-* 元素未在 dom.js 中声明, 在此本地声明) ----
// 注: 视图容器已从 view-qishui 改为 view-import (三平台统一入口)
// qs-* 元素都在 view-import 内部, 直接通过 id 查询即可
const viewQishui = $('view-import');
const qsLoginArea = $('qs-login-area');
const qsLoggedArea = $('qs-logged-area');
const qsAccountsArea = $('qs-accounts-area');
const qsAccountsList = $('qs-accounts-list');
const qsAddAccount = $('qs-add-account');
const qsBackToAccounts = $('qs-back-to-accounts');
const qsTabBtns = document.querySelectorAll('.qs-tab-btn');
const qsQrcodePanel = $('qs-qrcode-panel');
const qsOneclickPanel = $('qs-oneclick-panel');
const qsFilePanel = $('qs-file-panel');
const qsManualPanel = $('qs-manual-panel');
const qsQrLoading = $('qs-qr-loading');
const qsQrImgWrap = $('qs-qr-img-wrap');
const qsQrImg = $('qs-qr-img');
const qsQrHint = $('qs-qr-hint');
const qsQrRefresh = $('qs-qr-refresh');
const qsOneclickBtn = $('qs-oneclick-btn');
const qsOneclickStatus = $('qs-oneclick-status');
const qsFileInput = $('qs-file-input');
const qsFileLogin = $('qs-file-login');
const qsFileStatus = $('qs-file-status');
const qsManualPlatform = $('qs-manual-platform');
const qsManualSessionid = $('qs-manual-sessionid');
const qsManualLogin = $('qs-manual-login');
const qsUserAvatar = $('qs-user-avatar');
const qsUserAvatarPh = $('qs-user-avatar-ph');
const qsUserName = $('qs-user-name');
const qsUserVip = $('qs-user-vip');
const qsLogout = $('qs-logout');
const qsPlaylistsEl = $('qs-playlists');
const qsPlTabBtns = document.querySelectorAll('.qs-pl-tab-btn');
const qsPlaylistGrid = $('qs-playlist-grid');
const qsTrackListWrap = $('qs-track-list-wrap');
const qsBackToPlaylists = $('qs-back-to-playlists');
const qsPlaylistTitle = $('qs-playlist-title');
const qsTrackList = $('qs-track-list');
const qsTableWrap = $('qs-table-wrap');
const qsScrollSentinel = $('qs-scroll-sentinel');
const qsProgress = $('qs-progress');
const qsProgressFill = $('qs-progress-fill');
const qsProgressText = $('qs-progress-text');

// 试听默认音质
const QS_PREVIEW_QUALITY = 'standard';
const QS_IMPORT_QUALITY = 'high';

// ---- 初始化 ----
// 注: 视图切换已统一到 views.js 的 showImportView(), 此处仅保留初始化逻辑
async function initQishuiImport() {
  if (qsInitialized) return;
  qsInitialized = true;
  bindQishuiEvents();
  // 检查登录状态(若有已保存账号, 直接恢复 - 自动登录)
  await checkQsLoginStatus();
}

// ---- 登录状态检查 (自动登录入口) ----
async function checkQsLoginStatus() {
  try {
    const res = await window.qishuiAPI.loginStatus();
    if (res && res.ok && res.loggedIn && res.userInfo) {
      qsUserInfo = res.userInfo;
      // 恢复 qsSession (供 playlists/preview 等下游使用)
      qsSession = { aid: res.userInfo.aid, sessionid: res.userInfo.sessionid };
      qsProfile = {
        nickname: res.userInfo.nickname || '',
        avatar: res.userInfo.pic || '',
        is_vip: !!(res.userInfo.vipType > 0),
        vip_stage: res.userInfo.vipType || 0,
      };
      showLoggedArea();
      fillQsUserProfile();
      await loadQsPlaylists();
      return;
    }
  } catch (e) {
    console.log('[QISHUI] login-status 失败:', e.message);
  }
  // 未登录: 优先显示账号列表(如果有已保存账号), 否则显示登录表单
  await pickQsLoginView();
}

// 选择登录视图: 有已保存账号 → 显示账号列表, 否则 → 显示登录表单
async function pickQsLoginView() {
  try {
    const res = await window.qishuiAPI.listAccounts();
    if (res && res.ok && res.accounts && res.accounts.length > 0) {
      showQsAccountsArea();
      return;
    }
  } catch (e) {}
  showQsLoginForm();
}

// 显示账号列表
function showQsAccountsArea() {
  qsLoginArea.classList.remove('hidden');
  qsLoggedArea.classList.add('hidden');
  if (qsAccountsArea) qsAccountsArea.classList.remove('hidden');
  if (qsBackToAccounts) qsBackToAccounts.classList.add('hidden');
  // 隐藏登录表单
  if (qsTabBtns.length) qsTabBtns[0].parentElement.style.display = 'none';
  if (qsQrcodePanel) qsQrcodePanel.classList.add('hidden');
  if (qsOneclickPanel) qsOneclickPanel.classList.add('hidden');
  if (qsFilePanel) qsFilePanel.classList.add('hidden');
  if (qsManualPanel) qsManualPanel.classList.add('hidden');
  renderQsAccountsList();
}

// 显示已保存账号列表 (镜像 renderWyAccountsList)
async function renderQsAccountsList() {
  if (!qsAccountsList) return;
  qsAccountsList.innerHTML = '<p class="qs-loading-hint">加载中...</p>';
  try {
    const res = await window.qishuiAPI.listAccounts();
    if (!res || !res.ok || !res.accounts) {
      qsAccountsList.innerHTML = '<p class="qs-loading-hint">暂无已保存账号</p>';
      return;
    }
    qsAccountsList.innerHTML = '';
    res.accounts.forEach(acc => {
      const item = document.createElement('div');
      item.className = 'qs-account-item';
      const isCurrent = String(acc.userid) === String(res.currentUserId);
      item.innerHTML = `
        <img src="${acc.pic || ''}" alt="" class="qs-account-avatar" onerror="this.style.display='none'" />
        <div class="qs-account-info">
          <span class="qs-account-name">${escapeQsHtml(acc.nickname || '已登录用户')}</span>
          ${acc.vipType > 0 ? '<span class="qs-vip-badge">VIP</span>' : ''}
          ${isCurrent ? '<span class="qs-current-tag">当前</span>' : ''}
        </div>
        <div class="qs-account-actions">
          ${isCurrent ? '' : `<button class="qs-btn qs-switch-account" data-uid="${acc.userid}">切换</button>`}
          <button class="qs-btn-icon qs-remove-account" data-uid="${acc.userid}" title="删除账号">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
      const switchBtn = item.querySelector('.qs-switch-account');
      if (switchBtn) {
        switchBtn.addEventListener('click', async () => {
          const uid = switchBtn.dataset.uid;
          const r = await window.qishuiAPI.switchAccount(uid);
          if (r && r.ok) {
            await checkQsLoginStatus();
          } else {
            if (typeof showToast === 'function') showToast('切换账号失败', 'error');
          }
        });
      }
      item.querySelector('.qs-remove-account').addEventListener('click', async (e) => {
        const uid = e.currentTarget.dataset.uid;
        const r = await window.qishuiAPI.removeAccount(uid);
        if (r && r.ok) {
          await pickQsLoginView();
        }
      });
      qsAccountsList.appendChild(item);
    });
  } catch (e) {
    qsAccountsList.innerHTML = '<p class="qs-loading-hint">加载失败: ' + e.message + '</p>';
  }
}

// 显示登录表单
function showQsLoginForm() {
  qsLoginArea.classList.remove('hidden');
  qsLoggedArea.classList.add('hidden');
  if (qsAccountsArea) qsAccountsArea.classList.add('hidden');
  if (qsBackToAccounts) qsBackToAccounts.classList.add('hidden');
  // 显示登录表单
  if (qsTabBtns.length) qsTabBtns[0].parentElement.style.display = '';
  // 默认显示扫码 tab (触发 click 自动生成二维码)
  if (qsTabBtns.length) qsTabBtns[0].click();
  // 若有已保存账号, 显示"返回账号列表"按钮
  window.qishuiAPI.listAccounts().then(res => {
    if (res && res.ok && res.accounts && res.accounts.length > 0) {
      if (qsBackToAccounts) qsBackToAccounts.classList.remove('hidden');
    }
  }).catch(() => {});
  // 预读取本地汽水音乐用户信息(不建立正式 session), 在一键登录 tab 显示头像和名称
  // 仅当本地有汽水音乐客户端 Cookie 时才显示, 失败则静默
  if (!qsPeekLoaded) {
    qsPeekLoaded = true;
    window.qishuiAPI.peekProfile().then(peek => {
      if (peek && peek.ok && (peek.nickname || peek.avatar)) {
        const peekUser = document.getElementById('qs-peek-user');
        const peekAvatar = document.getElementById('qs-peek-avatar');
        const peekName = document.getElementById('qs-peek-name');
        const peekVip = document.getElementById('qs-peek-vip');
        if (peekAvatar && peek.avatar) peekAvatar.src = peek.avatar;
        if (peekName) peekName.textContent = peek.nickname || '已登录用户';
        if (peekVip) peekVip.classList.toggle('hidden', !peek.isVip);
        if (peekUser) peekUser.classList.remove('hidden');
      }
    }).catch(() => {});
  }
}

// 简单 HTML 转义
function escapeQsHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function bindQishuiEvents() {
  // 平台 Tab 切换 (汽水/酷狗/网易云) - 统一入口的核心交互
  const impTabBtns = document.querySelectorAll('.imp-tab-btn');
  impTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.impTab;
      impTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      const qishuiPanel = document.getElementById('imp-qishui-panel');
      const kugouPanel = document.getElementById('imp-kugou-panel');
      const neteasePanel = document.getElementById('imp-netease-panel');
      if (qishuiPanel) qishuiPanel.classList.toggle('hidden', tab !== 'qishui');
      if (kugouPanel) kugouPanel.classList.toggle('hidden', tab !== 'kugou');
      if (neteasePanel) neteasePanel.classList.toggle('hidden', tab !== 'netease');
      // 切换到某平台时, 若该平台未初始化则触发初始化
      if (tab === 'kugou' && typeof initKugouImport === 'function') initKugouImport();
      if (tab === 'netease' && typeof initNeteaseImport === 'function') initNeteaseImport();
      // 切换平台时退出试听模式(避免上一平台试听残留)
      if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode) {
        if (typeof exitQsPreview === 'function') exitQsPreview();
      }
    });
  });

  // 登录方式 tab 切换
  qsTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.qsTab;
      qsTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      qsQrcodePanel.classList.toggle('hidden', tab !== 'qrcode');
      qsOneclickPanel.classList.toggle('hidden', tab !== 'oneclick');
      qsFilePanel.classList.toggle('hidden', tab !== 'file');
      qsManualPanel.classList.toggle('hidden', tab !== 'manual');
      // 进入扫码 tab 且无 token 时自动生成
      if (tab === 'qrcode' && !qsQrToken) {
        generateQsQrcode();
      }
    });
  });

  // 二维码刷新
  qsQrRefresh.addEventListener('click', generateQsQrcode);
  // 一键登录
  qsOneclickBtn.addEventListener('click', oneclickLogin);
  // 添加新账号 → 显示登录表单
  if (qsAddAccount) {
    qsAddAccount.addEventListener('click', () => {
      showQsLoginForm();
    });
  }
  // 返回账号列表
  if (qsBackToAccounts) {
    qsBackToAccounts.addEventListener('click', () => {
      showQsAccountsArea();
    });
  }
  // 文件登录: 选择文件后启用登录按钮
  qsFileInput.addEventListener('change', () => {
    qsSelectedFile = qsFileInput.files && qsFileInput.files[0];
    qsFileLogin.disabled = !qsSelectedFile;
    if (qsSelectedFile) {
      qsFileStatus.textContent = '已选择: ' + qsSelectedFile.name;
      qsFileStatus.classList.remove('hidden');
    } else {
      qsFileStatus.classList.add('hidden');
    }
  });
  qsFileLogin.addEventListener('click', fileLogin);
  // 参数登录
  qsManualLogin.addEventListener('click', manualLogin);
  // 退出登录
  qsLogout.addEventListener('click', handleQsLogout);
  // 返回歌单列表
  qsBackToPlaylists.addEventListener('click', () => {
    qsTrackListWrap.classList.add('hidden');
    qsPlaylistsEl.classList.remove('hidden');
    exitQsPreview();
  });
  // 歌单 tab 切换
  qsPlTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.qsPlTab;
      qsCurrentPlTab = tab;
      qsPlTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderQsPlaylists();
    });
  });
  // 滚动到底部自动加载更多(IntersectionObserver)
  if (qsScrollSentinel && qsTableWrap) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && qsHasMore && qsCurrentPlaylist && !qsLoadingMore) {
          loadMoreQsTracks();
        }
      }
    }, { root: qsTableWrap, rootMargin: '100px', threshold: 0 });
    io.observe(qsScrollSentinel);
  }
  // 监听导入进度
  if (window.qishuiAPI && typeof window.qishuiAPI.onImportProgress === 'function') {
    window.qishuiAPI.onImportProgress((_, data) => {
      if (!data) return;
      if (typeof data.progress === 'number') {
        qsProgressFill.style.width = data.progress + '%';
      }
      if (data.text) qsProgressText.textContent = data.text;
    });
  }
}
