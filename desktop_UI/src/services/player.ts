import { errorMessage, getBridge, mediaUrl, subscribe } from '../api';
import { applyUserDataChange, normalizePlaybackRate, persistNow, scheduleSave, useAppStore } from '../store';
import { notify } from '../ui';
import type { PreviewSong, Song } from '../types';
import { AudioEffects, normalizeFxSettings } from './audioFx';
import { parseLyrics, type LyricsData } from './lyrics';
import { isVideo, positive, preferredDuration, safeSeekTime } from './playbackUtils';
import { ShuffleRound } from './shuffleRound';
import { createCoverPalette, createShellPalette, normalizeCoverColor } from './coverPalette';
import { recordListening, recordPlay } from './listeningHistory';
export { isVideo, preferredDuration, safeSeekTime, shuffled } from './playbackUtils';

class PlayerService {
  readonly media = document.createElement('video');
  private initialized = false;
  private initializationTask: Promise<void> | null = null;
  private initializationVersion = 0;
  private startupVersion = 0;
  private unsubscribes: (() => void)[] = [];
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private effects: AudioEffects | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private lyricTimer: ReturnType<typeof setInterval> | null = null;
  private queuePaths: string[] | null = null;
  private collectionId: string | null = null;
  private likedContext = false;
  private songShuffle = new ShuffleRound<string>();
  private previewShuffle = new ShuffleRound<string>();
  private previewKeys = new WeakMap<PreviewSong, string>();
  private previewKeySequence = 0;
  // A shuffle order is a plan, not playback history: it is replaced each round.
  private songHistory: string[] = [];
  private songHistoryPosition = -1;
  private previewHistory: PreviewSong[] = [];
  private previewHistoryPosition = -1;
  private version = 0;
  private coverRequest = 0;
  private sourcePath = '';
  private requestedTime = 0;
  private lastWall = 0;
  private lastSaveWall = 0;
  private lastSyncWall = 0;
  private togetherRequest = 0;
  private togetherAcknowledged = 0;
  private togetherSession = '';
  private togetherGeneration = 0;
  private lastPosition = 0;
  private seekWall = 0;
  private failCount = 0;
  private lastFailedVersion = -1;
  private previewQueue: PreviewSong[] | null = null;
  private previewPosition = -1;
  private previewPositions = new WeakMap<PreviewSong, number>();
  private coverColor: { r: number; g: number; b: number } | null = null;
  private coverColorReady = true;
  private lyricWindowRequest = 0;
  private lyrics: LyricsData = { raw: false, lines: [] };

  constructor() {
    this.media.id = 'react-media-player';
    this.media.playsInline = true;
    this.media.preload = 'auto';
    this.media.volume = 1;
    this.media.crossOrigin = 'anonymous';
  }

  initialize(): Promise<void> {
    if (this.initializationTask) return this.initializationTask;
    const task = this.initializeStartup(++this.initializationVersion).finally(() => {
      if (this.initializationTask === task && !useAppStore.getState().hydrated) this.initializationTask = null;
    });
    this.initializationTask = task;
    return task;
  }

  private async initializeStartup(lifecycle: number): Promise<void> {
    if (!this.initialized) {
      this.startupVersion = this.version;
      this.initialized = true;
      this.applyPlaybackRate(useAppStore.getState().settings.playbackRate);
      for (const [event, handler] of this.handlers) {
        this.media.addEventListener(event, handler);
        this.unsubscribes.push(() => this.media.removeEventListener(event, handler));
      }
      this.bind('musicAPI', 'onDurationUpdate', (payload: { audioPath?: string; realDuration?: number; idx?: number; duration?: number }) => {
        const audioPath = payload?.audioPath || (typeof payload?.idx === 'number' ? useAppStore.getState().songs[payload.idx]?.audioPath : undefined);
        const realDuration = positive(payload?.realDuration) || positive(payload?.duration);
        if (!audioPath || !realDuration) return;
        applyUserDataChange(state => ({
          actualDuration: { ...state.actualDuration, [audioPath]: realDuration },
          songs: state.songs.map(song => song.audioPath === audioPath ? { ...song, realDuration } : song),
          player: { ...state.player, song: state.player.song && state.player.song.audioPath === audioPath ? { ...state.player.song, realDuration } : state.player.song },
        }));
        this.updateDuration(); scheduleSave();
      });
      this.bind('desktopLyric', 'onClosed', () => {
        this.lyricWindowRequest++;
        useAppStore.getState().setPlayer({ desktopLyricOn: false });
        this.stopLyricTimer();
      });
      this.bind('desktopLyric', 'onBoundsSaved', (bounds: number[]) => {
        if (Array.isArray(bounds)) useAppStore.getState().setSettings({ desktopLyricBounds: bounds });
      });
      this.bind('desktopLyric', 'onLockChanged', (locked: boolean) => useAppStore.getState().setSettings({ desktopLyricLocked: !!locked }));
      this.bind('stateAPI', 'onTogetherCommand', command => { void this.applyTogetherCommand(command); });
      this.unsubscribes.push(useAppStore.subscribe((state, previous) => {
        const song = state.player.song;
        // A library refresh can replace the sleeve without reopening its audio.
        // Compare paths so progress ticks and duration metadata never re-extract it.
        if (song && song.audioPath === previous.player.song?.audioPath &&
            (song.coverPath || '') !== (previous.player.song?.coverPath || '')) {
          void this.updateCoverColor(song.coverPath ? mediaUrl(song.coverPath) : '', song.coverPath || undefined, this.version);
          this.updateMediaMetadata(); this.syncDesktop(true);
        }
        if (state.settings.volume !== previous.settings.volume) { this.cancelFade(); this.applyVolume(state.settings.volume); }
        if (state.settings.playbackRate !== previous.settings.playbackRate) this.applyPlaybackRate(state.settings.playbackRate);
        if (state.settings.audioFx !== previous.settings.audioFx) this.effects?.apply(normalizeFxSettings(state.settings.audioFx));
        if (state.settings !== previous.settings) {
          this.sendSettings();
          if (state.settings.simulateLrcProgress !== previous.settings.simulateLrcProgress) this.sendLyricData();
          if (state.settings.playMode !== previous.settings.playMode) this.syncDesktop(true);
          if (state.settings.themeFollowCover !== previous.settings.themeFollowCover || state.settings.colorIntensity !== previous.settings.colorIntensity) this.applyCoverTheme();
        }
      }));
      const beforeUnload = () => { this.flushDuration(); this.saveProgress(); persistNow(true); };
      window.addEventListener('beforeunload', beforeUnload);
      this.unsubscribes.push(() => window.removeEventListener('beforeunload', beforeUnload));
    }
    // Media and IPC listeners must exist before base songs can be played. Only
    // automatic startup restoration waits for the original user preferences.
    await useAppStore.getState().initialize();
    if (!this.initialized || lifecycle !== this.initializationVersion || !useAppStore.getState().hydrated) return;
    this.applyVolume(useAppStore.getState().settings.volume);
    this.applyPlaybackRate(useAppStore.getState().settings.playbackRate);
    this.applyCoverTheme();
    this.installMediaSession();
    if (this.startupVersion !== this.version) return;
    const startupVersion = this.startupVersion;
    const interfaceSession = new URLSearchParams(globalThis.location?.search || '');
    if ((useAppStore.getState().settings.desktopLyricPersist || interfaceSession.get('desktopLyrics') === '1') && !useAppStore.getState().player.desktopLyricOn) {
      await this.toggleDesktopLyric().catch(error => console.error('桌面歌词自动开启失败', error));
    }
    if (!this.initialized || lifecycle !== this.initializationVersion || startupVersion !== this.version) return;
    const state = useAppStore.getState();
    const previous = state.songs.find(song => song.audioPath === state.lastSession?.audioPath);
    const initial = previous || this.playlist()[0];
    if (previous) {
      this.likedContext = state.collections.some(collection => collection.songs.includes(previous.audioPath));
    }
    if (initial) await this.openSong(initial, true, !previous || interfaceSession.get('interfaceSwitch') !== '1');
    // openSong increments once; a newer manual choice during its async work
    // owns the media and must never be paused by startup session restoration.
    const restoredVersion = startupVersion + (initial ? 1 : 0);
    if (this.initialized && lifecycle === this.initializationVersion && restoredVersion === this.version && interfaceSession.get('interfacePaused') === '1') this.media.pause();
  }

