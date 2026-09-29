import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bridges: {} as Record<string, any>,
  state: { songs: [] as any[], settings: { coverUnify: true }, reloadSongs: vi.fn(async () => {}) },
  playPreview: vi.fn(async (_preview: any) => {}),
  notify: vi.fn(),
}));
vi.mock('../../api', () => ({ getBridge: (name: string) => mocks.bridges[name], errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock('../../store', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../../services/player', () => ({ playerService: { playPreview: mocks.playPreview } }));
vi.mock('../../ui', () => ({ notify: mocks.notify, formatTime: () => '' }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.state.songs = []; mocks.state.settings.coverUnify = true; mocks.bridges = {};
});

describe('online music service bridge behavior', () => {
  it('does not redownload a song already present under a shared artist', async () => {
    mocks.state.songs = [{ songName: 'Song', artist: 'Artist A / Artist B' }];
    mocks.bridges.neteaseAPI = { importSong: vi.fn() };
    const { saveFreeSong } = await import('./freeMusic');
    await saveFreeSong({ id: 11, name: ' song ', artist: 'Artist B', source: 'netease' });
    expect(mocks.bridges.neteaseAPI.importSong).not.toHaveBeenCalled();
    expect(mocks.state.reloadSongs).not.toHaveBeenCalled();
  });
  it('still saves audio when the lyric service has no lyrics', async () => {
    mocks.bridges.freeMusicAPI = { lyric: vi.fn(async () => ({ ok: false, message: '无歌词' })), saveToLibrary: vi.fn(async () => ({ ok: true, data: { path: 'saved.mp3' } })) };
    const song = { id: '1', source: 'qq', name: 'Instrumental', artist: 'Artist' };
    const { saveFreeSong } = await import('./freeMusic');
    await saveFreeSong(song);
    expect(mocks.bridges.freeMusicAPI.saveToLibrary).toHaveBeenCalledWith(song, '');
    expect(mocks.state.reloadSongs).toHaveBeenCalledOnce();
  });
  it('routes NetEase downloads to the existing importer and retains its original metadata', async () => {
    mocks.bridges.freeMusicAPI = { saveToLibrary: vi.fn() };
    mocks.bridges.neteaseAPI = { importSong: vi.fn(async () => ({ ok: true })) };
    const original = { id: 25, _raw: { fee: 1 } };
    const { saveFreeSong } = await import('./freeMusic');
    await saveFreeSong({ id: 25, name: 'Song', artist: 'Artist', source: 'netease', _originSong: original });
    expect(mocks.bridges.neteaseAPI.importSong).toHaveBeenCalledWith(25, 'lossless', original, null);
    expect(mocks.bridges.freeMusicAPI.saveToLibrary).not.toHaveBeenCalled();
  });
  it('passes Qishui session and video metadata through the video importer', async () => {
    mocks.bridges.qishuiAPI = {
      loginStatus: vi.fn(async () => ({ ok: true, loggedIn: true, userInfo: { aid: '386088', sessionid: 'session' } })),
      importSong: vi.fn(async () => ({ ok: true })),
    };
    const song = { id: '12', vid: 'video-id', name: 'Clip', artist: 'Artist', source: 'qishui', isUgcClip: true };
    const { saveFreeSong } = await import('./freeMusic'); await saveFreeSong(song);
    expect(mocks.bridges.qishuiAPI.importSong).toHaveBeenCalledWith('386088', 'session', '12', 'high', song, 'video', 'video-id');
  });
  it('falls back to another search result before making a cross-source request', async () => {
    const first = { id: '1', source: 'qq', name: 'Song', artist: 'Artist' };
    const second = { id: '2', source: 'kuwo', name: 'Song', artist: 'Artist' };
    mocks.bridges.freeMusicAPI = {
      inspect: vi.fn(async (song: any) => ({ ok: true, data: { valid: song.source === 'kuwo', size: '3 MB', bitrate: '320k' } })),
      switchSource: vi.fn(), streamUrl: vi.fn(async () => ({ ok: true, data: 'https://audio.example/song.mp3' })), lyric: vi.fn(async () => ({ ok: true, data: '[00:01]Song' })),
    };
    const { resolveFreePreview } = await import('./freeMusic');
    const preview = await resolveFreePreview(first, [first, second]);
    expect(preview.source).toBe('kuwo');
    expect(preview.original._freeMusicPreview).toBe(true);
    expect(preview.lyric).toBe('[00:01]Song');
    expect(mocks.bridges.freeMusicAPI.switchSource).not.toHaveBeenCalled();
  });
  it('reserves a player request before resolving a URL and resolves queue entries only on demand', async () => {
    mocks.bridges.freeMusicAPI = {
      inspect: vi.fn(async () => ({ ok: true, data: { valid: true } })),
      streamUrl: vi.fn(async () => ({ ok: true, data: 'https://audio.example/song.mp3' })), lyric: vi.fn(async () => ({ ok: true, data: '' })),
    };
    const songs = [{ id: '1', source: 'qq', name: 'First', artist: 'Artist' }, { id: '2', source: 'qq', name: 'Second', artist: 'Artist' }];
    const { playFreePreview } = await import('./freeMusic'); await playFreePreview(songs[0], songs);
    expect(mocks.bridges.freeMusicAPI.inspect).not.toHaveBeenCalled();
    const pending = mocks.playPreview.mock.calls[0][0];
    expect(pending.url).toBe(''); expect(pending.queue).toHaveLength(2);
    const next = await pending.queue[1].resolve();
    expect(next.name).toBe('Second'); expect(next.original._freeMusicPreview).toBe(true);
    expect(mocks.bridges.freeMusicAPI.inspect).toHaveBeenCalledOnce();
  });
  it.each([true, false])('respects coverUnify=%s when an unavailable source falls back', async (coverUnify) => {
    mocks.state.settings.coverUnify = coverUnify;
    const original = { id: '1', source: 'qq', name: 'Song', artist: 'Artist', cover: 'https://cover.example/original.jpg' };
    const alternative = { ...original, id: '2', source: 'kuwo', cover: 'https://cover.example/alternative.jpg' };
    mocks.bridges.freeMusicAPI = {
      inspect: vi.fn(async (song: any) => ({ ok: true, data: { valid: song.source === 'kuwo' } })),
      streamUrl: vi.fn(async () => ({ ok: true, data: 'https://audio.example/song.mp3' })), lyric: vi.fn(async () => ({ ok: true, data: '' })),
    };
    const { resolveFreePreview } = await import('./freeMusic');
    const resolved = await resolveFreePreview(original, [original, alternative]);
    expect(resolved.cover).toBe(coverUnify ? original.cover : alternative.cover);
    expect(resolved.original.cover).toBe(alternative.cover);
  });
  it.each([true, false])('respects coverUnify=%s for an explicit source switch', async (coverUnify) => {
    mocks.state.settings.coverUnify = coverUnify;
    const original = { id: '1', source: 'qq', name: 'Song', artist: 'Artist', cover: 'https://cover.example/original.jpg' };
    const alternative = { ...original, id: '2', source: 'kuwo', cover: 'https://cover.example/alternative.jpg' };
    mocks.bridges.freeMusicAPI = {
      inspect: vi.fn(async () => ({ ok: true, data: { valid: true } })),
      streamUrl: vi.fn(async () => ({ ok: true, data: 'https://audio.example/song.mp3' })), lyric: vi.fn(async () => ({ ok: true, data: '' })),
    };
    const { playFreePreview } = await import('./freeMusic');
    await playFreePreview(original, [original, alternative], undefined, true);
    const pending = mocks.playPreview.mock.calls[0][0];
    const resolved = await pending.resolve();
    expect(resolved.cover).toBe(coverUnify ? original.cover : alternative.cover);
    expect(resolved.original._freeMusicInitialCover).toBe(original.cover);
  });
  it('keeps the same initial cover across consecutive source switches', async () => {
    const original = { id: '1', source: 'qq', name: 'Song', artist: 'Artist', cover: 'https://cover.example/original.jpg' };
    const second = { ...original, id: '2', source: 'kuwo', cover: 'https://cover.example/second.jpg' };
    const third = { ...original, id: '3', source: 'migu', cover: 'https://cover.example/third.jpg' };
    mocks.bridges.freeMusicAPI = {
      inspect: vi.fn(async () => ({ ok: true, data: { valid: true } })),
      streamUrl: vi.fn(async () => ({ ok: true, data: 'https://audio.example/song.mp3' })), lyric: vi.fn(async () => ({ ok: true, data: '' })),
    };
    const { playFreePreview } = await import('./freeMusic');
    await playFreePreview(original, [original, second], undefined, true);
    const switched = await mocks.playPreview.mock.calls[0][0].resolve();
    await playFreePreview(switched.original, [second, third], undefined, true);
    const switchedAgain = await mocks.playPreview.mock.calls[1][0].resolve();
    expect(switchedAgain.cover).toBe(original.cover);
    expect(switchedAgain.source).toBe('migu');
  });
  it('limits audio probes to three concurrent requests', async () => {
    const releases: (() => void)[] = []; let active = 0; let maximum = 0;
    mocks.bridges.freeMusicAPI = { inspect: vi.fn(() => new Promise(resolve => { active++; maximum = Math.max(maximum, active); releases.push(() => { active--; resolve({ ok: true, data: { valid: true } }); }); })) };
    const { inspectSong } = await import('./freeMusic');
    const pending = Array.from({ length: 5 }, (_, index) => inspectSong({ id: index + 1, source: 'qq', name: `Song ${index}` }));
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.slice(0, 3).forEach(release => release());
    await vi.waitFor(() => expect(releases).toHaveLength(5));
    releases.slice(3).forEach(release => release());
    await Promise.all(pending);
    expect(maximum).toBe(3);
  });
});
