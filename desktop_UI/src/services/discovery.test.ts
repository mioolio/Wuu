import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, PreviewSong } from '../types';
import type { RemoteSong } from '../features/online/common';

const mocks = vi.hoisted(() => ({
  api: { discover: vi.fn(), preview: vi.fn(), importSong: vi.fn() },
  state: { songs: [] as Song[], player: { playing: false, preview: null as PreviewSong | null }, reloadSongs: vi.fn() },
  playPreview: vi.fn(), notify: vi.fn(),
}));
vi.mock('../api', () => ({ getBridge: () => mocks.api }));
vi.mock('../store', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./player', () => ({ playerService: { playPreview: mocks.playPreview } }));
vi.mock('../ui', () => ({ notify: mocks.notify }));

const remote = (id: string, name = `曲目 ${id}`, artist = '真实艺人'): RemoteSong => ({ id, source: 'netease', name, artist, cover: `https://example.com/${id}.jpg` });
const local = (name: string, artist = '真实艺人', extra: Record<string, unknown> = {}): Song => ({ audioPath: name, songName: name, artist, ...extra });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();vi.clearAllMocks();
  mocks.state.songs = [];mocks.state.player = { playing: false, preview: null };
  mocks.state.reloadSongs.mockResolvedValue(undefined);
  mocks.api.preview.mockResolvedValue({ ok: true, data: { url: 'https://example.com/audio.mp3', meta: { title: '接口曲名', artist: '接口艺人', cover: 'https://example.com/real-cover.jpg' }, rawText: '[00:01]接口歌词' } });
  mocks.api.importSong.mockResolvedValue({ ok: true });
  let generation = 0;
  // Mirrors the existing player's resolver version guard and swallowed errors.
  mocks.playPreview.mockImplementation(async (request: PreviewSong) => {
    const version = ++generation;
    try {
      const resolved = request.resolve ? await request.resolve() : request;
      if (version === generation) mocks.state.player = { playing: true, preview: { ...resolved, queue: request.queue } };
    } catch { /* playerService reports a notification and leaves prior state */ }
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('external discovery identity', () => {
  it('excludes normalized titles with a shared artist across sources without conflating other artists or versions', async () => {
    const { isNewDiscoverySong } = await import('./discovery');
    const library = [local('Ｈｅｌｌｏ！', 'Singer A、Singer B', { source: 'kugou', trackId: 'old' })];
    expect(isNewDiscoverySong(remote('1', ' hello ', 'Singer B / Guest'), library)).toBe(false);
    expect(isNewDiscoverySong(remote('2', 'Hello', 'Different artist'), library)).toBe(true);
    expect(isNewDiscoverySong(remote('3', 'Hello (Live)', 'Singer A'), library)).toBe(true);
    expect(isNewDiscoverySong(remote('4', 'Hello', 'Unknown Artist'), library)).toBe(false);
  });

  it('uses explicit provider identity, never a scanner row id', async () => {
    const { isNewDiscoverySong, discoverySongKey } = await import('./discovery');
    const song = remote('42');
    expect(discoverySongKey({ ...song, source: '网易云音乐' })).toBe('netease:42');
    expect(isNewDiscoverySong(song, [local('renamed', 'Other artist', { source: 'music163', trackId: '42' })])).toBe(false);
    expect(isNewDiscoverySong(song, [local('renamed', 'Other artist', { source: 'netease', id: '42' })])).toBe(true);
    expect(isNewDiscoverySong({ ...song, source: 'kugou' }, [])).toBe(false);
    expect(isNewDiscoverySong({ ...song, artist: '' }, [])).toBe(false);
  });

  it('conservatively excludes a matching local title when its artist is missing or unknown', async () => {
    const { isNewDiscoverySong } = await import('./discovery');
    for (const artist of ['', '未知艺人', '未知歌手', 'Unknown Artist']) {
      const library = [local('Ｈｅｌｌｏ！', artist)];
      expect(isNewDiscoverySong(remote('1', 'Hello', 'Known artist'), library)).toBe(false);
      expect(isNewDiscoverySong(remote('2', 'Hello (Live)', 'Known artist'), library)).toBe(true);
    }
  });
});

describe('public catalog session', () => {
  it('returns arrays, removes local/provider/content duplicates and never substitutes the library', async () => {
    const { createDiscoverySession } = await import('./discovery');
    const candidates = [remote('1', '本地'), remote('2'), remote('2'), remote('3', '曲目 2'), remote('4'), remote('5')];
    const fetchCandidates = vi.fn().mockResolvedValue(candidates);
    const result = await createDiscoverySession({ fetchCandidates, random: () => .99 }).next([local('本地')], { limit: 4 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.map(song => song.id)).toEqual(['5', '4', '3']);
    expect(fetchCandidates).toHaveBeenCalledTimes(4);
    expect(result.some(song => song.name === '本地')).toBe(false);
  });

  it('uses unused cached songs on another batch and excludes newly imported tracks immediately', async () => {
    const { createDiscoverySession, isNewDiscoverySong } = await import('./discovery');
    const fetchCandidates = vi.fn().mockResolvedValue(Array.from({ length: 10 }, (_, index) => remote(String(index))));
    const session = createDiscoverySession({ fetchCandidates, random: () => .99, now: () => 0 });
    const first = await session.next([], { limit: 4 });
    const second = await session.next([local('曲目 5')], { limit: 4 });
    expect(first.map(song => song.id)).toEqual(['9', '8', '7', '6']);
    expect(second.map(song => song.id)).toEqual(['4', '3', '2', '1']);
    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    expect(isNewDiscoverySong(first[0], [local('曲目 9')])).toBe(false);
  });

  it('avoids previous batches even when a refreshed catalog repeats them', async () => {
    const { createDiscoverySession } = await import('./discovery');
    let now = 0;
    const fetchCandidates = vi.fn().mockResolvedValueOnce([remote('1'), remote('2'), remote('3')]).mockResolvedValue([remote('1'), remote('2'), remote('4')]);
    const session = createDiscoverySession({ fetchCandidates, random: () => .99, now: () => now });
    expect((await session.next([], { limit: 2 })).map(song => song.id)).toEqual(['3', '2']);
    now = 300001;
    expect((await session.next([], { limit: 2 })).map(song => song.id)).toEqual(['4', '1']);
    expect(fetchCandidates.mock.calls.map(call => call[0])).toEqual([0, 1]);
  });

  it('shows provider failures and exhaustion honestly, including an empty library', async () => {
    const { createDiscoverySession } = await import('./discovery');
    mocks.api.discover.mockResolvedValue({ ok: false, message: '公开目录网络失败' });
    await expect(createDiscoverySession().next([])).rejects.toThrow('公开目录网络失败');
    expect(mocks.api.discover).toHaveBeenCalledWith({ page: 0 });
    await expect(createDiscoverySession({ fetchCandidates: async () => [remote('1', '已有')] }).next([local('已有')])).rejects.toThrow('暂无歌库以外的新曲');
    await expect(createDiscoverySession({ fetchCandidates: async () => [] }).next([])).rejects.toThrow('暂无歌库以外的新曲');
  });

  it('does not send an IPC for immediately aborted requests', async () => {
    const { createDiscoverySession } = await import('./discovery');
    const fetchCandidates = vi.fn();
    const controller = new AbortController();
    const task = createDiscoverySession({ fetchCandidates }).next([], { signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchCandidates).not.toHaveBeenCalled();
  });

  it('cannot let a late superseded response replace the pool or history', async () => {
    const { createDiscoverySession } = await import('./discovery');
    const old = deferred<RemoteSong[]>();
    const fetchCandidates = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([remote('2'), remote('3')]);
    const session = createDiscoverySession({ fetchCandidates, random: () => .99 });
    const previous = session.next([], { limit: 1 });
    const previousError = previous.catch(error => error);
    await Promise.resolve();
    expect((await session.next([], { limit: 1 }))[0].id).toBe('3');
    old.resolve([remote('1')]);
    expect(await previousError).toMatchObject({ name: 'AbortError' });
    expect((await session.next([], { limit: 1 }))[0].id).toBe('2');
    expect(fetchCandidates).toHaveBeenCalledTimes(2);
  });

  it('caps the total request budget across refills and ignores late timeout results', async () => {
    vi.useFakeTimers();
    const { createDiscoverySession } = await import('./discovery');
    const fetchCandidates = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 60)));
    const session = createDiscoverySession({ fetchCandidates, timeoutMs: 100 });
    const failure = session.next([]).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect((await failure).message).toContain('超时');
    expect(fetchCandidates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    fetchCandidates.mockResolvedValue([remote('new')]);
    expect((await session.next([], { limit: 1 }))[0].id).toBe('new');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('real preview and standard import integration', () => {
  it('builds a four-song remote resolver queue, uses provider metadata and saves through the existing bridge', async () => {
    const { playDiscoverySong, saveDiscoverySong } = await import('./discovery');
    const batch = ['a', 'b', 'c', 'd'].map(id => remote(id));
    expect(await playDiscoverySong(batch[2], batch)).toBe(true);
    expect(mocks.api.preview).toHaveBeenCalledExactlyOnceWith('c', 'standard');
    const preview = mocks.state.player.preview!;
    expect(preview).toMatchObject({ name: '接口曲名', artist: '接口艺人', cover: 'https://example.com/real-cover.jpg', lyric: '[00:01]接口歌词', source: 'netease', original: batch[2] });
    expect(preview.queue).toHaveLength(4);
    expect(preview.queue!.every(item => !item.url && typeof item.resolve === 'function' && item.original.source === 'netease')).toBe(true);
    await preview.queue![1].resolve!();
    expect(mocks.api.preview).toHaveBeenLastCalledWith('a', 'standard');
    await saveDiscoverySong(batch[2]);
    expect(mocks.api.importSong).toHaveBeenCalledExactlyOnceWith('c', 'standard', batch[2], null);
    expect(mocks.state.reloadSongs).toHaveBeenCalledOnce();
  });

  it('returns false when the player swallows a resolver error, even if the old preview has the same identity', async () => {
    const { playDiscoverySong } = await import('./discovery');
    const song = remote('a');
    mocks.state.player = { playing: true, preview: { name: 'old', artist: 'old', original: song, url: 'https://example.com/old.mp3' } };
    mocks.api.preview.mockResolvedValue({ ok: false, message: '无合法试听地址' });
    expect(await playDiscoverySong(song)).toBe(false);
    expect(mocks.state.player.preview?.name).toBe('old');
  });

  it('lets the newest preview win when an earlier click resolves late', async () => {
    const { playDiscoverySong } = await import('./discovery');
    const old = deferred<unknown>();
    mocks.api.preview.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, data: { url: 'https://example.com/b.mp3' } });
    const first = playDiscoverySong(remote('a'));
    await Promise.resolve();
    expect(await playDiscoverySong(remote('b'))).toBe(true);
    old.resolve({ ok: true, data: { url: 'https://example.com/a.mp3' } });
    expect(await first).toBe(false);
    expect(mocks.state.player.preview?.original.id).toBe('b');
  });

  it('does not import trial/unavailable tracks or duplicates added during the availability check', async () => {
    const { saveDiscoverySong } = await import('./discovery');
    mocks.api.preview.mockResolvedValueOnce({ ok: true, data: { url: 'https://example.com/trial.mp3', isPreview: true } });
    await expect(saveDiscoverySong(remote('a'))).rejects.toThrow('试听片段');
    mocks.api.preview.mockResolvedValueOnce({ ok: false, message: '音频不可用' });
    await expect(saveDiscoverySong(remote('b'))).rejects.toThrow('音频不可用');
    const check = deferred<unknown>();
    mocks.api.preview.mockReturnValueOnce(check.promise);
    const save = saveDiscoverySong(remote('c'));
    await Promise.resolve();
    mocks.state.songs = [local('曲目 c')];
    check.resolve({ ok: true, data: { url: 'https://example.com/c.mp3' } });
    await save;
    expect(mocks.api.importSong).not.toHaveBeenCalled();
  });

  it('reports an import failure without claiming success or refreshing the library', async () => {
    const { saveDiscoverySong } = await import('./discovery');
    mocks.api.importSong.mockResolvedValue({ ok: false, message: '下载失败' });
    await expect(saveDiscoverySong(remote('a'))).rejects.toThrow('下载失败');
    expect(mocks.state.reloadSongs).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
