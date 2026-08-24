const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicAPI', {
  getSongs: () => ipcRenderer.invoke('get-songs'),
  getLyrics: (lrcPath) => ipcRenderer.invoke('get-lyrics', lrcPath),
  getUserData: () => ipcRenderer.invoke('get-userdata'),
  saveUserData: (data) => ipcRenderer.invoke('save-userdata', data),
  // 同步保存: 用于 beforeunload 等关键场景, 阻塞直到主进程写盘完成
  // (async invoke 在窗口关闭/进程被杀时可能来不及到达主进程)
  saveUserDataSync: (data) => ipcRenderer.sendSync('save-userdata-sync', data),
  onDurationUpdate: (cb) => ipcRenderer.on('duration-update', (e, payload) => cb(payload)),
  extractCoverColor: (filePath) => ipcRenderer.invoke('extract-cover-color', filePath),
  extractCoverColorFromURL: (url) => ipcRenderer.invoke('extract-cover-color-url', url),
  // 从磁盘彻底删除歌曲文件夹 (管理界面使用)
  deleteSongFolder: (audioPath) => ipcRenderer.invoke('delete-song-folder', audioPath),
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  quit: () => ipcRenderer.invoke('window-quit'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (e, isMax) => cb(isMax)),
});

// 桌面歌词相关 API (主窗口用)
contextBridge.exposeInMainWorld('desktopLyric', {
  // 显示/隐藏桌面歌词窗口
  toggle: (show) => ipcRenderer.invoke('lyric-toggle', show),
  // 锁定/解锁(锁定后鼠标穿透)
  lock: (locked) => ipcRenderer.invoke('lyric-lock', locked),
  // 锁定状态下临时恢复交互(鼠标悬停控制按钮时), 离开按钮后恢复穿透
  setInteractive: (on) => ipcRenderer.invoke('lyric-set-interactive', on),
  // 发送歌词数据/当前时间到桌面歌词窗口
  send: (payload) => ipcRenderer.send('lyric-data', payload),
  // 桌面歌词窗口通过X按钮关闭时, 通知主窗口同步状态
  notifyClosed: () => ipcRenderer.send('lyric-closed-by-user'),
  onClosed: (cb) => ipcRenderer.on('lyric-closed-by-user', () => cb()),
  // 设置窗口位置 (null=重置默认居中, [x,y]=指定位置)
  setPosition: (pos) => ipcRenderer.invoke('lyric-set-position', pos),
  // 主进程通知: 桌面歌词窗口位置已保存 (用户拖动后触发)
  // 渲染进程需监听此事件同步 appSettings.desktopLyricBounds, 避免被下次 saveUserData 覆盖
  onBoundsSaved: (cb) => ipcRenderer.on('lyric-bounds-saved', (e, pos) => cb(pos)),
});

// 在线解析 API (汽水音乐分享链接解析 + 下载)
contextBridge.exposeInMainWorld('parseAPI', {
  parse: (shareText) => ipcRenderer.invoke('parse-music-link', shareText),
  parseStream: (texts) => ipcRenderer.invoke('parse-music-links-stream', texts),
  // 酷狗第三方代理 JSON 解析(流式推送, 复用 onParseProgress 进度事件)
  parseKugouJsonStream: (jsonText) => ipcRenderer.invoke('parse-kugou-json-stream', jsonText),
  onParseProgress: (cb) => ipcRenderer.on('parse-progress-event', (e, payload) => cb(payload)),
  removeParseProgress: () => ipcRenderer.removeAllListeners('parse-progress-event'),
  checkExists: (info) => ipcRenderer.invoke('check-parsed-song-exists', info),
  download: (info, overwrite) => ipcRenderer.invoke('download-parsed-song', info, overwrite),
  onDownloadProgress: (cb) => ipcRenderer.on('parse-download-progress', (e, payload) => cb(payload)),
  // 酷狗歌词合并诊断日志(F12 排查歌词末字丢失问题)
  onKugouDiag: (cb) => ipcRenderer.on('kugou-lyric-diag', (e, payload) => cb(payload)),
  removeKugouDiag: () => ipcRenderer.removeAllListeners('kugou-lyric-diag'),
});

