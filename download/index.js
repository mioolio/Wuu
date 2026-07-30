// =========== 在线解析: 多平台分享链接 → 本地歌曲 ===========
// 解析逻辑在 parsers/ 目录(汽水音乐/网易云/QQ音乐 等)
// 流程: 解析分享链接 → 返回歌曲信息 → 下载音频(可选 Soda 解密) + 封面 + 歌词 → 写入 output/歌曲名 - 艺人/
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const parsers = require('../parsers');
const { parseKugouJson } = require('../parsers/platforms/kugou-proxy');
const { fetchWithTimeout, sanitizeFileName } = require('../core/network');
const { sendToMain } = require('../core/state');
const { decryptSodaAudio, detectAudioExtByMagic } = require('../soda/decrypt');

// 从 parsers 模块导入解析函数(汽水音乐已迁移, 其他平台后续添加)
const { parse: parseMusicLink, fetchTrackV2, krcToRaw, parseLrcFromKrc } = parsers;

// 下载并保存解析的歌曲到 output/ 目录
// overwrite: { audio, cover, lrc, info, krc } 控制每项是否覆盖现有文件
// 整体超时 60 秒: 防止版权到期/损坏链接导致 fetch 挂起, 卡住整批下载
async function downloadParsedSong(info, onProgress, overwrite) {
  const songName = sanitizeFileName(info.title);
  const artistName = sanitizeFileName(info.artist);
  const folderName = `${songName} - ${artistName}`;
  const outputDir = path.join(__dirname, '..', 'output', folderName);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 默认全部覆盖
  const ow = Object.assign({ audio: true, cover: true, lrc: true, info: true }, overwrite || {});

  // 1. 下载音频 (60 秒超时, 防止损坏链接挂起)
  let audioPath = null;
  if (ow.audio) {
    const audioResp = await fetchWithTimeout(info.url, {
      headers: { 'User-Agent': 'LunaPC/3.4.0(388267242)' },
    }, 60000);
    if (!audioResp.ok) throw new Error(`音频下载失败: ${audioResp.status}`);
    const audioBuf = Buffer.from(await audioResp.arrayBuffer());

    // Soda 解密 (如果存在 playAuth)
    let finalAudio = audioBuf;
    let ext = 'mp3';
    const contentType = audioResp.headers.get('content-type') || '';

    // 优先: 文件头魔数检测(最可靠, 防止第三方代理错误标记 Content-Type)
    // 例: 酷狗 quality=flac 返回 FLAC 数据, 但代理可能标记为 audio/mpeg
    // 若按 .mp3 扩展名保存, Chromium 会用 MP3 解码器解码 FLAC, 只能播放前 30 秒
    const detectedExt = detectAudioExtByMagic(audioBuf);
    if (detectedExt) {
      ext = detectedExt;
    } else if (contentType.includes('mp4') || contentType.includes('m4a')) {
      ext = 'm4a';
    } else if (contentType.includes('aac')) {
      ext = 'aac';
    } else if (contentType.includes('flac')) {
      ext = 'flac';
    } else if (contentType.includes('mpeg')) {
      ext = 'mp3';
    }

    if (info.playAuth && audioBuf.length > 0) {
      try {
        const dec = decryptSodaAudio(audioBuf, info.playAuth);
        if (dec.decrypted) {
          finalAudio = dec.data;
          ext = 'm4a';  // 解密成功 → 标准 m4a
        } else {
          // 解密失败 → 保留加密原始数据, 用 .enc.m4a 扩展名标记不可播放
          ext = 'enc.m4a';
        }
      } catch (e) {
        // 解密异常 → 同样标记为 .enc.m4a
        ext = 'enc.m4a';
      }
    }

    audioPath = path.join(outputDir, `${songName} - ${artistName}.${ext}`);
    // 删除旧扩展名的音频文件(避免一种格式变多种格式后留下旧文件)
    try {
      const existing = fs.readdirSync(outputDir);
      for (const f of existing) {
        if (/\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f)) {
          const oldPath = path.join(outputDir, f);
          if (oldPath !== audioPath) fs.unlinkSync(oldPath);
        }
      }
    } catch (e) {}
    fs.writeFileSync(audioPath, finalAudio);
  } else {
    // 不覆盖音频, 找现有音频路径
    try {
      const existing = fs.readdirSync(outputDir);
      const found = existing.find(f => /\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f));
      if (found) audioPath = path.join(outputDir, found);
    } catch (e) {}
  }
  if (onProgress) onProgress('audio', 100);

  // 2. 下载封面 (30 秒超时, 封面较小, 超时直接跳过不影响音频)
  let coverPath = null;
  if (ow.cover && info.cover) {
    try {
      const coverResp = await fetchWithTimeout(info.cover, {}, 30000);
      if (coverResp.ok) {
        const coverBuf = Buffer.from(await coverResp.arrayBuffer());
        const coverExt = (info.cover.match(/\.(jpg|jpeg|png|webp)/i) || ['', 'jpg'])[1].toLowerCase();
        const ext = coverExt === 'jpeg' ? 'jpg' : coverExt;
        coverPath = path.join(outputDir, `cover.${ext}`);
        // 删除其他扩展名的旧封面
        try {
          const existing = fs.readdirSync(outputDir);
          for (const f of existing) {
            if (/^cover\.(jpg|jpeg|png|webp)$/i.test(f)) {
              const oldPath = path.join(outputDir, f);
              if (oldPath !== coverPath) fs.unlinkSync(oldPath);
            }
          }
        } catch (e) {}
        fs.writeFileSync(coverPath, coverBuf);
      }
    } catch (e) {}
  } else {
    try {
      const existing = fs.readdirSync(outputDir);
      const found = existing.find(f => /^cover\.(jpg|jpeg|png|webp)$/i.test(f));
      if (found) coverPath = path.join(outputDir, found);
    } catch (e) {}
  }
  if (onProgress) onProgress('cover', 100);

  // 3. 保存歌词(三种格式)
  //    .lrc          - 标准 LRC 格式(行级时间, 兼容性最好)
  //    lyrics_raw.txt - 逐字 raw 格式(从 krc 转换, 供桌面歌词精确到字)
  //    lyrics_krc.json - 完整 krc 结构(备用, 修复歌词时重新生成 raw 用)
  let lrcPath = null;
  if (ow.lrc && info.lrc) {
    lrcPath = path.join(outputDir, `${songName} - ${artistName}.lrc`);
    fs.writeFileSync(lrcPath, info.lrc, 'utf-8');
    // 生成逐字 raw 格式歌词(若 krc 可用), 否则回退到标准 lrc
    const rawText = info.krc ? krcToRaw(info.krc) : info.lrc;
    fs.writeFileSync(path.join(outputDir, 'lyrics_raw.txt'), rawText, 'utf-8');
  } else {
    try {
      const existing = fs.readdirSync(outputDir);
      const found = existing.find(f => f.endsWith('.lrc'));
      if (found) lrcPath = path.join(outputDir, found);
    } catch (e) {}
  }
  if (onProgress) onProgress('lrc', 100);

  // 4. 保存 info.json (duration 单位 ms, scanMusicFiles 读取时除以1000)
  if (ow.info) {
    fs.writeFileSync(path.join(outputDir, 'info.json'), JSON.stringify({
      title: info.title,
      artist: info.artist,
      album: info.album,
      duration: info.duration || 0,
      trackId: info.trackId || '',
      source: info.source || 'qishui',
      lyricist: info.lyricist || '',
      composer: info.composer || '',
    }, null, 2), 'utf-8');
  }
  if (onProgress) onProgress('info', 100);

  // 5. 保存完整 krc 结构(独立选项, 与 lrc 分离)
  //    仅当用户勾选"轨道数据"或 lrc 被覆盖时一并更新
  //    krc.json 是逐字歌词的备用数据源, 修复歌词精度时用
  if ((ow.krc || ow.lrc) && info.krc) {
    fs.writeFileSync(path.join(outputDir, 'lyrics_krc.json'), JSON.stringify(info.krc, null, 2), 'utf-8');
  }
  if (onProgress) onProgress('krc', 100);

  return { audioPath, coverPath, lrcPath, folder: folderName };
}

