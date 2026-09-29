// =========== 平台解析器基类 ===========
// 所有平台解析器继承此类, 实现统一接口
// 能力声明: 子类通过覆盖 capabilities 集合声明支持的功能, 注册中心据此路由

// 统一的歌曲数据结构
// {
//   id, source, name, artist, album, albumId, cover, duration, size, bitrate, ext, link, extra
// }

class BaseParser {
  constructor(source) {
    this.source = source;  // 平台标识: netease/qq/kugou...
    // 能力声明: 子类覆盖对应字段为 true
    this.capabilities = {
      search: false,           // 关键词搜索
      parseLink: false,        // 链接解析(单曲)
      download: false,         // 获取下载URL
      lyrics: false,           // 歌词获取
      searchPlaylist: false,   // 歌单搜索
      searchAlbum: false,      // 专辑搜索
      playlistSongs: false,    // 歌单歌曲列表
      albumSongs: false,       // 专辑歌曲列表
      parsePlaylist: false,    // 歌单链接解析
      parseAlbum: false,       // 专辑链接解析
      recommendedPlaylists: false,  // 推荐歌单
      playlistCategories: false,    // 歌单分类
      categoryPlaylists: false,     // 分类歌单
    };
  }

  // 能力查询
  can(feature) { return !!this.capabilities[feature]; }

  // 链接匹配: 子类覆盖, 返回 bool
  canParse(shareText) { return false; }

  // ===== 以下方法子类按需覆盖, 未实现的抛 NotSupported =====

  async search(keyword, page = 1, limit = 20) {
    throw new Error(`${this.source}: 不支持搜索`);
  }

  async parseLink(link) {
    throw new Error(`${this.source}: 不支持链接解析`);
  }

  async getDownloadURL(song) {
    throw new Error(`${this.source}: 不支持下载`);
  }

  async getLyrics(song) {
    throw new Error(`${this.source}: 不支持歌词获取`);
  }

  async searchPlaylist(keyword, page = 1, limit = 20) {
    throw new Error(`${this.source}: 不支持歌单搜索`);
  }

  async searchAlbum(keyword, page = 1, limit = 20) {
    throw new Error(`${this.source}: 不支持专辑搜索`);
  }

  async getPlaylistSongs(playlistId, page = 1, limit = 100) {
    throw new Error(`${this.source}: 不支持歌单歌曲`);
  }

  async getAlbumSongs(albumId) {
    throw new Error(`${this.source}: 不支持专辑歌曲`);
  }

  async parsePlaylist(link) {
    throw new Error(`${this.source}: 不支持歌单链接解析`);
  }

  async parseAlbum(link) {
    throw new Error(`${this.source}: 不支持专辑链接解析`);
  }

  async getRecommendedPlaylists(page = 1, limit = 20) {
    throw new Error(`${this.source}: 不支持推荐歌单`);
  }

  async getPlaylistCategories() {
    throw new Error(`${this.source}: 不支持歌单分类`);
  }

  async getCategoryPlaylists(catId, page = 1, limit = 20) {
    throw new Error(`${this.source}: 不支持分类歌单`);
  }
}

module.exports = BaseParser;
