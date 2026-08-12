// =========== 主窗口创建 + 窗口控制 IPC ===========
// transparent:true + frame:false 自定义标题栏; Windows 11 需 DWM API 手动恢复圆角
// 最大化/还原用手动保存/恢复 bounds (transparent 下 unmaximize() 不可靠)
// 关闭按钮隐藏到托盘, 仅托盘右键"退出"才真正退出
const path = require('path');
const { BrowserWindow, ipcMain, Tray, Menu, nativeImage, app } = require('electron');
const state = require('../core/state');
const { createDesktopLyricWindow, destroyDesktopLyricWindow } = require('./desktop-lyric');

let tray = null;
let isQuitting = false;

// 创建托盘图标 (无外部图标文件, 用 nativeImage 生成 16x16 粉色方块)
function createTrayIcon() {
  const width = 16, height = 16;
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buffer[i * 4] = 251;     // R
    buffer[i * 4 + 1] = 114; // G
    buffer[i * 4 + 2] = 153; // B
    buffer[i * 4 + 3] = 255; // A
  }
  return nativeImage.createFromBuffer(buffer, { width, height });
}

function createTray(mainWindow) {
  if (tray) return tray;
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Wuu 音乐');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  // 单击托盘图标: 显示主窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        // 已显示则不隐藏 (避免误操作), 仅聚焦
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  return tray;
}

// Windows 11 DWM 圆角支持
// transparent:true 会让 Windows 11 丢失系统圆角，需要通过 DWM API 手动设回
// DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2
function setWindowRoundedCorners(win) {
  if (process.platform !== 'win32') return;
  try {
    const hwnd = win.getNativeWindowHandle();
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(BigInt(hwnd.readUInt32LE(0)));
    const { execSync } = require('child_process');
    // 使用 PowerShell + Add-Type 调用 DwmSetWindowAttribute
    const ps = `
      Add-Type -TypeDefinition '
        using System;
        using System.Runtime.InteropServices;
        public class Dwm {
          [DllImport("dwmapi.dll", PreserveSig = false)]
          public static extern void DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
        }
      ' -PassThru | Out-Null;
      [Dwm]::DwmSetWindowAttribute([IntPtr]${hwnd.readUInt32LE(0)}, 33, [ref]2, 4)
    `;
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { timeout: 3000 });
  } catch (e) {
    // 非Win11可忽略
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: 'Wuu 音乐',
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  state.setMainWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 临时: Ctrl+Shift+I 打开 DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // [DEBUG] 转发渲染进程 console 到主进程终端, 便于在不打开 F12 时排查问题
  mainWindow.webContents.on('console-message', (event) => {
    const levelTag = ['LOG', 'WARN', 'ERROR'][event.level] || 'LOG';
    const src = event.sourceId ? event.sourceId.replace(/^file:\/\/\/[^:]*\/renderer\//, '') : '';
    console.log(`[renderer:${levelTag}] ${event.message}${src ? ` (${src}:${event.line})` : ''}`);
  });

  // 窗口就绪后恢复 Windows 11 圆角
  mainWindow.once('ready-to-show', () => {
    setWindowRoundedCorners(mainWindow);
  });

  // 窗口最大化/还原时通知渲染进程更新图标
  mainWindow.on('maximize', () => {
    state.setManualMaximized(true);
    if (!state.getSavedBounds()) state.setSavedBounds(mainWindow.getBounds());
    mainWindow.webContents.send('window-state', true);
  });
  mainWindow.on('unmaximize', () => {
    state.setManualMaximized(false);
    mainWindow.webContents.send('window-state', false);
  });

  // 主窗口关闭时销毁桌面歌词窗口
  // 否则 lyricWin (skipTaskbar + alwaysOnTop) 会残留桌面, 且其本地 RAF 继续走字
  // 同时确保 window-all-closed 能触发, 让 app 正常退出
  mainWindow.on('closed', () => {
    destroyDesktopLyricWindow();
    state.setMainWindow(null);
  });

  // 拦截关闭按钮: 隐藏到托盘而非真正退出 (除非是从托盘"退出"触发)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    // isQuitting=true 时放行, 让 closed 事件正常触发
  });

  // 创建系统托盘
  createTray(mainWindow);

  createDesktopLyricWindow();
}

// 窗口控制(最小化/最大化/关闭)
// 注意: transparent:true + frame:false 下, Windows 的 unmaximize() 不可靠
// 用手动保存/恢复 bounds 的方式替代
ipcMain.handle('window-minimize', () => { state.getMainWindow()?.minimize(); });
ipcMain.handle('window-maximize', () => {
  const mainWindow = state.getMainWindow();
  if (!mainWindow) return false;
  if (state.isManualMaximized() || mainWindow.isMaximized()) {
    // 还原
    const savedBounds = state.getSavedBounds();
    if (savedBounds) {
      mainWindow.setBounds(savedBounds);
    } else {
      mainWindow.unmaximize();
    }
    state.setManualMaximized(false);
    return false;
  } else {
    // 最大化
    state.setSavedBounds(mainWindow.getBounds());
    mainWindow.maximize();
    state.setManualMaximized(true);
    return true;
  }
});
ipcMain.handle('window-close', () => { state.getMainWindow()?.close(); });
// 真正退出 (从托盘"退出"或 UI 主动退出, 绕过 hide-to-tray)
ipcMain.handle('window-quit', () => {
  isQuitting = true;
  app.quit();
});

// 销毁托盘 (app 退出前清理)
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createWindow, setWindowRoundedCorners, destroyTray };