// 检查解析的歌曲在本地是否已存在, 并逐项对比文件差异
function checkParsedSongExists(info) {
  const songName = sanitizeFileName(info.title);
  const artistName = sanitizeFileName(info.artist);
  const folderName = `${songName} - ${artistName}`;
  const outputDir = path.join(__dirname, '..', 'output', folderName);
  if (!fs.existsSync(outputDir)) return { exists: false, folder: folderName, items: null };

  let files = [];
  try { files = fs.readdirSync(outputDir); } catch (e) {}
  const existing = {
    audio: files.find(f => /\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f) && !/\.enc\./i.test(f)) || null,
    cover: files.find(f => /^cover\.(jpg|jpeg|png|webp)$/i.test(f)) || null,
    lrc: files.find(f => f.endsWith('.lrc')) || null,
    info: files.find(f => f === 'info.json') || null,
    krc: files.find(f => f === 'lyrics_krc.json') || null,
  };

  // 逐项对比差异
  //    audio/cover: 对比文件大小(精确且快速), 大小相同视为相同
  //    lrc/info: 对比文本内容
  //    krc: 对比 sentences 数量(精确度足够)
  const items = {
    audio: { hasOld: !!existing.audio, hasNew: !!info.url, diff: false },
    cover: { hasOld: !!existing.cover, hasNew: !!info.cover, diff: false },
    lrc: { hasOld: !!existing.lrc, hasNew: !!info.lrc, diff: false },
    info: { hasOld: !!existing.info, hasNew: true, diff: false },
    krc: { hasOld: !!existing.krc, hasNew: !!info.krc, diff: false },
  };

  // 音频对比: 文件大小(本地无法精确对比内容, 因为新数据是 URL 未下载)
  //    本地音频已存在 + 新数据有 url → 对比是否需要更新
  //    策略: 本地音频文件大小 > 10KB 视为有效, 不需要更新(diff=false)
  //         本地音频文件 < 10KB 或损坏 → 需要更新(diff=true)
  if (existing.audio) {
    try {
      const stat = fs.statSync(path.join(outputDir, existing.audio));
      // 本地音频有效 → 不需要重新下载(只有用户强制覆盖才更新)
      items.audio.diff = stat.size < 10240;
    } catch (e) { items.audio.diff = true; }
  } else if (info.url) {
    items.audio.diff = true;  // 本地无音频, 新数据有 → 新增
  }

  // 封面对比: 本地封面已存在 + 新数据有 cover URL → 视为相同(不重新下载)
  //    除非本地封面文件损坏(< 1KB)
  if (existing.cover) {
    try {
      const stat = fs.statSync(path.join(outputDir, existing.cover));
      items.cover.diff = stat.size < 1024;
    } catch (e) { items.cover.diff = true; }
  } else if (info.cover) {
    items.cover.diff = true;  // 本地无封面, 新数据有 → 新增
  }

  // 歌词文本对比
  if (existing.lrc && info.lrc) {
    try {
      const oldLrc = fs.readFileSync(path.join(outputDir, existing.lrc), 'utf-8');
      items.lrc.diff = oldLrc.trim() !== info.lrc.trim();
    } catch (e) { items.lrc.diff = true; }
  } else if (!existing.lrc && info.lrc) {
    items.lrc.diff = true;  // 本地无歌词, 新数据有 → 新增
  }

  // info.json 对比 (title/artist/album/duration)
  if (existing.info) {
    try {
      const oldInfo = JSON.parse(fs.readFileSync(path.join(outputDir, existing.info), 'utf-8'));
      items.info.diff = (
        oldInfo.title !== info.title ||
        oldInfo.artist !== info.artist ||
        oldInfo.album !== info.album ||
        (oldInfo.duration || 0) !== (info.duration || 0)
      );
    } catch (e) { items.info.diff = true; }
  } else {
    items.info.diff = true;
  }

  // 详细轨道数据(krc.json)对比: 对比 sentences 数量
  if (existing.krc && info.krc) {
    try {
      const oldKrc = JSON.parse(fs.readFileSync(path.join(outputDir, existing.krc), 'utf-8'));
      const oldCount = (oldKrc.sentences && oldKrc.sentences.length) || 0;
      const newCount = (info.krc.sentences && info.krc.sentences.length) || 0;
      items.krc.diff = oldCount !== newCount;
    } catch (e) { items.krc.diff = true; }
  } else if (!existing.krc && info.krc) {
    items.krc.diff = true;  // 本地无 krc, 新数据有 → 新增
  }

  return { exists: true, folder: folderName, existingFiles: existing, items };
}

