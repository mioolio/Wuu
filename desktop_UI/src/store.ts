import { create } from 'zustand';
import { errorMessage, getBridge } from './api';
import { navigateView } from './services/navigation';
import { normalizeSongStats } from './services/listeningHistory';
import { normalizeSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from './services/sidebarPreferences';
import type { Collection, PlayerState, Settings, Song, SongStats, View } from './types';

export const defaultSettings: Settings = {
  interfaceMode: 'modern',
  experimentalAppleUI: false,
  experimentalFrostedGlass: false,
  appleControlsPosition: 'left',
  sidebarCollapsed: true, sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  playMode: 1, volume: 1, playbackRate: 1, fadePause: true, glassOpacity: 0.72, discCover: false, colorIntensity: 0.85,
  lyricDone: 0.9, lyricWait: 0.55, lyricSize: 20, currentLyricSize: 28, themeFollowCover: false,
  progressColorEnabled: false, progressColor: '#fb7299', progressColor2: '#ff5e8a',
  simulateLrcProgress: false, showFloatListBtn: true, artistGroupMode: 'bucket',
  desktopLyricPersist: false, desktopLyricBounds: null, desktopLyricLocked: false,
  marqueeEnabled: true, marqueeSpeed: 60, marqueeThreshold: 1, marqueePause: 1.5,
  serverEnabled: false, serverPort: 30967, serverBindIP: '0.0.0.0', serverWhitelist: [],
  serverRateLimit: 0, serverAccessLog: false, mobileEnabled: false, coverUnify: true,
  publicHostMode: 'auto', publicHost: '', publicPort: 0,
  audioFx: { preset: 'off', eq: [0,0,0,0,0,0,0,0,0,0], customs: [] },
};

interface AppState {
  songs: Song[]; collections: Collection[]; dislikes: Record<string, number>; likeTimes: Record<string, number>;
  stats: Record<string, SongStats>; progress: Record<string, number>; actualDuration: Record<string, number>;
  genreOverrides: Record<string, string[]>;
  lastSession: { audioPath: string; t: number } | null; settings: Settings;
  player: PlayerState; view: View; activeCollectionId: string | null; shareSelection: string[];
  hydrated: boolean; loading: boolean; error: string;
  initialize: () => Promise<void>; reloadSongs: () => Promise<void>;
  setView: (view: View) => void; setSettings: (patch: Partial<Settings>) => void;
  setPlayer: (patch: Partial<PlayerState>) => void;
  setSongGenres: (path: string, genres: string[] | null) => void;
  createCollection: (name: string) => string; renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void; setCollectionSong: (id: string, path: string, included: boolean) => void;
  toggleLike: (path: string) => void; toggleDislike: (path: string) => void; removeSong: (path: string) => void;
}

const views: View[] = ['home','list','liked','player','import','free-music','repair','stats','playlist','management','settings'];
function savedView(): View {
  const value = localStorage.getItem('sqet-current-view') as View;
  return views.includes(value) ? value : 'home';
}
let initializeTask: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let extraUserData: Record<string, any> = {};
let pendingLocalLikesMigration = false;
let songsRequest = 0;
let initializationRequest = 0;
let metadataUnsubscribe: (() => void) | null = null;
const songGenres = new Map<string, string[]>();
const pendingSongGenres = new Map<string, string[]>();
let metadataTimer: ReturnType<typeof setTimeout> | null = null;
type UserDataChange = (state: AppState) => Partial<AppState>;
const pendingChanges: UserDataChange[] = [];

/** Preserve early user intent until the original disk data can be merged. */
export function applyUserDataChange(change: UserDataChange) {
  if (!useAppStore.getState().hydrated) pendingChanges.push(change);
  useAppStore.setState(change);
}

function normalizedGenres(value: unknown): string[] | null {
  return Array.isArray(value) ? [...new Set(value.filter((genre): genre is string => typeof genre === 'string').map(genre => genre.trim()).filter(Boolean))] : null;
}
function sameGenres(left: string[] | undefined, right: string[]) {
  return Array.isArray(left) && left.length === right.length && left.every((genre, index) => genre === right[index]);
}
function songsWithMetadata(value: unknown): Song[] {
  return Array.isArray(value) ? value.map((song: Song) => {
    const genre = songGenres.get(song.audioPath);
    return genre && !sameGenres(song.genre, genre) ? { ...song, genre } : song;
  }) : [];
}
function flushSongMetadata() {
  metadataTimer = null;
  const patches = new Map(pendingSongGenres);
  pendingSongGenres.clear();
  if (!patches.size) return;
  useAppStore.setState(state => {
    let changed = false;
    const songs = state.songs.map(song => {
      const genre = patches.get(song.audioPath);
      if (!genre || sameGenres(song.genre, genre)) return song;
      changed = true;
      return { ...song, genre };
    });
    const current = state.player.song;
    const genre = current && patches.get(current.audioPath);
    const playerChanged = current && genre && !sameGenres(current.genre, genre);
    if (!changed && !playerChanged) return state;
    return { songs: changed ? songs : state.songs,
      player: playerChanged ? { ...state.player, song: { ...current, genre } } : state.player };
  });
}
function publishSongs(songs: Song[]) {
  useAppStore.setState(state => {
    const index = state.player.song ? songs.findIndex(song => song.audioPath === state.player.song!.audioPath) : -1;
    return { songs, player: { ...state.player, index, song: index >= 0 ? songs[index] : state.player.song } };
  });
}
function subscribeSongMetadata() {
  if (metadataUnsubscribe) return;
  const api = getBridge('musicAPI');
  if (!api.onSongMetadataUpdate) return;
  let active = true;
  const unsubscribe = api.onSongMetadataUpdate((payload: { audioPath?: unknown; genre?: unknown }) => {
    if (!active) return;
    if (typeof payload?.audioPath !== 'string' || !payload.audioPath) return;
    const genre = normalizedGenres(payload.genre);
    if (!genre) return;
    const audioPath = payload.audioPath;
    // Enrichment can arrive before getSongs resolves. Keep it for that snapshot
    // without creating library entries or changing manually chosen overrides.
    songGenres.set(audioPath, genre);
    // One scan per short batch keeps a library-wide enrichment burst from
    // rebuilding the home recommendations for every individual audio file.
    pendingSongGenres.set(audioPath, genre);
    if (!metadataTimer) metadataTimer = setTimeout(flushSongMetadata, 50);
  });
  metadataUnsubscribe = () => { active = false; if (typeof unsubscribe === 'function') unsubscribe(); };
}
export function disposeSongMetadata() {
  metadataUnsubscribe?.(); metadataUnsubscribe = null;
  if (metadataTimer) clearTimeout(metadataTimer);
  metadataTimer = null; pendingSongGenres.clear();
}

export function isLiked(path: string): boolean { return useAppStore.getState().collections.some(c => c.songs.includes(path)); }
export function serializeUserData() {
  const state = useAppStore.getState();
  const likedPaths = [...new Set(state.collections.flatMap(c => c.songs))];
  return { ...extraUserData,
    likes: likedPaths.map(path => ({ path, ts: state.likeTimes[path] || 0 })),
    dislikes: Object.entries(state.dislikes).map(([path, ts]) => ({ path, ts })),
    collections: state.collections, stats: state.stats, progress: state.progress,
    actualDuration: state.actualDuration, lastSession: state.lastSession, settings: state.settings, genreOverrides: state.genreOverrides,
  };
}
export function persistNow(sync = false) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!useAppStore.getState().hydrated) return;
  const api = getBridge('musicAPI');
  const saved = (success: boolean) => {
    if (success && pendingLocalLikesMigration) { localStorage.removeItem('sqet-likes'); pendingLocalLikesMigration = false; }
    return success;
  };
  if (sync && api.saveUserDataSync) return saved(api.saveUserDataSync(serializeUserData()) !== false);
  return Promise.resolve(api.saveUserData(serializeUserData())).then(result => saved(result !== false)).catch(error => {
    console.error('保存用户数据失败', error); return false;
  });
}
export function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(() => persistNow(), 500); }
function pathTimes(value: any): Record<string, number> {
  const entries = Array.isArray(value) ? value : [];
  return Object.fromEntries(entries.map((entry: any, index: number) => typeof entry === 'string' ? [entry, Date.now() - index] : [entry.path, Number(entry.ts) || 0]).filter(([path]: any[]) => !!path));
}
function finiteSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
export function normalizePlaybackRate(value: unknown, fallback = 1): number {
  const safeFallback = Math.max(.5, Math.min(2, Number.isFinite(fallback) ? fallback : 1));
  return Math.round(finiteSetting(value, safeFallback, .5, 2) * 4) / 4;
}

