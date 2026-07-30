// =========== 酷狗音乐登录态刷新与设备注册 ===========
// kugouRefreshLogin: 1 小时缓存, 用 login_token 刷新 cookies
// kugouRegisterDev: 注册设备获取 dfid, 歌曲链接需要 dfid
const kugoumusicapi = require('kugoumusicapi');
const kugoumusicapi_util = require('kugoumusicapi/util');
const { dbgErr, dbgLog } = require('../core/logger');
const {
  readKugouConfig, writeKugouConfig,
  getCurrentKugouAccount,
} = require('./config');

// 1 小时内不重复刷新登录态
let kugouLastRefresh = 0;
// register_dev 缓存: 1 小时内不重复调用 (dfid 一次注册即可, 反复调用会触发 WRONG_FINAL_BLOCK_LENGTH)
// 已有 dfid 时直接跳过注册
let kugouLastRegisterDev = 0;
const KUGOU_REGISTER_DEV_TTL = 3600000;  // 1 小时

async function kugouRefreshLogin() {
  const now = Date.now();
  if (now - kugouLastRefresh < 3600000) return;  // 1 小时内不重复
  const config = readKugouConfig();
  const acc = getCurrentKugouAccount(config);
  if (!acc || !acc.cookies || !acc.cookies.token) return;  // 未登录
  kugouLastRefresh = now;
  try {
    const resp = await kugoumusicapi.login_token({ cookie: acc.cookies });
    if (resp.status == 200 && resp.cookie && resp.cookie.length > 0) {
      const newCookies = kugoumusicapi_util.cookieToJson(resp.cookie.join(';'));
      acc.cookies = { ...acc.cookies, ...newCookies };
      writeKugouConfig(config);
    }
  } catch (e) {
    dbgErr('[KUGOU] refreshLogin 失败:', e.message);
  }
}

// 注册设备(获取 dfid), 返回当前账号 cookies
// 缓存策略:
//   1. 已有 dfid → 直接返回, 不调用 register_dev
//   2. 1 小时内已成功注册过 → 直接返回, 不重复调用
//   3. register_dev 失败 (常见: WRONG_FINAL_BLOCK_LENGTH, 服务端返回非加密数据) → 不阻塞, 返回当前 cookies
//      dfid 缺失时 song_url 仍能用 dfid='-' 兜底, 不影响导入功能
async function kugouRegisterDev() {
  const config = readKugouConfig();
  const acc = getCurrentKugouAccount(config);
  if (!acc || !acc.cookies) return {};
  // 已有 dfid, 无需注册
  if (acc.cookies.dfid && acc.cookies.dfid !== '-') {
    return acc.cookies;
  }
  // 1 小时内已尝试过, 不重复调用 (避免反复触发加密错误)
  const now = Date.now();
  if (now - kugouLastRegisterDev < KUGOU_REGISTER_DEV_TTL) {
    return acc.cookies;
  }
  kugouLastRegisterDev = now;
  try {
    const resp = await kugoumusicapi.register_dev({ cookie: acc.cookies });
    if (resp.body && resp.body.status == 1 && resp.body.data && resp.body.data.dfid) {
      acc.cookies.dfid = resp.body.data.dfid;
      writeKugouConfig(config);
      dbgLog('[KUGOU] registerDev 成功, dfid:', resp.body.data.dfid);
    }
    return acc.cookies;
  } catch (e) {
    // register_dev 失败是常见情况 (服务端返回非加密数据, 解密时报 WRONG_FINAL_BLOCK_LENGTH)
    // 不影响 song_url 正常工作 (dfid 缺失时用 '-' 兜底), 仅记录不阻塞
    dbgErr('[KUGOU] registerDev 失败 (不影响导入, dfid 将用 "-" 兜底):', e.message);
    return acc.cookies;
  }
}

// 重置刷新缓存(切换账号 / 登出 / 删除账号时调用)
function resetKugouRefresh() {
  kugouLastRefresh = 0;
  kugouLastRegisterDev = 0;
}

module.exports = {
  kugouRefreshLogin, kugouRegisterDev, resetKugouRefresh,
};
