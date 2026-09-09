// 生成应用图标 build/icon.ico —— 纯 Node 实现, 无第三方依赖
// 图案: 品牌粉渐变圆角底 + 白色双八分音符 (与 UI accent #fb7299 一致)
// 用法: node scripts/make-icon.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;   // 逻辑画布尺寸
const SS = 3;        // 超采样倍数 (抗锯齿)
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

// ---------- 几何判定 ----------
function insideRoundedRect(x, y, s, r) {
  if (x < 0 || y < 0 || x > s || y > s) return false;
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideEllipse(x, y, cx, cy, rx, ry, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const dx = x - cx, dy = y - cy;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
}

function insideRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function insideConvexQuad(x, y, pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 4];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

// ---------- 图案定义 (1024 坐标系) ----------
const NOTE = (() => {
  const ang = (-20 * Math.PI) / 180;
  return {
    head1: { cx: 352, cy: 724, rx: 98, ry: 71, ang },
    head2: { cx: 688, cy: 676, rx: 98, ry: 71, ang },
    stem1: { x0: 424, y0: 328, x1: 466, y1: 724 },
    stem2: { x0: 760, y0: 260, x1: 802, y1: 676 },
    beam: [[424, 328], [802, 260], [802, 364], [424, 432]],
  };
})();

function insideNote(x, y) {
  const n = NOTE;
  return (
    insideEllipse(x, y, n.head1.cx, n.head1.cy, n.head1.rx, n.head1.ry, n.head1.ang) ||
    insideEllipse(x, y, n.head2.cx, n.head2.cy, n.head2.rx, n.head2.ry, n.head2.ang) ||
    insideRect(x, y, n.stem1.x0, n.stem1.y0, n.stem1.x1, n.stem1.y1) ||
    insideRect(x, y, n.stem2.x0, n.stem2.y0, n.stem2.x1, n.stem2.y1) ||
    insideConvexQuad(x, y, n.beam)
  );
}

// 渐变: 顶部亮粉 -> 底部深粉 (accent #fb7299 居中)
const TOP = [0xff, 0x93, 0xb0];
const BOTTOM = [0xef, 0x4b, 0x7c];

// 渲染 size x size RGBA (超采样)
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = size * SS;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = i + (si + 0.5) / SS;
          const y = j + (sj + 0.5) / SS;
          if (!insideRoundedRect(x, y, size, size * 0.22)) continue;
          // 采样点坐标换算到 1024 画布
          const ux = (x / size) * SIZE;
          const uy = (y / size) * SIZE;
          const t = uy / SIZE;
          const note = insideNote(ux, uy);
          if (note) {
            r += 255; g += 255; b += 255;
          } else {
            r += TOP[0] + (BOTTOM[0] - TOP[0]) * t;
            g += TOP[1] + (BOTTOM[1] - TOP[1]) * t;
            b += TOP[2] + (BOTTOM[2] - TOP[2]) * t;
          }
          a += 255;
        }
      }
      const k = (j * size + i) * 4;
      const d = SS * SS;
      px[k] = Math.round(r / d);
      px[k + 1] = Math.round(g / d);
      px[k + 2] = Math.round(b / d);
      px[k + 3] = Math.round(a / d);
    }
  }
  return px;
}

// 区域均值缩放 (src 为 1024 渲染结果)
function resize(src, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    const y0 = (j * SIZE) / h, y1 = ((j + 1) * SIZE) / h;
    for (let i = 0; i < w; i++) {
      const x0 = (i * SIZE) / w, x1 = ((i + 1) * SIZE) / w;
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const fy = Math.min(y1, y + 1) - Math.max(y0, y);
        if (fy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const fx = Math.min(x1, x + 1) - Math.max(x0, x);
          if (fx <= 0) continue;
          const k = (y * SIZE + x) * 4;
          const wgt = fx * fy;
          r += src[k] * wgt; g += src[k + 1] * wgt;
          b += src[k + 2] * wgt; a += src[k + 3] * wgt;
          cnt += wgt;
        }
      }
      const o = (j * w + i) * 4;
      out[o] = Math.round(r / cnt);
      out[o + 1] = Math.round(g / cnt);
      out[o + 2] = Math.round(b / cnt);
      out[o + 3] = Math.round(a / cnt);
    }
  }
  return out;
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO 组装 (每个尺寸内嵌 PNG, Vista+) ----------
function buildICO(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + sizes.length * 16;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s % 256;         // 宽 (256 记为 0)
    e[1] = s % 256;         // 高
    e[2] = 0; e[3] = 0;     // 调色板/保留
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

// ---------- 主流程 ----------
const master = render(SIZE);
const pngs = ICO_SIZES.map((s) => encodePNG(resize(master, s, s), s, s));
const outPath = path.join(__dirname, '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buildICO(pngs, ICO_SIZES));
fs.writeFileSync(path.join(path.dirname(outPath), 'icon.png'), encodePNG(resize(master, 256, 256), 256, 256));
console.log('已生成', outPath, `(${ICO_SIZES.join('/')} px)`);
