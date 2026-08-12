// =========== 汽水音乐 IPC 处理器 ===========
// 10 个 qishui-* IPC handlers: 二维码/一键/文件登录/用户信息/歌单/歌单详情/导入/试听
// require 本模块即自动注册所有 IPC handlers
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const parsers = require('../parsers');
const { krcToRaw } = parsers;
const { fetchWithTimeout, sanitizeFileName } = require('../core/network');
const { dbgLog, dbgErr } = require('../core/logger');
const {
  qishuiFixed, qishuiEndpoints,
  qishuiDownloadTrackMedia, getSessionIdFromSodaMusicCookies, readSessionIdFromCookieDatabase, readAllCookiesFromDatabase,
  getQishuiSession, setQishuiSession,
  qishuiGetImageUrl, qishuiFormatDuration, qishuiBuildUrl, qishuiExtractSessionid, qishuiExtractFullCookie,
  qishuiGetArtists, qishuiGetLyricist, qishuiGetComposer, qishuiGetSpadeA, qishuiGetCover,
  qishuiIsVipTrack, qishuiFetchLyrics,
} = require('./utils');
// 多账号配置持久化 (与 netease/config.js 结构对齐)
const {
  readQishuiConfig, getCurrentQishuiAccount, getCurrentQishuiCookie,
  saveQishuiAccount, listQishuiAccounts, switchQishuiAccount, removeQishuiAccount, clearQishuiCurrentUser,
} = require('./config');

