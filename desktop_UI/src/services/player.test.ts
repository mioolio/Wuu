import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewSong, Song } from '../types';

class FakeMedia extends EventTarget {
  static HAVE_FUTURE_DATA = 3;
  id = ''; playsInline = true; preload = ''; crossOrigin = ''; volume = 1;
  controls = false; style = {}; src = ''; currentTime = 0; duration = 120;
  readyState = 4; paused = true; seeking = false; playbackRate = 1; error: MediaError | null = null;
  failedPaths = new Set<string>();
  async play() {
    if ([...this.failedPaths].some(path => this.src.includes(path))) throw new Error('Media decoding failed');
    this.paused = false; this.dispatchEvent(new Event('playing'));
  }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() { this.currentTime = 0; this.dispatchEvent(new Event('loadedmetadata')); }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}
const songs: Song[] = [
  { audioPath: 'C:/one.aac', songName: 'One', artist: 'Artist', realDuration: 120 },
  { audioPath: 'C:/two.aac', songName: 'Two', artist: 'Artist', realDuration: 120 },
  { audioPath: 'C:/three.aac', songName: 'Three', artist: 'Artist', realDuration: 120 },
];
let service: (typeof import('./player'))['playerService'];
let store: (typeof import('../store'))['useAppStore'];
let media: FakeMedia;
const reportFailed = vi.fn(async () => {});
const synchronize = vi.fn(async () => {});
const extractColor = vi.fn(async (_path: string): Promise<unknown> => null);
const extractColorURL = vi.fn(async (_url: string): Promise<unknown> => null);
const desktopSend = vi.fn();
const rootProperties = new Map<string, string>();
const getSongs = vi.fn(async (): Promise<Song[]> => songs);
const getUserData = vi.fn(async (): Promise<any> => ({}));
let durationListener: (payload: unknown) => void;
let metadataListener: (payload: unknown) => void;
const onDurationUpdate = vi.fn(listener => { durationListener = listener; return () => {}; });
const onSongMetadataUpdate = vi.fn(listener => { metadataListener = listener; return () => {}; });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const mediaSession = { metadata: null as MediaMetadata | null, setActionHandler: vi.fn(), setPositionState: vi.fn(), playbackState: 'none' };
class FakeMediaMetadata {
  constructor(data: MediaMetadataInit) { Object.assign(this, data); }
}

