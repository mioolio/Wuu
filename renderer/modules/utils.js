// =========== 工具函数 ===========
function fmt(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtDuration(sec) {
  if (!sec || sec < 1) return '0秒';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}小时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function fmtDurationCompact(sec) {
  if (!sec || sec < 1) return '0秒';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function toUrl(p) {
  if (!p) return '';
  const n = p.replace(/\\/g, '/');
  return 'music:///' + n.split('/').map((x, i) => i === 0 ? x : encodeURIComponent(x)).join('/');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function isLightTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

// =========== 轻量 Toast 通知 ===========
let _toastTimer = null;
function showToast(message, type = 'info') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  // type: success(绿) / error(红) / info(蓝)
  toast.className = `app-toast app-toast-${type} app-toast-show`;
  toast.textContent = message;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('app-toast-show');
  }, 3000);
}

// =========== 通用模态对话框 (替代 Electron 不支持的 window.prompt/confirm) ===========
// 复用 .parse-modal / .parse-modal-card 样式, 视觉与现有对话框一致

// 通用模态框基础结构: 返回 { overlay, card, close() }
// options: { title, sub, bodyBuilder(card) -> 返回 actions 数组用于绑定事件 }
function _buildModal(options) {
  const overlay = document.createElement('div');
  overlay.className = 'parse-modal';
  const card = document.createElement('div');
  card.className = 'parse-modal-card';
  if (options.width) card.style.width = options.width;

  if (options.title) {
    const t = document.createElement('div');
    t.className = 'parse-modal-title';
    t.textContent = options.title;
    card.appendChild(t);
  }
  if (options.sub) {
    const s = document.createElement('div');
    s.className = 'parse-modal-sub';
    if (typeof options.sub === 'string') s.textContent = options.sub;
    else s.appendChild(options.sub);
    card.appendChild(s);
  }
  if (options.bodyBuilder) options.bodyBuilder(card);

  // 操作按钮区
  const actions = document.createElement('div');
  actions.className = 'parse-modal-actions';
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => { try { overlay.remove(); } catch (e) {} };
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  return { overlay, card, actions, close };
}

// 输入框对话框 (替代 window.prompt)
// options: { title, sub, placeholder, defaultValue, allowEmpty, confirmText, onConfirm(text) }
// onConfirm 返回 false/字符串错误信息则不关闭对话框
function showPromptModal(options) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lyrics-repair-input';
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.defaultValue != null) input.value = options.defaultValue;

    const modal = _buildModal({
      title: options.title,
      sub: options.sub,
      width: options.width || '440px',
      bodyBuilder: (card) => {
        // input 自适应行高, 自动聚焦
        input.style.marginTop = '4px';
        card.appendChild(input);
      },
    });

    const submit = () => {
      const val = input.value;
      const trimmed = options.allowEmpty ? val : val.trim();
      if (!options.allowEmpty && !trimmed) {
        input.style.borderColor = 'var(--accent)';
        input.focus();
        return;
      }
      let result;
      if (options.onConfirm) {
        result = options.onConfirm(trimmed);
        if (result === false) return;  // 校验失败, 不关闭
        if (typeof result === 'string') {
          // 错误信息: 短暂显示在输入框下方
          input.style.borderColor = 'var(--accent)';
          showToast(result, 'error');
          return;
        }
      }
      modal.close();
      resolve(trimmed);
    };
    const cancel = () => { modal.close(); resolve(null); };

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'parse-modal-btn primary';
    btnConfirm.textContent = options.confirmText || '确认';
    btnConfirm.addEventListener('click', submit);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'parse-modal-btn secondary';
    btnCancel.textContent = options.cancelText || '取消';
    btnCancel.addEventListener('click', cancel);

    modal.actions.appendChild(btnCancel);
    modal.actions.appendChild(btnConfirm);

    // 自动聚焦 + 回车提交 + Esc 取消
    setTimeout(() => { input.focus(); input.select(); }, 50);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  });
}

// 确认对话框 (替代 window.confirm)
// options: { title, sub (string|HTMLElement), confirmText, cancelText, danger }
// 返回 Promise<boolean>
function showConfirmModal(options) {
  return new Promise((resolve) => {
    const modal = _buildModal({
      title: options.title,
      sub: options.sub,
      width: options.width || '440px',
    });
    const confirm = () => { modal.close(); resolve(true); };
    const cancel = () => { modal.close(); resolve(false); };

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'parse-modal-btn primary';
    btnConfirm.textContent = options.confirmText || '确认';
    if (options.danger) btnConfirm.style.background = '#ef4444';
    btnConfirm.addEventListener('click', confirm);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'parse-modal-btn secondary';
    btnCancel.textContent = options.cancelText || '取消';
    btnCancel.addEventListener('click', cancel);

    modal.actions.appendChild(btnCancel);
    modal.actions.appendChild(btnConfirm);
    // Esc 取消
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', esc);
        cancel();
      }
    });
  });
}

