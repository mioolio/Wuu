// =========== 音频文件深度校验 ===========
// 递归扫描 MP4 box 树, 检测未解密(enca)/缺少 mdat/数据异常(解密失败产生的高熵垃圾)
// 返回 { valid: boolean, reason: string }
const fs = require('fs');
const { readUInt32BE, indexOfBytes } = require('../soda/decrypt');

// 容器 box 需要深入扫描: moov/trak/mdia/minf/stbl/sinf/edts/udta
const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'sinf', 'edts', 'udta', 'mvex']);

function scanAllBoxes(buf, start, end, depth = 0) {
  const found = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size = readUInt32BE(buf, pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (size < 8 || pos + size > end) break;
    found.push({ offset: pos, size, type, depth });
    if (CONTAINER_BOXES.has(type)) {
      found.push(...scanAllBoxes(buf, pos + 8, pos + size, depth + 1));
    }
    pos += size;
  }
  return found;
}

// 验证音频文件有效性: 检测未解密/数据损坏/截断等问题
// 检测项: 1) stsd 是 enca(未解密) 2) 缺少 mdat 3) AAC sample 首字节一致性(检测解密失败产生的高熵垃圾数据)
function verifyAudioFile(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    return { valid: false, reason: '读取失败' };
  }
  if (buf.length < 10240) return { valid: false, reason: '文件过小' };

  // 非 MP4 容器(如 mp3/wav/aac/adts)只按大小判断
  const ftyp = buf.toString('latin1', 4, 8);
  if (ftyp !== 'ftyp' && ftyp !== 'moov' && ftyp !== 'mdat' && ftyp !== 'free') {
    return { valid: true };
  }

  const boxes = scanAllBoxes(buf, 0, buf.length);
  const types = new Map();
  for (const b of boxes) {
    if (!types.has(b.type)) types.set(b.type, b);
  }

  // 1. stsd 里是否仍是 enca (加密音频样本入口, 未解密)
  const stsdBox = types.get('stsd');
  if (stsdBox) {
    const stsdData = buf.subarray(stsdBox.offset + 8, stsdBox.offset + stsdBox.size);
    if (indexOfBytes(stsdData, Buffer.from('enca')) >= 0) {
      return { valid: false, reason: '未解密 (enca)' };
    }
  }

  // 2. 必须有 mdat (实际音频数据)
  const mdat = types.get('mdat');
  if (!mdat) return { valid: false, reason: '缺少 mdat 数据' };

  // 3. AAC sample 首字节一致性检测
  //    正常 AAC 音频的每个 sample 帧头有固定结构, 首字节高度一致(>50%)
  //    解密失败产生的高熵垃圾数据首字节完全随机(<15%)
  //    取前 20 个 sample 的首字节统计主导字节占比
  const stszBox = types.get('stsz');
  if (stszBox && stszBox.size >= 8 + 12) {
    const stszStart = stszBox.offset + 8;
    const sampleSizeFixed = readUInt32BE(buf, stszStart + 4);
    const sampleCount = readUInt32BE(buf, stszStart + 8);
    if (sampleCount >= 5) {
      const mdatStart = mdat.offset + 8;
      const mdatEnd = mdat.offset + mdat.size;
      const checkCount = Math.min(20, sampleCount);
      const firstBytes = [];
      let offset = mdatStart;
      for (let i = 0; i < checkCount; i++) {
        const sz = sampleSizeFixed || readUInt32BE(buf, stszStart + 12 + i * 4);
        if (sz > 0 && offset + sz <= mdatEnd) {
          firstBytes.push(buf[offset]);
          offset += sz;
        }
      }
      if (firstBytes.length >= 5) {
        const counts = new Map();
        for (const b of firstBytes) counts.set(b, (counts.get(b) || 0) + 1);
        let maxCount = 0;
        for (const c of counts.values()) if (c > maxCount) maxCount = c;
        const ratio = maxCount / firstBytes.length;
        if (ratio < 0.5) {
          return { valid: false, reason: `数据异常: sample 首字节一致率 ${(ratio * 100).toFixed(0)}%` };
        }
      }
    }
  }

  return { valid: true };
}

module.exports = { CONTAINER_BOXES, scanAllBoxes, verifyAudioFile };
