// =========== 损坏歌曲扫描与修复 IPC ===========
// 扫描: 检测未解密/音频缺失/文件过小/歌词精度不足/名称异常
// 修复: 音频问题用 trackId 重新下载; 歌词问题从 lyrics_krc.json 重新生成;
//       名称异常从 FLAC VORBIS_COMMENT 读取真实标题重命名
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const parsers = require('../parsers');
const { dbgLog } = require('../core/logger');
const { sanitizeFileName } = require('../core/network');
const { verifyAudioFile } = require('../audio/verify');
const { readFlacTags } = require('../audio/duration');
const { downloadParsedSong } = require('../download');

const { parse: parseMusicLink, fetchTrackV2, krcToRaw } = parsers;

// IPC: 扫描损坏歌曲
ipcMain.handle('scan-damaged-songs', async () => {
  const outputDir = path.join(__dirname, '..', 'output');
  const damaged = [];
  if (!fs.existsSync(outputDir)) return [];

  // 容错读取目录: 跳过无权限/损坏的项目, 不让单首异常导致整个扫描失败
  let folders;
  try { folders = fs.readdirSync(outputDir); }
  catch (e) { throw new Error('读取 output 目录失败: ' + e.message); }

  for (const folder of folders) {
    const folderPath = path.join(outputDir, folder);
    // stat 容错: 某些文件可能被占用/无权限, 跳过
    let stat;
    try { stat = fs.statSync(folderPath); }
    catch (e) {
      // EPERM/ENOENT 等, 跳过该项
      if (typeof dbgLog === 'function') dbgLog(`[scan-damaged] 跳过 "${folder}": ${e.code || e.message}`);
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(folderPath); }
    catch (e) {
      if (typeof dbgLog === 'function') dbgLog(`[scan-damaged] 跳过 "${folder}" 读取目录失败: ${e.code || e.message}`);
      continue;
    }

    const encFile = files.find(f => /\.enc\.(m4a|mp4)$/i.test(f));
    const normalAudio = files.find(f => /\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f) && !/\.enc\./i.test(f));
    const infoFile = files.find(f => f === 'info.json');

    let issue = null;
    let info = null;
    if (infoFile) {
      try { info = JSON.parse(fs.readFileSync(path.join(folderPath, infoFile), 'utf-8')); } catch (e) {}
    }

    if (encFile && !normalAudio) {
      issue = '解密失败';  // 只有 .enc.m4a, 没有可用音频
    } else if (!normalAudio && !encFile) {
      issue = '音频缺失';  // 既没有音频也没有加密文件
    } else if (normalAudio) {
      // 有音频文件 → 验证文件内容是否有效(不只是看文件是否存在)
      const audioPath = path.join(folderPath, normalAudio);
      let audioStat;
      try { audioStat = fs.statSync(audioPath); }
      catch (e) {
        // 音频文件 stat 失败(权限/占用), 视为损坏
        if (typeof dbgLog === 'function') dbgLog(`[scan-damaged] "${folder}" 音频 stat 失败: ${e.code || e.message}`);
        damaged.push({
          folder, title: folder, artist: '未知艺人',
          trackId: (info && info.trackId) || '', duration: (info && info.duration) || 0,
          issue: '音频读取失败', coverPath: '',
        });
        continue;
      }
      if (audioStat.size < 10240) {
        issue = '文件过小';
      } else {
        // 深度验证: 未解密(enca) / 缺少 mdat / 数据异常
        const verify = verifyAudioFile(audioPath);
        if (!verify.valid) issue = verify.reason;
      }
    }

    // 音频正常时, 检测歌词精度(是否有逐字时间戳)
    //    lyrics_raw.txt 应含 [startMs,durMs]字<offset,dur,0> 逐字格式
    //    若只是标准 LRC 格式 [mm:ss.cc]text, 桌面歌词无法精确到字
    //    注意: 纯音乐/DJ/钢琴曲等本身无歌词, 不标记为损坏
    if (!issue) {
      const rawFile = files.find(f => f === 'lyrics_raw.txt');
      const lrcFile = files.find(f => f.endsWith('.lrc'));
      const krcFile = files.find(f => f === 'lyrics_krc.json');
      let rawContent = '';
      if (rawFile) {
        try { rawContent = fs.readFileSync(path.join(folderPath, rawFile), 'utf-8'); } catch (e) {}
      }
      let lrcContent = '';
      if (lrcFile) {
        try { lrcContent = fs.readFileSync(path.join(folderPath, lrcFile), 'utf-8'); } catch (e) {}
      }
      // 检测是否含逐字格式 (至少 3 行匹配 [数字,数字])
      const rawLineCount = (rawContent.match(/^\[\d+,\d+\]/gm) || []).length;
      const hasRawFormat = rawLineCount >= 3;
      // 检测 LRC 是否有实际时间戳歌词行 [mm:ss.cc] 后跟文字
      const lrcTimedLineCount = (lrcContent.match(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*\S/gm) || []).length;
      if (!hasRawFormat) {
        if (lrcTimedLineCount === 0 && !rawFile) {
          // 完全无歌词文件, 或歌词文件只有 [ti:][ar:] 等元数据头 → 纯音乐, 不标记
        } else if (lrcTimedLineCount <= 2) {
          // 只有 1-2 行零散歌词, 视为纯音乐(如 "纯音乐请欣赏"), 不标记为损坏
        } else {
          // 有完整 LRC 但非逐字格式 → 歌词精度不足
          issue = krcFile ? '歌词精度不足' : '歌词精度不足(需重新解析)';
        }
      }
    }

    // 名称异常检测: 歌名为 "？" 或其他无效字符, 但 FLAC 文件内嵌了真实标题
    // 例: 酷狗某些歌曲的 name 字段为 "？ - 薛之谦.mp3", 但 FLAC VORBIS_COMMENT 有 TITLE=陪你去流浪
    // 这种情况可以通过读取 FLAC 元数据快速修复, 无需重新下载
    if (!issue && normalAudio) {
      // 判断歌名是否无效(只有问号/空白/单字符)
      let _songNameForCheck = info && (info.title || info.songName) ? (info.title || info.songName) : '';
      if (!_songNameForCheck && folder.includes(' - ')) {
        _songNameForCheck = folder.slice(0, folder.lastIndexOf(' - ')).trim();
      }
      const _isInvalidName = !_songNameForCheck ||
                            /^[\?\s*]+$/.test(_songNameForCheck) ||  // 全是 ?/空格/*
                            _songNameForCheck.length === 1;  // 单字符(通常是问号)
      if (_isInvalidName && /\.flac$/i.test(normalAudio)) {
        const _flacTags = readFlacTags(path.join(folderPath, normalAudio));
        if (_flacTags && _flacTags.title) {
          issue = '名称异常';
        }
      }
    }

    if (issue) {
      let songName = folder, artist = '未知艺人';
      if (folder && folder.includes(' - ')) {
        // 用最后一个 " - " 拆分, 正确处理歌名自身含 " - " 的情况
        const li = folder.lastIndexOf(' - ');
        songName = folder.slice(0, li).trim();
        artist = folder.slice(li + 3).trim();
      }
      if (info) {
        if (info.title) songName = info.title;
        else if (info.songName) songName = info.songName;  // 旧格式兼容
        if (info.artist) artist = info.artist;
      }
      // 去掉 title 自带的艺人后缀
      if (artist && artist !== '未知艺人' && songName.endsWith(' - ' + artist)) {
        songName = songName.slice(0, -(artist.length + 3)).trim();
      }
      // 封面路径(用于在修复列表中显示缩略图)
      const coverFile = files.find(f => /^cover\.(jpg|jpeg|png|webp)$/i.test(f));
      const coverPath = coverFile ? path.join(folderPath, coverFile).replace(/\\/g, '/') : '';
      damaged.push({
        folder,
        title: songName,
        artist,
        trackId: (info && info.trackId) || '',
        duration: (info && info.duration) || 0,
        issue,
        coverPath,
      });
    }
  }
  return damaged;
});

