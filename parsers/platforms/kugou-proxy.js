// =========== 酷狗音乐第三方代理 JSON 解析器 ===========
// 第三方软件(如 localhost:3000)已解析出直链, 此模块将 JSON 转为标准 info 对象
// 输入 JSON 格式(支持单对象或数组):
//   {
//     "name": "薛之谦 - 木偶人.mp3",
//     "url":  "http://127.0.0.1:3000/proxy/song/url?hash=...&quality=high",  // 无损音频直链
//     "pic":  "https://imge.kugou.com/stdmusic/400/xxx.jpg",                  // 封面直链
//     "Am1":  "http://127.0.0.1:3000/proxy/lyric/content?hash=...&fmt=krc",   // 高精度 krc 歌词 URL
//     "Am2":  "http://127.0.0.1:3000/proxy/lyric/content?hash=...&fmt=lrc"    // 低精度 lrc 歌词 URL
//   }
// 输出: 标准 info 对象数组, 可直接喂给 downloadParsedSong

// 格式化时间戳为 LRC 时间 [mm:ss.cc]
function formatLrcTime(timeMs) {
  const t = Number.isFinite(timeMs) ? Math.max(timeMs, 0) : 0;
  const mm = Math.floor(t / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  const cc = Math.floor((t % 1000) / 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

// 酷狗 krc 文本格式 → sentences 结构(供 krcToRaw / 播放器逐字解析)
// krc 文本格式:
//   [ti:歌曲名][ar:歌手][al:专辑][offset:0]
//   [startMs,durMs]字<offset,dur,0>字<offset,dur,0>...
// 返回 { sentences, meta } 或 null(解析失败)
function parseKrcText(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const meta = {};
  const sentences = [];

  const metaRe = /^\[(ti|ar|al|by|offset|id)\s*:\s*(.*)\]$/i;
  const lineHeaderRe = /^\[(\d+),(\d+)\]/;
  // krc 逐字格式: <offset,dur,0>字 (tag 在字前面)
  // 正则匹配 <tag>字, 字为非<字符序列(直到下一个<或行尾)
  // 修复: 旧正则 (.+?)<tag> 按"字<tag>"匹配, 会吞掉最后一个字(后面无<tag>),
  //       且第一个字文本会包含 tag
  const wordRe = /<(\d+),(\d+),\d+>([^<]*)/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 元数据行: [ti:...][ar:...][al:...][offset:0][id:...][by:...]
    const metaMatch = trimmed.match(metaRe);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    // krc 行: [startMs,durMs] + 内容
    const lineMatch = trimmed.match(lineHeaderRe);
    if (!lineMatch) continue;

    const startMs = parseInt(lineMatch[1], 10);
    const durMs = parseInt(lineMatch[2], 10);
    const rest = trimmed.slice(lineMatch[0].length);

    const words = [];
    let text_str = '';

    if (rest.includes('<')) {
      // 逐字格式: <offset,dur,0>字<offset,dur,0>字...
      // 酷狗 krc 下载保存时最后 1 个字的整个 <tag>字 会被吞掉, 只剩前 N 个字
      // 修复策略: 解析完所有 word 后, 检测最后一个 word 的 endMs 是否到达行末
      //   如果未到达, 补一个悬空 word(用前字结束 → 行末 时间)
      const rawWords = [];
      let m;
      wordRe.lastIndex = 0;
      while ((m = wordRe.exec(rest)) !== null) {
        const wOffset = parseInt(m[1], 10);
        const wDur = parseInt(m[2], 10);
        const wText = m[3];
        const wStart = startMs + wOffset;
        rawWords.push({ startMs: wStart, durMs: wDur, text: wText });
      }
      // 按下一个 word 的 startMs 重算每个 word 的 endMs
      for (let i = 0; i < rawWords.length; i++) {
        const cur = rawWords[i];
        const next = rawWords[i + 1];
        const endMs = next ? next.startMs : (startMs + durMs);
        words.push({ startMs: cur.startMs, endMs, text: cur.text });
        text_str += cur.text;
      }
      // 关键修复: 如果最后一个 word 的 endMs 距行末有间隙 (>100ms), 视为末字被吞
      // 补一个悬空 word(文本留空, 由 mergeKrcWithLrc 用 lrc 字填充)
      if (rawWords.length > 0) {
        const lastWord = words[words.length - 1];
        const lineEndMs = startMs + durMs;
        const gap = lineEndMs - lastWord.endMs;
        // BUGFIX: 当 krc 实际已经完整时(最后字 endMs == lineEndMs), gap=0, 不补悬空 word
        // 只有当确实存在时间间隙(末字 tag 被截断)时才补, 避免在完整 krc 上多生成空 word
        if (gap > 100) {
          words.push({ startMs: lastWord.endMs, endMs: lineEndMs, text: '' });
        }
      }
    } else {
      // 无逐字标记, 整行作为一个 word(容错: 某些伪 krc 无 <> 标记)
      const wText = rest.trim();
      if (wText) {
        words.push({ startMs, endMs: startMs + durMs, text: wText });
        text_str = wText;
      }
    }

    if (!words.length) continue;

    const endMs = words[words.length - 1].endMs;
    sentences.push({ startMs, endMs, text: text_str, words });
  }

  if (!sentences.length) return null;
  return { sentences, meta };
}

// 解析 lrc 文本得到行结构(跳过 [ti:][ar:] 等元数据 tag 行)
// 返回 [{ startMs, text }] 或 null
function parseLrcLines(lrcText) {
  if (!lrcText) return null;
  const lines = lrcText.split(/\r?\n/);
  const result = [];
  const timeRe = /^\[(\d+):(\d{2})\.(\d{2,3})\](.*)$/;
  for (const line of lines) {
    const m = line.match(timeRe);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const ms = parseInt(m[3].padEnd(3, '0'), 10);
    const startMs = min * 60000 + sec * 1000 + ms;
    const text = m[4].trim();
    if (text) result.push({ startMs, text });
  }
  return result.length ? result : null;
}

// 合并 krc(逐字精度) + lrc(行级文字)
// 以 krc 为骨架(保留所有 word 含悬空, 时间精确), lrc 仅用于:
//   1. 行结构对齐(以 lrc 行为主, 找对应 krc 行)
//   2. 末尾补字(krc 末尾缺字时, 用 lrc 剩余字 + 前字平均时长补上)
// 悬空 word(text='')保留为空, krcToRaw 会输出 <tag> 不带字, 保留时间槽位
function mergeKrcWithLrc(krcObj, lrcText) {
  if (!krcObj || !krcObj.sentences || !krcObj.sentences.length) return krcObj;
  const lrcLines = parseLrcLines(lrcText);
  if (!lrcLines || !lrcLines.length) return krcObj;

  const krcSentences = krcObj.sentences;
  const usedKrc = new Set();  // BUGFIX: 标记已匹配的 krc 行, 避免一行 krc 被多行 lrc 重复消费
  const mergedSentences = [];

  for (const lrcLine of lrcLines) {
    // 找 startMs 最接近且未被使用的 krc 行(时间对齐)
    let bestKrc = null;
    let bestDiff = Infinity;
    for (let i = 0; i < krcSentences.length; i++) {
      const krc = krcSentences[i];
      if (usedKrc.has(i)) continue;
      const diff = Math.abs(krc.startMs - lrcLine.startMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestKrc = krc;
        bestKrc._idx = i;  // 临时记录索引, 匹配成功后标记为已用
      }
    }

    if (!bestKrc || !bestKrc.words || !bestKrc.words.length) {
      // 无对应 krc 行: 整行作为单个 word, 默认 3 秒
      const endMs = lrcLine.startMs + 3000;
      mergedSentences.push({
        startMs: lrcLine.startMs,
        endMs,
        text: lrcLine.text,
        words: [{ startMs: lrcLine.startMs, endMs, text: lrcLine.text }],
      });
      continue;
    }

    // 标记该 krc 行已被使用
    usedKrc.add(bestKrc._idx);

    // 以 krc words 为骨架, 保留所有 word(含悬空 text='')
    const krcWords = bestKrc.words;
    const words = krcWords.map(w => ({
      startMs: w.startMs,
      endMs: w.endMs,
      text: w.text || '',  // 悬空 word 保留为空
    }));

    // BUGFIX: 原代码用"有字 word 数量"与 lrc 字符数对比, 导致把整行 lrc 当"缺字"重复追加
    // 改为统计 krc 所有有字 word 的总字符数, 只在 krc 真正缺字时才补
    const krcCharCount = krcWords
      .filter(w => w.text)
      .reduce((sum, w) => sum + [...w.text].length, 0);
    const lrcChars = [...lrcLine.text];

    // lrc 字数 > krc 有字字符数: 末尾缺字, 用 lrc 剩余字 + 前字平均时长补上
    if (lrcChars.length > krcCharCount) {
      const extraChars = lrcChars.slice(krcCharCount);
      // 计算前字平均时长(ms)
      let avgDur = 300;
      if (krcWords.length > 0) {
        let totalDur = 0;
        for (const w of krcWords) totalDur += (w.endMs - w.startMs);
        avgDur = totalDur / krcWords.length;
      }
      let prevWord = words[words.length - 1];
      for (const ch of extraChars) {
        const startMs = prevWord ? prevWord.endMs : bestKrc.startMs;
        const endMs = startMs + Math.round(avgDur);
        const newWord = { startMs, endMs, text: ch };
        words.push(newWord);
        prevWord = newWord;
      }
    }

    // 重建行 text: 用所有有字 word 的 text 拼接
    const lineText = words.map(w => w.text).join('');

    // 行的 endMs: 取 krc endMs 和最后字 endMs 的较大值
    const endMs = Math.max(bestKrc.endMs || 0, words[words.length - 1].endMs);

    mergedSentences.push({
      startMs: bestKrc.startMs,
      endMs,
      text: lineText,
      words,
    });
  }

  return { sentences: mergedSentences, meta: krcObj.meta || {} };
}

// 从 name 字段解析 title/artist
// "薛之谦 - 木偶人.mp3" → { title: "木偶人", artist: "薛之谦" }
// 用 lastIndexOf 拆分, 正确处理歌名自身含 " - " 的情况
function parseNameField(name) {
  let s = String(name || '').trim();
  // 去掉常见音频扩展名
  s = s.replace(/\.(mp3|m4a|aac|flac|wav|ogg)$/i, '');
  if (!s) return { title: '未知歌曲', artist: '未知艺人' };

  const li = s.lastIndexOf(' - ');
  if (li > 0) {
    const artist = s.slice(0, li).trim();
    const title = s.slice(li + 3).trim();
    if (artist && title) return { title, artist };
  }
  return { title: s, artist: '未知艺人' };
}

// 从 lrc 头部提取元数据 + 作词作曲(扫描前 50 行)
function extractLrcMeta(lrcText) {
  const head = String(lrcText || '').split('\n').slice(0, 50).join('\n');
  const mTi = head.match(/^\s*\[ti\s*:\s*([^\]]+)\]/im);
  const mAr = head.match(/^\s*\[ar\s*:\s*([^\]]+)\]/im);
  const mAl = head.match(/^\s*\[al\s*:\s*([^\]]+)\]/im);
  const mLyricist = head.match(/^\s*\[(?:lyricist|词)\s*:\s*([^\]]+)\]/im);
  const mComposer = head.match(/^\s*\[(?:composer|曲)\s*:\s*([^\]]+)\]/im);
  return {
    title: mTi ? mTi[1].trim() : '',
    artist: mAr ? mAr[1].trim() : '',
    album: mAl ? mAl[1].trim() : '',
    lyricist: mLyricist ? mLyricist[1].trim() : '',
    composer: mComposer ? mComposer[1].trim() : '',
  };
}

