import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { formatTime } from '../../ui';

export type Platform = 'qishui' | 'kugou' | 'netease';
// IPC payloads retain platform-specific metadata for the original download services.
export interface RemoteSong { id?: string | number; hash?: string; name?: string; title?: string; artist?: string; album?: string; cover?: string; source?: string; duration?: string | number; [key: string]: any }
export interface RemotePlaylist { id: string | number; title: string; cover: string; count: number; original: Record<string, any> }
export type Overwrite = Record<'audio' | 'cover' | 'lrc' | 'info' | 'krc', boolean>;
export const overwriteAll: Overwrite = { audio: true, cover: true, lrc: true, info: true, krc: true };
export const platforms: Record<Platform, { name: string; quality: string; options: [string, string][] }> = {
  qishui: { name: '汽水音乐', quality: 'high', options: [['standard', '标准'], ['high', '高品质'], ['lossless', '无损']] },
  kugou: { name: '酷狗音乐', quality: 'flac', options: [['128', '128K'], ['320', '320K'], ['flac', '无损 FLAC'], ['high', 'HiRes']] },
  netease: { name: '网易云音乐', quality: 'lossless', options: [['standard', '标准 128K'], ['exhigh', '极高 320K'], ['lossless', '无损 FLAC'], ['hires', 'HiRes']] },
};
export const stages: Record<string, string> = { start: '开始', audio: '音频', cover: '封面', lrc: '歌词', info: '信息', krc: '逐字歌词', error: '失败' };
export function songKey(song: RemoteSong) { return `${song.source || ''}:${song.id || song.hash || song.name || ''}`; }
export function songMeta(song: RemoteSong, platform?: Platform) {
  let name = String(song.name || song.title || '未知歌曲');
  let artist = song.artist || '';
  let album = song.album || '';
  if (platform === 'kugou') {
    name = name.replace(/\.(mp3|m4a|aac|flac|wav|ogg)$/i, '');
    const separator = name.lastIndexOf(' - ');
    if (separator > 0) { artist = name.slice(0, separator); name = name.slice(separator + 3); }
    artist = (song.singerinfo || []).map((item: any) => item.name).filter(Boolean).join(', ') || artist;
    album = song.albuminfo?.name || album;
  }
  return { name, artist, album, cover: String(song.cover || '').replace('{size}', '400') };
}
export function matchesSong(a: { name?: string; artist?: string }, b: { name?: string; artist?: string }) {
  const name = (a.name || '').trim().toLowerCase();
  if (!name || name !== (b.name || '').trim().toLowerCase()) return false;
  const artists = (value?: string) => (value || '').split(/[,，、/&;；]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
  const first = artists(a.artist); const second = artists(b.artist);
  return !first.length || !second.length || first.some(item => second.includes(item));
}
export function inLibrary(song: RemoteSong, platform?: Platform) {
  const meta = songMeta(song, platform);
  return useAppStore.getState().songs.some(local => matchesSong(meta, { name: local.songName, artist: local.artist }));
}
export function durationLabel(song: RemoteSong, platform?: Platform) {
  if (typeof song.duration === 'string' && song.duration.includes(':')) return song.duration;
  const raw = Number(platform === 'kugou' ? song.timelen : song.duration) || 0;
  return raw ? formatTime(platform === 'kugou' || platform === 'netease' || raw > 10000 ? raw / 1000 : raw) : '';
}
export function Cover({ src, name = '', size = 48 }: { src?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed && !src.includes('placeholder.com')
    ? <img key={src} src={src.replace('{size}', '400')} alt={name} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} onError={() => setFailed(true)} />
    : <span aria-hidden="true" style={{ width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--accent-soft)', flexShrink: 0 }}>♫</span>;
}
export function Progress({ text, pct }: { text: string; pct: number }) {
  return <div className="card" role="status"><p>{text}</p><progress aria-label={text} value={Math.max(0, Math.min(100, pct))} max={100} style={{ width: '100%' }} /></div>;
}
export function SongTags({ song, existing }: { song: RemoteSong; existing?: boolean }) {
  return <>{song.isVip || song.fee === 1 ? <span className="badge">VIP</span> : null}{song.fee === 4 ? <span className="badge">数字专辑</span> : null}{song.isUnavailable ? <span className="badge">已下架</span> : null}{song.isVideo || song.isUgcClip ? <span className="badge">视频</span> : null}{existing ? <span className="badge">已在歌库</span> : null}</>;
}
