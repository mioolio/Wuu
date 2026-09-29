// =========== 免费听音乐专区: music-dl.exe web 服务管理 ===========
// 后台启动 music-dl.exe web 服务, 通过 HTTP API 提供搜索/试听/下载/歌词能力
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { dbgLog, dbgErr } = require('../core/logger');

const FREE_MUSIC_PORT = 17324;  // 固定端口, 避免与常用端口冲突
const MUSIC_DL_EXE = path.join(__dirname, '..', 'music-dl.exe');
const FREE_MUSIC_BASE = `http://127.0.0.1:${FREE_MUSIC_PORT}`;

let musicDlProcess = null;
let musicDlReady = false;

function isReady() { return musicDlReady; }
function getBase() { return FREE_MUSIC_BASE; }

function startMusicDlService() {
  if (musicDlProcess) return;
  if (!fs.existsSync(MUSIC_DL_EXE)) {
    dbgErr('[FREE-MUSIC] music-dl.exe 不存在:', MUSIC_DL_EXE);
    return;
  }
  dbgLog('[FREE-MUSIC] 正在启动 music-dl.exe, port=' + FREE_MUSIC_PORT + ', exe=' + MUSIC_DL_EXE);
  try {
    musicDlProcess = spawn(MUSIC_DL_EXE, [
      'web',
      '--port', String(FREE_MUSIC_PORT),
      '--no-browser',
      '--desktop',
    ], {
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dbgLog('[FREE-MUSIC] music-dl.exe 已 spawn, pid=' + musicDlProcess.pid);
    musicDlProcess.stdout.on('data', (d) => {
      const s = d.toString().trim();
      if (!s) return;
      // 过滤 GIN 请求日志, 只保留关键事件(服务就绪)和严重错误(fatal/panic)
      if (s.includes('Web started at')) {
        musicDlReady = true;
        dbgLog('[FREE-MUSIC] music-dl.exe 服务就绪');
      } else if (/fatal|panic|\[ERROR\]/i.test(s)) {
        dbgErr('[music-dl]', s);
      }
      // 其他 stdout(GIN 请求日志等)静默丢弃, 避免终端刷屏
    });
    musicDlProcess.stderr.on('data', (d) => {
      const s = d.toString().trim();
      if (!s) return;
      // stderr 通常是严重错误, 但过滤掉 GIN 的非错误噪音
      if (/fatal|panic|error|refused|timeout/i.test(s)) {
        dbgErr('[music-dl stderr]', s);
      }
    });
    musicDlProcess.on('exit', (code) => {
      dbgErr('[FREE-MUSIC] music-dl.exe 退出, code=' + code);
      musicDlProcess = null;
      musicDlReady = false;
    });
    musicDlProcess.on('error', (e) => {
      dbgErr('[FREE-MUSIC] music-dl.exe spawn error:', e.message);
    });
  } catch (e) {
    dbgErr('[FREE-MUSIC] 启动 music-dl.exe 失败:', e.message);
  }
}

function stopMusicDlService() {
  if (musicDlProcess) {
    try { musicDlProcess.kill(); } catch (e) {}
    musicDlProcess = null;
    musicDlReady = false;
  }
}

module.exports = { startMusicDlService, stopMusicDlService, isReady, getBase, FREE_MUSIC_BASE };
