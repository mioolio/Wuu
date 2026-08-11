// =========== 网易云音乐 IPC 处理器 ===========
// 13 个 netease-* IPC handlers: 登录态/二维码/Cookie导入/登出/多账号/歌单/曲目/导入/试听/歌词
// require 本模块即自动注册所有 IPC handlers
// 复用酷狗的下载与歌词构建模式: downloadParsedSong + buildInfoFromTexts
const { ipcMain } = require('electron');
const neteaseApi = require('../tools/netease-api/main');
const { buildInfoFromTexts } = require('../parsers/platforms/kugou-proxy');
const parsers = require('../parsers');
const { downloadParsedSong } = require('../download');
const { sendToMain } = require('../core/state');
const { dbgLog, dbgErr } = require('../core/logger');
const {
  readNeteaseConfig, writeNeteaseConfig,
  getCurrentNeteaseAccount, getCurrentNeteaseCookie, saveNeteaseAccount,
} = require('./config');

// 统一返回 body 提取: NeteaseCloudMusicApi 返回 {status, body: {code, data/result/...}, cookie}
function pickBody(resp) {
  return (resp && resp.body) || {};
}
function pickCookie(resp) {
  // resp.cookie 是数组, 每项是 "k=v; Max-Age=..." 字符串, 拼接成完整 cookie 字符串
  if (!resp || !resp.cookie) return '';
  if (typeof resp.cookie === 'string') return resp.cookie;
  if (Array.isArray(resp.cookie)) return resp.cookie.map(c => c.split(';')[0]).join('; ');
  return '';
}

// IPC: 检查登录状态
ipcMain.handle('netease-login-status', async () => {
  const config = readNeteaseConfig();
  const acc = getCurrentNeteaseAccount(config);
  const cookieStr = acc ? acc.cookies : '';
  dbgLog('[NETEASE] login-status 检查, cookieLen:', cookieStr.length);
  if (!cookieStr) {
    dbgLog('[NETEASE] login-status: 无 cookie, 未登录');
    return { ok: false, loggedIn: false };
  }
  try {
    const resp = await neteaseApi.login_status({ cookie: cookieStr });
    const body = pickBody(resp);
    const data = (body && body.data) || {};
    const apiCode = data.code;
    const hasAccount = !!data.account;
    const hasProfile = !!data.profile;
    // 注意: body.code 是 NeteaseCloudMusicApi 返回的外层 body 中的 code
    const outerCode = body && body.code;
    // 301 = 用户未登录
    const is301 = outerCode === 301 || apiCode === 301;
    dbgLog('[NETEASE] login_status 响应:', JSON.stringify({
      outerCode, dataCode: apiCode, hasAccount, hasProfile,
      profileUserId: data.profile && data.profile.userId,
      is301,
    }));

    // 明确的未登录信号: 301 或 account/profile 都为 null (即使 code=200)
    const needRelogin = is301 || (!hasAccount && !hasProfile);
    if (needRelogin) {
      dbgLog('[NETEASE] login-status: 登录态已失效(301或account/profile为null), 返回未登录');
      return {
        ok: true,
        loggedIn: false,
        needRelogin: true,
        message: '登录态已失效，请重新扫码登录或导入Cookie',
      };
    }

    if (apiCode === 200 && hasProfile) {
      // 更新当前账号信息并持久化
      if (acc) {
        acc.nickname = data.profile.nickname || acc.nickname || '';
        acc.pic = data.profile.avatarUrl || acc.pic || '';
        acc.vipType = data.profile.vipType || 0;
        writeNeteaseConfig(config);
      }
      return {
        ok: true,
        loggedIn: true,
        userInfo: {
          userId: data.profile.userId,
          nickname: data.profile.nickname || '',
          pic: data.profile.avatarUrl || '',
          vipType: data.profile.vipType || 0,
        },
      };
    }
  } catch (e) {
    dbgErr('[NETEASE] login-status 异常:', e.message);
  }
  // cookie 存在但 login_status 异常: 保守起见返回未登录，避免使用失效cookie导致VIP试听
  dbgLog('[NETEASE] login-status: login_status失败, 保守返回未登录, 请重新登录');
  return {
    ok: true,
    loggedIn: false,
    needRelogin: true,
    message: '登录验证失败，请重新登录',
    userInfo: {
      userId: (acc && acc.userid) || '',
      nickname: (acc && acc.nickname) || '',
      pic: (acc && acc.pic) || '',
      vipType: (acc && acc.vipType) || 0,
    },
  };
});

