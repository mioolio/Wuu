// =========== QQ音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词(逐字)/歌单/专辑/推荐/分类/用户歌单/扫码登录
// API 特点: 使用 JSON 请求, 下载需 vkey 验证, 歌词为 qrc 格式

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const BASE_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

// 统一请求入口
async function qqRequest(data, cookies = '') {
  const headers = buildHeaders('qq', {
    'Content-Type': 'application/json',
  });
  if (cookies) headers['Cookie'] = cookies;
  const resp = await fetch(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  CM.updateFromResponse('qq', resp);
  return resp.json();
}

// GET 请求 (用于部分接口)
async function qqGetRequest(url, params = {}, cookies = '') {
  const headers = buildHeaders('qq');
  if (cookies) headers['Cookie'] = cookies;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('qq', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  return {
    id: String(raw.songmid || raw.mid || raw.id || ''),
    source: 'qq',
    name: raw.songname || raw.name || raw.title || '',
    artist: raw.singer ? (Array.isArray(raw.singer) ? raw.singer.map(s => s.name).join('/') : raw.singer)
      : '',
    album: raw.albumname || (raw.album && raw.album.name) || '',
    albumId: raw.albummid || (raw.album && raw.album.mid) || '',
    cover: raw.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${raw.albummid}.jpg` : '',
    duration: (raw.interval || 0) * 1000,  // 秒→毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: raw.songmid ? `https://y.qq.com/n/ryqq/songDetail/${raw.songmid}` : '',
    mid: raw.songmid || raw.mid || '',  // QQ音乐用 mid 标识
  };
}

class QQParser extends BaseParser {
  constructor() {
    super('qq');
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
    return /y\.qq\.com|qq\.com\/.*song|qq\.com\/.*playlist|qq\.com\/.*album/i.test(url);
  }

  // ===== 搜索 =====
  async search(keyword, page = 1, limit = 20) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          query: keyword,
          page_num: page,
          num_per_page: limit,
          search_type: 0,  // 0=歌曲
        },
      },
    }, cookie);
    const svc = data && data['music.search.SearchCgiService'];
    if (!svc || svc.code !== 0) return [];
    // QQ音乐搜索返回 data.body.song.list (数组), 兼容 data.list 两种格式
    const songObj = svc.data && svc.data.body && svc.data.body.song;
    const list = (songObj && Array.isArray(songObj.list)) ? songObj.list
      : (Array.isArray(songObj) ? songObj
      : (svc.data && Array.isArray(svc.data.list) ? svc.data.list : []));
    return list.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    // 从链接提取 songmid 或 songid
    const m = String(link).match(/songDetail\/(\w+)/) || String(link).match(/songid=(\d+)/) || String(link).match(/\/song\/(\w+)/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const mid = m[1];
    const cookie = CM.get('qq');
    // 通过 mid 获取歌曲详情
    const data = await qqRequest({
      'song_info_server.info_song_info': {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: {
          song_mid: mid,
        },
      },
    }, cookie);
    const svc = data && data['song_info_server.info_song_info'];
    if (!svc || svc.code !== 0 || !svc.data || !svc.data.track_info) {
      throw new Error('获取歌曲详情失败');
    }
    const song = normalizeSong(svc.data.track_info);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  async getDownloadURL(song) {
    const cookie = CM.get('qq');
    const guid = Math.floor(Math.random() * 1e10);
    // 获取 vkey
    const data = await qqRequest({
      'req_0': {
        module: 'music.vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: String(guid),
          songmid: [song.mid || song.id],
          songtype: [0],
          uin: '0',
          loginflag: 0,
          platform: '23',
        },
      },
    }, cookie);
    const info = data && data.req_0 && data.req_0.data;
    if (!info) return '';
    const midurlinfo = (info.midurlinfo && info.midurlinfo[0]) || {};
    const sip = (info.sip && info.sip[0]) || 'https://dl.stream.qqmusic.qq.com/';
    if (midurlinfo.purl) {
      return sip + midurlinfo.purl;
    }
    return '';
  }

  // ===== 获取歌词 (qrc 格式, 含逐字) =====
  async getLyrics(song) {
    const cookie = CM.get('qq');
    // 获取歌词
    const data = await qqGetRequest('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
      songmid: song.mid || song.id,
      g_tk: 5381,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      nobase64: 1,
    }, cookie);
    if (data.code !== 0) return '';
    // lyric 是行级歌词, trans 是翻译
    const lrc = data.lyric ? decodeURIComponent(data.lyric) : '';
    // base64 解码 (如果 nobase64=1 不生效)
    let lrcText = lrc;
    if (!lrc && data.lyric) {
      try { lrcText = Buffer.from(data.lyric, 'base64').toString('utf-8'); } catch (e) {}
    }
    return lrcText;
  }

  // ===== 歌单搜索 =====
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          query: keyword,
          page_num: page,
          num_per_page: limit,
          search_type: 1000,  // 1000=歌单
        },
      },
    }, cookie);
    const svc = data && data['music.search.SearchCgiService'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.body && svc.data.body.playlist) || (svc.data && svc.data.list) || [];
  }

  // ===== 专辑搜索 =====
  async searchAlbum(keyword, page = 1, limit = 20) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          query: keyword,
          page_num: page,
          num_per_page: limit,
          search_type: 10,  // 10=专辑
        },
      },
    }, cookie);
    const svc = data && data['music.search.SearchCgiService'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.body && svc.data.body.album) || (svc.data && svc.data.list) || [];
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'playlist.getInfo': {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          dissid: playlistId,
          song_num: limit,
          song_begin: (page - 1) * limit,
        },
      },
    }, cookie);
    const svc = data && data['playlist.getInfo'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.songlist || []).map(normalizeSong);
  }

  // ===== 专辑歌曲 =====
  async getAlbumSongs(albumId) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'album.getInfo': {
        module: 'music.musichallAlbum.AlbumSongList',
        method: 'GetAlbumSongList',
        param: {
          albumMid: albumId,
          albumId: 0,
          begin: 0,
          num: 100,
        },
      },
    }, cookie);
    const svc = data && data['album.getInfo'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.songList || []).map(s => normalizeSong(s.songInfo || s));
  }

  async parsePlaylist(link) {
    const m = String(link).match(/playlist\/(\w+)/) || String(link).match(/disid=(\w+)/);
    if (!m) throw new Error('无法从链接中提取歌单ID');
    const songs = await this.getPlaylistSongs(m[1]);
    return { id: m[1], songs };
  }

  async parseAlbum(link) {
    const m = String(link).match(/album\/(\w+)/) || String(link).match(/albumid=(\w+)/);
    if (!m) throw new Error('无法从链接中提取专辑ID');
    const songs = await this.getAlbumSongs(m[1]);
    return { id: m[1], songs };
  }

  // ===== 推荐歌单 =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'playlist.getRecommend': {
        module: 'playlist.PlayListCategory',
        method: 'get_recommend',
        param: {
          qq: '',
          page: page - 1,
          limit,
        },
      },
    }, cookie);
    const svc = data && data['playlist.getRecommend'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.v_playlist) || [];
  }

  // ===== 歌单分类 =====
  async getPlaylistCategories() {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'playlist.getCategory': {
        module: 'playlist.PlayListCategory',
        method: 'get_category',
        param: {},
      },
    }, cookie);
    const svc = data && data['playlist.getCategory'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.category) || [];
  }

  async getCategoryPlaylists(catId, page = 1, limit = 20) {
    const cookie = CM.get('qq');
    const data = await qqRequest({
      'playlist.getCategoryPlaylists': {
        module: 'playlist.PlayListPlazaServer',
        method: 'get_playlist_by_category',
        param: {
          id: catId,
          curPage: page - 1,
          size: limit,
        },
      },
    }, cookie);
    const svc = data && data['playlist.getCategoryPlaylists'];
    if (!svc || svc.code !== 0) return [];
    return (svc.data && svc.data.v_playlist) || [];
  }
}

module.exports = new QQParser();