export const useAppStore = create<AppState>((set, get) => ({
  songs: [], collections: [], dislikes: {}, likeTimes: {}, stats: {}, progress: {}, actualDuration: {}, genreOverrides: {}, lastSession: null,
  settings: defaultSettings,
  player: { song: null, index: -1, playing: false, time: 0, duration: 0, loading: false, lyricText: '', preview: null, error: '', desktopLyricOn: false },
  view: savedView(), activeCollectionId: null, shareSelection: [], hydrated: false, loading: true, error: '',
  initialize: () => {
    if (initializeTask) { subscribeSongMetadata(); return initializeTask; }
    const attempt = ++initializationRequest;
    set({ loading: true, error: '' });
    const task = (async () => {
      try {
        const api = getBridge('musicAPI');
        subscribeSongMetadata();
        const request = ++songsRequest;
        let userDataReady = false;
        // Prefer one complete state when disk preferences are already available.
        // A genuinely pending user-data request still cannot delay basic songs.
        const userDataTask = api.getUserData().then((value: any) => {
          userDataReady = true;
          return value;
        });
        const [songs, userData] = await Promise.all([
          api.getSongs().then((value: Song[]) => {
            if (!userDataReady) {
              if (attempt === initializationRequest && request === songsRequest) publishSongs(songsWithMetadata(value));
              if (attempt === initializationRequest) set({ loading: false });
            }
            return value;
          }),
          userDataTask,
        ]);
        if (attempt !== initializationRequest) return;
        extraUserData = userData || {};
        let likes = pathTimes(userData?.likes);
        let migratedLocalLikes = false;
        if (!Object.keys(likes).length) {
          try { likes = pathTimes(JSON.parse(localStorage.getItem('sqet-likes') || '[]')); migratedLocalLikes = Object.keys(likes).length > 0; } catch { /* Legacy preferences can be malformed. */ }
        }
        let collections: Collection[] = Array.isArray(userData?.collections) ? userData.collections.filter((c: any) => c?.id && c?.name).map((c: any) => ({ ...c, songs: Array.isArray(c.songs) ? c.songs : [] })) : [];
        if (!collections.length && Object.keys(likes).length) collections = [{ id: 'migrated-liked', name: '我喜欢的音乐', songs: Object.keys(likes), createdAt: Date.now() }];
        pendingLocalLikesMigration = migratedLocalLikes;
        const lyricSize = finiteSetting(userData?.settings?.lyricSize, defaultSettings.lyricSize, 12, 36);
        const legacyCurrentSize = userData?.settings ? Math.round(lyricSize * 1.24) : defaultSettings.currentLyricSize;
        let hydrated: AppState = { ...get(), songs: request === songsRequest ? songsWithMetadata(songs) : get().songs, collections, likeTimes: likes,
          dislikes: pathTimes(userData?.dislikes), stats: Object.fromEntries(Object.entries(userData?.stats || {}).map(([path,entry]) => [path,normalizeSongStats(entry)])), progress: userData?.progress || {},
          actualDuration: userData?.actualDuration || {}, lastSession: userData?.lastSession || null,
          genreOverrides: Object.fromEntries(Object.entries(userData?.genreOverrides || {}).filter(([,value]) => Array.isArray(value)).map(([path,value]) => [path,[...new Set((value as unknown[]).filter((genre): genre is string => typeof genre === 'string').map(genre => genre.trim()).filter(Boolean))]])),
          settings: { ...defaultSettings, ...userData?.settings,
            interfaceMode: userData?.settings?.interfaceMode === 'classic' ? 'classic' : 'modern',
            experimentalAppleUI: userData?.settings?.experimentalAppleUI === true,
            experimentalFrostedGlass: userData?.settings?.experimentalFrostedGlass === true,
            appleControlsPosition: userData?.settings?.appleControlsPosition === 'right' ? 'right' : 'left',
            sidebarCollapsed: typeof userData?.settings?.sidebarCollapsed === 'boolean' ? userData.settings.sidebarCollapsed : true,
            sidebarWidth: normalizeSidebarWidth(userData?.settings?.sidebarWidth),
            glassOpacity: finiteSetting(userData?.settings?.glassOpacity, defaultSettings.glassOpacity, .12, 1),
            colorIntensity: finiteSetting(userData?.settings?.colorIntensity, defaultSettings.colorIntensity, 0, 1),
            playbackRate: normalizePlaybackRate(userData?.settings?.playbackRate),
            lyricSize,
            currentLyricSize: finiteSetting(userData?.settings?.currentLyricSize, legacyCurrentSize, lyricSize, 60),
          }, hydrated: false, loading: false, error: '',
        };
        const hadChanges = pendingChanges.length > 0;
        for (const change of pendingChanges) hydrated = { ...hydrated, ...change(hydrated) };
        pendingChanges.length = 0;
        set({ ...hydrated, hydrated: true });
        // Disk writes must not hold up the first playable screen. An early
        // debounce may already have fired while hydration safely rejected it.
        if (migratedLocalLikes) void persistNow();
        if (hadChanges) scheduleSave();
      } catch (error) { if (attempt === initializationRequest) set({ loading: false, error: errorMessage(error) }); }
    })().finally(() => {
      // A synchronous bridge/subscription failure can finish before task is
      // assigned. Clear only this settled failure, after the assignment exists.
      if (initializeTask === task && !get().hydrated) initializeTask = null;
    });
    initializeTask = task;
    return task;
  },
  reloadSongs: async () => {
    subscribeSongMetadata();
    const request = ++songsRequest;
    const songs = await getBridge('musicAPI').getSongs();
    if (request !== songsRequest) return;
    const updated = songsWithMetadata(songs);
    publishSongs(updated);
  },
  setView: view => navigateView(get().view, view, () => { set({ view }); localStorage.setItem('sqet-current-view', view); }),
  setPlayer: patch => set(state => ({ player: { ...state.player, ...patch } })),
  setSongGenres: (path, genres) => {
    if (!get().songs.some(song => song.audioPath === path)) return;
    applyUserDataChange(state => {
      const genreOverrides = { ...state.genreOverrides };
      if (genres === null) delete genreOverrides[path];
      else genreOverrides[path] = [...new Set(genres.map(genre => genre.trim()).filter(Boolean))];
      return { genreOverrides };
    }); scheduleSave();
  },
  setSettings: patch => {
    applyUserDataChange(state => {
      const settings = { ...state.settings, ...patch };
      if ('experimentalAppleUI' in patch) settings.experimentalAppleUI = patch.experimentalAppleUI === true;
      if ('experimentalFrostedGlass' in patch) settings.experimentalFrostedGlass = patch.experimentalFrostedGlass === true;
      if ('appleControlsPosition' in patch) settings.appleControlsPosition = patch.appleControlsPosition === 'right' ? 'right' : 'left';
      if ('playbackRate' in patch) settings.playbackRate = normalizePlaybackRate(patch.playbackRate, normalizePlaybackRate(state.settings.playbackRate));
      if ('lyricSize' in patch || 'currentLyricSize' in patch) {
        const previousSize = finiteSetting(state.settings.lyricSize, defaultSettings.lyricSize, 12, 36);
        settings.lyricSize = finiteSetting(settings.lyricSize, previousSize, 12, 36);
        const previousCurrent = finiteSetting(state.settings.currentLyricSize, defaultSettings.currentLyricSize, settings.lyricSize, 60);
        settings.currentLyricSize = finiteSetting(settings.currentLyricSize, previousCurrent, settings.lyricSize, 60);
      }
      return { settings };
    });
    if (('experimentalAppleUI' in patch || 'experimentalFrostedGlass' in patch || 'appleControlsPosition' in patch) && get().hydrated) void persistNow();
    else scheduleSave();
  },
  createCollection: name => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    applyUserDataChange(state => ({ collections: [...state.collections, { id, name, songs: [], createdAt }] }));
    scheduleSave(); return id;
  },
  renameCollection: (id, name) => { applyUserDataChange(state => ({ collections: state.collections.map(c => c.id === id ? { ...c, name } : c) })); scheduleSave(); },
  deleteCollection: id => { applyUserDataChange(state => ({ collections: state.collections.filter(c => c.id !== id), activeCollectionId: state.activeCollectionId === id ? null : state.activeCollectionId })); scheduleSave(); },
  setCollectionSong: (id, path, included) => {
    const timestamp = Date.now();
    applyUserDataChange(state => ({ collections: state.collections.map(c => c.id === id ? { ...c, songs: included ? [...new Set([...c.songs, path])] : c.songs.filter(p => p !== path) } : c),
      dislikes: included ? Object.fromEntries(Object.entries(state.dislikes).filter(([p]) => p !== path)) : state.dislikes,
      likeTimes: included ? { ...state.likeTimes, [path]: timestamp } : state.likeTimes,
    })); scheduleSave();
  },
  toggleLike: path => {
    const included = !get().collections.find(collection => collection.name === '我喜欢的音乐')?.songs.includes(path);
    const id = crypto.randomUUID(), timestamp = Date.now();
    applyUserDataChange(state => {
      const favorites = state.collections.find(collection => collection.name === '我喜欢的音乐') || { id, name: '我喜欢的音乐', songs: [], createdAt: timestamp };
      const collections = state.collections.some(collection => collection.id === favorites.id) ? state.collections : [...state.collections, favorites];
      return { collections: collections.map(collection => collection.id === favorites.id ? { ...collection, songs: included ? [...new Set([...collection.songs, path])] : collection.songs.filter(song => song !== path) } : collection),
        dislikes: included ? Object.fromEntries(Object.entries(state.dislikes).filter(([song]) => song !== path)) : state.dislikes,
        likeTimes: included ? { ...state.likeTimes, [path]: timestamp } : state.likeTimes,
      };
    });
    scheduleSave();
  },
  toggleDislike: path => {
    const marked = get().dislikes[path] === undefined, timestamp = Date.now();
    applyUserDataChange(state => {
      const dislikes = { ...state.dislikes };
      if (!marked) { delete dislikes[path]; return { dislikes }; }
      dislikes[path] = timestamp;
      return { dislikes, collections: state.collections.map(c => ({ ...c, songs: c.songs.filter(p => p !== path) })) };
    }); scheduleSave();
  },
  removeSong: path => {
    ++songsRequest;
    songGenres.delete(path);
    pendingSongGenres.delete(path);
    applyUserDataChange(state => {
      const songs = state.songs.filter(song => song.audioPath !== path);
      const clean = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== path));
      const currentDeleted = state.player.song?.audioPath === path;
      return { songs, collections: state.collections.map(c => ({ ...c, songs: c.songs.filter(p => p !== path) })),
        dislikes: clean(state.dislikes), likeTimes: clean(state.likeTimes), stats: clean(state.stats),
        progress: clean(state.progress), actualDuration: clean(state.actualDuration),
        genreOverrides: clean(state.genreOverrides),
        lastSession: state.lastSession?.audioPath === path ? null : state.lastSession,
        player: { ...state.player, index: songs.findIndex(song => song.audioPath === state.player.song?.audioPath),
          ...(currentDeleted ? { song: null, playing: false, time: 0, duration: 0, lyricText: '' } : {}),
        },
      };
    }); scheduleSave();
  },
}));
