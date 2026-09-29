// =========== 歌单分享与导入 (wuu:// 协议) ===========
// Wuu 协议 v1 格式:
// wuu://<base64url(JSON{v, f, b, j, jc, r, dt, d, p})>
// 字段说明:
//   v:  协议版本 (1)
//   f:  分支型号 (F + produce/exploitation/test)
//   b:  版本数据 (B + x.x.x)
//   j:  兼容性类型 (J + All_compatible/Range_compatibility/Completely_incompatible)
//   jc: 兼容版本列表 (逗号分隔, 如 "1.0.0,1.1.0")
//   r:  保留数据 (定制数据 或 "0x00" 表示完全不兼容)
//   dt: 地址类型 (dIP 或 ddomain)
//   d:  加密地址数据 (AES-256-GCM + XOR偏移, base64url 编码的 JSON{iv,ct,tag})
//   p:  加密端口 (格式头+字母混淆, 无数字)
//
// 密钥: 单独生成, 用户复制后与链接分开发送给接收方
// 路由端: 歌单数据明文存储, 但需随机 accessKey 访问 (?k=<accessKey>)
// 远程拉取时: http://<host>:<port>/playlist/<id>?k=<accessKey>

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sharedDir, ensureSharedDir, getPort } = require('../server');
const { configDir } = require('../core/storage');
const { sanitizeFileName } = require('../core/network');
const { fetchWithTimeout } = require('../core/network');
const { dbgLog, dbgErr } = require('../core/logger');

// ===== 协议常量 =====
const PROTO_PREFIX = 'wuu://';
const PROTO_VERSION = 1;
const APP_VERSION = require('../package.json').version || '1.0.0';
const APP_BRANCH = 'test'; // produce / exploitation / test

// ===== IP/端口加密 (格式头欺骗 + 16进制映射字母, 加密后无数字) =====
// 固定格式头列表 (欺骗性, 随机选择, 让加密结果看起来像各种协议头)
const FORMAT_HEADERS = ['0X', 'RC', 'WC', 'MT', 'GZ', 'EDS', 'TLS'];
// 16进制数字 → 字母映射 (0→A, 1→B, ..., 15→P), 确保加密后不含数字
const HEX_TO_LETTER = 'ABCDEFGHIJKLMNOP';

function randomHeader() {
  return FORMAT_HEADERS[Math.floor(Math.random() * FORMAT_HEADERS.length)];
}

// 单字节加密: 0-255 → 格式头 + 2字母 (如 8 → "0XBI", 153 → "RCJJ")
function encryptByte(num) {
  const hex = num.toString(16).toUpperCase().padStart(2, '0');
  const letters = hex.split('').map(h => HEX_TO_LETTER[parseInt(h, 16)]).join('');
  return randomHeader() + letters;
}

// 单字节解密: 格式头 + 2字母 → 0-255
function decryptByte(str) {
  let header = '';
  for (const h of FORMAT_HEADERS) {
    if (str.startsWith(h) && str.length === h.length + 2) { header = h; break; }
  }
  if (!header) return -1;
  const letters = str.slice(header.length);
  if (letters.length !== 2) return -1;
  const hex = letters.split('').map(l => {
    const idx = HEX_TO_LETTER.indexOf(l);
    return idx >= 0 ? idx.toString(16) : '';
  }).join('');
  if (hex.length !== 2) return -1;
  return parseInt(hex, 16);
}

// IP 加密: 8.153.37.78 → 0XBI.RCJJ.WCCF.MTEN (无数字, 点分隔)
function encryptIP(ip) {
  return ip.split('.').map(part => encryptByte(parseInt(part, 10))).join('.');
}

// IP 解密: 0XBI.RCJJ.WCCF.MTEN → 8.153.37.78
function decryptIP(encrypted) {
  return encrypted.split('.').map(part => decryptByte(part)).filter(n => n >= 0).join('.');
}

// 端口加密: 30967 → 0XHIGP (4位16进制 → 4字母, 0-65535)
function encryptPort(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const letters = hex.split('').map(h => HEX_TO_LETTER[parseInt(h, 16)]).join('');
  return randomHeader() + letters;
}

