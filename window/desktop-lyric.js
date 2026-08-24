// =========== 桌面歌词窗口: 透明/置顶/无边框/可穿透 ===========
// 独立 BrowserWindow, 默认隐藏, 用户点开关才显示
// 锁定时 setIgnoreMouseEvents 鼠标穿透, 点击穿过到下层窗口
// 窗口位置持久化: moved 事件触发时通过 IPC 通知主窗口保存到 appSettings
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const state = require('../core/state');

// 读取已保存的桌面歌词位置 (从 userdata.json)
function _readSavedLyricBounds() {
  try {
    const { readUserData } = require('../core/storage');
    const ud = readUserData();
    if (ud.settings && Array.isArray(ud.settings.desktopLyricBounds) && ud.settings.desktopLyricBounds.length === 2) {
      return ud.settings.desktopLyricBounds;
    }
  } catch (e) {}
  return null;
}

// 保存桌面歌词位置到 userdata.json
function _saveLyricBounds(bounds) {
  try {
    const { readUserData, writeUserData } = require('../core/storage');
    const ud = readUserData();
    if (!ud.settings) ud.settings = {};
    ud.settings.desktopLyricBounds = bounds;
    writeUserData(ud);
  } catch (e) {}
}

function createDesktopLyricWindow() {
  if (state.getLyricWin() && !state.getLyricWin().isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const w = 900;
  const h = 140;
  // 读取已保存的位置, 没有则使用默认居中位置
  const savedBounds = _readSavedLyricBounds();
  const defaultX = Math.round((display.workAreaSize.width - w) / 2);
  const defaultY = display.workAreaSize.height - h - 80;
  const posX = savedBounds ? savedBounds[0] : defaultX;
  const posY = savedBounds ? savedBounds[1] : defaultY;
  const lyricWin = new BrowserWindow({
    width: w,
    height: h,
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,  // 默认隐藏, 用户点开关才显示
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  state.setLyricWin(lyricWin);
  lyricWin.setAlwaysOnTop(true, 'screen-saver');
  // 初始可交互(未锁定状态, 可拖动)
  lyricWin.setIgnoreMouseEvents(false);
  lyricWin.loadFile(path.join(__dirname, '..', 'renderer', 'desktop-lyric.html'));

  // 监听窗口移动: 拖动后保存位置到 userdata.json
  lyricWin.on('moved', () => {
    try {
      const [x, y] = lyricWin.getPosition();
      _saveLyricBounds([x, y]);
      // 通知渲染进程同步 appSettings (非关键, 失败不影响)
      state.sendToMain('lyric-bounds-saved', [x, y]);
    } catch (e) {}
  });
}

// 销毁桌面歌词窗口 (主窗口关闭 / before-quit 时调用)
function destroyDesktopLyricWindow() {
  const lyricWin = state.getLyricWin();
  if (lyricWin && !lyricWin.isDestroyed()) {
    lyricWin.destroy();
  }
  state.setLyricWin(null);
}

// 显示/隐藏桌面歌词窗口
ipcMain.handle('lyric-toggle', (event, show) => {
  if (!state.getLyricWin() || state.getLyricWin().isDestroyed()) createDesktopLyricWindow();
  const lyricWin = state.getLyricWin();
  if (!lyricWin) return false;
  if (show) {
    lyricWin.show();
    // 兜底: Windows 上 show:false 创建的窗口首次 show() 后 skipTaskbar 可能失效,
    // 导致任务栏悬停出现歌词+主界面两个预览, show 后重新设置
    try { lyricWin.setSkipTaskbar(true); } catch (e) {}
    return true;
  }
  lyricWin.hide();
  return false;
});

// 锁定桌面歌词(鼠标穿透, 点击穿过到下层窗口)
ipcMain.handle('lyric-lock', (event, locked) => {
  const lyricWin = state.getLyricWin();
  if (!lyricWin || lyricWin.isDestroyed()) return;
  lyricWin.setIgnoreMouseEvents(locked, { forward: true });
});

// 锁定状态下临时恢复/恢复穿透交互 (鼠标悬停控制按钮时恢复交互, 离开后继续穿透)
// 配合渲染进程: forward:true 只转发 mousemove, 点击永远穿透, 必须显式切换交互状态
ipcMain.handle('lyric-set-interactive', (event, interactive) => {
  const lyricWin = state.getLyricWin();
  if (!lyricWin || lyricWin.isDestroyed()) return;
  if (interactive) {
    lyricWin.setIgnoreMouseEvents(false);
  } else {
    // 恢复穿透(锁定态), forward 保持 mousemove 转发以持续检测按钮悬停
    lyricWin.setIgnoreMouseEvents(true, { forward: true });
  }
});

// 设置桌面歌词窗口位置 (null=重置到默认居中, [x,y]=指定位置)
ipcMain.handle('lyric-set-position', (event, pos) => {
  const lyricWin = state.getLyricWin();
  if (!lyricWin || lyricWin.isDestroyed()) return false;
  try {
    if (pos === null) {
      // 重置到默认居中位置
      const display = screen.getPrimaryDisplay();
      const w = 900, h = 140;
      const x = Math.round((display.workAreaSize.width - w) / 2);
      const y = display.workAreaSize.height - h - 80;
      lyricWin.setPosition(x, y);
      _saveLyricBounds(null);  // 清除保存的位置
    } else if (Array.isArray(pos) && pos.length === 2) {
      lyricWin.setPosition(pos[0], pos[1]);
      _saveLyricBounds(pos);
    }
    return true;
  } catch (e) {
    return false;
  }
});

// 主进程转发歌词数据/时间到桌面歌词窗口
// 注意: 不检查 lyricWin.isVisible(), 因为主窗口最小化时仍需转发时间
ipcMain.on('lyric-data', (event, payload) => {
  state.sendToLyric('lyric-update', payload);
});

// 桌面歌词窗口通过X按钮关闭时, 通知主窗口同步按钮状态
ipcMain.on('lyric-closed-by-user', (event) => {
  state.sendToMain('lyric-closed-by-user');
});

module.exports = { createDesktopLyricWindow, destroyDesktopLyricWindow };
