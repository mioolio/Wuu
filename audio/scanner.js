// =========== 音乐文件扫描 + 歌曲列表 IPC ===========
// 扫描 output/ 目录, 按文件夹组织每首歌曲 (音频/歌词/封面/info.json)
// 支持 info.json 新旧格式, 缺失字段从 .lrc 头部 tag 后备提取
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { dbgLog } = require('../core/logger');
const { getCachedDuration } = require('../core/storage');
const { parseDurationsInBackground } = require('./duration');

function scanMusicFiles() {
  const outputDir = path.join(__dirname, '..', 'output');
  const songs = [];
  if (!fs.existsSync(outputDir)) return songs;

  // 支持的音频格式 (排除 .enc.m4a 等加密未解文件)
  const audioExtRegex = /\.(aac|m4a|mp3|wav|flac|ogg)$/i;

  const folders = fs.readdirSync(outputDir);
  for (const folder of folders) {
    const folderPath = path.join(outputDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const files = fs.readdirSync(folderPath);
    const audioFile = files.find(f => audioExtRegex.test(f) && !/\.enc\./i.test(f));
    if (!audioFile) continue;

    const lrcFile = files.find(f => f.endsWith('.lrc'));
    const rawFile = files.find(f => f === 'lyrics_raw.txt');
    const coverFile = files.find(f => f === 'cover.jpg' || f === 'cover.png' || f === 'cover.webp');
    const infoFile = files.find(f => f === 'info.json');

    // 歌曲名/艺人: 优先用 info.json 的精确数据, 避免从文件名拆分造成歧义
    // 兼容多种 info.json 格式:
    //   - 新格式: title/artist/album/duration(ms)/lyricist/composer
    //   - 旧格式: songName/artist/album/duration(ms)  (老版本下载器, 无作家字段)
    const ext = path.extname(audioFile);
    let songName = path.basename(audioFile, ext);
    let artist = '未知艺人';
    let album = '';
    let realDuration = 0;
    let lyricist = '';
    let composer = '';
    if (infoFile) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(folderPath, infoFile), 'utf-8'));
        if (info.title) songName = info.title;
        else if (info.songName) songName = info.songName;  // 旧格式兼容
        if (info.artist) artist = info.artist;
        if (info.album) album = info.album;
        if (info.duration && info.duration > 0) realDuration = info.duration / 1000;  // ms → s
        if (info.lyricist) lyricist = info.lyricist;
        if (info.composer) composer = info.composer;
      } catch (e) {}
    }

    // 后备: info.json 缺作词/作曲时, 从 .lrc 文件头部 tag 提取
    // 支持 tag: [lyricist:] [composer:] [词:] [曲:]
    if (!lyricist || !composer) {
      if (lrcFile) {
        try {
          const lrcText = fs.readFileSync(path.join(folderPath, lrcFile), 'utf-8');
          // 只扫描前 50 行(头部 tag 区域), 避免误匹配正文
          const head = lrcText.split('\n').slice(0, 50).join('\n');
          if (!lyricist) {
            const m = head.match(/^\s*\[(?:lyricist|词)\s*:\s*([^\]]+)\]/im);
            if (m) lyricist = m[1].trim();
          }
          if (!composer) {
            const m = head.match(/^\s*\[(?:composer|曲)\s*:\s*([^\]]+)\]/im);
            if (m) composer = m[1].trim();
          }
        } catch (e) {}
      }
    }
    // 修复: 音源返回的 title 可能自带艺人后缀(如 "鸡你太美 - 蔡徐坤" / "i Missy - Music - owe")
    // 若 songName 以 " - " + artist 结尾, 去掉后缀; 否则歌名和列表显示会带上艺人名
    if (artist && artist !== '未知艺人' && songName.endsWith(' - ' + artist)) {
      songName = songName.slice(0, -(artist.length + 3)).trim();
    }
    // 无 info.json 时从音频文件名按最后一个 " - " 拆分歌名/艺人
    // (用 lastIndexOf 而非 split, 以正确处理歌名自身含 " - " 的情况, 如 "i Missy - Music - owe")
    if (artist === '未知艺人' && songName.includes(' - ')) {
      const li = songName.lastIndexOf(' - ');
      const maybeArtist = songName.slice(li + 3).trim();
      if (maybeArtist) {
        songName = songName.slice(0, li).trim();
        artist = maybeArtist;
      }
    }
    // info.json 没有 duration 时用缓存(后台异步解析会补充无缓存的)
    const _infoDur = realDuration;
    let _cachedDur = realDuration === 0 ? getCachedDuration(path.join(folderPath, audioFile)) : 0;
    // 可疑缓存校验: 缓存 duration <= 30 秒但文件 >1MB, 可能是误解析(如 FLAC 被当 MP3)
    // 视为缓存失效, 让后台重新解析
    if (_cachedDur > 0 && _cachedDur <= 30) {
      try {
        const _stat = fs.statSync(path.join(folderPath, audioFile));
        if (_stat.size > 1024 * 1024) {
          if (typeof dbgLog === 'function') dbgLog(`[scan] "${songName}" 可疑缓存 ${_cachedDur}s, 文件 ${Math.round(_stat.size/1024/1024)}MB, 忽略缓存`);
          _cachedDur = 0;
        }
      } catch (e) {}
    }
    if (realDuration === 0) realDuration = _cachedDur;
    // 调试日志: 记录时长来源(info.json / 缓存 / 待解析), 写入 wuu-debug.log
    if (typeof dbgLog === 'function') {
      const _src = _infoDur > 0 ? 'info.json' : (_cachedDur > 0 ? '缓存' : '待解析');
      dbgLog(`[scan] "${songName} - ${artist}" audioFile=${audioFile} infoDur=${_infoDur} cachedDur=${_cachedDur} → realDuration=${realDuration} (来源:${_src})`);
    }

    const audioPath = path.join(folderPath, audioFile);
    songs.push({
      id: songs.length,
      songName,
      artist,
      album,
      audioPath,
      lrcPath: lrcFile ? path.join(folderPath, lrcFile) : null,
      rawPath: rawFile ? path.join(folderPath, rawFile) : null,
      coverPath: coverFile ? path.join(folderPath, coverFile) : null,
      realDuration,  // 真实时长(秒), 0 表示解析失败
      lyricist,      // 作词 (info.json 提供, 缺失为空字符串)
      composer,      // 作曲 (info.json 提供, 缺失为空字符串)
    });
  }

  songs.sort((a, b) => a.songName.localeCompare(b.songName, 'zh'));
  return songs;
}

// IPC: 获取歌曲列表 (瞬时返回缓存时长, 后台异步解析未缓存的)
ipcMain.handle('get-songs', () => {
  const songs = scanMusicFiles();
  // 延迟 300ms 启动后台解析, 确保渲染进程已注册 duration-update 监听器
  setTimeout(() => parseDurationsInBackground(songs), 300);
  return songs;
});

// IPC: 读取歌词文件内容
ipcMain.handle('get-lyrics', (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
});

module.exports = { scanMusicFiles };
