// =========== 汽水音乐歌单导入 - 登录 ===========
// 从 qishui-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// ---- 登录区显示/隐藏 ----
// 注: showLoginArea 改为薄包装, 实际逻辑由 init.js 的 showQsLoginForm 处理
// (showQsLoginForm 会同时处理账号列表区域的隐藏 + 触发二维码生成)
function showLoginArea() {
  if (typeof showQsLoginForm === 'function') {
    showQsLoginForm();
  } else {
    qsLoginArea.classList.remove('hidden');
    qsLoggedArea.classList.add('hidden');
    if (!qsQrToken) generateQsQrcode();
  }
}

function showLoggedArea() {
  qsLoginArea.classList.add('hidden');
  qsLoggedArea.classList.remove('hidden');
}

// ---- 二维码登录 ----
async function generateQsQrcode() {
  qsQrLoading.classList.remove('hidden');
  qsQrImgWrap.classList.add('hidden');
  qsQrHint.textContent = '正在生成二维码...';
  stopQsQrPolling();

  try {
    const res = await window.qishuiAPI.getQrcode();
    if (!res || !res.ok) {
      qsQrHint.textContent = '获取二维码失败: ' + (res && res.message ? res.message : '未知错误');
      qsQrLoading.classList.add('hidden');
      return;
    }
    qsQrToken = res.token || '';
    if (res.qrcode) {
      qsQrImg.src = res.qrcode;
    } else if (res.base64) {
      qsQrImg.src = res.base64;
    } else if (res.url) {
      qsQrImg.src = res.url;
    } else {
      qsQrHint.textContent = '二维码数据为空';
      qsQrLoading.classList.add('hidden');
      return;
    }
    qsQrLoading.classList.add('hidden');
    qsQrImgWrap.classList.remove('hidden');
    qsQrHint.textContent = '请使用抖音/汽水音乐APP扫码登录';
    startQsQrPolling();
  } catch (e) {
    qsQrHint.textContent = '生成二维码失败: ' + e.message;
    qsQrLoading.classList.add('hidden');
  }
}

function startQsQrPolling() {
  stopQsQrPolling();
  qsQrTimer = setInterval(async () => {
    if (!qsQrToken) { stopQsQrPolling(); return; }
    try {
      const res = await window.qishuiAPI.checkQrcode(qsQrToken);
      if (!res || !res.ok) return;
      const status = res.status;
      if (status === 'confirmed' || status === 'success' || status === 4) {
        stopQsQrPolling();
        const aid = res.aid || '386088';
        const sessionid = res.sessionid;
        if (sessionid) {
          if (typeof showToast === 'function') showToast('登录成功', 'success');
          await finishLogin(aid, sessionid);
        } else {
          qsQrHint.textContent = '登录回调缺少 sessionid';
        }
      } else if (status === 'scanned' || status === 2) {
        qsQrHint.textContent = '已扫描, 请在手机上确认';
      } else if (status === 'expired' || status === 0) {
        stopQsQrPolling();
        qsQrHint.textContent = '二维码已过期, 请刷新';
        qsQrToken = '';
      }
    } catch (e) {
      // 网络错误不停止轮询, 下次再试
    }
  }, 2500);
}

function stopQsQrPolling() {
  if (qsQrTimer) { clearInterval(qsQrTimer); qsQrTimer = null; }
}

// ---- 一键登录 ----
async function oneclickLogin() {
  qsOneclickBtn.disabled = true;
  qsOneclickStatus.textContent = '正在读取本地汽水音乐登录信息...';
  qsOneclickStatus.classList.remove('hidden');
  try {
    const res = await window.qishuiAPI.oneclickLogin();
    if (res && res.supported && res.sessionid) {
      qsOneclickStatus.textContent = '登录成功, 正在加载用户信息...';
      await finishLogin('386088', res.sessionid);
    } else {
      qsOneclickStatus.textContent = '一键登录不可用: ' + (res && res.reason ? res.reason : '未找到本地汽水音乐客户端 Cookie');
      if (typeof showToast === 'function') showToast('一键登录不可用', 'error');
    }
  } catch (e) {
    qsOneclickStatus.textContent = '一键登录失败: ' + e.message;
    if (typeof showToast === 'function') showToast('一键登录失败: ' + e.message, 'error');
  }
  qsOneclickBtn.disabled = false;
}

