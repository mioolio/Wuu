import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewSong, Song } from '../types';

class FakeMedia extends EventTarget {
  static HAVE_FUTURE_DATA = 3;
  id = ''; playsInline = true; preload = ''; crossOrigin = ''; volume = 1;
  controls = false; style = {}; src = ''; currentTime = 0; duration = 120;
  readyState = 4; paused = true; seeking = false; playbackRate = 1; defaultPlaybackRate = 1; preservesPitch = false; error: MediaError | null = null;
  failedPaths = new Set<string>();
  async play() {
    if ([...this.failedPaths].some(path => this.src.includes(path))) throw new Error('Media decoding failed');
    this.paused = false; this.dispatchEvent(new Event('playing'));
  }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() { this.currentTime = 0; this.playbackRate = this.defaultPlaybackRate; this.dispatchEvent(new Event('loadedmetadata')); }
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
const reportFailed = vi.fn(async (_payload: { audioPath: string }) => {});
const synchronize = vi.fn(async (_patch: any) => {});
const extractColor = vi.fn(async (_path: string): Promise<unknown> => null);
const extractColorURL = vi.fn(async (_url: string): Promise<unknown> => null);
const desktopSend = vi.fn();
const rootProperties = new Map<string, string>();
const getSongs = vi.fn(async (): Promise<Song[]> => songs);
const getUserData = vi.fn(async (): Promise<any> => ({}));
let durationListener: (payload: unknown) => void;
let metadataListener: (payload: unknown) => void;
let togetherListener: (payload: unknown) => void;
const onTogetherCommand = vi.fn(listener => { togetherListener = listener; return () => {}; });
const onDurationUpdate = vi.fn(listener => { durationListener = listener; return () => {}; });
const onSongMetadataUpdate = vi.fn(listener => { metadataListener = listener; return () => {}; });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
async function disposePlayerFixture() {
  const stateModule = await import('../store');
  service.dispose();
  stateModule.disposeSongMetadata();
  // Disposing saves the current progress. Flush its owning module before a
  // module reset or globals teardown so its real save timer cannot outlive it.
  await stateModule.persistNow();
}
async function resetPlayerFixture() {
  await disposePlayerFixture();
  vi.resetModules();
  media = new FakeMedia();
}
const mediaSession = { metadata: null as MediaMetadata | null, setActionHandler: vi.fn(), setPositionState: vi.fn(), playbackState: 'none' };
class FakeMediaMetadata {
  constructor(data: MediaMetadataInit) { Object.assign(this, data); }
}

beforeAll(async () => {
  media = new FakeMedia();
  const fakeWindow = Object.assign(new EventTarget(), {
    musicAPI: { getSongs, getUserData, getLyrics: async () => '', saveUserData: async () => {}, onDurationUpdate, onSongMetadataUpdate, extractCoverColor: extractColor, extractCoverColorFromURL: extractColorURL },
    desktopLyric: { onClosed: () => () => {}, onLockChanged: () => () => {}, onBoundsSaved: () => () => {}, send: desktopSend, toggle: async () => {}, lock: async () => {} },
    stateAPI: { updateDesktopState: synchronize, onTogetherCommand }, repairAPI: { reportPlayFailed: reportFailed },
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
    settings: { ...store.getState().settings, playMode: 1, volume: 1, playbackRate: 1, fadePause: false, themeFollowCover: false, colorIntensity: 0.85,
      progressColorEnabled:false,progressColor:'#fb7299',progressColor2:'#ff5e8a',desktopLyricBounds:null,desktopLyricLocked:false } });
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
    expect(desktopSend).toHaveBeenCalledWith({ type: 'color', color: { r: 206, g: 76, b: 87 }, colorReady: true });
    desktopSend.mockClear(); service.stop();
    expect(desktopSend).toHaveBeenCalledWith({ type: 'info', info: { title: '', artist: '' } });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'time', t: 0, playing: false, playbackRate: 1 });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'color', color: null, colorReady: true });
  });
  it('primes the first show with complete paused lyrics and pending color, then reopens with the resolved current color', async () => {
    const palette=deferred<unknown>(); extractColor.mockReturnValue(palette.promise);
    const song={...songs[0],coverPath:'C:/delayed.png',lrcPath:'C:/one.lrc'};
    store.setState({songs:[song]});
    const lyric=vi.spyOn(window.musicAPI,'getLyrics').mockResolvedValue('[00:00]Opening\n[00:30]Restored line');
    await service.playSong(song); media.pause(); service.seek(35);
    const toggle=vi.spyOn(window.desktopLyric,'toggle');
    await service.toggleDesktopLyric();
    expect(toggle).toHaveBeenLastCalledWith(true,expect.objectContaining({type:'snapshot',songKey:song.audioPath,info:{title:song.songName,artist:song.artist},color:null,colorReady:false,t:35,playing:false,
      lrc:expect.objectContaining({lines:expect.arrayContaining([expect.objectContaining({text:'Restored line'})])}),settings:expect.objectContaining({progressColorEnabled:false})}));
    await service.toggleDesktopLyric();
    palette.resolve({r:42,g:146,b:166}); await flush();
    await service.toggleDesktopLyric();
    expect(toggle).toHaveBeenLastCalledWith(true,expect.objectContaining({color:{r:42,g:146,b:166},colorReady:true,t:35,playing:false}));
    lyric.mockRestore(); toggle.mockRestore();
  });
  it.each([
    {kind:'valid string',progressColor:'#2468ac',ready:true},
    {kind:'invalid string',progressColor:'invalid',ready:false},
    {kind:'array',progressColor:['#2468ac'],ready:false},
    {kind:'object',progressColor:{color:'#2468ac'},ready:false},
  ])('only a valid custom color ($kind) can make the first pending-cover snapshot ready', async ({progressColor,ready}) => {
    const palette=deferred<unknown>(); extractColor.mockReturnValue(palette.promise);
    const song={...songs[0],coverPath:'C:/pending-custom.png'}; store.setState({songs:[song]});
    // Reproduce malformed persisted data despite the compile-time string type.
    store.getState().setSettings({progressColorEnabled:true,progressColor:progressColor as string});
    await service.playSong(song);
    const toggle=vi.spyOn(window.desktopLyric,'toggle'); await service.toggleDesktopLyric();
    expect(toggle).toHaveBeenLastCalledWith(true,expect.objectContaining({colorReady:ready,settings:expect.objectContaining({progressColorEnabled:true,progressColor})}));
    expect(desktopSend).toHaveBeenCalledWith(expect.objectContaining({type:'color',colorReady:ready}));
    desktopSend.mockClear(); store.getState().setSettings({progressColorEnabled:false});
    expect(desktopSend).toHaveBeenCalledWith(expect.objectContaining({type:'settings',colorReady:false}));
    palette.resolve(null); await flush(); toggle.mockRestore();
  });
  it('marks a new song snapshot pending before its data is visible and rejects an obsolete extraction', async () => {
    const palette=deferred<unknown>(); extractColor.mockResolvedValueOnce({r:206,g:76,b:87}).mockReturnValueOnce(palette.promise);
    const first={...songs[0],coverPath:'C:/first.png'},second={...songs[1],coverPath:'C:/second.png'};
    store.setState({songs:[first,second]}); await service.playSong(first); await service.toggleDesktopLyric();
    desktopSend.mockClear(); await service.playSong(second);
    const snapshots=desktopSend.mock.calls.map(call=>call[0]).filter(payload=>payload.type==='snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every(payload=>payload.songKey===second.audioPath && payload.colorReady===false)).toBe(true);
    service.stop(); desktopSend.mockClear(); palette.resolve({r:42,g:146,b:166}); await flush();
    expect(desktopSend).not.toHaveBeenCalledWith(expect.objectContaining({type:'color',color:{r:42,g:146,b:166}}));
    const toggle=vi.spyOn(window.desktopLyric,'toggle'); await service.toggleDesktopLyric(); await service.toggleDesktopLyric();
    expect(toggle).toHaveBeenLastCalledWith(true,expect.objectContaining({songKey:'',color:null,colorReady:true}));
    toggle.mockRestore();
  });
  it('a rapid hide wins over an older in-flight show and does not restart the lyric clock', async () => {
    await service.playSong(songs[0]);
    const pending=deferred<void>(),toggle=vi.spyOn(window.desktopLyric,'toggle').mockReturnValueOnce(pending.promise);
    const show=service.toggleDesktopLyric();
    expect(store.getState().player.desktopLyricOn).toBe(true);
    await service.toggleDesktopLyric(); pending.resolve(); await show;
    expect(toggle).toHaveBeenLastCalledWith(false,undefined);
    expect(store.getState().player.desktopLyricOn).toBe(false);
    toggle.mockRestore();
  });
  it('clears the show intent when the window opening is cancelled before its committed frame is shown', async () => {
    await service.playSong(songs[0]);
    const toggle = vi.spyOn(window.desktopLyric, 'toggle').mockResolvedValueOnce(false);
    desktopSend.mockClear();
    await service.toggleDesktopLyric();
    expect(store.getState().player.desktopLyricOn).toBe(false);
    expect(desktopSend).not.toHaveBeenCalled();
    toggle.mockRestore();
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
afterAll(async () => { await disposePlayerFixture(); vi.unstubAllGlobals(); });

describe('React player service lifecycle and context', () => {
  it('changes speed immediately without reopening or seeking the active media, including while paused', async () => {
    await service.playSong(songs[0]); service.seek(42);
    store.getState().setPlayer({ desktopLyricOn: true }); desktopSend.mockClear();
    const source = media.src;
    const load = vi.spyOn(media, 'load'), play = vi.spyOn(media, 'play'), pause = vi.spyOn(media, 'pause');
    store.getState().setSettings({ playbackRate: 2 });
    expect(media).toMatchObject({ playbackRate: 2, defaultPlaybackRate: 2, preservesPitch: true, currentTime: 42, paused: false, src: source });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'time', t: 42, playing: true, playbackRate: 2 });
    expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 42, playbackRate: 2 });
    expect(load).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    media.pause(); pause.mockClear(); desktopSend.mockClear();
    store.getState().setSettings({ playbackRate: .5 });
    expect(media).toMatchObject({ playbackRate: .5, defaultPlaybackRate: .5, preservesPitch: true, currentTime: 42, paused: true, src: source });
    expect(desktopSend).toHaveBeenCalledWith({ type: 'time', t: 42, playing: false, playbackRate: .5 });
    expect(load).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    load.mockRestore(); play.mockRestore(); pause.mockRestore();
  });
  it('keeps the saved speed across local sources, previews and metadata rate resets', async () => {
    store.getState().setSettings({ playbackRate: 1.75 });
    await service.playSong(songs[0]); service.seek(35);
    media.playbackRate = 1; media.defaultPlaybackRate = 1; media.preservesPitch = false;
    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media).toMatchObject({ playbackRate: 1.75, defaultPlaybackRate: 1.75, preservesPitch: true, currentTime: 35 });
    await service.playSong(songs[1]);
    expect(media).toMatchObject({ playbackRate: 1.75, defaultPlaybackRate: 1.75, preservesPitch: true });
    await service.playPreview({ name: 'Preview', artist: '', url: 'https://example.test/rate.mp3' });
    expect(media).toMatchObject({ playbackRate: 1.75, defaultPlaybackRate: 1.75, preservesPitch: true });
  });
  it('sends the actual native rate with ratechange and the first paused desktop lyric snapshot', async () => {
    await service.playSong(songs[0]); service.seek(35); media.pause();
    store.getState().setPlayer({ desktopLyricOn: true }); desktopSend.mockClear();
    media.playbackRate = 2; media.dispatchEvent(new Event('ratechange'));
    expect(desktopSend).toHaveBeenCalledExactlyOnceWith({ type: 'time', t: 35, playing: false, playbackRate: 2 });
    expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 35, playbackRate: 2 });
    store.getState().setPlayer({ desktopLyricOn: false });
    const toggle = vi.spyOn(window.desktopLyric, 'toggle');
    await service.toggleDesktopLyric();
    expect(toggle).toHaveBeenCalledWith(true, expect.objectContaining({ type: 'snapshot', t: 35, playing: false, playbackRate: 2 }));
    toggle.mockRestore();
  });
  it('persists software lock control only after native mouse passthrough succeeds', async () => {
    store.getState().setPlayer({ desktopLyricOn: true });
    const lock = vi.spyOn(window.desktopLyric, 'lock');
    await service.toggleLyricLock();
    expect(lock).toHaveBeenLastCalledWith(true); expect(store.getState().settings.desktopLyricLocked).toBe(true);
    expect(desktopSend).toHaveBeenCalledWith({ type: 'lock', locked: true });
    lock.mockRejectedValueOnce(new Error('Native lock failed'));
    await expect(service.toggleLyricLock()).rejects.toThrow('Native lock failed');
    expect(store.getState().settings.desktopLyricLocked).toBe(true);
    await service.toggleLyricLock();
    expect(lock).toHaveBeenLastCalledWith(false); expect(store.getState().settings.desktopLyricLocked).toBe(false);
    lock.mockRestore();
  });
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

