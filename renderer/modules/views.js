// =========== 视图切换 ===========
function showListView() {
  currentMode = 'list';
  hideAllViews();
  viewList.classList.remove('hidden');
  // 开关开启时保留渐变背景跟随封面, 关闭时移除
  refreshCoverBackground();
}

function showPlayerView() {
  currentMode = 'player';
  hideAllViews();
  viewPlayer.classList.remove('hidden');
  if (currentView === 'home') {
    btnFloatList.classList.toggle('hidden', !appSettings.showFloatListBtn);
    floatListWrap.classList.remove('hidden');
  } else {
    btnFloatList.classList.add('hidden');
    floatListWrap.classList.add('hidden');
    setFloatListExpanded(false);
  }
  // 试听模式: 不覆盖试听 UI (封面/歌词/背景由试听播放器维护), 仅同步歌词位置
  if (typeof fmPreviewMode !== 'undefined' && fmPreviewMode) {
    lineMetrics = [];
    _cachedLineEls = null;
    marqueeState = null;
    if (typeof syncLrc === 'function') syncLrc(audio.currentTime || 0);
    return;
  }
  const s = songs[curIdx];
  if (s) applyCoverBackground(s.coverPath);
  lineMetrics = [];
  _cachedLineEls = null;
  marqueeState = null;
  if (curIdx >= 0) syncLrc(audio.currentTime || 0);
}

function showStatsView() {
  currentMode = 'stats';
  hideAllViews();
  viewStats.classList.remove('hidden');
  renderStats();
  refreshCoverBackground();
}

function showSettingsView() {
  currentMode = 'settings';
  hideAllViews();
  viewSettings.classList.remove('hidden');
  refreshCoverBackground();
}

function showRepairView() {
  currentMode = 'repair';
  hideAllViews();
  viewRepair.classList.remove('hidden');
  refreshCoverBackground();
}

function showFreeMusicView() {
  currentMode = 'free-music';
  hideAllViews();
  viewFreeMusic.classList.remove('hidden');
  refreshCoverBackground();
  // 首次进入检查免责声明 + 初始化
  if (typeof initFreeMusic === 'function') initFreeMusic();
}

// 音乐导入统一入口 (汽水/酷狗/网易云三平台 Tab 切换)
function showImportView() {
  currentMode = 'import';
  hideAllViews();
  const vimp = document.getElementById('view-import');
  if (vimp) vimp.classList.remove('hidden');
  refreshCoverBackground();
  // 初始化三个子平台(各自幂等, 已初始化会直接 return)
  if (typeof initQishuiImport === 'function') initQishuiImport();
  if (typeof initKugouImport === 'function') initKugouImport();
  if (typeof initNeteaseImport === 'function') initNeteaseImport();
}

// 离开免费听/导入视图时不再停止试听, 让试听在后台继续播放
// 仅在用户主动开始新播放(本地歌曲/新试听)时才停止当前试听
function cleanupFreeMusicViewIfActive() {
  // 空实现: 保留函数签名以兼容现有调用点, 但不再中断试听
}

function hideAllViews() {
  viewList.classList.add('hidden');
  viewPlayer.classList.add('hidden');
  viewStats.classList.add('hidden');
  viewSettings.classList.add('hidden');
  viewRepair.classList.add('hidden');
  viewFreeMusic.classList.add('hidden');
  const vimp = document.getElementById('view-import');
  if (vimp) vimp.classList.add('hidden');
  const vp = document.getElementById('view-playlist-share');
  if (vp) vp.classList.add('hidden');
  const vm = document.getElementById('view-management');
  if (vm) vm.classList.add('hidden');
}