// 修复 API (扫描损坏歌曲 + 根据 trackId 重新拉取 + 手动修复歌词)
contextBridge.exposeInMainWorld('repairAPI', {
  scan: () => ipcRenderer.invoke('scan-damaged-songs'),
  repair: (item) => ipcRenderer.invoke('repair-song', item),
  repairLyricsManual: (folder, shareLink) => ipcRenderer.invoke('repair-lyrics-manual', { folder, shareLink }),
  // 播放失败上报(解码失败的歌曲记入修复中心, 文件级扫描检不出的解码损坏靠此补充)
  reportPlayFailed: (info) => ipcRenderer.invoke('report-play-failed', info),
});

// 桌面歌词窗口接收更新
contextBridge.exposeInMainWorld('lyricReceiver', {
  onUpdate: (cb) => ipcRenderer.on('lyric-update', (e, payload) => cb(payload)),
});

// ===== 桌面端播放状态同步 API (供 renderer 推送状态到主进程) =====
contextBridge.exposeInMainWorld('stateAPI', {
  updateDesktopState: (patch) => ipcRenderer.invoke('desktop-state-update', patch),
});
contextBridge.exposeInMainWorld('freeMusicAPI', {
  // 检查免责声明是否已接受
  checkDisclaimer: () => ipcRenderer.invoke('free-music-disclaimer-check'),
  // 接受免责声明
  acceptDisclaimer: () => ipcRenderer.invoke('free-music-disclaimer-accept'),
  // 检查服务状态
  status: () => ipcRenderer.invoke('free-music-status'),
  // 搜索歌曲/歌单 (type: 'song' | 'playlist', 返回对应数组)
  search: (keyword, sources, page, type) => ipcRenderer.invoke('free-music-search', { keyword, sources, page, type }),
  // 歌单/专辑详情 (返回内含歌曲数组)
  playlistDetail: (source, id, type) => ipcRenderer.invoke('free-music-playlist-detail', { source, id, type }),
  // 获取流式播放 URL (用作 audio src)
  streamUrl: (song) => ipcRenderer.invoke('free-music-stream-url', song),
  // 探测歌曲信息 (大小/码率/有效性)
  inspect: (song) => ipcRenderer.invoke('free-music-inspect', song),
  // 换源 (服务端并行多源搜索+可播放性验证, 返回新歌曲对象)
  switchSource: (song) => ipcRenderer.invoke('free-music-switch-source', song),
  // 获取歌词
  lyric: (song) => ipcRenderer.invoke('free-music-lyric', song),
  // 保存到本地歌库 (output/ 目录, 需传入歌词文本)
  saveToLibrary: (song, lrcText) => ipcRenderer.invoke('free-music-save-to-library', { song, lrcText }),
});

// ===== 酷狗音乐歌单导入 API (内部直连 kugoumusicapi, 无需第三方服务) =====
contextBridge.exposeInMainWorld('kugouAPI', {
  // 检查登录状态
  loginStatus: () => ipcRenderer.invoke('kugou-login-status'),
  // 二维码登录
  qrKey: () => ipcRenderer.invoke('kugou-qr-key'),
  qrCreate: (key) => ipcRenderer.invoke('kugou-qr-create', key),
  qrCheck: (key) => ipcRenderer.invoke('kugou-qr-check', key),
  // 手机号登录
  captchaSent: (mobile) => ipcRenderer.invoke('kugou-captcha-sent', mobile),
  loginCellphone: (mobile, code, userid) => ipcRenderer.invoke('kugou-login-cellphone', { mobile, code, userid }),
  // 退出登录
  logout: () => ipcRenderer.invoke('kugou-logout'),
  // 多账号管理
  listAccounts: () => ipcRenderer.invoke('kugou-list-accounts'),
  switchAccount: (userid) => ipcRenderer.invoke('kugou-switch-account', userid),
  removeAccount: (userid) => ipcRenderer.invoke('kugou-remove-account', userid),
  // 歌单列表
  playlists: (page, pagesize) => ipcRenderer.invoke('kugou-user-playlists', { page, pagesize }),
  // 歌单曲目
  tracks: (listid) => ipcRenderer.invoke('kugou-playlist-tracks', { listid }),
  // 导入单首歌曲(下载到本地)
  importSong: (song, quality, overwrite) => ipcRenderer.invoke('kugou-import-song', { song, quality, overwrite }),
  // 试听: 获取流式 URL + 歌词 + 元数据, 不下载
  preview: (song, quality) => ipcRenderer.invoke('kugou-preview', { song, quality }),
  // 进度事件(复用解析模块的进度通道)
  onDownloadProgress: (cb) => ipcRenderer.on('parse-download-progress', (e, payload) => cb(payload)),
  removeDownloadProgress: () => ipcRenderer.removeAllListeners('parse-download-progress'),
});