describe('random playback completes the eligible round', () => {
  it('covers 100 low and high play-count songs for three rounds despite mode changes, metadata refreshes and current-row clicks', async () => {
    const queue = Array.from({ length: 100 }, (_, index): Song => ({
      audioPath: `C:/coverage-${index}.aac`, songName: `Song ${index}`, artist: 'Artist', realDuration: 120,
    }));
    store.setState({ songs: queue, stats: { [queue[0].audioPath]: { plays: 100000, duration: 900000 } } });
    const random = vi.spyOn(Math, 'random').mockReturnValue(.73);
    try {
      store.getState().setSettings({ playMode: 2 });
      await service.playSong(queue[0], queue);
      let last = queue[0].audioPath;
      for (let round = 0; round < 3; round++) {
        const heard = round === 0 ? [last] : [];
        for (let position = heard.length; position < queue.length; position++) {
          service.next(); await flush();
          const current = store.getState().player.song!;
          expect(current.audioPath).not.toBe(last);
          last = current.audioPath; heard.push(last);
          if (position % 7 === 0) await service.playSong(current, [...service.getQueue()]);
          if (position % 11 === 0) {
            store.getState().setSettings({ playMode: 1 });
            store.getState().setSettings({ playMode: 2 });
          }
          if (position % 17 === 0) {
            getSongs.mockResolvedValue(queue.map(song => ({ ...song, genre: ['Updated tag'] })));
            await store.getState().reloadSongs();
          }
        }
        expect(new Set(heard)).toEqual(new Set(queue.map(song => song.audioPath)));
      }
      expect(store.getState().stats[queue.at(-1)!.audioPath].plays).toBe(3);
    } finally { random.mockRestore(); }
  });

  it('keeps the unplayed local songs when a user reselects the current song in the same queue', async () => {
    const queue = [...songs, { ...songs[0], audioPath: 'C:/four.aac', songName: 'Four' }];
    store.setState({ songs: queue });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      store.getState().setSettings({ playMode: 2 });
      await service.playSong(queue[0], queue);
      const heard = [store.getState().player.song!.audioPath];
      for (let step = 1; step < queue.length; step++) {
        service.next(); await flush();
        const current = store.getState().player.song!;
        heard.push(current.audioPath);
        // The real queue popover sends a new array when its current row is clicked.
        await service.playSong(current, [...queue]);
      }
      expect(new Set(heard)).toEqual(new Set(queue.map(song => song.audioPath)));
    } finally { random.mockRestore(); }
  });

  it('plays every preview slot before repeating instead of drawing independently on each next', async () => {
    const queue: PreviewSong[] = [0, 1, 2, 3].map(index => ({
      name: `Preview ${index}`, artist: '', url: `https://example.test/random-${index}.mp3`,
    }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(.45);
    try {
      store.getState().setSettings({ playMode: 2 });
      await service.playPreview({ ...queue[0], queue });
      const heard = [store.getState().player.preview!.url];
      for (let step = 1; step < queue.length; step++) {
        service.next(); await flush();
        heard.push(store.getState().player.preview!.url);
      }
      expect(new Set(heard)).toEqual(new Set(queue.map(song => song.url)));
    } finally { random.mockRestore(); }
  });

  it('manual picks and history replay preserve the local unplayed songs instead of restarting their round', async () => {
    const queue = Array.from({ length: 8 }, (_, index): Song => ({ ...songs[0], audioPath: `C:/manual-${index}.aac` }));
    store.setState({ songs: queue }); store.getState().setSettings({ playMode: 2 });
    await service.playSong(queue[0], queue);
    const heard = [queue[0].audioPath];
    service.next(); await flush(); heard.push(store.getState().player.song!.audioPath);
    const manual = queue.find(song => !heard.includes(song.audioPath))!;
    await service.playSong(manual, [...queue]); heard.push(manual.audioPath);
    service.next(-1); await flush(); expect(store.getState().player.song!.audioPath).toBe(heard[1]);
    service.next(); await flush(); expect(store.getState().player.song!.audioPath).toBe(manual.audioPath);
    while (heard.length < queue.length) {
      service.next(); await flush(); heard.push(store.getState().player.song!.audioPath);
    }
    expect(new Set(heard)).toEqual(new Set(queue.map(song => song.audioPath)));
  });

  it('reconciles dislikes, deleted files and added songs within the actual collection without reviving heard entries', async () => {
    const queue = Array.from({ length: 6 }, (_, index): Song => ({ ...songs[0], audioPath: `C:/eligible-${index}.aac` }));
    store.setState({ songs: queue, collections: [{ id: 'mix', name: 'Mix', songs: queue.map(song => song.audioPath), createdAt: 1 }], view: 'liked', activeCollectionId: 'mix' });
    store.getState().setSettings({ playMode: 2 }); await service.playSong(queue[0]);
    service.next(); await flush();
    const current = store.getState().player.song!, heard = new Set([queue[0].audioPath, current.audioPath]);
    const unseen = queue.filter(song => !heard.has(song.audioPath));
    const added = { ...songs[0], audioPath: 'C:/added.aac' };
    const outside = { ...songs[0], audioPath: 'C:/outside.aac' };
    store.setState({ songs: [...queue.filter(song => song !== unseen[1]), added, outside],
      dislikes: { [unseen[0].audioPath]: 1 }, view: 'home',
      collections: [{ id: 'mix', name: 'Mix', songs: [...queue.map(song => song.audioPath), added.audioPath], createdAt: 1 }] });
    const expected = [unseen[2].audioPath, unseen[3].audioPath, added.audioPath];
    const upcoming: string[] = [];
    for (let step = 0; step < expected.length; step++) {
      service.next(); await flush(); upcoming.push(store.getState().player.song!.audioPath);
    }
    expect(new Set(upcoming)).toEqual(new Set(expected));
    expect(service.getQueue().some(song => song.audioPath === outside.audioPath)).toBe(false);
  });

  it('deduplicates stable preview identities and keeps unplayed songs after queue arrays reorder and gain a member', async () => {
    const make = (id: number): PreviewSong => ({ name: 'Same title', artist: 'Artist', source: 'platform',
      original: { id, source: 'platform' }, url: `https://example.test/identity-${id}.mp3` });
    const original = [make(0), make(1), make(2), make(3)];
    const queue = [original[0], { ...original[0] }, ...original.slice(1)];
    store.getState().setSettings({ playMode: 2 }); await service.playPreview({ ...queue[0], queue });
    service.next(); await flush();
    const current = store.getState().player.preview!;
    const consumed = new Set([original[0].url, current.url]);
    const added = make(4), reordered = [...queue].reverse().map(song => ({ ...song }));
    reordered.push(added);
    await service.playPreview({ ...reordered.find(song => song.url === current.url)!, queue: reordered });
    const expected = [...original, added].filter(song => !consumed.has(song.url)).map(song => song.url);
    const upcoming: string[] = [];
    for (let step = 0; step < expected.length; step++) {
      service.next(); await flush(); upcoming.push(store.getState().player.preview!.url);
    }
    expect(new Set(upcoming)).toEqual(new Set(expected));
  });

  it('resolved preview platform replacements retain original song identities across duplicate slots', async () => {
    const make = (id: number): PreviewSong => ({ name: 'Same', artist: '', source: 'original', original: { id, source: 'original' }, url: '',
      resolve: async () => ({ name: 'Same', artist: '', source: 'replacement', original: { id: `new-${id}`, source: 'replacement' }, url: `https://example.test/resolved-${id}.mp3` }) });
    const original = [make(0), make(1), make(2)], queue = [original[0], { ...original[0] }, ...original.slice(1)];
    store.getState().setSettings({ playMode: 2 }); await service.playPreview({ ...queue[0], queue });
    const heard = [store.getState().player.preview!.url];
    for (let step = 1; step < original.length; step++) {
      service.next(); await vi.waitFor(() => expect(store.getState().player.preview!.url).not.toBe(heard.at(-1)));
      heard.push(store.getState().player.preview!.url);
    }
    expect(new Set(heard)).toEqual(new Set(original.map((_, id) => `https://example.test/resolved-${id}.mp3`)));
  });

  it('a delayed preview resolver retains its selected identity when the same queue changes order before completion', async () => {
    const pending = deferred<PreviewSong>();
    const queue: PreviewSong[] = [
      { name: 'A', artist: '', source: 'original', original: { id: 'a' }, url: 'https://example.test/a.mp3' },
      { name: 'B', artist: '', source: 'original', original: { id: 'b' }, url: '', resolve: () => pending.promise },
      { name: 'C', artist: '', source: 'original', original: { id: 'c' }, url: 'https://example.test/c.mp3' },
    ];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      store.getState().setSettings({ playMode: 2 }); await service.playPreview({ ...queue[0], queue });
      service.next(); await flush();
      [queue[1], queue[2]] = [queue[2], queue[1]];
      pending.resolve({ name: 'B', artist: '', source: 'replacement', original: { id: 'resolved-b' }, url: 'https://example.test/b.mp3' });
      await vi.waitFor(() => expect(store.getState().player.preview!.url).toContain('/b.mp3'));
      service.next(); await flush();
      expect(store.getState().player.preview!.url).toBe('https://example.test/c.mp3');
    } finally { random.mockRestore(); }
  });

  it('an in-place preview reorder relocates the current song instead of marking another slot heard', async () => {
    const queue: PreviewSong[] = ['A', 'B', 'C'].map(name => ({ name, artist: '', url: `https://example.test/${name}.mp3` }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      store.getState().setSettings({ playMode: 2 }); await service.playPreview({ ...queue[0], queue });
      const heard = [store.getState().player.preview!.name];
      [queue[0], queue[1]] = [queue[1], queue[0]];
      for (let step = 1; step < queue.length; step++) {
        service.next(); await flush(); heard.push(store.getState().player.preview!.name);
      }
      expect(new Set(heard)).toEqual(new Set(['A', 'B', 'C']));
    } finally { random.mockRestore(); }
  });

  it('first playing consumes the actual preview identity if the queue reorders while play is pending', async () => {
    const queue: PreviewSong[] = ['A', 'B', 'C'].map(name => ({ name, artist: '', url: `https://example.test/${name}.mp3` }));
    const pending = deferred<void>(), originalPlay = media.play;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    media.play = async function () { await pending.promise; await originalPlay.call(this); };
    try {
      store.getState().setSettings({ playMode: 2 });
      const opening = service.playPreview({ ...queue[0], queue });
      [queue[0], queue[1]] = [queue[1], queue[0]];
      pending.resolve(); await opening; media.play = originalPlay;
      const heard = [store.getState().player.preview!.name];
      for (let step = 1; step < queue.length; step++) {
        service.next(); await flush(); heard.push(store.getState().player.preview!.name);
      }
      expect(new Set(heard)).toEqual(new Set(['A', 'B', 'C']));
    } finally { media.play = originalPlay; random.mockRestore(); }
  });

  it('limits failed random attempts without repeatedly selecting a damaged file or writing it to history', async () => {
    const queue = Array.from({ length: 8 }, (_, index): Song => ({ ...songs[0], audioPath: `C:/failed-${index}.aac` }));
    store.setState({ songs: queue }); store.getState().setSettings({ playMode: 2 });
    for (const song of queue) media.failedPaths.add(song.audioPath);
    await service.playSong(queue[0], queue);
    await vi.waitFor(() => expect(reportFailed).toHaveBeenCalledTimes(5));
    const attempted = reportFailed.mock.calls.map(([song]) => song.audioPath);
    expect(new Set(attempted).size).toBe(5); expect(media.paused).toBe(true);
    service.next(-1); await flush();
    expect(reportFailed).toHaveBeenCalledTimes(5);
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
      await vi.waitFor(() => expect(store.getState().player.song?.audioPath).not.toBe(songs[0].audioPath));
      const successful = store.getState().player.song!;
      expect(media.paused).toBe(false);
      service.next(-1); await flush();
      expect(store.getState().player.song?.audioPath).toBe(successful.audioPath);
      await service.playSong(songs.find(song => song.audioPath !== successful.audioPath && song !== songs[0])!);
      service.next(-1); await flush();
      expect(store.getState().player.song?.audioPath).toBe(successful.audioPath);
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
  it('applies persisted speed during startup and again after the same media service is reinitialized', async () => {
    await resetPlayerFixture();
    getUserData.mockResolvedValue({ settings: { playbackRate: 1.5 }, lastSession: { audioPath: songs[0].audioPath, t: 35 } });
    service = (await import('./player')).playerService; store = (await import('../store')).useAppStore;
    await service.initialize();
    expect(media).toMatchObject({ playbackRate: 1.5, defaultPlaybackRate: 1.5, preservesPitch: true, currentTime: 35 });
    service.dispose(); media.playbackRate = 1; media.defaultPlaybackRate = 1; media.preservesPitch = false;
    await service.initialize();
    expect(media).toMatchObject({ playbackRate: 1.5, defaultPlaybackRate: 1.5, preservesPitch: true });
  });
  it('registers before the first playable songs, merges early duration/count/listening/progress and never restores over the manual song', async () => {
    const data=deferred<any>();
    // Do not await the pending initialization returned inside an async helper.
    await resetPlayerFixture();
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
    await resetPlayerFixture();
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
    await resetPlayerFixture();
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
    await resetPlayerFixture();
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
    await resetPlayerFixture();
    getUserData.mockReturnValue(data.promise);
    service=(await import('./player')).playerService; store=(await import('../store')).useAppStore;
    const initializing=service.initialize(); await flush(); service.stop();
    data.resolve({settings:{desktopLyricPersist:true},lastSession:{audioPath:songs[0].audioPath,t:35}}); await initializing;
    expect(store.getState().player.song).toBeNull(); expect(media.src).toBe(''); expect(media.paused).toBe(true);
  });
  it('checks manual selection again after a delayed automatic desktop lyric toggle', async () => {
    await resetPlayerFixture();
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
    await resetPlayerFixture();
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


describe('actual desktop listens to validated together commands', () => {
  it('a newer phone seek before metadata replaces the paused song initial position', async () => {
    const originalLoad = media.load.bind(media);
    media.load = () => { media.currentTime = 0; media.readyState = 0; media.duration = NaN; };
    togetherListener({ session: 'slow-metadata', seq: 1, op: 'song', payload: { audioPath: songs[1].audioPath, position: 35, isPlaying: false } });
    await flush();
    togetherListener({ session: 'slow-metadata', seq: 2, op: 'seek', payload: { position: 20 } }); await flush();
    media.readyState = 4; media.duration = 120; media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(20); expect(media.paused).toBe(true);
    expect(store.getState().player.time).toBe(20);
    media.load = originalLoad;
  });
  it('a phone library selection resets an old collection queue and keeps actual previous-song history', async () => {
    store.setState({ view: 'liked', activeCollectionId: 'one', collections: [{ id: 'one', name: 'One only', songs: [songs[0].audioPath], createdAt: 1 }] });
    await service.playSong(songs[0], [songs[0]]);
    togetherListener({ session: 'phone-library', seq: 1, op: 'song', payload: { audioPath: songs[1].audioPath, position: 10, isPlaying: true } });
    await flush(); expect(service.getQueue().map(song => song.audioPath)).toEqual(songs.map(song => song.audioPath));
    service.next(); await flush(); expect(store.getState().player.song?.audioPath).toBe(songs[2].audioPath);
    store.getState().setSettings({ playMode: 2 }); service.next(-1); await flush();
    expect(store.getState().player.song?.audioPath).toBe(songs[1].audioPath);
  });
  it('binds before playback and applies a paused song with exact progress/rate without waiting for lyrics', async () => {
    const text = deferred<string>();
    const getLyrics = vi.fn(() => text.promise);
    (window as any).musicAPI.getLyrics = getLyrics;
    const song = { ...songs[1], lrcPath: 'C:/two.lrc' };
    store.setState({ songs: [songs[0], song, songs[2]] });
    togetherListener({ session: 'paused-song', seq: 1, op: 'song', payload: {
      audioPath: song.audioPath, position: 35, isPlaying: false, playbackRate: 2,
    } });
    await flush();
    expect(store.getState().player.song?.audioPath).toBe(song.audioPath);
    expect(media.paused).toBe(true); expect(media.currentTime).toBe(35);
    expect(media.playbackRate).toBe(2); expect(media.defaultPlaybackRate).toBe(2);
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({
      currentTime: 35, isPlaying: false, playbackRate: 2, togetherSeq: 1, togetherSession: 'paused-song',
    }));
    text.resolve('[00:00]current'); await flush();
    (window as any).musicAPI.getLyrics = async () => '';
  });
  it('phone pause/play/seek/rate controls real media and saved settings; missing songs cannot load arbitrary paths', async () => {
    await service.playSong(songs[0]);
    const send = async (seq: number, op: string, payload: object) => {
      togetherListener({ session: 'controls', seq, op, payload }); await flush();
    };
    await send(1, 'pause', { position: 20 }); expect(media.paused).toBe(true); expect(media.currentTime).toBe(20);
    await send(2, 'play', { position: 24 }); expect(media.paused).toBe(false);
    await send(3, 'seek', { position: 40 }); expect(media.currentTime).toBe(40);
    const source = media.src;
    await send(4, 'rate', { playbackRate: .5 });
    expect(media.playbackRate).toBe(.5); expect(store.getState().settings.playbackRate).toBe(.5);
    expect(media.currentTime).toBe(40); expect(media.src).toBe(source);
    await send(5, 'song', { audioPath: 'C:/private.wav', position: 80, isPlaying: true });
    expect(media.src).toBe(source); expect(store.getState().player.song?.audioPath).toBe(songs[0].audioPath);
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({ togetherSeq: 5, playbackRate: .5 }));
  });
  it('a new server session accepts low sequences while old/cancelled completions cannot acknowledge it', async () => {
    await service.playSong(songs[0]);
    const playing = deferred<void>();
    const originalPlay = media.play.bind(media);
    media.play = async () => { await playing.promise; await originalPlay(); };
    togetherListener({ session: 'old-server', seq: 90, op: 'play', payload: {} });
    await flush();
    togetherListener({ session: 'old-server', seq: 90, op: 'cancel' });
    togetherListener({ session: 'new-server', seq: 1, op: 'rate', payload: { playbackRate: 2 } });
    await flush(); synchronize.mockClear(); playing.resolve(); await flush();
    expect(media.playbackRate).toBe(2);
    expect(synchronize.mock.calls.every(([patch]) => patch.togetherSession !== 'old-server')).toBe(true);
    media.play = originalPlay;
    togetherListener({ session: 'new-server', seq: 2, op: 'pause', payload: { position: 18 } }); await flush();
    expect(synchronize).toHaveBeenLastCalledWith(expect.objectContaining({ togetherSeq: 2, togetherSession: 'new-server', isPlaying: false }));
  });
});