// IPC: 解析分享链接
ipcMain.handle('parse-music-link', async (event, shareText) => {
  try {
    const info = await parseMusicLink(shareText);
    return { ok: true, data: info };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 流式并发解析(支持几百首) - 每秒 2 个请求, 每完成一首立即推送进度
// 返回 { total, done }, 实际进度通过 'parse-progress-event' 事件流式推送
ipcMain.handle('parse-music-links-stream', async (event, texts) => {
  const total = texts.length;
  const INTERVAL = 500;  // 每个请求间隔 500ms = 每秒 2 个请求
  let doneCount = 0;

  const send = (payload) => sendToMain('parse-progress-event', payload);

  // 单队列顺序处理: 每 500ms 发起一个请求, 避免触发汽水音乐风控
  for (let idx = 0; idx < total; idx++) {
    const text = texts[idx];
    try {
      const info = await parseMusicLink(text);
      send({ idx, ok: true, data: info, input: text, done: ++doneCount, total });
    } catch (e) {
      send({ idx, ok: false, message: e.message, input: text, done: ++doneCount, total });
    }
    // 请求间隔(最后一个不需要等)
    if (idx < total - 1) await new Promise(r => setTimeout(r, INTERVAL));
  }
  return { total, done: doneCount };
});

// IPC: 解析酷狗第三方 JSON(流式推送进度, payload 格式与 parse-music-links-stream 一致)
// 输入: JSON 文本(单对象或数组), 含 name/url/pic/Am1(krc URL)/Am2(lrc URL)
// 第三方软件已解析出直链, 此处只需 fetch 歌词文本并转为标准 info 对象
ipcMain.handle('parse-kugou-json-stream', async (event, jsonText) => {
  try {
    const total = await parseKugouJson(jsonText, (payload) => sendToMain('parse-progress-event', payload));
    return { ok: true, total };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 检查歌曲是否已存在(逐项对比)
ipcMain.handle('check-parsed-song-exists', async (event, info) => {
  try { return { ok: true, data: checkParsedSongExists(info) }; }
  catch (e) { return { ok: false, message: e.message }; }
});

// IPC: 下载解析后的歌曲 (支持 overwrite 选择性覆盖)
ipcMain.handle('download-parsed-song', async (event, info, overwrite) => {
  // 整体 60 秒超时兜底: 防止版权到期/损坏链接导致 fetch 挂起, 卡住整批下载
  // 超时后返回失败, UI 自动跳过当前歌曲继续下一首
  const TIMEOUT_MS = 60000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('下载超时(60秒), 已自动跳过')), TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      downloadParsedSong(info, (stage, pct) => {
        sendToMain('parse-download-progress', { stage, pct });
      }, overwrite),
      timeoutPromise,
    ]);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

module.exports = { downloadParsedSong, checkParsedSongExists };