  private bind(name: Parameters<typeof subscribe>[0], method: string, listener: (...args: any[]) => void): void {
    try { if (getBridge(name)[method]) this.unsubscribes.push(subscribe(name, method, listener)); }
    catch (error) { console.warn(`未能绑定 ${name}.${method}`, error); }
  }

  dispose(): void {
    this.lyricWindowRequest++;
    this.initializationVersion++;
    this.version++;
    this.togetherGeneration++;
    this.cancelFade(); this.flushDuration(); this.saveProgress(); this.media.pause();
    this.stopLyricTimer(); this.unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    this.initialized = false;
    this.initializationTask = null;
    // Retain the MediaElementSource: a media element can only be connected once.
    void this.context?.suspend().catch(() => {});
  }
  prepareInterfaceSwitch(): void { this.flushDuration(); this.saveProgress(); }

  private initAudio(): void {
    if (this.context) { void this.context.resume().catch(() => {}); return; }
    if (!window.AudioContext) return;
    let source: MediaElementAudioSourceNode | null = null;
    try {
      this.context = new AudioContext();
      source = this.context.createMediaElementSource(this.media);
      this.gain = this.context.createGain();
      this.media.volume = 1;
      try { this.effects = new AudioEffects(this.context, source, this.gain); }
      catch (error) { source.disconnect(); source.connect(this.gain); console.warn('音效链不可用，采用直通播放', error); }
      this.gain.connect(this.context.destination);
      this.effects?.apply(normalizeFxSettings(useAppStore.getState().settings.audioFx));
      this.applyVolume(useAppStore.getState().settings.volume);
      void this.context.resume().catch(() => {});
    } catch (error) {
      // If MediaElementSource already exists, leave a valid direct output path.
      if (source && this.context && this.gain) { source.disconnect(); source.connect(this.gain); this.gain.connect(this.context.destination); }
      else { this.context = null; this.gain = null; }
      console.warn('Web Audio 初始化失败', error);
    }
  }

  async playSong(song: Song, queue?: Song[], restore = true): Promise<void> {
    this.takeTogetherControl();
    this.failCount = 0;
    const state = useAppStore.getState();
    this.queuePaths = queue ? [...new Set(queue.map(item => item.audioPath))] : null;
    this.collectionId = state.view === 'liked' ? state.activeCollectionId : null;
    this.likedContext = state.view === 'liked';
    await this.openSong(song, restore);
  }

