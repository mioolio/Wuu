// =========== 配置目录与持久化存储 ===========
// config/ 目录下的 JSON 文件读写: userdata.json / duration_cache.json / free_music.json
// kugou_config.json 的读写放在 kugou/ 模块 (与酷狗账号逻辑强耦合)
const path = require('path');
const fs = require('fs');

const configDir = path.join(__dirname, '..', 'config');
const userDataFile = path.join(configDir, 'userdata.json');
const durationCacheFile = path.join(configDir, 'duration_cache.json');
const freeMusicDataFile = path.join(configDir, 'free_music.json');

function ensureConfigDir() {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
}

// ---- userdata.json ----
function _emptyUserData() {
  return { likes: [], dislikes: [], collections: [], stats: {}, progress: {}, lastSession: null, actualDuration: {}, settings: {} };
}

// 备份损坏的 userdata 文件, 便于事后恢复 (不覆盖已有备份)
function _backupCorruptFile(reason) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(configDir, `userdata.json.corrupt-${ts}`);
    fs.copyFileSync(userDataFile, backupFile);
    console.error(`[storage] userdata.json 解析失败(${reason}), 已备份到 ${backupFile}`);
  } catch (e) {
    console.error(`[storage] userdata.json 解析失败(${reason}), 备份也失败:`, e.message);
  }
}

// userdata 读取缓存: 服务器 API 高频调用 readUserData (移动端每 2 秒上报进度触发),
// 避免每次全量读盘 + JSON.parse (歌库大时文件可达数 MB)
// 失效策略: writeUserData 主动清空; stat 的 mtime+size 变化时失效 (兜底外部修改)
let _udCache = null;
let _udCacheKey = null;  // `${mtimeMs}:${size}`

function readUserData() {
  ensureConfigDir();
  let stat = null;
  try { stat = fs.statSync(userDataFile); } catch (e) {}
  const key = stat ? stat.mtimeMs + ':' + stat.size : null;
  // 命中缓存: 文件未变化, 直接返回
  if (_udCache && key && key === _udCacheKey) return _udCache;
  if (!stat) {
    _udCache = _emptyUserData();
    _udCacheKey = null;
    return _udCache;
  }
  let raw;
  try {
    raw = fs.readFileSync(userDataFile, 'utf-8');
  } catch (e) {
    console.error('[storage] 读取 userdata.json 失败:', e.message);
    return _emptyUserData();
  }
  try {
    const data = JSON.parse(raw);
    _udCache = {
      likes: Array.isArray(data.likes) ? data.likes : [],
      // 不推荐(倒点赞)列表: [{ path, ts }]
      dislikes: Array.isArray(data.dislikes) ? data.dislikes : [],
      // 多歌单系统: collections 数组持久化 (每项 { id, name, songs: [...], createdAt })
      // 渲染进程 init.js 会把 songs 数组转回 Set
      collections: Array.isArray(data.collections) ? data.collections : [],
      stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
      progress: data.progress && typeof data.progress === 'object' ? data.progress : {},
      lastSession: data.lastSession && typeof data.lastSession === 'object' ? data.lastSession : null,
      actualDuration: data.actualDuration && typeof data.actualDuration === 'object' ? data.actualDuration : {},
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    };
    _udCacheKey = key;
    return _udCache;
  } catch (e) {
    // 解析失败: 文件损坏(多半是写盘被中断导致截断)
    // 先备份损坏文件, 再返回空默认值, 避免下次 saveUserData 直接覆写导致原始数据彻底丢失
    _backupCorruptFile(e.message);
    return _emptyUserData();
  }
}

// 原子写: 先写到 .tmp 临时文件, 写成功后再 rename 覆盖目标文件
// 避免写盘过程中被中断(崩溃/断电/任务管理器杀进程)导致 userdata.json 截断损坏
function writeUserData(data) {
  ensureConfigDir();
  // 写入时立即失效读取缓存 (所有写入都在本进程内, 覆盖渲染进程 IPC / 服务器 API 两条路径)
  _udCache = null;
  _udCacheKey = null;
  const payload = JSON.stringify({
    likes: Array.isArray(data.likes) ? data.likes : [],
    dislikes: Array.isArray(data.dislikes) ? data.dislikes : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
    stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
    progress: data.progress && typeof data.progress === 'object' ? data.progress : {},
    lastSession: data.lastSession && typeof data.lastSession === 'object' ? data.lastSession : null,
    actualDuration: data.actualDuration && typeof data.actualDuration === 'object' ? data.actualDuration : {},
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  }, null, 2);
  const tmpFile = userDataFile + '.tmp';
  try {
    fs.writeFileSync(tmpFile, payload, 'utf-8');
    // rename 在同分区下是原子操作, Windows 上也能保证目标文件不会处于半写状态
    fs.renameSync(tmpFile, userDataFile);
  } catch (e) {
    // 即便 rename 失败, 也尝试清理临时文件
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[storage] writeUserData 失败:', e.message);
  }
}

