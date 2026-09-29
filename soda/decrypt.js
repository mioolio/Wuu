// =========== Soda 音频解密 (AES-CTR) + MP4 box 原语 ===========
// 汽水音乐完整版 m4a/mp4 音频是加密的, 需用 playAuth 提取密钥后 AES-CTR 解密
// readUInt32BE / readUInt16BE / indexOfBytes 为 MP4 box 操作原语, 也被 audio/verify 复用
const crypto = require('crypto');
const ENCA_BYTES = Buffer.from('enca');
const MP4A_BYTES = Buffer.from('mp4a');

function readUInt32BE(buf, offset) { return buf.readUInt32BE(offset); }
function readUInt16BE(buf, offset) { return buf.readUInt16BE(offset); }

function findBox(data, boxType, start, end) {
  if (start === undefined) start = 0;
  if (end === undefined) end = data.length;
  let pos = start;
  while (pos + 8 <= end) {
    const size = readUInt32BE(data, pos);
    if (size < 8 || pos + size > data.length) break;
    const type = data.toString('ascii', pos + 4, pos + 8);
    if (type === boxType) {
      return { offset: pos, size, data: data.subarray(pos + 8, pos + size) };
    }
    pos += size;
  }
  return null;
}

function indexOfBytes(haystack, needle) {
  if (!needle.length || haystack.length < needle.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Spade 解密: 从 playAuth base64 字符串提取 hex 密钥
function bitCount(v) {
  let c = v >>> 0;
  c -= (c >>> 1) & 0x55555555;
  c = (c & 0x33333333) + ((c >>> 2) & 0x33333333);
  return (((c + (c >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function decodeBase36(v) {
  if (v >= 48 && v <= 57) return v - 48;
  if (v >= 97 && v <= 122) return v - 97 + 10;
  return 0xff;
}
function extractSpadeKey(playAuth) {
  const bytes = Buffer.from(playAuth, 'base64');
  if (bytes.length < 3) return null;
  const paddingLength = (bytes[0] ^ bytes[1] ^ bytes[2]) - 48;
  if (bytes.length < paddingLength + 2) return null;
  const inner = bytes.subarray(1, bytes.length - paddingLength);
  const prefix = Buffer.from([0xfa, 0x55]);
  const buff = Buffer.concat([prefix, inner]);
  const result = Buffer.alloc(inner.length);
  for (let i = 0; i < result.length; i++) {
    const raw = (inner[i] ^ buff[i]) - bitCount(i) - 21;
    result[i] = raw >= 0 ? raw : ((raw % 255) + 255) % 255;
  }
  if (!result.length) return null;
  const endIndex = 1 + (bytes.length - paddingLength - 2) - decodeBase36(result[0]);
  return result.toString('utf8', 1, endIndex);
}

// AES-CTR 解密
function decryptAesCtr(data, keyHex, iv) {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// 解密 Soda 加密的音频数据
function decryptSodaAudio(fileData, playAuth) {
  const hexKey = extractSpadeKey(playAuth);
  if (!hexKey) return { data: fileData, decrypted: false, reason: 'key extraction failed' };
  const moov = findBox(fileData, 'moov');
  if (!moov) return { data: fileData, decrypted: false, reason: 'moov not found' };

  let senc = findBox(fileData, 'senc', moov.offset + 8, moov.offset + moov.size);
  const trak = findBox(fileData, 'trak', moov.offset + 8, moov.offset + moov.size);
  if (!trak) return { data: fileData, decrypted: false, reason: 'trak not found' };
  const mdia = findBox(fileData, 'mdia', trak.offset + 8, trak.offset + trak.size);
  if (!mdia) return { data: fileData, decrypted: false, reason: 'mdia not found' };
  const minf = findBox(fileData, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
  if (!minf) return { data: fileData, decrypted: false, reason: 'minf not found' };
  const stbl = findBox(fileData, 'stbl', minf.offset + 8, minf.offset + minf.size);
  if (!stbl) return { data: fileData, decrypted: false, reason: 'stbl not found' };
  const stsz = findBox(fileData, 'stsz', stbl.offset + 8, stbl.offset + stbl.size);
  if (!stsz) return { data: fileData, decrypted: false, reason: 'stsz not found' };

  const stszData = stsz.data;
  const sampleSizeFixed = readUInt32BE(stszData, 4);
  const sampleCount = readUInt32BE(stszData, 8);
  const sampleSizes = [];
  if (sampleSizeFixed) {
    for (let i = 0; i < sampleCount; i++) sampleSizes.push(sampleSizeFixed);
  } else {
    for (let i = 0; i < sampleCount; i++) sampleSizes.push(readUInt32BE(stszData, 12 + i * 4));
  }

  if (!senc) {
    senc = findBox(fileData, 'senc', stbl.offset + 8, stbl.offset + stbl.size);
    if (!senc) return { data: fileData, decrypted: false, reason: 'senc not found' };
  }
  const sencData = senc.data;
  const sencFlags = readUInt32BE(sencData, 0) & 0x00ffffff;
  const sencSampleCount = readUInt32BE(sencData, 4);
  // IV 数量与样本数不一致 → 跳过解密(避免错位产生垃圾数据)
  if (sencSampleCount !== sampleCount) {
    return { data: fileData, decrypted: false, reason: `senc count mismatch: ${sencSampleCount} vs ${sampleCount}` };
  }
  const ivs = [];
  let sencPtr = 8;
  for (let i = 0; i < sencSampleCount; i++) {
    const iv = Buffer.alloc(16, 0);
    sencData.copy(iv, 0, sencPtr, sencPtr + 8);
    ivs.push(iv);
    sencPtr += 8;
    if ((sencFlags & 0x02) !== 0) {
      const subCount = readUInt16BE(sencData, sencPtr);
      sencPtr += 2 + subCount * 6;
    }
  }

  const mdat = findBox(fileData, 'mdat');
  if (!mdat) return { data: fileData, decrypted: false, reason: 'mdat not found' };

  const output = Buffer.from(fileData);
  let readPtr = mdat.offset + 8;
  for (let i = 0; i < sampleSizes.length; i++) {
    const sample = fileData.subarray(readPtr, readPtr + sampleSizes[i]);
    if (i < ivs.length) {
      const dec = decryptAesCtr(sample, hexKey, ivs[i]);
      dec.copy(output, readPtr);
    }
    readPtr += sampleSizes[i];
  }

  // 1. stsd 里把 'enca' 改成 'mp4a'
  const stsd = findBox(output, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
  if (stsd) {
    const encaIndex = indexOfBytes(output.subarray(stsd.offset, stsd.offset + stsd.size), ENCA_BYTES);
    if (encaIndex >= 0) {
      MP4A_BYTES.copy(output, stsd.offset + encaIndex);
    }
  }

  // 2. 清理加密元数据 box: 把 sinf/senc/saiz/sais 的类型改为 'free' 让解码器忽略
  //    不删除字节(避免重算所有父 box 的 size), 只改类型名
  const neutralizeTypes = ['sinf', 'senc', 'saiz', 'sais'];
  for (const type of neutralizeTypes) {
    const typeBytes = Buffer.from(type);
    // 在整个文件范围内搜索 box 类型(4字节ASCII), 改为 'free'
    let searchStart = 0;
    while (searchStart + 8 <= output.length) {
      const idx = indexOfBytes(output.subarray(searchStart), typeBytes);
      if (idx < 0) break;
      const absIdx = searchStart + idx;
      // 确认这是一个 box type(前面4字节是合理的 box size)
      if (absIdx >= 4) {
        const boxSize = readUInt32BE(output, absIdx - 4);
        if (boxSize >= 8 && absIdx - 4 + boxSize <= output.length) {
          Buffer.from('free').copy(output, absIdx);
        }
      }
      searchStart = absIdx + 4;
    }
  }

  return { data: output, decrypted: true, reason: 'decrypted' };
}

// 通过文件头魔数检测实际音频格式(优先于 Content-Type, 防止第三方代理错误标记)
// 返回扩展名(无点), 识别失败返回空字符串
function detectAudioExtByMagic(buf) {
  if (!buf || buf.length < 12) return '';
  // FLAC: "fLaC"
  if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) return 'flac';
  // MP3 ID3v2: "ID3"
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3';
  // MP3 帧同步: FF Ex (11 位同步字)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'mp3';
  // M4A/MP4: "ftyp" at offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'm4a';
  // OGG: "OggS"
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'ogg';
  // RIFF/WAV: "RIFF"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'wav';
  return '';
}

module.exports = {
  readUInt32BE, readUInt16BE, findBox, indexOfBytes,
  extractSpadeKey, decryptAesCtr, decryptSodaAudio,
  detectAudioExtByMagic,
};
