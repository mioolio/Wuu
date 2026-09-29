// =========== 酷狗歌单导入 - 登录与账号管理 ===========
// 从 kugou-import.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域

// 未登录时决定显示账号列表还是登录表单
async function pickLoginView() {
  try {
    const res = await window.kugouAPI.listAccounts();
    if (res.ok && res.accounts && res.accounts.length > 0) {
      await showAccountsArea();
    } else {
      showKgLoginArea(false);
    }
  } catch (e) {
    showKgLoginArea(false);
  }
}

// 显示登录表单 (showBackBtn: 是否显示"返回账号列表"按钮)
function showKgLoginArea(showBackBtn) {
  console.log('[KUGOU] showKgLoginArea 调用, showBackBtn=' + showBackBtn);
  kgLoginArea.classList.remove('hidden');
  kgLoggedArea.classList.add('hidden');
  // 隐藏账号列表, 显示登录表单组件
  if (kgAccountsArea) kgAccountsArea.classList.add('hidden');
  if (kgLoginToggle) kgLoginToggle.classList.remove('hidden');
  // 返回按钮: 仅当存在已保存账号时显示
  if (kgBackToAccounts) kgBackToAccounts.classList.toggle('hidden', !showBackBtn);
  // 重置到扫码登录 tab, 显示对应 panel (showAccountsArea 会隐藏这两个 panel, 需要重新显示)
  kgTabBtns.forEach(b => b.classList.toggle('active', b.dataset.kgTab === 'qr'));
  if (kgQrPanel) kgQrPanel.classList.remove('hidden');
  if (kgPhonePanel) kgPhonePanel.classList.add('hidden');
  // 自动生成二维码
  if (!kgQrKey) generateQrCode();
  console.log('[KUGOU] showKgLoginArea 完成, 当前可见性:', {
    kgLoginArea: !kgLoginArea.classList.contains('hidden'),
    kgAccountsArea: kgAccountsArea ? !kgAccountsArea.classList.contains('hidden') : 'N/A',
    kgLoginToggle: kgLoginToggle ? !kgLoginToggle.classList.contains('hidden') : 'N/A',
    kgQrPanel: kgQrPanel ? !kgQrPanel.classList.contains('hidden') : 'N/A',
    kgBackToAccounts: kgBackToAccounts ? !kgBackToAccounts.classList.contains('hidden') : 'N/A',
  });
}

// 显示已保存账号列表 (多账号切换)
async function showAccountsArea() {
  console.log('[KUGOU] showAccountsArea 调用');
  kgLoginArea.classList.remove('hidden');
  kgLoggedArea.classList.add('hidden');
  // 隐藏登录表单组件
  if (kgLoginToggle) kgLoginToggle.classList.add('hidden');
  if (kgQrPanel) kgQrPanel.classList.add('hidden');
  if (kgPhonePanel) kgPhonePanel.classList.add('hidden');
  if (kgAccountSelect) kgAccountSelect.classList.add('hidden');
  if (kgBackToAccounts) kgBackToAccounts.classList.add('hidden');
  if (kgAccountsArea) kgAccountsArea.classList.remove('hidden');
  // 停止二维码轮询, 重置二维码 key (下次进入登录表单时重新生成)
  stopQrPolling();
  kgQrKey = '';
  // 渲染账号列表
  await renderAccountsList();
  console.log('[KUGOU] showAccountsArea 完成, kgAccountsArea 可见:', kgAccountsArea ? !kgAccountsArea.classList.contains('hidden') : 'N/A');
}