// 端口解密: 0XHIGP → 30967
function decryptPort(encrypted) {
  let header = '';
  for (const h of FORMAT_HEADERS) {
    if (encrypted.startsWith(h) && encrypted.length === h.length + 4) { header = h; break; }
  }
  if (!header) return -1;
  const letters = encrypted.slice(header.length);
  if (letters.length !== 4) return -1;
  const hex = letters.split('').map(l => {
    const idx = HEX_TO_LETTER.indexOf(l);
    return idx >= 0 ? idx.toString(16) : '';
  }).join('');
  if (hex.length !== 4) return -1;
  return parseInt(hex, 16);
}

// ===== 密钥生成 =====
// 生成 32~64 字符的可读随机密钥 (字母+数字), 用户可复制
function generateWuuKey() {
  const len = 32 + Math.floor(Math.random() * 33); // 32~64 字符
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let key = '';
  for (let i = 0; i < len; i++) key += chars[bytes[i] % chars.length];
  return key;
}

// 生成路由端访问密钥 (随机 token, 用于 ?k= 参数校验)
function generateAccessKey() {
  return crypto.randomBytes(16).toString('hex'); // 32 字符 hex
}

// ===== AES-256-GCM 加密 + XOR 偏移 =====
// 密钥派生: SHA-256(用户密钥) → 32字节 AES 密钥
function deriveAesKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf-8').digest();
}

// AES-256-GCM 加密 + XOR 偏移混淆
// 返回 { iv, ct, tag } (均为 base64url)
function aesEncrypt(obj, key) {
  const aesKey = deriveAesKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf-8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  // XOR 偏移: 用 iv 作为偏移量对密文做额外混淆
  const xored = Buffer.alloc(ct.length);
  for (let i = 0; i < ct.length; i++) xored[i] = ct[i] ^ iv[i % iv.length];
  return {
    iv: iv.toString('base64url'),
    ct: xored.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

// AES-256-GCM 解密 (反向 XOR 偏移 + 解密)
function aesDecrypt(enc, key) {
  const aesKey = deriveAesKey(key);
  const iv = Buffer.from(enc.iv, 'base64url');
  const ct = Buffer.from(enc.ct, 'base64url');
  const tag = Buffer.from(enc.tag, 'base64url');
  // 反向 XOR 偏移
  const unxored = Buffer.alloc(ct.length);
  for (let i = 0; i < ct.length; i++) unxored[i] = ct[i] ^ iv[i % iv.length];
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(unxored), decipher.final()]);
  return JSON.parse(pt.toString('utf-8'));
}

// ===== Wuu 协议编解码 =====
// 编码链接: payload + key + addr → wuu:// 链接 (不含密钥)
// payload: { id, accessKey }
// addr: { type: 'IP'|'domain', host, port }
function encodeWuuLink(payload, key, addr) {
  // host 加密: IP 用格式头+字母混淆; 域名直接放入 AES 加密层
  const encryptedHost = addr.type === 'IP' ? encryptIP(addr.host) : addr.host;
  const addrData = { id: payload.id, k: payload.accessKey, h: encryptedHost };
  const enc = aesEncrypt(addrData, key);
  const link = {
    v: PROTO_VERSION,
    f: 'F' + APP_BRANCH,
    b: 'B' + APP_VERSION,
    j: 'JAll_compatible',
    jc: APP_VERSION,
    r: '0x00',
    dt: 'd' + (addr.type || 'IP'),
    d: JSON.stringify(enc),
    p: encryptPort(addr.port),
  };
  const b64 = Buffer.from(JSON.stringify(link), 'utf-8').toString('base64url');
  return PROTO_PREFIX + b64;
}

// 解码链接: 链接 + key → { id, k, host, port, addrType } (密钥错误返回 null)
function decodeWuuLink(link, key) {
  if (!link || !link.startsWith(PROTO_PREFIX)) return null;
  const b64 = link.slice(PROTO_PREFIX.length).trim().split('?')[0].split('#')[0];
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || parsed.v !== PROTO_VERSION || !parsed.d || !parsed.p) return null;
    if (!key) return null;
    const enc = JSON.parse(parsed.d);
    const addrData = aesDecrypt(enc, key);
    const port = decryptPort(parsed.p);
    const addrType = (parsed.dt || 'dIP').slice(1);
    const host = addrType === 'IP' ? decryptIP(addrData.h) : addrData.h;
    return {
      id: addrData.id,
      k: addrData.k,
      host,
      port,
      addrType,
    };
  } catch (e) {
    return null;
  }
}

