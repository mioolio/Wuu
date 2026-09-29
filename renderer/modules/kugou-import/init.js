// =========== 酷狗歌单导入 - 初始化 ===========
// 从 kugou-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

let kgInitialized = false;
let kgQrKey = '';
let kgQrTimer = null;
let kgCountdownTimer = null;
let kgCountdown = 0;
let kgCurrentTracks = [];
let kgImporting = false;

// ---- 初始化 ----
async function initKugouImport() {
  if (kgInitialized) return;
  kgInitialized = true;
  // 绑定事件
  bindKugouEvents();
  // 检查登录状态
  await checkKugouLoginStatus();
}

function bindKugouEvents() {
  console.log('[KUGOU] bindKugouEvents 开始, DOM 元素检查:', {
    kgAddAccount: !!kgAddAccount, kgAccountsArea: !!kgAccountsArea,
    kgAccountsList: !!kgAccountsList, kgBackToAccounts: !!kgBackToAccounts,
    kgLoginToggle: !!kgLoginToggle, kgQrPanel: !!kgQrPanel, kgPhonePanel: !!kgPhonePanel,
  });
  // 登录方式切换
  kgTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.kgTab;
      kgTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      kgQrPanel.classList.toggle('hidden', tab !== 'qr');
      kgPhonePanel.classList.toggle('hidden', tab !== 'phone');
      if (tab === 'qr' && !kgQrKey) {
        generateQrCode();
      }
    });
  });

  // 刷新二维码
  kgQrRefresh.addEventListener('click', generateQrCode);

  // 发送验证码
  kgSendCode.addEventListener('click', sendCaptcha);
  // 手机登录
  kgPhoneLogin.addEventListener('click', phoneLogin);
  // 退出登录
  kgLogout.addEventListener('click', handleLogout);
  // 添加新账号 → 显示登录表单
  if (kgAddAccount) {
    kgAddAccount.addEventListener('click', () => {
      console.log('[KUGOU] 添加新账号按钮被点击');
      try {
        showKgLoginArea(true);
      } catch (e) {
        console.error('[KUGOU] showKgLoginArea 抛出异常:', e.message, '| stack:', e.stack);
      }
    });
  } else {
    console.warn('[KUGOU] 警告: kgAddAccount 元素未找到, 事件未绑定');
  }
  // 返回账号列表
  if (kgBackToAccounts) {
    kgBackToAccounts.addEventListener('click', () => {
      console.log('[KUGOU] 返回账号列表按钮被点击');
      showAccountsArea();
    });
  } else {
    console.warn('[KUGOU] 警告: kgBackToAccounts 元素未找到, 事件未绑定');
  }
  // 返回歌单列表
  kgBackToPlaylists.addEventListener('click', () => {
    kgTracksSection.classList.add('hidden');
    document.querySelector('.kg-playlist-section').classList.remove('hidden');
  });
  // 全选/取消全选
  kgCheckAll.addEventListener('change', () => {
    const checked = kgCheckAll.checked;
    kgTracks.querySelectorAll('.kg-row-check').forEach(cb => {
      cb.checked = checked;
    });
  });
  // 导入全部
  kgImportAll.addEventListener('click', () => importTracks('all'));
  // 导入选中
  kgImportSelected.addEventListener('click', () => importTracks('selected'));
}

// ---- 登录状态检查 ----
async function checkKugouLoginStatus() {
  try {
    const res = await window.kugouAPI.loginStatus();
    if (res.ok && res.loggedIn) {
      showLoggedIn(res.userInfo);
      await fetchPlaylists();
    } else {
      // 未登录: 优先显示账号列表(如果有已保存账号), 否则显示登录表单
      await pickLoginView();
    }
  } catch (e) {
    await pickLoginView();
  }
}