// IPC: 获取二维码 key
ipcMain.handle('netease-qr-key', async () => {
  try {
    const resp = await neteaseApi.login_qr_key({});
    const body = pickBody(resp);
    if (body.code === 200 && body.data && body.data.unikey) {
      return { ok: true, key: body.data.unikey };
    }
    return { ok: false, message: '获取二维码key失败' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 生成二维码图片(base64)
ipcMain.handle('netease-qr-create', async (event, key) => {
  try {
    const resp = await neteaseApi.login_qr_create({ key, qrimg: true });
    const body = pickBody(resp);
    if (body.code === 200 && body.data) {
      return { ok: true, base64: body.data.qrimg, url: body.data.qrurl };
    }
    return { ok: false, message: '生成二维码失败' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// IPC: 检查二维码状态
// code: 800=过期, 801=等待扫码, 802=待确认, 803=登录成功
ipcMain.handle('netease-qr-check', async (event, key) => {
  try {
    const resp = await neteaseApi.login_qr_check({ key });
    const body = pickBody(resp);
    dbgLog('[NETEASE] qr-check 响应:', JSON.stringify({
      code: body.code,
      message: body.message,
      cookieLen: resp.cookie ? resp.cookie.length : 0,
    }));
    if (body.code !== undefined) {
      // 登录成功(code=803): 用返回的 cookie 查询用户信息并保存账号
      if (body.code === 803) {
        const cookieStr = pickCookie(resp);
        dbgLog('[NETEASE] 扫码登录成功, cookieStr len:', cookieStr.length);
        try {
          const lsResp = await neteaseApi.login_status({ cookie: cookieStr });
          const lsData = (pickBody(lsResp).data) || {};
          if (lsData.code === 200 && lsData.profile) {
            saveNeteaseAccount(cookieStr, {
              userId: lsData.profile.userId,
              nickname: lsData.profile.nickname || '',
              pic: lsData.profile.avatarUrl || '',
              vipType: lsData.profile.vipType || 0,
            });
            dbgLog('[NETEASE] 账号已保存, userId:', lsData.profile.userId);
          } else {
            dbgErr('[NETEASE] login_status 获取用户信息失败, 未保存账号');
          }
        } catch (e) {
          dbgErr('[NETEASE] 保存账号异常:', e.message);
        }
      }
      return { ok: true, code: body.code, message: body.message || '' };
    }
    return { ok: false, message: '检查二维码状态失败' };
  } catch (e) {
    dbgErr('[NETEASE] qr-check 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: Cookie 导入登录
// cookieStr: 用户从浏览器复制的完整 cookie 字符串(必须含 MUSIC_U)
ipcMain.handle('netease-cookie-login', async (event, cookieStr) => {
  try {
    if (!cookieStr || cookieStr.indexOf('MUSIC_U') === -1) {
      return { ok: false, message: 'Cookie 必须包含 MUSIC_U 字段' };
    }
    const resp = await neteaseApi.login_status({ cookie: cookieStr });
    const data = (pickBody(resp).data) || {};
    dbgLog('[NETEASE] cookie-login 响应:', JSON.stringify({
      dataCode: data.code,
      hasProfile: !!data.profile,
      profileUserId: data.profile && data.profile.userId,
    }));
    if (data.code === 200 && data.profile) {
      saveNeteaseAccount(cookieStr, {
        userId: data.profile.userId,
        nickname: data.profile.nickname || '',
        pic: data.profile.avatarUrl || '',
        vipType: data.profile.vipType || 0,
      });
      return {
        ok: true,
        userInfo: {
          userId: data.profile.userId,
          nickname: data.profile.nickname || '',
          pic: data.profile.avatarUrl || '',
          vipType: data.profile.vipType || 0,
        },
      };
    }
    return { ok: false, message: 'Cookie 无效或已过期' };
  } catch (e) {
    dbgErr('[NETEASE] cookie-login 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 退出登录(保留账号)
ipcMain.handle('netease-logout', async () => {
  const config = readNeteaseConfig();
  if (config.currentUserId) {
    // 调用网易云 logout 接口让服务端 cookie 失效
    const cookieStr = getCurrentNeteaseCookie(config);
    if (cookieStr) {
      try { await neteaseApi.logout({ cookie: cookieStr }); } catch (e) {}
    }
    config.currentUserId = null;
    writeNeteaseConfig(config);
  }
  return { ok: true };
});

// IPC: 列出所有保存的账号
ipcMain.handle('netease-list-accounts', async () => {
  const config = readNeteaseConfig();
  return {
    ok: true,
    accounts: (config.accounts || []).map(a => ({
      userid: a.userid, nickname: a.nickname, pic: a.pic, vipType: a.vipType,
    })),
    currentUserId: config.currentUserId,
  };
});

// IPC: 切换当前账号
ipcMain.handle('netease-switch-account', async (event, userid) => {
  const config = readNeteaseConfig();
  if (config.accounts.find(a => String(a.userid) === String(userid))) {
    config.currentUserId = userid;
    writeNeteaseConfig(config);
    return { ok: true };
  }
  return { ok: false, message: '账号不存在' };
});

// IPC: 删除指定账号
ipcMain.handle('netease-remove-account', async (event, userid) => {
  const config = readNeteaseConfig();
  config.accounts = (config.accounts || []).filter(a => String(a.userid) !== String(userid));
  if (String(config.currentUserId) === String(userid)) config.currentUserId = null;
  writeNeteaseConfig(config);
  return { ok: true };
});

// IPC: 获取用户歌单列表
// 返回 { ok, data: { created: [...], collected: [...] } }
ipcMain.handle('netease-user-playlists', async (event, { page, pagesize }) => {
  try {
    const config = readNeteaseConfig();
    const cookieStr = getCurrentNeteaseCookie(config);
    dbgLog('[NETEASE] user-playlists 调用, cookieLen:', cookieStr.length);
    const resp = await neteaseApi.user_playlist({
      uid: (config.currentUserId || ''),
      limit: pagesize || 30,
      offset: ((page || 1) - 1) * (pagesize || 30),
      cookie: cookieStr,
    });
    const body = pickBody(resp);
    dbgLog('[NETEASE] user-playlists 响应:', JSON.stringify({
      code: body.code,
      playlistCount: (body.playlist || []).length,
      more: body.more,
    }));
    if (body.code === 200 && Array.isArray(body.playlist)) {
      // 按 creator.userId 是否等于当前用户区分"创建"和"收藏"
      const curUid = String(config.currentUserId || '');
      const created = [];
      const collected = [];
      body.playlist.forEach(pl => {
        const creatorId = pl.creator && String(pl.creator.userId || '');
        const item = {
          id: pl.id,
          title: pl.name || '未知歌单',
          cover: pl.coverImgUrl || (pl.picUrl || ''),
          count: pl.trackCount || 0,
          playCount: pl.playCount || 0,
          creator: pl.creator ? { userId: pl.creator.userId, nickname: pl.creator.nickname } : null,
        };
        if (creatorId === curUid) created.push(item);
        else collected.push(item);
      });
      return { ok: true, data: { created, collected, more: !!body.more } };
    }
    return { ok: false, message: '获取歌单失败' };
  } catch (e) {
    dbgErr('[NETEASE] user-playlists 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 获取歌单内全部歌曲(自动分页, 网易云每页最多 1000 首)
// 返回 { ok, data: { songs: [...], count } }
ipcMain.handle('netease-playlist-tracks', async (event, { listid }) => {
  try {
    const config = readNeteaseConfig();
    const cookieStr = getCurrentNeteaseCookie(config);
    dbgLog('[NETEASE] playlist-tracks 调用, listid:', listid);
    const resp = await neteaseApi.playlist_track_all({
      id: listid,
      limit: 1000,
      offset: 0,
      cookie: cookieStr,
    });
    const body = pickBody(resp);
    dbgLog('[NETEASE] playlist-tracks 响应:', JSON.stringify({
      code: body.code,
      songCount: (body.songs || []).length,
    }));
    if (body.code === 200 && Array.isArray(body.songs)) {
      // 统一字段名, 与 qishui/kugou 保持一致(前端复用渲染逻辑)
      const songs = body.songs.map(s => ({
        id: s.id,
        name: s.name || '未知歌曲',
        artist: (s.ar || []).map(a => a.name).filter(Boolean).join(', '),
        album: (s.al && s.al.name) || '',
        cover: (s.al && s.al.picUrl) || '',
        duration: s.dt || 0,  // 毫秒
        fee: s.fee || 0,      // 0=免费, 1=VIP, 4=专辑, 8=低音质免费
        isVip: s.fee === 1,
        // 保留原始字段供 song_url_v1 使用
        _raw: s,
      }));
      return { ok: true, data: { songs, count: songs.length } };
    }
    return { ok: false, message: '获取曲目失败' };
  } catch (e) {
    dbgErr('[NETEASE] playlist-tracks 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 试听(获取音频 URL + 歌词 + 封面, 不下载)
// 复用酷狗 preview 模式: 返回 { url, rawText, lrcText, meta }
ipcMain.handle('netease-preview', async (event, { songId, quality }) => {
  try {
    const config = readNeteaseConfig();
    const cookieStr = getCurrentNeteaseCookie(config);
    dbgLog('[NETEASE] preview 调用, songId:', songId, 'quality:', quality || 'standard');

    // 0. 先获取歌曲详情(判断 fee 是否为 VIP)
    let coverUrl = '';
    let songTitle = '未知歌曲';
    let artistName = '';
    let albumName = '';
    let duration = 0;
    let songFee = 0;
    try {
      const detailResp = await neteaseApi.song_detail({ ids: String(songId), cookie: cookieStr });
      const detailBody = pickBody(detailResp);
      const s = (detailBody.songs || [])[0];
      if (s) {
        songTitle = s.name || songTitle;
        artistName = (s.ar || []).map(a => a.name).filter(Boolean).join(', ');
        albumName = (s.al && s.al.name) || '';
        coverUrl = (s.al && s.al.picUrl) || '';
        duration = s.dt || 0;
        songFee = s.fee || 0; // 0=免费, 1=VIP, 4=专辑, 8=低音质免费
      }
    } catch (e) {
      dbgLog('[NETEASE] preview 详情获取异常:', e.message || e);
    }

    // 1. 获取音频直链
    // level: standard(128k) / higher(192k) / exhigh(320k) / lossless / hires
    const level = quality || 'standard';
    const urlResp = await neteaseApi.song_url_v1({ id: String(songId), level, cookie: cookieStr });
    const urlBody = pickBody(urlResp);
    const urlData = (urlBody.data || [])[0];
    dbgLog('[NETEASE] song_url_v1 响应:', JSON.stringify({
      code: urlBody.code,
      urlCode: urlData && urlData.code,
      hasUrl: !!(urlData && urlData.url),
      urlType: urlData && urlData.type,
      br: urlData && urlData.br,
      size: urlData && urlData.size,
      fee: songFee,
      freeTrialInfo: urlData && urlData.freeTrialInfo ? '存在!' : null,
    }));

    // 试听检测: 多种迹象表明可能是试听版本
    let isPreviewVersion = false;
    let previewReason = '';
    if (urlData && urlData.url) {
      const urlLower = urlData.url.toLowerCase();
      // 迹象1: URL包含 preview 字样
      if (urlLower.includes('preview')) {
        isPreviewVersion = true;
        previewReason = 'URL包含preview标记';
      }
      // 迹象2: 有 freeTrialInfo
      if (urlData.freeTrialInfo) {
        isPreviewVersion = true;
        previewReason = previewReason || '包含freeTrialInfo试听信息';
      }
      // 迹象3: VIP歌曲(fee=1)但码率异常低 (例如请求exhigh但只返回128k且size明显偏小)
      // exhigh标准应该是320k左右, 如果只有128000且是VIP歌曲, 很可能是试听
      const brKbps = urlData.br ? Math.round(urlData.br / 1000) : 0;
      const expectMap = { standard: 128, higher: 192, exhigh: 320, lossless: 800, hires: 2000 };
      const expectBr = expectMap[level] || 128;
      if (songFee === 1 && brKbps < expectBr && brKbps <= 128) {
        isPreviewVersion = true;
        previewReason = previewReason || `VIP歌曲仅获得${brKbps}kbps(期望≥${expectBr}kbps), 疑似试听/登录态失效`;
      }
    }
    if (isPreviewVersion) {
      dbgLog('[NETEASE] ⚠️ 检测到试听版本! 原因:', previewReason);
    }

    if (!urlData || !urlData.url) {
      // 尝试给出更精确的错误
      let errMsg = '无可用音频链接(可能需要VIP或歌曲下架)';
      if (urlData) {
        if (urlData.code === -110) errMsg = '此歌曲仅黑胶专享(VIP权限不足或登录态失效)';
        else if (urlData.code === -1) errMsg = '该歌曲无版权或已下架';
        else if (urlData.code === 404) errMsg = '资源不存在(VIP未生效或需重新登录)';
      }
      // 如果是VIP歌曲拿不到URL, 提示重登录
      if (songFee === 1) errMsg += '(VIP歌曲请确认登录态有效, 可尝试重新扫码登录)';
      throw new Error(errMsg);
    }
    const audioUrl = urlData.url;

    // 如果检测到是试听 + VIP歌曲, 额外在返回值中标记, 前端可以提示用户
    const vipWarning = (songFee === 1 && isPreviewVersion)
      ? `VIP歌曲仅获得试听版本(${previewReason}), 登录态可能已失效, 请重新扫码登录`
      : '';
    // VIP歌曲试听 = 登录态失效的信号, 标记需要重新登录
    const needRelogin = songFee === 1 && isPreviewVersion;

    // 2. 获取歌词(LRC 文本; 网易云 klyric 逐字歌词经常为空, 暂不使用)
    let lrcText = '';
    try {
      const lrcResp = await neteaseApi.lyric({ id: songId, cookie: cookieStr });
      const lrcBody = pickBody(lrcResp);
      lrcText = (lrcBody.lrc && lrcBody.lrc.lyric) || '';
      dbgLog('[NETEASE] preview 歌词获取: lrcLen=' + lrcText.length);
    } catch (e) {
      dbgLog('[NETEASE] preview 歌词获取异常:', e.message || e);
    }

    // 3. 构建 info (复用酷狗的 buildInfoFromTexts, 但网易云无 krc, krcText 传空)
    const info = buildInfoFromTexts({
      title: songTitle,
      artist: artistName,
      album: albumName,
      cover: coverUrl,
      url: audioUrl,
      duration,
      hash: String(songId),
      krcText: '',
      lrcText,
    });

    return {
      ok: true,
      data: {
        url: audioUrl,
        rawText: '',              // 网易云无逐字 krc, rawText 为空
        lrcText: info.lrc || '',  // 统一格式的 LRC 文本
        isPreview: isPreviewVersion,
        previewReason,
        vipWarning,
        needRelogin,
        meta: {
          title: info.title,
          artist: info.artist,
          album: info.album,
          cover: info.cover,
          duration: info.duration,
          lyricist: info.lyricist,
          composer: info.composer,
          brKbps: urlData.br ? Math.round(urlData.br / 1000) : 0,
          size: urlData.size || 0,
          fee: songFee,
        },
      },
    };
  } catch (e) {
    dbgErr('[NETEASE] preview 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 导入单首歌曲(下载到本地, 复用 downloadParsedSong)
// 流式推送进度: 复用 parse-download-progress 通道(与酷狗一致, UI 可复用)
// 音质降级链: lossless → hires → exhigh → higher → standard
//   某些歌曲作者未提供无损时, 自动降级到下一档, 避免直接报错"无可用音频链接"
ipcMain.handle('netease-import-song', async (event, { songId, quality, songMeta, overwrite }) => {
  try {
    const config = readNeteaseConfig();
    const cookieStr = getCurrentNeteaseCookie(config);
    dbgLog('[NETEASE] import-song 调用, songId:', songId, 'quality:', quality || 'lossless');

    // 0. 获取歌曲详情, 判断 fee 是否为 VIP
    let songFee = 0;
    try {
      const detailResp = await neteaseApi.song_detail({ ids: String(songId), cookie: cookieStr });
      const s = (pickBody(detailResp).songs || [])[0];
      if (s) songFee = s.fee || 0;
    } catch (e) {}

    // 1. 获取音频直链 (带降级链)
    //    用户传入 quality 通常为 lossless; 若该音质不可用则按等级降级直到取到 url
    const FALLBACK_CHAIN = ['lossless', 'hires', 'exhigh', 'higher', 'standard'];
    const expectBrMap = { standard: 128, higher: 192, exhigh: 320, lossless: 800, hires: 2000 };
    const startLevel = quality || 'lossless';
    const startIdx = FALLBACK_CHAIN.indexOf(startLevel);
    const chain = startIdx >= 0
      ? FALLBACK_CHAIN.slice(startIdx)
      : [startLevel, ...FALLBACK_CHAIN];
    let audioUrl = '';
    let usedLevel = '';
    let urlData = null;
    // 记录第一次降级时是否遇到试听痕迹
    let previewHits = [];
    for (const lv of chain) {
      try {
        const urlResp = await neteaseApi.song_url_v1({ id: String(songId), level: lv, cookie: cookieStr });
        const urlBody = pickBody(urlResp);
        const d = (urlBody.data || [])[0];
        dbgLog('[NETEASE] import-song 尝试 level=' + lv + ', hasUrl=' + !!(d && d.url) + ', code=' + (d && d.code) + ', br=' + (d && d.br) + ', freeTrialInfo=' + (d && d.freeTrialInfo ? '有' : '无'));
        if (d && d.url) {
          // 试听检测
          let hit = null;
          if (d.url.toLowerCase().includes('preview')) hit = 'URL含preview';
          else if (d.freeTrialInfo) hit = '含freeTrialInfo';
          // VIP歌曲: 如果码率低于该level的期望且只有128k, 视为试听
          else if (songFee === 1) {
            const brKbps = Math.round((d.br || 0) / 1000);
            const exp = expectBrMap[lv] || 128;
            if (brKbps < exp && brKbps <= 128) hit = `VIP仅${brKbps}kbps<${exp}kbps`;
          }
          if (hit) previewHits.push(`${lv}:${hit}`);
          audioUrl = d.url;
          usedLevel = lv;
          urlData = d;
          break;
        }
      } catch (e) {
        dbgLog('[NETEASE] import-song level=' + lv + ' 异常:', e.message);
      }
    }
    if (!audioUrl) {
      // 更具体的错误提示
      let msg = '无可用音频链接(可能需要VIP或歌曲下架)';
      if (songFee === 1) msg += '(VIP歌曲请确认登录态是否有效, 可尝试重新扫码登录)';
      throw new Error(msg);
    }
    dbgLog('[NETEASE] import-song 最终采用 level=' + usedLevel + ', url=' + audioUrl.slice(0, 80));
    // 最终拿到的也是试听且是VIP歌曲: 额外警告日志(但不阻断, 让用户自行决定)
    if (previewHits.length) {
      dbgLog('[NETEASE] import-song ⚠️ 疑似试听版本, 检测到: ' + previewHits.join(' | '));
    }
    if (songFee === 1 && urlData) {
      const brKbps = Math.round((urlData.br || 0) / 1000);
      const exp = expectBrMap[usedLevel] || 128;
      if (brKbps <= 128 && exp > 192) {
        dbgLog(`[NETEASE] import-song ⚠️ VIP歌曲仅获得 ${brKbps}kbps, 降级到${usedLevel}未达到${exp}kbps, 登录态可能失效!`);
      }
    }

    // 2. 获取歌词
    let lrcText = '';
    try {
      const lrcResp = await neteaseApi.lyric({ id: songId, cookie: cookieStr });
      lrcText = (pickBody(lrcResp).lrc || {}).lyric || '';
    } catch (e) {}

    // 3. 构建 info (songMeta 是前端传来的曲目对象, 含 name/artist/album/cover/duration)
    const songName = (songMeta && songMeta.name) || '未知歌曲';
    const artistName = (songMeta && songMeta.artist) || '';
    const albumName = (songMeta && songMeta.album) || '';
    const coverUrl = (songMeta && songMeta.cover) || '';
    const duration = (songMeta && songMeta.duration) || 0;

    const info = buildInfoFromTexts({
      title: songName,
      artist: artistName,
      album: albumName,
      cover: coverUrl,
      url: audioUrl,
      duration,
      hash: String(songId),
      krcText: '',
      lrcText,
    });
    // 附带下载诊断信息
    info._neteaseMeta = {
      fee: songFee,
      usedLevel,
      brKbps: urlData ? Math.round((urlData.br || 0) / 1000) : 0,
      previewHits,
      size: urlData ? urlData.size || 0 : 0,
    };

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
    dbgErr('[NETEASE] import-song 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

dbgLog('[NETEASE] 13 个 netease-* IPC handlers 已注册');
