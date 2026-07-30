// =========== Wuu 音乐 - 主进程入口 ===========
// 仅负责: 协议注册 / 菜单移除 / 模块装配 / music:// 协议处理 / 应用生命周期
// 所有功能逻辑已拆分到各功能目录模块, require 即自动注册 IPC handlers
const { app, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// Windows 终端默认 GBK 编码, 中文日志输出乱码 (如 "解析链接失败" → "瑙ｆ瀽閾炬帴澶辫触")
// 强制 stdout/stderr 以 UTF-8 编码输出, 让 console.error 在 PowerShell/CMD 中正确显示中文
if (process.platform === 'win32') {
  try {
    if (process.stdout && typeof process.stdout.setEncoding === 'function') {
      process.stdout.setEncoding('utf-8');
    }
    if (process.stderr && typeof process.stderr.setEncoding === 'function') {
      process.stderr.setEncoding('utf-8');
    }
  } catch (e) {}
}

// 注册 music:// 协议为特权协议, 必须在 app.whenReady() 之前调用
protocol.registerSchemesAsPrivileged([
  { scheme: 'music', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

// 移除顶部 File/Edit 等原生菜单 (应用不需要这些)
Menu.setApplicationMenu(null);

// =========== 装配各功能模块 (require 即自动注册 IPC handlers) ===========
// 基础层: 日志 / 共享状态 / 配置存储 / 网络工具
require('./core/logger');
require('./core/state');
require('./core/storage');
require('./core/network');
// 音频层: 扫描 / 时长解析 / 文件校验
require('./audio/scanner');
require('./audio/duration');
require('./audio/verify');
// Soda 音频解密 (AES-CTR + MP4 box 原语)
require('./soda/decrypt');
// 封面色彩提取
require('./cover/color');
// 窗口管理: 主窗口 + 桌面歌词窗口
const { createWindow, destroyTray } = require('./window/main-window');
const { destroyDesktopLyricWindow } = require('./window/desktop-lyric');
// 在线解析下载 + 损坏歌曲修复
require('./download');
require('./repair');
// 免费听音乐专区 (music-dl.exe web 服务 + IPC)
const { startMusicDlService, stopMusicDlService } = require('./free-music/service');
require('./free-music/ipc');
// 酷狗音乐歌单导入 (多账号配置 + 登录刷新 + IPC)
require('./kugou/config');
require('./kugou/auth');
require('./kugou/ipc');
// 汽水音乐服务 (工具函数 + IPC)
require('./qishui/utils');
require('./qishui/ipc');
// 网易云音乐歌单导入 (多账号配置 + IPC, 复用 NeteaseCloudMusicApi)
require('./netease/config');
require('./netease/ipc');
// 本地 HTTP 服务器 (歌单分享, 默认端口 30967)
const { startServer, stopServer } = require('./server');
// 歌单导出导入 (wuu:// 协议 + 远程拉取下载)
require('./playlist/share');

// =========== music:// 协议处理 ===========
// 用 Node.js fs 读取文件, 绕过 Chromium file:/// 的 MAX_PATH 260 限制
app.whenReady().then(() => {
  protocol.handle('music', (request) => {
    // music:///F:/path/to/file.aac → 解码出本地路径
    let urlStr = request.url;
    // 去掉协议前缀, 保留路径
    if (urlStr.startsWith('music:///')) {
      urlStr = urlStr.slice('music:///'.length);
    } else if (urlStr.startsWith('music://')) {
      urlStr = urlStr.slice('music://'.length);
    }
    let filePath = decodeURIComponent(urlStr);
    // 还原 Windows 路径分隔符
    filePath = filePath.replace(/\//g, '\\');
    // 根据扩展名设置 Content-Type
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.aac': 'audio/aac',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    try {
      if (!fs.existsSync(filePath)) {
        return new Response(null, { status: 404, statusText: 'File not found' });
      }
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      // 解析 Range 请求: <audio> 元素缓冲/跳转时发送 Range: bytes=start-end
      const rangeHeader = request.headers.get('range') || request.headers.get('Range');
      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (match) {
          const start = match[1] ? parseInt(match[1]) : 0;
          const end = match[2] ? parseInt(match[2]) : fileSize - 1;
          const chunkSize = end - start + 1;
          const stream = fs.createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(stream), {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(chunkSize),
              'Accept-Ranges': 'bytes',
            }
          });
        }
      }
      // 无 Range 头: 返回完整文件
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        }
      });
    } catch (e) {
      return new Response(null, { status: 500, statusText: e.message });
    }
  });
  createWindow();
  // 启动免费听音乐专区的 music-dl.exe web 服务
  startMusicDlService();
  // 启动歌单分享 HTTP 服务器 (仅在用户开启网络服务时启动, 默认关闭)
  // 支持绑定IP (0.0.0.0=所有网卡 / 特定IP) + 客户端白名单
  try {
    const { readUserData } = require('./core/storage');
    const ud = readUserData();
    if (ud.settings && ud.settings.serverEnabled === true) {
      startServer(
        ud.settings.serverPort || 30967,
        ud.settings.serverBindIP || '0.0.0.0',
        ud.settings.serverWhitelist || [],
        ud.settings.serverRateLimit || 0,
        ud.settings.serverAccessLog === true
      );
    }
  } catch (e) {}
});

// =========== 应用生命周期 ===========
// 关闭按钮隐藏到托盘, window-all-closed 不再退出 app
// 仅托盘右键"退出"或 app.quit() 才真正退出
app.on('window-all-closed', () => {
  // 不退出: 窗口隐藏到托盘时也会触发 window-all-closed, 但 app 应继续运行
  // 仅在 macOS 上保持窗口栏可见 (本项目仅 Windows, 此分支不会触发)
});
app.on('before-quit', () => {
  stopMusicDlService();
  stopServer();
  // 双保险: 确保桌面歌词窗口被销毁(避免僵尸进程)
  destroyDesktopLyricWindow();
  destroyTray();
});
