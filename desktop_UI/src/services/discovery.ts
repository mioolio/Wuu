import { getBridge } from '../api';
import { useAppStore } from '../store';
import { playerService } from './player';
import { notify } from '../ui';
import type { Song, PreviewSong } from '../types';
import type { RemoteSong } from '../features/online/common';

export const discoveryCatalogLabel = '网易云公开歌单随机候选';
const normalize = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const unknownArtists = new Set(['unknown', 'unknownartist', '未知', '未知艺人', '未知歌手']);
const artists = (value: unknown) => String(value || '').split(/[,，、/&;；]+/).map(normalize).filter(value => value && !unknownArtists.has(value));
function source(value: unknown) {
  const name = normalize(value);
  return ['netease', 'music163', '163', '网易云', '网易云音乐'].includes(name) ? 'netease' : name;
}
export function discoverySongKey(song: RemoteSong): string { return `${source(song.source)}:${String(song.id || song.hash || '')}`; }

interface Exclusions { ids: Set<string>; titles: Map<string, Set<string>>; unknownArtistTitles: Set<string> }
function exclusionIndex(values: (Song | RemoteSong)[]): Exclusions {
  const index: Exclusions = { ids: new Set(), titles: new Map(), unknownArtistTitles: new Set() };
  values.forEach(song => {
    // Scanner's row `id` is an index, not a provider identity.
    const id = song.audioPath ? song.trackId || song.providerId || song.songId : song.id || song.hash;
    if (source(song.source) && id) index.ids.add(`${source(song.source)}:${String(id)}`);
    const title = normalize(song.songName || song.name || song.title), names = artists(song.artist);
    if (!title) return;
    if (!names.length) { if (song.audioPath) index.unknownArtistTitles.add(title);return; }
    const bucket = index.titles.get(title) || new Set<string>();names.forEach(name => bucket.add(name));index.titles.set(title, bucket);
  });
  return index;
}
function allowed(song: RemoteSong, index: Exclusions): boolean {
  if (!song.id || source(song.source) !== 'netease' || !normalize(song.name || song.title) || !artists(song.artist).length) return false;
  if (index.ids.has(discoverySongKey(song))) return false;
  if (index.unknownArtistTitles.has(normalize(song.name || song.title))) return false;
  const known = index.titles.get(normalize(song.name || song.title));
  return !known || !artists(song.artist).some(artist => known.has(artist));
}
export function isNewDiscoverySong(song: RemoteSong, localSongs: Song[]): boolean { return allowed(song, exclusionIndex(localSongs)); }

