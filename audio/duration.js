// =========== 音频时长解析 (AAC/FLAC/MP3) + 后台异步解析 ===========
// AAC ADTS 帧格式: 每帧固定 1024 samples, 时长 = 帧数 × 1024 / sample_rate
// FLAC: 从 STREAMINFO metadata block 提取采样率 + 总采样数
// MP3: 遍历 MPEG 帧头计算精确时长
// 启动时 scanMusicFiles 只读缓存(瞬时返回), 未缓存的在此后台逐首解析
const fs = require('fs');
const path = require('path');
const { dbgLog } = require('../core/logger');
const { writeDurationCache, setCachedDuration } = require('../core/storage');
const { sendToMain } = require('../core/state');

let bgParsingDone = false;

function getAACDuration(filePath, silent = true) {
  const _dbg = (msg) => { if (!silent && typeof dbgLog === 'function') dbgLog(`[dur] ${msg}`); };
  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;
    if (fileSize < 10) { fs.closeSync(fd); _dbg(`fileSize=${fileSize} 过小`); return 0; }

    // 读取文件头用于调试
    const headBuf = Buffer.alloc(12);
    fs.readSync(fd, headBuf, 0, 12, 0);
    _dbg(`file=${path.basename(filePath)} size=${fileSize} head=${headBuf.toString('hex')} ascii="${headBuf.slice(0,4).toString('latin1')}"`);

    const sampleRateTable = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

    // 先尝试 FLAC 解析 (FLAC 文件无法用 AAC/MP3 帧解析)
    // 注意: 酷狗 quality=flac 可能被错误保存为 .mp3 扩展名, 这里通过文件头魔数识别
    const flacDur = getFLACDuration(fd, fileSize);
    if (flacDur > 0) { _dbg(`→ FLAC 解析成功: ${flacDur}s`); return flacDur; }

    // 再尝试 MP3 解析 (MP3 文件无法用 AAC 帧解析)
    const mp3Dur = getMP3Duration(fd, fileSize);
    if (mp3Dur > 0) { _dbg(`→ MP3 解析成功: ${mp3Dur}s`); return mp3Dur; }

    // 策略1: 小文件(<10MB)直接完整遍历所有帧
    if (fileSize <= 10 * 1024 * 1024) {
      const buf = Buffer.alloc(fileSize);
      fs.readSync(fd, buf, 0, fileSize, 0);
      fs.closeSync(fd);

      let offset = 0;
      let frameCount = 0;
      let sampleRate = 0;

      while (offset + 7 < fileSize) {
        if (buf[offset] === 0xFF && (buf[offset + 1] & 0xF0) === 0xF0) {
          const srIdx = (buf[offset + 2] >> 2) & 0xF;
          const frameLen = ((buf[offset + 3] & 0x3) << 11) | (buf[offset + 4] << 3) | ((buf[offset + 5] >> 5) & 0x7);

          if (frameLen < 7 || frameLen > 8192 || offset + frameLen > fileSize) { offset++; continue; }
          if (srIdx < sampleRateTable.length && sampleRate === 0) sampleRate = sampleRateTable[srIdx];

          frameCount++;
          offset += frameLen;
        } else {
          offset++;
        }
      }

      if (frameCount === 0 || sampleRate === 0) { _dbg(`→ AAC策略1 失败: frameCount=${frameCount} sampleRate=${sampleRate}`); return 0; }
      const duration = frameCount * 1024 / sampleRate;
      _dbg(`→ AAC策略1 成功: frames=${frameCount} sr=${sampleRate} → ${duration}s`);
      return duration;
    }

    // 策略2: 大文件分段采样
    // 读取前、中、后三个段，每段 64KB
    const segments = [
      { offset: 0, length: Math.min(65536, fileSize) },
      { offset: Math.max(0, Math.floor(fileSize / 2) - 32768), length: 65536 },
      { offset: Math.max(0, fileSize - 65536), length: 65536 },
    ];

    let totalFrames = 0;
    let totalFrameLen = 0;
    let sampleRate = 0;

    for (const seg of segments) {
      const buf = Buffer.alloc(seg.length);
      const bytesRead = fs.readSync(fd, buf, 0, seg.length, seg.offset);

      let offset = 0;
      while (offset + 7 < bytesRead) {
        if (buf[offset] === 0xFF && (buf[offset + 1] & 0xF0) === 0xF0) {
          const srIdx = (buf[offset + 2] >> 2) & 0xF;
          const frameLen = ((buf[offset + 3] & 0x3) << 11) | (buf[offset + 4] << 3) | ((buf[offset + 5] >> 5) & 0x7);

          if (frameLen < 7 || frameLen > 8192) { offset++; continue; }
          if (srIdx < sampleRateTable.length && sampleRate === 0) sampleRate = sampleRateTable[srIdx];

          totalFrames++;
          totalFrameLen += frameLen;
          offset += frameLen;
        } else {
          offset++;
        }
      }
    }

    fs.closeSync(fd);

    if (totalFrames === 0 || sampleRate === 0) { _dbg(`→ AAC策略2 失败: totalFrames=${totalFrames} sampleRate=${sampleRate}`); return 0; }

    const avgFrameLen = totalFrameLen / totalFrames;
    const estTotalFrames = fileSize / avgFrameLen;
    const duration = estTotalFrames * 1024 / sampleRate;

    _dbg(`→ AAC策略2 成功: frames=${totalFrames} avgLen=${avgFrameLen.toFixed(1)} sr=${sampleRate} → ${duration}s`);
    return duration;

  } catch (e) {
    _dbg(`→ 异常: ${e.message}`);
    return 0;
  }
}

