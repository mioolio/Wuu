// =========== 主进程共享状态 ===========
// 集中持有跨模块共享的可变引用 (主窗口 / 桌面歌词窗口 / 窗口几何状态等)
// 提供 sendToMain / sendToLyric 辅助函数, 统一处理窗口销毁检查, 避免各模块重复判断
let mainWindow = null;
let lyricWin = null;
let savedBounds = null;
let manualMaximized = false;

function getMainWindow() { return mainWindow; }
function setMainWindow(w) { mainWindow = w; }
function getLyricWin() { return lyricWin; }
function setLyricWin(w) { lyricWin = w; }
function getSavedBounds() { return savedBounds; }
function setSavedBounds(b) { savedBounds = b; }
function isManualMaximized() { return manualMaximized; }
function setManualMaximized(v) { manualMaximized = v; }

// 向主窗口渲染进程发消息 (窗口可能已销毁, 统一做安全检查)
function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// 向桌面歌词窗口发消息
function sendToLyric(channel, payload) {
  if (lyricWin && !lyricWin.isDestroyed()) {
    lyricWin.webContents.send(channel, payload);
  }
}

module.exports = {
  getMainWindow, setMainWindow,
  getLyricWin, setLyricWin,
  getSavedBounds, setSavedBounds,
  isManualMaximized, setManualMaximized,
  sendToMain, sendToLyric,
};