// ===== CRT 文件导出 (PEM 文本格式) =====
// 新格式 (v2): 纯文本 PEM, 密钥用 base64 编码
//   -----BEGIN WUU KEY-----
//   Key: <base64(密钥)>
//   Link: <base64(分享链接)>
//   Name: <base64(歌单名)>
//   Exported: <ISO日期>
//   -----END WUU KEY-----
// 优势: 整个文件都是 ASCII, 通过 QQ/微信/网盘等传输不会损坏
// 旧格式 (v1): [4字节magic] + [32字节XOR密钥] + [PEM文本] + [8字节偏移量]
//   二进制部分易被文本化处理而损坏, 仅作为读取兼容保留
const CRT_MAGIC = Buffer.from([0x57, 0x55, 0x55, 0x5F]); // "WUU_" (旧二进制格式 magic)
const CRT_BEGIN_MARKER = '-----BEGIN WUU KEY-----';
const CRT_END_MARKER = '-----END WUU KEY-----';

// 编码 CRT 文件 (纯文本 PEM 格式, 密钥用 base64 编码, 避免二进制传输损坏)
// 旧二进制格式: magic + XOR密钥 + PEM文本 + offset (易被 QQ/微信/网盘文本化处理而损坏)
// 新文本格式: 整个文件都是 ASCII, 任何文本传输工具都不会损坏
function encodeCrtFile(key, shareLink, playlistName) {
  const keyB64 = Buffer.from(key, 'utf-8').toString('base64');
  const linkB64 = Buffer.from(shareLink, 'utf-8').toString('base64');
  const nameB64 = Buffer.from(playlistName || '', 'utf-8').toString('base64');
  const exported = new Date().toISOString();
  // 行格式: Key: <base64>  (base64 不含换行符, 安全)
  // 用 base64 编码 link/name 是为了支持含换行/特殊字符的值
  const pemText =
    CRT_BEGIN_MARKER + '\r\n' +
    'Key: ' + keyB64 + '\r\n' +
    'Link: ' + linkB64 + '\r\n' +
    'Name: ' + nameB64 + '\r\n' +
    'Exported: ' + exported + '\r\n' +
    CRT_END_MARKER + '\r\n';
  return Buffer.from(pemText, 'utf-8');
}

// 解码 CRT 文件 (优先尝试新文本格式, 失败回退到旧二进制格式)
// 返回: { key, link, name } 或 null
function decodeCrtFile(buf) {
  // 先尝试新文本格式
  const textDecoded = decodeCrtFileText(buf);
  if (textDecoded) return textDecoded;
  // 回退到旧二进制格式 (兼容已导出的旧文件)
  return decodeCrtFileBinary(buf);
}

// 新文本格式解码
function decodeCrtFileText(buf) {
  try {
    // 容错: 检测是否包含 PEM 标记 (用前 256 字节做快速检测, 处理大文件)
    const headLen = Math.min(buf.length, 256);
    const headText = buf.slice(0, headLen).toString('utf-8');
    if (headText.indexOf(CRT_BEGIN_MARKER) === -1) return null;
    // 完整解析 PEM 文本
    const fullText = buf.toString('utf-8');
    const beginIdx = fullText.indexOf(CRT_BEGIN_MARKER);
    const endIdx = fullText.indexOf(CRT_END_MARKER);
    if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;
    const pemBody = fullText.substring(beginIdx + CRT_BEGIN_MARKER.length, endIdx);
    // 行解析: 同时兼容 \r\n / \n / \r
    const lines = pemBody.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
    let keyB64 = '', linkB64 = '', nameB64 = '';
    for (const line of lines) {
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (!m) continue;
      const tag = m[1].toLowerCase();
      const val = m[2].trim();
      if (tag === 'key') keyB64 = val;
      else if (tag === 'link') linkB64 = val;
      else if (tag === 'name') nameB64 = val;
    }
    if (!keyB64 || !linkB64) return null;
    const key = Buffer.from(keyB64, 'base64').toString('utf-8');
    const link = Buffer.from(linkB64, 'base64').toString('utf-8');
    const name = nameB64 ? Buffer.from(nameB64, 'base64').toString('utf-8') : '';
    if (!key || !link) return null;
    return { key, link, name };
  } catch (e) {
    dbgLog('[PLAYLIST] CRT 文本格式解析失败: ' + e.message);
    return null;
  }
}

