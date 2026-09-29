// =========== 网易云音乐配置与账号管理 ===========
// 多账号配置结构: { accounts: [{userid, nickname, pic, vipType, cookies}], currentUserId }
// cookies 是 cookie 字符串(网易云 weapi 需要原始字符串, 非对象)
const path = require('path');
const fs = require('fs');
const { configDir, ensureConfigDir } = require('../core/storage');

const neteaseConfigFile = path.join(configDir, 'netease_config.json');

function readNeteaseConfig() {
  ensureConfigDir();
  let raw = null;
  try {
    if (fs.existsSync(neteaseConfigFile)) raw = JSON.parse(fs.readFileSync(neteaseConfigFile, 'utf-8'));
  } catch (e) {}
  if (!raw || !Array.isArray(raw.accounts)) return { accounts: [], currentUserId: null };
  if (raw.currentUserId === undefined) raw.currentUserId = null;
  return raw;
}
function writeNeteaseConfig(config) {
  ensureConfigDir();
  try {
    fs.writeFileSync(neteaseConfigFile, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {}
}

// 获取当前账号, 未登录返回 null
function getCurrentNeteaseAccount(config) {
  if (!config || !config.accounts || !config.currentUserId) return null;
  return config.accounts.find(a => String(a.userid) === String(config.currentUserId)) || null;
}
// 获取当前账号的 cookie 字符串, 未登录返回 ''
function getCurrentNeteaseCookie(config) {
  const acc = getCurrentNeteaseAccount(config);
  return (acc && acc.cookies) || '';
}
// 保存/更新一个账号(用 userid 作为唯一标识), 设为当前账号
// info 可选: { nickname, pic, vipType }
// cookieStr: 网易云 cookie 字符串(可含 MUSIC_U, __csrf, NMTID 等)
function saveNeteaseAccount(cookieStr, info) {
  if (!cookieStr) return null;
  // 从 cookie 字符串中提取 userId (优先 nuid / MUSIC_U 内嵌的 userId; 兜底用 info.userId)
  // 网易云 cookie 里没有直接的 userId, 需要外部传入 info.userId
  const userId = info && info.userId ? String(info.userId) : '';
  if (!userId) return null;
  const config = readNeteaseConfig();
  if (!Array.isArray(config.accounts)) config.accounts = [];
  let acc = config.accounts.find(a => String(a.userid) === String(userId));
  if (!acc) {
    acc = { userid: userId, nickname: '', pic: '', vipType: 0, cookies: '' };
    config.accounts.push(acc);
  }
  acc.cookies = cookieStr;
  if (info) {
    if (info.nickname) acc.nickname = info.nickname;
    if (info.pic) acc.pic = info.pic;
    if (info.vipType !== undefined) acc.vipType = info.vipType;
  }
  config.currentUserId = acc.userid;
  writeNeteaseConfig(config);
  return acc;
}

module.exports = {
  neteaseConfigFile, readNeteaseConfig, writeNeteaseConfig,
  getCurrentNeteaseAccount, getCurrentNeteaseCookie, saveNeteaseAccount,
};
