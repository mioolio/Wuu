// =========== 哔哩哔哩解析器 ===========
// 功能: 搜索/链接解析/下载/扫码登录 (B站视频无歌词)
// 通过视频 API 提取音频流 (DASH 格式 audio 部分)
// 参考: B站开放接口 api.bilibili.com

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const BASE_URL = 'https://api.bilibili.com';

// GET 请求
async function getRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('bilibili');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('bilibili', resp);
  return resp.json();
}

// 解析时长: B站搜索返回 "mm:ss" 或 "hh:mm:ss" 字符串, 视频详情返回秒(number)
function parseDuration(dur) {
  if (typeof dur === 'number') return dur;
  if (typeof dur === 'string') {
    const parts = dur.split(':');
    if (parts.length === 3) {
      // hh:mm:ss
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    }
    if (parts.length === 2) {
      // mm:ss
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return parseInt(dur, 10) || 0;
  }
  return 0;
}

// 统一歌曲对象
function normalizeSong(raw) {
  const bvid = raw.bvid || '';
  const pic = raw.pic || '';
  return {
    id: bvid,
    source: 'bilibili',
    name: raw.title ? String(raw.title).replace(/<[^>]+>/g, '') : '',  // 搜索结果高亮含 em 标签
    artist: raw.owner ? (raw.owner.name || '') : (raw.author || ''),
    album: '',
    albumId: '',
    cover: pic ? (pic.startsWith('//') ? 'https:' + pic : pic) : '',
    duration: parseDuration(raw.duration) * 1000,  // 秒→毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: bvid ? `https://www.bilibili.com/video/${bvid}` : '',
    bvid,
    cid: raw.cid || 0,
  };
}

class BilibiliParser extends BaseParser {
  constructor() {
    super('bilibili');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      lyrics: false,  // B站视频无歌词
    };
  }

  canParse(shareText) {
    const url = String(shareText || '');
    return /bilibili\.com|b23\.tv/i.test(url);
  }

  // ===== 搜索 (视频搜索, 提取音频) =====
  async search(keyword, page = 1, limit = 20) {
    const cookie = CM.get('bilibili');
    const data = await getRequest(`${BASE_URL}/x/web-interface/search/type`, {
      search_type: 'video',
      keyword,
      page,
      page_size: limit,
    }, cookie);
    if (!data || data.code !== 0) return [];
    const result = data.data && data.data.result;
    if (!result || !Array.isArray(result)) return [];
    return result.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const cookie = CM.get('bilibili');
    // 从链接中提取 bvid (支持 BV 开头)
    const m = String(link).match(/BV\w+/i);
    if (!m) throw new Error('无法从链接中提取 BVID');
    const bvid = m[0].toUpperCase();
    // 获取视频详情 (含 cid)
    const data = await getRequest(`${BASE_URL}/x/web-interface/view`, { bvid }, cookie);
    if (!data || data.code !== 0 || !data.data) {
      throw new Error('获取视频详情失败');
    }
    const v = data.data;
    const song = normalizeSong({
      bvid: v.bvid,
      title: v.title,
      pic: v.pic,
      owner: v.owner,
      duration: v.duration,
      cid: v.cid,
    });
    // 获取下载URL
    song.url = await this.getDownloadURL(song);
    return song;
  }

  // ===== 获取下载URL =====
  // 需要先获取 cid, 再获取 playurl, 从 dash.audio 中取 URL
  async getDownloadURL(song) {
    const cookie = CM.get('bilibili');
    let cid = song.cid;
    // 没有 cid 时通过 view 接口获取
    if (!cid && song.bvid) {
      const view = await getRequest(`${BASE_URL}/x/web-interface/view`, { bvid: song.bvid }, cookie);
      if (!view || view.code !== 0 || !view.data) return '';
      cid = view.data.cid;
    }
    if (!cid) return '';
    // 获取 playurl (DASH 格式)
    const data = await getRequest(`${BASE_URL}/x/player/playurl`, {
      bvid: song.bvid,
      cid,
      qn: 64,
      fnval: 16,  // 请求 DASH 格式
    }, cookie);
    if (!data || data.code !== 0 || !data.data) return '';
    const dash = data.data.dash;
    if (!dash || !dash.audio || !dash.audio.length) {
      // 回退: 尝试 durl 格式
      const durl = data.data.durl;
      if (durl && durl.length) return durl[0].url || '';
      return '';
    }
    // dash.audio 已按 bandwidth 降序排列, 取第一个(最高音质)
    return dash.audio[0].url || '';
  }
}

module.exports = new BilibiliParser();
