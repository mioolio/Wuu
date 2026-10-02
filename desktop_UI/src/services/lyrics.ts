/** The wire format deliberately matches the existing desktop lyric IPC. */
export interface LyricChar { offset: number; dur: number; text: string }
export interface WordLyricLine { start: number; duration: number; chars: LyricChar[] }
export interface PlainLyricLine { time: number; text: string }
export type LyricLine = WordLyricLine | PlainLyricLine;
export interface LyricsData { raw: boolean; lines: LyricLine[] }

export function lineTime(line: LyricLine): number { return 'start' in line ? line.start : line.time; }
export function lineText(line: LyricLine): string { return 'chars' in line ? line.chars.map(c => c.text).join('') : line.text; }
const stampPattern = /\[(\d{1,3})[.:](\d{1,2})(?:[.:](\d{1,3}))?\]/g;
// LRC headers may be adjacent or precede real text on the same line. Strip only
// leading named tags: timestamps and bracketed text inside a lyric stay intact.
const metadataPrefix = /^(?:\s*\[(?:[a-zA-Z][\w-]*|[\u3400-\u9fff]+)\s*[:：][^\]]*\])+\s*/;
function stripMetadata(line: string): string {
  return line.trim().replace(metadataPrefix, '');
}

function metadataHeaders(text: string): string {
  return text.split(/\r?\n/).map(line => line.trim().match(metadataPrefix)?.[0] || '').join('\n');
}

function lyricOffset(text: string): number {
  return Number(metadataHeaders(text).match(/\[offset\s*:\s*(-?\d+)\]/i)?.[1] || 0) / 1000;
}

const creditLabel = /^(作词\s*[/／]\s*作曲|词\s*[/／]\s*曲|词曲|作词作曲|作词|词|填词|作词人|词作者|作曲|曲|作曲人|曲作者|编曲|制作人|制作|混音|混音师|母带|母带处理|母带工程师|录音|录音师|录音室|和声|和声编写|音乐总监|监制|发行|出品|出品人|版权|后期|OP|SP|Lyricist|Lyrics|Composer|Music|Arranger|Arrangement|Producer|Production|Mixing|Mastering|Recording)\s*[:：]\s*(.*)$/i;
const lyricistLabels = new Set(['作词', '词', '填词', '作词人', '词作者', 'lyricist', 'lyrics']);
const composerLabels = new Set(['作曲', '曲', '作曲人', '曲作者', 'composer', 'music']);
const combinedLabels = new Set(['词曲', '作词作曲', '词/曲', '作词/作曲']);

// Providers time their credits like lyrics, including character tags. Recognize
// only a complete anchored credit label followed by a colon, never a lyric that
// merely mentions a credit or a named tag later in its text.
function creditLine(text: string): { lyricist: string; composer: string } | null {
  const content = stripMetadata(text).replace(/^\[\d+,\d+\]/, '').replace(stampPattern, '')
    .replace(/<\d+,\d+,\d+>/g, '').trim();
  const match = content.match(creditLabel);
  if (!match) return null;
  const label = match[1].replace(/\s/g, '').replace(/／/g, '/').toLowerCase();
  const value = match[2].trim();
  return {
    lyricist: lyricistLabels.has(label) || combinedLabels.has(label) ? value : '',
    composer: composerLabels.has(label) || combinedLabels.has(label) ? value : '',
  };
}

export function hasLyricContent(text: string): boolean {
  return text.split(/\r?\n/).some(raw => {
    const line = stripMetadata(raw);
    return !!line && !/^(?:\[[^\]]+\]\s*)+$/.test(line) && !creditLine(line);
  });
}
function timestamp(min: string, sec: string, fraction = ''): number {
  return Number(min) * 60 + Number(sec) + (fraction ? Number(`0.${fraction}`) : 0);
}

// Keep the raw/KRC parser's gap and excessive-word-duration safeguards.
export function parseRaw(text: string): WordLyricLine[] {
  const lines: WordLyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = stripMetadata(raw).match(/^\[(\d+),(\d+)\](.*)/);
    if (!match) continue;
    if (creditLine(raw)) continue;
    const start = Number(match[1]) / 1000;
    let duration = Number(match[2]) / 1000;
    const body = match[3];
    const parts = body.split(/<[^>]+>/);
    const tags = [...body.matchAll(/<(\d+),(\d+),\d+>/g)];
    const startsWithTag = parts[0] === '';
    const chars: LyricChar[] = [];
    tags.forEach((tag, i) => {
      const word = parts[startsWithTag ? i + 1 : i];
      if (!word) return;
      let offset = Number(tag[1]) / 1000;
      const previous = chars.at(-1);
      if (previous && offset - previous.offset - previous.dur > 2) offset = previous.offset + previous.dur;
      const dur = Math.min(0.8, Number(tag[2]) / 1000 || 0.4);
      chars.push({ offset, dur, text: word });
    });
    const trailingThreshold = tags.length + (startsWithTag ? 1 : 0);
    if (parts.length > trailingThreshold && parts.at(-1)) {
      const previous = chars.at(-1);
      chars.push({ offset: previous ? previous.offset + previous.dur : 0, dur: 0.4, text: parts.at(-1)! });
    }
    // Some providers duplicate the final half of a KRC line when merging LRC.
    const fullText = chars.map(c => c.text).join('');
    const deduped = dedupLineText(fullText);
    if (fullText !== deduped) {
      let remaining = deduped.length;
      let count = 0;
      for (const char of chars) {
        if (remaining <= 0) break;
        if (char.text.length > remaining) {
          const ratio = remaining / char.text.length;
          char.text = char.text.slice(0, remaining);
          char.dur = Math.max(0.1, char.dur * ratio);
        }
        remaining -= char.text.length;
        count++;
      }
      chars.length = count;
      const last = chars.at(-1);
      if (last) duration = last.offset + last.dur;
    }
    if (chars.length) lines.push({ start, duration, chars });
  }
  return lines.sort((a, b) => a.start - b.start);
}

