// All lyric times are seconds; raw/KRC word offsets are relative to their line.
const stampPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const stampTime = match => Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0);
const sameTime = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001;

export function parseRawChars(body) {
  const tags = [...body.matchAll(/<(\d+),(\d+),\d+>/g)];
  if (!tags.length) return [];
  const prefix = body.slice(0, tags[0].index);
  const startsWithTag = !prefix.trim();
  const chars = [];
  tags.forEach((tag, index) => {
    const from = startsWithTag ? tag.index + tag[0].length : index ? tags[index - 1].index + tags[index - 1][0].length : 0;
    const to = startsWithTag ? tags[index + 1]?.index ?? body.length : tag.index;
    const text = body.slice(from, to);
    if (text) chars.push({ offset: Number(tag[1]) / 1000, dur: Math.max(0.1, Number(tag[2]) / 1000), text });
  });
  if (!startsWithTag) {
    const lastTag = tags.at(-1);
    const trailing = body.slice(lastTag.index + lastTag[0].length);
    const previous = chars.at(-1);
    if (trailing) chars.push({ offset: previous ? previous.offset + previous.dur : 0, dur: 0.4, text: trailing });
  }
  return chars;
}

export function parseLyrics(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const result = [], plain = [];
  const offset = Number(text.match(/^\s*\[offset\s*:\s*([+-]?\d+)\]/im)?.[1] || 0) / 1000;
  for (const raw of text.split(/\r?\n/)) {
    const body = raw.trim();
    if (!body) continue;
    const krc = body.match(/^\[(\d+),(\d+)\](.*)/);
    if (krc) {
      const chars = parseRawChars(krc[3]);
      if (chars.length) result.push({ time: Number(krc[1]) / 1000 + offset, duration: Number(krc[2]) / 1000, text: chars.map(char => char.text).join(''), chars });
      continue;
    }
    const stamps = [...body.matchAll(stampPattern)];
    if (stamps.length && stamps[0].index === 0) {
      const enhanced = stamps.length > 1 && body.slice(stamps[0][0].length, stamps[1].index).trim();
      if (enhanced) {
        const start = stampTime(stamps[0]) + offset;
        const chars = [];
        stamps.forEach((stamp, index) => {
          const word = body.slice(stamp.index + stamp[0].length, stamps[index + 1]?.index ?? body.length);
          if (!word) return;
          const interval = stamps[index + 1] ? stampTime(stamps[index + 1]) - stampTime(stamp) : 0.4;
          chars.push({ offset: stampTime(stamp) + offset - start, dur: interval > 0 ? interval : 0.1, text: word });
        });
        if (chars.length) result.push({ time: start, text: chars.map(char => char.text).join(''), chars });
      } else {
        const last = stamps.at(-1);
        const words = body.slice(last.index + last[0].length).trim();
        if (words) stamps.forEach(stamp => result.push({ time: stampTime(stamp) + offset, text: words }));
      }
    } else if (!/^\[[^\]]+\]$/.test(body)) {
      plain.push({ time: null, text: body });
    }
  }
  return result.length ? result.sort((a, b) => a.time - b.time) : plain;
}

export function readLyricTime(audio, fallback) {
  const value = audio && audio.readyState >= 1 && Number.isFinite(audio.currentTime) ? audio.currentTime : fallback;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// Select the first row of a timestamp group so original and translation share focus.
export function activeLyricIndex(lines, time) {
  if (!Number.isFinite(time)) return -1;
  let low = 0, high = lines.length - 1, result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (Number.isFinite(lines[middle].time) && lines[middle].time <= time + 0.0001) { result = middle; low = middle + 1; }
    else high = middle - 1;
  }
  while (result > 0 && sameTime(lines[result - 1].time, lines[result].time)) result--;
  return result;
}

export function isCurrentLyric(lines, index, active) {
  return active >= 0 && sameTime(lines[index]?.time, lines[active]?.time);
}

export function lyricCharProgress(char, lineTime, now) {
  const span = Number.isFinite(char.dur) && char.dur > 0 ? char.dur : 0.1;
  return Math.max(0, Math.min(1, (now - lineTime - char.offset) / span));
}

export function lyricLineProgress(lines, index, now, duration) {
  const line = lines[index];
  if (!line || !Number.isFinite(line.time)) return 0;
  let next;
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].time > line.time) { next = lines[i]; break; }
  }
  const end = next?.time ?? (Number.isFinite(duration) && duration > line.time ? duration : line.time + (line.duration > 0 ? line.duration : 5));
  return Math.max(0, Math.min(1, (now - line.time) / (end - line.time)));
}
