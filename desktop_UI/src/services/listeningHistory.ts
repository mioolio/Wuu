import type { ListeningDay, SongStats } from '../types';

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function normalizeSongStats(value: unknown): SongStats {
  if (typeof value === 'number') return { plays: Number.isFinite(value) ? Math.max(0,value) : 0, duration: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { plays: 0, duration: 0 };
  const stats = value as SongStats;
  return { ...stats, plays: Number.isFinite(stats.plays) ? Math.max(0,stats.plays) : 0, duration: Number.isFinite(stats.duration) ? Math.max(0,stats.duration) : 0 };
}

function recentDays(stats: SongStats | undefined, now: Date): Record<string, ListeningDay> {
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - 89);
  const cutoff = localDateKey(earliest);
  const today = localDateKey(now);
  return Object.fromEntries(Object.entries(stats?.recentDays || {}).filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= cutoff && day <= today));
}

export function recordPlay(stats: SongStats | undefined, now = new Date()): SongStats {
  const days = recentDays(stats, now);
  const key = localDateKey(now);
  const day = days[key] || { plays: 0, duration: 0 };
  days[key] = { ...day, plays: day.plays + 1 };
  return { ...stats, plays: (stats?.plays || 0) + 1, duration: stats?.duration || 0, recentDays: days };
}

/** Attribute actual listened seconds to local calendar days, including midnight. */
export function recordListening(stats: SongStats | undefined, seconds: number, end = new Date()): SongStats {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5) return stats || { plays: 0, duration: 0 };
  const days = recentDays(stats, end);
  let cursor = end.getTime() - seconds * 1000;
  while (cursor < end.getTime()) {
    const start = new Date(cursor);
    const midnight = new Date(start);
    midnight.setHours(24,0,0,0);
    const next = Math.min(midnight.getTime(), end.getTime());
    const key = localDateKey(start);
    const day = days[key] || { plays: 0, duration: 0 };
    days[key] = { ...day, duration: day.duration + (next - cursor) / 1000 };
    cursor = next;
  }
  return { ...stats, plays: stats?.plays || 0, duration: (stats?.duration || 0) + seconds, recentDays: days };
}
