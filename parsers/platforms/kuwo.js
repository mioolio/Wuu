// =========== 酷我音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词/歌单/专辑/推荐
// API 特点: 需要 csrf token (kw_token), 部分接口使用 www/api/www 域名

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');
const { formatLrcTime } = require('../algorithms/lyrics-format');

const HOME_URL = 'https://www.kuwo.cn';
const SEARCH_URL = 'https://www.kuwo.cn/api/www/search/searchMusicBykeyWord';
const SONG_DETAIL_URL = 'https://www.kuwo.cn/api/www/music/musicInfo';
const PLAY_URL = 'https://www.kuwo.cn/api/v1/www/music/playUrl';
const LYRIC_URL = 'https://m.kuwo.cn/newh5/singles/songinfoandlrc';
const PLAYLIST_SEARCH_URL = 'https://www.kuwo.cn/api/www/search/searchPlayListBykeyWord';
const ALBUM_SEARCH_URL = 'https://www.kuwo.cn/api/www/search/searchAlbumBykeyWord';
const PLAYLIST_INFO_URL = 'https://www.kuwo.cn/api/www/playlist/playListInfo';
const ALBUM_INFO_URL = 'https://www.kuwo.cn/api/www/album/albumInfo';
const RECOMMEND_URL = 'https://www.kuwo.cn/api/www/rcm/index/playlist';

// 从 cookie 中提取 kw_token (csrf token)
function getCsrfToken() {
  const cookie = CM.get('kuwo');
  const m = cookie.match(/kw_token=([^;]+)/);
  return m ? m[1] : '';
}

// 确保拥有 csrf token (访问首页获取, kuwo 首页会种 kw_token cookie)
async function ensureToken() {
  if (getCsrfToken()) return;
  const headers = buildHeaders('kuwo');
  try {
    const resp = await fetch(HOME_URL, { headers });
    CM.updateFromResponse('kuwo', resp);
  } catch (e) {}
}

// GET 请求 (带 csrf header)
async function getRequest(url, params = {}) {
  await ensureToken();
  const token = getCsrfToken();
  const headers = buildHeaders('kuwo', {
    csrf: token,
  });
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('kuwo', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  const rid = raw.rid || raw.musicrid || raw.id || '';
  const ridStr = String(rid).replace(/^music_/, '');
  return {
    id: ridStr,
    source: 'kuwo',
    name: raw.name || raw.songName || '',
    artist: raw.artist || raw.singer || '',
    album: raw.album || '',
    cover: raw.pic || raw.pic120 || raw.albumpic || '',
    duration: (raw.duration || 0) * 1000,  // 秒→毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: ridStr ? `https://www.kuwo.cn/play_detail/${ridStr}` : '',
    rid: ridStr,
  };
}

class KuwoParser extends BaseParser {
  constructor() {
    super('kuwo');
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
      recommendedPlaylists: true,
    };
  }

  canParse(shareText) {
    const url = String(shareText || '');
    return /kuwo\.cn|kuwo\.com/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const data = await getRequest(SEARCH_URL, {
      key: keyword,
      pn: page,
      rn: limit,
      httpsStatus: 1,
    });
    if (!data || data.code !== 200) return [];
    const list = (data.data && data.data.list) || [];
    return list.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const m = String(link).match(/play_detail\/(\d+)/)
      || String(link).match(/rid=(\d+)/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const rid = m[1];
    const data = await getRequest(SONG_DETAIL_URL, { mid: rid });
    if (!data || data.code !== 200 || !data.data) {
      throw new Error('获取歌曲详情失败');
    }
    const song = normalizeSong(data.data);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  async getDownloadURL(song) {
    const data = await getRequest(PLAY_URL, {
      mid: song.rid || song.id,
      type: 'music',
      br: '320kmp3',
    });
    if (!data || data.code !== 200 || !data.data) return '';
    return data.data.url || '';
  }

  // ===== 获取歌词 =====
  // kuwo 歌词接口返回 lrclist, 每项 {line, time(秒, 浮点)}
  async getLyrics(song) {
    const data = await getRequest(LYRIC_URL, {
      musicId: song.rid || song.id,
    });
    if (!data || data.status !== 200 || !data.data) return '';
    const list = data.data.lrclist || [];
    if (!list.length) return '';
    return list
      .filter(l => l.line)
      .map(l => {
        const t = parseFloat(l.time || 0);
        return `[${formatLrcTime(t * 1000)}]${l.line}`;
      })
      .join('\n');
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const data = await getRequest(PLAYLIST_SEARCH_URL, {
      key: keyword,
      pn: page,
      rn: limit,
    });
    if (!data || data.code !== 200) return [];
    return (data.data && data.data.list) || [];
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const data = await getRequest(ALBUM_SEARCH_URL, {
      key: keyword,
      pn: page,
      rn: limit,
    });
    if (!data || data.code !== 200) return [];
    return (data.data && data.data.list) || [];
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const data = await getRequest(PLAYLIST_INFO_URL, {
      pid: playlistId,
      pn: page,
      rn: limit,
    });
    if (!data || data.code !== 200) return [];
    return ((data.data && data.data.musicList) || []).map(normalizeSong);
  }

  // ===== 专辑歌曲 =====
  async getAlbumSongs(albumId) {
    const data = await getRequest(ALBUM_INFO_URL, {
      albumId,
      pn: 1,
      rn: 100,
    });
    if (!data || data.code !== 200) return [];
    return ((data.data && data.data.musicList) || []).map(normalizeSong);
  }

  // ===== 推荐歌单 =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const data = await getRequest(RECOMMEND_URL, {
      pn: page,
      rn: limit,
    });
    if (!data || data.code !== 200) return [];
    return (data.data && data.data.list) || [];
  }
}

module.exports = new KuwoParser();
