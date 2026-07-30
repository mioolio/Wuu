// =========== DOM 引用 + SVG 图标 ===========
const $ = id => document.getElementById(id);
const empty = $('empty');
const player = $('player');
const coverImg = $('cover-img');
const coverPH = $('cover-ph');
const coverEl = document.querySelector('.cover');
const titleEl = $('title');
const artistEl = $('artist');
const creditsEl = $('credits');  // 作词/作曲显示行
const lyrics = $('lyrics');
const lyricsInner = $('lyrics-inner');
const viewList = $('view-list');
const viewPlayer = $('view-player');
const viewStats = $('view-stats');
const rankingList = $('ranking-list');
const rankingEmpty = $('ranking-empty');
const rankingTabs = document.querySelectorAll('.ranking-tab');
const listEl = $('list');
const listTitle = $('list-title');
const listEmpty = $('list-empty');
const search = $('search');
const btnGroupArtist = $('btn-group-artist');
const btnCreateCollection = $('btn-create-collection');
const tNow = $('t-now');
const tEnd = $('t-end');
const pTrack = $('p-track');
const pFill = $('p-fill');
const btnPlay = $('btn-play');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnMode = $('btn-mode');
const btnVol = $('btn-vol');
const volPop = $('vol-pop');
const volSlider = $('vol-slider');
const volSvg = $('vol-svg');
const btnLike = $('btn-like');
const btnDislike = $('btn-dislike');
const navItems = document.querySelectorAll('.nav-item');
const nowPlaying = $('now-playing');
const npCover = $('np-cover');
const npPh = $('np-ph');
const npTitle = $('np-title');
const npArtist = $('np-artist');
const btnDesktopLyric = $('btn-desktop-lyric');
const btnLyricLock = $('btn-lyric-lock');
const btnFloatList = $('btn-float-list');
const floatList = $('float-list');
const floatListWrap = $('float-list-wrap');
const btnFlClose = $('btn-fl-close');
const flList = $('fl-list');
const flSearch = $('fl-search');
const viewSettings = $('view-settings');
const settingShowFloatBtn = $('setting-show-float-btn');
const settingGlassOpacity = $('setting-glass-opacity');
const glassOpacityVal = $('glass-opacity-val');
const settingDiscCover = $('setting-disc-cover');
const settingColorIntensity = $('setting-color-intensity');
const colorIntensityVal = $('color-intensity-val');
const settingThemeFollowCover = $('setting-theme-follow-cover');
const settingCoverChange = $('setting-cover-change');
const settingLyricPersist = $('setting-lyric-persist');
const settingLyricReset = $('setting-lyric-reset');
const settingSimulateLrc = $('setting-simulate-lrc');
const settingArtistGroupMode = $('setting-artist-group-mode');
const settingProgressColor = $('setting-progress-color');
const settingProgressColor2 = $('setting-progress-color-2');
const settingProgressColorEnabled = $('setting-progress-color-enabled');
const progressColorReset = $('progress-color-reset');
const settingLyricDone = $('setting-lyric-done');
const lyricDoneVal = $('lyric-done-val');
const settingLyricWait = $('setting-lyric-wait');
const lyricWaitVal = $('lyric-wait-val');
const settingLyricSize = $('setting-lyric-size');
const lyricSizeVal = $('lyric-size-val');
// 跑马灯设置 DOM
const settingMarqueeEnabled = $('setting-marquee-enabled');
const settingMarqueeSpeed = $('setting-marquee-speed');
const marqueeSpeedVal = $('marquee-speed-val');
const settingMarqueeThreshold = $('setting-marquee-threshold');
const marqueeThresholdVal = $('marquee-threshold-val');
const settingMarqueePause = $('setting-marquee-pause');
const marqueePauseVal = $('marquee-pause-val');
// 暂停音量淡出开关 DOM
const settingFadePause = $('setting-fade-pause');
// 对外地址设置 DOM
const settingPublicHostMode = $('setting-public-host-mode');
const settingPublicHost = $('setting-public-host');
const settingPublicPort = $('setting-public-port');

