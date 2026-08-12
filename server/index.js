// =========== 本地 HTTP 服务器 (默认端口 30967) ===========
// 用于歌单分享: 提供 GET /playlist/:id 接口供远程拉取
// 导出歌单时生成 wuu://<base64> 链接, 导入时解析后与远程地址拼接下载
// 支持 IP 绑定 (0.0.0.0=所有网卡 / 特定IP) + 客户端白名单访问控制
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { configDir } = require('../core/storage');
const { dbgLog, dbgErr } = require('../core/logger');

const DEFAULT_PORT = 30967;
let _server = null;
let _port = DEFAULT_PORT;
let _bindIP = '0.0.0.0';  // 绑定IP: 0.0.0.0=监听所有网卡, 127.0.0.1=仅本机, 特定IP=指定网卡
let _whitelist = [];  // 客户端IP白名单: 空数组=允许所有, 非空=仅允许白名单内IP
let _rateLimit = 0;  // 频率限制: 每IP每分钟最大请求数 (0=不限制)
let _accessLogEnabled = false;  // 是否开启访问日志记录
let _accessLogs = [];  // 访问日志数组 (内存中, 最多保留 500 条)
const MAX_ACCESS_LOGS = 500;
// 频率限制计数: Map<ip, number[]>  每个 IP 维护最近请求时间戳数组
let _rateBuckets = new Map();
const RATE_WINDOW_MS = 60 * 1000;  // 1 分钟滚动窗口

// 移动端 UI 静态文件目录 (Vue 构建产物)
const mobileDir = path.join(__dirname, '..', 'mobile_UI', 'dist');
// MIME 类型映射 (静态文件 + 音频/图片)
const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
};

// =========== 歌曲列表缓存 (模块作用域, 所有请求共享) ===========
// 缓存: 避免每次请求都重新扫描 1968 个文件夹 (同步 I/O 阻塞主进程 3-4 秒)
// 统一缓存: scanMusicFiles() 只调用一次, 同时生成脱敏列表和原始列表
// Worker 线程: 扫描在子线程执行, 不阻塞主进程 (电脑端播放不受影响)
let _rawSongsCache = null;
let _safeSongsCache = null;
let _songsCacheTime = 0;
const SONGS_CACHE_TTL = 10 * 60 * 1000;  // 10 分钟自动刷新
let _scanWorker = null;
let _scanPromise = null;  // 正在进行的扫描 Promise (避免并发扫描)

// 启动 worker 扫描歌曲, 返回 Promise<songs>
function scanSongsAsync() {
  // 复用进行中的扫描
  if (_scanPromise) return _scanPromise;

  _scanPromise = new Promise((resolve, reject) => {
    const t0 = Date.now();
    const worker = new Worker(path.join(__dirname, 'scanner-worker.js'));
    worker.on('message', (msg) => {
      if (msg && msg.type === 'scan-result') {
        worker.terminate();
        _scanPromise = null;
        if (msg.ok) {
          console.log('[server] worker 扫描完成: ' + msg.songs.length + ' 首, 耗时 ' + (Date.now() - t0) + 'ms');
          resolve(msg.songs);
        } else {
          console.error('[server] worker 扫描失败:', msg.error);
          reject(new Error(msg.error));
        }
      }
    });
    worker.on('error', (e) => {
      _scanPromise = null;
      console.error('[server] worker 错误:', e.message);
      reject(e);
    });
    worker.postMessage({ type: 'scan' });
  });

  return _scanPromise;
}

// 确保缓存有效, 返回 true 表示缓存可用 (可能触发后台刷新)
function isCacheValid() {
  const now = Date.now();
  return _rawSongsCache && (now - _songsCacheTime) < SONGS_CACHE_TTL;
}

// 同步获取缓存 (不触发扫描, 缓存为空时返回 null)
function getSafeSongsSync() {
  return isCacheValid() ? _safeSongsCache : null;
}
function getRawSongsSync() {
  return isCacheValid() ? _rawSongsCache : null;
}

