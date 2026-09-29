// =========== Apple Music 解析器 ===========
// 功能: 搜索/链接解析/下载(预览)/专辑
// API 特点: 公开 iTunes Search API 无需认证, 但仅返回 30s 预览(DRM 保护)
// 完整歌曲下载需 Apple Music 订阅 + JWT token, 这里只实现公开预览能力
// 文档: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/

const BaseParser = require('../base');
const { buildHeaders, COMMON_UA } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

async function getRequest(url, params = {}) {
  const headers = buildHeaders('apple');
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('apple', resp);
  return resp.json();
}

// 统一歌曲对象
// iTunes 返回字段: trackId, trackName, artistName, collectionName, collectionId,
//   artworkUrl100, trackTimeMillis, previewUrl, trackViewUrl
function normalizeSong(raw) {
  const id = raw.trackId || raw.id || '';
  const duration = parseInt(raw.trackTimeMillis || raw.durationInMillis || 0) || 0;
  return {
    id: String(id),
    source: 'apple',
    name: raw.trackName || raw.name || '',
    artist: raw.artistName || raw.artist || '',
    album: raw.collectionName || raw.album || '',
    albumId: String(raw.collectionId || ''),
    cover: (raw.artworkUrl100 || raw.artworkUrl || '').replace('100x100', '300x300'),
    duration,  // 毫秒
    size: 0,
    bitrate: 128,
    ext: 'm4a',
    link: raw.trackViewUrl || (id ? `https://music.apple.com/song/${id}` : ''),
    audioUrl: raw.previewUrl || '',
    isPreview: true,  // 标记为预览版
  };
}

function normalizeAlbum(raw) {
  return {
    id: String(raw.collectionId || raw.id || ''),
    name: raw.collectionName || raw.name || '',
    artist: raw.artistName || raw.artist || '',
    cover: (raw.artworkUrl100 || raw.artworkUrl || '').replace('100x100', '300x300'),
    count: parseInt(raw.trackCount || 0),
    link: raw.collectionViewUrl || (raw.collectionId ? `https://music.apple.com/album/${raw.collectionId}` : ''),
  };
}

class AppleParser extends BaseParser {
  constructor() {
    super('apple');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      searchAlbum: true,
      albumSongs: true,
      parseAlbum: true,
    };
  }

  canParse(shareText) {
    return /music\.apple\.com|itunes\.apple\.com/i.test(String(shareText || ''));
  }

  // ===== 搜索 =====
  // entity=song 搜索单曲, country 默认 US
  async search(keyword, page = 1, limit = 20) {
    // iTunes Search API 不支持 offset 翻页超过 200, 这里做限制
    const offset = Math.min((page - 1) * limit, 200);
    const data = await getRequest(SEARCH_URL, {
      term: keyword,
      media: 'music',
      entity: 'song',
      limit: String(limit),
      offset: String(offset),
      country: 'US',
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeSong);
  }

  // ===== 链接解析 =====
  // 支持 song/album 两种链接
  async parseLink(link) {
    const url = String(link);
    // 提取 id: music.apple.com/{country}/song/{id} 或 album/{id}
    const songMatch = url.match(/song\/(\d+)/) || url.match(/\?i=(\d+)/);
    if (songMatch) {
      const data = await getRequest(LOOKUP_URL, { id: songMatch[1] });
      if (!data || !Array.isArray(data.results) || !data.results.length) {
        throw new Error('歌曲不存在');
      }
      const song = normalizeSong(data.results[0]);
      song.url = await this.getDownloadURL(song);
      return song;
    }
    const albumMatch = url.match(/album\/(?:[^\/]+\/)?(\d+)/) || url.match(/album\/(\d+)/);
    if (albumMatch) return this.parseAlbum(link);
    throw new Error('无法识别 Apple Music 链接');
  }

  // ===== 获取下载URL =====
  // 公开 API 仅返回 30s 预览 URL (m4a 格式)
  // 完整歌曲需要 Apple Music 订阅 + MusicKit JWT token (此处不实现)
  async getDownloadURL(song) {
    if (song.audioUrl) return song.audioUrl;
    const data = await getRequest(LOOKUP_URL, { id: song.id });
    if (!data || !Array.isArray(data.results) || !data.results.length) return '';
    return data.results[0].previewUrl || '';
  }

  // ===== 歌词 =====
  // Apple Music 歌词需要 MusicKit JWT, 公开 API 不支持
  async getLyrics() {
    throw new Error('apple: 不支持歌词获取(需 MusicKit JWT)');
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const offset = Math.min((page - 1) * limit, 200);
    const data = await getRequest(SEARCH_URL, {
      term: keyword,
      media: 'music',
      entity: 'album',
      limit: String(limit),
      offset: String(offset),
      country: 'US',
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeAlbum);
  }

  // ===== 专辑歌曲 =====
  // lookup 接口传入专辑 id, 返回专辑信息 + 所有歌曲
  async getAlbumSongs(albumId) {
    const data = await getRequest(LOOKUP_URL, { id: albumId, entity: 'song' });
    if (!data || !Array.isArray(data.results)) return [];
    // 第一个是专辑本身, 后续是歌曲
    return data.results.slice(1).map(normalizeSong).filter(s => s.name);
  }

  // ===== 专辑链接解析 =====
  async parseAlbum(link) {
    const m = String(link).match(/album\/(?:[^\/]+\/)?(\d+)/) || String(link).match(/album\/(\d+)/);
    if (!m) throw new Error('无法从链接中提取专辑ID');
    const songs = await this.getAlbumSongs(m[1]);
    return { type: 'album', id: m[1], songs };
  }
}

module.exports = new AppleParser();
