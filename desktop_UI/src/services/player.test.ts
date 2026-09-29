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

beforeAll(async () => {
  media = new FakeMedia();
  const fakeWindow = Object.assign(new EventTarget(), {
    musicAPI: { getSongs: async () => songs, getUserData: async () => ({}), getLyrics: async () => '', saveUserData: async () => {}, onDurationUpdate: () => () => {}, extractCoverColor: async () => null, extractCoverColorFromURL: async () => null },
    desktopLyric: { onClosed: () => () => {}, onLockChanged: () => () => {}, onBoundsSaved: () => () => {}, send: () => {}, toggle: async () => {}, lock: async () => {} },
    stateAPI: { updateDesktopState: synchronize }, repairAPI: { reportPlayFailed: reportFailed },
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('HTMLMediaElement', FakeMedia);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', { createElement: () => media, documentElement: { style: { setProperty: () => {}, removeProperty: () => {} } } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  service = (await import('./player')).playerService;
  store = (await import('../store')).useAppStore;
  await service.initialize();
});

beforeEach(() => {
  service.stop(); media.failedPaths.clear(); reportFailed.mockClear(); synchronize.mockClear();
  store.setState({ songs: [...songs], collections: [], stats: {}, dislikes: {}, progress: {}, actualDuration: {}, lastSession: null, view: 'home', activeCollectionId: null,
    settings: { ...store.getState().settings, playMode: 1, volume: 1, fadePause: false } });
});
afterAll(async () => { service.dispose(); await (await import('../store')).persistNow(); vi.unstubAllGlobals(); });

describe('React player service lifecycle and context', () => {
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
