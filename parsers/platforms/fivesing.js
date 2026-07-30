// =========== 5sing 原创音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词/歌单搜索
// API 特点: 搜索返回 songId/songName/singerName, 详情接口含音频地址和歌词

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const SEARCH_URL = 'https://search.5sing.kugou.com';
const SERVICE_URL = 'https://service.5sing.kugou.com';

// GET 请求
async function getRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('fivesing');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('fivesing', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  const id = String(raw.songId || raw.id || '');
  return {
    id,
    source: 'fivesing',
    name: raw.songName || raw.name || '',
    artist: raw.singerName || raw.singer || '',
    album: raw.typeName || raw.album || '',
    albumId: '',
    cover: raw.cover || raw.picUrl || '',
    duration: Number(raw.duration || 0),  // 毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: id ? `${SERVICE_URL}/song/${id}` : '',
  };
}

class FivesingParser extends BaseParser {
  constructor() {
    super('fivesing');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      lyrics: true,
      searchPlaylist: true,
    };
  }

  canParse(shareText) {
    const url = String(shareText || '');
    return /5sing\.com|fivesing/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const cookie = CM.get('fivesing');
    const data = await getRequest(`${SEARCH_URL}/song`, {
      keyword,
      page,
      size: limit,
    }, cookie);
    if (!data) return [];
    // 兼容多种响应结构: { list: [...] } / { data: { list: [...] } } / { data: [...] }
    const list = data.list || (data.data && data.data.list) || data.data || data.result || [];
    return Array.isArray(list) ? list.map(normalizeSong) : [];
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const cookie = CM.get('fivesing');
    // 从链接中提取 songid (5sing 链接通常含数字 ID)
    const m = String(link).match(/song\/(\d+)/) || String(link).match(/songid=(\d+)/) || String(link).match(/(\d{5,})/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const songId = m[1];
    const data = await getRequest(`${SERVICE_URL}/song/getsonginfo`, { songid: songId }, cookie);
    if (!data) throw new Error('获取歌曲详情失败');
    const info = data.data || data;
    const song = normalizeSong(info);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  // 从 getsonginfo 接口获取, 字段: audioUrl (音频) 或 fileUrl
  async getDownloadURL(song) {
    const cookie = CM.get('fivesing');
    const data = await getRequest(`${SERVICE_URL}/song/getsonginfo`, { songid: song.id }, cookie);
    if (!data) return '';
    const info = data.data || data;
    return info.audioUrl || info.fileUrl || info.url || info.playUrl || '';
  }

  // ===== 获取歌词 =====
  // 从 getsonginfo 接口的 lyrics 字段获取
  async getLyrics(song) {
    const cookie = CM.get('fivesing');
    const data = await getRequest(`${SERVICE_URL}/song/getsonginfo`, { songid: song.id }, cookie);
    if (!data) return '';
    const info = data.data || data;
    return info.lyrics || info.lrc || info.lyric || '';
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const cookie = CM.get('fivesing');
    try {
      const data = await getRequest(`${SEARCH_URL}/songlist`, {
        keyword,
        page,
        size: limit,
      }, cookie);
      if (!data) return [];
      return data.list || (data.data && data.data.list) || data.data || [];
    } catch (e) {
      return [];
    }
  }
}

module.exports = new FivesingParser();