// 异步获取缓存 (缓存为空时触发 worker 扫描)
async function getSafeSongsAsync() {
  if (isCacheValid()) return _safeSongsCache;
  const raw = await scanSongsAsync();
  _rawSongsCache = raw;
  _safeSongsCache = raw.map(s => ({
    id: s.id,
    songName: s.songName || '',
    artist: s.artist || '',
    album: s.album || '',
    realDuration: s.realDuration || 0,
    lyricist: s.lyricist || '',
    composer: s.composer || '',
    hasCover: !!s.coverPath,
    hasLyric: !!(s.rawPath || s.lrcPath),
  }));
  _songsCacheTime = Date.now();
  return _safeSongsCache;
}

async function getRawSongsAsync() {
  if (isCacheValid()) return _rawSongsCache;
  const raw = await scanSongsAsync();
  _rawSongsCache = raw;
  _safeSongsCache = raw.map(s => ({
    id: s.id,
    songName: s.songName || '',
    artist: s.artist || '',
    album: s.album || '',
    realDuration: s.realDuration || 0,
    lyricist: s.lyricist || '',
    composer: s.composer || '',
    hasCover: !!s.coverPath,
    hasLyric: !!(s.rawPath || s.lrcPath),
  }));
  _songsCacheTime = Date.now();
  return _rawSongsCache;
}

// 刷新缓存 (强制重新扫描)
async function refreshSongList() {
  _rawSongsCache = null;
  _safeSongsCache = null;
  _songsCacheTime = 0;
  _scanPromise = null;
  const safe = await getSafeSongsAsync();
  return safe.length;
}

// 后台预热缓存 (服务器启动后立即扫描一次, 后续请求直接命中)
function warmupCache() {
  if (isCacheValid()) return;
  getSafeSongsAsync().catch(e => console.error('[server] 缓存预热失败:', e.message));
}

// 分享歌单存储目录
const sharedDir = path.join(configDir, 'shared');
function ensureSharedDir() {
  if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });
}

// 提取客户端真实IP (处理代理头)
function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
}

