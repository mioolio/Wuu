// =========== 网易云音乐歌单导入 - 初始化 ===========
// 通过 <script> 标签顺序加载, 共享全局作用域
// 前缀 wy- 区分 qs-(汽水) / kg-(酷狗), 避免全局作用域冲突

// ---- 状态 ----
let wyInitialized = false;
let wyQrKey = '';
let wyQrTimer = null;
let wyCurrentTracks = [];
let wyImporting = false;
let wyPreviewIdx = -1;
let _wyPreviewReqId = 0;
let wyUserInfo = null;           // { userId, nickname, pic, vipType }
let wyAllPlaylists = { created: [], collected: [] };
let wyCurrentPlaylist = null;    // { id, title }
let wyCurrentPlTab = 'created';

// ---- DOM (wy-* 元素未在 dom.js 中声明, 在此本地声明) ----
const wyLoginArea = $('wy-login-area');
const wyLoggedArea = $('wy-logged-area');
const wyAccountsArea = $('wy-accounts-area');
const wyAccountsList = $('wy-accounts-list');
const wyAddAccount = $('wy-add-account');
const wyBackToAccounts = $('wy-back-to-accounts');
const wyTabBtns = document.querySelectorAll('.wy-tab-btn');
const wyQrPanel = $('wy-qr-panel');
const wyCookiePanel = $('wy-cookie-panel');
const wyQrLoading = $('wy-qr-loading');
const wyQrImgWrap = $('wy-qr-img-wrap');
const wyQrImg = $('wy-qr-img');
const wyQrHint = $('wy-qr-hint');
const wyQrRefresh = $('wy-qr-refresh');
const wyCookieInput = $('wy-cookie-input');
const wyCookieLogin = $('wy-cookie-login');
const wyCookieStatus = $('wy-cookie-status');
const wyUserAvatar = $('wy-user-avatar');
const wyUserAvatarPh = $('wy-user-avatar-ph');
const wyUserName = $('wy-user-name');
const wyUserVip = $('wy-user-vip');
const wyLogout = $('wy-logout');
const wyPlaylistsEl = $('wy-playlists');
const wyPlTabBtns = document.querySelectorAll('.wy-pl-tab-btn');
const wyPlaylistGrid = $('wy-playlist-grid');
const wyTrackListWrap = $('wy-track-list-wrap');
const wyBackToPlaylists = $('wy-back-to-playlists');
const wyPlaylistTitle = $('wy-playlist-title');
const wyTrackList = $('wy-track-list');
const wyQualitySelect = $('wy-quality-select');
const wyProgress = $('wy-progress');
const wyProgressFill = $('wy-progress-fill');
const wyProgressText = $('wy-progress-text');

// 试听默认音质 / 导入音质
const WY_PREVIEW_QUALITY = 'standard';   // 128k 试听, 节省带宽
const WY_IMPORT_QUALITY = 'lossless';     // 无损导入, 失败时后端自动降级 hires → exhigh

// ---- 初始化 ----
async function initNeteaseImport() {
  if (wyInitialized) return;
  wyInitialized = true;
  bindNeteaseEvents();
  // 检查登录状态(若有已保存账号, 直接恢复)
  await checkNeteaseLoginStatus();
}

function bindNeteaseEvents() {
  // 登录方式 tab 切换
  wyTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.wyTab;
      wyTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      wyQrPanel.classList.toggle('hidden', tab !== 'qr');
      wyCookiePanel.classList.toggle('hidden', tab !== 'cookie');
      // 进入扫码 tab 且无 key 时自动生成
      if (tab === 'qr' && !wyQrKey) {
        generateWyQrcode();
      }
    });
  });

  // 二维码刷新
  if (wyQrRefresh) wyQrRefresh.addEventListener('click', generateWyQrcode);
  // Cookie 导入登录
  if (wyCookieInput) {
    wyCookieInput.addEventListener('input', () => {
      const val = wyCookieInput.value.trim();
      wyCookieLogin.disabled = !val;
    });
  }
  if (wyCookieLogin) wyCookieLogin.addEventListener('click', cookieLogin);
  // 退出登录
  if (wyLogout) wyLogout.addEventListener('click', handleWyLogout);
  // 返回歌单列表
  if (wyBackToPlaylists) {
    wyBackToPlaylists.addEventListener('click', () => {
      wyTrackListWrap.classList.add('hidden');
      wyPlaylistsEl.classList.remove('hidden');
      exitWyPreview();
    });
  }
  // 歌单 tab 切换(创建/收藏)
  wyPlTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.wyPlTab;
      wyCurrentPlTab = tab;
      wyPlTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderWyPlaylists();
    });
  });
  // 添加新账号 → 显示登录表单
  if (wyAddAccount) {
    wyAddAccount.addEventListener('click', () => {
      showWyLoginForm();
    });
  }
  // 返回账号列表
  if (wyBackToAccounts) {
    wyBackToAccounts.addEventListener('click', () => {
      showWyAccountsArea();
    });
  }
  // 监听导入进度(复用 parse-download-progress 通道)
  if (window.neteaseAPI && typeof window.neteaseAPI.onDownloadProgress === 'function') {
    window.neteaseAPI.onDownloadProgress((_, data) => {
      if (!data || !wyImporting) return;
      if (typeof data.pct === 'number') {
        wyProgressFill.style.width = data.pct + '%';
      }
      if (data.stage) wyProgressText.textContent = data.stage;
    });
  }
}

