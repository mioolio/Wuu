// =========== 网易云音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词(逐字)/歌单/专辑/推荐/分类/用户歌单/扫码登录
// 参考开源项目: NeteaseCloudMusicApi, go-music-dl/music-lib

const BaseParser = require('../base');
const { weapi, eapi } = require('./netease-crypto');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');
const { formatLrcTime } = require('../algorithms/lyrics-format');

const BASE_URL = 'https://music.163.com';

// weapi POST 请求
async function weapiRequest(url, data, cookies = '') {
  const headers = buildHeaders('netease', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': BASE_URL,
  });
  if (cookies) headers['Cookie'] = cookies;
  const { params, encSecKey } = weapi(data);
  const body = new URLSearchParams({ params, encSecKey }).toString();
  const resp = await fetch(BASE_URL + url, {
    method: 'POST',
    headers,
    body,
  });
  CM.updateFromResponse('netease', resp);
  return resp.json();
}

// eapi POST 请求 (用于获取播放URL等)
async function eapiRequest(url, endpoint, data, cookies = '') {
  const headers = buildHeaders('netease', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': BASE_URL,
  });
  if (cookies) headers['Cookie'] = cookies;
  const encData = eapi(endpoint, data);
  const body = new URLSearchParams({ params: encData }).toString();
  const resp = await fetch(BASE_URL + url, {
    method: 'POST',
    headers,
    body,
  });
  CM.updateFromResponse('netease', resp);
  return resp.json();
}

// GET 请求 (用于部分无需加密的接口)
async function getRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('netease');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = BASE_URL + url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('netease', resp);
  return resp.json();
}

// 从响应中提取歌曲对象, 统一字段
function normalizeSong(raw) {
  return {
    id: String(raw.id || ''),
    source: 'netease',
    name: raw.name || raw.songName || '',
    artist: raw.ar ? (Array.isArray(raw.ar) ? raw.ar.map(a => a.name).join('/') : raw.ar)
      : raw.artists ? raw.artists.map(a => a.name).join('/')
      : '',
    album: raw.al ? (raw.al.name || '') : raw.album ? (raw.album.name || '') : '',
    albumId: raw.al ? (raw.al.id || '') : raw.album ? (raw.album.id || '') : '',
    cover: raw.al ? (raw.al.picUrl || '') : raw.album ? (raw.album.picUrl || '') : raw.picUrl || '',
    duration: raw.dt || raw.duration || 0,  // 毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: raw.id ? `https://music.163.com/#/song?id=${raw.id}` : '',
  };
}

class NeteaseParser extends BaseParser {
  constructor() {
    super('netease');
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
    const url = String(shareText || '');
    return /music\.163\.com|163\.com\/#\/song|163\.com\/#\/playlist|163\.com\/#\/album/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const cookie = CM.get('netease');
    const data = await weapiRequest('/weapi/cloudsearch/get/web', {
      s: keyword,
      type: 1,  // 1=单曲
      offset,
      total: true,
      limit,
    }, cookie);
    if (!data || data.code !== 200) return [];
    const songs = (data.result && data.result.songs) || [];
    return songs.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const m = String(link).match(/id=(\d+)/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const songId = m[1];
    const cookie = CM.get('netease');
    const data = await getRequest('/api/song/detail', { ids: `[${songId}]` }, cookie);
    if (!data || data.code !== 200 || !data.songs || !data.songs.length) {
      throw new Error('获取歌曲详情失败');
    }
    const song = normalizeSong(data.songs[0]);
    // 获取下载URL
    const urlInfo = await this.getDownloadURL(song);
    song.url = urlInfo;
    // 获取歌词
    try {
      song.lrc = await this.getLyrics(song);
    } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  async getDownloadURL(song) {
    const cookie = CM.get('netease');
    // 优先尝试 weapi 接口 (支持更多音质)
    try {
      const data = await weapiRequest('/weapi/song/enhance/player/url/v1', {
        ids: `[${song.id}]`,
        level: 'exhigh',  // 极高音质
        encodeType: 'aac',
      }, cookie);
      if (data && data.code === 200 && data.data && data.data.length) {
        const d = data.data[0];
        if (d.url) return d.url;
      }
    } catch (e) {}
    // 回退到 eapi 接口
    try {
      const data = await eapiRequest('/api/song/enhance/player/url', '/api/song/enhance/player/url', {
        ids: `[${song.id}]`,
        br: 320000,
      }, cookie);
      if (data && data.code === 200 && data.data && data.data.length) {
        return data.data[0].url || '';
      }
    } catch (e) {}
    return '';
  }

  // ===== 获取歌词 (含逐字歌词) =====
  async getLyrics(song) {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/song/lyric', {
      id: song.id,
      tv: -1,
      lv: -1,
      kv: -1,
      yv: -1,
      ytv: -1,
    }, cookie);
    if (!data || data.code !== 200) return '';
    // 原文歌词
    const lrc = data.lrc ? data.lrc.lyric : '';
    // 逐字歌词 (yrc 格式, 网易云的逐字格式)
    const yrc = data.yrc ? data.yrc.lyric : '';
    if (yrc) {
      // 转换为我们的 raw 格式
      return this._yrcToLrc(yrc, lrc);
    }
    return lrc;
  }