beforeAll(async () => {
  media = new FakeMedia();
  const fakeWindow = Object.assign(new EventTarget(), {
    musicAPI: { getSongs, getUserData, getLyrics: async () => '', saveUserData: async () => {}, onDurationUpdate, onSongMetadataUpdate, extractCoverColor: extractColor, extractCoverColorFromURL: extractColorURL },
    desktopLyric: { onClosed: () => () => {}, onLockChanged: () => () => {}, onBoundsSaved: () => () => {}, send: desktopSend, toggle: async () => {}, lock: async () => {} },
    stateAPI: { updateDesktopState: synchronize }, repairAPI: { reportPlayFailed: reportFailed },
    MediaMetadata: FakeMediaMetadata,
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('HTMLMediaElement', FakeMedia);
  vi.stubGlobal('navigator', { mediaSession });
  vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
  vi.stubGlobal('document', { createElement: () => media, documentElement: { style: { setProperty: (key: string, value: string) => rootProperties.set(key, value), removeProperty: (key: string) => rootProperties.delete(key) } } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  service = (await import('./player')).playerService;
  store = (await import('../store')).useAppStore;
  await service.initialize();
});

beforeEach(() => {
  service.stop(); media.failedPaths.clear(); reportFailed.mockClear(); synchronize.mockClear();
  extractColor.mockReset().mockResolvedValue(null); extractColorURL.mockReset().mockResolvedValue(null); desktopSend.mockClear();
  getSongs.mockReset().mockResolvedValue(songs); mediaSession.metadata = null;
  getUserData.mockReset().mockResolvedValue({});
  store.getState().setPlayer({ desktopLyricOn: false });
  store.setState({ songs: [...songs], collections: [], stats: {}, dislikes: {}, progress: {}, actualDuration: {}, lastSession: null, view: 'home', activeCollectionId: null,
    settings: { ...store.getState().settings, playMode: 1, volume: 1, fadePause: false, themeFollowCover: false, colorIntensity: 0.85 } });
});

describe('cover colors stay in sync with the active song and desktop lyrics', () => {
  it('sends real song authors through desktop state and clears them on the next song', async () => {
    const named = { ...songs[0], lyricist: 'Actual Writer', composer: 'Actual Composer' };
    store.setState({ songs: [named, songs[1]] });
    await service.playSong(named);
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({ songInfo: expect.objectContaining({ audioPath: named.audioPath, lyricist: 'Actual Writer', composer: 'Actual Composer' }) }));
    await service.playSong(songs[1]);
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({ songInfo: expect.objectContaining({ audioPath: songs[1].audioPath, lyricist: '', composer: '' }) }));
  });
  it('changes the whole window palette immediately when following is enabled and restores neutral surfaces when disabled', async () => {
    extractColor.mockResolvedValue([{ r: 206, g: 76, b: 87, weight: 1 }]);
    const song = { ...songs[0], coverPath: 'C:/cover.png' };
    store.setState({ songs: [song] });
    await service.playSong(song);
    await vi.waitFor(() => expect(rootProperties.get('--cover-color')).toBe('rgb(206, 76, 87)'));
    expect(rootProperties.get('--shell-surface')).toBe('rgb(23, 23, 25)');
    store.getState().setSettings({ themeFollowCover: true });
    expect(rootProperties.get('--shell-surface')).not.toBe('rgb(23, 23, 25)');
    expect(rootProperties.get('--shell-chrome')).not.toBe('rgb(20, 20, 23)');
    expect(extractColor).toHaveBeenCalledTimes(1);
    store.getState().setSettings({ themeFollowCover: false });
    expect(rootProperties.get('--shell-surface')).toBe('rgb(23, 23, 25)');
    expect(rootProperties.get('--shell-chrome')).toBe('rgb(20, 20, 23)');
    expect(rootProperties.get('--shell-atmosphere')).toBe('rgba(0, 0, 0, 0)');
    expect(rootProperties.get('--cover-color')).toBe('rgb(206, 76, 87)');
  });
  it('refreshes same-song artwork and media metadata after a library reload without repeating work on time updates', async () => {
    const song = { ...songs[0], coverPath: 'C:/original.png' };
    store.setState({ songs: [song] });
    extractColor.mockResolvedValue([{ r: 206, g: 76, b: 87 }]);
    await service.playSong(song);
    extractColor.mockClear().mockResolvedValue([{ r: 42, g: 146, b: 166 }]);
    const updated = { ...song, coverPath: 'C:/repaired.png' };
    getSongs.mockResolvedValue([updated]);
    await store.getState().reloadSongs();
    await vi.waitFor(() => expect(rootProperties.get('--cover-color')).toBe('rgb(42, 146, 166)'));
    expect(extractColor).toHaveBeenCalledExactlyOnceWith(updated.coverPath);
    expect(mediaSession.metadata?.artwork).toEqual([{ src: 'music:///C:/repaired.png' }]);
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({ songInfo: expect.objectContaining({ coverPath: updated.coverPath }) }));
    for (let time = 1; time <= 5; time++) {
      media.currentTime = time; media.dispatchEvent(new Event('timeupdate'));
    }
    getSongs.mockResolvedValue([{ ...updated, realDuration: 130 }]);
    await store.getState().reloadSongs();
    expect(extractColor).toHaveBeenCalledTimes(1);
    getSongs.mockResolvedValue([{ ...updated, coverPath: null }]);
    await store.getState().reloadSongs();
    expect(rootProperties.get('--cover-color')).toBe('rgb(251, 114, 153)');
    expect(mediaSession.metadata?.artwork).toEqual([]);
  });
  it.each(['resolve', 'reject'] as const)('ignores an older same-song extraction that later %ss after a cover refresh', async outcome => {
    let resolveOld!: (color: unknown) => void, rejectOld!: (reason: Error) => void;
    extractColor.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
    extractColor.mockResolvedValue([{ r: 42, g: 146, b: 166 }]);
    const original = { ...songs[0], coverPath: 'C:/old.png' };
    store.setState({ songs: [original] });
    await service.playSong(original);
    getSongs.mockResolvedValue([{ ...original, coverPath: 'C:/new.png' }]);
    await store.getState().reloadSongs();
    await vi.waitFor(() => expect(rootProperties.get('--cover-color')).toBe('rgb(42, 146, 166)'));
    if (outcome === 'resolve') resolveOld([{ r: 206, g: 76, b: 87 }]);
    else rejectOld(new Error('Old cover disappeared'));
    await Promise.resolve();
    expect(rootProperties.get('--cover-color')).toBe('rgb(42, 146, 166)');
    expect(mediaSession.metadata?.artwork).toEqual([{ src: 'music:///C:/new.png' }]);
  });
  it('reads the palette array and sends the latest color when the desktop window opens later', async () => {
    extractColor.mockResolvedValue([{ r: 206, g: 76, b: 87, weight: 1 }]);
    const song = { ...songs[0], coverPath: 'C:/cover.png' };
    store.setState({ songs: [song], settings: { ...store.getState().settings, themeFollowCover: false } });
    await service.playSong(song);
    await vi.waitFor(() => expect(rootProperties.get('--cover-color')).toBe('rgb(206, 76, 87)'));
    expect(rootProperties.get('--cover-accent')).not.toContain('undefined');
    await service.toggleDesktopLyric();
    expect(desktopSend).toHaveBeenCalledWith({ type: 'color', color: { r: 206, g: 76, b: 87 } });
    desktopSend.mockClear(); service.stop();
    expect(desktopSend).toHaveBeenCalledWith({ type: 'info', info: { title: '', artist: '' } });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'time', t: 0, playing: false });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'color', color: null });
  });
  it('routes remote library covers to the URL decoder and local preview covers to the file decoder', async () => {
    const song = { ...songs[0], coverPath: 'https://example.test/cover.png' };
    store.setState({ songs: [song] });
    await service.playSong(song);
    expect(extractColorURL).toHaveBeenCalledWith(song.coverPath);
    expect(extractColor).not.toHaveBeenCalled();
    await service.playPreview({ name: 'Local art', artist: 'Artist', url: 'https://example.test/song.mp3', cover: 'C:/cover.png' });
    expect(extractColor).toHaveBeenCalledWith('C:/cover.png');
  });
  it('ignores a delayed old color request and resets colors when playback stops', async () => {
    let resolveOld!: (color: unknown) => void;
    extractColor.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    extractColor.mockResolvedValue([{ r: 42, g: 146, b: 166 }]);
    const first = { ...songs[0], coverPath: 'C:/first.png' }, second = { ...songs[1], coverPath: 'C:/second.png' };
    store.setState({ songs: [first, second] });
    await service.playSong(first); await service.playSong(second);
    await vi.waitFor(() => expect(rootProperties.get('--cover-color')).toBe('rgb(42, 146, 166)'));
    resolveOld([{ r: 206, g: 76, b: 87 }]);
    await Promise.resolve();
    expect(rootProperties.get('--cover-color')).toBe('rgb(42, 146, 166)');
    service.stop();
    expect(rootProperties.get('--cover-color')).toBe('rgb(251, 114, 153)');
  });
  it('uses the fallback after a failed current artwork request', async () => {
    extractColor.mockRejectedValue(new Error('Unreadable cover'));
    const song = { ...songs[0], coverPath: 'C:/broken.png' };
    store.setState({ songs: [song] });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await service.playSong(song);
    await vi.waitFor(() => expect(warning).toHaveBeenCalled());
    expect(rootProperties.get('--cover-color')).toBe('rgb(251, 114, 153)');
    warning.mockRestore();
  });
});
afterAll(async () => { service.dispose(); await (await import('../store')).persistNow(); vi.unstubAllGlobals(); });

