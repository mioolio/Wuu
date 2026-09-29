// =========== 汽水音乐 track_v2 签名模块 (逆向自官方客户端 bdms.node) ===========
// 背景: 2026-08 起 track_v2 接口对非客户端请求返回 HTTP 200 空 body (风控静默拦截),
// 携带完整 cookie + CSRF 也无效。官方客户端通过 bdms.node 生成 X-Helios / X-Medusa
// 等签名头标识"真实客户端"。本模块加载同款 bdms.node 生成签名, 使请求获得完整响应
// (会员账号可拿到无损/Hi-Res/全景声等 VIP 音质直链)。
// 已验证: 签名不绑定原客户端 device_id, 随机生成的稳定 device_id 同样有效。

const path = require('path');
const fs = require('fs');

function dbgLog(...args) { console.log('[QISHUI]', '[bdms-signer]', ...args); }

const NATIVE_PATH = path.join(__dirname, 'native', 'bdms.node');
const DEVICE_FILE = path.join(__dirname, '..', '..', 'config', 'qishui_device.json');

// 客户端同款固定参数 (来自 3.7.0 客户端抓包, 与签名配套)
const CLIENT_PARAMS = {
  aid: '386088',
  app_name: 'luna_pc',
  version_name: '3.7.0',
  version_code: '30070000',
  channel: 'official',
  user_agent: 'LunaPC/3.7.0(452316191)',
};

let bdms = null;
let loadTried = false;
let inited = false;
let deviceInfo = null;

// 惰性加载 bdms.node (失败不抛异常, 调用方回退普通请求链)
// 打包环境: asarUnpack 配置使 native/ 解包到 app.asar.unpacked, Electron 自动重定向;
// 此处再做显式路径回退, 双保险 (DLL 依赖 metasecml.dll 也随目录解包)
function loadBdms() {
  if (loadTried) return bdms;
  loadTried = true;
  const candidates = [
    NATIVE_PATH,
    NATIVE_PATH.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep),
    NATIVE_PATH.replace('app.asar\\', 'app.asar.unpacked\\'),
  ];
  for (const p of [...new Set(candidates)]) {
    try {
      bdms = require(p);
      dbgLog('bdms.node 加载成功: ' + p);
      break;
    } catch (e) {
      dbgLog('bdms.node 加载失败(' + p + '): ' + e.message);
      bdms = null;
    }
  }
  return bdms;
}

// 获取或生成稳定的 device_id / iid (持久化到 config/qishui_device.json, 避免每次变化触发风控)
function getDeviceInfo() {
  if (deviceInfo) return deviceInfo;
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      if (saved.device_id && saved.iid) {
        deviceInfo = saved;
        return deviceInfo;
      }
    }
  } catch (e) {}
  deviceInfo = {
    device_id: String(Math.floor(1000000000000000 + Math.random() * 8999999999999999)),
    iid: String(Math.floor(100000000000000 + Math.random() * 899999999999999)),
  };
  try {
    const dir = path.dirname(DEVICE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEVICE_FILE, JSON.stringify(deviceInfo, null, 2), 'utf8');
  } catch (e) {
    dbgLog('设备标识持久化失败(不影响本次请求): ' + e.message);
  }
  return deviceInfo;
}

// bdms.node 是否可用
function available() { return !!loadBdms(); }

// 幂等初始化 bdms (device_id 必须与 query 中的一致)
function ensureInit() {
  const m = loadBdms();
  if (!m) return false;
  if (!inited) {
    m.init({ deviceId: getDeviceInfo().device_id });
    inited = true;
  }
  return true;
}

// 构建 track_v2 完整 query URL (客户端同款参数, 签名与 query 绑定)
function buildTrackV2Url(baseUrl) {
  const { device_id, iid } = getDeviceInfo();
  const q = 'aid=' + CLIENT_PARAMS.aid +
    '&app_name=' + CLIENT_PARAMS.app_name +
    '&region=cn&geo_region=cn&os_region=cn&sim_region=' +
    '&device_id=' + device_id +
    '&cdid=&iid=' + iid +
    '&version_name=' + CLIENT_PARAMS.version_name +
    '&version_code=' + CLIENT_PARAMS.version_code +
    '&channel=' + CLIENT_PARAMS.channel +
    '&build_mode=master&network_carrier=&ac=wifi&tz_name=Asia%2FShanghai' +
    '&resolution=&device_platform=windows&device_type=Windows' +
    '&os_version=Windows+11+Pro+for+Workstations&fp=' + device_id;
  return (baseUrl || 'https://api.qishui.com/luna/pc/track_v2') + '?' + q;
}

// 为请求头生成签名 (返回带 X-Helios / X-Medusa 等签名头的新对象, 失败返回 null)
// headers: { key: value } (键小写)
function sign(url, headers) {
  if (!ensureInit()) return null;
  try {
    // 客户端 interceptBeforeSendHeaders 同款格式: 多行 "key\r\nvalue" 拼接
    const headerLines = [];
    for (const [key, value] of Object.entries(headers)) {
      headerLines.push(key + '\r\n' + value);
    }
    const sigRaw = bdms.generateHttpSignatureHeaders(url, headerLines.join('\r\n'));
    const parts = sigRaw.split('\r\n').filter(t => t.trim());
    const signed = { ...headers };
    for (let i = 0; i < parts.length / 2; i++) {
      signed[parts[i * 2].toLowerCase()] = parts[i * 2 + 1];
    }
    return signed;
  } catch (e) {
    dbgLog('签名生成失败: ' + e.message);
    return null;
  }
}

module.exports = {
  available,
  sign,
  buildTrackV2Url,
  getDeviceInfo,
  CLIENT_PARAMS,
};
