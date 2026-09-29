// =========== 酷狗音乐配置与账号管理 ===========
// 多账号配置结构: { accounts: [{userid, nickname, pic, vip_type, cookies}], currentUserId }
// 兼容旧版 { cookies: {} } 结构: 读取时自动迁移
const path = require('path');
const fs = require('fs');
const { configDir, ensureConfigDir } = require('../core/storage');

const kugouConfigFile = path.join(configDir, 'kugou_config.json');

function readKugouConfig() {
  ensureConfigDir();
  let raw = null;
  try {
    if (fs.existsSync(kugouConfigFile)) raw = JSON.parse(fs.readFileSync(kugouConfigFile, 'utf-8'));
  } catch (e) {}
  if (!raw) return { accounts: [], currentUserId: null };
  // 新版结构
  if (raw.accounts) {
    if (!Array.isArray(raw.accounts)) raw.accounts = [];
    if (raw.currentUserId === undefined) raw.currentUserId = null;
    return raw;
  }
  // 旧版迁移: cookies -> accounts
  const oldCookies = raw.cookies || {};
  if (oldCookies.userid && oldCookies.token) {
    return {
      accounts: [{
        userid: oldCookies.userid,
        nickname: oldCookies.nickname || '',
        pic: oldCookies.pic || '',
        vip_type: oldCookies.vip_type || 0,
        cookies: oldCookies,
      }],
      currentUserId: oldCookies.userid,
    };
  }
  return { accounts: [], currentUserId: null };
}
function writeKugouConfig(config) {
  ensureConfigDir();
  try {
    fs.writeFileSync(kugouConfigFile, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {}
}

// 获取当前账号, 未登录返回 null
function getCurrentKugouAccount(config) {
  if (!config || !config.accounts || !config.currentUserId) return null;
  return config.accounts.find(a => String(a.userid) === String(config.currentUserId)) || null;
}
// 获取当前账号的 cookies, 未登录返回 {}
function getCurrentKugouCookies(config) {
  const acc = getCurrentKugouAccount(config);
  return (acc && acc.cookies) || {};
}
// 保存/更新一个账号(用 cookies.userid 作为唯一标识), 设为当前账号
// info 可选: { nickname, pic, vip_type }
function saveKugouAccount(cookies, info) {
  if (!cookies || !cookies.userid) return null;
  const config = readKugouConfig();
  if (!Array.isArray(config.accounts)) config.accounts = [];
  let acc = config.accounts.find(a => String(a.userid) === String(cookies.userid));
  if (!acc) {
    acc = { userid: cookies.userid, nickname: '', pic: '', vip_type: 0, cookies: {} };
    config.accounts.push(acc);
  }
  acc.cookies = { ...acc.cookies, ...cookies };
  if (info) {
    if (info.nickname) acc.nickname = info.nickname;
    if (info.pic) acc.pic = info.pic;
    if (info.vip_type !== undefined) acc.vip_type = info.vip_type;
  }
  config.currentUserId = acc.userid;
  writeKugouConfig(config);
  return acc;
}

module.exports = {
  kugouConfigFile, readKugouConfig, writeKugouConfig,
  getCurrentKugouAccount, getCurrentKugouCookies, saveKugouAccount,
};
