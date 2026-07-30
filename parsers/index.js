// =========== 解析器注册中心 ===========
// 统一管理多平台解析器, 提供链接解析的统一入口
// 搜索/下载/歌词/换源等功能已由 music-dl.exe 接管, 此处仅保留链接解析
// 新增平台: 在 platforms/ 下创建模块(继承 BaseParser), 在此注册即可

const qishui = require('./platforms/qishui');
const netease = require('./platforms/netease');
const qq = require('./platforms/qq');
const kuwo = require('./platforms/kuwo');
const migu = require('./platforms/migu');
const bilibili = require('./platforms/bilibili');
const fivesing = require('./platforms/fivesing');
const qianqian = require('./platforms/qianqian');
const jamendo = require('./platforms/jamendo');
const joox = require('./platforms/joox');
const apple = require('./platforms/apple');
const { detectSource, SOURCE_NAMES } = require('./algorithms/source-detect');

// 已注册的解析器(按 source 标识索引) - 酷狗已移至内置导入模块
const registry = {
  qishui,
  netease,
  qq,
  kuwo,
  migu,
  bilibili,
  fivesing,
  qianqian,
  jamendo,
  joox,
  apple,
};

// 获取平台中文名
function getSourceName(source) {
  return SOURCE_NAMES[source] || source;
}

// 根据分享文本/链接选择解析器
function selectParser(shareText) {
  // 1. 优先按域名识别
  const url = String(shareText || '').match(/https:\/\/[^\s"'<>\\]+/);
  if (url) {
    const source = detectSource(url[0]);
    if (source && registry[source]) return registry[source];
  }
  // 2. 遍历 canParse
  for (const source of Object.keys(registry)) {
    const p = registry[source];
    if (p.canParse && p.canParse(shareText)) return p;
  }
  // 3. 回退到汽水音乐(兼容旧链接)
  return registry.qishui;
}

// 链接解析(单曲)
async function parse(shareText) {
  const parser = selectParser(shareText);
  return parser.parseLink(shareText);
}

module.exports = {
  parse,
  selectParser,
  registry,
  // 兼容旧导出(供 main.js 等使用)
  krcToRaw: qishui.krcToRaw,
  parseLrcFromKrc: qishui.parseLrcFromKrc,
  fetchTrackV2: qishui.fetchTrackV2,
};
