// =========== 免费听音乐专区 - 初始化与免责声明 ===========
// 从 free-music.js 拆分, 通过 <script> 标签顺序加载, 共享全局作用域
// 调用 music-dl.exe web 服务的 HTTP API 实现搜索/试听/歌词/下载
// 独立分区, 不进入主音乐列表, 首次进入需接受免责声明

// 支持的搜索源(exe 支持)
const FM_SOURCES = [
  { id: 'netease', name: '网易云' },
  { id: 'qq', name: 'QQ音乐' },
  { id: 'kugou', name: '酷狗' },
  { id: 'kuwo', name: '酷我' },
  { id: 'migu', name: '咪咕' },
  { id: 'qianqian', name: '千千' },
  { id: 'soda', name: '汽水' },
  { id: 'fivesing', name: '5sing' },
];

let _fmInited = false;
let _fmDisclaimerChecked = false;
let _fmDisclaimerEventsBound = false;
let _fmCurrentSong = null;
let _fmSearching = false;
let _fmLastResults = [];      // 最近一次歌曲搜索结果(用于换源回退)
let _fmTryingFallback = false; // 正在自动换源试听中(避免与 audio error 互相递归)
let _fmSearchType = 'song';   // 当前搜索类型: song | playlist

// 检测歌曲是否已在本地歌库 (按歌名+歌手元数据比对, 零带宽)
// "用到哪里才比对哪里": 仅在渲染搜索结果/试听时调用, 不全量比对
function isFmSongInLibrary(song) {
  return !!findLocalSongByFm(song);
}

// 查找试听歌曲在本地歌库中对应的歌曲对象 (用于收藏切换)
function findLocalSongByFm(song) {
  if (!songs || !songs.length) return null;
  const fmName = (song.name || '').trim().toLowerCase();
  if (!fmName) return null;
  const fmArtists = (typeof splitArtistTokens === 'function' ? splitArtistTokens(song.artist) : [])
    .map(a => a.toLowerCase().trim());
  for (const s of songs) {
    const localName = (s.songName || '').trim().toLowerCase();
    if (localName !== fmName) continue;
    if (!fmArtists.length) return s;  // 歌名匹配且无歌手信息, 视为匹配
    const localArtists = (typeof splitArtistTokens === 'function' ? splitArtistTokens(s.artist) : [])
      .map(a => a.toLowerCase().trim());
    if (!localArtists.length) return s;  // 本地无歌手信息, 歌名匹配即可
    if (localArtists.some(la => fmArtists.some(fa => la === fa))) return s;
  }
  return null;
}

// 初始化(首次进入调用)
async function initFreeMusic() {
  // 最先绑定免责声明按钮事件(防止未接受时 return 导致按钮无响应)
  if (!_fmDisclaimerEventsBound) {
    fmDisclaimerAccept.addEventListener('click', acceptFmDisclaimer);
    fmDisclaimerDecline.addEventListener('click', declineFmDisclaimer);
    _fmDisclaimerEventsBound = true;
  }

  // 检查免责声明
  if (!_fmDisclaimerChecked) {
    try {
      const accepted = await window.freeMusicAPI.checkDisclaimer();
      _fmDisclaimerChecked = true;
      if (!accepted) {
        showFmDisclaimer();
        return;  // 未接受前不初始化功能区
      }
    } catch (e) {
      console.error('[FREE-MUSIC] 检查免责声明失败:', e.message);
      showFmDisclaimer();
      return;
    }
  }
  if (_fmInited) {
    checkFmServiceStatus();
    return;
  }
  _fmInited = true;

  // 初始化平台筛选标签 (默认全部激活, 最大化搜索结果)
  fmSourcesEl.innerHTML = FM_SOURCES.map((s) =>
    `<button class="fm-source-tag active" data-src="${s.id}">${s.name}</button>`
  ).join('');
  fmSourcesEl.querySelectorAll('.fm-source-tag').forEach(tag => {
    tag.addEventListener('click', () => tag.classList.toggle('active'));
  });

  // 搜索框回车
  fmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFmSearch();
  });
  fmBtn.addEventListener('click', doFmSearch);

  // 搜索类型切换 (歌曲/歌单/专辑)
  fmTypeSelect.addEventListener('change', () => {
    _fmSearchType = fmTypeSelect.value;
    // 切换类型时清空结果区
    fmResultsEl.innerHTML = '';
    fmPlaylistsEl.innerHTML = '';
    fmPlaylistsEl.classList.add('hidden');
    fmPlaylistDetailEl.classList.add('hidden');
    fmResultsEl.classList.remove('hidden');
    // 更新输入框 placeholder
    if (_fmSearchType === 'song') fmInput.placeholder = '输入歌曲名/歌手名...';
    else if (_fmSearchType === 'playlist') fmInput.placeholder = '输入歌单名/关键词...';
    else fmInput.placeholder = '输入专辑名/歌手名...';
  });

  // 歌单详情返回按钮
  fmBackToPlaylistsBtn.addEventListener('click', () => {
    fmPlaylistDetailEl.classList.add('hidden');
    fmPlaylistsEl.classList.remove('hidden');
  });

  // 试听播放器事件
  initFmPlayerEvents();

  // 模式切换: 在线搜索 / 链接解析
  document.querySelectorAll('.fm-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fm-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.fmMode;
      const searchPanel = document.getElementById('fm-search-panel');
      const linkPanel = document.getElementById('fm-link-panel');
      if (mode === 'search') {
        searchPanel.classList.remove('hidden');
        linkPanel.classList.add('hidden');
      } else {
        searchPanel.classList.add('hidden');
        linkPanel.classList.remove('hidden');
      }
    });
  });

  // 检查服务状态
  checkFmServiceStatus();
}

function showFmDisclaimer() {
  fmDisclaimer.classList.remove('hidden');
}

async function acceptFmDisclaimer() {
  try {
    await window.freeMusicAPI.acceptDisclaimer();
    fmDisclaimer.classList.add('hidden');
    // 重置状态, 复用 initFreeMusic 完成初始化(此时 _fmDisclaimerChecked=true 会跳过免责声明检查)
    _fmDisclaimerChecked = true;
    _fmInited = false;
    initFreeMusic();
  } catch (e) {
    console.error('[FREE-MUSIC] 接受免责声明失败:', e.message);
    if (typeof showToast === 'function') showToast('操作失败: ' + e.message, 'error');
  }
}

function declineFmDisclaimer() {
  fmDisclaimer.classList.add('hidden');
  // 返回推荐页
  const homeNav = document.querySelector('.nav-item[data-view="home"]');
  if (homeNav) homeNav.click();
}

// 检查 exe 服务状态
async function checkFmServiceStatus() {
  fmStatusEl.textContent = '服务启动中...';
  fmStatusEl.style.color = '';
  // exe 启动需要时间, 轮询检查
  for (let i = 0; i < 30; i++) {
    try {
      const status = await window.freeMusicAPI.status();
      if (status.ready) {
        fmStatusEl.textContent = '服务就绪';
        fmStatusEl.style.color = '#00c853';
        return;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  fmStatusEl.textContent = '服务启动失败, 请检查 music-dl.exe';
  fmStatusEl.style.color = '#e81123';
}