// ---- 登录状态检查 ----
async function checkNeteaseLoginStatus() {
  try {
    const res = await window.neteaseAPI.loginStatus();
    if (res && res.ok && res.loggedIn) {
      wyUserInfo = res.userInfo;
      showWyLoggedIn(res.userInfo);
      await fetchWyPlaylists();
      return;
    }
    // 登录态失效(needRelogin): 提示用户重新登录
    if (res && res.ok && res.needRelogin && res.message) {
      if (typeof showToast === 'function') showToast(res.message, 'error');
    }
  } catch (e) {
    console.log('[NETEASE] login-status 失败:', e.message);
  }
  // 未登录: 优先显示账号列表(如果有已保存账号), 否则显示登录表单
  await pickWyLoginView();
}

// 选择登录视图: 有已保存账号 → 显示账号列表, 否则 → 显示登录表单
async function pickWyLoginView() {
  try {
    const res = await window.neteaseAPI.listAccounts();
    if (res && res.ok && res.accounts && res.accounts.length > 0) {
      showWyAccountsArea();
      return;
    }
  } catch (e) {}
  showWyLoginForm();
}

// 显示账号列表
function showWyAccountsArea() {
  wyLoginArea.classList.remove('hidden');
  wyLoggedArea.classList.add('hidden');
  if (wyAccountsArea) wyAccountsArea.classList.remove('hidden');
  if (wyBackToAccounts) wyBackToAccounts.classList.add('hidden');
  // 隐藏登录表单
  if (wyTabBtns.length) wyTabBtns[0].parentElement.style.display = 'none';
  if (wyQrPanel) wyQrPanel.classList.add('hidden');
  if (wyCookiePanel) wyCookiePanel.classList.add('hidden');
  renderWyAccountsList();
}

async function renderWyAccountsList() {
  if (!wyAccountsList) return;
  wyAccountsList.innerHTML = '<p class="wy-loading-hint">加载中...</p>';
  try {
    const res = await window.neteaseAPI.listAccounts();
    if (!res || !res.ok || !res.accounts) {
      wyAccountsList.innerHTML = '<p class="wy-loading-hint">暂无已保存账号</p>';
      return;
    }
    wyAccountsList.innerHTML = '';
    res.accounts.forEach(acc => {
      const item = document.createElement('div');
      item.className = 'wy-account-item';
      const isCurrent = String(acc.userid) === String(res.currentUserId);
      item.innerHTML = `
        <img src="${acc.pic || ''}" alt="" class="wy-account-avatar" onerror="this.style.display='none'" />
        <div class="wy-account-info">
          <span class="wy-account-name">${escapeWyHtml(acc.nickname || '已登录用户')}</span>
          ${acc.vipType > 0 ? '<span class="wy-vip-badge">VIP</span>' : ''}
          ${isCurrent ? '<span class="wy-current-tag">当前</span>' : ''}
        </div>
        <div class="wy-account-actions">
          ${isCurrent ? '' : `<button class="wy-btn wy-switch-account" data-uid="${acc.userid}">切换</button>`}
          <button class="wy-btn-icon wy-remove-account" data-uid="${acc.userid}" title="删除账号">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
      const switchBtn = item.querySelector('.wy-switch-account');
      if (switchBtn) {
        switchBtn.addEventListener('click', async () => {
          const uid = switchBtn.dataset.uid;
          const r = await window.neteaseAPI.switchAccount(uid);
          if (r && r.ok) {
            await checkNeteaseLoginStatus();
          } else {
            if (typeof showToast === 'function') showToast('切换账号失败', 'error');
          }
        });
      }
      item.querySelector('.wy-remove-account').addEventListener('click', async (e) => {
        const uid = e.currentTarget.dataset.uid;
        const r = await window.neteaseAPI.removeAccount(uid);
        if (r && r.ok) {
          await pickWyLoginView();
        }
      });
      wyAccountsList.appendChild(item);
    });
  } catch (e) {
    wyAccountsList.innerHTML = '<p class="wy-loading-hint">加载失败: ' + e.message + '</p>';
  }
}

// 显示登录表单
function showWyLoginForm() {
  wyLoginArea.classList.remove('hidden');
  wyLoggedArea.classList.add('hidden');
  if (wyAccountsArea) wyAccountsArea.classList.add('hidden');
  if (wyBackToAccounts) wyBackToAccounts.classList.add('hidden');
  // 显示登录表单
  if (wyTabBtns.length) wyTabBtns[0].parentElement.style.display = '';
  // 默认显示扫码 tab
  if (wyTabBtns.length) wyTabBtns[0].click();
  // 若有已保存账号, 显示"返回账号列表"按钮
  window.neteaseAPI.listAccounts().then(res => {
    if (res && res.ok && res.accounts && res.accounts.length > 0) {
      if (wyBackToAccounts) wyBackToAccounts.classList.remove('hidden');
    }
  }).catch(() => {});
}

// 显示已登录状态
function showWyLoggedIn(userInfo) {
  wyLoginArea.classList.add('hidden');
  wyLoggedArea.classList.remove('hidden');
  if (userInfo.pic) {
    wyUserAvatar.src = userInfo.pic;
    wyUserAvatar.classList.remove('hidden');
    wyUserAvatarPh.classList.add('hidden');
  } else {
    wyUserAvatar.classList.add('hidden');
    wyUserAvatarPh.classList.remove('hidden');
  }
  wyUserName.textContent = userInfo.nickname || '已登录用户';
  wyUserVip.classList.toggle('hidden', !userInfo.vipType);
}

// 简单 HTML 转义
function escapeWyHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