// FLAC 时长解析: 从 STREAMINFO metadata block 提取采样率 + 总采样数
// FLAC 格式: "fLaC" + metadata blocks (每个 block: type(1) + isLast(1bit) + length(24bit) + data)
// STREAMINFO (type=0) 包含 min/max blocksize, min/max framesize, sampleRate(20bit),
// numChannels(3bit), bitsPerSample(5bit), totalSamples(36bit)
function getFLACDuration(fd, fileSize) {
  const _dbg = (msg) => { if (typeof dbgLog === 'function') dbgLog(`[FLAC:dur] ${msg}`); };
  try {
    const header = Buffer.alloc(4);
    const n = fs.readSync(fd, header, 0, 4, 0);
    if (n < 4) { _dbg(`readHeader 失败 n=${n}`); return 0; }
    // 必须是 "fLaC"
    if (header[0] !== 0x66 || header[1] !== 0x4C || header[2] !== 0x61 || header[3] !== 0x43) {
      _dbg(`非fLaC头: ${header.toString('hex')}`);
      return 0;
    }
    _dbg(`识别为 fLaC, fileSize=${fileSize}`);

    let offset = 4;
    let isLast = false;
    // 最多扫描 64 个 metadata block (正常 FLAC 只有几个)
    for (let i = 0; i < 64 && !isLast; i++) {
      const blockHeader = Buffer.alloc(4);
      const rn = fs.readSync(fd, blockHeader, 0, 4, offset);
      if (rn < 4) { _dbg(`readBlockHeader 失败 i=${i} offset=${offset}`); return 0; }
      const blockType = blockHeader[0] & 0x7F;
      isLast = (blockHeader[0] & 0x80) !== 0;
      const blockLen = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];
      if (blockLen <= 0 || blockLen > 16 * 1024 * 1024) { _dbg(`异常blockLen=${blockLen} i=${i}`); return 0; }

      if (blockType === 0) {
        // STREAMINFO block: 34 字节固定长度
        const streaminfo = Buffer.alloc(34);
        const rs = fs.readSync(fd, streaminfo, 0, 34, offset + 4);
        if (rs < 34) { _dbg(`readStreaminfo 失败 rs=${rs}`); return 0; }
        // sampleRate: bytes[10..12] 的前 20 位
        const sampleRate = (streaminfo[10] << 12) | (streaminfo[11] << 4) | ((streaminfo[12] & 0xF0) >> 4);
        // totalSamples: bytes[13..17] 的后 36 位
        const totalSamples = ((streaminfo[13] & 0x0F) * 0x100000000) +
                             (streaminfo[14] * 0x1000000) +
                             (streaminfo[15] * 0x10000) +
                             (streaminfo[16] * 0x100) +
                             streaminfo[17];
        const duration = (sampleRate > 0 && totalSamples > 0) ? totalSamples / sampleRate : 0;
        _dbg(`STREAMINFO: sampleRate=${sampleRate} totalSamples=${totalSamples} → duration=${duration}s`);
        return duration;
      }
      offset += 4 + blockLen;
    }
    _dbg(`未找到 STREAMINFO block`);
    return 0;
  } catch (e) {
    _dbg(`异常: ${e.message}`);
    return 0;
  }
}

