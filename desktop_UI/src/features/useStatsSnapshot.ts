import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { sameStatsSnapshot, statsSnapshot, subscribeStatsSnapshots, type StatsSnapshot } from '../services/statsSnapshot';

function initialSnapshot(): StatsSnapshot {
  const state = useAppStore.getState();
  // A lazy page can finish loading after navigation has already hidden it.
  return state.view === 'stats' ? statsSnapshot(state) : {
    songs: [], stats: {}, collections: [], genreOverrides: {}, currentPath: undefined, playing: false, day: '',
  };
}

export function useStatsSnapshot() {
  const active = useAppStore(state => state.view === 'stats');
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  useEffect(() => {
    if (!active) return;
    return subscribeStatsSnapshots(useAppStore, next => setSnapshot(previous => sameStatsSnapshot(previous, next) ? previous : next));
  }, [active]);
  return snapshot;
}