// ===== 汽水音乐导入 API (直连 api.qishui.com, 本地解密) =====
contextBridge.exposeInMainWorld('qishuiAPI', {
  getQrcode: () => ipcRenderer.invoke('qishui-get-qrcode'),
  checkQrcode: (token) => ipcRenderer.invoke('qishui-check-qrcode', { token }),
  oneclickLogin: () => ipcRenderer.invoke('qishui-oneclick-login'),
  peekProfile: () => ipcRenderer.invoke('qishui-peek-profile'),
  fileLogin: (fileName, fileContentBase64) => ipcRenderer.invoke('qishui-file-login', { fileName, fileContentBase64 }),
  getProfile: (aid, sessionid) => ipcRenderer.invoke('qishui-get-profile', { aid, sessionid }),
  getPlaylists: (aid, sessionid) => ipcRenderer.invoke('qishui-get-playlists', { aid, sessionid }),
  getPlaylistDetail: (aid, sessionid, playlistId, cursor) => ipcRenderer.invoke('qishui-get-playlist-detail', { aid, sessionid, playlistId, cursor }),
  importSong: (aid, sessionid, trackId, quality, songMeta, mediaType, vid) => ipcRenderer.invoke('qishui-import-song', { aid, sessionid, trackId, quality, songMeta, mediaType, vid }),
  preview: (aid, sessionid, trackId, quality, mediaType, songMeta, vid) => ipcRenderer.invoke('qishui-preview', { aid, sessionid, trackId, quality, mediaType, songMeta, vid }),
  // 多账号管理 (与 neteaseAPI 对齐)
  loginStatus: () => ipcRenderer.invoke('qishui-login-status'),
  listAccounts: () => ipcRenderer.invoke('qishui-list-accounts'),
  switchAccount: (userid) => ipcRenderer.invoke('qishui-switch-account', userid),
  removeAccount: (userid) => ipcRenderer.invoke('qishui-remove-account', userid),
  logout: () => ipcRenderer.invoke('qishui-logout'),
  onImportProgress: (cb) => ipcRenderer.on('qishui-import-progress', (e, payload) => cb(payload)),
  removeImportProgress: () => ipcRenderer.removeAllListeners('qishui-import-progress'),
});

