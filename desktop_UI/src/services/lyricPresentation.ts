import { lineTime, type LyricLine } from './lyrics';

/** Focus follows the timestamp group; word fill and line duration never end it. */
export function lyricGroupStart(lines: LyricLine[], index: number): number {
  // Track changes can render new, empty lyrics before active state resets.
  if (!lines.length || index < 0) return -1;
  index = Math.min(index, lines.length - 1);
  while (index > 0 && lineTime(lines[index - 1]) === lineTime(lines[index])) index--;
  return index;
}
