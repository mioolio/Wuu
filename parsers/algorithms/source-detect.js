// =========== 链接源识别 ===========
// 移植自 go-music-dl core/service.go DetectSource
// 根据 URL 域名识别所属平台

function detectSource(url) {
  if (!url) return '';
  const u = String(url).toLowerCase();
  if (u.includes('163.com') || u.includes('netease')) return 'netease';
  if (u.includes('qq.com') || u.includes('y.qq.com')) {
    if (u.includes('wx.qq.com') || u.includes('weixin')) return 'qq_wx';
    return 'qq';
  }
  if (u.includes('kugou.com')) return 'kugou';
  if (u.includes('kuwo.cn') || u.includes('kuwo.com')) return 'kuwo';
  if (u.includes('migu.cn') || u.includes('miguvideo')) return 'migu';
  if (u.includes('91q.com') || u.includes('qianqian')) return 'qianqian';
  if (u.includes('qishui.douyin') || u.includes('qishui.com') || u.includes('snssdk.com')) return 'qishui';
  if (u.includes('5sing.com') || u.includes('fivesing')) return 'fivesing';
  if (u.includes('jamendo.com')) return 'jamendo';
  if (u.includes('joox.com')) return 'joox';
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili';
  if (u.includes('apple.com') || u.includes('music.apple')) return 'apple';
  return '';
}

// 平台中文名
const SOURCE_NAMES = {
  netease: '网易云音乐',
  qq: 'QQ音乐',
  qq_wx: 'QQ音乐(微信)',
  kugou: '酷狗音乐',
  kuwo: '酷我音乐',
  migu: '咪咕音乐',
  qianqian: '千千音乐',
  qishui: '汽水音乐',
  fivesing: '5sing',
  jamendo: 'Jamendo',
  joox: 'JOOX',
  bilibili: '哔哩哔哩',
  apple: 'Apple Music',
};

// 通用请求头
const COMMON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 各平台 Referer
const SOURCE_REFERERS = {
  netease: 'http://music.163.com/',
  qq: 'http://y.qq.com/',
  kugou: 'http://www.kugou.com/',
  kuwo: 'http://www.kuwo.cn/',
  migu: 'http://music.migu.cn/',
  bilibili: 'https://www.bilibili.com/',
};

function buildHeaders(source, extra = {}) {
  const cookie = require('../auth/cookie-manager').get(source);
  const headers = {
    'User-Agent': source === 'migu' ? MOBILE_UA : COMMON_UA,
    'Cookie': cookie,
  };
  if (SOURCE_REFERERS[source]) headers['Referer'] = SOURCE_REFERERS[source];
  return { ...headers, ...extra };
}

module.exports = { detectSource, SOURCE_NAMES, COMMON_UA, MOBILE_UA, SOURCE_REFERERS, buildHeaders };