// 带超时的 fetch 文本
async function fetchText(url, timeoutMs = 10000) {
  if (!url) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok) return '';
    return await resp.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// 解析单首歌的 JSON 项 → 标准 info 对象
async function parseOne(item) {
  if (!item) throw new Error('空数据');
  if (!item.url) throw new Error('无音频链接');

  const { title: parsedTitle, artist: parsedArtist } = parseNameField(item.name);

  // 并行 fetch lrc(Am2) + krc(Am1)
  const [lrcText, krcText] = await Promise.all([
    fetchText(item.Am2),
    fetchText(item.Am1),
  ]);

  // 解析 krc
  let krcObj = null;
  let krcMeta = {};
  if (krcText) {
    krcObj = parseKrcText(krcText);
    if (krcObj && krcObj.meta) krcMeta = krcObj.meta;
  }

  // 提取 lrc 元数据(在合并前提取, 因为合并后 lrc 头部 tag 会被重新生成)
  const lrcMeta = extractLrcMeta(lrcText);

  // 元数据优先级: krc meta > lrc tag > name 解析
  const title = krcMeta.ti || lrcMeta.title || parsedTitle;
  const artist = krcMeta.ar || lrcMeta.artist || parsedArtist;
  const album = krcMeta.al || lrcMeta.album || '';
  const lyricist = lrcMeta.lyricist || '';
  const composer = lrcMeta.composer || '';

  // 生成最终 lrc 文本
  let finalLrc = lrcText;

  // lrc 为空但有 krc: 从 krc sentences 生成行级 lrc
  if (!finalLrc && krcObj) {
    finalLrc = krcObj.sentences
      .filter(s => s.text)
      .map(s => `[${formatLrcTime(s.startMs)}]${s.text}`)
      .join('\n');
  }

  // 移除 lrc 已有的元数据 tag 行, 重新添加统一头部
  // 保证 [ti:]/[ar:]/[al:]/[lyricist:]/[composer:] 一致, 供 scanMusicFiles 后备提取
  if (finalLrc) {
    const body = finalLrc.replace(/^\s*\[(ti|ar|al|lyricist|composer|id|offset|by)\s*:[^\]]*\]\s*$/gim, '').trim();
    const header = `[ti:${title}]\n[ar:${artist}]\n[al:${album}]\n${lyricist ? `[lyricist:${lyricist}]\n` : ''}${composer ? `[composer:${composer}]\n` : ''}`;
    finalLrc = header + '\n' + body;
  }

  // 合并: 以 lrc 为主要歌词(行结构+文字完整), 以 krc 为详细精度(逐字时间)
  // 修复酷狗 krc 数据缺少每行最后一个字的问题
  if (krcObj && finalLrc) {
    krcObj = mergeKrcWithLrc(krcObj, finalLrc);
  }

  // 诊断日志: 统计悬空 word 数和末尾补字数(验证修复效果)
  let _diag = null;
  try {
    const merged = krcObj && krcObj.sentences ? krcObj.sentences : [];
    let emptyWordCount = 0;  // 悬空 word 数(保留为空, krcToRaw 输出 <tag> 不带字)
    let extraCharCount = 0;  // lrc 补字数(krc 末尾缺字时从 lrc 补上)
    for (const s of merged) {
      for (const w of s.words) {
        if (!w.text) emptyWordCount++;
      }
    }
    // 抽样前 3 行正文(跳过元数据头部)
    const isHeader = (s) => /[：:]|作词|作曲|编曲|制作|吉他|贝斯|和声|混音|统筹|监制|录音/.test(s.text);
    const bodySample = merged.filter(s => !isHeader(s)).slice(0, 3).map(s => ({
      text: s.text,
      wordCount: s.words.length,
      wordTexts: s.words.map(w => w.text || '∅'),
    }));
    _diag = {
      title, artist,
      lrcCharCount: lrcText ? lrcText.length : 0,
      mergedSentCount: merged.length,
      emptyWordCount,
      bodySample,
    };
  } catch (e) {}

  return {
    title,
    artist,
    album,
    cover: item.pic || '',
    lrc: finalLrc,
    krc: krcObj,  // { sentences, meta } 或 null; downloadParsedSong 只读 sentences
    duration: 0,  // 第三方 JSON 无 duration 字段, 后续扫描时可补全
    lyricist,
    composer,
    url: item.url,
    playAuth: '',  // 酷狗无需解密
    trackId: '',
    source: 'kugou',
    _diag,  // 诊断数据(临时, 仅渲染进程日志用, 不入 info.json)
  };
}

