import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeStatsSnapshots, type StatsSnapshot, type StatsSourceState } from './statsSnapshot';

function source(view: StatsSourceState['view'] = 'stats') {
  let state: StatsSourceState = {
    view, songs: [{ audioPath: 'a', songName: 'Song', artist: 'Artist', genre: ['Jazz'] }],
    stats: { a: { plays: 1, duration: 10 } }, collections: [], genreOverrides: {}, player: { song: null, playing: true },
  };
  const listeners = new Set<(next: StatsSourceState, previous: StatsSourceState) => void>();
  return {
    listeners, getState: () => state,
    subscribe(listener: (next: StatsSourceState, previous: StatsSourceState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(patch: Partial<StatsSourceState>) { const previous = state; state = { ...state, ...patch }; listeners.forEach(listener => listener(state, previous)); },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 1, 12)); });
afterEach(() => { vi.useRealTimers(); });

describe('statistics subscriptions stay out of the playback hot path', () => {
  it('coalesces fast playback ticks into one consistent latest snapshot each second', () => {
    const store = source();
    const snapshots: StatsSnapshot[] = [];
    const stop = subscribeStatsSnapshots(store, snapshot => snapshots.push(snapshot));
    expect(snapshots).toHaveLength(1);
    for (let tick = 1; tick <= 3; tick++) {
      vi.advanceTimersByTime(250);
      store.set({ stats: { a: { plays: 1, duration: 10 + tick } } });
    }
    expect(snapshots).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(250);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].stats).toBe(store.getState().stats);
    expect(snapshots[1].stats.a.duration).toBe(13);
    store.set({ stats: { a: { plays: 1, duration: 14 } } });
    vi.advanceTimersByTime(999);
    expect(snapshots).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2].stats.a.duration).toBe(14);
    stop();
  });

  it('applies a label edit immediately alongside the latest pending listening counters', () => {
    const store = source();
    const receive = vi.fn();
    const stop = subscribeStatsSnapshots(store, receive);
    vi.advanceTimersByTime(100);
    store.set({ stats: { a: { plays: 2, duration: 20 } } });
    store.set({ genreOverrides: { a: ['Soul'] } });
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.lastCall?.[0]).toMatchObject({ stats: { a: { duration: 20 } }, genreOverrides: { a: ['Soul'] } });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(receive).toHaveBeenCalledTimes(2);
    stop();
  });

  it('cancels pending work and unsubscribes immediately when hidden, then refreshes on return', () => {
    const store = source();
    const receive = vi.fn();
    const stop = subscribeStatsSnapshots(store, receive);
    store.set({ stats: { a: { plays: 1, duration: 11 } } });
    expect(vi.getTimerCount()).toBe(1);
    store.set({ view: 'player' });
    expect(store.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    store.set({ stats: { a: { plays: 5, duration: 100 } } });
    vi.advanceTimersByTime(2000);
    expect(receive).toHaveBeenCalledTimes(1);
    store.set({ view: 'stats' });
    const stopAgain = subscribeStatsSnapshots(store, receive);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.lastCall?.[0].stats.a.duration).toBe(100);
    stop(); stopAgain();
  });

  it('does not subscribe when hidden, ignores unrelated state ticks, and cleans up on unmount', () => {
    const hidden = source('player');
    const receive = vi.fn();
    subscribeStatsSnapshots(hidden, receive)();
    expect(hidden.listeners.size).toBe(0);
    expect(receive).not.toHaveBeenCalled();
    const visible = source();
    const stop = subscribeStatsSnapshots(visible, receive);
    visible.set({ player: { ...visible.getState().player } });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    visible.set({ stats: { a: { plays: 1, duration: 11 } } });
    stop();
    expect(visible.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(receive).toHaveBeenCalledTimes(1);
  });
});