// IPC: 修复单首歌曲
// 音频问题 → 用 trackId 重新下载; 歌词问题 → 从 lyrics_krc.json 重新生成逐字 raw
ipcMain.handle('repair-song', async (event, item) => {
  const log = (msg) => console.log(`[REPAIR] ${item.folder || item.title}: ${msg}`);
  try {
    const isLyricsIssue = item.issue && item.issue.includes('歌词');
    const isCreditsIssue = item.issue === '版权信息缺失';
    const isNameIssue = item.issue === '名称异常';
    const folderPath = path.join(__dirname, '..', 'output', item.folder);

    if (isNameIssue) {
      // 名称异常修复: 从 FLAC VORBIS_COMMENT 读取真实 TITLE/ARTIST/ALBUM,
      // 重命名文件夹 + 音频文件 + info.json 更新 + lrc 头部更新
      log('名称异常修复: 读取 FLAC 元数据');
      const files = fs.readdirSync(folderPath);
      const flacFile = files.find(f => /\.flac$/i.test(f));
      if (!flacFile) throw new Error('未找到 FLAC 文件');
      const flacPath = path.join(folderPath, flacFile);
      const tags = readFlacTags(flacPath);
      if (!tags || !tags.title) throw new Error('FLAC 元数据中无 TITLE');
      log(`读取到: title="${tags.title}" artist="${tags.artist}" album="${tags.album}"`);

      // 构建新名称
      const newArtist = tags.artist || (item.artist && item.artist !== '未知艺人' ? item.artist : '');
      const newTitle = tags.title;
      const newAlbum = tags.album || '';
      const newFolderName = newArtist ? `${newTitle} - ${newArtist}` : newTitle;
      const newFolderPath = path.join(__dirname, '..', 'output', newFolderName);
      if (fs.existsSync(newFolderPath) && newFolderPath !== folderPath) {
        throw new Error(`目标文件夹已存在: ${newFolderName}`);
      }

      // 1. 重命名音频文件 (旧名 → 新名, 保持 .flac 扩展名)
      const newFlacName = `${newFolderName}.flac`;
      const newFlacPath = path.join(folderPath, newFlacName);
      if (flacPath !== newFlacPath) {
        fs.renameSync(flacPath, newFlacPath);
        log(`音频重命名: ${flacFile} → ${newFlacName}`);
      }

      // 2. 重命名 lrc 文件
      const lrcFile = files.find(f => f.endsWith('.lrc'));
      if (lrcFile) {
        const newLrcName = `${newFolderName}.lrc`;
        const oldLrcPath = path.join(folderPath, lrcFile);
        const newLrcPath = path.join(folderPath, newLrcName);
        if (oldLrcPath !== newLrcPath) {
          // 同时更新 lrc 头部 [ti:][ar:][al:] 为真实信息
          let lrcText = fs.readFileSync(oldLrcPath, 'utf-8');
          lrcText = lrcText.replace(/^\s*\[ti\s*:\s*[^\]]*\]/im, `[ti:${newTitle}]`);
          lrcText = lrcText.replace(/^\s*\[ar\s*:\s*[^\]]*\]/im, `[ar:${newArtist}]`);
          lrcText = lrcText.replace(/^\s*\[al\s*:\s*[^\]]*\]/im, `[al:${newAlbum}]`);
          // 如果没有 [ti:] 行, 在头部插入
          if (!/^\s*\[ti\s*:/im.test(lrcText)) {
            lrcText = `[ti:${newTitle}]\n[ar:${newArtist}]\n[al:${newAlbum}]\n` + lrcText;
          }
          fs.writeFileSync(oldLrcPath, lrcText, 'utf-8');
          fs.renameSync(oldLrcPath, newLrcPath);
          log(`歌词重命名: ${lrcFile} → ${newLrcName}`);
        }
      }

      // 3. 更新 info.json
      const infoPath = path.join(folderPath, 'info.json');
      let info = {};
      if (fs.existsSync(infoPath)) {
        try { info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')); } catch (e) {}
      }
      info.title = newTitle;
      if (newArtist) info.artist = newArtist;
      if (newAlbum) info.album = newAlbum;
      fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf-8');
      log('info.json 已更新');

      // 4. 重命名文件夹
      if (folderPath !== newFolderPath) {
        fs.renameSync(folderPath, newFolderPath);
        log(`文件夹重命名: ${item.folder} → ${newFolderName}`);
      }

      log('名称异常修复成功');
      return { ok: true, data: { folder: newFolderName } };
    }

    if (isLyricsIssue) {
      // 歌词修复: 从 lyrics_krc.json 重新生成逐字 raw
      // 注意: fetchTrackV2 不返回歌词, 歌词来自分享链接 HTML, 所以无 krc.json 时无法修复
      const krcPath = path.join(folderPath, 'lyrics_krc.json');
      if (!fs.existsSync(krcPath)) throw new Error('无备用歌词数据, 请重新解析分享链接下载');
      log('歌词修复: 从 lyrics_krc.json 重新生成 raw');
      const krc = JSON.parse(fs.readFileSync(krcPath, 'utf-8'));
      const rawText = krcToRaw(krc);
      if (!rawText) throw new Error('krc 数据为空, 无法生成逐字歌词');
      fs.writeFileSync(path.join(folderPath, 'lyrics_raw.txt'), rawText, 'utf-8');
      log('歌词修复成功');
      return { ok: true, data: { folder: item.folder } };
    }

    if (isCreditsIssue) {
      // 版权信息修复: 用 trackId 重新调用 fetchTrackV2 获取 metadata, 补全 info.json 的 lyricist/composer
      // 注意: fetchTrackV2 返回的 metadata 可能也不含作家字段, 此时无法自动修复
      log(`版权信息修复: trackId=${item.trackId}`);
      if (!item.trackId) throw new Error('缺少 trackId, 无法重新拉取版权信息');
      const full = await fetchTrackV2(item.trackId);
      const lyricist = (full.lyricist || '').trim();
      const composer = (full.composer || '').trim();
      if (!lyricist && !composer) {
        throw new Error('服务端未返回作词/作曲信息, 无法自动补全');
      }
      // 更新 info.json (保留原有字段, 补充作家)
      const infoPath = path.join(folderPath, 'info.json');
      let info = {};
      if (fs.existsSync(infoPath)) {
        try { info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')); } catch (e) {}
      }
      if (lyricist) info.lyricist = lyricist;
      if (composer) info.composer = composer;
      fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf-8');
      log(`版权信息修复成功: lyricist=${lyricist || '(空)'}, composer=${composer || '(空)'}`);
      return { ok: true, data: { folder: item.folder } };
    }

    // 音频修复: 用 trackId 重新拉取并下载
    log(`音频修复: trackId=${item.trackId}`);
    if (!item.trackId) throw new Error('缺少 trackId, 无法修复');
    log('调用 fetchTrackV2...');
    const full = await fetchTrackV2(item.trackId);
    log(`fetchTrackV2 返回: url=${full.url ? '有' : '无'}, playAuth=${full.playAuth ? '有' : '无'}, duration=${full.duration || 0}`);
    const info = {
      title: item.title,
      artist: item.artist,
      album: '',
      cover: full.cover || '',
      lrc: '',
      krc: null,
      duration: item.duration || (full.duration || 0),
      url: full.url || '',
      playAuth: full.playAuth || '',
      trackId: String(item.trackId),
      source: item.source || 'qishui',
      lyricist: full.lyricist || '',
      composer: full.composer || '',
    };
    if (!info.url) throw new Error('重新拉取后仍未获取音频地址');
    log('开始下载...');
    const result = await downloadParsedSong(info, () => {}, { audio: true, cover: true, lrc: false, info: true });
    log('修复成功');
    return { ok: true, data: result };
  } catch (e) {
    log(`修复失败: ${e.message}\n${e.stack || ''}`);
    return { ok: false, message: e.message };
  }
});

