// =========== 咪咕音乐解析器 ===========
// 功能: 搜索/链接解析/下载/歌词/歌单/推荐
// API 特点: 使用移动端 UA (buildHeaders 中 source='migu' 自动处理), copyrightId/contentId 标识歌曲

const BaseParser = require('../base');
const { buildHeaders } = require('../algorithms/source-detect');
const CM = require('../auth/cookie-manager');

const SEARCH_URL = 'https://m.music.migu.cn/migu/remoting/scr_search_tag';
const SONG_DETAIL_URL = 'https://music.migu.cn/v3/api/music/audioPlayer/songs';
const PLAY_URL = 'https://app.pd.music.migu.cn/MIGUM2.0/v1.0/content/sub_listen_song_list.do';
const LYRIC_URL = 'https://music.migu.cn/v3/api/music/audioPlayer/getLyric';
const PLAYLIST_SONGS_URL = 'https://music.migu.cn/v3/api/music/playlist/songs';
const RECOMMEND_URL = 'https://music.migu.cn/v3/api/music/playlist/recommend';

// GET 请求 (buildHeaders 在 source='migu' 时自动使用 MOBILE_UA)
async function getRequest(url, params = {}) {
  const headers = buildHeaders('migu');
  const qs = new URLSearchParams(params).toString();
  const fullUrl = url + (qs ? `?${qs}` : '');
  const resp = await fetch(fullUrl, { headers });
  CM.updateFromResponse('migu', resp);
  return resp.json();
}

// 统一歌曲对象
function normalizeSong(raw) {
  const id = raw.copyrightId || raw.contentId || raw.id || '';
  const duration = parseInt(raw.duration || 0) || 0;
  return {
    id: String(id),
    source: 'migu',
    name: raw.songName || raw.title || raw.name || '',
    artist: raw.singerName || raw.singer || raw.artist || '',
    album: raw.albumName || raw.album || '',
    cover: raw.cover || raw.albumPic || raw.pic || '',
    duration,  // 毫秒
    size: 0,
    bitrate: 0,
    ext: '',
    link: id ? `https://music.migu.cn/v3/music/song/${id}` : '',
    copyrightId: String(raw.copyrightId || id),
    contentId: String(raw.contentId || id),
  };
}

class MiguParser extends BaseParser {
  constructor() {
    super('migu');
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
    return /migu\.cn|miguvideo/i.test(url);
  }

  // ===== 搜索 =====
  // scr_search_tag 接口 type=2 搜索歌曲, 返回 songList 或 musics
  async search(keyword, page = 1, limit = 20) {
    const data = await getRequest(SEARCH_URL, {
      keyword,
      type: 2,  // 2=歌曲
      rows: limit,
      pgc: page,
    });
    if (!data) return [];
    const songList = data.songList;
    const list = Array.isArray(songList) ? songList
      : (songList && Array.isArray(songList.items)) ? songList.items
      : (Array.isArray(data.musics) ? data.musics : []);
    return list.map(normalizeSong);
  }

  // ===== 链接解析 =====
  async parseLink(link) {
    const m = String(link).match(/song\/([A-Za-z0-9]+)/)
      || String(link).match(/copyrightId=([A-Za-z0-9]+)/);
    if (!m) throw new Error('无法从链接中提取歌曲ID');
    const copyrightId = m[1];
    const data = await getRequest(SONG_DETAIL_URL, { copyrightId });
    if (!data || !data.songList || !data.songList.length) {
      throw new Error('获取歌曲详情失败');
    }
    const song = normalizeSong(data.songList[0]);
    song.url = await this.getDownloadURL(song);
    try { song.lrc = await this.getLyrics(song); } catch (e) {}
    return song;
  }

  // ===== 获取下载URL =====
  // 通过 contentId 获取播放地址, contenType=1 表示单曲
  async getDownloadURL(song) {
    const contentId = song.contentId || song.copyrightId || song.id;
    const data = await getRequest(PLAY_URL, {
      netType: '01',
      contentId,
      contenType: 1,
    });
    if (!data || !data.data) return '';
    const list = (data.data && data.data.songList) || [];
    if (!list.length) return '';
    // 取第一个有 url 的条目
    const item = list.find(s => s.url) || list[0];
    return item.url || item.listenUrl || '';
  }

  // ===== 获取歌词 =====
  async getLyrics(song) {
    const copyrightId = song.copyrightId || song.id;
    const data = await getRequest(LYRIC_URL, { copyrightId });
    if (!data || !data.data) return '';
    return data.data.lyric || '';
  }

  // ===== 歌单搜索 =====
  // scr_search_tag 接口 type=6 搜索歌单
  async searchPlaylist(keyword, page = 1, limit = 20) {
    const data = await getRequest(SEARCH_URL, {
      keyword,
      type: 6,  // 6=歌单
      rows: limit,
      pgc: page,
    });
    if (!data) return [];
    const songList = data.songList;
    return Array.isArray(songList) ? songList
      : (songList && Array.isArray(songList.items)) ? songList.items
      : (data.playlistList || []);
  }

  // ===== 歌单歌曲 =====
  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    const headers = buildHeaders('migu');
    const qs = new URLSearchParams({
      playlistId,
      pageNo: String(page),
      pageSize: String(limit),
    });
    const resp = await fetch(`${PLAYLIST_SONGS_URL}?${qs.toString()}`, { headers });
    CM.updateFromResponse('migu', resp);
    const data = await resp.json();
    if (!data || !data.data) return [];
    const list = (data.data && data.data.songList) || [];
    return list.map(normalizeSong);
  }

  // ===== 推荐歌单 =====
  async getRecommendedPlaylists(page = 1, limit = 20) {
    const headers = buildHeaders('migu');
    const qs = new URLSearchParams({
      pageNo: String(page),
      pageSize: String(limit),
    });
    const resp = await fetch(`${RECOMMEND_URL}?${qs.toString()}`, { headers });
    CM.updateFromResponse('migu', resp);
    const data = await resp.json();
    if (!data || !data.data) return [];
    return (data.data && data.data.playlist) || [];
  }
}

module.exports = new MiguParser();
