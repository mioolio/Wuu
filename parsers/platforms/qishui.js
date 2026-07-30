// =========== 汽水音乐解析器 ===========
// 从分享链接解析歌曲信息: 页面 HTML 中的 _ROUTER_DATA 包含完整元数据 + 逐字歌词(krc)
// 后端 track/v2 接口返回完整版音频地址 + playAuth 解密密钥
// 继承 BaseParser, 保持与原有接口兼容

const BaseParser = require('../base');

const PARSE_BACKEND = 'http://qiuyu520.fun/qishuiParse/api/track/v2';

// 从分享文本中提取 https:// 链接
function extractShareLink(text) {
  const m = String(text || '').match(/https:\/\/[^\s"'<>\\]+/);
  return m ? m[0] : '';
}

// 从 HTML 中解析 _ROUTER_DATA
function parseRouterDataFromHtml(html) {
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1];
    if (!content.includes('_ROUTER_DATA')) continue;
    const dataMatch = content.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\});/);
    if (dataMatch && dataMatch[1]) {
      try { return JSON.parse(dataMatch[1]); } catch (e) {}
    }
  }
  return null;
}

// 拼接汽水音乐图片资源地址
function getQishuiImageUrl(image) {
  const baseUrl = (image && image.urls && image.urls.find(Boolean)) || '';
  if (!baseUrl) return '';
  if (!image.uri) return baseUrl;
  return `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${image.uri}~${image.template_prefix}-crop-center:720:720.jpg`;
}

