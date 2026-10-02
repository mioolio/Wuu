import { lineTime, type LyricsData } from './lyrics';

/** A completed group keeps its sung color but returns to ordinary text size. */
export function lyricGroupFinished(data: LyricsData, active: number, time: number, duration: number): boolean {
  if (active < 0 || active >= data.lines.length || !Number.isFinite(time)) return false;
  const start = lineTime(data.lines[active]);
  let first = active;
  while (first > 0 && lineTime(data.lines[first - 1]) === start) first--;
  const next = data.lines[active + 1];
  const fallbackEnd = next ? lineTime(next) : Number.isFinite(duration) && duration > start ? duration : Infinity;
  let end = -Infinity;
  for (let index = first; index <= active; index++) {
    const line = data.lines[index];
    // RAW/KRC declares a reliable whole-line duration. Word fill durations may
    // be capped by the parser, so they must not cut off a sustained final note.
    const lineEnd = data.timing === 'raw' && 'chars' in line && Number.isFinite(line.duration) && line.duration > 0
      ? line.start + line.duration : fallbackEnd;
    end = Math.max(end, lineEnd);
  }
  return Number.isFinite(end) && time >= end;
}