// 白名单校验: 空白名单允许所有, 非空白名单仅允许列表内IP
function checkWhitelist(req) {
  if (!_whitelist.length) return true;  // 空白名单 = 允许所有
  const clientIP = getClientIP(req);
  // 本机访问始终放行
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::') return true;
  return _whitelist.some(allowed => {
    // 支持通配符: 192.168.*.*
    if (allowed.includes('*')) {
      const regex = new RegExp('^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '[0-9]+') + '$');
      return regex.test(clientIP);
    }
    return allowed === clientIP;
  });
}

// 频率限制校验: 每IP每分钟内请求数超过 _rateLimit 则拒绝
// _rateLimit=0 表示不限制
function checkRateLimit(req) {
  if (!_rateLimit || _rateLimit <= 0) return true;
  const clientIP = getClientIP(req);
  // 本机访问不受频率限制
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::') return true;
  const now = Date.now();
  let bucket = _rateBuckets.get(clientIP);
  if (!bucket) {
    bucket = [];
    _rateBuckets.set(clientIP, bucket);
  }
  // 移除窗口外的旧时间戳
  const cutoff = now - RATE_WINDOW_MS;
  while (bucket.length > 0 && bucket[0] < cutoff) bucket.shift();
  if (bucket.length >= _rateLimit) return false;
  bucket.push(now);
  return true;
}

// 记录访问日志: IP + 路径 + 操作描述 + 时间戳
// action: '访问歌单' / '下载歌曲' / '获取封面' / '获取歌词' / '其他'
// detail: 歌曲名等附加信息 (可选)
function logAccess(req, action, detail) {
  if (!_accessLogEnabled) return;
  const clientIP = getClientIP(req);
  const entry = {
    ts: Date.now(),
    ip: clientIP,
    path: req.url || '',
    action: action || '其他',
    detail: detail || '',
  };
  _accessLogs.unshift(entry);  // 最新的放最前
  if (_accessLogs.length > MAX_ACCESS_LOGS) {
    _accessLogs.length = MAX_ACCESS_LOGS;
  }
}

function startServer(port, bindIP, whitelist, rateLimit, accessLogEnabled) {
  if (_server) return _port;
  ensureSharedDir();
  _port = port || DEFAULT_PORT;
  _bindIP = bindIP || '0.0.0.0';
  _whitelist = Array.isArray(whitelist) ? whitelist.filter(ip => ip && ip.trim()) : [];
  _rateLimit = Math.max(0, parseInt(rateLimit, 10) || 0);
  _accessLogEnabled = accessLogEnabled === true;
  _accessLogs = [];
  _rateBuckets = new Map();
  _server = http.createServer(async (req, res) => {
    // CORS 头, 允许远程客户端拉取
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // 白名单校验: 非空白名单时仅允许列表内IP访问
    if (!checkWhitelist(req)) {
      const clientIP = getClientIP(req);
      dbgLog(`[SERVER] 拒绝访问: IP ${clientIP} 不在白名单内`);
      if (_accessLogEnabled) logAccess(req, '拒绝访问', '不在白名单');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'IP 不在访问白名单内' }));
      return;
    }

    // 频率限制校验: 超出每分钟请求数则拒绝
    if (!checkRateLimit(req)) {
      const clientIP = getClientIP(req);
      dbgLog(`[SERVER] 频率限制: IP ${clientIP} 每分钟超过 ${_rateLimit} 次`);
      if (_accessLogEnabled) logAccess(req, '频率超限', `${_rateLimit}/分钟`);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: '请求过于频繁, 请稍后再试' }));
      return;
    }

    const url = new URL(req.url, `http://localhost:${_port}`);
    const pathname = url.pathname;

    // 访问令牌校验: 从 ?k= 读取, 与歌单 JSON 内的 accessKey 比对
    // 路由端数据明文, 但需随机 accessKey 才能访问
    function checkAccess(playlist, id) {
      if (!playlist.accessKey) return true; // 无 accessKey 的旧歌单放行
      const token = url.searchParams.get('k') || '';
      if (!token || token !== playlist.accessKey) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '访问密钥无效' }));
        return false;
      }
      return true;
    }
    // 过期/次数校验: 检查 expireAt + maxUses + usedCount
    // 返回 true 通过, false 已拒绝 (响应已发送)
    function checkExpiry(playlist, id) {
      const now = Date.now();
      // 过期检查
      if (playlist.expireAt && playlist.expireAt > 0 && now > playlist.expireAt) {
        if (_accessLogEnabled) logAccess(req, '访问歌单失败', `${playlist.name || ''} 已过期`);
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '分享链接已过期' }));
        return false;
      }
      // 次数检查
      if (playlist.maxUses && playlist.maxUses > 0
          && (playlist.usedCount || 0) >= playlist.maxUses) {
        if (_accessLogEnabled) logAccess(req, '访问歌单失败', `${playlist.name || ''} 已达访问次数上限`);
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '分享链接已达访问次数上限' }));
        return false;
      }
      return true;
    }
    // 读取歌单 JSON 并校验 accessKey + 过期/次数, 失败返回 null
    // incrementUse: 是否在通过校验后递增 usedCount (仅 /playlist 路由递增, 流/封面/歌词不递增)
    function loadPlaylistWithAccess(id, incrementUse) {
      const filePath = path.join(sharedDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '歌单不存在' }));
        return null;
      }
      try {
        const playlist = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!checkAccess(playlist, id)) return null;
        if (!checkExpiry(playlist, id)) return null;
        // 仅 /playlist 路由递增 usedCount, 每次访问歌单算 1 次
        // /stream /cover /lyric 不单独计数 (属于同一访问会话内的子请求)
        if (incrementUse) {
          playlist.usedCount = (playlist.usedCount || 0) + 1;
          try {
            fs.writeFileSync(filePath, JSON.stringify(playlist, null, 2), 'utf-8');
          } catch (e) {
            dbgErr('[SERVER] 递增 usedCount 失败:', e.message);
          }
        }
        return playlist;
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
        return null;
      }
    }

    // GET /playlist/:id → 校验 accessKey + 过期/次数 后返回歌单 JSON, 并递增 usedCount
    const plMatch = pathname.match(/^\/playlist\/([a-zA-Z0-9_-]+)$/);
    if (plMatch && req.method === 'GET') {
      const id = plMatch[1];
      const filePath = path.join(sharedDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '歌单不存在' }));
        return;
      }
      try {
        const playlist = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!checkAccess(playlist, id)) {
          if (_accessLogEnabled) logAccess(req, '访问歌单失败', `id=${id} 密钥无效`);
          return;
        }
        if (!checkExpiry(playlist, id)) return;
        // 递增 usedCount (一次性写入, 防止并发刷次数)
        playlist.usedCount = (playlist.usedCount || 0) + 1;
        try {
          fs.writeFileSync(filePath, JSON.stringify(playlist, null, 2), 'utf-8');
        } catch (e) {
          dbgErr('[SERVER] 递增 usedCount 失败:', e.message);
        }
        // 返回时移除 accessKey 字段
        const { accessKey, ...safeData } = playlist;
        logAccess(req, '访问歌单', `${playlist.name || ''} (${playlist.songCount || 0} 首) [${playlist.usedCount}/${playlist.maxUses || '∞'}]`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(safeData));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /stream/:id/:songIndex → 校验 accessKey 后流式返回音频文件
    const streamMatch = pathname.match(/^\/stream\/([a-zA-Z0-9_-]+)\/(\d+)$/);
    if (streamMatch && req.method === 'GET') {
      const id = streamMatch[1];
      const songIndex = parseInt(streamMatch[2], 10);
      const playlist = loadPlaylistWithAccess(id);
      if (!playlist) return;
      try {
        const song = (playlist.songs || [])[songIndex];
        if (!song || !song.audioPath) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '歌曲不存在' }));
          return;
        }
        const audioPath = song.audioPath;
        if (!fs.existsSync(audioPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '音频文件不存在' }));
          return;
        }
        const stat = fs.statSync(audioPath);
        const ext = path.extname(audioPath).toLowerCase();
        const mimeTypes = {
          '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
          '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        // 记录下载日志: 歌曲名 + 艺人
        const songDesc = `${song.songName || '未知歌曲'} - ${song.artist || ''}`;
        logAccess(req, '下载歌曲', songDesc);
        // Range 请求支持
        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? parseInt(match[1]) : 0;
            const end = match[2] ? parseInt(match[2]) : stat.size - 1;
            const stream = fs.createReadStream(audioPath, { start, end });
            res.writeHead(206, {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Content-Length': end - start + 1,
              'Accept-Ranges': 'bytes',
            });
            stream.pipe(res);
            return;
          }
        }
        const stream = fs.createReadStream(audioPath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
        });
        stream.pipe(res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /cover/:id/:songIndex → 校验 accessKey 后返回封面图片
    const coverMatch = pathname.match(/^\/cover\/([a-zA-Z0-9_-]+)\/(\d+)$/);
    if (coverMatch && req.method === 'GET') {
      const id = coverMatch[1];
      const songIndex = parseInt(coverMatch[2], 10);
      const playlist = loadPlaylistWithAccess(id);
      if (!playlist) return;
      try {
        const song = (playlist.songs || [])[songIndex];
        if (!song || !song.coverPath || !fs.existsSync(song.coverPath)) {
          res.writeHead(404); res.end(); return;
        }
        const ext = path.extname(song.coverPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
        logAccess(req, '获取封面', `${song.songName || '未知歌曲'} - ${song.artist || ''}`);
        const stream = fs.createReadStream(song.coverPath);
        res.writeHead(200, { 'Content-Type': mime });
        stream.pipe(res);
      } catch (e) {
        res.writeHead(500); res.end();
      }
      return;
    }

    // GET /lyric/:id/:songIndex → 校验 accessKey 后返回歌词文本
    const lrcMatch = pathname.match(/^\/lyric\/([a-zA-Z0-9_-]+)\/(\d+)$/);
    if (lrcMatch && req.method === 'GET') {
      const id = lrcMatch[1];
      const songIndex = parseInt(lrcMatch[2], 10);
      const playlist = loadPlaylistWithAccess(id);
      if (!playlist) return;
      try {
        const song = (playlist.songs || [])[songIndex];
        const lrcPath = song.rawPath || song.lrcPath;
        if (!lrcPath || !fs.existsSync(lrcPath)) {
          res.writeHead(404); res.end(); return;
        }
        const text = fs.readFileSync(lrcPath, 'utf-8');
        logAccess(req, '获取歌词', `${song.songName || '未知歌曲'} - ${song.artist || ''}`);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
      } catch (e) {
        res.writeHead(500); res.end();
      }
      return;
    }

    // GET /ping → 健康检查
    if (pathname === '/ping' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, port: _port }));
      return;
    }

    // =========== 移动端 UI + API ===========
    // 缓存变量和扫描函数在模块作用域定义 (上方), 此处直接调用

    // GET /favicon.ico → 返回空图标 (避免 404)
    if (pathname === '/favicon.ico' && req.method === 'GET') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET / 或 /index.html → 返回移动端 UI 首页 (Vue 构建产物)
    if ((pathname === '/' || pathname === '/index.html') && req.method === 'GET') {
      const indexPath = path.join(mobileDir, 'index.html');
      if (!fs.existsSync(indexPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('移动端 UI 尚未构建, 请在 mobile_UI 目录执行 npm run build');
        return;
      }
      const html = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // GET /assets/* → 返回 Vue 构建的静态资源 (JS/CSS/图片/字体)
    if (pathname.startsWith('/assets/') && req.method === 'GET') {
      const relPath = pathname.slice('/assets/'.length);
      // 防止路径穿越: 拒绝包含 .. 的请求
      if (relPath.includes('..')) {
        res.writeHead(403); res.end(); return;
      }
      const filePath = path.join(mobileDir, 'assets', relPath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404); res.end(); return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
      const stream = fs.createReadStream(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      stream.pipe(res);
      return;
    }

    // GET /api/refresh → 手动刷新歌曲列表缓存 (新增歌曲后调用)
    if (pathname === '/api/refresh' && req.method === 'GET') {
      try {
        const count = await refreshSongList();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, count }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /api/random → 返回一首随机歌曲 (推荐页首次点击播放用)
    if (pathname === '/api/random' && req.method === 'GET') {
      try {
        const safe = await getSafeSongsAsync();
        if (!safe.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '歌库为空' }));
          return;
        }
        const idx = Math.floor(Math.random() * safe.length);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, song: safe[idx], index: idx, total: safe.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /api/songs?page=N&pageSize=M → 分页返回歌库列表 (从缓存 slice, 极快)
    if (pathname === '/api/songs' && req.method === 'GET') {
      try {
        const safe = await getSafeSongsAsync();
        const urlObj = new URL(req.url, 'http://localhost');
        const page = parseInt(urlObj.searchParams.get('page') || '0', 10);
        const pageSize = parseInt(urlObj.searchParams.get('pageSize') || '0', 10);
        if (page > 0 && pageSize > 0) {
          const start = (page - 1) * pageSize;
          const end = start + pageSize;
          const paged = safe.slice(start, end);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ok: true,
            songs: paged,
            total: safe.length,
            page,
            pageSize,
            hasMore: end < safe.length,
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, songs: safe, total: safe.length }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /api/stream/:index → 流式返回音频, 支持 Range 请求 (seek)
    const apiStreamMatch = pathname.match(/^\/api\/stream\/(\d+)$/);
    if (apiStreamMatch && req.method === 'GET') {
      try {
        const songs = await getRawSongsAsync();
        const idx = parseInt(apiStreamMatch[1], 10);
        const song = songs[idx];
        if (!song || !song.audioPath || !fs.existsSync(song.audioPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '歌曲不存在' }));
          return;
        }
        const stat = fs.statSync(song.audioPath);
        const ext = path.extname(song.audioPath).toLowerCase();
        const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
        logAccess(req, '播放歌曲', `${song.songName || ''} - ${song.artist || ''}`);
        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? parseInt(match[1]) : 0;
            const end = match[2] ? parseInt(match[2]) : stat.size - 1;
            const stream = fs.createReadStream(song.audioPath, { start, end });
            res.writeHead(206, {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Content-Length': end - start + 1,
              'Accept-Ranges': 'bytes',
            });
            stream.pipe(res);
            return;
          }
        }
        const stream = fs.createReadStream(song.audioPath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
        });
        stream.pipe(res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
      return;
    }

    // GET /api/cover/:index → 返回封面图片
    const apiCoverMatch = pathname.match(/^\/api\/cover\/(\d+)$/);
    if (apiCoverMatch && req.method === 'GET') {
      try {
        const songs = await getRawSongsAsync();
        const idx = parseInt(apiCoverMatch[1], 10);
        const song = songs[idx];
        if (!song || !song.coverPath || !fs.existsSync(song.coverPath)) {
          res.writeHead(404); res.end(); return;
        }
        const ext = path.extname(song.coverPath).toLowerCase();
        const mime = STATIC_MIME_TYPES[ext] || 'image/jpeg';
        const stream = fs.createReadStream(song.coverPath);
        res.writeHead(200, { 'Content-Type': mime });
        stream.pipe(res);
      } catch (e) {
        res.writeHead(500); res.end();
      }
      return;
    }

    // GET /api/lyric/:index → 返回歌词文本
    // 优先 rawPath(逐字格式), 文件不存在时回退到 lrcPath(标准格式), 与桌面端逻辑一致
    const apiLyricMatch = pathname.match(/^\/api\/lyric\/(\d+)$/);
    if (apiLyricMatch && req.method === 'GET') {
      try {
        const songs = await getRawSongsAsync();
        const idx = parseInt(apiLyricMatch[1], 10);
        const song = songs[idx];
        let lrcPath = null;
        if (song) {
          if (song.rawPath && fs.existsSync(song.rawPath)) lrcPath = song.rawPath;
          else if (song.lrcPath && fs.existsSync(song.lrcPath)) lrcPath = song.lrcPath;
        }
        if (!lrcPath) {
          res.writeHead(404); res.end(); return;
        }
        const text = fs.readFileSync(lrcPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
      } catch (e) {
        res.writeHead(500); res.end();
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Not found' }));
  });

  _server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      dbgErr(`[SERVER] 端口 ${_port} 被占用, 尝试 ${_port + 1}`);
      _port++;
      _server.listen(_port, _bindIP);
    } else {
      dbgErr('[SERVER] 服务器错误:', e.message);
    }
  });

  _server.listen(_port, _bindIP, () => {
    const bindDesc = _bindIP === '0.0.0.0' ? '所有网卡' : _bindIP;
    const wlDesc = _whitelist.length ? `白名单 ${_whitelist.length} 个IP` : '无白名单限制';
    dbgLog(`[SERVER] HTTP 服务器已启动, 端口 ${_port}, 绑定 ${bindDesc}, ${wlDesc}`);
    // 后台预热缓存: 服务器启动后立即用 worker 线程扫描歌库, 后续请求直接命中缓存
    warmupCache();
  });

  return _port;
}