// ---- 文件登录 ----
async function fileLogin() {
  if (!qsSelectedFile) {
    if (typeof showToast === 'function') showToast('请先选择 Cookie 文件', 'error');
    return;
  }
  qsFileLogin.disabled = true;
  qsFileStatus.textContent = '正在读取文件并登录...';
  qsFileStatus.classList.remove('hidden');
  try {
    const base64 = await readFileAsBase64(qsSelectedFile);
    const res = await window.qishuiAPI.fileLogin(qsSelectedFile.name, base64);
    if (res && res.ok && res.sessionid) {
      if (typeof showToast === 'function') showToast('登录成功', 'success');
      await finishLogin('386088', res.sessionid);
    } else {
      qsFileStatus.textContent = '文件登录失败: ' + (res && res.message ? res.message : '无法从文件中提取 sessionid');
      if (typeof showToast === 'function') showToast('文件登录失败', 'error');
    }
  } catch (e) {
    qsFileStatus.textContent = '文件登录失败: ' + e.message;
    if (typeof showToast === 'function') showToast('文件登录失败: ' + e.message, 'error');
  }
  qsFileLogin.disabled = false;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result 形如 "data:application/octet-stream;base64,XXXX"
      const s = String(reader.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

// ---- 参数登录 ----
async function manualLogin() {
  const platform = qsManualPlatform.value;
  const sessionid = qsManualSessionid.value.trim();
  const aid = platform === 'android' ? '234123' : '386088';
  if (!sessionid) {
    if (typeof showToast === 'function') showToast('请输入 sessionid', 'error');
    return;
  }
  qsManualLogin.disabled = true;
  try {
    await finishLogin(aid, sessionid);
  } catch (e) {
    if (typeof showToast === 'function') showToast('登录失败: ' + e.message, 'error');
  }
  qsManualLogin.disabled = false;
}

// ---- 登录完成: 拉取用户信息 ----
async function finishLogin(aid, sessionid) {
  try {
    const res = await window.qishuiAPI.getProfile(aid, sessionid);
    console.log('[QISHUI] finishLogin getProfile 返回:', JSON.stringify(res, null, 2));
    if (!res || !res.ok) {
      if (typeof showToast === 'function') showToast('获取用户信息失败: ' + (res && res.message ? res.message : ''), 'error');
      showLoginArea();
      return;
    }
    qsSession = { aid: String(aid), sessionid };
    // 后端直接返回 { ok, id, nickname, avatar, isVip, vipStage } 在根级别
    qsProfile = {
      nickname: res.nickname || '',
      avatar: res.avatar || '',
      is_vip: res.isVip || false,
      vip_stage: res.vipStage || 0,
    };
    console.log('[QISHUI] finishLogin qsProfile=' + JSON.stringify(qsProfile));
    // 渲染用户信息
    showLoggedArea();
    fillQsUserProfile();
    // 加载歌单
    await loadQsPlaylists();
  } catch (e) {
    console.error('[QISHUI] finishLogin 异常:', e);
    if (typeof showToast === 'function') showToast('登录失败: ' + e.message, 'error');
    showLoginArea();
  }
}

function fillQsUserProfile() {
  const p = qsProfile || {};
  const name = p.nickname || p.nick_name || p.name || '已登录';
  const avatar = p.avatar || p.head_pic || p.pic || '';
  console.log('[QISHUI] fillQsUserProfile name="' + name + '" avatar="' + (avatar ? avatar.slice(0, 80) + '...' : '(空)') + '"');
  qsUserName.textContent = name;
  if (avatar) {
    qsUserAvatar.src = avatar;
    qsUserAvatar.classList.remove('hidden');
    qsUserAvatarPh.classList.add('hidden');
  } else {
    qsUserAvatar.classList.add('hidden');
    qsUserAvatarPh.classList.remove('hidden');
  }
  const vip = p.vip || p.is_vip || p.vip_level;
  qsUserVip.classList.toggle('hidden', !vip);
}

// ---- 退出登录 ----
async function handleQsLogout() {
  stopQsQrPolling();
  qsQrToken = '';
  qsSession = null;
  qsProfile = null;
  qsUserInfo = null;
  qsAllPlaylists = { created: [], collected: [] };
  qsCurrentTracks = [];
  qsCurrentPlaylist = null;
  qsCursor = '';
  qsHasMore = false;
  exitQsPreview();
  // 通知主进程清除当前登录 (保留账号)
  try { await window.qishuiAPI.logout(); } catch (e) {}
  // 清空 UI
  if (qsPlaylistGrid) qsPlaylistGrid.innerHTML = '';
  if (qsTrackList) qsTrackList.innerHTML = '';
  if (qsTrackListWrap) qsTrackListWrap.classList.add('hidden');
  if (qsPlaylistsEl) qsPlaylistsEl.classList.remove('hidden');
  if (qsProgress) qsProgress.classList.add('hidden');
  // 重置登录表单
  if (qsManualSessionid) qsManualSessionid.value = '';
  if (qsFileInput) qsFileInput.value = '';
  if (qsFileLogin) qsFileLogin.disabled = true;
  if (qsFileStatus) qsFileStatus.classList.add('hidden');
  if (qsOneclickStatus) qsOneclickStatus.classList.add('hidden');
  // 返回登录视图(若有其他已保存账号, 显示账号列表; 否则显示登录表单)
  await pickQsLoginView();
  if (typeof showToast === 'function') showToast('已退出登录', 'info');
}
