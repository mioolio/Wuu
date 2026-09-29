// =========== 全局状态变量 ===========
let songs = [];
let curIdx = -1;
let isPlaying = false;
let lrc = [];
let lrcRaw = false;
let playMode = 1;
let prevCurLine = -1;
let lineMetrics = [];
let rafId = null;
let _cachedLineEls = null;  // 缓存歌词行 DOM 元素, 避免每帧 querySelectorAll
// 跑马灯状态: 每个当前行的滚动动画状态
// { lineIdx, startTime, phase: 'pauseStart'|'scrollRight'|'pauseEnd'|'scrollLeft', phaseStart, scrollW }
let marqueeState = null;

// 用户数据
// 多歌单系统: collections 数组, 每项 { id, name, songs: Set<audioPath>, createdAt }
// activeCollectionId: null = 显示歌单列表; 否则显示该歌单的歌曲
let collections = [];
let activeCollectionId = null;
// likedSet: Map<audioPath, timestamp>  timestamp = 点赞时间的 Date.now()
// 现为派生视图: 所有歌单歌曲的并集, 由 rebuildLikedSet() 维护
// 用于 isLiked() 快速判断 / 按点赞时间降序排序(最新点赞的在前)
let likedSet = new Map();
// dislikedSet: Map<audioPath, timestamp> 不推荐(倒点赞)列表
// 与 likedSet 互斥: 点倒赞时自动从喜欢列表移除, 反之亦然
let dislikedSet = new Map();
let stats = {};
let progress = {};
let actualDuration = {};
let seekInProgress = false;
let lastSeekTarget = -1;
let snapEndedPending = false;
let lastSession = null;
let currentView = 'home';        // 当前 UI 视图(home/liked/stats/...)
let currentMode = 'list';
// playContext: 播放上下文, 独立于 currentView
// 用户在某个视图点歌时 playContext = 该视图; 左下角头像切 UI 视图不改 playContext
// pickNextIdx 基于 playContext 决定 playlist, 修复"liked 视图点歌后切首页看歌词, 下一首跳到大列表"的 bug
let playContext = 'home';

// 随机播放洗牌队列 (playMode===2 使用)
// home 和 liked 上下文各自独立维护一套队列, 互不干扰
// 不持久化, 每次启动重新洗
let shuffleQueue = [];        // home 上下文的索引队列 (songs 的索引)
let shufflePos = -1;          // home 上下文当前在队列中的位置
let shuffleQueueLiked = [];   // liked 上下文的索引队列
let shufflePosLiked = -1;     // liked 上下文当前在队列中的位置
let rankingSort = 'plays';
let groupByArtist = false;
let collapsedArtists = new Set();
let saveTimer = null;
let lastTickWall = 0;

// 桌面歌词
let desktopLyricOn = false;
let desktopLyricRaf = null;
let desktopLyricDataSent = false;
let desktopLyricLocked = false;

