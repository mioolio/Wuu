// =========== 酷狗音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词(逐字)/歌单/推荐/扫码登录
// API 特点: hash + album_id 标识歌曲, 下载通过 getdata 接口获取
// 参考开源项目: go-music-dl, kugou-music-api

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const SEARCH_URL = 'https://complexsearch.kugou.com/v2/search/song';
const SPECIAL_SEARCH_URL = 'https://complexsearch.kugou.com/v2/search/special';
const PLAYDATA_URL = 'https://wwwapi.kugou.com/yy/index.php';
const LYRIC_SEARCH_URL = 'https://krcs.kugou.com/search';
const LYRIC_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';
const RANK_LIST_URL = 'https://mobilecdnbj.kugou.com/api/v3/rank/list';
const RANK_SONG_URL = 'https://mobilecdnbj.kugou.com/api/v3/rank/song';

// GET 请求
async function getRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('kugou');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('kugou', resp);
  return resp.json();
}

// 解码 HTML 实体并清除高亮标签 (搜索结果 <em>...</em>)
function decodeEntities(s) {
  return String(s || '')
    .replace(/<\/?em>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// 统一歌曲对象
// 兼容搜索接口 (FileHash/SongName...) 和 getdata 接口 (hash/song_name...) 两种字段命名
function normalizeSong(raw) {
  const hash = raw.FileHash || raw.hash || raw.HQFileHash || raw.SQFileHash || '';
  const albumId = raw.AlbumID || raw.album_id || raw.albumid || '';
  const durationSec = raw.Duration || raw.time_length || 0;
  return {
    id: String(hash),
    source: 'kugou',
    name: decodeEntities(raw.SongName || raw.song_name || raw.songname || raw.FileName || ''),
    artist: decodeEntities(raw.SingerName || raw.author_name || raw.singername || ''),
    album: decodeEntities(raw.AlbumName || raw.album_name || raw.albumname || ''),
    albumId: String(albumId),
    cover: raw.sizable_cover ? raw.sizable_cover.replace('{size}', '480')
      : (raw.image || raw.img || ''),
    duration: durationSec * 1000,  // 秒→毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: hash ? `https://www.kugou.com/song/#hash=${hash}&album_id=${albumId}` : '',
    hash,
    albumId,
  };
}

class KugouParser extends BaseParser {
  constructor() {
    super('kugou');
    this.capabilities = {
      ...this.capabilities,
      search: true,
      parseLink: true,
      download: true,
      lyrics: true,
      searchPlaylist: true,
      playlistSongs: true,
      recommendedPlaylists: true,
    };
  }

  canParse(shareText) {
    const url = String(shareText || '');
    return /kugou\.com/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const cookie = CM.get('kugou');
    const data = await getRequest(SEARCH_URL, {
      keyword,
      page,
      pagesize: limit,
      showtype: 10,
    }, cookie);
    if (!data || data.status !== 1) return [];
    const list = (data.data && data.data.lists) || [];
    return list.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const text = String(link || '');
    const hashMatch = text.match(/hash=([A-Za-z0-9]+)/);
    if (!hashMatch) throw new Error('无法从链接中提取歌曲hash');
    const hash = hashMatch[1];
    const albumMatch = text.match(/album_id=([^&\s]+)/);
    const albumId = albumMatch ? albumMatch[1] : '';
    const song = await this._getSongDetail(hash, albumId);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取歌曲详情 (getdata 接口) =====
  async _getSongDetail(hash, albumId = '') {
    const cookie = CM.get('kugou');
    const data = await getRequest(PLAYDATA_URL, {
      r: 'play/getdata',
      hash,
      album_id: albumId,
      dfid: '2SSg0b2Rsv0E0WqCew3W7Dnx',
      appid: 1014,
      mid: 'xxxx',
      stat: 1,
      format: 'json',
      cdn_ssl: 1,
    }, cookie);
    if (!data || data.status !== 1 || !data.data) {
      throw new Error('获取歌曲详情失败');
    }
    return normalizeSong(data.data);
  }

  // ===== 获取下载URL =====
  async getDownloadURL(song) {
    const cookie = CM.get('kugou');
    try {
      const data = await getRequest(PLAYDATA_URL, {
        r: 'play/getdata',
        hash: song.hash || song.id,
        album_id: song.albumId || '',
        dfid: '2SSg0b2Rsv0E0WqCew3W7Dnx',
        appid: 1014,
        mid: 'xxxx',
        stat: 1,
        format: 'json',
        cdn_ssl: 1,
      }, cookie);
      if (data && data.status === 1 && data.data) {
        return data.data.url || data.data.play_url || '';
      }
    } catch (e) {}
    return '';
  }

  // ===== 获取歌词 (含逐字 krc) =====
  // 流程: 1.通过 hash+duration 搜索歌词候选 → 2.下载 LRC/KRC 内容 (base64)
  async getLyrics(song) {
    const cookie = CM.get('kugou');
    const hash = song.hash || song.id;
    const duration = song.duration ? Math.floor(song.duration / 1000) : 0;
    // 1. 搜索歌词
    const searchData = await getRequest(LYRIC_SEARCH_URL, {
      ver: 1,
      man: 'no',
      client: 'mobi',
      hash,
      duration,
    }, cookie);
    if (!searchData || searchData.status !== 200
      || !searchData.candidates || !searchData.candidates.length) {
      return '';
    }
    const cand = searchData.candidates[0];
    // 2. 下载歌词 (优先 lrc 格式)
    const dlData = await getRequest(LYRIC_DOWNLOAD_URL, {
      ver: 1,
      client: 'pc',
      id: cand.id,
      hash: cand.hash || hash,
      fmt: 'lrc',
      charset: 'utf8',
    }, cookie);
    if (dlData && dlData.status === 200 && dlData.content) {
      try {
        return Buffer.from(dlData.content, 'base64').toString('utf-8');
      } catch (e) {
        return dlData.content;
      }
    }
    return '';
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const cookie = CM.get('kugou');
    const data = await getRequest(SPECIAL_SEARCH_URL, {
      keyword,
      page,
      pagesize: limit,
      showtype: 10,
    }, cookie);
    if (!data || data.status !== 1) return [];
    return (data.data && data.data.lists) || [];
  }

  // ===== 歌单歌曲 (排行榜歌曲) =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const cookie = CM.get('kugou');
    const data = await getRequest(RANK_SONG_URL, {
      rankid: playlistId,
      page,
      pagesize: limit,
      apiver: 2,
    }, cookie);
    if (!data || data.status !== 1) return [];
    const list = (data.data && data.data.info) || [];
    return list.map(normalizeSong);
  }

  // ===== 推荐歌单 (排行榜列表) =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const cookie = CM.get('kugou');
    const data = await getRequest(RANK_LIST_URL, {
      apiver: 2,
      withsong: 1,
      page,
      pagesize: limit,
    }, cookie);
    if (!data || data.status !== 1) return [];
    const list = (data.data && data.data.info) || [];
    return list.map(p => ({
      id: p.rankid || p.global_collectionid,
      name: p.rankname,
      cover: p.imgurl ? p.imgurl.replace('{size}', '240') : (p.bannerurl || ''),
      count: p.song_num || 0,
    }));
  }
}

module.exports = new KugouParser();
