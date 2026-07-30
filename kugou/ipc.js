// =========== 酷狗音乐 IPC 处理器 ===========
// 14 个 kugou-* IPC handlers: 登录态/二维码/验证码/手机号登录/登出/多账号/歌单/曲目/导入/试听
// require 本模块即自动注册所有 IPC handlers
const { ipcMain } = require('electron');
const kugoumusicapi = require('kugoumusicapi');
const kugoumusicapi_util = require('kugoumusicapi/util');
const { buildInfoFromTexts, parseNameField } = require('../parsers/platforms/kugou-proxy');
const parsers = require('../parsers');
const { krcToRaw } = parsers;
const { downloadParsedSong } = require('../download');
const { sendToMain } = require('../core/state');
const { dbgLog, dbgErr } = require('../core/logger');
const {
  readKugouConfig, writeKugouConfig,
  getCurrentKugouAccount, getCurrentKugouCookies, saveKugouAccount,
} = require('./config');
const { kugouRefreshLogin, kugouRegisterDev, resetKugouRefresh } = require('./auth');

// IPC: 检查登录状态
ipcMain.handle('kugou-login-status', async () => {
  const config = readKugouConfig();
  const acc = getCurrentKugouAccount(config);
  const cookies = acc ? acc.cookies : {};
  dbgLog('[KUGOU] login-status 检查, cookies:', JSON.stringify({
    hasToken: !!cookies.token,
    hasUserid: !!cookies.userid,
    cookieKeys: Object.keys(cookies),
  }));
  if (!cookies.token || !cookies.userid) {
    dbgLog('[KUGOU] login-status: 缺少 token 或 userid, 未登录');
    return { ok: false, loggedIn: false };
  }
  // 获取用户信息
  try {
    const resp = await kugoumusicapi.user_detail({ cookie: cookies });
    dbgLog('[KUGOU] user_detail 响应:', JSON.stringify({
      status: resp.body && resp.body.status,
      hasData: !!(resp.body && resp.body.data),
      nickname: resp.body && resp.body.data && resp.body.data.nickname,
    }));
    if (resp.body && resp.body.status === 1 && resp.body.data) {
      // 更新当前账号信息并持久化
      if (acc) {
        acc.nickname = resp.body.data.nickname || acc.nickname || '';
        acc.pic = resp.body.data.pic || acc.pic || '';
        acc.vip_type = resp.body.data.vip_type || 0;
        writeKugouConfig(config);
      }
      return {
        ok: true,
        loggedIn: true,
        userInfo: {
          userid: cookies.userid,
          nickname: resp.body.data.nickname || '',
          pic: resp.body.data.pic || '',
          vip_type: resp.body.data.vip_type || 0,
        },
      };
    }
  } catch (e) {
    dbgErr('[KUGOU] login-status 获取用户信息失败:', e.message);
  }
  // token 存在但获取用户信息失败, 可能 token 过期
  dbgLog('[KUGOU] login-status: user_detail 失败, 但 token 存在, 返回已登录');
  return { ok: true, loggedIn: true, userInfo: { userid: cookies.userid, nickname: (acc && acc.nickname) || '已登录', pic: (acc && acc.pic) || '', vip_type: (acc && acc.vip_type) || 0 } };
});

