import type { Song, SongStats } from '../types';
import { localDateKey } from './listeningHistory';

export interface ListeningStyleBucket {
  name: string;
  duration: number;
  share: number;
  unlabeled: boolean;
}

export interface RecentListeningTrack {
  song: Song;
  duration: number;
  plays: number;
  lastDay: string;
  genres: string[];
  manual: boolean;
}

export function normalizeGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim())
    .filter(entry => {
      const key = entry.toLocaleLowerCase();
      if (!entry || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseGenreInput(value: string): string[] {
  return normalizeGenres(value.split(/[,，、;；\n]+/));
}

export function songGenres(song: Song, overrides: Record<string, string[]>): { genres: string[]; manual: boolean } {
  const manual = Object.prototype.hasOwnProperty.call(overrides, song.audioPath);
  return { genres: normalizeGenres(manual ? overrides[song.audioPath] : song.genre), manual };
}

export function recentDayKeys(days: 7 | 30, now = new Date()): string[] {
  // Calendar arithmetic keeps the window correct across local daylight-saving changes.
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Array.from({ length: days }, (_, index) => {
    if (index) day.setDate(day.getDate() - 1);
    return localDateKey(day);
  });
}

function positive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Uses dated listening time and explicit genre labels only; legacy totals are not history. */
export function summarizeListeningStyles(
  songs: Song[], stats: Record<string, SongStats>, overrides: Record<string, string[]>, days: 7 | 30, now = new Date(),
) {
  const keys = new Set(recentDayKeys(days, now));
  const library = new Map(songs.map(song => [song.audioPath, song]));
  const genres = new Map<string, { name: string; duration: number }>();
  const tracks: RecentListeningTrack[] = [];
  let totalDuration = 0;
  let taggedDuration = 0;
  let unlabeledDuration = 0;
  const recordedDays = new Set<string>();

  for (const [path, entry] of Object.entries(stats)) {
    let duration = 0;
    let plays = 0;
    let lastDay = '';
    for (const [day, record] of Object.entries(entry?.recentDays || {})) {
      if (!keys.has(day)) continue;
      const dayDuration = positive(record?.duration);
      const dayPlays = positive(record?.plays);
      if (!dayDuration && !dayPlays) continue;
      duration += dayDuration;
      plays += dayPlays;
      if (day > lastDay) lastDay = day;
      recordedDays.add(day);
    }
    if (!duration && !plays) continue;
    const song = library.get(path);
    const labels = song ? songGenres(song, overrides) : { genres: [], manual: false };
    if (song) tracks.push({ song, duration, plays, lastDay, ...labels });
    totalDuration += duration;
    if (!labels.genres.length) { unlabeledDuration += duration; continue; }
    taggedDuration += duration;
    // A multi-genre song contributes its time once, shared equally between its labels.
    const contribution = duration / labels.genres.length;
    for (const name of labels.genres) {
      const key = name.toLocaleLowerCase();
      const bucket = genres.get(key) || { name, duration: 0 };
      bucket.duration += contribution;
      genres.set(key, bucket);
    }
  }

  const buckets: ListeningStyleBucket[] = [...genres.values()].filter(bucket => bucket.duration > 0)
    .sort((a, b) => b.duration - a.duration || a.name.localeCompare(b.name, 'zh'))
    .map(bucket => ({ ...bucket, share: totalDuration ? bucket.duration / totalDuration * 100 : 0, unlabeled: false }));
  if (unlabeledDuration > 0) buckets.push({ name: '未标注', duration: unlabeledDuration, share: unlabeledDuration / totalDuration * 100, unlabeled: true });
  tracks.sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.duration - a.duration || b.plays - a.plays || a.song.songName.localeCompare(b.song.songName, 'zh'));
  return { buckets, tracks, totalDuration, taggedDuration, coverage: totalDuration ? taggedDuration / totalDuration * 100 : 0, recordedDays: recordedDays.size };
}
