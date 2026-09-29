// =========== 歌词格式识别与转换 ===========
// 移植自 go-music-dl internal/web/lyrics_format.go

// 识别歌词格式: karaoke(逐字) / line(逐行)
// 同一时间戳出现多次或一行多时间戳 → karaoke
function classifyLyricFormat(lrcText) {
  if (!lrcText) return 'line';
  const lines = lrcText.split('\n');
  const re = /\[(\d{2}):(\d{2})\.(\d{1,3})\]/g;
  const timeSeen = new Map();
  let multiTimestampSameLine = false;
  for (const line of lines) {
    let count = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      count++;
      const key = `${m[1]}:${m[2]}.${m[3]}`;
      timeSeen.set(key, (timeSeen.get(key) || 0) + 1);
    }
    if (count > 1) multiTimestampSameLine = true;
  }
  // 同一时间戳出现多次(逐字歌词特征) 或 一行多个时间戳
  for (const v of timeSeen.values()) {
    if (v > 1) return 'karaoke';
  }
  if (multiTimestampSameLine) return 'karaoke';
  return 'line';
}

// 将逐字歌词降级为逐行(去重相同时间戳, 按时间排序)
function lyricToLineFormat(lrcText) {
  if (!lrcText) return '';
  const re = /\[(\d{2}):(\d{2})\.(\d{1,3})\](.*)/g;
  const seen = new Map();  // time -> text
  let m;
  while ((m = re.exec(lrcText)) !== null) {
    const t = `${m[1]}:${m[2]}.${m[3]}`;
    const txt = m[4].trim();
    if (txt && !seen.has(t)) seen.set(t, txt);
  }
  const sorted = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([t, txt]) => `[${t}]${txt}`).join('\n');
}

// 格式化时间戳为 LRC 时间 [mm:ss.cc]
function formatLrcTime(timeMs) {
  const t = Number.isFinite(timeMs) ? Math.max(timeMs, 0) : 0;
  const mm = Math.floor(t / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  const cc = Math.floor((t % 1000) / 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

module.exports = { classifyLyricFormat, lyricToLineFormat, formatLrcTime };
