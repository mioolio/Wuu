import type { Collection, Song } from '../types';

export interface SharedPlaylist {
  id: string;
  name: string;
  songCount: number;
  createdAt: number;
  expireAt: number;
  maxUses: number;
  usedCount: number;
  status?: 'active' | 'expired' | 'exhausted' | 'deleted';
  shareLink?: string;
  key?: string;
  accessKey?: string;
}
export interface RemotePlaylistSong {
  songName: string;
  artist: string;
  album?: string;
  realDuration?: number;
  lyricist?: string;
  composer?: string;
  remoteIndex: number;
  audioUrl: string;
  coverUrl?: string;
  lyricUrl?: string;
}
export interface ServerStatus { ok: boolean; running: boolean; port: number; message?: string }
export interface AccessLog { ts: number; ip: string; path: string; action: string; detail: string }

export function collectSharingSongs(songs: Song[], collections: Collection[], sources: Set<string>, explicitPaths: Set<string>, excludedPaths: Set<string>): Song[] {
  const selected = new Set(explicitPaths);
  if (sources.has('all')) songs.forEach(song => selected.add(song.audioPath));
  collections.filter(collection => sources.has(collection.id)).forEach(collection => collection.songs.forEach(path => selected.add(path)));
  const seen = new Set<string>();
  return songs.filter(song => {
    if (!selected.has(song.audioPath) || excludedPaths.has(song.audioPath) || seen.has(song.audioPath)) return false;
    seen.add(song.audioPath); return true;
  });
}

export function shareStatus(record: SharedPlaylist, now = Date.now()): string {
  if (record.expireAt > 0 && now > record.expireAt) return '已过期';
  if (record.maxUses > 0 && record.usedCount >= record.maxUses) return '次数已用尽';
  return '有效';
}
export function shareExpiry(record: Pick<SharedPlaylist, 'expireAt'>): string {
  return record.expireAt > 0 ? new Date(record.expireAt).toLocaleString() : '永久';
}
export function shareUsage(record: Pick<SharedPlaylist, 'maxUses' | 'usedCount'>): string {
  return `${record.usedCount || 0} / ${record.maxUses > 0 ? record.maxUses : '不限'}`;
}

export function remoteDownloadProgress(stage: string, pct: number): number {
  const ranges: Record<string, [number, number]> = { audio: [0, 80], cover: [80, 10], lrc: [90, 8], info: [98, 2] };
  const range = ranges[stage];
  if (!range) return 0;
  return range[0] + range[1] * Math.max(0, Math.min(100, pct)) / 100;
}