// 渲染已保存账号列表
async function renderAccountsList() {
  if (!kgAccountsList) return;
  kgAccountsList.innerHTML = '<p style="color:var(--fg2);font-size:13px;text-align:center;padding:12px 0;">加载中...</p>';
  try {
    const res = await window.kugouAPI.listAccounts();
    if (!res.ok || !Array.isArray(res.accounts) || res.accounts.length === 0) {
      // 没有已保存账号, 切回登录表单
      showKgLoginArea(false);
      return;
    }
    kgAccountsList.innerHTML = '';
    const placeholderSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/></svg>';
    res.accounts.forEach(acc => {
      const row = document.createElement('div');
      row.className = 'kg-account-row' + (acc.current ? ' current' : '');
      // 头像容器 (先用占位符, 有图片再加载覆盖)
      const avatarEl = document.createElement('div');
      avatarEl.className = 'kg-account-row-avatar-ph';
      avatarEl.innerHTML = placeholderSvg;
      const pic = (acc.pic || '').replace('{size}', '100');
      if (pic) {
        const img = document.createElement('img');
        img.src = pic;
        img.alt = '';
        img.className = 'kg-account-row-avatar';
        // 加载失败回退到占位符 (img 自然隐藏, 露出底下的 placeholder)
        img.addEventListener('error', () => { img.style.display = 'none'; });
        avatarEl.appendChild(img);
      }
      // 信息区
      const infoEl = document.createElement('div');
      infoEl.className = 'kg-account-row-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'kg-account-row-name';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = acc.nickname || '已登录';
      nameEl.appendChild(nameSpan);
      if (acc.vip_type) {
        const vipBadge = document.createElement('span');
        vipBadge.className = 'kg-account-row-vip';
        vipBadge.textContent = 'VIP';
        nameEl.appendChild(vipBadge);
      }
      if (acc.current) {
        const curBadge = document.createElement('span');
        curBadge.className = 'kg-account-row-vip';
        curBadge.style.cssText = 'background:rgba(251,114,153,0.18);color:#fb7299;';
        curBadge.textContent = '当前';
        nameEl.appendChild(curBadge);
      }
      const metaEl = document.createElement('div');
      metaEl.className = 'kg-account-row-meta';
      metaEl.textContent = 'ID: ' + (acc.userid != null ? String(acc.userid) : '');
      infoEl.appendChild(nameEl);
      infoEl.appendChild(metaEl);
      // 操作区 (删除按钮)
      const actionsEl = document.createElement('div');
      actionsEl.className = 'kg-account-row-actions';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'kg-account-remove';
      removeBtn.title = '删除账号';
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>';
      actionsEl.appendChild(removeBtn);
      // 组装
      row.appendChild(avatarEl);
      row.appendChild(infoEl);
      row.appendChild(actionsEl);
      // 点击行 → 切换账号
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.kg-account-remove')) return;
        await switchAccount(acc.userid);
      });
      // 删除按钮
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeAccount(acc.userid);
      });
      kgAccountsList.appendChild(row);
    });
  } catch (e) {
    kgAccountsList.innerHTML = `<p style="color:#f44336;font-size:13px;text-align:center;padding:12px 0;">加载账号失败: ${kgEscapeHtml(e.message)}</p>`;
  }
}

