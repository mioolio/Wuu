// =========== 网易云音乐歌单导入 - 登录 ===========
// 从 netease-import/init.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 二维码登录 ----
async function generateWyQrcode() {
  if (wyQrTimer) { clearInterval(wyQrTimer); wyQrTimer = null; }
  wyQrKey = '';
  wyQrLoading.classList.remove('hidden');
  wyQrImgWrap.classList.add('hidden');
  wyQrHint.textContent = '正在生成二维码...';

  try {
    const keyRes = await window.neteaseAPI.qrKey();
    if (!keyRes || !keyRes.ok || !keyRes.key) {
      wyQrHint.textContent = '获取二维码key失败: ' + (keyRes && keyRes.message || '');
      return;
    }
    wyQrKey = keyRes.key;

    const qrRes = await window.neteaseAPI.qrCreate(wyQrKey);
    if (!qrRes || !qrRes.ok || !qrRes.base64) {
      wyQrHint.textContent = '生成二维码失败: ' + (qrRes && qrRes.message || '');
      return;
    }
    wyQrImg.src = qrRes.base64;
    wyQrLoading.classList.add('hidden');
    wyQrImgWrap.classList.remove('hidden');
    wyQrHint.textContent = '请使用网易云音乐APP扫码登录';

    // 轮询扫码状态(每 2 秒)
    wyQrTimer = setInterval(pollWyQrStatus, 2000);
  } catch (e) {
    wyQrHint.textContent = '生成二维码异常: ' + e.message;
  }
}

async function pollWyQrStatus() {
  if (!wyQrKey) return;
  try {
    const res = await window.neteaseAPI.qrCheck(wyQrKey);
    if (!res || !res.ok) return;
    // code: 800=过期, 801=等待扫码, 802=待确认, 803=登录成功
    if (res.code === 800) {
      // 过期
      if (wyQrTimer) { clearInterval(wyQrTimer); wyQrTimer = null; }
      wyQrHint.textContent = '二维码已过期, 请点击刷新';
    } else if (res.code === 801) {
      wyQrHint.textContent = '请使用网易云音乐APP扫码登录';
    } else if (res.code === 802) {
      wyQrHint.textContent = '已扫码, 请在APP中确认登录';
    } else if (res.code === 803) {
      // 登录成功
      if (wyQrTimer) { clearInterval(wyQrTimer); wyQrTimer = null; }
      wyQrHint.textContent = '登录成功';
      // 后端已在 qr-check 中保存账号, 这里刷新登录状态
      await checkNeteaseLoginStatus();
    }
  } catch (e) {
    console.log('[NETEASE] 轮询扫码状态异常:', e.message);
  }
}

// ---- Cookie 导入登录 ----
async function cookieLogin() {
  const cookieStr = wyCookieInput.value.trim();
  if (!cookieStr) {
    wyCookieStatus.textContent = '请输入 Cookie';
    wyCookieStatus.classList.remove('hidden');
    return;
  }
  if (cookieStr.indexOf('MUSIC_U') === -1) {
    wyCookieStatus.textContent = 'Cookie 必须包含 MUSIC_U 字段';
    wyCookieStatus.classList.remove('hidden');
    return;
  }
  wyCookieLogin.disabled = true;
  wyCookieLogin.textContent = '登录中...';
  wyCookieStatus.classList.add('hidden');
  try {
    const res = await window.neteaseAPI.cookieLogin(cookieStr);
    if (res && res.ok) {
      wyCookieStatus.textContent = '登录成功';
      wyCookieStatus.classList.remove('hidden');
      await checkNeteaseLoginStatus();
    } else {
      wyCookieStatus.textContent = '登录失败: ' + (res && res.message || 'Cookie 无效');
      wyCookieStatus.classList.remove('hidden');
    }
  } catch (e) {
    wyCookieStatus.textContent = '登录异常: ' + e.message;
    wyCookieStatus.classList.remove('hidden');
  } finally {
    wyCookieLogin.disabled = false;
    wyCookieLogin.textContent = '登录';
  }
}

// ---- 退出登录 ----
async function handleWyLogout() {
  try {
    await window.neteaseAPI.logout();
  } catch (e) {}
  wyUserInfo = null;
  wyAllPlaylists = { created: [], collected: [] };
  wyCurrentPlaylist = null;
  wyCurrentTracks = [];
  // 退出试听
  exitWyPreview();
  // 返回登录视图(若有其他已保存账号, 显示账号列表; 否则显示登录表单)
  await pickWyLoginView();
}