describe('React player service lifecycle and context', () => {
  it('updates path metadata during playback without reopening, seeking, or replacing manual genre choices', async () => {
    store.setState({genreOverrides:{[songs[0].audioPath]:['Jazz']}});
    await service.playSong(songs[0]); service.seek(42);
    const load=vi.spyOn(media,'load'), play=vi.spyOn(media,'play'), pause=vi.spyOn(media,'pause');
    metadataListener({audioPath:songs[0].audioPath,genre:['Rock']});
    await vi.waitFor(()=>expect(store.getState().player.song?.genre).toEqual(['Rock']));
    expect(store.getState().player).toMatchObject({song:{genre:['Rock']},playing:true,time:42});
    expect(store.getState().genreOverrides[songs[0].audioPath]).toEqual(['Jazz']);
    expect(media.currentTime).toBe(42); expect(media.paused).toBe(false);
    expect(load).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    load.mockRestore(); play.mockRestore(); pause.mockRestore();
  });
  it('rejects a late unresolved preview after the user picks a local song', async () => {
    let resolve!: (preview: PreviewSong) => void;
    const pending = service.playPreview({ name: 'Remote', artist: 'Artist', url: '', resolve: () => new Promise(done => { resolve = done; }) });
    await service.playSong(songs[1]);
    resolve({ name: 'Remote', artist: 'Artist', url: 'https://example.test/remote.mp3' });
    await pending;
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    expect(store.getState().player.preview).toBeNull();
    expect(media.src).toContain('two.aac');
  });
  it('keeps the selected collection queue when navigating elsewhere and filters dislikes', async () => {
    store.setState({ collections: [{ id: 'mix', name: 'Mix', songs: songs.map(song => song.audioPath), createdAt: 1 }], activeCollectionId: 'mix', view: 'liked', dislikes: { [songs[1].audioPath]: 1 } });
    await service.playSong(songs[0]);
    store.getState().setView('stats');
    service.next();
    await vi.waitFor(() => expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath));
    expect(service.getQueue().map(song => song.audioPath)).toEqual([songs[0].audioPath, songs[2].audioPath]);
  });
  it('restores local progress, safely seeks and persists it when switching to preview', async () => {
    store.setState({ progress: { [songs[0].audioPath]: 42 } });
    await service.playSong(songs[0]);
    expect(media.currentTime).toBe(42);
    service.seek(900);
    expect(media.currentTime).toBeCloseTo(119.97);
    service.seek(35);
    await service.playPreview({ name: 'Remote', artist: 'Other', url: 'https://example.test/song.mp3' });
    expect(store.getState().progress[songs[0].audioPath]).toBe(35);
    expect(store.getState().stats[songs[0].audioPath]?.plays).toBe(1);
    expect(Object.keys(store.getState().stats)).toEqual([songs[0].audioPath]);
  });
  it('automatically reports and skips a damaged local file without looping forever', async () => {
    media.failedPaths.add('one.aac'); media.failedPaths.add('two.aac');
    await service.playSong(songs[0]);
    await vi.waitFor(() => expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath));
    expect(reportFailed).toHaveBeenCalledTimes(2);
    expect(store.getState().player.playing).toBe(true);
    service.stop(); media.failedPaths.add('three.aac');
    await service.playSong(songs[0]);
    await vi.waitFor(() => expect(store.getState().player.playing).toBe(false));
    expect(reportFailed.mock.calls.length).toBeLessThanOrEqual(5);
  });
  it('keeps the old preview after a new resolver fails and avoids attributing its error to the old media', async () => {
    await service.playPreview({ name: 'Old', artist: 'Artist', url: 'https://example.test/old.mp3' });
    await service.playPreview({ name: 'New', artist: 'Artist', url: '', resolve: async () => { throw new Error('Unavailable'); } });
    expect(store.getState().player.preview?.name).toBe('Old');
    expect(store.getState().player.error).toBe('');
    expect(media.paused).toBe(false);
  });
  it('walks every queue slot even when identically named previews switch to a different platform', async () => {
    const queue: PreviewSong[] = [0,1,2].map(index => ({ name: 'Same name', artist: 'Artist', source: `platform-${index}`, original: { id: index, source: `platform-${index}` }, url: '', resolve: async () => ({
      name: 'Same name', artist: 'Artist', source: 'replacement', original: { id: `replacement-${index}`, source: 'replacement' }, url: `https://example.test/song-${index}.mp3`,
    }) }));
    await service.playPreview({ ...queue[0], queue });
    service.next();
    await vi.waitFor(() => expect(store.getState().player.preview?.url).toContain('song-1.mp3'));
    service.next();
    await vi.waitFor(() => expect(store.getState().player.preview?.url).toContain('song-2.mp3'));
    service.next(-1);
    await vi.waitFor(() => expect(store.getState().player.preview?.url).toContain('song-1.mp3'));
  });
});

