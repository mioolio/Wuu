import type { Collection, Song, SongStats } from '../types';

interface RepairUserData {
  collections: Collection[];
  dislikes: Record<string, number>;
  likeTimes: Record<string, number>;
  stats: Record<string, SongStats>;
  progress: Record<string, number>;
  actualDuration: Record<string, number>;
  lastSession: { audioPath: string; t: number } | null;
  shareSelection: string[];
}

export function sameRepairPath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/');
}

export function canonicalRepairPath(songs: Song[], audioPath: string): string {
  return songs.find(song => sameRepairPath(song.audioPath, audioPath))?.audioPath || audioPath;
}

export function repairedAudioPath(songs: Song[], result: { audioPath?: string; folder?: string }): string | null {
  if (result.audioPath) return songs.find(song => sameRepairPath(song.audioPath, result.audioPath!))?.audioPath || null;
  if (!result.folder) return null;
  return songs.find(song => song.audioPath.split(/[\\/]/).at(-2) === result.folder)?.audioPath || null;
}

// Name repair changes both the directory and the FLAC filename. Move every
// path-based preference only after the library confirms the new audio path.
export function remapRepairData(state: RepairUserData, oldPath: string, newPath: string): RepairUserData {
  const replace = (path: string) => sameRepairPath(path, oldPath) ? newPath : path;
  const move = <T,>(record: Record<string, T>, merge: (current: T | undefined, incoming: T) => T): Record<string, T> => {
    const next = { ...record };
    const values: T[] = [];
    for (const [path, value] of Object.entries(record)) {
      if (sameRepairPath(path, oldPath)) { delete next[path]; values.push(value); }
    }
    for (const value of values) next[newPath] = merge(next[newPath], value);
    return next;
  };
  return {
    collections: state.collections.map(collection => ({ ...collection, songs: [...new Set(collection.songs.map(replace))] })),
    dislikes: move(state.dislikes, (current, incoming) => Math.max(current || 0, incoming)),
    likeTimes: move(state.likeTimes, (current, incoming) => Math.max(current || 0, incoming)),
    stats: move(state.stats, (current, incoming) => ({ plays: (current?.plays || 0) + incoming.plays, duration: (current?.duration || 0) + incoming.duration })),
    progress: move(state.progress, (_, incoming) => incoming),
    actualDuration: move(state.actualDuration, (current, incoming) => current && current > 0 ? current : incoming),
    lastSession: state.lastSession ? { ...state.lastSession, audioPath: replace(state.lastSession.audioPath) } : null,
    shareSelection: [...new Set(state.shareSelection.map(replace))],
  };
}
