// =========== 免费听音乐专区 IPC ===========
// 免责声明 / 状态 / 搜索 / 歌单详情 / 流地址 / inspect / 切源 / 歌词 / 保存到库
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { dbgLog, dbgErr } = require('../core/logger');
const { sanitizeFileName } = require('../core/network');
const { readFreeMusicData, writeFreeMusicData } = require('../core/storage');
const svc = require('./service');

// 检查免责声明是否已接受
ipcMain.handle('free-music-disclaimer-check', () => {
  return readFreeMusicData().disclaimerAccepted === true;
});

// 接受免责声明
ipcMain.handle('free-music-disclaimer-accept', () => {
  const data = readFreeMusicData();
  data.disclaimerAccepted = true;
  data.acceptedAt = new Date().toISOString();
  writeFreeMusicData(data);
  return { ok: true };
});

// 检查 exe 服务是否就绪
ipcMain.handle('free-music-status', () => {
  dbgLog('[FREE-MUSIC:status] ready=' + svc.isReady() + ' base=' + svc.getBase());
  return { ready: svc.isReady(), base: svc.getBase() };
});

// 搜索: 调 exe /search 解析 HTML 提取歌曲/歌单列表
// type: 'song' (歌曲) | 'playlist' (歌单)
ipcMain.handle('free-music-search', async (event, { keyword, sources, page, type }) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪, 请稍后重试' };
  const searchType = type || 'song';
  try {
    const params = new URLSearchParams();
    params.set('q', keyword);
    params.set('type', searchType);
    params.set('page_size', '200');
    if (sources && sources.length) {
      sources.forEach(s => params.append('sources', s));
    }
    if (page && page > 1) params.set('page', String(page));
    const url = `${svc.getBase()}/music/search?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `搜索请求失败: ${resp.status}` };
    const html = await resp.text();

    if (searchType === 'playlist' || searchType === 'album') {
      // 解析歌单/专辑列表 HTML
      // exe 对歌单和专辑搜索都用 <div class="playlist-card" onclick="navigateTo('\/music\/playlist?...')"> 或 navigateTo('\/music\/album?...')
      // 区分方式: navigateTo URL 路径 (/music/playlist vs /music/album), 不是 class 名
      // URL 中 \/ 表示 /, \u0026 表示 &, 参数值已 URL encode
      const expectedRoute = searchType === 'album' ? '/music/album' : '/music/playlist';
      const items = [];
      // 匹配 playlist-card div 中的 navigateTo URL
      const re = /<div\b[^>]*\bclass="[^"]*playlist-card[^"]*"[^>]*onclick="navigateTo\('([^']*)'\)"/g;
      const re2 = /<div\b[^>]*onclick="navigateTo\('([^']*)'\)"[^>]*\bclass="[^"]*playlist-card[^"]*"/g;
      const seenUrls = new Set();
      let m;
      const parseUrl = (rawUrl) => {
        if (seenUrls.has(rawUrl)) return null;
        seenUrls.add(rawUrl);
        // 处理 JS 字符串转义: \/ → /, \u0026 → &, \u002b → +
        let url = rawUrl.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/\\u002b/g, '+');
        // 只匹配期望的路由 (playlist 或 album)
        if (url.indexOf(expectedRoute) < 0) return null;
        const qIdx = url.indexOf('?');
        if (qIdx < 0) return null;
        const params = new URLSearchParams(url.substring(qIdx + 1));
        const id = params.get('id');
        const source = params.get('source');
        if (!id || !source) return null;
        return {
          id: id,
          source: source,
          name: params.get('name') || '',
          creator: params.get('creator') || '',
          trackCount: parseInt(params.get('track_count')) || 0,
          cover: params.get('cover') || '',
          link: params.get('link') || '',
        };
      };
      while ((m = re.exec(html)) !== null) {
        const item = parseUrl(m[1]);
        if (item) items.push(item);
      }
      while ((m = re2.exec(html)) !== null) {
        const item = parseUrl(m[1]);
        if (item) items.push(item);
      }
      return { ok: true, data: items };
    }

    // 歌曲搜索: 解析 song-card
    const songs = [];
    const re = /<li class="song-card"([^>]*)>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const attrs = m[1];
      const song = {};
      const dRe = /data-([\w-]+)=(?:"([^"]*)"|'([^']*)')/g;
      let dm;
      while ((dm = dRe.exec(attrs)) !== null) {
        song[dm[1]] = dm[2] !== undefined ? dm[2] : dm[3];
      }
      if (song.id && song.source) {
        try { song.extra = song.extra ? JSON.parse(song.extra) : {}; } catch (e) { song.extra = {}; }
        const imgMatch = m[2].match(/<img src="([^"]+)"/);
        if (imgMatch) song.cover = song.cover || imgMatch[1];
        songs.push({
          id: song.id,
          source: song.source,
          name: song.name || '',
          artist: song.artist || '',
          album: song.album || '',
          duration: song.duration || '',
          cover: song.cover || '',
          extra: song.extra,
        });
      }
    }
    return { ok: true, data: songs };
  } catch (e) {
    console.error('[FREE-MUSIC] 搜索失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// 歌单/专辑详情: 调 exe /playlist?id=&source= 或 /album?id=&source= 获取内含歌曲列表
ipcMain.handle('free-music-playlist-detail', async (event, { source, id, type }) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪' };
  try {
    const route = type === 'album' ? 'album' : 'playlist';
    const url = `${svc.getBase()}/music/${route}?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`;
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `请求失败: ${resp.status}` };
    const html = await resp.text();
    // 解析歌曲列表 (歌单/专辑详情页都是 song-card 结构)
    const songs = [];
    const re = /<li class="song-card"([^>]*)>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const attrs = m[1];
      const song = {};
      const dRe = /data-([\w-]+)=(?:"([^"]*)"|'([^']*)')/g;
      let dm;
      while ((dm = dRe.exec(attrs)) !== null) {
        song[dm[1]] = dm[2] !== undefined ? dm[2] : dm[3];
      }
      if (song.id && song.source) {
        try { song.extra = song.extra ? JSON.parse(song.extra) : {}; } catch (e) { song.extra = {}; }
        const imgMatch = m[2].match(/<img src="([^"]+)"/);
        if (imgMatch) song.cover = song.cover || imgMatch[1];
        songs.push({
          id: song.id,
          source: song.source,
          name: song.name || '',
          artist: song.artist || '',
          album: song.album || '',
          duration: song.duration || '',
          cover: song.cover || '',
          extra: song.extra,
        });
      }
    }
    return { ok: true, data: songs };
  } catch (e) {
    console.error('[FREE-MUSIC] 详情失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// 获取流式播放 URL (直接返回 URL, 前端用作 audio src)
ipcMain.handle('free-music-stream-url', (event, song) => {
  if (!svc.isReady()) {
    dbgErr('[FREE-MUSIC:stream-url] 服务未就绪, 无法生成 URL');
    return { ok: false, message: '服务未就绪' };
  }
  const params = new URLSearchParams({
    id: song.id,
    source: song.source,
    name: song.name || '',
    artist: song.artist || '',
    album: song.album || '',
    cover: song.cover || '',
    stream: '1',
  });
  if (song.extra) params.set('extra', JSON.stringify(song.extra));
  const url = `${svc.getBase()}/music/download?${params.toString()}`;
  return { ok: true, data: url };
});

// 探测歌曲信息 (大小/码率/有效性) - 调用 exe /inspect 接口
ipcMain.handle('free-music-inspect', async (event, song) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪' };
  try {
    const params = new URLSearchParams({
      id: song.id,
      source: song.source,
      duration: String(song.duration || ''),
    });
    if (song.extra) params.set('extra', JSON.stringify(song.extra));
    const url = `${svc.getBase()}/music/inspect?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `请求失败: ${resp.status}` };
    const data = await resp.json();
    return { ok: true, data: { valid: data.valid, size: data.size || '', bitrate: data.bitrate || '' } };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// 换源 - 调用 exe /switch_source 接口, 服务端并行多源搜索+可播放性验证
ipcMain.handle('free-music-switch-source', async (event, song) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪' };
  try {
    const params = new URLSearchParams({
      name: song.name || '',
      artist: song.artist || '',
      source: song.source || '',
      duration: String(song.duration || ''),
    });
    const url = `${svc.getBase()}/music/switch_source?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `请求失败: ${resp.status}` };
    const data = await resp.json();
    if (data.error) return { ok: false, message: data.error };
    return { ok: true, data: {
      id: String(data.id), source: data.source, name: data.name || song.name,
      artist: data.artist || song.artist, album: data.album || '',
      duration: data.duration || song.duration, cover: data.cover || '',
      extra: data.extra || null,
    }};
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// 获取歌词
ipcMain.handle('free-music-lyric', async (event, song) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪' };
  try {
    const params = new URLSearchParams({
      id: song.id,
      source: song.source,
      name: song.name || '',
      artist: song.artist || '',
      album: song.album || '',
      duration: song.duration || '',
    });
    if (song.extra) params.set('extra', JSON.stringify(song.extra));
    const resp = await fetch(`${svc.getBase()}/music/lyric?${params.toString()}`);
    if (!resp.ok) return { ok: false, message: '无歌词' };
    const lrc = await resp.text();
    // exe 无歌词时返回 "[00:00.00] 纯音乐 / 无歌词"
    if (lrc.includes('纯音乐') || lrc.includes('无歌词')) {
      return { ok: true, data: '' };
    }
    return { ok: true, data: lrc };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// 保存到本地歌库 (output/ 目录, 与主播放器歌库共享)
// 流程: 通过 exe stream URL 下载音频 + 下载封面 + 写歌词/info.json → output/歌曲名 - 艺人/
ipcMain.handle('free-music-save-to-library', async (event, { song, lrcText }) => {
  if (!svc.isReady()) return { ok: false, message: '服务未就绪' };
  dbgLog('[FREE-MUSIC:save] 开始 song=' + song.name + ' source=' + song.source + ' id=' + song.id);
  try {
    const songName = sanitizeFileName(song.name || 'Unknown');
    const artistName = sanitizeFileName(song.artist || 'Unknown');
    const folderName = `${songName} - ${artistName}`;
    const outputDir = path.join(__dirname, '..', 'output', folderName);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    dbgLog('[FREE-MUSIC:save] outputDir=' + outputDir);

    // 1. 构建 stream URL 并下载音频
    const params = new URLSearchParams({
      id: song.id,
      source: song.source,
      name: song.name || '',
      artist: song.artist || '',
      album: song.album || '',
      cover: song.cover || '',
      stream: '1',
    });
    if (song.extra) params.set('extra', JSON.stringify(song.extra));
    const streamUrl = `${svc.getBase()}/music/download?${params.toString()}`;
    dbgLog('[FREE-MUSIC:save] 请求音频流 url=' + streamUrl.substring(0, 120));
    const audioResp = await fetch(streamUrl);
    if (!audioResp.ok) {
      const errBody = await audioResp.text().catch(() => '(无法读取)');
      dbgErr('[FREE-MUSIC:save] 音频流失败 status=' + audioResp.status + ' body=' + errBody.substring(0, 200));
      throw new Error(`音频下载失败: ${audioResp.status} ${errBody.substring(0, 100)}`);
    }
    const audioBuf = Buffer.from(await audioResp.arrayBuffer());
    dbgLog('[FREE-MUSIC:save] 音频下载完成 size=' + audioBuf.length + ' bytes');

    // 根据 content-type 确定扩展名
    const contentType = audioResp.headers.get('content-type') || '';
    let ext = 'mp3';
    if (contentType.includes('mp4') || contentType.includes('m4a')) ext = 'm4a';
    else if (contentType.includes('aac')) ext = 'aac';
    else if (contentType.includes('mpeg')) ext = 'mp3';
    else if (contentType.includes('flac')) ext = 'flac';
    else if (contentType.includes('ogg')) ext = 'ogg';

    const audioPath = path.join(outputDir, `${songName} - ${artistName}.${ext}`);
    // 删除旧扩展名的音频文件(避免多种格式残留)
    try {
      const existing = fs.readdirSync(outputDir);
      for (const f of existing) {
        if (/\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f)) {
          const oldPath = path.join(outputDir, f);
          if (oldPath !== audioPath) fs.unlinkSync(oldPath);
        }
      }
    } catch (e) {}
    fs.writeFileSync(audioPath, audioBuf);

    // 2. 保存歌词 (.lrc)
    if (lrcText) {
      const lrcPath = path.join(outputDir, `${songName} - ${artistName}.lrc`);
      fs.writeFileSync(lrcPath, lrcText, 'utf-8');
    }

    // 3. 下载封面
    if (song.cover && !song.cover.includes('placeholder.com')) {
      try {
        const coverResp = await fetch(song.cover);
        if (coverResp.ok) {
          const coverBuf = Buffer.from(await coverResp.arrayBuffer());
          const coverContentType = coverResp.headers.get('content-type') || '';
          let coverExt = 'jpg';
          if (coverContentType.includes('png')) coverExt = 'png';
          else if (coverContentType.includes('webp')) coverExt = 'webp';
          // 删除旧封面
          try {
            const existing = fs.readdirSync(outputDir);
            for (const f of existing) {
              if (/^cover\.(jpg|png|webp)$/i.test(f)) fs.unlinkSync(path.join(outputDir, f));
            }
          } catch (e) {}
          fs.writeFileSync(path.join(outputDir, `cover.${coverExt}`), coverBuf);
        }
      } catch (e) {
        console.error('[FREE-MUSIC] 封面下载失败:', e.message);
      }
    }

    // 4. 写 info.json (主播放器歌库扫描依赖此文件, duration 必须是毫秒)
    // exe 返回的 duration 可能是毫秒(>1000)或秒(<1000), 统一转成毫秒
    let durMs = parseInt(song.duration) || 0;
    if (durMs > 0 && durMs < 1000) durMs = durMs * 1000;  // 秒 → 毫秒
    const info = {
      title: song.name || '',
      artist: song.artist || '',
      album: song.album || '',
      source: song.source,
      duration: durMs,
    };
    fs.writeFileSync(path.join(outputDir, 'info.json'), JSON.stringify(info, null, 2), 'utf-8');

    dbgLog('[FREE-MUSIC:save] 成功 song=' + song.name + ' audioPath=' + audioPath);
    return { ok: true, data: { path: audioPath, folder: folderName } };
  } catch (e) {
    dbgErr('[FREE-MUSIC:save] 保存到歌库失败:', e.message);
    return { ok: false, message: e.message };
  }
});

module.exports = {};