// 应用设置
let appSettings = {
  showFloatListBtn: true,
  glassOpacity: 0.72,
  discCover: true,
  colorIntensity: 0.85,
  lyricDone: 0.90,
  lyricWait: 0.55,
  lyricSize: 15,
  playMode: 1,
  themeFollowCover: false,
  progressColorEnabled: false,  // 是否启用自定义进度条颜色(默认关闭, 跟随封面色)
  progressColor: '#fb7299',  // 进度条自定义颜色1(起点)
  progressColor2: '#ff5e8a',  // 进度条自定义颜色2(终点, 与起点构成渐变)
  simulateLrcProgress: false,  // 低精度歌词模拟走字(默认关闭)
  artistGroupMode: 'bucket',  // 歌手分组模式: bucket(桶包含,原样分组) | split(拆分多歌手)
  volume: 1.0,  // 音量增益 (0 ~ 1.5), >1.0 时用 WebAudio GainNode 放大
  serverEnabled: false,  // 网络服务开关(默认关闭, 开启后可分享歌单)
  serverPort: 30967,  // 网络服务端口
  serverBindIP: '0.0.0.0',  // 服务器绑定IP (0.0.0.0=所有网卡, 127.0.0.1=仅本机, 特定IP=指定网卡)
  serverWhitelist: [],  // 客户端IP白名单 (空数组=允许所有, 非空=仅允许白名单内IP, 支持通配符 192.168.*.*)
  serverRateLimit: 0,  // 频率限制: 每IP每分钟最大请求数 (0=不限制, 本机始终放行)
  serverAccessLog: false,  // 是否开启访问日志记录 (开启后记录哪些IP下载了哪些歌曲)
  mobileEnabled: false,  // 手机版开关(默认关闭, 开启后可通过浏览器访问移动端 UI)
  coverUnify: true,  // 封面统一性(默认开启, 试听模式下换源时保持原封面不更新, 切歌时正常更新)
  desktopLyricPersist: false,  // 桌面歌词持久化(开启后重启软件自动打开桌面歌词)
  desktopLyricBounds: null,  // 桌面歌词窗口位置 [x, y], null 表示使用默认位置
  desktopLyricLocked: false,  // 桌面歌词鼠标穿透锁定状态(重启后恢复)
  // 长歌词跑马灯设置
  marqueeEnabled: true,      // 是否启用跑马灯 (关闭后回退到字号缩放)
  marqueeSpeed: 60,          // 跑马灯滚动速度 (像素/秒, 默认 60, 范围 30-150)
  marqueeThreshold: 1.0,     // 启动阈值 (歌词宽度 / 容器宽度的倍数, 默认 1.0)
  marqueePause: 1.5,         // 两端停留时间 (秒, 默认 1.5)
  // 暂停音量淡出 (类似网易云音乐, 0.5s 内音量平滑淡到 0 再暂停)
  fadePause: true,           // 默认开启, 关闭后点击暂停立即停止
  // 对外地址设置 (导出生成分享链接时使用的 host)
  // 适用场景: 软件部署在公网服务器/内网穿透时, 自动获取的本机 IP 是内网地址 (如 192.168.1.4),
  // 用户可在此固定为公网 IP 或域名, 不含端口号 (端口由"服务端口"项统一控制)
  // publicHostMode: 'auto' = 自动获取本机 IP; 'manual' = 使用 publicHost 中填入的地址
  publicHostMode: 'auto',
  publicHost: '',            // 手动指定的对外地址 (IP 或域名, 不含端口, 如 8.153.37.78 或 example.com)
  // 对外端口设置 (frp 等内网穿透转发时, 远程端口可能与本地服务端口不同)
  // 0 = 使用"服务端口"; >0 = 生成分享链接时使用此端口
  publicPort: 0,
  // 音效设置 (audio-fx.js): preset=当前预设key, eq=自定义10段增益(dB), customs=已保存的自定义方案
  audioFx: { preset: 'off', eq: [0,0,0,0,0,0,0,0,0,0], customs: [] },
};

// 进度条拖拽
let dragging = false;

// Tick 状态
let lastProgressSave = 0;
let lastAudioTime = 0;
let lastLyricClickTime = 0;

// 封面背景
let _bgFadeTimer = null;
let _lastCoverColor = null;

// 试听模式换源中标志 (coverUnify=true 时用于跳过封面更新)
// 换源流程中设为 true, 防止 updateFmPreviewUI/updNowPlaying 更新封面
// playFmPreview 切歌场景设为 false, 正常更新封面
let _fmSwitchingSource = false;

// 后台时长解析 pending 队列
let _pendingDurUpdates = [];

// 免费听音乐试听模式 (临时套壳到主播放器, 不污染本地歌库)
let fmPreviewMode = false;        // 是否处于免费听试听模式
let fmPreviewSong = null;         // 当前试听的临时歌曲对象
let fmPreviewQueue = [];          // 试听队列(当前搜索结果中点击播放的那首之后的歌曲)
let fmPreviewIdx = -1;            // 试听队列当前索引
let fmPreviewLrc = [];            // 试听模式的临时歌词
let fmPreviewLrcRaw = false;      // 试听模式歌词是否逐字精度
let fmPreviewLrcText = '';        // 试听模式原始歌词文本(保存到歌库时用)
let fmPreviewHasValidLrc = false; // 试听模式是否有有效歌词(>2行时间戳)
