import { errorMessage, getBridge } from '../../api';
import { useAppStore } from '../../store';
import { playerService } from '../../services/player';
import { notify } from '../../ui';
import type { PreviewSong } from '../../types';
import { inLibrary, matchesSong, songKey, songMeta, type RemoteSong } from './common';

export const sources: [string, string][] = [['netease', '网易云'], ['qq', 'QQ 音乐'], ['kugou', '酷狗'], ['kuwo', '酷我'], ['migu', '咪咕'], ['qianqian', '千千'], ['soda', '汽水'], ['fivesing', '5sing']];
const lyrics = new Map<string, string>();
let inspections = 0;
const inspectionQueue: (() => void)[] = [];
export interface Inspection { valid: boolean; size: string; bitrate: string }
const metadata = new Map<string, Inspection>();
const pendingInspections = new Map<string, Promise<Inspection>>();

export async function inspectSong(song: RemoteSong): Promise<Inspection> {
  const key = songKey(song);
  const cached = metadata.get(key); if (cached) return cached;
  const pending = pendingInspections.get(key); if (pending) return pending;
  const task = (async () => {
    if (inspections >= 3) await new Promise<void>(resolve => inspectionQueue.push(resolve));
    inspections++;
    try {
      const result = await getBridge('freeMusicAPI').inspect(song);
      if (!result.ok) throw new Error(result.message || '无法探测音频');
      const inspection = { valid: !!result.data?.valid, size: String(result.data?.size || ''), bitrate: String(result.data?.bitrate || '') };
      metadata.set(key, inspection); return inspection;
    } finally { inspections--; const next = inspectionQueue.shift(); if (next) next(); }
  })();
  pendingInspections.set(key, task);
  try { return await task; } finally { pendingInspections.delete(key); }
}
async function loadLyric(song: RemoteSong): Promise<string> {
  const key = songKey(song); if (lyrics.has(key)) return lyrics.get(key)!;
  try { const result = await getBridge('freeMusicAPI').lyric(song); const value = result.ok && typeof result.data === 'string' ? result.data : ''; lyrics.set(key, value); return value; } catch { return ''; }
}
export async function saveFreeSong(song: RemoteSong): Promise<void> {
  if (inLibrary(song)) { notify('此歌曲已在歌库中'); return; }
  const api = getBridge('freeMusicAPI');
  let result: any;
  if (song.source === 'qishui') {
    const qishui = getBridge('qishuiAPI'); const login = await qishui.loginStatus(); const user = login.userInfo;
    if (!login.loggedIn || !user) throw new Error('请在导入音乐中登录汽水音乐');
    result = await qishui.importSong(user.aid, user.sessionid, song.id, 'high', song._originSong || song, song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track'), song.vid || song.videoId || '');
  } else if (song.source === 'netease') {
    result = await getBridge('neteaseAPI').importSong(song.id, 'lossless', song._originSong || song, null);
  } else result = await api.saveToLibrary(song, await loadLyric(song));
  if (!result?.ok) throw new Error(result?.message || '保存失败');
  await useAppStore.getState().reloadSongs(); notify(`已保存：${song.name || '歌曲'}`, 'success');
}
export async function switchSong(song: RemoteSong, results: RemoteSong[], skipped: Set<string>): Promise<RemoteSong> {
  const source = song.source || ''; skipped.add(source);
  const alternative = results.find(item => !skipped.has(item.source || '') && matchesSong(song, item));
  if (alternative) return alternative;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: any = await Promise.race([getBridge('freeMusicAPI').switchSource(song), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('换源超时，请稍后重试')), 20000); })]);
    if (!result.ok || !result.data || skipped.has(result.data.source || '')) throw new Error(result.message || '没有找到可用的替代源');
    return result.data;
  } finally { if (timer) clearTimeout(timer); }
}
export async function resolveFreePreview(song: RemoteSong, results: RemoteSong[], onSwitch?: (original: RemoteSong, next: RemoteSong) => void, skipped = new Set<string>(), initialCover = typeof song._freeMusicInitialCover === 'string' ? song._freeMusicInitialCover : songMeta(song).cover): Promise<PreviewSong> {
  let current = song; let failure: unknown = new Error('歌曲不可播放');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const inspection = await inspectSong(current);
      if (!inspection.valid) throw new Error(`${current.source} 源暂无可用音频`);
      const result = await getBridge('freeMusicAPI').streamUrl(current);
      if (!result.ok || !result.data) throw new Error(result.message || '没有试听地址');
      const chosen = current;
      const meta = songMeta(chosen);
      const cover = useAppStore.getState().settings.coverUnify !== false ? initialCover : meta.cover;
      return { ...meta, cover, url: result.data, source: chosen.source, original: { ...chosen, _freeMusicPreview: true, _freeMusicInitialCover: initialCover }, lyric: await loadLyric(chosen), onSave: () => saveFreeSong(chosen) };
    } catch (error) {
      failure = error;
      if (attempt >= 2) break;
      try { const next = await switchSong(current, results, skipped); onSwitch?.(song, next); notify(`${current.source} 源不可用，正在尝试 ${next.source}`); current = next; } catch (switchError) { failure = switchError; break; }
    }
  }
  throw new Error(errorMessage(failure));
}
export async function playFreePreview(song: RemoteSong, results: RemoteSong[], onSwitch?: (original: RemoteSong, next: RemoteSong) => void, forceSwitch = false) {
  const queue: PreviewSong[] = results.map(item => ({ ...songMeta(item), url: '', source: item.source, original: item, resolve: () => resolveFreePreview(item, results, onSwitch) }));
  await playerService.playPreview({ ...songMeta(song), url: '', source: song.source, original: { ...song, _freeMusicPreview: true }, queue, resolve: async () => {
    const skipped = new Set<string>();
    const chosen = forceSwitch ? await switchSong(song, results, skipped) : song;
    if (chosen !== song) onSwitch?.(song, chosen);
    const initialCover = typeof song._freeMusicInitialCover === 'string' ? song._freeMusicInitialCover : songMeta(song).cover;
    return resolveFreePreview(chosen, results, onSwitch, skipped, initialCover);
  } });
}
