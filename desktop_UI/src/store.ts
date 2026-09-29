import { create } from 'zustand';
import { errorMessage, getBridge } from './api';
import type { Collection, PlayerState, Settings, Song, SongStats, View } from './types';

export const defaultSettings: Settings = {
  playMode: 1, volume: 1, fadePause: true, glassOpacity: 0.72, discCover: false, colorIntensity: 0.85,
  lyricDone: 0.9, lyricWait: 0.55, lyricSize: 20, themeFollowCover: false,
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
  lastSession: { audioPath: string; t: number } | null; settings: Settings;
  player: PlayerState; view: View; activeCollectionId: string | null; shareSelection: string[];
  hydrated: boolean; loading: boolean; error: string;
  initialize: () => Promise<void>; reloadSongs: () => Promise<void>;
  setView: (view: View) => void; setSettings: (patch: Partial<Settings>) => void;
  setPlayer: (patch: Partial<PlayerState>) => void;
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

export function isLiked(path: string): boolean { return useAppStore.getState().collections.some(c => c.songs.includes(path)); }
export function serializeUserData() {
  const state = useAppStore.getState();
  const likedPaths = [...new Set(state.collections.flatMap(c => c.songs))];
  return { ...extraUserData,
    likes: likedPaths.map(path => ({ path, ts: state.likeTimes[path] || 0 })),
    dislikes: Object.entries(state.dislikes).map(([path, ts]) => ({ path, ts })),
    collections: state.collections, stats: state.stats, progress: state.progress,
    actualDuration: state.actualDuration, lastSession: state.lastSession, settings: state.settings,
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
export function scheduleSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => persistNow(), 500); }
function pathTimes(value: any): Record<string, number> {
  const entries = Array.isArray(value) ? value : [];
  return Object.fromEntries(entries.map((entry: any, index: number) => typeof entry === 'string' ? [entry, Date.now() - index] : [entry.path, Number(entry.ts) || 0]).filter(([path]: any[]) => !!path));
}

export const useAppStore = create<AppState>((set, get) => ({
  songs: [], collections: [], dislikes: {}, likeTimes: {}, stats: {}, progress: {}, actualDuration: {}, lastSession: null,
  settings: defaultSettings,
  player: { song: null, index: -1, playing: false, time: 0, duration: 0, loading: false, lyricText: '', preview: null, error: '', desktopLyricOn: false },
  view: savedView(), activeCollectionId: null, shareSelection: [], hydrated: false, loading: true, error: '',
  initialize: () => {
    if (initializeTask) return initializeTask;
    initializeTask = (async () => {
      try {
        const api = getBridge('musicAPI');
        const [songs, userData] = await Promise.all([api.getSongs(), api.getUserData()]);
        extraUserData = userData || {};
        let likes = pathTimes(userData?.likes);
        let migratedLocalLikes = false;
        if (!Object.keys(likes).length) {
          try { likes = pathTimes(JSON.parse(localStorage.getItem('sqet-likes') || '[]')); migratedLocalLikes = Object.keys(likes).length > 0; } catch { /* Legacy preferences can be malformed. */ }
        }
        let collections: Collection[] = Array.isArray(userData?.collections) ? userData.collections.filter((c: any) => c?.id && c?.name).map((c: any) => ({ ...c, songs: Array.isArray(c.songs) ? c.songs : [] })) : [];
        if (!collections.length && Object.keys(likes).length) collections = [{ id: 'migrated-liked', name: '我喜欢的音乐', songs: Object.keys(likes), createdAt: Date.now() }];
        pendingLocalLikesMigration = migratedLocalLikes;
        set({ songs: Array.isArray(songs) ? songs : [], collections, likeTimes: likes,
          dislikes: pathTimes(userData?.dislikes), stats: userData?.stats || {}, progress: userData?.progress || {},
          actualDuration: userData?.actualDuration || {}, lastSession: userData?.lastSession || null,
          settings: { ...defaultSettings, ...userData?.settings }, hydrated: true, loading: false, error: '',
        });
        if (migratedLocalLikes) await persistNow();
      } catch (error) { set({ loading: false, error: errorMessage(error) }); initializeTask = null; }
    })();
    return initializeTask;
  },
  reloadSongs: async () => {
    const songs = await getBridge('musicAPI').getSongs();
    const current = get().player.song;
    const index = current ? songs.findIndex((song: Song) => song.audioPath === current.audioPath) : -1;
    set(state => ({ songs, player: { ...state.player, index, song: index >= 0 ? songs[index] : state.player.song } }));
  },
  setView: view => { set({ view }); localStorage.setItem('sqet-current-view', view); },
  setPlayer: patch => set(state => ({ player: { ...state.player, ...patch } })),
  setSettings: patch => { set(state => ({ settings: { ...state.settings, ...patch } })); scheduleSave(); },
  createCollection: name => {
    const id = crypto.randomUUID();
    set(state => ({ collections: [...state.collections, { id, name, songs: [], createdAt: Date.now() }] }));
    scheduleSave(); return id;
  },
  renameCollection: (id, name) => { set(state => ({ collections: state.collections.map(c => c.id === id ? { ...c, name } : c) })); scheduleSave(); },
  deleteCollection: id => { set(state => ({ collections: state.collections.filter(c => c.id !== id), activeCollectionId: state.activeCollectionId === id ? null : state.activeCollectionId })); scheduleSave(); },
  setCollectionSong: (id, path, included) => {
    set(state => ({ collections: state.collections.map(c => c.id === id ? { ...c, songs: included ? [...new Set([...c.songs, path])] : c.songs.filter(p => p !== path) } : c),
      dislikes: included ? Object.fromEntries(Object.entries(state.dislikes).filter(([p]) => p !== path)) : state.dislikes,
      likeTimes: included ? { ...state.likeTimes, [path]: Date.now() } : state.likeTimes,
    })); scheduleSave();
  },
  toggleLike: path => {
    let favorites = get().collections.find(collection => collection.name === '我喜欢的音乐');
    if (!favorites) { const id = get().createCollection('我喜欢的音乐'); favorites = get().collections.find(collection => collection.id === id)!; }
    get().setCollectionSong(favorites.id,path,!favorites.songs.includes(path));
    scheduleSave();
  },
  toggleDislike: path => {
    set(state => {
      const dislikes = { ...state.dislikes };
      if (dislikes[path] !== undefined) { delete dislikes[path]; return { dislikes }; }
      dislikes[path] = Date.now();
      return { dislikes, collections: state.collections.map(c => ({ ...c, songs: c.songs.filter(p => p !== path) })) };
    }); scheduleSave();
  },
  removeSong: path => {
    set(state => {
      const songs = state.songs.filter(song => song.audioPath !== path);
      const clean = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== path));
      const currentDeleted = state.player.song?.audioPath === path;
      return { songs, collections: state.collections.map(c => ({ ...c, songs: c.songs.filter(p => p !== path) })),
        dislikes: clean(state.dislikes), likeTimes: clean(state.likeTimes), stats: clean(state.stats),
        progress: clean(state.progress), actualDuration: clean(state.actualDuration),
        lastSession: state.lastSession?.audioPath === path ? null : state.lastSession,
        player: { ...state.player, index: songs.findIndex(song => song.audioPath === state.player.song?.audioPath),
          ...(currentDeleted ? { song: null, playing: false, time: 0, duration: 0, lyricText: '' } : {}),
        },
      };
    }); scheduleSave();
  },
}));