function cancelled(): Error { const error = new Error('新曲发现请求已取消');error.name = 'AbortError';return error; }
async function bounded<T>(task: Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (signal?.aborted) throw cancelled();
    return await Promise.race([task, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      abort = () => reject(cancelled());signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally { if (timer) clearTimeout(timer);if (abort) signal?.removeEventListener('abort', abort); }
}
function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}
export interface DiscoveryDependencies {
  fetchCandidates?: (page: number) => Promise<RemoteSong[]>;
  random?: () => number;
  timeoutMs?: number;
  now?: () => number;
}
/** Samples a public catalog, never the local library or the entire music web. */
export function createDiscoverySession({ fetchCandidates, random = Math.random, timeoutMs = 16000, now = Date.now }: DiscoveryDependencies = {}) {
  const fetch = fetchCandidates || (async (page: number) => {
    const result = await getBridge('neteaseAPI').discover({ page });
    if (!result?.ok || !Array.isArray(result.data)) throw new Error(result?.message || '新曲发现不可用，请检查网络后重试');
    return result.data as RemoteSong[];
  });
  let pool: RemoteSong[] = [], history: RemoteSong[] = [], page = 0, version = 0, loadedAt = -Infinity;
  return {
    async next(localSongs: Song[], { limit = 4, signal }: { limit?: number; signal?: AbortSignal } = {}): Promise<RemoteSong[]> {
      const request = ++version;
      const startedAt = Date.now();
      if (signal?.aborted) throw cancelled();
      const size = Math.max(1, Math.min(12, Math.floor(Number(limit) || 4)));
      const validate = () => { if (request !== version || signal?.aborted) throw cancelled(); };
      const exclusions = exclusionIndex([...localSongs, ...history]);
      let remaining = now() - loadedAt < 300000 ? [...pool] : [];
      const chosen: RemoteSong[] = [];
      for (let attempt = 0; attempt < 4 && chosen.length < size; attempt++) {
        validate();
        if (!remaining.length) {
          const budget = timeoutMs - (Date.now() - startedAt);
          if (budget <= 0) throw new Error('新曲发现请求超时，请检查网络后重试');
          const candidates = await bounded(Promise.resolve().then(() => { validate();return fetch(page++); }), budget, '新曲发现请求超时，请检查网络后重试', signal);
          validate();remaining = shuffle(Array.isArray(candidates) ? candidates.filter(song => song && typeof song === 'object') : [], random);
        }
        while (remaining.length && chosen.length < size) {
          const song = remaining.pop()!;
          if (!allowed(song, exclusions)) continue;
          chosen.push(song);
          exclusions.ids.add(discoverySongKey(song));
          const title = normalize(song.name || song.title), names = exclusions.titles.get(title) || new Set<string>();
          artists(song.artist).forEach(artist => names.add(artist));exclusions.titles.set(title, names);
        }
      }
      validate();
      if (!chosen.length) throw new Error('这批公开歌单暂无歌库以外的新曲，请换一批重试');
      pool = remaining;loadedAt = now();history = [...history, ...chosen].slice(-2000);
      return chosen;
    },
  };
}

async function resolveDiscoveryPreview(song: RemoteSong): Promise<PreviewSong> {
  const result = await bounded(Promise.resolve().then(() => getBridge('neteaseAPI').preview(song.id, 'standard')), 20000, '歌曲试听请求超时，请稍后重试');
  if (!result?.ok || !result.data?.url) throw new Error(result?.message || '平台暂未提供这首歌的试听地址');
  const data = result.data;
  return { name: data.meta?.title || data.title || song.name || song.title || '', artist: data.meta?.artist || data.artist || song.artist || '',
    cover: data.meta?.cover || data.cover || song.cover || '', url: data.url,
    lyric: data.rawText || data.lrcText || data.krc || data.lrc || '', mediaType: 'audio', source: 'netease', original: song,
    onSave: () => saveDiscoverySong(song) };
}
let playVersion = 0;
export async function playDiscoverySong(song: RemoteSong, batch: RemoteSong[] = [song]): Promise<boolean> {
  const request = ++playVersion;
  if (!isNewDiscoverySong(song, useAppStore.getState().songs)) return false;
  const unique = new Set<string>();
  const candidates = [song, ...batch].filter(item => {
    const key = discoverySongKey(item);if (unique.has(key) || !isNewDiscoverySong(item, useAppStore.getState().songs)) return false;unique.add(key);return true;
  });
  const queue: PreviewSong[] = candidates.map(item => ({ name: item.name || item.title || '', artist: item.artist || '', cover: item.cover || '',
    source: 'netease', original: item, url: '', resolve: () => resolveDiscoveryPreview(item) }));
  let resolved = false;
  await playerService.playPreview({ ...queue[0], queue, resolve: async () => { const preview = await resolveDiscoveryPreview(song);resolved = true;return preview; } });
  const current = useAppStore.getState().player;
  return request === playVersion && resolved && current.playing && !!current.preview?.url && discoverySongKey(current.preview.original || {}) === discoverySongKey(song);
}
export async function saveDiscoverySong(song: RemoteSong): Promise<void> {
  if (!isNewDiscoverySong(song, useAppStore.getState().songs)) { notify('此歌曲已在歌库中');return; }
  const preview = await bounded(Promise.resolve().then(() => getBridge('neteaseAPI').preview(song.id, 'standard')), 20000, '歌曲可用性检查超时，请重试');
  if (!preview?.ok || !preview.data?.url) throw new Error(preview?.message || '平台未提供这首歌的可保存音频');
  if (preview.data.isPreview || preview.data.needRelogin) throw new Error('平台仅提供试听片段，暂不能保存完整歌曲');
  // Recheck after a network await: another save may already have added it.
  if (!isNewDiscoverySong(song, useAppStore.getState().songs)) return;
  const result = await bounded(Promise.resolve().then(() => getBridge('neteaseAPI').importSong(song.id, 'standard', song, null)), 90000, '歌曲保存超时，请检查歌库后重试');
  if (!result?.ok) throw new Error(result?.message || '保存到歌库失败');
  await useAppStore.getState().reloadSongs();notify('已保存到歌库', 'success');
}
