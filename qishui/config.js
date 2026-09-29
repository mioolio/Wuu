// =========== 汽水音乐多账号配置持久化 ===========
// 结构对齐 netease/config.js, 配置文件: config/qishui_config.json
// 账号以 userid 为唯一标识, 支持 自动登录 / 多账号切换 / 删除账号

const path = require('path');
const fs = require('fs');
const { configDir } = require('../core/storage');

const qishuiConfigFile = path.join(configDir, 'qishui_config.json');

// 读取配置, 自动修复缺字段
function readQishuiConfig() {
  try {
    if (!fs.existsSync(qishuiConfigFile)) return { accounts: [], currentUserId: null };
    const raw = fs.readFileSync(qishuiConfigFile, 'utf8');
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
    if (cfg.currentUserId === undefined) cfg.currentUserId = null;
    return cfg;
  } catch (e) {
    return { accounts: [], currentUserId: null };
  }
}

// 同步写盘
function writeQishuiConfig(config) {
  try {
    fs.writeFileSync(qishuiConfigFile, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('[QISHUI] writeQishuiConfig 失败:', e.message);
  }
}

// 获取当前账号
function getCurrentQishuiAccount(config) {
  if (!config || !config.currentUserId) return null;
  return (config.accounts || []).find(a => String(a.userid) === String(config.currentUserId)) || null;
}

// 获取当前账号的完整 cookie (用于自动登录恢复会话)
function getCurrentQishuiCookie(config) {
  const acc = getCurrentQishuiAccount(config);
  return acc ? acc.cookies : '';
}

// 保存或更新账号 (以 userid 为唯一标识), 自动设为当前账号
// info: { userId, nickname, pic, vipType, aid, sessionid, cookies }
function saveQishuiAccount(cookieStr, info) {
  const userId = info && info.userId ? String(info.userId) : '';
  if (!userId) return null;
  const config = readQishuiConfig();
  let acc = config.accounts.find(a => String(a.userid) === String(userId));
  if (!acc) {
    acc = {
      userid: userId,
      nickname: '',
      pic: '',
      vipType: 0,
      aid: '',
      sessionid: '',
      cookies: '',
    };
    config.accounts.push(acc);
  }
  acc.cookies = cookieStr || '';
  if (info) {
    if (info.nickname) acc.nickname = info.nickname;
    if (info.pic) acc.pic = info.pic;
    if (info.vipType !== undefined) acc.vipType = info.vipType;
    if (info.aid) acc.aid = info.aid;
    if (info.sessionid) acc.sessionid = info.sessionid;
  }
  config.currentUserId = acc.userid;
  writeQishuiConfig(config);
  return acc;
}

// 列出所有账号 + 当前账号 ID
function listQishuiAccounts() {
  const config = readQishuiConfig();
  return { accounts: config.accounts, currentUserId: config.currentUserId };
}

// 切换当前账号
function switchQishuiAccount(userid) {
  const config = readQishuiConfig();
  const acc = config.accounts.find(a => String(a.userid) === String(userid));
  if (!acc) return null;
  config.currentUserId = acc.userid;
  writeQishuiConfig(config);
  return acc;
}

// 删除指定账号 (若删除的是当前账号则 currentUserId 置空)
function removeQishuiAccount(userid) {
  const config = readQishuiConfig();
  const before = config.accounts.length;
  config.accounts = config.accounts.filter(a => String(a.userid) !== String(userid));
  if (config.accounts.length === before) return false;
  if (String(config.currentUserId) === String(userid)) {
    config.currentUserId = config.accounts.length > 0 ? config.accounts[0].userid : null;
  }
  writeQishuiConfig(config);
  return true;
}

// 清除当前登录 (退出登录, 保留账号)
function clearQishuiCurrentUser() {
  const config = readQishuiConfig();
  config.currentUserId = null;
  writeQishuiConfig(config);
}

module.exports = {
  readQishuiConfig,
  writeQishuiConfig,
  getCurrentQishuiAccount,
  getCurrentQishuiCookie,
  saveQishuiAccount,
  listQishuiAccounts,
  switchQishuiAccount,
  removeQishuiAccount,
  clearQishuiCurrentUser,
};