  private async openSong(candidate: Song, restore: boolean, countPlay = true,
    together?: { position?: number; autoplay?: boolean; onStarted: () => void }): Promise<void> {
    this.initAudio(); this.cancelFade(); this.flushDuration(); this.saveProgress();
    const version = ++this.version;
    const state = useAppStore.getState();
    const song = state.songs.find(item => item.audioPath === candidate.audioPath) || candidate;
    const changed = this.sourcePath !== song.audioPath || !!state.player.preview;
    this.media.pause(); this.lastWall = 0; this.lastSaveWall = 0; this.lastPosition = 0;
    this.requestedTime = together && Number.isFinite(together.position) ? Math.max(0, together.position!)
      : restore ? positive(state.progress[song.audioPath]) || (state.lastSession?.audioPath === song.audioPath ? positive(state.lastSession.t) : 0) : 0;
    state.setPlayer({ song, preview: null, index: state.songs.findIndex(item => item.audioPath === song.audioPath), playing: false,
      time: changed ? this.requestedTime : this.media.currentTime, duration: preferredDuration(song, changed ? 0 : this.media.duration), loading: true, lyricText: '', error: '' });
    this.sourcePath = song.audioPath;
    if (changed) {
      this.media.src = mediaUrl(song.audioPath);
      this.media.load();
      if (countPlay) this.incrementPlay(song.audioPath);
    } else if (!restore) this.seek(this.requestedTime, !!together);
    this.coverColorReady = !song.coverPath;
    this.setLyrics('', isVideo(song));
    this.sendInfo(); this.syncDesktop(true); this.updateMediaMetadata();
    void this.updateCoverColor(song.coverPath ? mediaUrl(song.coverPath) : '', song.coverPath || undefined, version);
    const lyricsTask = this.loadSongLyrics(song).then(text => {
      if (version !== this.version) return;
      state.setPlayer({ lyricText: text }); this.setLyrics(text, isVideo(song));
    });
    if (together?.autoplay === false) {
      state.setPlayer({ loading: false }); this.media.pause();
    } else await this.playMedia(version);
    together?.onStarted();
    await lyricsTask;
  }

  private async applyTogetherCommand(command: any): Promise<void> {
    if (!command || typeof command.session !== 'string' || !Number.isSafeInteger(command.seq)) return;
    if (command.session !== this.togetherSession) {
      if (command.op === 'cancel') return;
      this.togetherSession = command.session; this.togetherRequest = 0; this.togetherAcknowledged = 0;
      this.togetherGeneration++;
    }
    if (command.op === 'cancel') {
      if (command.seq === this.togetherRequest) this.togetherGeneration++;
      return;
    }
    if (command.seq <= this.togetherRequest) return;
    const request = this.togetherRequest = command.seq;
    const generation = ++this.togetherGeneration;
    const payload = command.payload || {};
    const finish = () => {
      if (!this.initialized || this.togetherRequest !== request || generation !== this.togetherGeneration) return;
      this.togetherAcknowledged = request; this.syncDesktop(true);
    };
    try {
      if (command.op === 'song') {
        const song = useAppStore.getState().songs.find(item => item.audioPath === payload.audioPath);
        if (!song) return;
        // A phone's library selection starts the desktop library queue, rather
        // than inheriting an unrelated collection that happened to be open.
        this.queuePaths = null; this.collectionId = null; this.likedContext = false;
        if (Number.isFinite(payload.playbackRate)) useAppStore.getState().setSettings({ playbackRate: normalizePlaybackRate(payload.playbackRate) });
        await this.openSong(song, false, !!payload.isPlaying, {
          position: payload.position, autoplay: payload.isPlaying !== false, onStarted: finish,
        });
      } else if (command.op === 'pause') {
        this.cancelFade(); this.media.pause();
        if (Number.isFinite(payload.position)) this.seek(payload.position, true);
      } else if (command.op === 'play') {
        if (Number.isFinite(payload.position)) this.seek(payload.position, true);
        await this.playMedia(this.version);
      } else if (command.op === 'seek') {
        if (Number.isFinite(payload.position)) this.seek(payload.position, true);
      } else if (command.op === 'rate') {
        useAppStore.getState().setSettings({ playbackRate: normalizePlaybackRate(payload.playbackRate) });
      }
    } catch (error) { console.warn('一起听操作失败', error); }
    finally { finish(); }
  }

  private async loadSongLyrics(song: Song): Promise<string> {
    const api = getBridge('musicAPI');
    if (song.rawPath) {
      try { const text = String(await api.getLyrics(song.rawPath) || ''); if (parseLyrics(text).raw) return text; }
      catch (error) { console.warn('逐字歌词读取失败', error); }
    }
    const path = song.lrcPath || song.lyricPath;
    if (path) { try { return String(await api.getLyrics(path) || ''); } catch (error) { console.warn('歌词读取失败', error); } }
    return '';
  }