// IPC: 获取登录二维码
ipcMain.handle('qishui-get-qrcode', async () => {
  try {
    // 二维码登录端点需要登录参数(参考 PopDownloader auth-qrcode.js)
    const url = qishuiBuildUrl(qishuiEndpoints.getQrcode, {
      passport_jssdk_version: qishuiFixed.passport_jssdk_version,
      passport_jssdk_type: qishuiFixed.passport_jssdk_type,
      is_from_ttaccountsdk: qishuiFixed.is_from_ttaccountsdk,
      aid: qishuiFixed.aid,
      next: qishuiFixed.next,
    });
    dbgLog('[QISHUI] get-qrcode 请求:', url.substring(0, 100));
    const resp = await fetch(url);
    const json = await resp.json();
    if (json && json.data) {
      return {
        ok: true,
        token: json.data.token || '',
        qrcode: json.data.qrcode || json.data.qr_code || json.data.qr_url || '',
        expire_time: json.data.expire_time || json.data.expires_in || 0,
      };
    }
    return { ok: false, message: (json && json.message) || '获取二维码失败' };
  } catch (e) {
    dbgErr('[QISHUI] get-qrcode 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 检查二维码状态
// status: new(等待扫码) / scanned(已扫码待确认) / confirmed(登录成功) / expired(已过期)
ipcMain.handle('qishui-check-qrcode', async (event, { token }) => {
  try {
    // 参考 PopDownloader auth-qrcode-status.js: query 和 body 参数是分开的
    const url = qishuiBuildUrl(qishuiEndpoints.checkQrConnect, {
      passport_jssdk_version: qishuiFixed.passport_jssdk_version,
      passport_jssdk_type: qishuiFixed.passport_jssdk_type,
      is_from_ttaccountsdk: qishuiFixed.is_from_ttaccountsdk,
      aid: qishuiFixed.aid,
      iid: qishuiFixed.iid,
    });
    const body = new URLSearchParams({
      need_logo: qishuiFixed.need_logo,
      need_short_url: qishuiFixed.need_short_url,
      is_frontier: qishuiFixed.is_frontier,
      token,
      is_new_login: qishuiFixed.is_new_login,
      next: qishuiFixed.next,
    }).toString();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await resp.json();

    // 从 Set-Cookie 头提取 sessionid
    const sessionid = qishuiExtractSessionid(resp);
    // 从 Set-Cookie 头提取完整 cookie (含 passport_csrf_token, ttwid 等风控敏感字段)
    const fullCookie = qishuiExtractFullCookie(resp);

    // 映射状态
    const rawStatus = json?.data?.status;
    let status = 'new';
    if (rawStatus === 0) status = 'new';
    else if (rawStatus === 1) status = 'scanned';
    else if (rawStatus === 2 || rawStatus === 9) status = 'confirmed';
    else if (rawStatus === 3 || rawStatus === 5) status = 'expired';

    dbgLog('[QISHUI] check-qrcode 响应: rawStatus=' + rawStatus + ' status=' + status + ' hasSessionid=' + !!sessionid + ' fullCookie长度=' + fullCookie.length);

    // 登录成功, 保存会话
    if (status === 'confirmed' && sessionid) {
      const aid = String(json?.data?.user_id || json?.data?.uid || json?.data?.aid || qishuiFixed.aid);
      setQishuiSession({ aid, sessionid, cookie: fullCookie || `sessionid=${sessionid};` });
      dbgLog('[QISHUI] 二维码登录成功, aid=' + aid + ' cookie长度=' + (fullCookie || '').length);
    }

    const session = getQishuiSession();
    return { ok: true, status, sessionid, aid: session.aid };
  } catch (e) {
    dbgErr('[QISHUI] check-qrcode 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 一键登录(从 PC 端汽水音乐 Cookie 数据库读取 sessionid + 完整 cookie)
ipcMain.handle('qishui-oneclick-login', async () => {
  try {
    const result = await getSessionIdFromSodaMusicCookies();
    if (result.supported && result.sessionid) {
      // 保存完整 cookie (video_v2 等风控敏感接口需要完整 cookie)
      setQishuiSession({ aid: qishuiFixed.aid, sessionid: result.sessionid, cookie: result.cookie || '' });
      dbgLog('[QISHUI] 一键登录成功, cookie 长度=' + (result.cookie || '').length);
    } else {
      dbgLog('[QISHUI] 一键登录失败:', result.reason);
    }
    return {
      supported: result.supported,
      sessionid: result.sessionid || '',
      reason: result.reason || '',
    };
  } catch (e) {
    dbgErr('[QISHUI] oneclick-login 异常:', e.message);
    return { supported: false, sessionid: '', reason: e.message };
  }
});

// IPC: 预读取本地汽水音乐用户信息(不建立正式 session, 仅用于登录前预显示头像/名称)
ipcMain.handle('qishui-peek-profile', async () => {
  try {
    const result = await getSessionIdFromSodaMusicCookies();
    if (!result.supported || !result.sessionid) {
      return { ok: false, reason: result.reason || '未找到本地汽水音乐 Cookie' };
    }
    // 用临时 sessionid 拉取用户信息, 使用完整 cookie (含 passport_csrf_token 等)
    const url = qishuiBuildUrl(qishuiEndpoints.me, { aid: qishuiFixed.aid });
    const cookieHeader = result.cookie || `sessionid=${result.sessionid};`;
    const resp = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });
    const json = await resp.json();
    const info = json?.my_info || json?.data?.my_info || json?.data || {};
    const avatarImg = info.medium_avatar_url || info.avatar_url || info.avatar;
    return {
      ok: true,
      nickname: info.nickname || info.name || '',
      avatar: qishuiGetImageUrl(avatarImg) || (typeof avatarImg === 'string' ? avatarImg : ''),
      isVip: !!(info.is_vip || info.vip),
    };
  } catch (e) {
    dbgLog('[QISHUI] peek-profile 异常(不影响后续登录):', e.message);
    return { ok: false, reason: e.message };
  }
});

// IPC: 文件登录(从用户上传的 Cookies sqlite 文件读取 sessionid)
ipcMain.handle('qishui-file-login', async (event, { fileName, fileContentBase64 }) => {
  let tempPath = '';
  try {
    if (!fileContentBase64) {
      return { supported: false, sessionid: '', message: '文件内容为空' };
    }
    // 写入临时 .sqlite 文件
    const buffer = Buffer.from(fileContentBase64, 'base64');
    tempPath = path.join(os.tmpdir(), `qishui-cookies-${Date.now()}.sqlite`);
    fs.writeFileSync(tempPath, buffer);

    // 读取 sessionid + 完整 cookie
    const sessionid = await readSessionIdFromCookieDatabase(tempPath);
    if (sessionid) {
      let fileCookie = '';
      try { fileCookie = await readAllCookiesFromDatabase(tempPath); } catch (e) {}
      setQishuiSession({ aid: qishuiFixed.aid, sessionid, cookie: fileCookie });
      dbgLog('[QISHUI] 文件登录成功, cookie 长度=' + fileCookie.length);
      return { supported: true, sessionid, message: '登录成功' };
    }
    return { supported: false, sessionid: '', message: '未在文件中找到汽水音乐 sessionid' };
  } catch (e) {
    dbgErr('[QISHUI] file-login 异常:', e.message);
    return { supported: false, sessionid: '', message: e.message };
  } finally {
    // 清理临时文件
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }
});

// IPC: 获取用户信息
ipcMain.handle('qishui-get-profile', async (event, { aid, sessionid }) => {
  try {
    // 参考 PopDownloader auth-profile.js: 只需 aid 参数, Cookie 头带完整 cookie
    const url = qishuiBuildUrl(qishuiEndpoints.me, { aid });
    // 使用会话中的完整 cookie (含 passport_csrf_token 等), 保证风控敏感接口可用
    const session = getQishuiSession();
    const cookieHeader = session.cookie || `sessionid=${sessionid};`;
    dbgLog('[QISHUI] get-profile 请求, aid=' + aid + ' cookie长度=' + cookieHeader.length);
    const resp = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });
    const json = await resp.json();
    // 详细日志: 输出完整响应结构, 便于排查头像/名称缺失问题
    dbgLog('[QISHUI] get-profile respKeys=' + JSON.stringify(Object.keys(json || {})));
    dbgLog('[QISHUI] get-profile 完整响应=' + JSON.stringify(json, null, 2));
    // 参考 PopDownloader normalizeUserProfile: my_info 在根级别
    const info = json?.my_info || json?.data?.my_info || json?.data || {};
    dbgLog('[QISHUI] get-profile my_info keys=' + JSON.stringify(Object.keys(info || {})));
    dbgLog('[QISHUI] get-profile nickname="' + (info.nickname || info.name || '') + '" avatar_url=' + JSON.stringify(info.medium_avatar_url || info.avatar_url || info.avatar || null));
    // avatar 在 medium_avatar_url (imageLike 对象, 需取 urls[0])
    const avatarImg = info.medium_avatar_url || info.avatar_url || info.avatar;
    const userId = String(info.id || info.user_id || aid || '');
    const nickname = info.nickname || info.name || '';
    const avatar = qishuiGetImageUrl(avatarImg) || (typeof avatarImg === 'string' ? avatarImg : '');
    const isVip = !!(info.is_vip || info.vip);
    const vipStage = info.vip_stage || info.vip_type || 0;

    // 持久化账号到 config/qishui_config.json (所有登录入口最终都经过 get-profile)
    if (userId) {
      const session = getQishuiSession();
      const cookieStr = session.cookie || `sessionid=${sessionid};`;
      try {
        saveQishuiAccount(cookieStr, {
          userId,
          nickname,
          pic: avatar,
          vipType: vipStage,
          aid: String(aid || qishuiFixed.aid),
          sessionid: String(sessionid || ''),
        });
        // 同步更新 session.userid (供多账号管理使用)
        setQishuiSession({ ...session, userid: userId });
        dbgLog('[QISHUI] get-profile 账号已持久化, userId=' + userId + ' nickname=' + nickname);
      } catch (e) {
        dbgErr('[QISHUI] get-profile 持久化账号失败:', e.message);
      }
    }

    return {
      ok: true,
      id: userId,
      nickname,
      avatar,
      isVip,
      vipStage,
    };
  } catch (e) {
    dbgErr('[QISHUI] get-profile 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 获取用户歌单列表(创建 + 收藏, 并行请求)
ipcMain.handle('qishui-get-playlists', async (event, { aid, sessionid }) => {
  try {
    const session = getQishuiSession();
    const cookie = { Cookie: session.cookie || `sessionid=${sessionid};` };
    // 创建的歌单需要 iid + version_code, 收藏的歌单只需要 aid
    const createdUrl = qishuiBuildUrl(qishuiEndpoints.mePlaylists, { aid, iid: '27960026095955', version_code: '30020100' });
    const collectedUrl = qishuiBuildUrl(qishuiEndpoints.meCollectionMixed, { aid });

    dbgLog('[QISHUI] get-playlists 请求, aid=' + aid);
    dbgLog('[QISHUI] createdUrl=' + createdUrl);
    dbgLog('[QISHUI] collectedUrl=' + collectedUrl);

    const [createdResp, collectedResp] = await Promise.all([
      fetch(createdUrl, { headers: cookie }).then(r => r.json()).catch((e) => { dbgLog('[QISHUI] createdResp err: ' + e.message); return null; }),
      fetch(collectedUrl, { headers: cookie }).then(r => r.json()).catch((e) => { dbgLog('[QISHUI] collectedResp err: ' + e.message); return null; }),
    ]);

    dbgLog('[QISHUI] createdResp keys=' + JSON.stringify(Object.keys(createdResp || {})));
    dbgLog('[QISHUI] collectedResp keys=' + JSON.stringify(Object.keys(collectedResp || {})));

    // API返回: { playlists: [...], total_num }
    const createdRaw = createdResp?.playlists || [];
    const created = (Array.isArray(createdRaw) ? createdRaw : []).map(pl => ({
      id: String(pl.id || ''),
      title: pl.title || '',
      count_tracks: pl.count_tracks || 0,
      cover: qishuiGetImageUrl(pl.cover) || qishuiGetImageUrl(pl.url_cover) || '',
      owner: (pl.owner && (pl.owner.nickname || pl.owner.name)) || '',
    }));

    // API返回: { mixed_collections: [{ item_type:'playlist', playlist: { id, title, count_tracks } }] }
    const collectedRaw = collectedResp?.mixed_collections || [];
    const collected = (Array.isArray(collectedRaw) ? collectedRaw : [])
      .filter(item => item.item_type === 'playlist' && item.playlist)
      .map(item => {
        const pl = item.playlist;
        return {
          id: String(pl.id || ''),
          title: pl.title || '',
          count_tracks: pl.count_tracks || 0,
          cover: qishuiGetImageUrl(pl.cover) || qishuiGetImageUrl(pl.url_cover) || '',
          owner: (pl.owner && (pl.owner.nickname || pl.owner.name)) || '',
        };
      });

    dbgLog('[QISHUI] get-playlists 响应: created=' + created.length + ' collected=' + collected.length);

    return { ok: true, created, collected };
  } catch (e) {
    dbgErr('[QISHUI] get-playlists 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 获取歌单详情(分页)
ipcMain.handle('qishui-get-playlist-detail', async (event, { aid, sessionid, playlistId, cursor }) => {
  try {
    // 参考 PopDownloader playlist-detail.js: 需要完整 region 三参数 + sim_region
    const url = qishuiBuildUrl(qishuiEndpoints.playlistDetail, {
      aid,
      iid: qishuiFixed.iid,
      version_code: qishuiFixed.version_code,
      region: qishuiFixed.region,
      geo_region: qishuiFixed.geo_region,
      os_region: qishuiFixed.os_region,
      sim_region: qishuiFixed.sim_region,
      playlist_id: playlistId,
      cursor: cursor || '',
      count: 15,
    });
    const session = getQishuiSession();
    const cookieHeader = session.cookie || `sessionid=${sessionid};`;
    dbgLog('[QISHUI] get-playlist-detail 请求, playlistId=' + playlistId + ' cursor=' + (cursor || '') + ' cookie长度=' + cookieHeader.length);
    const resp = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });
    const json = await resp.json();
    dbgLog('[QISHUI] get-playlist-detail respKeys=' + JSON.stringify(Object.keys(json || {})));
    // API返回: { has_more, next_cursor, playlist:{id,title}, media_resources:[...] }
    const hasMore = !!json?.has_more;
    const nextCursor = json?.next_cursor || '';
    const mediaResources = json?.media_resources || [];

    // 参考 PopDownloader PlaylistDetailModal.vue normalizeDetailRows:
    // track 嵌套在 resource.entity.track_wrapper.track 中(不是 resource.track)
    const songs = (Array.isArray(mediaResources) ? mediaResources : []).map(resource => {
      const track = resource?.entity?.track_wrapper?.track;
      const video = resource?.entity?.video;
      const source = track || video || {};
      const album = track?.album || {};
      const isOrphaned = String(album.id) === '0' && !album.name;
      const isVideoType = resource?.type === 'video';
      // UGC 创作歌曲(抖音原声): track.media_type === 'ugc_clip', track_v2 端点不认识 track.id,
      // 必须用 track.vid (视频ID) 作为 video_id 请求 video_v2 端点
      const isUgcClip = track?.media_type === 'ugc_clip';
      // 真正视频类型(收藏的抖音视频): video.type === 'ugc_video', video.vid 是字符串格式 (v1e00fgi...)
      const isRealVideo = video?.type === 'ugc_video' || (isVideoType && !track);
      // track_id 优先取 track.id; 视频类型/UGC 创作回退到 vid/video_id
      const trackId = track?.id ? String(track.id) : (isVideoType ? (video?.video_id || video?.vid || '') : '');
      // vid: 优先取字符串格式 vid (v1e00fgi...), 这是 video_v2 端点需要的格式
      // 真正视频: video.vid 是字符串格式; UGC 创作: track.vid 是数字字符串
      const vidStr = (track?.vid && String(track.vid).startsWith('v')) ? track.vid
        : (video?.vid && String(video.vid).startsWith('v')) ? video.vid
        : '';
      const vidNum = track?.vid || video?.video_id || video?.vid || '';
      // 优先返回字符串格式 vid, 没有则返回数字字符串 vid
      const vid = vidStr || vidNum;
      // 诊断日志
      dbgLog('[QISHUI] get-playlist-detail resource: type=' + resource?.type +
        ' resource.id=' + resource?.id +
        ' track.id=' + (track?.id || '(无)') +
        ' track.vid=' + (track?.vid || '(无)') +
        ' track.media_type=' + (track?.media_type || '(无)') +
        ' video.video_id=' + (video?.video_id || '(无)') +
        ' video.vid=' + (video?.vid || '(无)') +
        ' video.type=' + (video?.type || '(无)') +
        ' trackId=' + (trackId || '(空)') +
        ' vid=' + (vid || '(空)') +
        ' isUgcClip=' + isUgcClip +
        ' isVideoType=' + isVideoType +
        ' isRealVideo=' + isRealVideo);
      return {
        id: trackId,
        videoId: vid,  // 统一用 vid 字段, 下游 downloadTrackMedia 依据此字段 fallback 到 video_v2
        vid,           // 保留 vid 字段名, 与缓存结构对齐
        mediaType: (isVideoType || isUgcClip) ? 'video' : 'track',
        name: track?.name || video?.title || '',
        artist: qishuiGetArtists(source),
        album: album.name || '',
        cover: qishuiGetCover(track) || qishuiGetImageUrl(video?.cover_url),
        duration: qishuiFormatDuration(track?.duration || video?.duration || 0),
        isVideo: isVideoType,
        isUgcClip,
        isUnavailable: !trackId && !vid && !video ? true : (track?.status === 10 || isOrphaned),
        isVip: qishuiIsVipTrack(track),
        raw: resource,
      };
    });

    dbgLog('[QISHUI] get-playlist-detail 响应: songs=' + songs.length + ' hasMore=' + hasMore);

    return { ok: true, has_more: hasMore, next_cursor: nextCursor, songs };
  } catch (e) {
    dbgErr('[QISHUI] get-playlist-detail 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// IPC: 导入单首歌曲(下载 + 解密 + 保存音频/封面/歌词)
ipcMain.handle('qishui-import-song', async (event, { aid, sessionid, trackId, quality, songMeta, mediaType, vid }) => {
  try {
    dbgLog('[QISHUI] import-song 开始, trackId=' + trackId + ' vid=' + (vid || '(无)') + ' quality=' + quality + ' mediaType=' + (mediaType || 'track'));
    event.sender.send('qishui-import-progress', { stage: 'start', pct: 0 });

    // 从会话获取完整 cookie (video_v2 等风控敏感接口需要完整 cookie)
    const session = getQishuiSession();
    const fullCookie = session.cookie || `sessionid=${sessionid};`;

    // 1. 下载并解密音频
    event.sender.send('qishui-import-progress', { stage: 'audio', pct: 10 });
    const dlResult = await qishuiDownloadTrackMedia({
      sessionid,
      cookie: fullCookie,  // 传递完整 cookie 给 fetchVideoPayload
      track_id: String(trackId),
      quality: quality || 'high',
      aid: aid || qishuiFixed.aid,
      mediaType: mediaType || 'track',
      vid: vid || '',  // UGC 创作歌曲的关键标识 (track.vid)
    });
    const audioBuffer = dlResult.buffer;
    const trackPayload = dlResult.trackPayload;
    const track = trackPayload?.track || {};
    const video = trackPayload?.video || {};  // 视频资源时 track 可能为空, 从 video 取元数据
    const title = (songMeta && songMeta.name) || track.name || video.title || '未知歌曲';
    const artist = (songMeta && songMeta.artist) || qishuiGetArtists(track) || qishuiGetArtists(video) || '未知艺人';
    const album = (songMeta && songMeta.album) || track.album?.name || '';
    const coverUrl = (songMeta && songMeta.cover) || qishuiGetCover(track) || qishuiGetImageUrl(video.cover_url);
    const duration = track.duration || video.duration || 0;

    event.sender.send('qishui-import-progress', { stage: 'audio', pct: 50 });

    // 2. 创建输出目录
    const songName = sanitizeFileName(title);
    const artistName = sanitizeFileName(artist);
    const folderName = `${songName} - ${artistName}`;
    const outputDir = path.join(__dirname, '..', 'output', folderName);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // 3. 保存音频文件
    const ext = dlResult.contentType === 'audio/flac' ? 'flac' : 'm4a';
    const audioPath = path.join(outputDir, `${songName} - ${artistName}.${ext}`);
    // 删除旧扩展名的音频文件
    try {
      const existing = fs.readdirSync(outputDir);
      for (const f of existing) {
        if (/\.(aac|m4a|mp3|wav|flac|ogg)$/i.test(f)) {
          const oldPath = path.join(outputDir, f);
          if (oldPath !== audioPath) fs.unlinkSync(oldPath);
        }
      }
    } catch (e) {}
    fs.writeFileSync(audioPath, audioBuffer);
    event.sender.send('qishui-import-progress', { stage: 'audio', pct: 100 });

    // 4. 下载封面
    let coverPath = null;
    event.sender.send('qishui-import-progress', { stage: 'cover', pct: 10 });
    if (coverUrl) {
      try {
        const coverResp = await fetchWithTimeout(coverUrl, {}, 30000);
        if (coverResp.ok) {
          const coverBuf = Buffer.from(await coverResp.arrayBuffer());
          const coverExt = (coverUrl.match(/\.(jpg|jpeg|png|webp)/i) || ['', 'jpg'])[1].toLowerCase();
          const cExt = coverExt === 'jpeg' ? 'jpg' : coverExt;
          coverPath = path.join(outputDir, `cover.${cExt}`);
          try {
            const existing = fs.readdirSync(outputDir);
            for (const f of existing) {
              if (/^cover\.(jpg|jpeg|png|webp)$/i.test(f)) {
                const oldPath = path.join(outputDir, f);
                if (oldPath !== coverPath) fs.unlinkSync(oldPath);
              }
            }
          } catch (e) {}
          fs.writeFileSync(coverPath, coverBuf);
        }
      } catch (e) {
        dbgLog('[QISHUI] import 封面下载异常:', e.message);
      }
    }
    event.sender.send('qishui-import-progress', { stage: 'cover', pct: 100 });

    // 5. 获取歌词 (失败不影响导入)
    event.sender.send('qishui-import-progress', { stage: 'lrc', pct: 10 });
    let krcObj = null;
    let lrcText = '';
    let krcRawText = '';
    try {
      const lyricResult = await qishuiFetchLyrics(trackId, trackPayload);
      krcObj = lyricResult.krcObj;
      lrcText = lyricResult.lrcText || '';
      krcRawText = lyricResult.krcRaw || (krcObj ? krcToRaw(krcObj) : '');
    } catch (lyricErr) {
      dbgLog('[QISHUI] import 歌词获取失败(不影响导入):', lyricErr.message);
    }

    // 6. 保存歌词
    let lrcPath = null;
    const lrcHeader = `[ti:${title}]\n[ar:${artist}]\n[al:${album}]\n`;
    const finalLrc = lrcText ? (lrcHeader + lrcText.replace(/^\s*\[(ti|ar|al|lyricist|composer|id|offset|by)\s*:[^\]]*\]\s*$/gim, '').trim()) : '';
    if (finalLrc) {
      lrcPath = path.join(outputDir, `${songName} - ${artistName}.lrc`);
      fs.writeFileSync(lrcPath, finalLrc, 'utf-8');
    }
    // 保存逐字 raw 格式歌词
    if (krcRawText) {
      fs.writeFileSync(path.join(outputDir, 'lyrics_raw.txt'), krcRawText, 'utf-8');
    }
    if (krcObj) {
      fs.writeFileSync(path.join(outputDir, 'lyrics_krc.json'), JSON.stringify(krcObj, null, 2), 'utf-8');
    }
    event.sender.send('qishui-import-progress', { stage: 'lrc', pct: 100 });

    // 7. 保存 info.json (包含作词/作曲信息)
    const lyricist = qishuiGetLyricist(track);
    const composer = qishuiGetComposer(track);
    fs.writeFileSync(path.join(outputDir, 'info.json'), JSON.stringify({
      title,
      artist,
      album,
      duration: duration || 0,
      trackId: String(trackId),
      source: 'qishui',
      lyricist,
      composer,
    }, null, 2), 'utf-8');
    event.sender.send('qishui-import-progress', { stage: 'info', pct: 100 });

    dbgLog('[QISHUI] import-song 完成: ' + folderName);

    return {
      ok: true,
      data: { audioPath, coverPath, lrcPath, folder: folderName },
    };
  } catch (e) {
    dbgErr('[QISHUI] import-song 异常:', e.message);
    event.sender.send('qishui-import-progress', { stage: 'error', message: e.message });
    return { ok: false, message: e.message };
  }
});

// IPC: 试听(获取音频/视频 URL + 歌词, 不下载到本地)
ipcMain.handle('qishui-preview', async (event, { aid, sessionid, trackId, quality, mediaType, songMeta, vid }) => {
  try {
    dbgLog('[QISHUI] preview 请求, trackId=' + trackId + ' vid=' + (vid || '(无)') + ' quality=' + quality + ' mediaType=' + (mediaType || 'track'));

    // 从会话获取完整 cookie (video_v2 等风控敏感接口需要完整 cookie, 不能只有 sessionid)
    const session = getQishuiSession();
    const fullCookie = session.cookie || `sessionid=${sessionid};`;

    // 1. 下载并解密音频/视频(用于试听播放)
    const dlResult = await qishuiDownloadTrackMedia({
      sessionid,
      cookie: fullCookie,  // 传递完整 cookie 给 fetchVideoPayload
      track_id: String(trackId),
      quality: quality || 'high',
      aid: aid || qishuiFixed.aid,
      mediaType: mediaType || 'track',
      vid: vid || '',  // UGC 创作歌曲/真正视频的关键标识
    });
    const mediaBuffer = dlResult.buffer;
    const trackPayload = dlResult.trackPayload;
    const track = trackPayload?.track || {};
    const video = trackPayload?.video || {};  // 真正视频时 track 可能为空, 从 video 取元数据

    const title = track.name || video.title || (songMeta && songMeta.name) || '未知歌曲';
    const artist = qishuiGetArtists(track) || qishuiGetArtists(video) || (songMeta && songMeta.artist) || '未知艺人';
    const coverUrl = qishuiGetCover(track) || qishuiGetImageUrl(video.cover_url) || qishuiGetImageUrl(video.image_url) || (songMeta && songMeta.cover) || '';
    const duration = track.duration || video.duration || 0;
    const spadeA = qishuiGetSpadeA(trackPayload);

    // 判断是否为视频内容(基于 contentType)
    const isVideoContent = dlResult.contentType === 'video/mp4';

    // 2. 保存到临时文件, 返回 music:// URL 供渲染进程播放
    let ext;
    if (isVideoContent) ext = 'mp4';
    else if (dlResult.contentType === 'audio/flac') ext = 'flac';
    else if (dlResult.contentType === 'audio/mpeg') ext = 'mp3';
    else ext = 'm4a';
    const tempPath = path.join(os.tmpdir(), `qishui-preview-${trackId}.${ext}`);
    fs.writeFileSync(tempPath, mediaBuffer);
    const playUrl = `music:///${tempPath.replace(/\\/g, '/')}`;

    dbgLog('[QISHUI] preview 媒体处理完成, size=' + mediaBuffer.length + ' ext=' + ext + ' isVideo=' + isVideoContent);

    // 3. 获取歌词 (失败不影响试听)
    let krcRaw = '';
    let lrcText = '';
    try {
      const lyricResult = await qishuiFetchLyrics(trackId, trackPayload);
      // qishuiFetchLyrics 现在直接返回 krcRaw, 无需再调用 krcToRaw
      krcRaw = lyricResult.krcRaw || (lyricResult.krcObj ? krcToRaw(lyricResult.krcObj) : '');
      lrcText = lyricResult.lrcText || '';
    } catch (lyricErr) {
      dbgLog('[QISHUI] preview 歌词获取失败(不影响试听):', lyricErr.message);
    }

    return {
      ok: true,
      data: {
        url: playUrl,
        playAuth: spadeA,
        title,
        artist,
        cover: coverUrl,
        duration,
        krc: krcRaw,
        lrc: lrcText || '',
        lyricist: qishuiGetLyricist(track),
        composer: qishuiGetComposer(track),
        isVideo: isVideoContent,  // 视频类型标记, 渲染进程据此切换 <video> 元素
      },
    };
  } catch (e) {
    dbgErr('[QISHUI] preview 异常:', e.message);
    return { ok: false, message: e.message };
  }
});

// =========== 多账号管理 IPC (与 netease 对齐) ===========

// IPC: 检查登录状态 (自动登录入口)
// 从 config 读取当前账号, 恢复 qishuiSession, 返回用户信息
ipcMain.handle('qishui-login-status', async () => {
  const config = readQishuiConfig();
  const acc = getCurrentQishuiAccount(config);
  if (!acc || !acc.sessionid) {
    dbgLog('[QISHUI] login-status: 无已保存账号, 未登录');
    return { ok: false, loggedIn: false };
  }
  // 恢复 qishuiSession (含完整 cookie, 用于 video_v2 等风控敏感接口)
  setQishuiSession({
    aid: acc.aid || qishuiFixed.aid,
    userid: acc.userid,
    sessionid: acc.sessionid,
    cookie: acc.cookies || '',
  });
  dbgLog('[QISHUI] login-status: 已恢复会话, userId=' + acc.userid + ' nickname=' + acc.nickname + ' cookieLen=' + (acc.cookies || '').length);
  return {
    ok: true,
    loggedIn: true,
    userInfo: {
      userId: acc.userid,
      nickname: acc.nickname || '已登录用户',
      pic: acc.pic || '',
      vipType: acc.vipType || 0,
      aid: acc.aid || qishuiFixed.aid,
      sessionid: acc.sessionid,
    },
  };
});

// IPC: 列出所有已保存账号
ipcMain.handle('qishui-list-accounts', async () => {
  const result = listQishuiAccounts();
  return {
    ok: true,
    accounts: (result.accounts || []).map(a => ({
      userid: a.userid,
      nickname: a.nickname,
      pic: a.pic,
      vipType: a.vipType,
    })),
    currentUserId: result.currentUserId,
  };
});

// IPC: 切换当前账号 (切换后恢复 qishuiSession)
ipcMain.handle('qishui-switch-account', async (event, userid) => {
  const acc = switchQishuiAccount(userid);
  if (!acc) {
    return { ok: false, message: '账号不存在' };
  }
  // 恢复 qishuiSession
  setQishuiSession({
    aid: acc.aid || qishuiFixed.aid,
    userid: acc.userid,
    sessionid: acc.sessionid,
    cookie: acc.cookies || '',
  });
  dbgLog('[QISHUI] switch-account: 已切换到 userId=' + acc.userid);
  return {
    ok: true,
    userInfo: {
      userId: acc.userid,
      nickname: acc.nickname || '已登录用户',
      pic: acc.pic || '',
      vipType: acc.vipType || 0,
      aid: acc.aid || qishuiFixed.aid,
      sessionid: acc.sessionid,
    },
  };
});

// IPC: 删除指定账号
ipcMain.handle('qishui-remove-account', async (event, userid) => {
  const ok = removeQishuiAccount(userid);
  return { ok };
});

// IPC: 退出登录 (保留账号, 仅清除 currentUserId)
ipcMain.handle('qishui-logout', async () => {
  clearQishuiCurrentUser();
  // 清空内存会话
  setQishuiSession({ aid: qishuiFixed.aid, userid: '', sessionid: '', cookie: '' });
  dbgLog('[QISHUI] logout: 已清除当前登录');
  return { ok: true };
});

module.exports = {
  // 仅导出用于装配验证的标记, IPC handlers 在 require 时自注册
  registered: true,
};
