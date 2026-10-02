import { describe, expect, it } from 'vitest';
import { activeLyricIndex, lineText, parseLyrics } from './lyrics';
import { lyricGroupFinished } from './lyricPresentation';

describe('current lyric size lifetime', () => {
  it('keeps a RAW sustained note enlarged until the provider whole-line duration ends', () => {
    const data = parseLyrics('[1000,8000]<0,4000,0>长尾音\n[12000,2000]<0,500,0>下一句');
    expect(data.timing).toBe('raw');
    expect('chars' in data.lines[0] && data.lines[0].chars[0].dur).toBe(.8);
    const finished = (time: number) => lyricGroupFinished(data, activeLyricIndex(data.lines, time), time, 20);
    expect(finished(1.9)).toBe(false);
    expect(finished(8.99)).toBe(false);
    expect(finished(9)).toBe(true);
    expect(finished(10)).toBe(true);
    expect(finished(4), 'seeking back into the sustained note restores the current size').toBe(false);
  });

  it('preserves the provider end when a duplicated RAW tail is removed', () => {
    const data = parseLyrics('[1000,8000]<0,4000,0>直到星光<4000,4000,0>直到星光\n[12000,2000]<0,500,0>下一句');
    const line = data.lines[0];
    expect(lineText(line)).toBe('直到星光');
    expect('chars' in line && line.chars.length).toBe(1);
    expect('chars' in line && line.chars[0].dur).toBe(.8);
    expect('duration' in line && line.duration).toBe(8);
    const finished = (time: number) => lyricGroupFinished(data, activeLyricIndex(data.lines, time), time, 20);
    expect(finished(1.9), 'the capped word fill cannot end the enlarged provider line').toBe(false);
    expect(finished(8.99)).toBe(false);
    expect(finished(9)).toBe(true);
    expect(finished(10), 'the completed line stays ordinary until the next timestamp').toBe(true);
    expect(finished(4), 'backward seek restores the sustained line after deduplication').toBe(false);
  });

  it('uses the complete bilingual group lifetime rather than only the first line', () => {
    const data = parseLyrics('[1000,2000]<0,500,0>歌词\n[1000,4000]<0,500,0>Translation\n[8000,1000]<0,500,0>下一句');
    expect(lyricGroupFinished(data, 1, 3.1, 20)).toBe(false);
    expect(lyricGroupFinished(data, 1, 5, 20)).toBe(true);
    expect(lyricGroupFinished(data, 1, 2, 20)).toBe(false);
  });

  it('uses the next distinct timestamp for enhanced lyrics with synthesized word duration', () => {
    const data = parseLyrics('[00:10.00]开[00:10.30]头\n[00:10.00]Translation\n[00:20.00]下一句');
    expect(data.timing).toBe('enhanced');
    expect(lyricGroupFinished(data, activeLyricIndex(data.lines, 15), 15, 30)).toBe(false);
    expect(lyricGroupFinished(data, activeLyricIndex(data.lines, 30), 30, 30)).toBe(true);
  });

  it('restores ordinary LRC at the track end, while unknown duration keeps the current line readable', () => {
    const data = parseLyrics('[00:10]一句\n[00:10]One line\n[00:20]最后一句');
    expect(lyricGroupFinished(data, -1, 5, 40)).toBe(false);
    expect(lyricGroupFinished(data, 1, 19.9, 40)).toBe(false);
    expect(lyricGroupFinished(data, 2, 39.9, 40)).toBe(false);
    expect(lyricGroupFinished(data, 2, 40, 40)).toBe(true);
    expect(lyricGroupFinished(data, 2, 40, 0)).toBe(false);
    expect(lyricGroupFinished(data, 2, 40, Number.NaN)).toBe(false);
  });
});