// ---- duration_cache.json ----
// 缓存 { audioPath: { mtime, duration } }, 避免每次启动都重新解析所有 AAC 文件
let durationCache = {};
function readDurationCache() {
  try {
    if (fs.existsSync(durationCacheFile)) {
      durationCache = JSON.parse(fs.readFileSync(durationCacheFile, 'utf-8')) || {};
    }
  } catch (e) { durationCache = {}; }
}
function writeDurationCache() {
  ensureConfigDir();
  try { fs.writeFileSync(durationCacheFile, JSON.stringify(durationCache, null, 2), 'utf-8'); } catch (e) {}
}
// 从缓存读取时长, mtime 不匹配则视为失效返回 0
function getCachedDuration(audioPath) {
  const entry = durationCache[audioPath];
  if (!entry) return 0;
  try {
    const stat = fs.statSync(audioPath);
    if (Math.abs(stat.mtimeMs - entry.mtime) < 1000) return entry.duration || 0;
  } catch (e) {}
  return 0;
}
function setCachedDuration(audioPath, mtimeMs, duration) {
  durationCache[audioPath] = { mtime: mtimeMs, duration };
}
function getDurationCache() { return durationCache; }

// ---- free_music.json ----
function readFreeMusicData() {
  ensureConfigDir();
  try {
    if (fs.existsSync(freeMusicDataFile)) return JSON.parse(fs.readFileSync(freeMusicDataFile, 'utf-8'));
  } catch (e) {}
  return { disclaimerAccepted: false };
}
function writeFreeMusicData(data) {
  ensureConfigDir();
  try { fs.writeFileSync(freeMusicDataFile, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
}

// 启动时加载时长缓存
readDurationCache();

// ---- 用户数据 IPC ----
const { ipcMain } = require('electron');
ipcMain.handle('get-userdata', () => readUserData());
ipcMain.handle('save-userdata', (event, data) => {
  writeUserData(data);
  return true;
});
// 同步保存用户数据(用于 beforeunload, 阻塞渲染进程直到写盘完成)
ipcMain.on('save-userdata-sync', (event, data) => {
  writeUserData(data);
  event.returnValue = true;
});

// 删除磁盘上的歌曲文件夹 (彻底移除不喜欢的音乐)
// 入参: audioPath (歌曲音频文件的绝对路径)
// 行为: 删除该音频文件所在的整个子文件夹 (含音频/封面/歌词/info.json)
// 返回: { ok: true, removed: 'folder' } 或 { ok: true, removed: 'file' } (无父文件夹时仅删文件)
//       { ok: false, error: 'not_found' | e.message }
ipcMain.handle('delete-song-folder', async (event, audioPath) => {
  if (!audioPath || typeof audioPath !== 'string') return { ok: false, error: 'invalid_path' };
  try {
    if (!fs.existsSync(audioPath)) return { ok: false, error: 'not_found' };
    const parentDir = path.dirname(audioPath);
    const outputRoot = path.join(__dirname, '..', 'output');
    // 安全检查: 父目录必须是 output/ 下的子文件夹, 防止误删根目录
    if (parentDir && path.resolve(parentDir) === path.resolve(outputRoot)) {
      // 父目录就是 output/ 根, 只删文件本身
      fs.unlinkSync(audioPath);
      return { ok: true, removed: 'file' };
    }
    // 删除整个子文件夹
    fs.rmSync(parentDir, { recursive: true, force: true });
    return { ok: true, removed: 'folder' };
  } catch (e) {
    return { ok: false, error: e.message || 'unknown_error' };
  }
});

module.exports = {
  configDir, ensureConfigDir,
  readUserData, writeUserData,
  readDurationCache, writeDurationCache, getCachedDuration, setCachedDuration, getDurationCache,
  readFreeMusicData, writeFreeMusicData,
};