// 解析酷狗第三方 JSON → 流式回调进度
// 输入: JSON 文本, 支持以下结构:
//   1. 单歌曲对象:   { name, url, pic, Am1, Am2 }
//   2. 歌曲数组:     [ { name, url, ... }, ... ]
//   3. 单歌单对象:   { name: "我喜欢", musics: [ {歌曲}, ... ] }
//   4. 歌单数组:     [ { name, musics: [...] }, ... ]  (多歌单时合并所有 musics)
// onProgress: ({ idx, ok, data, message, done, total }) => void
//   payload 格式与 parse-music-links-stream 的 parse-progress-event 一致, 便于 UI 复用
// 返回: total(总数)
async function parseKugouJson(jsonText, onProgress) {
  const data = JSON.parse(jsonText);

  // 展平为歌曲数组: 识别 musics 嵌套结构
  let arr;
  if (Array.isArray(data)) {
    arr = [];
    for (const item of data) {
      if (item && Array.isArray(item.musics)) {
        arr.push(...item.musics);  // 歌单对象: 提取 musics
      } else if (item && item.url) {
        arr.push(item);  // 直接是歌曲对象
      }
      // 其他无效项跳过
    }
  } else if (data && Array.isArray(data.musics)) {
    arr = data.musics;  // 单歌单对象
  } else if (data && data.url) {
    arr = [data];  // 单歌曲对象
  } else {
    throw new Error('无法识别的 JSON 结构: 缺少 url 或 musics 字段');
  }

  const total = arr.length;

  for (let i = 0; i < arr.length; i++) {
    let info = null;
    let errorMsg = null;
    try {
      info = await parseOne(arr[i]);
    } catch (e) {
      errorMsg = e.message;
    }
    if (onProgress) {
      onProgress({ idx: i, ok: !!info, data: info, message: errorMsg, done: i + 1, total });
    }
  }

  return total;
}

