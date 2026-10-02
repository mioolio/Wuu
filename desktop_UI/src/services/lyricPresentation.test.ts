import { describe, expect, it } from 'vitest';
import { activeLyricIndex, lineText, parseLyrics, type LyricsData } from './lyrics';
import { lyricGroupStart } from './lyricPresentation';

function focusedText(data: LyricsData, time: number): string[] {
  const last = activeLyricIndex(data.lines, time);
  const first = lyricGroupStart(data.lines, last);
  return first < 0 ? [] : data.lines.slice(first, last + 1).map(lineText);
}

describe('current lyric timestamp group', () => {
  it('keeps RAW focus after word fill and declared duration, until the next timestamp', () => {
    const data = parseLyrics('[1000,3000]<0,700,0>晚<700,700,0>风\n[5000,1000]<0,500,0>下一句');
    expect(focusedText(data, .99)).toEqual([]);
    expect(focusedText(data, 2.5)).toEqual(['晚风']);
    expect(focusedText(data, 4), 'declared end must not remove current focus in the gap').toEqual(['晚风']);
    expect(focusedText(data, 4.999)).toEqual(['晚风']);
    expect(focusedText(data, 5)).toEqual(['下一句']);
    expect(focusedText(data, 1.5), 'rewinding hands focus back to the original group').toEqual(['晚风']);
  });

  it('keeps deduplicated RAW text focused without shortening provider timing data', () => {
    const data = parseLyrics('[1000,8000]<0,4000,0>直到星光<4000,4000,0>直到星光\n[12000,2000]<0,500,0>下一句');
    const line = data.lines[0];
    expect(lineText(line)).toBe('直到星光');
    expect('chars' in line && line.chars.length).toBe(1);
    expect('chars' in line && line.chars[0].dur).toBe(.8);
    expect('duration' in line && line.duration).toBe(8);
    expect(focusedText(data, 11.99)).toEqual(['直到星光']);
    expect(focusedText(data, 12)).toEqual(['下一句']);
    expect(focusedText(data, 4)).toEqual(['直到星光']);
  });

  it('hands the entire bilingual RAW group over together and restores it on rewind', () => {
    const data = parseLyrics('[1000,2000]<0,500,0>歌词\n[1000,4000]<0,500,0>Translation\n[8000,1000]<0,500,0>下一句');
    expect(focusedText(data, 3.1)).toEqual(['歌词', 'Translation']);
    expect(focusedText(data, 7.99)).toEqual(['歌词', 'Translation']);
    expect(focusedText(data, 8)).toEqual(['下一句']);
    expect(focusedText(data, 2)).toEqual(['歌词', 'Translation']);
  });

  it('uses the next distinct group for enhanced lyrics instead of synthesized word ends', () => {
    const data = parseLyrics('[00:10.00]开[00:10.30]头\n[00:10.00]Translation\n[00:20.00]下一句');
    expect(data.timing).toBe('enhanced');
    expect(focusedText(data, 19.99)).toEqual(['开头', 'Translation']);
    expect(focusedText(data, 20)).toEqual(['下一句']);
    expect(focusedText(data, 15)).toEqual(['开头', 'Translation']);
  });

  it('retains the final RAW/LRC group at track end and only replaces it with another song', () => {
    const lrc = parseLyrics('[00:10]一句\n[00:10]One line\n[00:20]最后一句');
    const raw = parseLyrics('[10000,1000]<0,500,0>一句\n[20000,2000]<0,500,0>最后一句');
    for (const data of [lrc, raw]) {
      expect(focusedText(data, 40)).toEqual(['最后一句']);
      expect(focusedText(data, 100)).toEqual(['最后一句']);
    }
    expect(focusedText(parseLyrics('[00:00]新歌'), 0)).toEqual(['新歌']);
    expect(lyricGroupStart([], 2), 'empty new lyrics cannot reuse an old group index').toBe(-1);
  });
});
