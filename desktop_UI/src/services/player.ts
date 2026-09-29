import { errorMessage, getBridge, mediaUrl, subscribe } from '../api';
import { persistNow, scheduleSave, useAppStore } from '../store';
import { notify } from '../ui';
import type { PreviewSong, Song } from '../types';
import { AudioEffects, normalizeFxSettings } from './audioFx';
import { parseLyrics, type LyricsData } from './lyrics';
import { isVideo, positive, preferredDuration, safeSeekTime, shuffled } from './playbackUtils';
export { isVideo, preferredDuration, safeSeekTime, shuffled } from './playbackUtils';

class PlayerService {
  readonly media = document.createElement('video');
  private initialized = false;
  private unsubscribes: (() => void)[] = [];
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private effects: AudioEffects | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private lyricTimer: ReturnType<typeof setInterval> | null = null;
  private queuePaths: string[] | null = null;
  private collectionId: string | null = null;
  private likedContext = false;
  private shufflePaths: string[] = [];
  private shufflePos = -1;
  private version = 0;
  private sourcePath = '';
  private requestedTime = 0;
  private lastWall = 0;
  private lastSaveWall = 0;
  private lastSyncWall = 0;
  private lastPosition = 0;
  private seekWall = 0;
  private failCount = 0;
  private lastFailedVersion = -1;
  private previewQueue: PreviewSong[] | null = null;
  private previewPosition = -1;
  private previewPositions = new WeakMap<PreviewSong, number>();
  private coverColor: { r: number; g: number; b: number } | null = null;
  private lyrics: LyricsData = { raw: false, lines: [] };

  constructor() {
    this.media.id = 'react-media-player';
    this.media.playsInline = true;
    this.media.preload = 'auto';
    this.media.volume = 1;
    this.media.crossOrigin = 'anonymous';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await useAppStore.getState().initialize();
    if (!this.initialized) return;
    for (const [event, handler] of this.handlers) {
      this.media.addEventListener(event, handler);
      this.unsubscribes.push(() => this.media.removeEventListener(event, handler));
    }
    this.bind('musicAPI', 'onDurationUpdate', (payload: { audioPath?: string; realDuration?: number; idx?: number; duration?: number }) => {
      const audioPath = payload?.audioPath || (typeof payload?.idx === 'number' ? useAppStore.getState().songs[payload.idx]?.audioPath : undefined);
      const realDuration = positive(payload?.realDuration) || positive(payload?.duration);
      if (!audioPath || !realDuration) return;
      useAppStore.setState(state => ({
        actualDuration: { ...state.actualDuration, [audioPath]: realDuration },
        songs: state.songs.map(song => song.audioPath === audioPath ? { ...song, realDuration } : song),
        player: { ...state.player, song: state.player.song && state.player.song.audioPath === audioPath ? { ...state.player.song, realDuration } : state.player.song },
      }));
      this.updateDuration(); scheduleSave();
    });
    this.bind('desktopLyric', 'onClosed', () => {
      useAppStore.getState().setPlayer({ desktopLyricOn: false });
      this.stopLyricTimer();
    });
    this.bind('desktopLyric', 'onBoundsSaved', (bounds: number[]) => {
      if (Array.isArray(bounds)) useAppStore.getState().setSettings({ desktopLyricBounds: bounds });
    });
    this.bind('desktopLyric', 'onLockChanged', (locked: boolean) => useAppStore.getState().setSettings({ desktopLyricLocked: !!locked }));
    this.unsubscribes.push(useAppStore.subscribe((state, previous) => {
      if (state.settings.volume !== previous.settings.volume) { this.cancelFade(); this.applyVolume(state.settings.volume); }
      if (state.settings.audioFx !== previous.settings.audioFx) this.effects?.apply(normalizeFxSettings(state.settings.audioFx));
      if (state.settings !== previous.settings) {
        this.sendSettings();
        if (state.settings.simulateLrcProgress !== previous.settings.simulateLrcProgress) this.sendLyricData();
        if (state.settings.playMode !== previous.settings.playMode) { this.resetShuffle(); this.syncDesktop(true); }
        if (state.settings.themeFollowCover !== previous.settings.themeFollowCover || state.settings.colorIntensity !== previous.settings.colorIntensity) this.applyCoverTheme();
      }
    }));
    const beforeUnload = () => { this.flushDuration(); this.saveProgress(); persistNow(true); };
    window.addEventListener('beforeunload', beforeUnload);
    this.unsubscribes.push(() => window.removeEventListener('beforeunload', beforeUnload));
    this.applyVolume(useAppStore.getState().settings.volume);
    this.installMediaSession();
    if (useAppStore.getState().settings.desktopLyricPersist && !useAppStore.getState().player.desktopLyricOn) {
      await this.toggleDesktopLyric().catch(error => console.error('桌面歌词自动开启失败', error));
    }
    const state = useAppStore.getState();
    const previous = state.songs.find(song => song.audioPath === state.lastSession?.audioPath);
    if (previous) {
      this.likedContext = state.collections.some(collection => collection.songs.includes(previous.audioPath));
      await this.openSong(previous, true);
    } else if (state.songs.length) {
      const initial = this.playlist()[0];
      if (initial) await this.openSong(initial, true);
    }
  }

