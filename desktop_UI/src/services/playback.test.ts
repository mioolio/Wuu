import { describe, expect, it } from 'vitest';
import { activeLyricIndex, lineText, parseEnhancedLRC, parseLRC, parseLyrics, parseRaw } from './lyrics';
import { configToCustom, normalizeFxSettings, resolveFxConfig } from './audioFx';
import { preferredDuration, safeSeekTime, shuffled } from './playbackUtils';
import type { Song } from '../types';

describe('lyric formats from the existing library and preview services', () => {
  it('reads both KRC tag conventions without dropping the last word or alternate lines', () => {
    const data = parseRaw('[1000,2000]你<0,300,0>好<300,400,0>呀\n[3000,1000]<0,300,0>再<300,400,0>见');
    expect(data.map(lineText)).toEqual(['你好呀', '再见']);
    expect(data[0].chars.at(-1)?.offset).toBeCloseTo(0.7);
    expect(data[1].chars).toHaveLength(2);
  });
  it('preserves conventional multi-time LRC repeats and accepts seconds without fractions', () => {
    expect(parseLRC('[00:10][00:20.50]副歌\n[01:02.003]结尾')).toEqual([
      { time: 10, text: '副歌' }, { time: 20.5, text: '副歌' }, { time: 62.003, text: '结尾' },
    ]);
    expect(parseEnhancedLRC('[00:10][00:20.50]副歌')).toEqual([]);
  });
  it('keeps normal lines in mixed enhanced lyrics and obeys signed LRC offset', () => {
    const data = parseLyrics('[offset:-500]\n[00:10.00]你[00:10.30]好\n[00:11.00]Hello');
    expect(data.raw).toBe(true);
    expect(data.lines.map(lineText)).toEqual(['你好', 'Hello']);
    expect(activeLyricIndex(data.lines, 9.49)).toBe(-1);
    expect(activeLyricIndex(data.lines, 9.5)).toBe(0);
    expect(activeLyricIndex(data.lines, 10.5)).toBe(1);
  });
  it('supports provider inline timestamps and fallback for songs without lyrics', () => {
    expect(parseLRC('在[2:10.87]那[2.11.29]片[2.11.70]').map(lineText)).toEqual(['在', '那', '片']);
    expect(parseLyrics('', true)).toEqual({ raw: false, lines: [{ time: 0, text: '视频请欣赏' }] });
  });
});

describe('playback safeguards', () => {
  const song: Song = { audioPath: 'C:\\music.aac', songName: 'Test', artist: 'Artist', realDuration: 200 };
  it('trusts the parsed audio frames over a misleading Chromium ADTS estimate', () => {
    expect(preferredDuration(song, 6612)).toBe(200);
    expect(safeSeekTime(6500, preferredDuration(song, 6612), 6612)).toBeCloseTo(199.97);
  });
  it('limits seeking by both the real and decoded duration and ignores invalid values', () => {
    expect(safeSeekTime(180, 200, 150)).toBeCloseTo(149.97);
    expect(safeSeekTime(Number.NaN, 200, 200)).toBe(0);
    expect(safeSeekTime(-1, 200, 200)).toBe(0);
    expect(preferredDuration(song, 80, true)).toBe(80);
  });
  it('uses a complete shuffled cycle without dropping or repeating library items', () => {
    const original = Array.from({ length: 100 }, (_, index) => index);
    expect(shuffled(original).sort((a, b) => a - b)).toEqual(original);
    expect(original[0]).toBe(0);
  });
});

describe('versioned audio effect settings', () => {
  it('loads older custom presets without losing their equalizer gains', () => {
    const settings = normalizeFxSettings({ preset: 'custom:0', customs: [{ name: 'Old', eq: [1,2,3,4,5,6,7,8,9,10] } as any] });
    const config = resolveFxConfig(settings);
    expect(config.eq[9]).toBe(10);
    expect(config.eqFreqs?.[9]).toBe(16000);
    expect(config.width).toBe(1);
    expect(config.eqQs?.[0]).toBe(1.1);
  });
  it('captures all preset parameters when starting an editable custom scheme', () => {
    const preset = resolveFxConfig(normalizeFxSettings({ preset: 'surround' }));
    const custom = configToCustom(preset);
    expect(custom.params.width).toBe(2);
    expect(custom.params.panDepth).toBe(0.28);
    expect(custom.eq).toHaveLength(10);
    const safe = normalizeFxSettings({ eq: [100, Number.NaN], eqQs: [0], params: { wet: 9 } as any });
    expect(safe.eq[0]).toBe(12); expect(safe.eq[1]).toBe(0); expect(safe.eqQs[0]).toBe(0.1); expect(safe.params.wet).toBe(0.5);
  });
});