// 旧二进制格式解码 (兼容历史文件)
function decodeCrtFileBinary(buf) {
  try {
    if (buf.length < 4 + 32 + 8) return null;
    const magic = buf.slice(0, 4);
    if (!magic.equals(CRT_MAGIC)) return null;
    const offset = buf.slice(buf.length - 8);
    const encodedKey = buf.slice(4, 4 + 32);
    const keyBuf = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      keyBuf[i] = encodedKey[i] ^ offset[i % offset.length];
    }
    const key = keyBuf.toString('utf-8').replace(/\x00+$/, '');
    const pemText = buf.slice(4 + 32, buf.length - 8).toString('utf-8');
    // 兼容 \r\n 和 \n
    const linkMatch = pemText.match(/Link:\s*([^\r\n]+)/);
    const nameMatch = pemText.match(/Name:\s*([^\r\n]+)/);
    if (!key || !linkMatch) return null;
    return {
      key,
      link: linkMatch[1].trim(),
      name: nameMatch ? nameMatch[1].trim() : '',
    };
  } catch (e) {
    return null;
  }
}

// ===== IPC handlers =====

// IPC: 导出歌单
// 参数: { name, songs, expireAt, maxUses }
//   expireAt: 过期时间戳 (毫秒), 0 表示永不过期
//   maxUses: 最大访问次数 (0 表示不限次)
// songs: [{songName, artist, album, audioPath, coverPath, lrcPath, rawPath, realDuration, lyricist, composer}]
// 返回: { ok, shareLink, key, accessKey, id, host, port, expireAt, maxUses }
ipcMain.handle('playlist-export', async (event, { name, songs: songList, expireAt, maxUses, publicHost, publicPort }) => {
  try {
    ensureSharedDir();
    const id = crypto.randomBytes(6).toString('hex');
    const accessKey = generateAccessKey();
    // 端口: 优先使用用户指定的远程端口 (frp 转发等场景), 否则使用本地服务端口
    const localPort = getPort();
    const port = (typeof publicPort === 'number' && publicPort > 0 && publicPort <= 65535)
      ? publicPort : localPort;
    // 对外地址: 用户在设置中手动指定的 publicHost 优先 (适用公网部署/内网穿透场景)
    // 否则自动获取本机 IP (用于生成分享链接中的 host)
    let host = '';
    let addrType = 'IP';
    if (publicHost && typeof publicHost === 'string') {
      const ph = publicHost.trim();
      if (ph) {
        host = ph;
        // 判断是 IP 还是域名: IPv4/IPv6 视为 IP, 其余视为域名
        const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ph);
        const isIPv6 = /^[0-9a-fA-F:]+$/.test(ph) && ph.indexOf(':') >= 0;
        addrType = (isIPv4 || isIPv6) ? 'IP' : 'domain';
      }
    }
    if (!host) {
      const os = require('os');
      const nets = os.networkInterfaces();
      host = '127.0.0.1';
      for (const netName of Object.keys(nets)) {
        for (const net of nets[netName]) {
          if (net.family === 'IPv4' && !net.internal) {
            host = net.address;
            break;
          }
        }
        if (host !== '127.0.0.1') break;
      }
    }
    // 时间 + 次数双重限制 (用户必填, 0 表示该项不限制)
    const _expireAt = typeof expireAt === 'number' && expireAt > 0 ? expireAt : 0;
    const _maxUses = typeof maxUses === 'number' && maxUses > 0 ? maxUses : 0;
    const playlist = {
      id,
      accessKey,  // 路由端访问校验令牌 (明文存储, 但需 ?k=accessKey 才能访问)
      name: name || '未命名歌单',
      createdAt: Date.now(),
      expireAt: _expireAt,  // 过期时间戳 (0=永不过期)
      maxUses: _maxUses,    // 最大访问次数 (0=不限次)
      usedCount: 0,         // 已访问次数 (每次 /playlist 请求递增)
      songCount: songList.length,
      shareLink: '',        // 生成时存储完整 wuu:// 链接 (便于后续复制)
      key: '',              // 解密密钥 (本机持久化, 便于用户再次复制; JSON 仅本机可访问)
      songs: songList.map(s => ({
        songName: s.songName || '',
        artist: s.artist || '',
        album: s.album || '',
        audioPath: s.audioPath || '',
        coverPath: s.coverPath || '',
        lrcPath: s.lrcPath || '',
        rawPath: s.rawPath || '',
        realDuration: s.realDuration || 0,
        lyricist: s.lyricist || '',
        composer: s.composer || '',
      })),
    };
    const filePath = path.join(sharedDir, `${id}.json`);
    // 生成解密密钥 (单独输出, 不嵌入链接)
    const key = generateWuuKey();
    // 加密载荷 + 地址信息
    const payload = { id, accessKey };
    const addr = { type: addrType, host, port };
    const shareLink = encodeWuuLink(payload, key, addr);
    // 存储 shareLink + key 到 JSON (便于后续在已分享列表中复制链接与密钥)
    playlist.shareLink = shareLink;
    playlist.key = key;
    fs.writeFileSync(filePath, JSON.stringify(playlist, null, 2), 'utf-8');
    dbgLog(`[PLAYLIST] 导出歌单 "${name}" ${songList.length} 首, id=${id}, 过期=${_expireAt || '永久'}, 次数=${_maxUses || '不限'}, link=${shareLink}`);
    return { ok: true, shareLink, key, accessKey, id, host, port, expireAt: _expireAt, maxUses: _maxUses };
  } catch (e) {
    dbgErr('[PLAYLIST] 导出失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 列出所有已分享的歌单 (不含 songs 数据, 仅元信息)
// 返回: { ok, records: [{ id, name, createdAt, expireAt, maxUses, usedCount, songCount, status }] }
//   status: 'active' | 'expired' | 'exhausted' | 'deleted'
ipcMain.handle('playlist-list-shared', async () => {
  try {
    ensureSharedDir();
    const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.json'));
    const records = [];
    const now = Date.now();
    for (const f of files) {
      try {
        const full = path.join(sharedDir, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (!data.id) continue;
        // 计算状态
        let status = 'active';
        if (data.expireAt && data.expireAt > 0 && now > data.expireAt) status = 'expired';
        else if (data.maxUses && data.maxUses > 0 && data.usedCount >= data.maxUses) status = 'exhausted';
        records.push({
          id: data.id,
          name: data.name || '未命名歌单',
          createdAt: data.createdAt || 0,
          expireAt: data.expireAt || 0,
          maxUses: data.maxUses || 0,
          usedCount: data.usedCount || 0,
          songCount: data.songCount || (data.songs ? data.songs.length : 0),
          status,
        });
      } catch (e) {}
    }
    // 按创建时间倒序: 最新在前
    records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { ok: true, records };
  } catch (e) {
    return { ok: false, message: e.message, records: [] };
  }
});

// IPC: 立即销毁一个分享歌单 (删除 JSON 文件)
// 参数: { id }
// 返回: { ok }
ipcMain.handle('playlist-delete-shared', async (event, { id }) => {
  try {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return { ok: false, message: '无效 id' };
    const filePath = path.join(sharedDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      dbgLog(`[PLAYLIST] 已销毁分享歌单 id=${id}`);
    }
    return { ok: true };
  } catch (e) {
    dbgErr('[PLAYLIST] 销毁失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 查询单个分享歌单的详情 (含 accessKey / shareLink / key 用于复制)
// 参数: { id }
// 返回: { ok, record }
//   record.shareLink: 完整 wuu:// 链接 (含加密地址数据)
//   record.key: 解密密钥 (本机持久化, 便于用户再次复制; 旧版分享可能为空)
//   record.accessKey: 路由端访问校验令牌 (兜底使用)
ipcMain.handle('playlist-get-shared', async (event, { id }) => {
  try {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return { ok: false, message: '无效 id' };
    const filePath = path.join(sharedDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return { ok: false, message: '歌单不存在' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      ok: true,
      record: {
        id: data.id,
        name: data.name || '未命名歌单',
        createdAt: data.createdAt || 0,
        expireAt: data.expireAt || 0,
        maxUses: data.maxUses || 0,
        usedCount: data.usedCount || 0,
        songCount: data.songCount || (data.songs ? data.songs.length : 0),
        accessKey: data.accessKey || '',
        shareLink: data.shareLink || '',
        key: data.key || '',
      },
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 导出密钥到本地 .crt 文件 (密钥隐写在文件头/尾)
// 参数: { key, shareLink, playlistName }
ipcMain.handle('playlist-export-crt', async (event, { key, shareLink, playlistName }) => {
  try {
    const { dialog } = require('electron');
    const safeName = (playlistName || 'wuu').replace(/[\\/:*?"<>|]/g, '_');
    const result = await dialog.showSaveDialog({
      title: '导出密钥文件',
      defaultPath: `${safeName}.crt`,
      filters: [{ name: 'Wuu 密钥文件', extensions: ['crt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    // 生成带隐写的 CRT 文件 (密钥在文件头, 偏移量在文件尾)
    const buf = encodeCrtFile(key, shareLink, playlistName);
    fs.writeFileSync(result.filePath, buf);
    dbgLog(`[PLAYLIST] 密钥已导出到 ${result.filePath}`);
    return { ok: true, path: result.filePath };
  } catch (e) {
    dbgErr('[PLAYLIST] 导出 CRT 失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 从本地 .crt 文件导入 (解析出 link + key + name, 自动填充到导入表单)
// 参数: 无 (弹出文件选择对话框)
// 返回: { ok, key, link, name } 或 { ok: false, canceled: true }
ipcMain.handle('playlist-import-crt', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      title: '导入 CRT 密钥文件',
      filters: [{ name: 'Wuu 密钥文件', extensions: ['crt'] }, { name: '所有文件', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const buf = fs.readFileSync(result.filePaths[0]);
    const decoded = decodeCrtFile(buf);
    if (!decoded || !decoded.link || !decoded.key) {
      // 详细诊断: 帮助用户定位问题
      let diag = '';
      if (buf.length < 44) {
        diag = `文件过小 (${buf.length} 字节, 至少需要 44 字节), 可能下载不完整`;
      } else {
        const headText = buf.slice(0, Math.min(buf.length, 64)).toString('utf-8');
        const hasPem = headText.indexOf(CRT_BEGIN_MARKER) !== -1;
        const hasMagic = buf[0] === 0x57 && buf[1] === 0x55 && buf[2] === 0x55 && buf[3] === 0x5F;
        if (!hasPem && !hasMagic) {
          diag = '文件格式不匹配 (既不是新文本格式也不是旧二进制格式), 可能已被传输工具损坏';
        } else if (hasMagic && !hasPem) {
          diag = '检测到旧二进制格式但解析失败, 可能二进制部分已损坏 (建议让对方重新导出)';
        } else {
          diag = 'PEM 文本格式解析失败, 文件可能被截断或损坏';
        }
      }
      dbgErr('[PLAYLIST] CRT 导入失败: ' + diag + ' (文件长度=' + buf.length + ')');
      return { ok: false, message: 'CRT 文件解析失败: ' + diag };
    }
    dbgLog(`[PLAYLIST] 从 CRT 导入: name=${decoded.name}, link=${decoded.link}`);
    return { ok: true, key: decoded.key, link: decoded.link, name: decoded.name };
  } catch (e) {
    dbgErr('[PLAYLIST] 导入 CRT 失败:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 解析 wuu:// 链接 (需密钥, 不下载, 仅返回歌单元数据 + 远程地址)
// 参数: { link, key, remoteHost }
ipcMain.handle('playlist-parse-link', async (event, { link, key, remoteHost }) => {
  try {
    if (!key || !key.trim()) return { ok: false, message: '请输入解密密钥' };
    const info = decodeWuuLink(link, key.trim());
    if (!info) return { ok: false, message: '链接无效或密钥错误' };
    // 远程地址: 优先用用户填入的, 否则用链接中的 host:port
    const host = (remoteHost || '').trim() || `${info.host}:${info.port}`;
    const baseUrl = host.startsWith('http') ? host : `http://${host}`;
    // 诊断日志: 解密出的真实地址 + 最终使用的 baseUrl, 便于排查连接问题
    dbgLog(`[PLAYLIST] 解密成功: id=${info.id} 链接内嵌地址=${info.host}:${info.port} addrType=${info.addrType} → baseUrl=${baseUrl}`);
    // 拉取歌单 JSON (带 accessKey 访问令牌)
    const accessKey = info.k || '';
    const playlistUrl = `${baseUrl}/playlist/${info.id}?k=${encodeURIComponent(accessKey)}`;
    const resp = await fetchWithTimeout(playlistUrl, {}, 5000);
    if (!resp.ok) return { ok: false, message: `远程服务器返回 ${resp.status}` };
    const playlist = await resp.json();
    if (!playlist || !playlist.songs) return { ok: false, message: '歌单数据格式错误' };
    // 为每首歌构建远程 URL (音频/封面/歌词, 均携带 accessKey)
    const songs = playlist.songs.map((s, i) => ({
      songName: s.songName,
      artist: s.artist,
      album: s.album,
      realDuration: s.realDuration,
      lyricist: s.lyricist,
      composer: s.composer,
      remoteIndex: i,
      audioUrl: `${baseUrl}/stream/${info.id}/${i}?k=${encodeURIComponent(accessKey)}`,
      coverUrl: s.coverPath ? `${baseUrl}/cover/${info.id}/${i}?k=${encodeURIComponent(accessKey)}` : '',
      lyricUrl: `${baseUrl}/lyric/${info.id}/${i}?k=${encodeURIComponent(accessKey)}`,
    }));
    dbgLog(`[PLAYLIST] 解析远程歌单 "${playlist.name}" ${songs.length} 首, 来源 ${baseUrl}`);
    return {
      ok: true,
      playlistName: playlist.name,
      songs,
      baseUrl,
      playlistId: info.id,
    };
  } catch (e) {
    // 友好化常见错误: 超时/网络不可达/连接拒绝
    let msg = e.message || '未知错误';
    const name = e.name || '';
    if (name === 'AbortError' || /aborted/i.test(msg)) {
      msg = '连接远程服务器超时 (5 秒), 请检查: 1) 对方是否已开启歌单分享服务 2) 远程地址/端口是否正确 3) frp 内网穿透节点是否正常';
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      msg = '无法解析远程地址, 请检查域名/IP 是否正确';
    } else if (/ECONNREFUSED/i.test(msg)) {
      msg = '远程服务器拒绝连接, 请检查对方服务是否已开启及端口是否正确';
    } else if (/ECONNRESET|ETIMEDOUT/i.test(msg)) {
      msg = '网络连接中断或超时, 请稍后重试';
    } else if (/fetch failed/i.test(msg)) {
      msg = '无法连接远程服务器, 请检查网络或远程地址是否可达';
    }
    dbgErr('[PLAYLIST] 解析链接失败:', e.message, '→', msg);
    return { ok: false, message: msg };
  }
});

// IPC: 下载远程歌单中的指定歌曲(支持任意数量)
// 参数: { song, overwrite }  song 含 audioUrl/coverUrl/lyricUrl + 元数据
// 流式推送下载进度
ipcMain.handle('playlist-download-song', async (event, { song, overwrite }) => {
  try {
    const songName = sanitizeFileName(song.songName || '未知歌曲');
    const artistName = sanitizeFileName(song.artist || '未知艺人');
    const folderName = `${songName} - ${artistName}`;
    const outputDir = path.join(__dirname, '..', 'output', folderName);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const { sendToMain } = require('../core/state');

    // 1. 下载音频
    event.sender.send('parse-download-progress', { stage: 'audio', pct: 0 });
    const audioResp = await fetchWithTimeout(song.audioUrl, {}, 60000);
    if (!audioResp.ok) throw new Error(`音频下载失败: ${audioResp.status}`);
    const audioBuf = Buffer.from(await audioResp.arrayBuffer());
    // 从 Content-Type 或 URL 推断扩展名
    const ct = audioResp.headers.get('content-type') || '';
    let ext = 'm4a';
    if (ct.includes('flac')) ext = 'flac';
    else if (ct.includes('mpeg')) ext = 'mp3';
    else if (ct.includes('aac')) ext = 'aac';
    else if (ct.includes('wav')) ext = 'wav';
    else if (ct.includes('ogg')) ext = 'ogg';
    // 清理旧音频文件
    try {
      for (const f of fs.readdirSync(outputDir)) {
        if (/\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f)) {
          fs.unlinkSync(path.join(outputDir, f));
        }
      }
    } catch (e) {}
    const audioPath = path.join(outputDir, `${songName} - ${artistName}.${ext}`);
    fs.writeFileSync(audioPath, audioBuf);
    event.sender.send('parse-download-progress', { stage: 'audio', pct: 100 });

    // 2. 下载封面
    let coverPath = null;
    if (song.coverUrl) {
      event.sender.send('parse-download-progress', { stage: 'cover', pct: 0 });
      try {
        const coverResp = await fetchWithTimeout(song.coverUrl, {}, 30000);
        if (coverResp.ok) {
          const coverBuf = Buffer.from(await coverResp.arrayBuffer());
          const coverCt = coverResp.headers.get('content-type') || '';
          let cExt = 'jpg';
          if (coverCt.includes('png')) cExt = 'png';
          else if (coverCt.includes('webp')) cExt = 'webp';
          coverPath = path.join(outputDir, `cover.${cExt}`);
          fs.writeFileSync(coverPath, coverBuf);
        }
      } catch (e) { dbgLog('[PLAYLIST] 封面下载跳过:', e.message); }
      event.sender.send('parse-download-progress', { stage: 'cover', pct: 100 });
    }

    // 3. 下载歌词
    let lrcPath = null;
    let rawPath = null;
    if (song.lyricUrl) {
      event.sender.send('parse-download-progress', { stage: 'lrc', pct: 0 });
      try {
        const lrcResp = await fetchWithTimeout(song.lyricUrl, {}, 15000);
        if (lrcResp.ok) {
          const lrcText = await lrcResp.text();
          if (lrcText && lrcText.trim()) {
            // 判断是 raw 格式还是 lrc 格式
            if (lrcText.includes('<') && lrcText.match(/<\d+,\d+,\d+>/)) {
              rawPath = path.join(outputDir, 'lyrics_raw.txt');
              fs.writeFileSync(rawPath, lrcText, 'utf-8');
            } else {
              lrcPath = path.join(outputDir, `${songName} - ${artistName}.lrc`);
              const lrcHeader = `[ti:${song.songName}]\n[ar:${song.artist}]\n[al:${song.album}]\n`;
              fs.writeFileSync(lrcPath, lrcHeader + lrcText, 'utf-8');
            }
          }
        }
      } catch (e) { dbgLog('[PLAYLIST] 歌词下载跳过:', e.message); }
      event.sender.send('parse-download-progress', { stage: 'lrc', pct: 100 });
    }

    // 4. 写 info.json
    event.sender.send('parse-download-progress', { stage: 'info', pct: 0 });
    fs.writeFileSync(path.join(outputDir, 'info.json'), JSON.stringify({
      title: song.songName,
      artist: song.artist,
      album: song.album,
      duration: (song.realDuration || 0) * 1000,
      lyricist: song.lyricist || '',
      composer: song.composer || '',
      source: 'wuu-share',
    }, null, 2), 'utf-8');
    event.sender.send('parse-download-progress', { stage: 'info', pct: 100 });

    return { ok: true, data: { audioPath, coverPath, lrcPath, rawPath, folder: folderName } };
  } catch (e) {
    dbgErr('[PLAYLIST] 下载失败:', e.message);
    event.sender.send('parse-download-progress', { stage: 'error', message: e.message });
    return { ok: false, message: e.message };
  }
});

// IPC: 获取本机服务器状态
ipcMain.handle('playlist-server-status', async () => {
  return { ok: true, running: require('../server').isRunning(), port: getPort() };
});

module.exports = {
  encodeWuuLink,
  decodeWuuLink,
  generateWuuKey,
  generateAccessKey,
  aesEncrypt,
  aesDecrypt,
  encryptIP,
  decryptIP,
  encryptPort,
  decryptPort,
  encodeCrtFile,
  decodeCrtFile,
};
