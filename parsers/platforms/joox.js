// =========== JOOX 解析器 ===========
// 功能: 搜索/链接解析/下载/歌词/歌单/专辑/推荐/分类/扫码登录
// API 特点: 东南亚流行音乐平台(腾讯系), 需 country 参数, 免费版 128k 预览, 完整需 VIP
// 扫码登录后可获取完整码率

const BaseParser = require('../base');
const { buildHeaders, COMMON_UA, MOBILE_UA } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

// JOOX 多区域 API 入口
const API_BASE = 'https://api-jooxtt.sanook.com/web';
const API_BASE_HK = 'https://api-joox.com/web';
const DEFAULT_COUNTRY = 'HK';

function getApiBase() {
  // 根据登录 cookie 中的 country 区域选择 API
  // 默认 HK, 也可由调用方在 song 对象中指定 country
  return API_BASE;
}

function getCountry(song) {
  return (song && song.country) || DEFAULT_COUNTRY;
}

async function getRequest(params, useMobile = false) {
  const headers = buildHeaders('joox', useMobile ? { 'User-Agent': MOBILE_UA } : {});
  const qs = new URLSearchParams({ country: DEFAULT_COUNTRY, ...params }).toString();
  const fullUrl = `${getApiBase()}?${qs}`;
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('joox', resp);
  return resp.json();
}

// JOOX 返回的歌曲条目结构:
// { songId, name, singerList:[{name}], albumName, imgSrc, songDuration, mp3Url, hqUrl, sqUrl, isVipSong }
function normalizeSong(raw) {
  const id = raw.songId || raw.id || '';
  const singers = Array.isArray(raw.singerList) ? raw.singerList : [];
  const artist = singers.map(s => s.name || s).join(' / ');
  const duration = parseInt(raw.songDuration || raw.duration || 0) || 0;
  // 优先级: hq > mp3 (免费版仅 mp3Url 可用)
  const url = raw.mp3Url || raw.hqUrl || raw.sqUrl || '';
  return {
    id: String(id),
    source: 'joox',
    name: raw.name || raw.title || '',
    artist,
    album: raw.albumName || raw.album || '',
    albumId: String(raw.albumId || ''),
    cover: raw.imgSrc || raw.image || '',
    duration,  // 秒
    size: 0,
    bitrate: raw.hqUrl ? 320 : (raw.mp3Url ? 128 : 0),
    ext: 'mp3',
    link: id ? `https://www.joox.com/hk/single/${id}` : '',
    audioUrl: url,
    isVip: !!raw.isVipSong,
  };
}

function normalizePlaylist(raw) {
  return {
    id: String(raw.playlistId || raw.id || ''),
    name: raw.name || raw.title || '',
    cover: raw.imgSrc || raw.image || '',
    count: parseInt(raw.song_count || raw.songCount || 0),
    link: (raw.playlistId || raw.id) ? `https://www.joox.com/hk/playlist/${raw.playlistId || raw.id}` : '',
  };
}

function normalizeAlbum(raw) {
  return {
    id: String(raw.albumId || raw.id || ''),
    name: raw.albumName || raw.name || '',
    artist: raw.artistName || raw.artist || '',
    cover: raw.imgSrc || raw.image || '',
    count: parseInt(raw.song_count || raw.songCount || 0),
    link: (raw.albumId || raw.id) ? `https://www.joox.com/hk/album/${raw.albumId || raw.id}` : '',
  };
}

