import type { Collection, PlayerState, Song, SongStats, View } from '../types';
import { localDateKey } from './listeningHistory';

export interface StatsSourceState {
  view: View;
  songs: Song[];
  stats: Record<string, SongStats>;
  collections: Collection[];
  genreOverrides: Record<string, string[]>;
  player: Pick<PlayerState, 'song' | 'playing'>;
}

interface StatsSource {
  getState: () => StatsSourceState;
  subscribe: (listener: (state: StatsSourceState, previous: StatsSourceState) => void) => () => void;
}

export interface StatsSnapshot {
  songs: Song[];
  stats: Record<string, SongStats>;
  collections: Collection[];
  genreOverrides: Record<string, string[]>;
  currentPath: string | undefined;
  playing: boolean;
  day: string;
}

export function statsSnapshot(state: StatsSourceState): StatsSnapshot {
  return {
    songs: state.songs, stats: state.stats, collections: state.collections, genreOverrides: state.genreOverrides,
    currentPath: state.player.song?.audioPath, playing: state.player.playing, day: localDateKey(new Date()),
  };
}

export function sameStatsSnapshot(left: StatsSnapshot, right: StatsSnapshot): boolean {
  return left.songs === right.songs && left.stats === right.stats && left.collections === right.collections &&
    left.genreOverrides === right.genreOverrides && left.currentPath === right.currentPath && left.playing === right.playing && left.day === right.day;
}

/** Subscribe only while visible; coalesce listening ticks, but apply user edits immediately. */
export function subscribeStatsSnapshots(source: StatsSource, receive: (snapshot: StatsSnapshot) => void, interval = 1000): () => void {
  if (source.getState().view !== 'stats') return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};
  let stopped = false;
  let publishedAt = Date.now();

  const stop = () => {
    stopped = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    unsubscribe();
  };
  const publish = () => {
    if (stopped) return;
    const state = source.getState();
    if (state.view !== 'stats') { stop(); return; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    publishedAt = Date.now();
    receive(statsSnapshot(state));
  };
  unsubscribe = source.subscribe((state, previous) => {
    if (state.view !== 'stats') { stop(); return; }
    const immediate = state.songs !== previous.songs || state.collections !== previous.collections ||
      state.genreOverrides !== previous.genreOverrides || state.player.song?.audioPath !== previous.player.song?.audioPath ||
      state.player.playing !== previous.player.playing;
    if (immediate) { publish(); return; }
    if (state.stats === previous.stats) return;
    const remaining = interval - (Date.now() - publishedAt);
    if (remaining <= 0) publish();
    else if (timer === null) timer = setTimeout(publish, remaining);
  });
  publish();
  return stop;
}
