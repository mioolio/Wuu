// =========== 汽水音乐工具函数与会话状态 ===========
// 图片地址拼接 / 时长格式化 / URL 构建 / sessionid 提取
// 艺人/作词/作曲/封面/VIP/可用性提取 / KRC→LRC 转换 / 歌词获取
const parsers = require('../parsers');
const { krcToRaw, parseLrcFromKrc } = parsers;
const { parseRouterDataFromHtml: qishuiParseRouterDataFromHtml } = require('../parsers/platforms/qishui');
const { dbgLog } = require('../core/logger');
const qishuiDecrypt = require('../parsers/qishui-decrypt');
const { fixed: qishuiFixed, endpoints: qishuiEndpoints, downloadTrackMedia: qishuiDownloadTrackMedia, getSessionIdFromSodaMusicCookies } = qishuiDecrypt;
// readSessionIdFromCookieDatabase / readAllCookiesFromDatabase 未从 qishui-decrypt/index.js 导出, 直接从子模块引入
const { readSessionIdFromCookieDatabase, readAllCookiesFromDatabase } = require('../parsers/qishui-decrypt/sodamusic-cookie');

// 汽水音乐会话状态(应用运行期间持久化)
// userid: 用户唯一标识(从 get-profile 返回的 id 提取), 用于多账号管理
// cookie 字段保存完整 cookie 字符串 (含 sessionid, passport_csrf_token, ttwid 等), 用于风控敏感接口
let qishuiSession = { aid: qishuiFixed.aid, userid: '', sessionid: '', cookie: '' };

function getQishuiSession() { return qishuiSession; }
function setQishuiSession(s) {
  // 合并传入字段, 保证 cookie 字段有默认值
  qishuiSession = { aid: qishuiFixed.aid, userid: '', sessionid: '', cookie: '', ...s };
  // 如果没传 cookie 但有 sessionid, 回退到只用 sessionid
  if (!qishuiSession.cookie && qishuiSession.sessionid) {
    qishuiSession.cookie = `sessionid=${qishuiSession.sessionid};`;
  }
}

// 汽水音乐图片地址拼接(对齐 PopDownloader resolveImageUrl)
function qishuiGetImageUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;
  const baseUrl = (image.urls && image.urls.find(Boolean)) || image.url || '';
  const uri = image.uri || '';
  const templatePrefix = image.template_prefix || '';
  if (!baseUrl) return uri;
  if (!uri) return baseUrl;
  // template_prefix 为空时不加 crop 后缀, 否则会变成 ~-crop-center 错误格式
  const templateSuffix = templatePrefix
    ? `~${templatePrefix}-crop-center:800:800.jpg`
    : '';
  if (!baseUrl.includes(uri)) {
    return `${baseUrl}${uri}${templateSuffix}`;
  }
  return `${baseUrl}${templateSuffix}`;
}