  async playPreview(preview: PreviewSong): Promise<void> {
    this.takeTogetherControl();
    if (!preview.url && preview.resolve) {
      const pendingVersion = ++this.version;
      useAppStore.getState().setPlayer({ loading: true, error: '' });
      try {
        const resolved = await preview.resolve();
        if (pendingVersion !== this.version) return;
        const ready = { ...resolved, queue: preview.queue || resolved.queue };
        if (ready.queue) {
          const position = this.previewIndex(preview, ready.queue);
          this.previewPositions.set(ready, position);
          if (position >= 0) this.previewKeys.set(ready, this.previewKey(ready.queue[position]));
        }
        return await this.playPreview(ready);
      } catch (error) {
        if (pendingVersion !== this.version) return;
        useAppStore.getState().setPlayer({ loading: false }); notify(`试听加载失败：${errorMessage(error)}`, 'error'); return;
      }
    }
    if (!preview.url) { notify('没有可用的试听地址', 'error'); return; }
    this.initAudio(); this.cancelFade(); this.flushDuration(); this.saveProgress();
    const version = ++this.version;
    this.media.pause(); this.lastWall = 0; this.lastPosition = 0; this.requestedTime = 0;
    this.sourcePath = preview.url;
    this.previewQueue = preview.queue || null;
    const savedPosition = this.previewPositions.get(preview);
    this.previewPosition = preview.queue
      ? savedPosition != null && preview.queue[savedPosition] && this.previewKey(preview.queue[savedPosition]) === this.previewKey(preview)
        ? savedPosition : this.previewIndex(preview, preview.queue)
      : -1;
    if (this.previewPosition >= 0) this.previewPositions.set(preview, this.previewPosition);
    useAppStore.getState().setPlayer({ song: null, index: -1, preview, playing: false, time: 0, duration: 0, loading: true, error: '', lyricText: preview.lyric || '' });
    this.media.src = mediaUrl(preview.url); this.media.load();
    this.coverColorReady = !preview.cover;
    this.setLyrics(preview.lyric || '', isVideo(null, preview));
    if (!preview.lyric && preview.source === 'playlist' && preview.original?.lyricUrl) {
      void fetch(preview.original.lyricUrl).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).then(text => {
        if (version !== this.version) return;
        useAppStore.getState().setPlayer({ lyricText: text }); this.setLyrics(text, isVideo(null, preview)); this.syncDesktop(true);
      }).catch(error => console.warn('远程歌单歌词读取失败', error));
    }
    this.sendInfo(); this.syncDesktop(true); this.updateMediaMetadata();
    void this.updateCoverColor(preview.cover ? mediaUrl(preview.cover) : '', preview.cover || undefined, version);
    await this.playMedia(version);
  }

  private async playMedia(version = this.version): Promise<void> {
    if (version !== this.version) return;
    this.applyPlaybackRate(useAppStore.getState().settings.playbackRate);
    try { await this.media.play(); }
    catch (error) {
      if (version !== this.version || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        useAppStore.getState().setPlayer({ loading: false, playing: false });
        return;
      }
      this.handleFailure(errorMessage(error));
    }
  }

  toggle(): void {
    this.takeTogetherControl();
    const state = useAppStore.getState();
    if (!state.player.song && !state.player.preview) {
      const initial = this.playlist()[0]; if (initial) void this.playSong(initial); return;
    }
    if (this.fadeTimer) { this.cancelFade(); return; }
    if (!this.media.paused) {
      if (state.settings.fadePause && this.gain) this.fadePause();
      else this.media.pause();
    } else { this.initAudio(); this.cancelFade(); void this.playMedia(); }
  }

  stop(): void {
    this.takeTogetherControl();
    this.version++; this.cancelFade(); this.flushDuration(); this.saveProgress();
    this.requestedTime = 0;
    this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.sourcePath = '';
    this.lyrics = { raw: false, lines: [] };
    this.songHistory = []; this.songHistoryPosition = -1;
    this.previewHistory = []; this.previewHistoryPosition = -1;
    this.songShuffle.clear(); this.previewShuffle.clear();
    useAppStore.getState().setPlayer({ song: null, preview: null, index: -1, time: 0, duration: 0, playing: false, loading: false, lyricText: '', error: '' });
    this.coverColor = null; this.coverColorReady = true; this.applyCoverTheme();
    this.send(this.lyricSnapshot());
    this.send({ type: 'clear' }); this.sendInfo(); this.sendTime(); this.send({ type: 'color', color: null, colorReady: true }); this.syncDesktop(true);
  }

  private playlist(): Song[] {
    const state = useAppStore.getState();
    let paths = this.queuePaths;
    if (!paths && this.likedContext) {
      paths = this.collectionId ? state.collections.find(collection => collection.id === this.collectionId)?.songs || [] : [...new Set(state.collections.flatMap(collection => collection.songs))];
    }
    const byPath = new Map(state.songs.map(song => [song.audioPath, song]));
    const songs = paths ? paths.map(path => byPath.get(path)).filter((song): song is Song => !!song) : state.songs;
    return songs.filter(song => state.dislikes[song.audioPath] === undefined);
  }

  getQueue(): Song[] { return this.playlist(); }

  remapSongPath(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    if (this.queuePaths) this.queuePaths = [...new Set(this.queuePaths.map(path => path === oldPath ? newPath : path))];
    this.songShuffle.replace(oldPath, newPath);
    this.songHistory = this.songHistory.map(path => path === oldPath ? newPath : path);
  }

  private rememberSong(path: string): boolean {
    if (this.songHistory[this.songHistoryPosition] === path) return false;
    this.songHistory.splice(this.songHistoryPosition + 1);
    this.songHistory.push(path);
    if (this.songHistory.length > 250) this.songHistory.shift();
    this.songHistoryPosition = this.songHistory.length - 1;
    return true;
  }

  private historySong(direction: number): Song | undefined {
    const state = useAppStore.getState();
    const available = new Map(state.songs.filter(song => state.dislikes[song.audioPath] === undefined).map(song => [song.audioPath, song]));
    for (let position = this.songHistoryPosition + direction; position >= 0 && position < this.songHistory.length; position += direction) {
      const song = available.get(this.songHistory[position]);
      if (!song || song.audioPath === state.player.song?.audioPath) continue;
      this.songHistoryPosition = position;
      return song;
    }
    return undefined;
  }

  private rememberPreview(preview: PreviewSong): boolean {
    const current = this.previewHistory[this.previewHistoryPosition];
    if (current === preview || (current?.url === preview.url && current?.source === preview.source && current?.queue === preview.queue &&
        (!preview.queue || this.previewPositions.get(current) === this.previewPosition))) return false;
    this.previewHistory.splice(this.previewHistoryPosition + 1);
    this.previewHistory.push(preview);
    if (this.previewHistory.length > 250) this.previewHistory.shift();
    this.previewHistoryPosition = this.previewHistory.length - 1;
    return true;
  }

  private historyPreview(direction: number): PreviewSong | undefined {
    const position = this.previewHistoryPosition + direction;
    if (position < 0 || position >= this.previewHistory.length) return undefined;
    this.previewHistoryPosition = position;
    return this.previewHistory[position];
  }

  next(direction = 1): void {
    const state = useAppStore.getState();
    if (state.player.preview) { void this.nextPreview(direction); return; }
    const playlist = this.playlist();
    let target: Song | undefined;
    const currentPath = state.player.song?.audioPath;
    if (state.settings.playMode === 2) {
      target = this.historySong(direction < 0 ? -1 : 1);
      if (target) { void this.openSong(target, true); return; }
      // At the start of history there is no previously played random track.
      if (direction < 0) return;
      if (!playlist.length) { this.media.pause(); notify('播放队列中没有可推荐的歌曲'); return; }
      const path = this.songShuffle.next(playlist.map(song => song.audioPath), currentPath);
      target = playlist.find(song => song.audioPath === path);
    } else {
      if (!playlist.length) { this.media.pause(); notify('播放队列中没有可推荐的歌曲'); return; }
      const position = playlist.findIndex(song => song.audioPath === currentPath);
      target = playlist[position < 0 ? (direction < 0 ? playlist.length - 1 : 0) : (position + (direction < 0 ? -1 : 1) + playlist.length) % playlist.length];
    }
    if (target) void this.openSong(target, true);
  }

  private async nextPreview(direction: number): Promise<void> {
    if (useAppStore.getState().settings.playMode === 2) {
      const previous = this.historyPreview(direction < 0 ? -1 : 1);
      if (previous) { await this.playPreview(previous); return; }
      if (direction < 0) return;
    }
    const preview = useAppStore.getState().player.preview;
    const queue = preview?.queue;
    if (!preview || !queue?.length) { this.media.pause(); return; }
    const cached = queue[this.previewPosition];
    const position = this.previewQueue === queue && cached && this.previewKey(cached) === this.previewKey(preview)
      ? this.previewPosition : this.previewIndex(preview, queue);
    let nextPosition: number;
    if (useAppStore.getState().settings.playMode === 2) {
      const keys = queue.map(item => this.previewKey(item));
      const key = this.previewShuffle.next(keys, position >= 0 ? keys[position] : undefined);
      nextPosition = keys.indexOf(key!);
      if (nextPosition < 0) return;
    } else nextPosition = position < 0 ? (direction < 0 ? queue.length - 1 : 0) : (position + (direction < 0 ? -1 : 1) + queue.length) % queue.length;
    const pendingVersion = ++this.version;
    try {
      let target = queue[nextPosition];
      const targetKey = this.previewKey(target);
      useAppStore.getState().setPlayer({ loading: true, error: '' });
      if (!target.url && target.resolve) target = await target.resolve();
      if (pendingVersion !== this.version) return;
      // Resolution can outlive an in-place queue refresh. A numeric slot may
      // now contain another song, so retain and relocate the selected identity.
      const resolvedPosition = queue.findIndex(item => this.previewKey(item) === targetKey);
      if (resolvedPosition < 0) { useAppStore.getState().setPlayer({ loading: false }); return; }
      const ready = { ...target, queue };
      this.previewPositions.set(ready, resolvedPosition);
      this.previewKeys.set(ready, targetKey);
      await this.playPreview(ready);
    } catch (error) {
      if (pendingVersion !== this.version) return;
      useAppStore.getState().setPlayer({ loading: false });
      notify(`试听加载失败：${errorMessage(error)}`, 'error');
    }
  }

  private previewKey(item: PreviewSong): string {
    const known = this.previewKeys.get(item);
    if (known) return known;
    const source = item.original?.source || item.source || '';
    const id = item.original?.id ?? item.original?.hash ?? item.original?.trackId;
    // Unknown unresolved songs need distinct identities, even with equal titles.
    const key = id != null && String(id) ? JSON.stringify(['source', source, String(id)])
      : item.url ? JSON.stringify(['url', item.url]) : `preview-object:${++this.previewKeySequence}`;
    this.previewKeys.set(item, key);
    return key;
  }

  private previewIndex(preview: PreviewSong, queue: PreviewSong[]): number {
    const source = (item: PreviewSong) => item.original?.source || item.source || '';
    const id = (item: PreviewSong) => String(item.original?.id ?? item.original?.hash ?? item.original?.trackId ?? '');
    let index = queue.findIndex(item => item === preview);
    const known = this.previewKeys.get(preview);
    if (index < 0 && known) index = queue.findIndex(item => this.previewKey(item) === known);
    if (index < 0 && id(preview)) index = queue.findIndex(item => id(item) === id(preview) && source(item) === source(preview));
    if (index < 0 && preview.url) index = queue.findIndex(item => !!item.url && item.url === preview.url);
    if (index < 0 && preview.resolve) index = queue.findIndex(item => item.resolve === preview.resolve);
    if (index < 0 && !preview.url && !id(preview)) index = queue.findIndex(item => item.name === preview.name && item.artist === preview.artist && source(item) === source(preview));
    return index;
  }

  private takeTogetherControl(): void {
    if (this.togetherRequest <= this.togetherAcknowledged) return;
    this.togetherGeneration++; this.togetherAcknowledged = this.togetherRequest;
  }
  seek(time: number, fromTogether = false): void {
    if (!fromTogether) this.takeTogetherControl();
    const duration = this.duration();
    if (!duration) return;
    this.cancelFade(); this.flushDuration();
    this.seekWall = performance.now();
    const target = safeSeekTime(time, duration, this.media.duration);
    this.requestedTime = this.media.readyState < 1 ? target : 0;
    this.lastPosition = target;
    try { this.media.currentTime = target; }
    catch (error) { console.warn('跳转播放位置失败', error); return; }
    useAppStore.getState().setPlayer({ time: target });
    this.saveProgress(); this.sendTime(); this.syncDesktop(true); this.lastWall = performance.now();
  }

  setVolume(value: number): void {
    const volume = Math.max(0, Math.min(1.5, Number.isFinite(value) ? value : 1));
    this.cancelFade(); this.applyVolume(volume); useAppStore.getState().setSettings({ volume });
  }
  private applyVolume(value: number): void {
    const volume = Math.max(0, Math.min(1.5, value));
    if (this.gain && this.context) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime); this.gain.gain.value = volume; this.media.volume = 1;
    } else this.media.volume = Math.min(1, volume);
  }
  private applyPlaybackRate(value: number): void {
    const rate = normalizePlaybackRate(value);
    const changed = this.media.playbackRate !== rate;
    this.media.preservesPitch = true;
    if (this.media.defaultPlaybackRate !== rate) this.media.defaultPlaybackRate = rate;
    if (changed) { this.media.playbackRate = rate; this.sendTime(); this.syncDesktop(true); }
  }
  private cancelFade(): void {
    if (this.fadeTimer) { clearInterval(this.fadeTimer); this.fadeTimer = null; }
    this.applyVolume(useAppStore.getState().settings.volume);
  }
  private fadePause(): void {
    const start = performance.now();
    const volume = useAppStore.getState().settings.volume;
    this.fadeTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - start) / 500);
      this.applyVolume(volume * (1 - progress));
      if (progress === 1) { this.media.pause(); this.cancelFade(); }
    }, 16);
  }

  private duration(): number { const state = useAppStore.getState(); return preferredDuration(state.player.song, this.media.duration, !!state.player.preview); }
  private updateDuration(): void { useAppStore.getState().setPlayer({ duration: this.duration() }); }
  private incrementPlay(path: string): void {
    const now = new Date();
    applyUserDataChange(state => ({ stats: { ...state.stats, [path]: recordPlay(state.stats[path], now) } })); scheduleSave();
  }
  private flushDuration(): void {
    const now = performance.now();
    const previous = this.lastWall;
    this.lastWall = !this.media.paused && !this.media.seeking && this.media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ? now : 0;
    const state = useAppStore.getState();
    const path = state.player.song?.audioPath;
    const delta = (now - previous) / 1000;
    if (!path || state.player.preview || !previous || delta <= 0 || delta > 5) return;
    const end = new Date();
    applyUserDataChange(current => ({ stats: { ...current.stats, [path]: recordListening(current.stats[path], delta, end) } }));
    scheduleSave();
  }
  private saveProgress(): void {
    const state = useAppStore.getState();
    const path = state.player.song?.audioPath;
    const duration = this.duration();
    if (!path || state.player.preview || !duration) return;
    const position = Math.max(0, this.media.currentTime || this.requestedTime);
    const time = duration - position < 3 ? 0 : position;
    applyUserDataChange(current => ({ progress: { ...current.progress, [path]: time }, lastSession: { audioPath: path, t: time } })); scheduleSave();
  }

  private handleFailure(message: string): void {
    if (this.lastFailedVersion === this.version || !this.sourcePath) return;
    this.lastFailedVersion = this.version;
    const state = useAppStore.getState();
    state.setPlayer({ playing: false, loading: false, error: message }); this.stopLyricTimer(); this.flushDuration();
    this.failCount++;
    if (state.player.preview) {
      notify(`试听播放失败：${message}`, 'error');
      return;
    }
    const song = state.player.song;
    if (!song) return;
    try { void Promise.resolve(getBridge('repairAPI').reportPlayFailed({ audioPath: song.audioPath, songName: song.songName, artist: song.artist })).catch(() => {}); } catch { /* Playback works without an optional repair bridge. */ }
    notify(`「${song.songName}」播放失败，已记入修复中心`, 'error');
    const count = this.playlist().length;
    if (this.failCount >= Math.min(5, count) || count < 2) {
      notify('连续播放失败，已停止自动跳转', 'error'); return;
    }
    this.next();
  }

  private onTick = (): void => {
    const state = useAppStore.getState();
    const time = this.media.currentTime || 0;
    const duration = this.duration();
    this.flushDuration();
    state.setPlayer({ time, duration }); this.syncDesktop();
    if (!this.media.paused && time > 0.25) this.failCount = 0;
    if (!this.media.seeking && !this.media.paused && !state.player.preview && duration && performance.now() - this.seekWall > 1000 && time > duration + 0.5) {
      this.media.pause(); this.onEnded(); return;
    }
    this.lastPosition = time;
    if (performance.now() - this.lastSaveWall > 2000) { this.lastSaveWall = performance.now(); this.saveProgress(); }
  };
  private onPlay = (): void => {
    const { song, preview } = useAppStore.getState().player;
    if (preview) {
      if (this.rememberPreview(preview) && preview.queue) {
        const keys = preview.queue.map(item => this.previewKey(item));
        this.previewShuffle.visit(keys, this.previewKey(preview));
      }
    } else if (song && this.rememberSong(song.audioPath)) {
      this.songShuffle.visit(this.playlist().map(item => item.audioPath), song.audioPath);
    }
    useAppStore.getState().setPlayer({ playing: true, loading: false, error: '' });
    this.lastWall = performance.now(); this.startLyricTimer(); this.syncDesktop(true);
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  };
  private onPause = (): void => {
    this.flushDuration(); this.lastWall = 0; this.saveProgress();
    useAppStore.getState().setPlayer({ playing: false, loading: false });
    this.stopLyricTimer(); this.sendTime(); this.syncDesktop(true);
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  };
  private onMetadata = (): void => {
    this.updateDuration();
    if (this.requestedTime) {
      const target = safeSeekTime(this.requestedTime, this.duration(), this.media.duration);
      if (target > 0) this.media.currentTime = target;
      this.requestedTime = 0;
    }
    this.applyPlaybackRate(useAppStore.getState().settings.playbackRate);
    this.onTick();
  };
  private onEnded = (): void => {
    this.flushDuration(); this.lastWall = 0;
    const state = useAppStore.getState();
    if (state.player.song && !state.player.preview) {
      const path = state.player.song.audioPath;
      applyUserDataChange(current => ({ progress: { ...current.progress, [path]: 0 }, lastSession: { audioPath: path, t: 0 } })); scheduleSave();
    }
    if (state.settings.playMode === 0) {
      if (state.player.song) this.incrementPlay(state.player.song.audioPath);
      this.media.currentTime = 0; this.requestedTime = 0; void this.playMedia();
    } else this.next();
  };
  private onError = (): void => {
    const error = this.media.error;
    if (!error || error.code === 1) return;
    const names: Record<number, string> = { 2: '网络或文件读取失败', 3: '媒体解码失败', 4: '不支持的媒体格式或地址' };
    this.handleFailure(`${names[error.code] || '播放失败'}${error.message ? `：${error.message}` : ''}`);
  };
  private onWaiting = (): void => { this.flushDuration(); this.lastWall = 0; useAppStore.getState().setPlayer({ loading: true }); };
  private onSeeking = (): void => { this.flushDuration(); this.lastWall = 0; };
  private onSeeked = (): void => { this.lastWall = this.media.paused ? 0 : performance.now(); this.lastPosition = this.media.currentTime; this.onTick(); this.sendTime(); };
  private onRateChange = (): void => { this.sendTime(); this.syncDesktop(true); };
  private handlers: [string, EventListener][] = [
    ['loadedmetadata', this.onMetadata], ['durationchange', () => this.updateDuration()], ['timeupdate', this.onTick], ['playing', this.onPlay],
    ['pause', this.onPause], ['ended', this.onEnded], ['error', this.onError], ['waiting', this.onWaiting], ['seeking', this.onSeeking], ['seeked', this.onSeeked],
    ['ratechange', this.onRateChange],
  ];

  private setLyrics(text: string, video: boolean): void { this.lyrics = parseLyrics(text, video); this.sendLyricData(); }
  private send(payload: Record<string, unknown>): void {
    if (!useAppStore.getState().player.desktopLyricOn) return;
    try { getBridge('desktopLyric').send(payload); } catch (error) { console.warn('桌面歌词同步失败', error); }
  }
  private sendTime(): void { this.send({ type: 'time', t: this.media.currentTime || 0, playing: !this.media.paused, playbackRate: this.media.playbackRate }); }
  private sendLyricData(): void { this.send(this.lyricSnapshot()); }
  private lyricSettings() {
    const settings = useAppStore.getState().settings;
    return { marqueeEnabled: settings.marqueeEnabled, marqueeThreshold: settings.marqueeThreshold,
      marqueeSpeed: settings.marqueeSpeed, marqueePause: settings.marqueePause, lyricDone: settings.lyricDone, lyricWait: settings.lyricWait,
      lyricSize: settings.lyricSize, currentLyricSize: settings.currentLyricSize,
      progressColorEnabled: settings.progressColorEnabled, progressColor: settings.progressColor, progressColor2: settings.progressColor2 };
  }
  private lyricColorReady(): boolean {
    const settings = useAppStore.getState().settings;
    return this.coverColorReady || (settings.progressColorEnabled && typeof settings.progressColor === 'string' && /^#[\da-f]{6}$/i.test(settings.progressColor));
  }
  private lyricSnapshot() {
    const { player, settings } = useAppStore.getState();
    const { song, preview } = player;
    return { type: 'snapshot', songKey: preview?.url || song?.audioPath || '', lrc: this.lyrics,
      simulate: !this.lyrics.raw && settings.simulateLrcProgress,
      info: { title: preview?.name || song?.songName || '', artist: preview?.artist || song?.artist || '' },
      settings: this.lyricSettings(), color: this.coverColor,
      colorReady: this.lyricColorReady(),
      locked: settings.desktopLyricLocked, t: this.media.readyState >= 1 ? this.media.currentTime || 0 : player.time,
      playing: !this.media.paused, playbackRate: this.media.playbackRate };
  }
  private sendInfo(): void {
    const { song, preview } = useAppStore.getState().player;
    this.send({ type: 'info', info: { title: preview?.name || song?.songName || '', artist: preview?.artist || song?.artist || '' } });
  }
  private sendSettings(): void {
    this.send({ type: 'settings', settings: this.lyricSettings(), colorReady: this.lyricColorReady() });
  }
  private startLyricTimer(): void {
    if (!useAppStore.getState().player.desktopLyricOn || this.lyricTimer) return;
    this.sendTime(); this.lyricTimer = setInterval(() => this.sendTime(), 200);
  }
  private stopLyricTimer(): void { if (this.lyricTimer) { clearInterval(this.lyricTimer); this.lyricTimer = null; } }
  async toggleDesktopLyric(): Promise<void> {
    const state = useAppStore.getState();
    const show = !state.player.desktopLyricOn;
    const request = ++this.lyricWindowRequest;
    state.setPlayer({ desktopLyricOn: show });
    if (!show) this.stopLyricTimer();
    let shown: unknown;
    try { shown = await getBridge('desktopLyric').toggle(show, show ? this.lyricSnapshot() : undefined); }
    catch (error) {
      if (request === this.lyricWindowRequest) state.setPlayer({ desktopLyricOn: !show });
      throw error;
    }
    if (request !== this.lyricWindowRequest) return;
    if (show && shown === false) {
      state.setPlayer({ desktopLyricOn: false }); this.stopLyricTimer(); return;
    }
    if (show) {
      if (state.settings.desktopLyricBounds) await getBridge('desktopLyric').setPosition(state.settings.desktopLyricBounds);
      if (request !== this.lyricWindowRequest) return;
      await getBridge('desktopLyric').lock(state.settings.desktopLyricLocked);
      if (request !== this.lyricWindowRequest) return;
      this.send(this.lyricSnapshot());
      this.send({ type: 'color', color: this.coverColor, colorReady: this.lyricColorReady() });
      if (!this.media.paused) this.startLyricTimer();
    } else this.stopLyricTimer();
  }
  async toggleLyricLock(): Promise<void> {
    const locked = !useAppStore.getState().settings.desktopLyricLocked;
    await getBridge('desktopLyric').lock(locked);
    useAppStore.getState().setSettings({ desktopLyricLocked: locked }); this.send({ type: 'lock', locked });
  }

  private async updateCoverColor(url: string, path: string | undefined, version: number): Promise<void> {
    const request = ++this.coverRequest;
    this.coverColorReady = !url;
    // Keep the previous hue during extraction so a change of song never flashes pink.
    if (!url) { this.coverColor = null; this.applyCoverTheme(); this.send({ type: 'color', color: null, colorReady: true }); return; }
    this.send({ type: 'color', color: this.coverColor, colorReady: this.lyricColorReady() });
    try {
      const api = getBridge('musicAPI');
      const source = path || url;
      let localPath = source;
      if (/^(file:|music:)/i.test(source)) {
        const parsed = new URL(source);
        localPath = decodeURIComponent(parsed.pathname).replace(/^\/(?=[a-z]:)/i, '');
        if (parsed.hostname) localPath = `//${parsed.hostname}${localPath}`;
      }
      const result = /^(https?:|data:)/i.test(source) ? await api.extractCoverColorFromURL(source) : await api.extractCoverColor(localPath);
      if (version !== this.version || request !== this.coverRequest) return;
      const color = normalizeCoverColor(result);
      this.coverColor = color; this.coverColorReady = true; this.applyCoverTheme(); this.send({ type: 'color', color, colorReady: true });
    } catch (error) {
      if (version !== this.version || request !== this.coverRequest) return;
      this.coverColor = null; this.coverColorReady = true; this.applyCoverTheme(); this.send({ type: 'color', color: null, colorReady: true });
      console.warn('封面主题色读取失败', error);
    }
  }
  private applyCoverTheme(): void {
    const settings = useAppStore.getState().settings;
    const palette = createCoverPalette(this.coverColor);
    const shell = createShellPalette(this.coverColor, settings.themeFollowCover, settings.colorIntensity);
    const root = document.documentElement;
    root.style.setProperty('--cover-color', palette.color);
    root.style.setProperty('--cover-color-rgb', palette.rgb);
    root.style.setProperty('--cover-accent', palette.accent);
    root.style.setProperty('--cover-accent-secondary', palette.secondary);
    root.style.setProperty('--cover-accent-ink', palette.ink);
    root.style.setProperty('--cover-glow', palette.glow);
    root.style.setProperty('--cover-intensity', String(settings.colorIntensity));
    root.style.setProperty('--cover-atmosphere', createShellPalette(this.coverColor, true, settings.colorIntensity).atmosphere);
    root.style.setProperty('--shell-surface', shell.surface);
    root.style.setProperty('--shell-chrome', shell.chrome);
    root.style.setProperty('--shell-atmosphere', shell.atmosphere);
    root.style.setProperty('--shell-muted', shell.muted);
  }
  private syncDesktop(force = false): void {
    const now = performance.now(); if (!force && now - this.lastSyncWall < 3000) return; this.lastSyncWall = now;
    const state = useAppStore.getState(); const { song, preview } = state.player;
    try { void Promise.resolve(getBridge('stateAPI').updateDesktopState({ index: state.player.index, playMode: state.settings.playMode, isPlaying: !this.media.paused,
      currentTime: this.requestedTime || this.media.currentTime || 0, duration: this.duration(), playbackRate: this.media.playbackRate, togetherSeq: this.togetherAcknowledged, togetherSession: this.togetherSession,
      songInfo: song ? { songName: song.songName, artist: song.artist, album: song.album || '', lyricist: song.lyricist || '', composer: song.composer || '', hasCover: !!song.coverPath, coverPath: song.coverPath || '', audioPath: song.audioPath } : preview ? { songName: preview.name, artist: preview.artist, album: '', hasCover: !!preview.cover, coverPath: preview.cover || '', audioPath: preview.url, preview: true, lyric: state.player.lyricText || '' } : null,
    })).catch(() => {}); } catch { /* Synchronization is optional in browser previews. */ }
    if (navigator.mediaSession && this.duration()) {
      try { navigator.mediaSession.setPositionState({ duration: this.duration(), playbackRate: this.media.playbackRate, position: Math.min(this.duration(), this.media.currentTime || 0) }); } catch { /* Some runtimes lack position support. */ }
    }
  }
  private updateMediaMetadata(): void {
    if (!navigator.mediaSession || !window.MediaMetadata) return;
    const { song, preview } = useAppStore.getState().player;
    const artwork = preview?.cover || mediaUrl(song?.coverPath || '');
    navigator.mediaSession.metadata = new MediaMetadata({ title: preview?.name || song?.songName, artist: preview?.artist || song?.artist,
      album: song?.album, artwork: artwork ? [{ src: artwork }] : [] });
  }
  private installMediaSession(): void {
    if (!navigator.mediaSession) return;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { this.initAudio(); this.cancelFade(); void this.playMedia(); }], ['pause', () => this.media.pause()],
      ['previoustrack', () => this.next(-1)], ['nexttrack', () => this.next(1)], ['seekto', details => this.seek(details.seekTime || 0)],
      ['seekbackward', details => this.seek(this.media.currentTime - (details.seekOffset || 10))], ['seekforward', details => this.seek(this.media.currentTime + (details.seekOffset || 10))],
    ];
    for (const [action, handler] of actions) { try { navigator.mediaSession.setActionHandler(action, handler); this.unsubscribes.push(() => navigator.mediaSession.setActionHandler(action, null)); } catch { /* Platform may not support an action. */ } }
  }
}

export const playerService = new PlayerService();