// IPC: 手动修复歌词(用户提供分享链接, 重新解析获取 krc 歌词)
ipcMain.handle('repair-lyrics-manual', async (event, { folder, shareLink }) => {
  const log = (msg) => console.log(`[REPAIR_LYRICS] ${folder}: ${msg}`);
  try {
    log(`手动修复歌词, 链接: ${shareLink}`);
    const folderPath = path.join(__dirname, '..', 'output', folder);
    if (!fs.existsSync(folderPath)) throw new Error('歌曲文件夹不存在');

    // 读取现有 info.json
    const infoPath = path.join(folderPath, 'info.json');
    let info = {};
    if (fs.existsSync(infoPath)) {
      try { info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')); } catch (e) {}
    }

    // 重新解析分享链接获取完整数据(含 krc 歌词)
    log('调用 parseMusicLink...');
    const parsed = await parseMusicLink(shareLink);
    if (!parsed.krc) throw new Error('解析成功但未获取到逐字歌词数据');

    // 验证: 解析出的歌曲必须与本地歌曲匹配, 防止错误链接覆盖导致歌曲混乱
    // 优先用 trackId 匹配(最可靠); 无 trackId 时回退到 title+artist 匹配
    if (info.trackId) {
      if (!parsed.trackId) {
        throw new Error('解析到的链接无 trackId, 无法验证歌曲匹配, 请确认链接正确');
      }
      if (String(parsed.trackId) !== String(info.trackId)) {
        throw new Error(`链接对应的歌曲(trackId: ${parsed.trackId})与当前歌曲(trackId: ${info.trackId})不匹配, 请确认链接正确`);
      }
    } else {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const titleMatch = norm(parsed.title) === norm(info.title);
      const artistMatch = norm(parsed.artist) === norm(info.artist);
      if (!titleMatch || !artistMatch) {
        throw new Error(`链接对应的歌曲(${parsed.title || '?'} - ${parsed.artist || '?'})与当前歌曲(${info.title || '?'} - ${info.artist || '?'})不匹配, 请确认链接正确`);
      }
    }

    // 保存 krc.json + 重新生成 raw + 更新 lrc
    fs.writeFileSync(path.join(folderPath, 'lyrics_krc.json'), JSON.stringify(parsed.krc, null, 2), 'utf-8');
    const rawText = krcToRaw(parsed.krc);
    fs.writeFileSync(path.join(folderPath, 'lyrics_raw.txt'), rawText, 'utf-8');
    if (parsed.lrc) {
      const songName = sanitizeFileName(info.title || parsed.title);
      const artistName = sanitizeFileName(info.artist || parsed.artist);
      fs.writeFileSync(path.join(folderPath, `${songName} - ${artistName}.lrc`), parsed.lrc, 'utf-8');
    }
    // 同步更新 info.json 的作家字段(手动修复时一并补全版权信息)
    if (parsed.lyricist || parsed.composer) {
      if (parsed.lyricist) info.lyricist = parsed.lyricist;
      if (parsed.composer) info.composer = parsed.composer;
      fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf-8');
    }

    log('手动歌词修复成功');
    return { ok: true, data: { folder, title: parsed.title, artist: parsed.artist } };
  } catch (e) {
    log(`手动歌词修复失败: ${e.message}`);
    return { ok: false, message: e.message };
  }
});

module.exports = {};