// 格式化时长 mm:ss
function qishuiFormatDuration(ms) {
  const t = Number(ms) || 0;
  const mm = Math.floor(t / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// 构建 URL (只拼接调用者显式传入的参数, 不自动合并 qishuiFixed)
// 参考 PopDownloader buildUrl: 数据 API 只接受特定参数, 多余的登录参数会导致返回空数据
function qishuiBuildUrl(url, extraQuery = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(extraQuery)) {
    if (value !== undefined && value !== null && value !== '') {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

// 从响应中提取 sessionid(Set-Cookie 头)
function qishuiExtractSessionid(resp) {
  try {
    if (typeof resp.headers.getSetCookie === 'function') {
      const cookies = resp.headers.getSetCookie();
      for (const sc of cookies) {
        const m = sc.match(/sessionid=([^;]+)/);
        if (m) return m[1];
      }
    }
  } catch (e) {}
  const setCookie = resp.headers.get('set-cookie') || '';
  const m = setCookie.match(/sessionid=([^;]+)/);
  return m ? m[1] : '';
}

// 获取艺人名(对齐 PopDownloader getArtistName: 优先 user_info.nickname)
function qishuiGetArtists(source) {
  const artists = Array.isArray(source?.artists) ? source.artists : [];
  return artists.map(a => a?.user_info?.nickname || a?.nickname || a?.simple_display_name || a?.name || '').filter(Boolean).join(' / ');
}

// 从 track.song_maker_team 提取作词人 (对齐 PopDownloader getNames)
function qishuiGetLyricist(track) {
  const list = Array.isArray(track?.song_maker_team?.lyricists) ? track.song_maker_team.lyricists : [];
  return list.map(item => item?.name || '').filter(Boolean).join(' / ');
}

// 从 track.song_maker_team 提取作曲人 (对齐 PopDownloader getNames)
function qishuiGetComposer(track) {
  const list = Array.isArray(track?.song_maker_team?.composers) ? track.song_maker_team.composers : [];
  return list.map(item => item?.name || '').filter(Boolean).join(' / ');
}

// 从 track_v2 payload 提取 spade_a(PlayAuth)
function qishuiGetSpadeA(trackPayload) {
  try {
    const videoModelRaw = trackPayload?.track_player?.video_model;
    if (!videoModelRaw) return '';
    const videoModel = typeof videoModelRaw === 'string' ? JSON.parse(videoModelRaw) : videoModelRaw;
    const videoList = Array.isArray(videoModel?.video_list) ? videoModel.video_list : [];
    for (const item of videoList) {
      if (item?.encrypt_info?.spade_a) return item.encrypt_info.spade_a;
    }
  } catch (e) {}
  return '';
}

// 从 track 对象提取封面
function qishuiGetCover(track) {
  if (!track) return '';
  const album = track.album || {};
  if (album.url_cover) return qishuiGetImageUrl(album.url_cover);
  if (album.cover) return qishuiGetImageUrl(album.cover);
  if (track.url_cover) return qishuiGetImageUrl(track.url_cover);
  if (track.cover) return qishuiGetImageUrl(track.cover);
  return '';
}

// 判断 track 是否需要 VIP (对齐 PopDownloader getTrackPermission)
function qishuiIsVipTrack(track) {
  if (!track) return false;
  if (track?.label_info?.only_vip_playable) return true;
  // 检查所有可用音质是否都需要 VIP
  const qualityMap = track?.label_info?.quality_map || {};
  const availableQualities = Array.isArray(track?.bit_rates)
    ? track.bit_rates.map(item => item?.quality).filter(Boolean)
    : [];
  if (availableQualities.length === 0) return false;
  return availableQualities.every(quality => {
    const playDetail = qualityMap?.[quality]?.play_detail;
    return Boolean(playDetail?.need_vip);
  });
}

// 判断 track 是否不可用
function qishuiIsUnavailable(track) {
  if (track?.status === 10) return true;
  const album = track?.album || {};
  if (String(album.id) === '0' && !album.name) return true;
  return false;
}

// KRC 字符串转 LRC 文本
// 输入格式: [startMs,durMs]<offset,dur,0>字<offset,dur,0>字...
// 输出格式: [mm:ss.cc]字字字...
function qishuiKrcContentToLrc(content) {
  if (!content || typeof content !== 'string') return '';
  const lines = content.split(/\r?\n/);
  const lrcLines = [];
  for (const line of lines) {
    const lineMatch = line.match(/^\[(\d+),(\d+)\]/);
    if (!lineMatch) continue;
    const startMs = parseInt(lineMatch[1], 10);
    // 提取所有字: <...>字
    const words = line.match(/<[^>]*>([^<]*)/g) || [];
    const text = words.map(w => w.replace(/^<[^>]*>/, '')).join('');
    if (!text) continue;
    const mm = Math.floor(startMs / 60000);
    const ss = Math.floor((startMs % 60000) / 1000);
    const cc = Math.floor((startMs % 1000) / 10);
    const timeStr = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
    lrcLines.push(`[${timeStr}]${text}`);
  }
  return lrcLines.join('\n');
}

// 获取歌词: 优先从 trackPayload.lyric.content 提取 (KRC 字符串), 回退到 sentences 对象, 再回退到 HTML
async function qishuiFetchLyrics(trackId, trackPayload) {
  let krcRaw = '';
  let lrcText = '';

  // 1. 优先: trackPayload.lyric.content (KRC 字符串格式, track_v2 直接返回)
  const lyricContent = trackPayload?.lyric?.content || trackPayload?.lyrics?.content;
  if (lyricContent && typeof lyricContent === 'string') {
    // lyric.content 就是 krcToRaw 输出的格式, 直接使用
    krcRaw = lyricContent;
    lrcText = qishuiKrcContentToLrc(lyricContent);
    dbgLog('[QISHUI] 歌词获取成功: 从 lyric.content 提取, krcRaw 长度=' + krcRaw.length + ' lrc 行数=' + lrcText.split('\n').length);
    return { krcObj: null, lrcText, krcRaw };
  }

  // 2. 回退: trackPayload.lyrics.sentences (对象格式)
  const lyricsData = trackPayload?.track?.lyrics || trackPayload?.lyrics || trackPayload?.track_player?.lyrics;
  if (lyricsData && lyricsData.sentences) {
    krcRaw = krcToRaw(lyricsData);
    lrcText = parseLrcFromKrc(lyricsData);
    dbgLog('[QISHUI] 歌词获取成功: 从 lyrics.sentences 提取');
    return { krcObj: lyricsData, lrcText, krcRaw };
  }

  // 3. 回退: 抓取 track 页面 HTML 解析 _ROUTER_DATA
  try {
    const shareUrl = trackPayload?.track?.share_url || trackPayload?.track?.web_url || `https://www.qishui.com/track/${trackId}`;
    dbgLog('[QISHUI] 歌词回退: 抓取页面 HTML, url=' + shareUrl);
    const htmlResp = await fetch(shareUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    if (htmlResp.ok) {
      const html = await htmlResp.text();
      const routerData = qishuiParseRouterDataFromHtml(html);
      if (routerData) {
        const trackPage = routerData.loaderData && routerData.loaderData.track_page;
        const audioOpt = trackPage && trackPage.audioWithLyricsOption;
        if (audioOpt && audioOpt.lyrics) {
          if (audioOpt.lyrics.content) {
            krcRaw = audioOpt.lyrics.content;
            lrcText = qishuiKrcContentToLrc(audioOpt.lyrics.content);
          } else if (audioOpt.lyrics.sentences) {
            krcRaw = krcToRaw(audioOpt.lyrics);
            lrcText = parseLrcFromKrc(audioOpt.lyrics);
          }
          dbgLog('[QISHUI] 歌词获取成功: 从 HTML 页面提取');
          return { krcObj: audioOpt.lyrics, lrcText, krcRaw };
        }
      }
    }
  } catch (e) {
    dbgLog('[QISHUI] 歌词获取异常:', e.message);
  }

  dbgLog('[QISHUI] 歌词获取失败: 未找到歌词数据');
  return { krcObj: null, lrcText: '', krcRaw: '' };
}

module.exports = {
  qishuiFixed, qishuiEndpoints,
  qishuiDownloadTrackMedia, getSessionIdFromSodaMusicCookies, readSessionIdFromCookieDatabase, readAllCookiesFromDatabase,
  getQishuiSession, setQishuiSession,
  qishuiGetImageUrl, qishuiFormatDuration, qishuiBuildUrl, qishuiExtractSessionid,
  qishuiGetArtists, qishuiGetLyricist, qishuiGetComposer, qishuiGetSpadeA, qishuiGetCover,
  qishuiIsVipTrack, qishuiIsUnavailable, qishuiKrcContentToLrc, qishuiFetchLyrics,
};