  private bind(name: Parameters<typeof subscribe>[0], method: string, listener: (...args: any[]) => void): void {
    try { if (getBridge(name)[method]) this.unsubscribes.push(subscribe(name, method, listener)); }
    catch (error) { console.warn(`未能绑定 ${name}.${method}`, error); }
  }

  dispose(): void {
    this.version++;
    this.cancelFade(); this.flushDuration(); this.saveProgress(); this.media.pause();
    this.stopLyricTimer(); this.unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    this.initialized = false;
    // Retain the MediaElementSource: a media element can only be connected once.
    void this.context?.suspend().catch(() => {});
  }

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
    this.failCount = 0;
    const state = useAppStore.getState();
    this.queuePaths = queue ? [...new Set(queue.map(item => item.audioPath))] : null;
    this.collectionId = state.view === 'liked' ? state.activeCollectionId : null;
    this.likedContext = state.view === 'liked';
    this.resetShuffle(song.audioPath);
    await this.openSong(song, restore);
  }

  private async openSong(candidate: Song, restore: boolean): Promise<void> {
    this.initAudio(); this.cancelFade(); this.flushDuration(); this.saveProgress();
    const version = ++this.version;
    const state = useAppStore.getState();
    const song = state.songs.find(item => item.audioPath === candidate.audioPath) || candidate;
    const changed = this.sourcePath !== song.audioPath || !!state.player.preview;
    this.media.pause(); this.lastWall = 0; this.lastSaveWall = 0; this.lastPosition = 0;
    this.requestedTime = restore ? positive(state.progress[song.audioPath]) || (state.lastSession?.audioPath === song.audioPath ? positive(state.lastSession.t) : 0) : 0;
    state.setPlayer({ song, preview: null, index: state.songs.findIndex(item => item.audioPath === song.audioPath), playing: false,
      time: changed ? this.requestedTime : this.media.currentTime, duration: preferredDuration(song, changed ? 0 : this.media.duration), loading: true, lyricText: '', error: '' });
    this.sourcePath = song.audioPath;
    if (changed) {
      this.media.src = mediaUrl(song.audioPath);
      this.media.load();
      this.incrementPlay(song.audioPath);
    } else if (!restore) this.seek(0);
    this.setLyrics('', isVideo(song));
    this.sendInfo(); this.syncDesktop(true); this.updateMediaMetadata();
    void this.updateCoverColor(song.coverPath ? mediaUrl(song.coverPath) : '', song.coverPath || undefined, version);
    const lyricsTask = this.loadSongLyrics(song).then(text => {
      if (version !== this.version) return;
      state.setPlayer({ lyricText: text }); this.setLyrics(text, isVideo(song));
    });
    await this.playMedia(version);
    await lyricsTask;
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
    if (!preview.url && preview.resolve) {
      const pendingVersion = ++this.version;
      useAppStore.getState().setPlayer({ loading: true, error: '' });
      try {
        const resolved = await preview.resolve();
        if (pendingVersion !== this.version) return;
        const ready = { ...resolved, queue: preview.queue || resolved.queue };
        if (ready.queue) this.previewPositions.set(ready, this.previewIndex(preview, ready.queue));
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
    this.previewPosition = preview.queue ? this.previewPositions.get(preview) ?? this.previewIndex(preview, preview.queue) : -1;
    useAppStore.getState().setPlayer({ song: null, index: -1, preview, playing: false, time: 0, duration: 0, loading: true, error: '', lyricText: preview.lyric || '' });
    this.media.src = mediaUrl(preview.url); this.media.load();
    this.setLyrics(preview.lyric || '', isVideo(null, preview));
    if (!preview.lyric && preview.source === 'playlist' && preview.original?.lyricUrl) {
      void fetch(preview.original.lyricUrl).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).then(text => {
        if (version !== this.version) return;
        useAppStore.getState().setPlayer({ lyricText: text }); this.setLyrics(text, isVideo(null, preview));
      }).catch(error => console.warn('远程歌单歌词读取失败', error));
    }
    this.sendInfo(); this.syncDesktop(true); this.updateMediaMetadata();
    void this.updateCoverColor(preview.cover || '', undefined, version);
    await this.playMedia(version);
  }

  private async playMedia(version = this.version): Promise<void> {
    if (version !== this.version) return;
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
    this.version++; this.cancelFade(); this.flushDuration(); this.saveProgress();
    this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.sourcePath = '';
    this.lyrics = { raw: false, lines: [] };
    useAppStore.getState().setPlayer({ song: null, preview: null, index: -1, time: 0, duration: 0, playing: false, loading: false, lyricText: '', error: '' });
    this.send({ type: 'clear' }); this.syncDesktop(true);
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
    this.shufflePaths = [...new Set(this.shufflePaths.map(path => path === oldPath ? newPath : path))];
  }

  private resetShuffle(currentPath = useAppStore.getState().player.song?.audioPath): void {
    this.shufflePaths = shuffled(this.playlist().map(song => song.audioPath));
    if (currentPath) {
      const position = this.shufflePaths.indexOf(currentPath);
      if (position >= 0) [this.shufflePaths[0], this.shufflePaths[position]] = [this.shufflePaths[position], this.shufflePaths[0]];
    }
    this.shufflePos = currentPath && this.shufflePaths[0] === currentPath ? 0 : -1;
  }

  next(direction = 1): void {
    const state = useAppStore.getState();
    if (state.player.preview) { void this.nextPreview(direction); return; }
    const playlist = this.playlist();
    if (!playlist.length) { this.media.pause(); notify('播放队列中没有可推荐的歌曲'); return; }
    let target: Song | undefined;
    const currentPath = state.player.song?.audioPath;
    if (state.settings.playMode === 2) {
      const valid = new Set(playlist.map(song => song.audioPath));
      if (this.shufflePaths.length !== valid.size || this.shufflePaths.some(path => !valid.has(path))) this.resetShuffle(currentPath);
      if (direction > 0) {
        this.shufflePos++;
        if (this.shufflePos >= this.shufflePaths.length) {
          this.shufflePaths = shuffled([...valid]); this.shufflePos = 0;
          if (this.shufflePaths.length > 1 && this.shufflePaths[0] === currentPath) [this.shufflePaths[0], this.shufflePaths[1]] = [this.shufflePaths[1], this.shufflePaths[0]];
        }
      } else this.shufflePos = Math.max(0, this.shufflePos - 1);
      target = playlist.find(song => song.audioPath === this.shufflePaths[this.shufflePos]);
    } else {
      const position = playlist.findIndex(song => song.audioPath === currentPath);
      target = playlist[position < 0 ? 0 : (position + (direction < 0 ? -1 : 1) + playlist.length) % playlist.length];
    }
    if (target) void this.openSong(target, true);
  }

  private async nextPreview(direction: number): Promise<void> {
    const preview = useAppStore.getState().player.preview;
    const queue = preview?.queue;
    if (!preview || !queue?.length) { this.media.pause(); return; }
    const position = this.previewQueue === queue && this.previewPosition >= 0 ? this.previewPosition : this.previewIndex(preview, queue);
    const nextPosition = useAppStore.getState().settings.playMode === 2 && queue.length > 1 ? (position + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : (position + (direction < 0 ? -1 : 1) + queue.length) % queue.length;
    const pendingVersion = ++this.version;
    try {
      let target = queue[nextPosition];
      useAppStore.getState().setPlayer({ loading: true, error: '' });
      if (!target.url && target.resolve) target = await target.resolve();
      if (pendingVersion !== this.version) return;
      const ready = { ...target, queue };
      this.previewPositions.set(ready, nextPosition);
      await this.playPreview(ready);
    } catch (error) {
      if (pendingVersion !== this.version) return;
      useAppStore.getState().setPlayer({ loading: false });
      notify(`试听加载失败：${errorMessage(error)}`, 'error');
    }
  }

  private previewIndex(preview: PreviewSong, queue: PreviewSong[]): number {
    const source = (item: PreviewSong) => item.original?.source || item.source || '';
    const id = (item: PreviewSong) => String(item.original?.id ?? item.original?.hash ?? item.original?.trackId ?? '');
    let index = queue.findIndex(item => item === preview);
    if (index < 0 && id(preview)) index = queue.findIndex(item => id(item) === id(preview) && source(item) === source(preview));
    if (index < 0 && preview.url) index = queue.findIndex(item => !!item.url && item.url === preview.url);
    if (index < 0) index = queue.findIndex(item => item.name === preview.name && item.artist === preview.artist && source(item) === source(preview));
    if (index < 0) index = queue.findIndex(item => item.name === preview.name && item.artist === preview.artist);
    return index;
  }

  seek(time: number): void {
    const duration = this.duration();
    if (!duration) return;
    this.cancelFade(); this.flushDuration();
    this.seekWall = performance.now();
    const target = safeSeekTime(time, duration, this.media.duration);
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
    useAppStore.setState(state => ({ stats: { ...state.stats, [path]: { plays: (state.stats[path]?.plays || 0) + 1, duration: state.stats[path]?.duration || 0 } } })); scheduleSave();
  }
  private flushDuration(): void {
    const now = performance.now();
    const previous = this.lastWall;
    this.lastWall = !this.media.paused && !this.media.seeking && this.media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ? now : 0;
    const state = useAppStore.getState();
    const path = state.player.song?.audioPath;
    const delta = (now - previous) / 1000;
    if (!path || state.player.preview || !previous || delta <= 0 || delta > 5) return;
    useAppStore.setState(current => ({ stats: { ...current.stats, [path]: { plays: current.stats[path]?.plays || 0, duration: (current.stats[path]?.duration || 0) + delta } } }));
    scheduleSave();
  }
  private saveProgress(): void {
    const state = useAppStore.getState();
    const path = state.player.song?.audioPath;
    const duration = this.duration();
    if (!path || state.player.preview || !duration) return;
    const position = Math.max(0, this.media.currentTime || this.requestedTime);
    const time = duration - position < 3 ? 0 : position;
    useAppStore.setState(current => ({ progress: { ...current.progress, [path]: time }, lastSession: { audioPath: path, t: time } })); scheduleSave();
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
    this.onTick();
  };
  private onEnded = (): void => {
    this.flushDuration(); this.lastWall = 0;
    const state = useAppStore.getState();
    if (state.player.song && !state.player.preview) {
      const path = state.player.song.audioPath;
      useAppStore.setState(current => ({ progress: { ...current.progress, [path]: 0 }, lastSession: { audioPath: path, t: 0 } })); scheduleSave();
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
  private handlers: [string, EventListener][] = [
    ['loadedmetadata', this.onMetadata], ['durationchange', () => this.updateDuration()], ['timeupdate', this.onTick], ['playing', this.onPlay],
    ['pause', this.onPause], ['ended', this.onEnded], ['error', this.onError], ['waiting', this.onWaiting], ['seeking', this.onSeeking], ['seeked', this.onSeeked],
  ];

  private setLyrics(text: string, video: boolean): void { this.lyrics = parseLyrics(text, video); this.sendLyricData(); }
  private send(payload: Record<string, unknown>): void {
    if (!useAppStore.getState().player.desktopLyricOn) return;
    try { getBridge('desktopLyric').send(payload); } catch (error) { console.warn('桌面歌词同步失败', error); }
  }
  private sendTime(): void { this.send({ type: 'time', t: this.media.currentTime || 0, playing: !this.media.paused }); }
  private sendLyricData(): void { this.send({ type: 'data', lrc: this.lyrics, simulate: !this.lyrics.raw && useAppStore.getState().settings.simulateLrcProgress }); this.sendSettings(); this.sendTime(); }
  private sendInfo(): void {
    const { song, preview } = useAppStore.getState().player;
    this.send({ type: 'info', info: { title: preview?.name || song?.songName || '', artist: preview?.artist || song?.artist || '' } });
  }
  private sendSettings(): void {
    const settings = useAppStore.getState().settings;
    this.send({ type: 'settings', settings: { marqueeEnabled: settings.marqueeEnabled, marqueeThreshold: settings.marqueeThreshold,
      marqueeSpeed: settings.marqueeSpeed, marqueePause: settings.marqueePause, lyricDone: settings.lyricDone, lyricWait: settings.lyricWait, lyricSize: settings.lyricSize,
      progressColorEnabled: settings.progressColorEnabled, progressColor: settings.progressColor, progressColor2: settings.progressColor2 } });
  }
  private startLyricTimer(): void {
    if (!useAppStore.getState().player.desktopLyricOn || this.lyricTimer) return;
    this.sendTime(); this.lyricTimer = setInterval(() => this.sendTime(), 200);
  }
  private stopLyricTimer(): void { if (this.lyricTimer) { clearInterval(this.lyricTimer); this.lyricTimer = null; } }
  async toggleDesktopLyric(): Promise<void> {
    const state = useAppStore.getState();
    const show = !state.player.desktopLyricOn;
    await getBridge('desktopLyric').toggle(show);
    state.setPlayer({ desktopLyricOn: show });
    if (show) {
      if (state.settings.desktopLyricBounds) await getBridge('desktopLyric').setPosition(state.settings.desktopLyricBounds);
      await getBridge('desktopLyric').lock(state.settings.desktopLyricLocked);
      this.send({ type: 'lock', locked: state.settings.desktopLyricLocked }); this.sendInfo(); this.sendLyricData(); this.send({ type: 'color', color: this.coverColor });
      if (!this.media.paused) this.startLyricTimer();
    } else this.stopLyricTimer();
  }
  async toggleLyricLock(): Promise<void> {
    const locked = !useAppStore.getState().settings.desktopLyricLocked;
    await getBridge('desktopLyric').lock(locked);
    useAppStore.getState().setSettings({ desktopLyricLocked: locked }); this.send({ type: 'lock', locked });
  }

  private async updateCoverColor(url: string, path: string | undefined, version: number): Promise<void> {
    this.coverColor = null; this.applyCoverTheme(); this.send({ type: 'color', color: null });
    if (!url) return;
    try {
      const api = getBridge('musicAPI');
      const color = path ? await api.extractCoverColor(path) : await api.extractCoverColorFromURL(url);
      if (version !== this.version) return;
      this.coverColor = color; this.applyCoverTheme(); this.send({ type: 'color', color });
    } catch (error) { console.warn('封面主题色读取失败', error); }
  }
  private applyCoverTheme(): void {
    const settings = useAppStore.getState().settings;
    const color = this.coverColor;
    const root = document.documentElement;
    if (!settings.themeFollowCover || !color) { root.style.removeProperty('--cover-color'); root.style.removeProperty('--cover-color-rgb'); return; }
    root.style.setProperty('--cover-color', `rgb(${color.r}, ${color.g}, ${color.b})`);
    root.style.setProperty('--cover-color-rgb', `${color.r}, ${color.g}, ${color.b}`);
    root.style.setProperty('--cover-intensity', String(settings.colorIntensity));
  }
  private syncDesktop(force = false): void {
    const now = performance.now(); if (!force && now - this.lastSyncWall < 3000) return; this.lastSyncWall = now;
    const state = useAppStore.getState(); const { song, preview } = state.player;
    try { void Promise.resolve(getBridge('stateAPI').updateDesktopState({ index: state.player.index, playMode: state.settings.playMode, isPlaying: !this.media.paused,
      currentTime: this.media.currentTime || 0, duration: this.duration(), songInfo: song ? { songName: song.songName, artist: song.artist, album: song.album || '', hasCover: !!song.coverPath, coverPath: song.coverPath || '', audioPath: song.audioPath } : preview ? { songName: preview.name, artist: preview.artist, album: '', hasCover: !!preview.cover, coverPath: preview.cover || '', audioPath: preview.url } : null,
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