// ===== 网易云音乐导入 API (内嵌 NeteaseCloudMusicApi, 二维码/Cookie 登录) =====
contextBridge.exposeInMainWorld('neteaseAPI', {
  // 登录态
  loginStatus: () => ipcRenderer.invoke('netease-login-status'),
  // 二维码扫码登录
  qrKey: () => ipcRenderer.invoke('netease-qr-key'),
  qrCreate: (key) => ipcRenderer.invoke('netease-qr-create', key),
  qrCheck: (key) => ipcRenderer.invoke('netease-qr-check', key),
  // Cookie 导入登录
  cookieLogin: (cookieStr) => ipcRenderer.invoke('netease-cookie-login', cookieStr),
  // 退出登录
  logout: () => ipcRenderer.invoke('netease-logout'),
  // 多账号管理
  listAccounts: () => ipcRenderer.invoke('netease-list-accounts'),
  switchAccount: (userid) => ipcRenderer.invoke('netease-switch-account', userid),
  removeAccount: (userid) => ipcRenderer.invoke('netease-remove-account', userid),
  // 歌单列表
  userPlaylists: (page, pagesize) => ipcRenderer.invoke('netease-user-playlists', { page, pagesize }),
  // 歌单曲目
  playlistTracks: (listid) => ipcRenderer.invoke('netease-playlist-tracks', { listid }),
  // 导入单首歌曲(下载到本地)
  importSong: (songId, quality, songMeta, overwrite) => ipcRenderer.invoke('netease-import-song', { songId, quality, songMeta, overwrite }),
  // 试听: 获取流式 URL + 歌词 + 元数据, 不下载
  preview: (songId, quality) => ipcRenderer.invoke('netease-preview', { songId, quality }),
  // 进度事件(复用解析模块的进度通道)
  onDownloadProgress: (cb) => ipcRenderer.on('parse-download-progress', (e, payload) => cb(payload)),
  removeDownloadProgress: () => ipcRenderer.removeAllListeners('parse-download-progress'),
});

// ===== 歌单分享与导入 API (wuu:// 协议 + 远程拉取) =====
contextBridge.exposeInMainWorld('playlistAPI', {
  // 导出歌单 (含 expireAt + maxUses 时间/次数限制, 0 表示该项不限制)
  exportPlaylist: (name, songs, expireAt, maxUses, publicHost, publicPort) => ipcRenderer.invoke('playlist-export', { name, songs, expireAt, maxUses, publicHost, publicPort }),
  // 列出所有已分享的歌单 (用于分享管理列表)
  listSharedPlaylists: () => ipcRenderer.invoke('playlist-list-shared'),
  // 立即销毁一个分享歌单 (删除 JSON 文件, 链接立刻失效)
  deleteSharedPlaylist: (id) => ipcRenderer.invoke('playlist-delete-shared', { id }),
  // 查询单个分享歌单的详情 (含 accessKey 用于重新拼接链接)
  getSharedPlaylist: (id) => ipcRenderer.invoke('playlist-get-shared', { id }),
  // 导出密钥到本地 .crt 文件
  exportCrt: (key, shareLink, playlistName) => ipcRenderer.invoke('playlist-export-crt', { key, shareLink, playlistName }),
  // 从本地 .crt 文件导入 (解析出 link + key, 自动填充到导入表单)
  importCrt: () => ipcRenderer.invoke('playlist-import-crt'),
  // 解析 wuu:// 链接 (需密钥, 返回远程歌单歌曲列表 + 元数据, 不下载)
  parseLink: (link, key, remoteHost) => ipcRenderer.invoke('playlist-parse-link', { link, key, remoteHost }),
  // 下载远程歌单中的单首歌曲
  downloadSong: (song, overwrite) => ipcRenderer.invoke('playlist-download-song', { song, overwrite }),
  // 服务器状态
  serverStatus: () => ipcRenderer.invoke('playlist-server-status'),
  // 启动/停止服务器 (端口 + 绑定IP + 白名单 + 频率限制 + 日志开关 可配置)
  startServer: (port, bindIP, whitelist, rateLimit, accessLogEnabled) => ipcRenderer.invoke('server-start', { port, bindIP, whitelist, rateLimit, accessLogEnabled }),
  stopServer: () => ipcRenderer.invoke('server-stop'),
  // 访问日志: 获取 / 清空
  getAccessLogs: () => ipcRenderer.invoke('server-get-access-logs'),
  clearAccessLogs: () => ipcRenderer.invoke('server-clear-access-logs'),
  // 下载进度事件 (复用 parse-download-progress 通道)
  onDownloadProgress: (cb) => ipcRenderer.on('parse-download-progress', (e, payload) => cb(payload)),
  removeDownloadProgress: () => ipcRenderer.removeAllListeners('parse-download-progress'),
});