export function dedupLineText(text: string): string {
  if (text.length < 6) return text;
  for (let length = Math.floor(text.length / 2); length >= Math.max(4, Math.floor(text.length / 3)); length--) {
    if (text.slice(-length) === text.slice(-2 * length, -length)) return text.slice(0, -length);
  }
  return text;
}

export function parseEnhancedLRC(text: string): WordLyricLine[] {
  const lines: WordLyricLine[] = [];
  let foundWords = false;
  const offset = lyricOffset(text);
  for (const raw of text.split(/\r?\n/)) {
    const body = stripMetadata(raw);
    if (creditLine(body)) continue;
    const stamps = [...body.matchAll(stampPattern)];
    if (!stamps.length || stamps[0].index !== 0) continue;
    // Adjacent timestamps at the beginning are alternate repeat times, not words.
    const firstEnd = stamps[0][0].length;
    const hasWordBeforeSecond = stamps.length > 1 && body.slice(firstEnd, stamps[1].index).trim().length > 0;
    if (!hasWordBeforeSecond) continue;
    foundWords = true;
    const start = timestamp(stamps[0][1], stamps[0][2], stamps[0][3]) + offset;
    const chars: LyricChar[] = [];
    stamps.forEach((stamp, i) => {
      const word = body.slice(stamp.index! + stamp[0].length, stamps[i + 1]?.index ?? body.length);
      if (!word) return;
      const absolute = timestamp(stamp[1], stamp[2], stamp[3]) + offset;
      const next = stamps[i + 1];
      const interval = next ? timestamp(next[1], next[2], next[3]) + offset - absolute : 0.4;
      chars.push({ offset: absolute - start, dur: interval > 0 ? Math.min(0.8, interval) : 0.4, text: word });
    });
    const last = chars.at(-1);
    if (last) lines.push({ start, duration: last.offset + last.dur, chars });
  }
  if (!foundWords) return [];
  // Preserve normal and translated lines in files that mix both formats.
  for (const plain of parseLRC(text)) {
    if (!lines.some(line => Math.abs(line.start - plain.time) < 0.001 && lineText(line) === plain.text)) {
      lines.push({ start: plain.time, duration: 0.4, chars: [{ offset: 0, dur: 0.4, text: plain.text }] });
    }
  }
  return lines.sort((a, b) => a.start - b.start);
}

export function parseLRC(text: string): PlainLyricLine[] {
  const lines: PlainLyricLine[] = [];
  const offset = lyricOffset(text);
  for (const raw of text.split(/\r?\n/)) {
    const body = stripMetadata(raw);
    if (creditLine(body)) continue;
    const stamps = [...body.matchAll(stampPattern)];
    if (!stamps.length) continue;
    if (stamps[0].index !== 0) {
      // Providers sometimes place a word before its timestamp.
      stamps.forEach((stamp, index) => {
        const from = index ? stamps[index - 1].index! + stamps[index - 1][0].length : 0;
        const word = body.slice(from, stamp.index).trim();
        if (word) lines.push({ time: timestamp(stamp[1], stamp[2], stamp[3]) + offset, text: word });
      });
      continue;
    }
    const firstEnd = stamps[0][0].length;
    if (stamps.length > 1 && body.slice(firstEnd, stamps[1].index).trim()) continue;
    const last = stamps.at(-1)!;
    const words = body.slice(last.index! + last[0].length).trim();
    if (!words) continue;
    for (const stamp of stamps) lines.push({ time: timestamp(stamp[1], stamp[2], stamp[3]) + offset, text: words });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function parseLyrics(text: string, video = false): LyricsData {
  const raw = parseRaw(text);
  if (raw.length) return { raw: true, lines: raw };
  const enhanced = parseEnhancedLRC(text);
  if (enhanced.length) return { raw: true, lines: enhanced };
  const plain = parseLRC(text);
  if (plain.length) return { raw: false, lines: plain };
  const unsynced = text.split(/\r?\n/).map(stripMetadata).filter(line => line && !/^(?:\[[^\]]+\]\s*)+$/.test(line) && !creditLine(line));
  return { raw: false, lines: unsynced.length ? unsynced.map(words => ({ time: 0, text: words })) : [{ time: 0, text: video ? '视频请欣赏' : '纯音乐，请欣赏' }] };
}

export function activeLyricIndex(lines: LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lineTime(lines[middle]) <= time) { result = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return result;
}

export function lyricCredits(text: string): { lyricist: string; composer: string } {
  const headers = metadataHeaders(text);
  const credits = {
    lyricist: headers.match(/\[(?:lyricist|词|作词)\s*[:：]\s*([^\]]+)\]/i)?.[1].trim() || '',
    composer: headers.match(/\[(?:composer|曲|作曲)\s*[:：]\s*([^\]]+)\]/i)?.[1].trim() || '',
  };
  for (const tag of headers.matchAll(/\[([^\]]+)\]/g)) {
    const credit = creditLine(tag[1]);
    if (!credits.lyricist && credit?.lyricist) credits.lyricist = credit.lyricist;
    if (!credits.composer && credit?.composer) credits.composer = credit.composer;
  }
  for (const line of text.split(/\r?\n/)) {
    const credit = creditLine(line);
    if (!credits.lyricist && credit?.lyricist) credits.lyricist = credit.lyricist;
    if (!credits.composer && credit?.composer) credits.composer = credit.composer;
  }
  return credits;
}
