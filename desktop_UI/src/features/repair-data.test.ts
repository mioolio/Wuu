import { describe, expect, it } from 'vitest';
import { canonicalRepairPath, remapRepairData, repairedAudioPath, sameRepairPath } from './repair-data';

const oldPath = 'D:\\Wuu-main\\output\\？ - 歌手\\？ - 歌手.flac';
const newPath = 'D:\\Wuu-main\\output\\真名 - 歌手\\真名 - 歌手.flac';
const otherPath = 'D:\\Wuu-main\\output\\其他\\其他.mp3';
const songs = [{ audioPath: newPath, songName: '真名', artist: '歌手' }];

describe('repair path identity', () => {
  it('matches repair scan slash paths to the canonical library path', () => {
    expect(sameRepairPath(oldPath, oldPath.replace(/\\/g, '/'))).toBe(true);
    expect(canonicalRepairPath([{ audioPath: oldPath, songName: '？', artist: '歌手' }], oldPath.replace(/\\/g, '/'))).toBe(oldPath);
  });

  it('finds the actual fresh audio path from a successful repair result', () => {
    expect(repairedAudioPath(songs, { folder: '真名 - 歌手' })).toBe(newPath);
    expect(repairedAudioPath(songs, { audioPath: newPath.replace(/\\/g, '/') })).toBe(newPath);
    expect(repairedAudioPath(songs, { folder: '缺失' })).toBeNull();
  });

  it('preserves collections, history and selection when the file is renamed', () => {
    const original = {
      collections: [{ id: 'liked', name: '喜欢', songs: [oldPath, otherPath, newPath], createdAt: 1 }],
      dislikes: { [oldPath]: 50 }, likeTimes: { [oldPath]: 10 },
      stats: { [oldPath]: { plays: 4, duration: 72 }, [otherPath]: { plays: 2, duration: 20 } },
      progress: { [oldPath]: 30 }, actualDuration: { [oldPath]: 120 },
      lastSession: { audioPath: oldPath, t: 30 }, shareSelection: [oldPath, newPath],
    };
    const next = remapRepairData(original, oldPath.replace(/\\/g, '/'), newPath);
    expect(next.collections[0].songs).toEqual([newPath, otherPath]);
    expect(next.dislikes).toEqual({ [newPath]: 50 });
    expect(next.likeTimes).toEqual({ [newPath]: 10 });
    expect(next.stats).toEqual({ [newPath]: { plays: 4, duration: 72 }, [otherPath]: { plays: 2, duration: 20 } });
    expect(next.progress).toEqual({ [newPath]: 30 });
    expect(next.actualDuration).toEqual({ [newPath]: 120 });
    expect(next.lastSession).toEqual({ audioPath: newPath, t: 30 });
    expect(next.shareSelection).toEqual([newPath]);
    expect(original.collections[0].songs).toEqual([oldPath, otherPath, newPath]);
  });

  it('retains prior target history and freshly measured duration', () => {
    const next = remapRepairData({ collections: [], dislikes: {}, likeTimes: {}, progress: {}, lastSession: null, shareSelection: [],
      stats: { [oldPath]: { plays: 4, duration: 72 }, [newPath]: { plays: 1, duration: 8 } }, actualDuration: { [oldPath]: 120, [newPath]: 123 } }, oldPath, newPath);
    expect(next.stats[newPath]).toEqual({ plays: 5, duration: 80 });
    expect(next.actualDuration[newPath]).toBe(123);
  });
});