// 从已获取的歌词文本 + 歌曲元数据构建标准 info 对象
// 与 parseOne() 的区别: 不需要 fetch URL, 直接接收 krcText/lrcText
// 用于酷狗歌单导入(内部直连 kugoumusicapi, 无需第三方代理)
function buildInfoFromTexts(opts) {
  const {
    title: rawTitle,
    artist: rawArtist,
    album: rawAlbum,
    cover,
    url,
    duration,
    hash,
    krcText,
    lrcText,
  } = opts;

  // 解析 krc
  let krcObj = null;
  let krcMeta = {};
  if (krcText) {
    krcObj = parseKrcText(krcText);
    if (krcObj && krcObj.meta) krcMeta = krcObj.meta;
  }

  // 提取 lrc 元数据
  const lrcMeta = extractLrcMeta(lrcText);

  // 元数据优先级: krc meta > lrc tag > 传入参数
  const title = krcMeta.ti || lrcMeta.title || rawTitle || '未知歌曲';
  const artist = krcMeta.ar || lrcMeta.artist || rawArtist || '未知艺人';
  const album = krcMeta.al || lrcMeta.album || rawAlbum || '';
  const lyricist = lrcMeta.lyricist || '';
  const composer = lrcMeta.composer || '';

  // 生成最终 lrc 文本
  let finalLrc = lrcText || '';

  // lrc 为空但有 krc: 从 krc sentences 生成行级 lrc
  if (!finalLrc && krcObj) {
    finalLrc = krcObj.sentences
      .filter(s => s.text)
      .map(s => `[${formatLrcTime(s.startMs)}]${s.text}`)
      .join('\n');
  }

  // 移除 lrc 已有的元数据 tag 行, 重新添加统一头部
  if (finalLrc) {
    const body = finalLrc.replace(/^\s*\[(ti|ar|al|lyricist|composer|id|offset|by)\s*:[^\]]*\]\s*$/gim, '').trim();
    const header = `[ti:${title}]\n[ar:${artist}]\n[al:${album}]\n${lyricist ? `[lyricist:${lyricist}]\n` : ''}${composer ? `[composer:${composer}]\n` : ''}`;
    finalLrc = header + '\n' + body;
  }

  // 合并: 以 lrc 为主要歌词, 以 krc 为详细精度(逐字时间)
  if (krcObj && finalLrc) {
    krcObj = mergeKrcWithLrc(krcObj, finalLrc);
  }

  return {
    title,
    artist,
    album,
    cover: cover || '',
    lrc: finalLrc,
    krc: krcObj,
    duration: duration || 0,
    lyricist,
    composer,
    url: url || '',
    playAuth: '',
    trackId: hash || '',
    source: 'kugou',
  };
}

module.exports = { parseKugouJson, parseKrcText, parseNameField, extractLrcMeta, buildInfoFromTexts };