// 网络服务设置 DOM
const settingServerEnabled = $('setting-server-enabled');
const settingServerPort = $('setting-server-port');
const serverStatusText = $('server-status-text');
// 高级网络设置: 可折叠菜单 + IP 绑定 + 白名单 + 频率限制 + 日志开关
const settingServerAdvancedToggle = $('setting-server-advanced-toggle');
const settingServerBindIP = $('setting-server-bind-ip');
const settingServerWhitelist = $('setting-server-whitelist');
const settingServerRateLimit = $('setting-server-rate-limit');
const settingServerAccessLog = $('setting-server-access-log');
const settingServerViewLogs = $('setting-server-view-logs');
// 访问日志查看模态框
const accessLogModal = $('access-log-modal');
const accessLogList = $('access-log-list');
const accessLogEmpty = $('access-log-empty');
const accessLogClear = $('access-log-clear');
const accessLogRefresh = $('access-log-refresh');
const accessLogClose = $('access-log-close');
const accessLogCount = $('access-log-count');
// 快速分享按钮 (爱心旁边) + 快速分享模态框
const btnShare = $('btn-share');
const quickShareModal = $('quick-share-modal');
const qsTitle = $('qs-title');
const qsShareLink = $('qs-share-link');
const qsShareKey = $('qs-share-key');
const qsCopyLink = $('qs-copy-link');
const qsCopyKey = $('qs-copy-key');
const qsExportCrt = $('qs-export-crt');
const qsClose = $('qs-close');
const qsStatus = $('qs-status');

// =========== 链接解析(免费听音乐-链接解析面板) DOM ===========
const fmLinkInput = $('fm-link-input');
const fmLinkBtn = $('fm-link-btn');
const fmLinkStatus = $('fm-link-status');
const fmLinkListWrap = $('fm-link-list-wrap');
const fmLinkListCount = $('fm-link-list-count');
const fmLinkList = $('fm-link-list');
const fmLinkSelectAll = $('fm-link-select-all');
const fmLinkDownloadAllBtn = $('fm-link-download-all-btn');
const fmLinkProgress = $('fm-link-progress');
const fmLinkProgressFill = $('fm-link-progress-fill');
const fmLinkProgressText = $('fm-link-progress-text');
const fmLinkRefreshLibraryBtn = $('fm-link-refresh-library-btn');
const parseModal = $('parse-modal');
const parseModalSub = $('parse-modal-sub');
const parseModalItems = $('parse-modal-items');
const parseModalApplyAll = $('parse-modal-apply-all');
const parseModalSkip = $('parse-modal-skip');
const parseModalOverwriteAll = $('parse-modal-overwrite-all');
const parseModalConfirm = $('parse-modal-confirm');

// =========== 修复视图 DOM ===========
const viewRepair = $('view-repair');
const repairScanBtn = $('repair-scan-btn');
const repairAllBtn = $('repair-all-btn');
const repairStatus = $('repair-status');
const repairListWrap = $('repair-list-wrap');
const repairList = $('repair-list');
// 歌词修复模态对话框
const lyricsRepairModal = $('lyrics-repair-modal');
const lyricsRepairSub = $('lyrics-repair-sub');
const lyricsRepairInput = $('lyrics-repair-input');
const lyricsRepairCancel = $('lyrics-repair-cancel');
const lyricsRepairConfirm = $('lyrics-repair-confirm');