// 从 FLAC VORBIS_COMMENT metadata block 读取元数据(TITLE/ARTIST/ALBUM 等)
// 用于修复"歌名异常"的歌曲(如酷狗某些歌曲 title 为 "？", 但 FLAC 内嵌了真实标题)
// 返回 { title, artist, album } 或 null(非 FLAC 文件或无 VORBIS_COMMENT)
function readFlacTags(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    const n = fs.readSync(fd, header, 0, 4, 0);
    if (n < 4) return null;
    // 必须是 "fLaC"
    if (header[0] !== 0x66 || header[1] !== 0x4C || header[2] !== 0x61 || header[3] !== 0x43) return null;

    let offset = 4;
    let isLast = false;
    // 扫描 metadata blocks, 找 type=4 (VORBIS_COMMENT)
    for (let i = 0; i < 64 && !isLast; i++) {
      const bh = Buffer.alloc(4);
      const rn = fs.readSync(fd, bh, 0, 4, offset);
      if (rn < 4) return null;
      const blockType = bh[0] & 0x7F;
      isLast = (bh[0] & 0x80) !== 0;
      const blockLen = (bh[1] << 16) | (bh[2] << 8) | bh[3];
      if (blockLen <= 0 || blockLen > 16 * 1024 * 1024) return null;

      if (blockType === 4) {
        // VORBIS_COMMENT 格式:
        // vendor_length(4, LE) + vendor_string + comment_count(4, LE) + comments
        // 每个 comment: length(4, LE) + string (UTF-8, 格式: KEY=VALUE)
        const data = Buffer.alloc(blockLen);
        fs.readSync(fd, data, 0, blockLen, offset + 4);
        let p = 0;
        const vendorLen = data.readUInt32LE(p); p += 4;
        if (p + vendorLen > data.length) return null;
        p += vendorLen;  // 跳过 vendor string
        if (p + 4 > data.length) return null;
        const commentCount = data.readUInt32LE(p); p += 4;

        const tags = {};
        for (let c = 0; c < commentCount && p < data.length; c++) {
          if (p + 4 > data.length) break;
          const clen = data.readUInt32LE(p); p += 4;
          if (p + clen > data.length) break;
          const cstr = data.slice(p, p + clen).toString('utf-8'); p += clen;
          const eqIdx = cstr.indexOf('=');
          if (eqIdx > 0) {
            const key = cstr.slice(0, eqIdx).toUpperCase();
            const val = cstr.slice(eqIdx + 1);
            // 只保留第一个值(通常 TITLE/ARTIST/ALBUM 各一条)
            if (!(key in tags)) tags[key] = val;
          }
        }
        fs.closeSync(fd);
        return {
          title: tags.TITLE || '',
          artist: tags.ARTIST || '',
          album: tags.ALBUM || '',
        };
      }
      offset += 4 + blockLen;
    }
    fs.closeSync(fd);
    return null;
  } catch (e) {
    if (fd) { try { fs.closeSync(fd); } catch (_) {} }
    return null;
  }
}

function getMP3Duration(fd, fileSize) {
  // MP3 比特率表 (索引: 版本*16 + 比特率索引)
  // MPEG1 Layer3: 32,40,48,56,64,80,96,112,128,160,192,224,256,320 (kbps)
  const bitrateTable = {
    11: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448,0], // MPEG1 L1
    12: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0],    // MPEG1 L2
    13: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0],    // MPEG1 L3
    22: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0],    // MPEG2 L2
    23: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],        // MPEG2 L3
  };
  // 采样率表 [版本][索引]
  const srTable = {
    1: [44100, 48000, 32000, 0],   // MPEG1
    2: [22050, 24000, 16000, 0],   // MPEG2
    3: [11025, 12000, 8000, 0],    // MPEG2.5
  };

  // 先读文件头: 排除 FLAC/OGG/M4A 等非 MP3 文件
  // 防止 FLAC 数据流中偶然出现 FF Ex 序列被误识别为 MP3 帧头
  const headBuf = Buffer.alloc(4);
  const hn = fs.readSync(fd, headBuf, 0, 4, 0);
  if (hn < 4) return 0;
  // fLaC (FLAC), OggS (OGG), ft yp at offset 4 (M4A/MP4 已在前面判断)
  if (headBuf[0] === 0x66 && headBuf[1] === 0x4C && headBuf[2] === 0x61 && headBuf[3] === 0x43) return 0; // fLaC
  if (headBuf[0] === 0x4F && headBuf[1] === 0x67 && headBuf[2] === 0x67 && headBuf[3] === 0x53) return 0; // OggS

  const buf = Buffer.alloc(fileSize);
  fs.readSync(fd, buf, 0, fileSize, 0);

  // 跳过 ID3v2 tag
  let offset = 0;
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    // ID3v2: 'ID3' + version(2) + flags(1) + size(4, syncsafe)
    const id3Size = (buf[6] & 0x7F) * 0x200000 + (buf[7] & 0x7F) * 0x4000 + (buf[8] & 0x7F) * 0x80 + (buf[9] & 0x7F);
    offset = id3Size + 10;
  }

  let totalFrames = 0;
  let totalSamples = 0;
  let sampleRate = 0;
  let firstFrameOffset = -1;

  while (offset + 4 < fileSize) {
    // MP3 帧同步: 11 位全 1 (0xFF E0)
    if (buf[offset] !== 0xFF || (buf[offset + 1] & 0xE0) !== 0xE0) { offset++; continue; }

    const verBits = (buf[offset + 1] >> 3) & 0x3;  // 00=2.5, 01=reserved, 10=MPEG2, 11=MPEG1
    const layerBits = (buf[offset + 1] >> 1) & 0x3; // 01=L3, 10=L2, 11=L1
    if (verBits === 1) { offset++; continue; } // reserved
    if (layerBits === 0) { offset++; continue; } // reserved

    const versionKey = verBits === 3 ? 1 : (verBits === 2 ? 2 : 3); // 1=MPEG1, 2=MPEG2, 3=MPEG2.5
    const layerKey = (4 - layerBits); // 1=L1, 2=L2, 3=L3
    const tableKey = versionKey * 10 + layerKey;

    const brIdx = (buf[offset + 2] >> 4) & 0xF;
    const srIdx = (buf[offset + 2] >> 2) & 0x3;
    const padding = (buf[offset + 2] >> 1) & 0x1;

    const bitrateArr = bitrateTable[tableKey];
    if (!bitrateArr || brIdx === 0 || brIdx === 15) { offset++; continue; }
    const bitrate = bitrateArr[brIdx] * 1000;
    if (bitrate === 0) { offset++; continue; }

    const srArr = srTable[versionKey];
    if (!srArr) { offset++; continue; }
    const sr = srArr[srIdx];
    if (sr === 0) { offset++; continue; }
    if (sampleRate === 0) sampleRate = sr;

    // 每帧样本数: MPEG1 L1=384, L2/L3=1152; MPEG2/2.5 L1=384, L2/L3=576
    const samplesPerFrame = (layerKey === 1) ? 384 : (versionKey === 1 ? 1152 : 576);
    // 帧大小计算
    let frameLen;
    if (layerKey === 1) {
      frameLen = Math.floor((12 * bitrate / sr + padding) * 4);
    } else {
      frameLen = Math.floor(samplesPerFrame / 8 * bitrate / sr) + padding;
    }

    if (frameLen < 4 || frameLen > 4096) { offset++; continue; }
    if (firstFrameOffset < 0) firstFrameOffset = offset;

    totalFrames++;
    totalSamples += samplesPerFrame;
    offset += frameLen;
  }

  if (totalFrames === 0 || sampleRate === 0) return 0;
  return totalSamples / sampleRate;
}