describe('previous track follows playback rather than a replaced shuffle plan', () => {
  it('rewinds and advances the actual local path order across multiple shuffle rounds', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      store.getState().setSettings({ playMode: 2 });
      await service.playSong(songs[0]);
      const heard = [songs[0].audioPath];
      for (let step = 0; step < 7; step++) {
        service.next(); await flush();
        const path = store.getState().player.song!.audioPath;
        expect(path).not.toBe(heard.at(-1));
        heard.push(path);
      }
      const planned = random.mock.calls.length;
      for (let position = heard.length - 2; position >= 0; position--) {
        service.next(-1); await flush();
        expect(store.getState().player.song?.audioPath).toBe(heard[position]);
      }
      service.seek(31); service.next(-1); await flush();
      expect(store.getState().player.song?.audioPath).toBe(heard[0]);
      expect(media.currentTime).toBe(31);
      for (const path of heard.slice(1)) {
        service.next(); await flush();
        expect(store.getState().player.song?.audioPath).toBe(path);
      }
      expect(random).toHaveBeenCalledTimes(planned);
    } finally { random.mockRestore(); }
  });

  it('keeps manually selected history when a queue resets and when random mode is enabled later', async () => {
    await service.playSong(songs[0], [songs[0], songs[1]]);
    await service.playSong(songs[1], [songs[0], songs[1]]);
    await service.playSong(songs[2], [songs[2]]);
    store.getState().setSettings({ playMode: 2 });
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
    service.next(); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    await service.playSong(songs[0]); // A new choice replaces the abandoned forward branch.
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    service.next(); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
  });

  it('skips removed and disliked historical songs and can return even when the selected queue is now empty', async () => {
    store.getState().setSettings({ playMode: 2 });
    for (const song of songs) await service.playSong(song, [songs[2]]);
    store.setState({ songs: [songs[0], songs[1]], dislikes: { [songs[1].audioPath]: 1 } });
    expect(service.getQueue()).toEqual([]);
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
  });

  it('updates historical paths after renaming a file', async () => {
    store.getState().setSettings({ playMode: 2 });
    await service.playSong(songs[0]); await service.playSong(songs[1]);
    const renamed = { ...songs[0], audioPath: 'C:/renamed.aac' };
    store.setState({ songs: [renamed, songs[1], songs[2]] });
    service.remapSongPath(songs[0].audioPath, renamed.audioPath);
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(renamed.audioPath);
    expect(media.src).toContain('renamed.aac');
  });

  it.each([0, 1])('wraps a selected collection in mode %s without letting page navigation change it', async playMode => {
    store.setState({ collections: [{ id: 'mix', name: 'Mix', songs: [songs[0].audioPath, songs[2].audioPath], createdAt: 1 }], activeCollectionId: 'mix', view: 'liked' });
    store.getState().setSettings({ playMode });
    await service.playSong(songs[0]); store.getState().setView('home');
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath);
    service.next(); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
  });

  it('uses the last/first queue entry for previous/next when the current song is outside the queue', async () => {
    await service.playSong(songs[1], [songs[0], songs[2]]);
    service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath);
    await service.playSong(songs[1], [songs[0], songs[2]]);
    service.next(); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
  });

  it('starts the previous actual song from its saved position after pausing, with no duplicate resume entry', async () => {
    store.getState().setSettings({ playMode: 2 });
    await service.playSong(songs[0]); service.seek(12); media.pause(); service.toggle(); await flush();
    await service.playSong(songs[1]); service.seek(36); media.pause();
    service.next(-1); await flush();
    expect(store.getState().player).toMatchObject({ song: { audioPath: songs[0].audioPath }, playing: true, time: 12 });
    expect(store.getState().progress[songs[1].audioPath]).toBe(36);
    service.next(); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    expect(media.currentTime).toBe(36);
  });

  it('does not add decoding failures to the actual playback history', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      store.getState().setSettings({ playMode: 2 }); media.failedPaths.add('one.aac');
      await service.playSong(songs[0]);
      await vi.waitFor(() => expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath));
      service.next(-1); await flush();
      expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath);
      await service.playSong(songs[1]); service.next(-1); await flush();
      expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath);
    } finally { random.mockRestore(); }
  });

  it('returns resolved preview slots in actual random order, including repeated names and platform replacement', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const resolve = vi.fn(async (index: number): Promise<PreviewSong> => ({ name: 'Same', artist: 'Artist', source: 'replacement', url: `https://example.test/${index}.mp3` }));
    const queue: PreviewSong[] = [0, 1, 2].map(index => ({ name: 'Same', artist: 'Artist', source: `platform-${index}`, url: '', resolve: () => resolve(index) }));
    try {
      store.getState().setSettings({ playMode: 2 });
      await service.playPreview({ ...queue[0], queue });
      const heard = [store.getState().player.preview!.url];
      for (let step = 0; step < 4; step++) {
        service.next();
        await vi.waitFor(() => expect(store.getState().player.preview?.url).not.toBe(heard.at(-1)));
        heard.push(store.getState().player.preview!.url);
      }
      const resolved = resolve.mock.calls.length, planned = random.mock.calls.length;
      for (let position = heard.length - 2; position >= 0; position--) {
        service.next(-1); await flush();
        expect(store.getState().player.preview?.url).toBe(heard[position]);
      }
      for (const url of heard.slice(1)) {
        service.next(); await flush(); expect(store.getState().player.preview?.url).toBe(url);
      }
      expect(resolve).toHaveBeenCalledTimes(resolved); expect(random).toHaveBeenCalledTimes(planned);
      expect(store.getState().player.preview?.queue).toBe(queue);
    } finally { random.mockRestore(); }
  });

  it('rejects a late preview resolver after previous takes ownership and excludes failed resolvers from history', async () => {
    store.getState().setSettings({ playMode: 2 });
    const pending = deferred<PreviewSong>();
    const queue: PreviewSong[] = [
      { name: 'A', artist: '', url: 'https://example.test/a.mp3' },
      { name: 'B', artist: '', url: 'https://example.test/b.mp3' },
      { name: 'C', artist: '', url: '', resolve: () => pending.promise },
    ];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await service.playPreview({ ...queue[0], queue }); await service.playPreview({ ...queue[1], queue });
      service.next(); await flush(); service.next(-1); await flush();
      pending.resolve({ name: 'C', artist: '', url: 'https://example.test/c.mp3' }); await flush();
      expect(store.getState().player.preview?.name).toBe('A');
      expect(media.src).toContain('a.mp3');
      await service.playPreview({ name: 'Failed', artist: '', url: '', resolve: async () => { throw new Error('Unavailable'); } });
      service.next(); await flush(); expect(store.getState().player.preview?.name).toBe('B');
      service.next(-1); await flush(); expect(store.getState().player.preview?.name).toBe('A');
    } finally { random.mockRestore(); }
  });

  it('navigates sequential previews correctly when the selected preview is outside its queue', async () => {
    const queue = [0, 1].map(index => ({ name: `Queue ${index}`, artist: '', url: `https://example.test/queue-${index}.mp3` }));
    const outside = { name: 'Outside', artist: '', url: 'https://example.test/outside.mp3', queue };
    await service.playPreview(outside); service.next(-1); await flush();
    expect(store.getState().player.preview?.url).toBe(queue[1].url);
    await service.playPreview(outside); service.next(); await flush();
    expect(store.getState().player.preview?.url).toBe(queue[0].url);
  });
});