// =========== 免费听音乐专区 DOM ===========
const viewFreeMusic = $('view-free-music');
const fmInput = $('fm-input');
const fmBtn = $('fm-btn');
const fmSourcesEl = $('fm-sources');
const fmStatusEl = $('fm-status');
const fmSearchStatusEl = $('fm-search-status');
const fmResultsEl = $('fm-results');
// 试听播放器
const fmDownload = $('fm-download');
const fmPlaylistsEl = $('fm-playlists');
const fmPlaylistDetailEl = $('fm-playlist-detail');
const fmPlaylistTitleEl = $('fm-playlist-title');
const fmPlaylistSongsEl = $('fm-playlist-songs');
const fmBackToPlaylistsBtn = $('fm-back-to-playlists');
const fmTypeSelect = $('fm-type-select');
// 免责声明
const fmDisclaimer = $('fm-disclaimer');
const fmDisclaimerAccept = $('fm-disclaimer-accept');
const fmDisclaimerDecline = $('fm-disclaimer-decline');

// =========== 音乐导入 DOM (酷狗子平台, 汽水/网易云在各自模块本地声明) ===========
const viewImport = $('view-import');
const kgLoginArea = $('kg-login-area');
const kgLoggedArea = $('kg-logged-area');
const kgAccountsArea = $('kg-accounts-area');
const kgAccountsList = $('kg-accounts-list');
const kgAddAccount = $('kg-add-account');
const kgBackToAccounts = $('kg-back-to-accounts');
const kgLoginToggle = $('kg-login-toggle');
const kgTabBtns = document.querySelectorAll('.kg-tab-btn');
const kgQrPanel = $('kg-qr-panel');
const kgPhonePanel = $('kg-phone-panel');
const kgQrLoading = $('kg-qr-loading');
const kgQrImgWrap = $('kg-qr-img-wrap');
const kgQrImg = $('kg-qr-img');
const kgQrHint = $('kg-qr-hint');
const kgQrRefresh = $('kg-qr-refresh');
const kgPhoneInput = $('kg-phone-input');
const kgCodeInput = $('kg-code-input');
const kgSendCode = $('kg-send-code');
const kgPhoneLogin = $('kg-phone-login');
const kgAccountSelect = $('kg-account-select');
const kgAccountList = $('kg-account-list');
const kgUserAvatar = $('kg-user-avatar');
const kgUserAvatarPh = $('kg-user-avatar-ph');
const kgUserName = $('kg-user-name');
const kgUserVip = $('kg-user-vip');
const kgLogout = $('kg-logout');
const kgPlaylistsEl = $('kg-playlists');
const kgPlaylistCount = $('kg-playlist-count');
const kgPlaylistEmpty = $('kg-playlist-empty');
const kgTracksSection = $('kg-tracks-section');
const kgBackToPlaylists = $('kg-back-to-playlists');
const kgCurrentPlaylist = $('kg-current-playlist');
const kgQualitySelect = $('kg-quality-select');
const kgImportAll = $('kg-import-all');
const kgImportSelected = $('kg-import-selected');
const kgCheckAll = $('kg-check-all');
const kgTracks = $('kg-tracks');
const kgImportProgress = $('kg-import-progress');
const kgProgressFill = $('kg-progress-fill');
const kgProgressText = $('kg-progress-text');

// 下载图标(用于搜索结果)
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
// 试听图标
const ICON_PREVIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

// =========== SVG 图标 ===========
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const MODE_ICONS = {
  0: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none">1</text></svg>',
  1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
  2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
};
const MODE_NAMES = { 0: '单曲循环', 1: '列表循环', 2: '随机播放' };

const ICON_HEART_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
const ICON_HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
// 倒点赞(不推荐)图标 - 旋转 180 度的赞
const ICON_THUMB_DOWN_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(180deg)"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-3.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
const ICON_THUMB_DOWN_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" style="transform:rotate(180deg)"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-3.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
// 添加/下载图标 (试听模式下用于"添加到歌库"按钮)
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
// 分享图标 (爱心旁边的快速分享按钮)
const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';

const btnMax = $('btn-maximize');
const ICON_MAXIMIZE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
const ICON_RESTORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" transform="translate(2,2)"/></svg>';
