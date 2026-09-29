import { useState } from 'react';
import { errorMessage, getBridge } from '../api';
import { notify } from '../ui';
import { shareExpiry, shareStatus, shareUsage } from './playlist-data';
import type { SharedPlaylist } from './playlist-data';

export async function copyShareText(value: string) {
  if (!value) { notify('没有可复制的内容', 'error'); return; }
  try { await navigator.clipboard.writeText(value); notify('已复制'); }
  catch (error) { notify(`复制失败：${errorMessage(error)}`, 'error'); }
}

export default function SharedPlaylistCard({ record, onDelete }: { record: SharedPlaylist; onDelete: (record: SharedPlaylist) => Promise<void> }) {
  const [detail, setDetail] = useState<SharedPlaylist | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function readDetail(): Promise<SharedPlaylist> {
    if (detail) return detail;
    const result = await getBridge('playlistAPI').getSharedPlaylist(record.id);
    if (!result?.ok || !result.record) throw new Error(result?.message || '分享详情读取失败');
    setDetail(result.record); return result.record;
  }
  async function copy(field: 'shareLink' | 'key') {
    setBusy(true); setError('');
    try {
      const data = await readDetail();
      const text = field === 'shareLink' ? data.shareLink || data.accessKey || '' : data.key || '';
      if (!text) throw new Error(field === 'key' ? '此旧版分享没有保存密钥，请重新生成分享' : '此分享没有可用链接');
      await copyShareText(text);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function exportCrt() {
    setBusy(true); setError('');
    try {
      const data = await readDetail();
      if (!data.key || !data.shareLink) throw new Error('此旧版分享缺少密钥或完整链接，请重新生成分享');
      const result = await getBridge('playlistAPI').exportCrt(data.key, data.shareLink, data.name);
      if (result?.ok) notify('CRT 密钥文件已保存', 'success');
      else if (!result?.canceled) throw new Error(result?.message || 'CRT 导出失败');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  return <details className="card" onToggle={event => {
    if (event.currentTarget.open && !detail) void readDetail().catch(caught => setError(errorMessage(caught)));
  }}>
    <summary><strong>{record.name}</strong> <span className="badge">{shareStatus(record)}</span><p className="muted">{record.songCount} 首 · 有效期 {shareExpiry(record)} · 访问 {shareUsage(record)}</p></summary>
    <p className="muted">生成于 {new Date(record.createdAt).toLocaleString()}</p>
    <label>分享链接<input className="field" readOnly value={detail?.shareLink || detail?.accessKey || ''} placeholder="展开后读取" onFocus={event => event.target.select()} /></label>
    <label>解密密钥<input className="field" readOnly value={detail?.key || ''} placeholder={detail ? '旧版分享未保存密钥' : '展开后读取'} onFocus={event => event.target.select()} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="toolbar">
      <button className="button" disabled={busy} onClick={() => { void copy('shareLink'); }}>复制链接</button>
      <button className="button" disabled={busy} onClick={() => { void copy('key'); }}>复制密钥</button>
      <button className="button" disabled={busy} onClick={() => { void exportCrt(); }}>导出 CRT</button>
      <button className="button danger" disabled={busy} onClick={() => { setBusy(true); void onDelete(record).finally(() => setBusy(false)); }}>销毁分享</button>
    </div>
  </details>;
}