  // 将网易云 yrc 逐字歌词转换为标准 LRC + raw 格式
  // yrc 格式: [startMs,durMs]字<offsetMs,durMs,0>... (与我们的 raw 格式相似)
  _yrcToLrc(yrc, fallbackLrc) {
    // yrc 实际是 JSON 数组格式, 每行: {time:ms, duration:ms, lyric:"...", contents:[{charContent, time, duration}]}
    // 但直接传输是文本格式, 这里解析文本
    try {
      const lines = yrc.split('\n');
      const lrcLines = [];
      for (const line of lines) {
        // 匹配 [startMs,durMs] 后跟内容
        const m = line.match(/^\[(\d+),(\d+)\](.*)/);
        if (!m) continue;
        const startMs = parseInt(m[1]);
        const content = m[3] || '';
        // 提取纯文本 (去掉 <...> 标记)
        const text = content.replace(/<[^>]+>/g, '');
        if (text.trim()) {
          lrcLines.push(`[${formatLrcTime(startMs)}]${text}`);
        }
      }
      return lrcLines.length ? lrcLines.join('\n') : fallbackLrc;
    } catch (e) {
      return fallbackLrc || lrc;
    }
  }

  // 获取原始逐字歌词数据 (供下载时生成 lyrics_raw.txt)
  async getKaraokeLyrics(song) {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/song/lyric', {
      id: song.id,
      tv: -1, lv: -1, kv: -1, yv: -1, ytv: -1,
    }, cookie);
    if (!data || data.code !== 200 || !data.yrc) return null;
    return data.yrc.lyric;
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const cookie = CM.get('netease');
    const data = await weapiRequest('/weapi/cloudsearch/get/web', {
      s: keyword,
      type: 1000,  // 1000=歌单
      offset,
      total: true,
      limit,
    }, cookie);
    if (!data || data.code !== 200) return [];
    return (data.result && data.result.playlists) || [];
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const cookie = CM.get('netease');
    const data = await weapiRequest('/weapi/cloudsearch/get/web', {
      s: keyword,
      type: 10,  // 10=专辑
      offset,
      total: true,
      limit,
    }, cookie);
    if (!data || data.code !== 200) return [];
    return (data.result && data.result.albums) || [];
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/playlist/detail', {
      id: playlistId,
      n: limit,
    }, cookie);
    if (!data || data.code !== 200) return [];
    return (data.playlist && data.playlist.tracks || []).map(normalizeSong);
  }

  // ===== 专辑歌曲 =====
  async getAlbumSongs(albumId) {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/album', { id: albumId }, cookie);
    if (!data || data.code !== 200) return [];
    return (data.songs || []).map(normalizeSong);
  }

  // ===== 歌单链接解析 =====
  async parsePlaylist(link) {
    const m = String(link).match(/id=(\d+)/);
    if (!m) throw new Error('无法从链接中提取歌单ID');
    const songs = await this.getPlaylistSongs(m[1]);
    return { id: m[1], songs };
  }

  // ===== 专辑链接解析 =====
  async parseAlbum(link) {
    const m = String(link).match(/id=(\d+)/);
    if (!m) throw new Error('无法从链接中提取专辑ID');
    const songs = await this.getAlbumSongs(m[1]);
    return { id: m[1], songs };
  }

  // ===== 推荐歌单 =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/personalized/playlist', {
      limit,
      offset: (page - 1) * limit,
    }, cookie);
    if (!data || data.code !== 200) return [];
    return data.result || [];
  }

  // ===== 歌单分类 =====
  async getPlaylistCategories() {
    const cookie = CM.get('netease');
    const data = await getRequest('/api/playlist/catalogue', {}, cookie);
    if (!data || data.code !== 200) return [];
    return (data.sub && data.sub.map(c => ({
      id: c.name,
      name: c.name,
      category: c.category,
    }))) || [];
  }

  // ===== 分类歌单 =====
  async getCategoryPlaylists(catId, page = 1, limit = 20) {
    const cookie = CM.get('netease');
    const offset = (page - 1) * limit;
    const data = await getRequest('/api/playlist/list', {
      cat: catId,
      order: 'hot',
      limit,
      offset,
      total: true,
    }, cookie);
    if (!data || data.code !== 200) return [];
    return (data.playlists || []).map(p => ({
      id: p.id,
      name: p.name,
      cover: p.coverImgUrl,
      count: p.trackCount,
      creator: p.creator ? p.creator.nickname : '',
    }));
  }
}

module.exports = new NeteaseParser();