// 将 krc 歌词结构转为标准 lrc 文本(行级时间, 丢弃逐字信息)
function formatLrcTime(timeMs) {
  const t = Number.isFinite(timeMs) ? Math.max(timeMs, 0) : 0;
  const mm = Math.floor(t / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  const cc = Math.floor((t % 1000) / 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
function parseLrcFromKrc(lyrics) {
  if (!lyrics || !lyrics.sentences || !lyrics.sentences.length) return '';
  return lyrics.sentences
    .filter(s => s.text)
    .map(s => `[${formatLrcTime(s.startMs)}]${s.text}`)
    .join('\n');
}

// 将 krc 歌词结构转为 raw 逐字格式(供播放器 parseRaw 解析)
// 格式: [startMs,durMs]<offsetMs,durMs,0>字<offsetMs,durMs,0>字...
// tag 在前, 字在后; 悬空 word(text='')输出 <tag> 不带字, 保留时间槽位
// 这样 parseRaw 解析时悬空位置的空 part 会被跳过, 但 tag 时间对齐不错位
function krcToRaw(lyrics) {
  if (!lyrics || !lyrics.sentences || !lyrics.sentences.length) return '';
  const lines = [];
  for (const s of lyrics.sentences) {
    if (!s.words || !s.words.length) continue;
    const startMs = s.startMs;
    const durMs = (s.endMs || 0) - startMs;
    let line = `[${startMs},${durMs}]`;
    for (const w of s.words) {
      const offsetMs = (w.startMs || 0) - startMs;
      const wordDurMs = (w.endMs || 0) - (w.startMs || 0);
      // tag 在前, 字在后; 悬空 word 输出 <tag> 不带字, 保留时间槽位
      line += `<${offsetMs},${wordDurMs},0>${w.text || ''}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// 调用后端 track/v2 接口获取完整版音频信息
async function fetchTrackV2(trackId) {
  const trackIdStr = String(trackId);
  const body = JSON.stringify({
    track_id: trackIdStr,
    media_type: 'track',
    queue_type: 'favorite_track_playlist',
    scene_name: 'undefined',
  });
  const resp = await fetch(PARSE_BACKEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`后端请求失败: ${resp.status} - ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (!json.ok || !json.data) throw new Error(json.message || '获取完整版音频失败');
  return json.data;
}

class QishuiParser extends BaseParser {
  constructor() {
    super('qishui');
    // 汽水音乐: 支持链接解析和下载(通过分享链接), 不支持搜索/歌单等(依赖后端)
    this.capabilities = {
      ...this.capabilities,
      parseLink: true,
      download: true,
      lyrics: true,
    };
  }

  canParse(shareText) {
    const url = extractShareLink(shareText);
    if (!url) return false;
    return /qishui\.douyin\.com|qishui\.com|snssdk\.com.*qishui/i.test(url);
  }

  // 兼容旧接口: parse(shareText)
  async parse(shareText) {
    return this.parseLink(shareText);
  }

  async parseLink(link) {
    const url = extractShareLink(link);
    if (!url) throw new Error('未在输入中找到有效的 https:// 链接');

    const htmlResp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!htmlResp.ok) throw new Error(`页面请求失败: ${htmlResp.status}`);
    const html = await htmlResp.text();

    const routerData = parseRouterDataFromHtml(html);
    if (!routerData) throw new Error('未找到 _ROUTER_DATA, 可能不是汽水音乐分享链接');

    const trackPage = routerData.loaderData && routerData.loaderData.track_page;
    if (!trackPage) throw new Error('页面数据结构异常, 未找到 track_page');

    const audioOpt = trackPage.audioWithLyricsOption;
    if (!audioOpt) throw new Error('未找到音频信息');

    const title = audioOpt.trackName || '未知歌曲';
    const artist = audioOpt.artistName || '未知歌手';
    const album = (audioOpt.trackInfo && audioOpt.trackInfo.album && audioOpt.trackInfo.album.name) || '未知专辑';
    const cover = audioOpt.coverURL || '';

    // 提取作词/作曲: 汽水音乐 _ROUTER_DATA 字段名不固定, 从多个可能位置尝试
    // 常见字段: lyricist/composer, writer/composer, lyrics/music, lyricistName/composerName
    // 也可能位于 trackInfo 内或 audioOpt 内
    const _pick = (...candidates) => {
      for (const v of candidates) {
        if (v && typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };
    const ti = audioOpt.trackInfo || {};
    let lyricist = _pick(
      audioOpt.lyricist, audioOpt.lyricistName, audioOpt.lyricsAuthor,
      ti.lyricist, ti.lyricistName, ti.lyricsAuthor, ti.lyricist_name,
      audioOpt.writer, ti.writer, audioOpt.lyricist_name
    );
    let composer = _pick(
      audioOpt.composer, audioOpt.composerName, audioOpt.musicComposer,
      ti.composer, ti.composerName, ti.musicComposer, ti.composer_name,
      audioOpt.music, ti.music, audioOpt.composer_name
    );

    // 生成 LRC 头部: 补全 [lyricist:]/[composer:] tag, 供播放器后备提取
    const lrcHeader = `[ti:${title}]\n[ar:${artist}]\n[al:${album}]\n${lyricist ? `[lyricist:${lyricist}]\n` : ''}${composer ? `[composer:${composer}]\n` : ''}`;
    const lrc = `${lrcHeader}${parseLrcFromKrc(audioOpt.lyrics)}`;
    const krc = audioOpt.lyrics || null;
    const duration = (audioOpt.trackInfo && audioOpt.trackInfo.duration) || 0;

    let result = { title, artist, album, cover, lrc, krc, duration, lyricist, composer, url: '', playAuth: '', trackId: '', source: 'qishui' };

    const trackId = trackPage.track_id;
    if (trackId) {
      try {
        const full = await fetchTrackV2(trackId);
        result.trackId = String(trackId);
        if (full.url) result.url = full.url;
        if (full.playAuth) result.playAuth = full.playAuth;
        if (full.title) result.title = full.title;
        if (full.artist) result.artist = full.artist;
        if (full.album) result.album = full.album;
        if (full.cover) result.cover = full.cover;
      } catch (e) {
        if (audioOpt.url) result.url = encodeURI(decodeURI(audioOpt.url));
      }
    } else if (audioOpt.url) {
      result.url = encodeURI(decodeURI(audioOpt.url));
    }

    if (!result.url) throw new Error('未解析到音频地址');
    return result;
  }

  // 汽水音乐的下载URL在parseLink时已获取, 直接返回
  async getDownloadURL(song) {
    if (song.url) return song.url;
    if (song.trackId) {
      const full = await fetchTrackV2(song.trackId);
      return full.url || '';
    }
    throw new Error('无法获取下载地址');
  }

  // 歌词在parseLink时已获取
  async getLyrics(song) {
    return song.lrc || '';
  }
}

// 导出单例 + 工具函数(保持向后兼容)
const instance = new QishuiParser();
module.exports = instance;
// 兼容旧导出
module.exports.canParse = (t) => instance.canParse(t);
module.exports.parse = (t) => instance.parse(t);
module.exports.extractShareLink = extractShareLink;
module.exports.parseRouterDataFromHtml = parseRouterDataFromHtml;
module.exports.parseLrcFromKrc = parseLrcFromKrc;
module.exports.krcToRaw = krcToRaw;
module.exports.fetchTrackV2 = fetchTrackV2;
module.exports.formatLrcTime = formatLrcTime;