describe('playable startup before delayed user preferences', () => {
  it('registers before the first playable songs, merges early duration/count/listening/progress and never restores over the manual song', async () => {
    const data=deferred<any>();
    // Do not await the pending initialization returned inside an async helper.
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockReturnValue(data.promise); onDurationUpdate.mockClear(); onSongMetadataUpdate.mockClear();
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await flush();
    expect(onDurationUpdate).toHaveBeenCalledTimes(1); expect(onSongMetadataUpdate).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({hydrated:false,loading:false,songs});
    const clock=vi.spyOn(performance,'now').mockReturnValue(1000);
    await service.playSong(songs[1]); service.seek(42);
    clock.mockReturnValue(2000); media.dispatchEvent(new Event('timeupdate'));
    durationListener({audioPath:songs[1].audioPath,realDuration:130});
    const sourceBefore=media.src;
    data.resolve({settings:{volume:.7},lastSession:{audioPath:songs[0].audioPath,t:35},stats:{[songs[1].audioPath]:{plays:5,duration:9}},progress:{[songs[0].audioPath]:35},actualDuration:{[songs[0].audioPath]:120}});
    await initializing;
    expect(media.src).toBe(sourceBefore); expect(media.currentTime).toBe(42); expect(media.paused).toBe(false);
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
    expect(store.getState().stats[songs[1].audioPath]).toMatchObject({plays:6,duration:10});
    expect(store.getState().progress).toMatchObject({[songs[0].audioPath]:35,[songs[1].audioPath]:42});
    expect(store.getState().actualDuration).toEqual({[songs[0].audioPath]:120,[songs[1].audioPath]:130});
    expect(store.getState().songs[1].realDuration).toBe(130);
    clock.mockRestore();
  });
  it('keeps early ended progress reset and repeated play count when disk preferences arrive', async () => {
    const data=deferred<any>();
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockReturnValue(data.promise);
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await flush();
    store.getState().setSettings({playMode:0}); await service.playSong(songs[0]); service.seek(95);
    media.dispatchEvent(new Event('ended'));
    data.resolve({stats:{[songs[0].audioPath]:{plays:9,duration:99}},progress:{[songs[0].audioPath]:35},settings:{playMode:1}}); await initializing;
    expect(store.getState().stats[songs[0].audioPath].plays).toBe(11);
    expect(store.getState().progress[songs[0].audioPath]).toBe(0);
    expect(store.getState().settings.playMode).toBe(0);
    expect(media.currentTime).toBe(0);
  });
  it('retries a failed initialization with the original bindings and can then restore the saved song', async () => {
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockRejectedValueOnce(new Error('Unreadable preferences')).mockResolvedValue({lastSession:{audioPath:songs[1].audioPath,t:35}});
    onDurationUpdate.mockClear(); onSongMetadataUpdate.mockClear();
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    await service.initialize(); expect(store.getState().hydrated).toBe(false);
    await service.initialize();
    expect(onDurationUpdate).toHaveBeenCalledTimes(1); expect(onSongMetadataUpdate).toHaveBeenCalledTimes(1);
    expect(store.getState().hydrated).toBe(true); expect(media.src).toContain('two.aac'); expect(media.currentTime).toBe(35);
  });
  it('a disposed pending startup cannot restore again after the same service is reinitialized', async () => {
    const data=deferred<any>();
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockReturnValue(data.promise);
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const old=service.initialize(); await flush(); service.dispose();
    const play=vi.spyOn(media,'play'), current=service.initialize();
    data.resolve({lastSession:{audioPath:songs[0].audioPath,t:35}}); await Promise.all([old,current]);
    expect(play).toHaveBeenCalledTimes(1); expect(media.currentTime).toBe(35);
    expect(store.getState().stats[songs[0].audioPath].plays).toBe(1);
    play.mockRestore();
  });
  it('does not revive playback after an early stop, even with persisted desktop lyrics', async () => {
    const data=deferred<any>();
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockReturnValue(data.promise);
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await flush(); service.stop();
    data.resolve({settings:{desktopLyricPersist:true},lastSession:{audioPath:songs[0].audioPath,t:35}}); await initializing;
    expect(store.getState().player.song).toBeNull(); expect(media.src).toBe(''); expect(media.paused).toBe(true);
  });
  it('checks manual selection again after a delayed automatic desktop lyric toggle', async () => {
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    getUserData.mockResolvedValue({settings:{desktopLyricPersist:true},lastSession:{audioPath:songs[0].audioPath,t:35}});
    const toggle=deferred<void>(), toggling=vi.spyOn(window.desktopLyric,'toggle').mockReturnValueOnce(toggle.promise);
    vi.stubGlobal('location',{search:'?interfacePaused=1'});
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await vi.waitFor(()=>expect(toggling).toHaveBeenCalled());
    await service.playSong(songs[1]); service.seek(42); toggle.resolve(); await initializing;
    expect(media.src).toContain('two.aac'); expect(media.currentTime).toBe(42); expect(media.paused).toBe(false);
    toggling.mockRestore(); vi.stubGlobal('location',undefined);
  });
  it('does not apply startup paused mode to a manual choice made while old lyrics still load', async () => {
    service.dispose(); (await import('../store')).disposeSongMetadata(); vi.resetModules(); media=new FakeMedia();
    const lyric=deferred<string>(), request=vi.spyOn(window.musicAPI,'getLyrics').mockReturnValueOnce(lyric.promise);
    getSongs.mockResolvedValue([{...songs[0],lrcPath:'C:/one.lrc'},songs[1]]);
    getUserData.mockResolvedValue({lastSession:{audioPath:songs[0].audioPath,t:35}});
    vi.stubGlobal('location',{search:'?interfacePaused=1'});
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await vi.waitFor(()=>expect(request).toHaveBeenCalled());
    await service.playSong(songs[1]); service.seek(42); lyric.resolve('[00:00]Older lyrics'); await initializing;
    expect(media.src).toContain('two.aac'); expect(media.currentTime).toBe(42); expect(media.paused).toBe(false);
    expect(store.getState().player.lyricText).toBe('');
    request.mockRestore(); vi.stubGlobal('location',undefined);
  });
});
