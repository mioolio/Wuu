import { describe, expect, it } from 'vitest';
import type { Song, SongStats } from '../types';
import { localDateKey } from './listeningHistory';
import { normalizeGenres, parseGenreInput, recentDayKeys, songGenres, summarizeListeningStyles } from './listeningStyles';

const now = new Date(2026, 9, 1, 0, 5);
const songs: Song[] = [
  { audioPath: 'a', songName: '流行标题并不代表流行曲风', artist: '摇滚乐队', genre: ['Jazz', 'Soul'] },
  { audioPath: 'b', songName: '摇滚标题并不代表摇滚曲风', artist: '流行歌手' },
];
const recent = (days: Record<string, { plays: number; duration: number }>): SongStats => ({ plays: 100, duration: 100000, recentDays: days });

describe('local listening windows and explicit genre attribution', () => {
  it('includes today and exactly the prior 6 / 29 local calendar days', () => {
    expect(localDateKey(now)).toBe('2026-10-01');
    expect(recentDayKeys(7, now)).toEqual(['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27', '2026-09-26', '2026-09-25']);
    expect(recentDayKeys(30, now)).toHaveLength(30);
    expect(recentDayKeys(30, now).at(-1)).toBe('2026-09-02');
    expect(recentDayKeys(7, new Date(2028, 2, 1, 23, 59))).toContain('2028-02-29');
  });

  it('cleans manual labels without inferring or translating genres', () => {
    expect(normalizeGenres([' Jazz ', 'jazz', '', null, 4, '爵士'])).toEqual(['Jazz', '爵士']);
    expect(parseGenreInput('爵士，灵魂 / Soul、爵士; Funk\nJazz')).toEqual(['爵士', '灵魂 / Soul', 'Funk', 'Jazz']);
    expect(parseGenreInput(' ,， ')).toEqual([]);
    expect(songGenres(songs[0], {})).toEqual({ genres: ['Jazz', 'Soul'], manual: false });
    expect(songGenres(songs[0], { a: ['电子'] })).toEqual({ genres: ['电子'], manual: true });
    expect(songGenres(songs[0], { a: [] })).toEqual({ genres: [], manual: true });
    expect(songGenres(songs[1], {})).toEqual({ genres: [], manual: false });
  });

  it('divides multi-genre time once and counts missing tags in coverage', () => {
    const result = summarizeListeningStyles(songs, {
      a: recent({ '2026-10-01': { plays: 2, duration: 120 }, '2026-09-24': { plays: 10, duration: 1000 } }),
      b: recent({ '2026-09-30': { plays: 1, duration: 60 } }),
    }, {}, 7, now);
    expect(result.totalDuration).toBe(180);
    expect(result.taggedDuration).toBe(120);
    expect(result.coverage).toBeCloseTo(66.6667);
    expect(result.buckets.map(bucket => [bucket.name, bucket.duration])).toEqual([['Jazz', 60], ['Soul', 60], ['未标注', 60]]);
    expect(result.buckets.reduce((total, bucket) => total + bucket.share, 0)).toBeCloseTo(100);
    expect(result.recordedDays).toBe(2);
    expect(result.tracks.map(track => track.song.audioPath)).toEqual(['a', 'b']);
  });

  it('includes the 30-day boundary, excludes future/invalid dates and never repurposes old totals', () => {
    const stats: Record<string, SongStats> = {
      a: recent({ '2026-09-02': { plays: 1, duration: 60 }, '2026-09-01': { plays: 1, duration: 70 }, '2026-10-02': { plays: 1, duration: 100 }, 'bad-date': { plays: 1, duration: 200 } }),
      b: { plays: 999, duration: 999999 },
    };
    expect(summarizeListeningStyles(songs, stats, {}, 7, now).totalDuration).toBe(0);
    expect(summarizeListeningStyles(songs, stats, {}, 30, now).totalDuration).toBe(60);
    expect(summarizeListeningStyles(songs, stats, {}, 30, now).tracks).toHaveLength(1);
  });

  it('keeps manually cleared and unavailable songs unlabelled and ignores corrupt counters', () => {
    const result = summarizeListeningStyles(songs, {
      a: recent({ '2026-10-01': { plays: 1, duration: 90 } }),
      missing: recent({ '2026-10-01': { plays: 1, duration: 30 } }),
      b: recent({ '2026-10-01': { plays: -1, duration: Infinity }, '2026-09-30': { plays: 1, duration: 0 } }),
    }, { a: [] }, 7, now);
    expect(result.totalDuration).toBe(120);
    expect(result.coverage).toBe(0);
    expect(result.buckets).toEqual([{ name: '未标注', duration: 120, share: 100, unlabeled: true }]);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[1].duration).toBe(0);
  });
});