// 后台异步解析未缓存的 AAC 时长
// 启动时 scanMusicFiles 只读缓存(瞬时返回), 未缓存的在此后台逐首解析
// 每首解析完通过 IPC 'duration-update' 通知渲染进程刷新, 并写入缓存文件
function parseDurationsInBackground(songs) {
  let i = 0;
  let parsed = 0;
  function parseNext() {
    if (i >= songs.length) {
      if (parsed > 0) writeDurationCache();
      bgParsingDone = true;
      return;
    }
    const song = songs[i];
    const idx = i;
    i++;
    // 已有缓存值且合理(>30秒), 跳过
    // 修复: 缓存的 duration < 30 秒但文件 >1MB 时, 可能是误解析(如 FLAC 被当 MP3),
    //       需要重新解析
    if (song.realDuration > 30) { setImmediate(parseNext); return; }
    if (song.realDuration > 0 && song.realDuration <= 30) {
      // 可疑缓存: 检查文件大小, >1MB 的音频文件不可能只有 30 秒
      try {
        const stat = fs.statSync(song.audioPath);
        if (stat.size > 1024 * 1024) {
          if (typeof dbgLog === 'function') dbgLog(`[bgParse] #${idx} "${song.songName}" 可疑缓存 ${song.realDuration}s, 文件 ${Math.round(stat.size/1024/1024)}MB, 重新解析`);
          song.realDuration = 0;  // 清除可疑缓存, 强制重新解析
        }
      } catch (e) {}
    }
    // 解析 AAC 时长 (silent=false 启用调试日志, 写入 wuu-debug.log)
    const duration = getAACDuration(song.audioPath, false);
    song.realDuration = duration;
    if (typeof dbgLog === 'function') dbgLog(`[bgParse] #${idx} "${song.songName}" → realDuration=${duration}s (缓存前=${song.realDuration})`);
    parsed++;
    // 写入缓存
    try {
      const stat = fs.statSync(song.audioPath);
      setCachedDuration(song.audioPath, stat.mtimeMs, duration);
    } catch (e) {}
    // 通知渲染进程
    if (duration > 0) sendToMain('duration-update', { idx, duration });
    // 每 10 首落盘一次缓存
    if (parsed % 10 === 0) writeDurationCache();
    // 让出事件循环, 避免阻塞主进程
    setImmediate(parseNext);
  }
  parseNext();
}

module.exports = {
  getAACDuration, getFLACDuration, getMP3Duration, readFlacTags,
  parseDurationsInBackground, isBgParsingDone: () => bgParsingDone,
};