// 简单 HTML 转义, 防止账号昵称包含特殊字符破坏 DOM
function kgEscapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 切换账号
async function switchAccount(userid) {
  try {
    const res = await window.kugouAPI.switchAccount(userid);
    if (res.ok) {
      if (typeof showToast === 'function') showToast('切换账号成功', 'success');
      kgInitialized = false;
      kgQrKey = '';
      stopQrPolling();
      await checkKugouLoginStatus();
    } else {
      if (typeof showToast === 'function') showToast('切换失败: ' + (res.message || ''), 'error');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('切换失败: ' + e.message, 'error');
  }
}

// 删除账号
async function removeAccount(userid) {
  if (!confirm('确认删除此账号? 删除后需要重新扫码登录。')) return;
  try {
    const res = await window.kugouAPI.removeAccount(userid);
    if (res.ok) {
      if (typeof showToast === 'function') showToast('已删除账号', 'success');
      // 重新渲染账号列表, 如果没有账号了则切回登录表单
      const listRes = await window.kugouAPI.listAccounts();
      if (listRes.ok && listRes.accounts && listRes.accounts.length > 0) {
        await renderAccountsList();
      } else {
        showKgLoginArea(false);
      }
    } else {
      if (typeof showToast === 'function') showToast('删除失败: ' + (res.message || ''), 'error');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('删除失败: ' + e.message, 'error');
  }
}

function showLoggedIn(userInfo) {
  kgLoginArea.classList.add('hidden');
  kgLoggedArea.classList.remove('hidden');
  // 填充用户信息
  kgUserName.textContent = userInfo.nickname || '已登录';
  if (userInfo.pic) {
    kgUserAvatar.src = userInfo.pic.replace('{size}', '100');
    kgUserAvatar.classList.remove('hidden');
    kgUserAvatarPh.classList.add('hidden');
  } else {
    kgUserAvatar.classList.add('hidden');
    kgUserAvatarPh.classList.remove('hidden');
  }
  kgUserVip.classList.toggle('hidden', !userInfo.vip_type);
}

// ---- 二维码登录 ----
async function generateQrCode() {
  kgQrLoading.classList.remove('hidden');
  kgQrImgWrap.classList.add('hidden');
  kgQrHint.textContent = '正在生成二维码...';

  // 清除旧定时器
  if (kgQrTimer) { clearInterval(kgQrTimer); kgQrTimer = null; }

  try {
    const keyRes = await window.kugouAPI.qrKey();
    if (!keyRes.ok) { kgQrHint.textContent = '获取二维码key失败'; return; }
    kgQrKey = keyRes.key;

    const qrRes = await window.kugouAPI.qrCreate(kgQrKey);
    if (!qrRes.ok) { kgQrHint.textContent = '生成二维码失败'; return; }

    kgQrImg.src = qrRes.base64;
    kgQrLoading.classList.add('hidden');
    kgQrImgWrap.classList.remove('hidden');
    kgQrHint.textContent = '请使用酷狗音乐APP扫码登录';

    // 开始轮询
    startQrPolling();
  } catch (e) {
    kgQrHint.textContent = '生成二维码失败: ' + e.message;
  }
}

function startQrPolling() {
  if (kgQrTimer) clearInterval(kgQrTimer);
  kgQrTimer = setInterval(async () => {
    try {
      const res = await window.kugouAPI.qrCheck(kgQrKey);
      if (!res.ok) { stopQrPolling(); return; }
      const status = res.status;
      if (status === 4) {
        // 登录成功
        stopQrPolling();
        if (typeof showToast === 'function') showToast('登录成功', 'success');
        await checkKugouLoginStatus();
      } else if (status === 0) {
        // 过期
        stopQrPolling();
        kgQrHint.textContent = '二维码已过期, 请刷新';
        kgQrKey = '';
      } else if (status === 2) {
        kgQrHint.textContent = '请在手机上确认登录';
      }
    } catch (e) {
      stopQrPolling();
    }
  }, 2000);
}

function stopQrPolling() {
  if (kgQrTimer) { clearInterval(kgQrTimer); kgQrTimer = null; }
}

// ---- 手机号登录 ----
async function sendCaptcha() {
  const mobile = kgPhoneInput.value.trim();
  if (!mobile) { if (typeof showToast === 'function') showToast('请输入手机号', 'error'); return; }
  kgSendCode.disabled = true;
  try {
    const res = await window.kugouAPI.captchaSent(mobile);
    if (res.ok) {
      if (typeof showToast === 'function') showToast('验证码已发送', 'success');
      kgCountdown = 60;
      kgSendCode.textContent = `${kgCountdown}s`;
      kgCountdownTimer = setInterval(() => {
        kgCountdown--;
        kgSendCode.textContent = `${kgCountdown}s`;
        if (kgCountdown <= 0) {
          clearInterval(kgCountdownTimer);
          kgSendCode.disabled = false;
          kgSendCode.textContent = '发送验证码';
        }
      }, 1000);
    } else {
      if (typeof showToast === 'function') showToast('发送失败: ' + res.message, 'error');
      kgSendCode.disabled = false;
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('发送失败: ' + e.message, 'error');
    kgSendCode.disabled = false;
  }
}

async function phoneLogin() {
  const mobile = kgPhoneInput.value.trim();
  const code = kgCodeInput.value.trim();
  if (!mobile || !code) { if (typeof showToast === 'function') showToast('请填写完整信息', 'error'); return; }
  kgPhoneLogin.disabled = true;
  try {
    const res = await window.kugouAPI.loginCellphone(mobile, code);
    console.log('[KUGOU] phoneLogin 响应:', JSON.stringify({ ok: res.ok, multiAccount: res.multiAccount, message: res.message, dataKeys: res.data ? Object.keys(res.data) : [] }));
    if (res.ok) {
      if (typeof showToast === 'function') showToast('登录成功', 'success');
      await checkKugouLoginStatus();
    } else if (res.multiAccount && res.data && res.data.data && res.data.data.info_list) {
      // 多账号选择
      showAccountSelect(res.data.data.info_list, mobile, code);
    } else {
      console.error('[KUGOU] phoneLogin 失败, 完整响应:', JSON.stringify(res));
      if (typeof showToast === 'function') showToast('登录失败: ' + (res.message || '未知错误'), 'error');
    }
  } catch (e) {
    console.error('[KUGOU] phoneLogin 异常:', e);
    if (typeof showToast === 'function') showToast('登录失败: ' + e.message, 'error');
  }
  kgPhoneLogin.disabled = false;
}

function showAccountSelect(accounts, mobile, code) {
  kgAccountList.innerHTML = '';
  accounts.forEach(acc => {
    const item = document.createElement('div');
    item.className = 'kg-account-item';
    item.innerHTML = `
      <img src="${(acc.pic || '').replace('{size}', '100')}" alt="" onerror="this.style.display='none'" />
      <div class="kg-account-info">
        <div class="kg-account-name">${acc.nickname || ''}</div>
        <div class="kg-account-username">${acc.username || ''}</div>
      </div>
    `;
    item.addEventListener('click', async () => {
      try {
        const res = await window.kugouAPI.loginCellphone(mobile, code, acc.userid);
        if (res.ok) {
          kgAccountSelect.classList.add('hidden');
          if (typeof showToast === 'function') showToast('登录成功', 'success');
          await checkKugouLoginStatus();
        } else {
          if (typeof showToast === 'function') showToast('登录失败: ' + (res.message || ''), 'error');
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('登录失败: ' + e.message, 'error');
      }
    });
    kgAccountList.appendChild(item);
  });
  kgAccountSelect.classList.remove('hidden');
}

// ---- 退出登录 (保留账号, 下次直接切换登录) ----
async function handleLogout() {
  await window.kugouAPI.logout();
  kgInitialized = false;
  kgQrKey = '';
  stopQrPolling();
  // 退出后: 如果有已保存账号则显示账号列表, 否则显示登录表单
  await pickLoginView();
}