function stopServer() {
  if (_server) {
    _server.close();
    _server = null;
  }
}

function getPort() { return _port; }
function getBindIP() { return _bindIP; }
function getWhitelist() { return _whitelist; }
function getRateLimit() { return _rateLimit; }
function isAccessLogEnabled() { return _accessLogEnabled; }
function getAccessLogs() { return _accessLogs.slice(); }
function clearAccessLogs() { _accessLogs = []; }
function isRunning() { return _server !== null; }

// IPC: 启动服务器 (端口 + 绑定IP + 白名单 + 频率限制 + 日志开关 全部可配置)
const { ipcMain } = require('electron');
ipcMain.handle('server-start', async (event, { port, bindIP, whitelist, rateLimit, accessLogEnabled } = {}) => {
  try {
    const actualPort = startServer(port || DEFAULT_PORT, bindIP, whitelist, rateLimit, accessLogEnabled);
    return {
      ok: true,
      port: actualPort,
      bindIP: _bindIP,
      whitelist: _whitelist,
      rateLimit: _rateLimit,
      accessLogEnabled: _accessLogEnabled,
    };
  } catch (e) {
    dbgErr('[SERVER] 启动失败:', e.message);
    return { ok: false, message: e.message };
  }
});
ipcMain.handle('server-stop', async () => {
  try {
    stopServer();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 获取访问日志 (返回最近 500 条, 最新的在前)
ipcMain.handle('server-get-access-logs', async () => {
  return { ok: true, logs: getAccessLogs(), enabled: _accessLogEnabled };
});

// IPC: 清空访问日志
ipcMain.handle('server-clear-access-logs', async () => {
  clearAccessLogs();
  return { ok: true };
});

module.exports = {
  startServer, stopServer, getPort, getBindIP, getWhitelist,
  getRateLimit, isAccessLogEnabled, getAccessLogs, clearAccessLogs,
  isRunning, sharedDir, ensureSharedDir, DEFAULT_PORT,
};