// 歌单选择对话框 (红心按钮点击时弹出, 让用户选择目标歌单, 支持多选)
// options: { song, title, sub, allowCreateNew }
//   song: 当前歌曲对象 (s)
//   allowCreateNew: 是否允许在对话框内"+ 新建歌单"
// 返回 Promise<collIds[]|null>, null=取消, []=用户没选任何项(视为取消)
// 已加入的歌单会预选中, 用户取消勾选则从该歌单移除
function showCollectionPicker(options) {
  return new Promise((resolve) => {
    const { song } = options;
    const audioPath = song && song.audioPath;

    // 列表容器
    const listWrap = document.createElement('div');
    listWrap.className = 'parse-modal-items';
    listWrap.style.maxHeight = '300px';

    // 选中状态: Map<collId, boolean> (用户切换的最终状态)
    // 初始: 歌曲已在歌单中则预选
    const checkState = new Map();
    collections.forEach(c => checkState.set(c.id, audioPath ? c.songs.has(audioPath) : false));

    function renderList() {
      listWrap.innerHTML = '';
      if (collections.length === 0) {
        const tip = document.createElement('div');
        tip.style.cssText = 'text-align:center;color:var(--fg3);padding:30px 0;font-size:12px';
        tip.textContent = '还没有歌单, 请点击下方"新建歌单"';
        listWrap.appendChild(tip);
        return;
      }
      // "我喜欢的音乐" 置顶
      const sorted = collections.slice().sort((a, b) => {
        if (a.name === '我喜欢的音乐') return -1;
        if (b.name === '我喜欢的音乐') return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      sorted.forEach(c => {
        const item = document.createElement('div');
        item.className = 'pmi-item' + (checkState.get(c.id) ? ' checked' : '');
        item.innerHTML = '<div class="pmi-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>'
          + '<div class="pmi-label"><div class="pmi-name"></div>'
          + '<div class="pmi-desc"></div></div>';
        item.querySelector('.pmi-name').textContent = c.name + (c.name === '我喜欢的音乐' ? ' (默认)' : '');
        item.querySelector('.pmi-desc').textContent = `${c.songs.size} 首`;
        item.addEventListener('click', () => {
          const newVal = !checkState.get(c.id);
          checkState.set(c.id, newVal);
          item.classList.toggle('checked', newVal);
        });
        listWrap.appendChild(item);
      });
    }
    renderList();

    const modal = _buildModal({
      title: options.title || '选择歌单',
      sub: options.sub || (song ? `${song.songName || ''} - ${song.artist || ''}` : ''),
      width: '460px',
      bodyBuilder: (card) => {
        card.appendChild(listWrap);
      },
    });

    // 操作按钮: 新建歌单 / 取消 / 确认
    const btnNew = document.createElement('button');
    btnNew.className = 'parse-modal-btn secondary';
    btnNew.textContent = '新建歌单';
    btnNew.addEventListener('click', async () => {
      const name = await showPromptModal({
        title: '新建歌单',
        sub: '请输入歌单名称(可留空, 默认"新建歌单")',
        defaultValue: '新建歌单',
        allowEmpty: true,
        confirmText: '创建',
      });
      if (name === null) return;
      let finalName = name.trim() || '新建歌单';
      if (collections.some(c => c.name === finalName)) {
        let n = 2;
        while (collections.some(c => c.name === `${finalName} ${n}`)) n++;
        finalName = `${finalName} ${n}`;
      }
      const id = createCollection(finalName);
      // 新建后自动预选该歌单
      checkState.set(id, true);
      showToast(`已创建: ${finalName}`, 'success');
      renderList();
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'parse-modal-btn secondary';
    btnCancel.textContent = '取消';
    btnCancel.addEventListener('click', () => { modal.close(); resolve(null); });

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'parse-modal-btn primary';
    btnConfirm.textContent = '确认';
    btnConfirm.addEventListener('click', () => {
      const selected = [];
      checkState.forEach((on, id) => { if (on) selected.push(id); });
      modal.close();
      resolve(selected);
    });

    if (options.allowCreateNew !== false) modal.actions.appendChild(btnNew);
    modal.actions.appendChild(btnCancel);
    modal.actions.appendChild(btnConfirm);
  });
}
