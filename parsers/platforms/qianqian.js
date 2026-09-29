// =========== 千千音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词 (歌单搜索不稳定)
// API 特点: 搜索为 POST, 下载需 tracklink 接口

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const BASE_URL = 'https://music.taihe.com';

// POST 请求
async function postRequest(url, body, cookies = '') {
  const headers = buildHeaders('qianqian', {
    'Content-Type': 'application/json',
  });
  if (cookies) headers['Cookie'] = cookies;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  CM.updateFromResponse('qianqian', resp);
  return resp.json();
}

// GET 请求
async function getRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('qianqian');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('qianqian', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  const id = String(raw.song_id || raw.id || '');
  return {
    id,
    source: 'qianqian',
    name: raw.title || raw.name || '',
    artist: raw.author || raw.artist || '',
    album: raw.album || (raw.albuminfo && raw.albuminfo.title) || '',
    albumId: raw.album_id || '',
    cover: raw.pic || raw.picUrl || '',
    duration: Number(raw.duration || 0),  // 毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: id ? `${BASE_URL}/song/${id}` : '',
  };
}

class QianqianParser extends BaseParser {
  constructor() {
    super('qianqian');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      lyrics: true,
      searchPlaylist: true,  // 接口不稳定
    };
  }

  canParse(shareText) {
    const url = String(shareText || '');
    return /91q\.com|taihe\.com|qianqian/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const cookie = CM.get('qianqian');
    const data = await postRequest(`${BASE_URL}/v1/search`, {
      word: keyword,
      pageNo: page,
      pageSize: limit,
      type: 1,  // 1=单曲
    }, cookie);
    if (!data || data.errno !== 0) return [];
    const songList = (data.data && data.data.song_list) || (data.result && data.result.song_list) || [];
    return songList.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const cookie = CM.get('qianqian');
    const m = String(link).match(/song\/?(\d+)/) || String(link).match(/song_id=(\d+)/) || String(link).match(/(\d{6,})/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const songId = m[1];
    const data = await getRequest(`${BASE_URL}/v1/song/info`, { song_id: songId }, cookie);
    if (!data || data.errno !== 0 || !data.data) throw new Error('获取歌曲详情失败');
    const song = normalizeSong(data.data);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  // 接口返回 result.songlist[0].url
  async getDownloadURL(song) {
    const cookie = CM.get('qianqian');
    const data = await getRequest(`${BASE_URL}/v1/song/tracklink`, { song_id: song.id }, cookie);
    if (!data || data.errno !== 0 || !data.data) return '';
    const list = (data.data && data.data.songlist) || [];
    if (!list.length) return '';
    return list[0].url || list[0].show_link || '';
  }

  // ===== 获取歌词 =====
  async getLyrics(song) {
    const cookie = CM.get('qianqian');
    const data = await getRequest(`${BASE_URL}/v1/song/lrc`, { song_id: song.id }, cookie);
    if (!data || data.errno !== 0 || !data.data) return '';
    return (data.data && data.data.lrc) || (typeof data.data === 'string' ? data.data : '');
  }

  // ===== 歌单搜索 (不稳定) =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const cookie = CM.get('qianqian');
    try {
      const data = await postRequest(`${BASE_URL}/v1/search`, {
        word: keyword,
        pageNo: page,
        pageSize: limit,
        type: 2,  // 2=歌单
      }, cookie);
      if (!data || data.errno !== 0 || !data.data) return [];
      return (data.data && data.data.songlist_list) || [];
    } catch (e) {
      return [];
    }
  }
}

module.exports = new QianqianParser();