class JooxParser extends BaseParser {
  constructor() {
    super('joox');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      lyrics: true,
      searchPlaylist: true,
      searchAlbum: true,
      playlistSongs: true,
      albumSongs: true,
      parsePlaylist: true,
      parseAlbum: true,
      recommendedPlaylists: true,
      playlistCategories: true,
      categoryPlaylists: true,
    };
  }

  canParse(shareText) {
    return /joox\.com/i.test(String(shareText || ''));
  }

  // ===== 搜索 =====
  // pos=起始下标, pagesize=每页数量
  async search(keyword, page = 1, limit = 20) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 0,
      search_input: keyword,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(normalizeSong);
  }

  // ===== 链接解析 =====
  // 支持 single/album/playlist 三种链接
  async parseLink(link) {
    const url = String(link);
    const songMatch = url.match(/single\/([A-Za-z0-9]+)/) || url.match(/song\/([A-Za-z0-9]+)/);
    if (songMatch) {
      const song = await this.getSongDetail(songMatch[1]);
      song.url = await this.getDownloadURL(song);
      try { song.lrc = await this.getLyrics(song); } catch (e) {}
      return song;
    }
    const albumMatch = url.match(/album\/([A-Za-z0-9]+)/);
    if (albumMatch) return this.parseAlbum(link);
    const playlistMatch = url.match(/playlist\/([A-Za-z0-9]+)/);
    if (playlistMatch) return this.parsePlaylist(link);
    throw new Error('无法识别 JOOX 链接');
  }

  // ===== 获取歌曲详情 =====
  async getSongDetail(songId) {
    const data = await getRequest({ type: 1, song_id: songId });
    if (!data || !data.result) throw new Error('歌曲不存在');
    return normalizeSong(data.result);
  }

  // ===== 获取下载URL =====
  // 免费版返回 128k 预览, VIP 通过 cookie 获取完整码率
  async getDownloadURL(song) {
    if (song.audioUrl) return song.audioUrl;
    const data = await getRequest({ type: 1, song_id: song.id });
    if (!data || !data.result) return '';
    const item = data.result;
    return item.mp3Url || item.hqUrl || item.sqUrl || '';
  }

  // ===== 获取歌词 =====
  async getLyrics(song) {
    const data = await getRequest({ type: 4, song_id: song.id, lrc: 1 });
    if (!data) return '';
    // JOOX 返回的歌词可能直接是字符串, 也可能包含在 lyric 字段
    return data.lyric || data.lrc || (typeof data.result === 'string' ? data.result : '');
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 5,
      search_input: keyword,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(normalizePlaylist);
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 6,
      search_input: keyword,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(normalizeAlbum);
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 3,
      playlist_id: playlistId,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    // playlist 接口可能返回 { playlist, songs } 或直接是歌曲列表
    if (data.result.songs) return data.result.songs.map(normalizeSong);
    return data.result.map(normalizeSong);
  }

  // ===== 专辑歌曲 =====
  async getAlbumSongs(albumId) {
    const data = await getRequest({ type: 2, album_id: albumId });
    if (!data || !Array.isArray(data.result)) return [];
    if (data.result.songs) return data.result.songs.map(normalizeSong);
    return data.result.map(normalizeSong);
  }

  // ===== 歌单链接解析 =====
  async parsePlaylist(link) {
    const m = String(link).match(/playlist\/([A-Za-z0-9]+)/);
    if (!m) throw new Error('无法从链接中提取歌单ID');
    const songs = await this.getPlaylistSongs(m[1]);
    return { type: 'playlist', id: m[1], songs };
  }

  // ===== 专辑链接解析 =====
  async parseAlbum(link) {
    const m = String(link).match(/album\/([A-Za-z0-9]+)/);
    if (!m) throw new Error('无法从链接中提取专辑ID');
    const songs = await this.getAlbumSongs(m[1]);
    return { type: 'album', id: m[1], songs };
  }

  // ===== 推荐歌单 =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 7,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(normalizePlaylist);
  }

  // ===== 歌单分类 =====
  async getPlaylistCategories() {
    const data = await getRequest({ type: 8 });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(c => ({
      id: String(c.id || c.category_id || ''),
      name: c.name || c.category_name || '',
    }));
  }

  // ===== 分类歌单 =====
  async getCategoryPlaylists(catId, page = 1, limit = 20) {
    const pos = (page - 1) * limit;
    const data = await getRequest({
      type: 9,
      category_id: catId,
      pos: String(pos),
      pagesize: String(limit),
    });
    if (!data || !Array.isArray(data.result)) return [];
    return data.result.map(normalizePlaylist);
  }
}

module.exports = new JooxParser();
