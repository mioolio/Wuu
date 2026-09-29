import type { PreviewSong, Song } from '../types';
export const positive = (value: unknown): number => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

export function preferredDuration(song: Song | null, decoded: number, preview = false): number {
  return (!preview && positive(song?.realDuration)) || positive(decoded) || 0;
}
export function safeSeekTime(requested: number, duration: number, decoded: number): number {
  const ceiling = positive(decoded) ? Math.min(positive(duration) || decoded, decoded) : positive(duration);
  return Math.max(0, Math.min(Number.isFinite(requested) ? requested : 0, Math.max(0, ceiling - 0.03)));
}
export function shuffled<T>(items: T[]): T[] {
  const queue = [...items];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}
export function isVideo(song: Song | null, preview: PreviewSong | null = null): boolean {
  return preview ? preview.mediaType === 'video' || /\.(mp4|webm|mov|avi|mkv)(?:[?#]|$)/i.test(preview.url) : !!song && (!!song.videoId || !!song.vid || /\.(mp4|webm|mov|avi|mkv)$/i.test(song.audioPath));
}