// IPC: 获取二维码 key
ipcMain.handle('kugou-qr-key', async () => {
  try {
    const resp = await kugoumusicapi.login_qr_key({ cookie: {} });
    if (resp.body && resp.body.data && resp.body.data.qrcode) {
      return { ok: true, key: resp.body.data.qrcode };
    }
    return { ok: false, message: '获取二维码key失败' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 生成二维码图片(base64)
ipcMain.handle('kugou-qr-create', async (event, key) => {
  try {
    const resp = await kugoumusicapi.login_qr_create({ key, qrimg: true });
    if (resp.body && resp.body.data) {
      return { ok: true, base64: resp.body.data.base64, url: resp.body.data.url };
    }
    return { ok: false, message: '生成二维码失败' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 检查二维码状态
// status: 0=过期, 1=等待扫码, 2=待确认, 4=登录成功
ipcMain.handle('kugou-qr-check', async (event, key) => {
  try {
    const resp = await kugoumusicapi.login_qr_check({ key, cookie: {} });
    dbgLog('[KUGOU] qr-check 响应:', JSON.stringify({
      status: resp.body && resp.body.status,
      dataStatus: resp.body && resp.body.data && resp.body.data.status,
      hasCookie: !!(resp.cookie && resp.cookie.length),
      cookieLen: resp.cookie ? resp.cookie.length : 0,
      bodyKeys: resp.body ? Object.keys(resp.body) : [],
      dataKeys: resp.body && resp.body.data ? Object.keys(resp.body.data) : [],
    }));
    if (resp.body && resp.body.data) {
      const status = resp.body.data.status;
      if (status === 4) {
        // 登录成功, 保存 cookies 到账号列表(用 userid 作为唯一标识, 设为当前账号)
        dbgLog('[KUGOU] 扫码登录成功, 准备保存账号');
        if (resp.cookie && resp.cookie.length > 0) {
          const newCookies = kugoumusicapi_util.cookieToJson(resp.cookie.join(';'));
          dbgLog('[KUGOU] 新 cookies userid:', newCookies.userid);
          saveKugouAccount(newCookies);
        } else {
          dbgLog('[KUGOU] 警告: status=4 但无 cookie 返回!');
        }
      }
      return { ok: true, status, data: resp.body.data };
    }
    dbgLog('[KUGOU] qr-check 无 data 字段, 完整响应:', JSON.stringify(resp.body || {}));
    return { ok: false, message: '检查二维码状态失败' };
  } catch (e) {
    dbgLog('[KUGOU] qr-check 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 发送手机验证码
ipcMain.handle('kugou-captcha-sent', async (event, mobile) => {
  try {
    dbgLog('[KUGOU] captcha-sent 调用, mobile:', mobile);
    const resp = await kugoumusicapi.captcha_sent({ mobile, cookie: {} });
    dbgLog('[KUGOU] captcha-sent 响应:', JSON.stringify({
      httpStatus: resp.status,
      bodyStatus: resp.body && resp.body.status,
      errCode: resp.body && resp.body.err_code,
      errMsg: resp.body && resp.body.err_msg,
      bodyKeys: resp.body ? Object.keys(resp.body) : [],
    }));
    return { ok: true, data: resp.body };
  } catch (e) {
    dbgErr('[KUGOU] captcha-sent 异常:', e.message, '| body:', JSON.stringify(e.body || {}));
    return { ok: false, message: e.message };
  }
});

// IPC: 手机号登录
ipcMain.handle('kugou-login-cellphone', async (event, { mobile, code, userid }) => {
  try {
    dbgLog('[KUGOU] login-cellphone 调用, mobile:', mobile, 'userid:', userid || '(无)');
    const resp = await kugoumusicapi.login_cellphone({ mobile, code, userid, cookie: {} });
    dbgLog('[KUGOU] login-cellphone 响应:', JSON.stringify({
      httpStatus: resp.status,
      bodyStatus: resp.body && resp.body.status,
      errCode: resp.body && resp.body.err_code,
      errMsg: resp.body && resp.body.err_msg,
      bodyKeys: resp.body ? Object.keys(resp.body) : [],
      dataKeys: resp.body && resp.body.data ? Object.keys(resp.body.data) : [],
      hasInfoList: !!(resp.body && resp.body.data && resp.body.data.info_list),
      hasCookie: !!(resp.cookie && resp.cookie.length),
    }));
    if (resp.body && resp.body.status === 1) {
      // 登录成功, 保存 cookies 到账号列表
      if (resp.cookie && resp.cookie.length > 0) {
        const newCookies = kugoumusicapi_util.cookieToJson(resp.cookie.join(';'));
        dbgLog('[KUGOU] login-cellphone 登录成功, userid:', newCookies.userid);
        saveKugouAccount(newCookies);
      } else {
        dbgLog('[KUGOU] 警告: login-cellphone status=1 但无 cookie 返回!');
      }
      return { ok: true, data: resp.body.data };
    }
    // 非状态1可能是多账号选择
    const isMulti = !!(resp.body && resp.body.data && resp.body.data.info_list);
    if (!isMulti) {
      // 提取错误消息 (kugou 常见字段: err_msg / msg / message / status_text)
      const errMsg = (resp.body && (resp.body.err_msg || resp.body.msg || resp.body.message || resp.body.status_text))
        || `登录失败 (status=${resp.body && resp.body.status}, err_code=${resp.body && resp.body.err_code})`;
      dbgErr('[KUGOU] login-cellphone 失败:', errMsg, '| 完整 body:', JSON.stringify(resp.body));
      return { ok: false, message: errMsg, data: resp.body, multiAccount: false };
    }
    return { ok: false, data: resp.body, multiAccount: true };
  } catch (e) {
    // catch 块也可能是多账号选择(状态码非200)
    if (e.body && e.body.data && e.body.data.info_list) {
      dbgLog('[KUGOU] login-cellphone 多账号选择(异常路径)');
      return { ok: false, data: e.body, multiAccount: true };
    }
    dbgErr('[KUGOU] login-cellphone 异常:', e.message, '| body:', JSON.stringify(e.body || {}));
    return { ok: false, message: e.message };
  }
});

// IPC: 退出登录 (保留账号, 下次直接切换登录, 不需要重新扫码)
ipcMain.handle('kugou-logout', async () => {
  const config = readKugouConfig();
  config.currentUserId = null;
  writeKugouConfig(config);
  resetKugouRefresh();
  return { ok: true };
});

// IPC: 列出所有保存的账号(用于多账号切换 UI)
ipcMain.handle('kugou-list-accounts', async () => {
  const config = readKugouConfig();
  const accounts = (config.accounts || []).map(a => ({
    userid: a.userid,
    nickname: a.nickname || '',
    pic: a.pic || '',
    vip_type: a.vip_type || 0,
    current: String(a.userid) === String(config.currentUserId),
  }));
  return { ok: true, accounts, currentUserId: config.currentUserId };
});

// IPC: 切换当前账号
ipcMain.handle('kugou-switch-account', async (event, userid) => {
  if (!userid) return { ok: false, message: '缺少 userid' };
  const config = readKugouConfig();
  const exists = (config.accounts || []).some(a => String(a.userid) === String(userid));
  if (!exists) return { ok: false, message: '账号不存在' };
  config.currentUserId = userid;
  writeKugouConfig(config);
  resetKugouRefresh();
  return { ok: true };
});

// IPC: 删除指定账号
ipcMain.handle('kugou-remove-account', async (event, userid) => {
  if (!userid) return { ok: false, message: '缺少 userid' };
  const config = readKugouConfig();
  if (!Array.isArray(config.accounts)) return { ok: false, message: '无账号' };
  const before = config.accounts.length;
  config.accounts = config.accounts.filter(a => String(a.userid) !== String(userid));
  if (config.accounts.length === before) return { ok: false, message: '账号不存在' };
  // 如果删除的是当前账号, 清空 currentUserId
  if (String(config.currentUserId) === String(userid)) {
    config.currentUserId = null;
    resetKugouRefresh();
  }
  writeKugouConfig(config);
  return { ok: true };
});

// IPC: 获取用户歌单列表
ipcMain.handle('kugou-user-playlists', async (event, { page, pagesize }) => {
  try {
    await kugouRefreshLogin();
    const config = readKugouConfig();
    const cookies = getCurrentKugouCookies(config);
    dbgLog('[KUGOU] user-playlists 调用, cookies:', JSON.stringify({
      hasToken: !!cookies.token,
      hasUserid: !!cookies.userid,
      userid: cookies.userid,
    }));
    const resp = await kugoumusicapi.user_playlist({
      page: page || 1,
      pagesize: pagesize || 30,
      cookie: cookies,
    });
    dbgLog('[KUGOU] user-playlists 响应:', JSON.stringify({
      status: resp.body && resp.body.status,
      error_code: resp.body && resp.body.error_code,
      bodyKeys: resp.body ? Object.keys(resp.body) : [],
      hasInfo: !!(resp.body && resp.body.info),
      infoLen: resp.body && resp.body.info ? resp.body.info.length : 0,
      hasData: !!(resp.body && resp.body.data),
      dataKeys: resp.body && resp.body.data ? Object.keys(resp.body.data) : [],
      dataInfoLen: resp.body && resp.body.data && resp.body.data.info ? resp.body.data.info.length : 0,
    }));
    // 实际歌单在 resp.body.data.info (非 resp.body.info)
    return { ok: true, data: resp.body.data };
  } catch (e) {
    dbgLog('[KUGOU] user-playlists 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 获取歌单内全部歌曲(自动分页)
ipcMain.handle('kugou-playlist-tracks', async (event, { listid }) => {
  try {
    await kugouRefreshLogin();
    const config = readKugouConfig();
    const cookies = getCurrentKugouCookies(config);
    dbgLog('[KUGOU] playlist-tracks 调用, listid:', listid);
    const allSongs = [];
    let currentPage = 1;
    let totalCount = 0;
    do {
      const resp = await kugoumusicapi.playlist_track_all_new({
        listid,
        page: currentPage,
        pagesize: 100,
        cookie: cookies,
      });
      dbgLog('[KUGOU] playlist-tracks 第' + currentPage + '页响应:', JSON.stringify({
        status: resp.body && resp.body.status,
        error_code: resp.body && resp.body.error_code,
        bodyKeys: resp.body ? Object.keys(resp.body) : [],
        hasInfo: !!(resp.body && resp.body.info),
        infoLen: resp.body && resp.body.info ? resp.body.info.length : 0,
        hasData: !!(resp.body && resp.body.data),
        dataKeys: resp.body && resp.body.data ? Object.keys(resp.body.data) : [],
        dataInfoLen: resp.body && resp.body.data && resp.body.data.info ? resp.body.data.info.length : 0,
        count: resp.body && resp.body.count,
        dataCount: resp.body && resp.body.data && resp.body.data.count,
      }));
      // 曲目可能在 resp.body.info 或 resp.body.data.info, 兼容两种结构
      const inner = (resp.body && resp.body.data) || resp.body || {};
      const info = inner.info || [];
      allSongs.push(...info);
      totalCount = inner.count || inner.total || info.length;
      currentPage++;
    } while (allSongs.length < totalCount && currentPage <= 10);
    // 按 fsort 排序
    allSongs.sort((a, b) => (a.fsort || 0) - (b.fsort || 0));
    return { ok: true, data: { songs: allSongs, count: totalCount } };
  } catch (e) {
    dbgLog('[KUGOU] playlist-tracks 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 导入单首歌曲(获取音频直链 + 歌词 + 封面 → 下载到本地)
// 流式推送进度: 与 parse-progress-event 格式一致, UI 可复用
// 音质自动降级: 指定音质拿不到直链(非 VIP / 版权限制)时, 按 high→flac→320→128 顺序降级重试
ipcMain.handle('kugou-import-song', async (event, { song, quality, overwrite }) => {
  try {
    await kugouRefreshLogin();
    const cookie = await kugouRegisterDev();
    const config = readKugouConfig();
    const fullCookie = getCurrentKugouCookies(config);

    // 1. 获取音频直链(自动降级兜底)
    //    降级链: 用户指定音质 → 沿用更高/更低的优先级链, 失败则降级
    //    试听默认 128k 免费可放, 下载默认 FLAC 需 VIP, 非VIP 自动降到 320/128 保证可用
    const hash = song.hash;
    const QUALITY_FALLBACK_CHAIN = ['high', 'flac', '320', '128'];
    const startQ = quality || 'flac';
    const startIdx = Math.max(0, QUALITY_FALLBACK_CHAIN.indexOf(startQ));
    const tryChain = QUALITY_FALLBACK_CHAIN.slice(startIdx);

    let audioUrl = null;
    let usedQuality = null;
    let lastRespInfo = null;
    for (const q of tryChain) {
      const urlRes = await kugoumusicapi.song_url({ hash, quality: q, cookie: fullCookie });
      const urls = (urlRes.body && urlRes.body.url) || [];
      lastRespInfo = {
        quality: q,
        status: urlRes.body && urlRes.body.status,
        err_code: urlRes.body && urlRes.body.err_code,
        err_msg: urlRes.body && (urlRes.body.err_msg || urlRes.body.msg),
        urlCount: urls.length,
      };
      dbgLog('[KUGOU] import song_url 尝试:', JSON.stringify(lastRespInfo));
      if (urls.length > 0) {
        audioUrl = urls[0];
        usedQuality = q;
        break;
      }
    }
    if (!audioUrl) {
      throw new Error(`无可用音频链接(已尝试音质: ${tryChain.join('→')}, 最后响应: status=${lastRespInfo && lastRespInfo.status}, err_code=${lastRespInfo && lastRespInfo.err_code}, err_msg=${lastRespInfo && lastRespInfo.err_msg || '无'})`);
    }
    dbgLog('[KUGOU] import 命中音质:', usedQuality, '(用户请求:', startQ + ')');

    // 2. 获取歌词(高精度 krc + 低精度 lrc)
    // 流程: search_lyric 拿 id+accesskey → lyric 下载 krc/lrc
    let krcText = '';
    let lrcText = '';
    try {
      const lowerHash = String(hash || '').toLowerCase();
      const { title: songTitle, artist: songArtist } = parseNameField(song.name || '');
      const keyword = songTitle + (songArtist ? ' ' + songArtist : '');

      // Step 1: 搜索候选歌词
      const searchResp = await kugoumusicapi.search_lyric({
        hash: lowerHash,
        keywords: keyword,
        cookie: fullCookie,
      });
      const candidates = (searchResp.body && searchResp.body.candidates) || [];
      dbgLog('[KUGOU] import 歌词搜索: hash=' + lowerHash + ' keyword=' + keyword + ' candidates=' + candidates.length);

      if (candidates.length > 0) {
        const lyricId = candidates[0].id;
        const accesskey = candidates[0].accesskey;

        // Step 2a: 高精度逐字 krc
        const krcResp = await kugoumusicapi.lyric({
          id: lyricId, accesskey, fmt: 'krc', decode: true, cookie: fullCookie,
        });
        krcText = (krcResp.body && krcResp.body.decodeContent) || '';

        // Step 2b: 低精度逐行 lrc
        const lrcResp = await kugoumusicapi.lyric({
          id: lyricId, accesskey, fmt: 'lrc', decode: true, cookie: fullCookie,
        });
        lrcText = (lrcResp.body && lrcResp.body.decodeContent) || '';

        dbgLog('[KUGOU] import 歌词下载: krcLen=' + krcText.length + ' lrcLen=' + lrcText.length);
      } else {
        dbgLog('[KUGOU] import 歌词搜索无候选, bodyKeys=' + Object.keys(searchResp.body || {}).join(','));
      }
    } catch (e) {
      dbgLog('[KUGOU] import 歌词获取异常:', e.message || e);
    }

    // 3. 构建标准 info 对象
    // song.name 可能是 "薛之谦 - 木偶人.mp3" 文件名格式, 用 parseNameField 解析
    const { title: parsedTitle, artist: parsedArtist } = parseNameField(song.name || '');
    const artists = (song.singerinfo || []).map(s => s.name).filter(Boolean).join(', ') || parsedArtist;
    const albumName = (song.albuminfo && song.albuminfo.name) || '';
    const coverUrl = (song.cover || '').replace('{size}', '480');

    const info = buildInfoFromTexts({
      title: parsedTitle,
      artist: artists,
      album: albumName,
      cover: coverUrl,
      url: audioUrl,
      duration: song.timelen || 0,
      hash,
      krcText,
      lrcText,
    });

    // 4. 下载到本地(复用 downloadParsedSong)
    const TIMEOUT_MS = 60000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('下载超时(60秒)')), TIMEOUT_MS);
    });
    const result = await Promise.race([
      downloadParsedSong(info, (stage, pct) => {
        sendToMain('parse-download-progress', { stage, pct });
      }, overwrite),
      timeoutPromise,
    ]);

    return { ok: true, data: result, info };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 试听(获取流式 URL + 歌词 + 封面, 不下载到本地)
ipcMain.handle('kugou-preview', async (event, { song, quality }) => {
  try {
    await kugouRefreshLogin();
    const cookie = await kugouRegisterDev();
    const config = readKugouConfig();
    // 统一用 当前账号 cookies (包含完整登录态 + dfid)
    const fullCookie = getCurrentKugouCookies(config);

    // 1. 获取音频直链(试听用 128k 即可, 节省带宽)
    const hash = song.hash;
    const previewQuality = quality || '128';
    dbgLog('[KUGOU] preview 调用, hash:', hash, 'name:', song.name, 'quality:', previewQuality);
    const urlRes = await kugoumusicapi.song_url({ hash, quality: previewQuality, cookie: fullCookie });
    const urls = (urlRes.body && urlRes.body.url) || [];
    dbgLog('[KUGOU] song_url 响应:', JSON.stringify({
      status: urlRes.body && urlRes.body.status,
      urlCount: urls.length,
      firstUrl: urls[0] ? urls[0].slice(0, 80) : '',
    }));
    if (urls.length === 0) throw new Error('无可用音频链接(可能需要VIP或歌曲下架)');
    const audioUrl = urls[0];

    // 2. 获取歌词(高精度 krc + 低精度 lrc)
    // 流程: search_lyric 拿 id+accesskey → lyric 下载 krc/lrc
    let krcText = '';
    let lrcText = '';
    try {
      const lowerHash = String(hash || '').toLowerCase();
      const { title: songTitle, artist: songArtist } = parseNameField(song.name || '');
      const keyword = songTitle + (songArtist ? ' ' + songArtist : '');

      // Step 1: 搜索候选歌词
      const searchResp = await kugoumusicapi.search_lyric({
        hash: lowerHash,
        keywords: keyword,
        cookie: fullCookie,
      });
      const candidates = (searchResp.body && searchResp.body.candidates) || [];
      dbgLog('[KUGOU] preview 歌词搜索: hash=' + lowerHash + ' keyword=' + keyword + ' candidates=' + candidates.length);

      if (candidates.length > 0) {
        const lyricId = candidates[0].id;
        const accesskey = candidates[0].accesskey;

        // Step 2a: 高精度逐字 krc
        const krcResp = await kugoumusicapi.lyric({
          id: lyricId, accesskey, fmt: 'krc', decode: true, cookie: fullCookie,
        });
        krcText = (krcResp.body && krcResp.body.decodeContent) || '';

        // Step 2b: 低精度逐行 lrc
        const lrcResp = await kugoumusicapi.lyric({
          id: lyricId, accesskey, fmt: 'lrc', decode: true, cookie: fullCookie,
        });
        lrcText = (lrcResp.body && lrcResp.body.decodeContent) || '';

        dbgLog('[KUGOU] preview 歌词下载: krcLen=' + krcText.length + ' lrcLen=' + lrcText.length);
      } else {
        dbgLog('[KUGOU] preview 歌词搜索无候选, bodyKeys=' + Object.keys(searchResp.body || {}).join(','));
      }
    } catch (e) {
      dbgLog('[KUGOU] preview 歌词获取异常:', e.message || e);
    }

    // 3. 用 buildInfoFromTexts 构建 info (解析标题/艺人/专辑, 合并 krc+lrc)
    // song.name 可能是 "薛之谦 - 木偶人.mp3" 文件名格式, 用 parseNameField 解析出干净的标题/艺人
    const { title: parsedTitle, artist: parsedArtist } = parseNameField(song.name || '');
    const artists = (song.singerinfo || []).map(s => s.name).filter(Boolean).join(', ') || parsedArtist;
    const albumName = (song.albuminfo && song.albuminfo.name) || '';
    const coverUrl = (song.cover || '').replace('{size}', '480');

    const info = buildInfoFromTexts({
      title: parsedTitle,
      artist: artists,
      album: albumName,
      cover: coverUrl,
      url: audioUrl,
      duration: song.timelen || 0,
      hash,
      krcText,
      lrcText,
    });

    // 4. krc 对象转 raw 文本(前端 parseRaw 可解析)
    const rawText = info.krc ? krcToRaw(info.krc) : '';
    dbgLog('[KUGOU] buildInfo 结果:', JSON.stringify({
      title: info.title,
      artist: info.artist,
      hasKrc: !!info.krc,
      rawTextLen: rawText.length,
      lrcTextLen: (info.lrc || '').length,
    }));

    return {
      ok: true,
      data: {
        url: audioUrl,
        rawText,        // 逐字 raw 文本(高精度, parseRaw 解析)
        lrcText: info.lrc || '',  // 行级 lrc 文本(低精度, parseLRC 解析)
        meta: {
          title: info.title,
          artist: info.artist,
          album: info.album,
          cover: info.cover,
          duration: info.duration,
          lyricist: info.lyricist,
          composer: info.composer,
        },
      },
    };
  } catch (e) {
    dbgLog('[KUGOU] preview 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

module.exports = {
  // 仅导出用于装配验证的标记, IPC handlers 在 require 时自注册
  registered: true,
};
