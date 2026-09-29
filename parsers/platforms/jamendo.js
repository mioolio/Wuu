// =========== Jamendo 解析器 ===========
// 功能: 搜索/链接解析/下载/歌单/专辑
// API 特点: 开放 API, 需 client_id (CC 授权音乐平台)
// 文档: https://developer.jamendo.com/v3.0
// 默认使用公共 client_id, 可通过 cookie-manager 配置自定义 ID

const BaseParser = require('../base');
const { buildHeaders, COMMON_UA } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const API_BASE = 'https://api.jamendo.com/v3.0';
// 公共测试 client_id, 用户可在 config/cookies.json 中设置 jamendo.client_id 覆盖
const DEFAULT_CLIENT_ID = 'b6747d04';

function getClientId() {
  // 优先使用用户配置的自定义 client_id
  const custom = CM.get('jamendo');
  const m = custom && custom.match(/client_id=([a-f0-9]+)/i);
  return m ? m[1] : DEFAULT_CLIENT_ID;
}

async function getRequest(url, params = {}) {
  const headers = buildHeaders('jamendo');
  const fullParams = { ...params, client_id: getClientId(), format: 'json' };
  const qs = new URLSearchParams(fullParams).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('jamendo', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  const id = raw.id || raw.track_id || '';
  const duration = parseInt(raw.duration || 0) || 0;  // 秒
  return {
    id: String(id),
    source: 'jamendo',
    name: raw.name || raw.track_name || '',
    artist: raw.artist_name || raw.artist || '',
    album: raw.album_name || raw.album || '',
    albumId: String(raw.album_id || ''),
    cover: raw.image || raw.album_image || raw.image_alt || '',
    duration: duration * 1000,  // 转毫秒
    size: 0,
    bitrate: 0,
    ext: 'mp3',
    link: id ? `https://www.jamendo.com/track/${id}` : '',
    audioUrl: raw.audio || raw.audiodownload || '',
  };
}

function normalizePlaylist(raw) {
  return {
    id: String(raw.id || ''),
    name: raw.name || '',
    cover: raw.image || '',
    count: parseInt(raw.tracks_count || 0),
    link: raw.id ? `https://www.jamendo.com/playlist/${raw.id}` : '',
  };
}

function normalizeAlbum(raw) {
  return {
    id: String(raw.id || ''),
    name: raw.name || '',
    artist: raw.artist_name || '',
    cover: raw.image || '',
    count: parseInt(raw.tracks_count || 0),
    link: raw.id ? `https://www.jamendo.com/album/${raw.id}` : '',
  };
}

class JamendoParser extends BaseParser {
  constructor() {
    super('jamendo');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      searchPlaylist: true,
      searchAlbum: true,
      playlistSongs: true,
      albumSongs: true,
      parsePlaylist: true,
      parseAlbum: true,
      recommendedPlaylists: true,
    };
  }

  canParse(shareText) {
    return /jamendo\.com/i.test(String(shareText || ''));
  }

  // ===== 搜索 =====
  // /tracks/?search=keyword&limit=20&offset=0
  async search(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const data = await getRequest(`${API_BASE}/tracks/`, {
      search: keyword,
      limit,
      offset,
      include: 'musicinfo+licenses',
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeSong);
  }

  // ===== 链接解析 =====
  // 支持 track/album/playlist 三种链接
  async parseLink(link) {
    const url = String(link);
    const trackMatch = url.match(/track\/(\d+)/);
    if (trackMatch) {
      const data = await getRequest(`${API_BASE}/tracks/`, { id: trackMatch[1] });
      if (!data || !Array.isArray(data.results) || !data.results.length) {
        throw new Error('歌曲不存在');
      }
      const song = normalizeSong(data.results[0]);
      song.url = await this.getDownloadURL(song);
      return song;
    }
    const albumMatch = url.match(/album\/(\d+)/);
    if (albumMatch) return this.parseAlbum(link);
    const playlistMatch = url.match(/playlist\/(\d+)/);
    if (playlistMatch) return this.parsePlaylist(link);
    throw new Error('无法识别 Jamendo 链接');
  }

  // ===== 获取下载URL =====
  // 直接使用歌曲对象中的 audioUrl, 无需二次请求
  async getDownloadURL(song) {
    if (song.audioUrl) return song.audioUrl;
    const data = await getRequest(`${API_BASE}/tracks/`, { id: song.id });
    if (!data || !Array.isArray(data.results) || !data.results.length) return '';
    const item = data.results[0];
    return item.audio || item.audiodownload || '';
  }

  // ===== 歌词 =====
  // Jamendo 大多为 CC 授权音乐, 不提供歌词接口
  // 抛出 NotSupported 由调用方处理
  async getLyrics() {
    throw new Error('jamendo: 不支持歌词获取');
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const data = await getRequest(`${API_BASE}/playlists/`, {
      search: keyword,
      limit,
      offset,
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizePlaylist);
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const data = await getRequest(`${API_BASE}/albums/`, {
      search: keyword,
      limit,
      offset,
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeAlbum);
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const offset = (page - 1) * limit;
    const data = await getRequest(`${API_BASE}/playlists/tracks/`, {
      id: playlistId,
      limit,
      offset,
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeSong);
  }

  // ===== 专辑歌曲 =====
  async getAlbumSongs(albumId) {
    const data = await getRequest(`${API_BASE}/albums/tracks/`, {
      id: albumId,
      limit: 200,
    });
    if (!data || !Array.isArray(data.results)) return [];
    // results 是专辑数组, 取第一个专辑的 tracks
    const album = data.results[0];
    if (!album || !Array.isArray(album.tracks)) return [];
    return album.tracks.map(normalizeSong);
  }

  // ===== 歌单链接解析 =====
  async parsePlaylist(link) {
    const m = String(link).match(/playlist\/(\d+)/);
    if (!m) throw new Error('无法从链接中提取歌单ID');
    const songs = await this.getPlaylistSongs(m[1]);
    return { type: 'playlist', id: m[1], songs };
  }

  // ===== 专辑链接解析 =====
  async parseAlbum(link) {
    const m = String(link).match(/album\/(\d+)/);
    if (!m) throw new Error('无法从链接中提取专辑ID');
    const songs = await this.getAlbumSongs(m[1]);
    return { type: 'album', id: m[1], songs };
  }

  // ===== 推荐歌单 =====
  // featured=1 返回精选歌单
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const data = await getRequest(`${API_BASE}/playlists/`, {
      featured: 1,
      limit,
      offset,
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizePlaylist);
  }
}

module.exports = new JamendoParser();
