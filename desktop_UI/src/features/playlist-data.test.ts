import { describe, expect, it } from 'vitest';
import { collectSharingSongs, remoteDownloadProgress, shareStatus } from './playlist-data';
import type { SharedPlaylist } from './playlist-data';
import type { Collection, Song } from '../types';

describe('分享歌单选择', () => {
  const first: Song = { audioPath: 'one.m4a', songName: '第一首', artist: '艺人' };
  const second: Song = { audioPath: 'two.m4a', songName: '第二首', artist: '艺人' };
  const collections: Collection[] = [{ id: 'favorites', name: '收藏', createdAt: 1, songs: ['one.m4a', 'missing.m4a'] }];
  it('合并来源与快捷选择，并过滤已不存在的文件与重复歌曲', () => {
    expect(collectSharingSongs([first, second, first], collections, new Set(['favorites']), new Set(['two.m4a']), new Set())).toEqual([first, second]);
  });
  it('用户排除的歌曲在多个来源中均不再导出', () => {
    expect(collectSharingSongs([first, second], collections, new Set(['all', 'favorites']), new Set(['one.m4a']), new Set(['one.m4a']))).toEqual([second]);
  });
});

describe('分享访问限制', () => {
  const record: SharedPlaylist = { id: 'share', name: '分享', songCount: 1, createdAt: 1, expireAt: 0, maxUses: 0, usedCount: 20 };
  it('允许永久且不限次的分享', () => expect(shareStatus(record, 1000)).toBe('有效'));
  it('同时命中时间与次数限制时优先显示过期', () => expect(shareStatus({ ...record, expireAt: 999, maxUses: 20 }, 1000)).toBe('已过期'));
  it('达到访问次数即不可再用', () => expect(shareStatus({ ...record, maxUses: 20 }, 1000)).toBe('次数已用尽'));
});

describe('歌单下载进度', () => {
  it('音频下载完成后保留封面、歌词和信息文件的进度', () => {
    expect(remoteDownloadProgress('audio', 100)).toBe(80);
    expect(remoteDownloadProgress('info', 100)).toBe(100);
  });
  it('钳制错误百分比，保证正常阶段的进度范围', () => {
    expect(remoteDownloadProgress('lrc', -10)).toBe(90);
    expect(remoteDownloadProgress('lrc', 120)).toBe(98);
  });
});
