// =========== 提取封面色彩分布 ===========
// 用 jpeg-js 解码 JPG (纯 JS, 无色彩空间转换, 比 nativeImage 准确)
// PNG 回退到 nativeImage (PNG 无色彩空间问题)
// 缩放到 48x48 遍历像素, 按 HSL 色相分 12 个扇区 + 灰度单独一类, 共 13 个桶
// 每个桶记录像素数 + 平均色, 返回所有非空桶的 [{r,g,b,weight}] 数组
// weight 是相对像素占比(0-1), 渲染进程用这些颜色生成随机渐变
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

// 从已解码的 RGBA bitmap 中提取颜色分布
// bitmap: Uint8Array RGBA, 长度 = 48*48*4
function extractColorFromBitmap(bitmap) {
  // 13 个桶: 0 = 灰度类, 1-12 = 12 个色相扇区
  const buckets = [];
  for (let i = 0; i < 13; i++) buckets.push({ count: 0, r: 0, g: 0, b: 0 });
  let total = 0;

  for (let i = 0; i < bitmap.length; i += 4) {
    const r = bitmap[i], g = bitmap[i + 1], b = bitmap[i + 2], a = bitmap[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = (max + min) / 2;
    if (lum < 8 || lum > 248) continue;  // 过滤纯黑/纯白

    // RGB → HSL (只算 H 和 S)
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const maxC = Math.max(rr, gg, bb), minC = Math.min(rr, gg, bb);
    const l = (maxC + minC) / 2;
    let h = 0, s = 0;
    if (maxC !== minC) {
      const d = maxC - minC;
      s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
      switch (maxC) {
        case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
        case gg: h = (bb - rr) / d + 2; break;
        case bb: h = (rr - gg) / d + 4; break;
      }
      h /= 6;
    }

    let idx;
    if (s < 0.1) idx = 0;             // 灰度
    else { idx = Math.floor(h * 12) + 1; if (idx > 12) idx = 12; }

    buckets[idx].count++;
    buckets[idx].r += r;
    buckets[idx].g += g;
    buckets[idx].b += b;
    total++;
  }

  if (total === 0) return null;

  // 返回所有非空桶, 按像素数降序, 含相对权重
  // 特殊处理: 灰度桶(idx=0)强制中性化, 消除微绿/微红等偏色
  return buckets
    .filter(b => b.count > 0)
    .map((b, idx) => {
      const lum = Math.round((b.r + b.g + b.b) / (3 * b.count));
      return {
        r: idx === 0 ? lum : Math.round(b.r / b.count),
        g: idx === 0 ? lum : Math.round(b.g / b.count),
        b: idx === 0 ? lum : Math.round(b.b / b.count),
        weight: b.count / total,
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

// 从图片二进制 Buffer 中提取颜色 (支持 JPG/PNG)
// 内部使用: 文件路径 / 远程 URL 下载都先得到 Buffer, 再统一走此函数
function extractColorFromBuffer(buf) {
  let bitmap = null;
  // 优先尝试 jpeg-js 解码 (JPG 无色彩空间问题)
  try {
    const jpeg = require('jpeg-js');
    const raw = jpeg.decode(buf, { useTArray: true });
    const OW = raw.width, OH = raw.height;
    bitmap = new Uint8Array(48 * 48 * 4);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const sx = Math.floor(x * OW / 48), sy = Math.floor(y * OH / 48);
        const si = (sy * OW + sx) * 4, di = (y * 48 + x) * 4;
        bitmap[di] = raw.data[si];
        bitmap[di + 1] = raw.data[si + 1];
        bitmap[di + 2] = raw.data[si + 2];
        bitmap[di + 3] = raw.data[si + 3];
      }
    }
  } catch (e) {
    bitmap = null;  // 不是 JPG, 走 nativeImage
  }
  if (!bitmap) {
    // PNG 或其他格式: 用 nativeImage 解码
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const small = img.resize({ width: 48, height: 48 });
      bitmap = small.toBitmap();
    } catch (e) {
      return null;
    }
  }
  return extractColorFromBitmap(bitmap);
}

function extractCoverColor(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;

    // 读取文件 Buffer, 走统一的 extractColorFromBuffer
    const buf = fs.readFileSync(filePath);
    return extractColorFromBuffer(buf);
  } catch (e) {
    console.error(`[COVER-COLOR] 解析失败 ${filePath}:`, e.message);
    return null;
  }
}

// 从远程 URL 下载图片并提取颜色 (用于汽水/免费听等远程封面)
// 超时 5s, 失败返回 null (调用方应回退到无背景)
async function extractCoverColorFromURL(url) {
  try {
    if (!url || typeof url !== 'string') return null;
    // data: URL 直接解析 (避免 fetch 开销)
    if (url.startsWith('data:')) {
      const m = url.match(/^data:image\/\w+;base64,(.+)$/);
      if (m) {
        return extractColorFromBuffer(Buffer.from(m[1], 'base64'));
      }
      return null;
    }
    // http/https URL: 下载二进制
    if (!/^https?:\/\//i.test(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      return extractColorFromBuffer(buf);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`[COVER-COLOR] URL 解析失败 ${url}:`, e.message);
    return null;
  }
}

ipcMain.handle('extract-cover-color', (event, filePath) => extractCoverColor(filePath));
ipcMain.handle('extract-cover-color-url', (event, url) => extractCoverColorFromURL(url));

module.exports = { extractCoverColor, extractCoverColorFromURL, extractColorFromBuffer };
