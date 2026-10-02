import { useMemo, useRef, useState } from 'react';
import { errorMessage, getBridge, mediaUrl } from '../api';
import { applyUserDataChange, scheduleSave, useAppStore } from '../store';
import { playerService } from '../services/player';
import { confirmAction, notify, promptText } from '../ui';
import { canonicalRepairPath, remapRepairData, repairedAudioPath, sameRepairPath } from './repair-data';
import './utility-features.css';

interface DamagedSong {
  folder: string;
  title: string;
  artist: string;
  trackId: string;
  duration: number;
  issue: string;
  coverPath?: string;
  audioPath?: string;
}
type RepairStatus = 'pending' | 'repairing' | 'done' | 'failed';
interface RepairEntry { item: DamagedSong; status: RepairStatus; message: string }
const labels: Record<RepairStatus, string> = { pending: '待修复', repairing: '修复中', done: '已修复', failed: '修复失败' };
function canAutoRepair(item: DamagedSong) {
  return !item.issue.includes('需重新解析') && (item.issue.includes('歌词') || item.issue === '名称异常' || !!item.trackId);
}

export default function RepairView() {
  const [entries, setEntries] = useState<RepairEntry[]>([]);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => entries.filter(({ item }) => `${item.title} ${item.artist} ${item.issue} ${item.trackId}`.toLowerCase().includes(query.toLowerCase().trim())), [entries, query]);
  const pending = entries.filter(entry => canAutoRepair(entry.item) && (entry.status === 'pending' || entry.status === 'failed'));

  function update(item: DamagedSong, nextStatus: RepairStatus, message = '') {
    setEntries(previous => previous.map(entry => entry.item.folder === item.folder ? { ...entry, status: nextStatus, message } : entry));
  }

  async function scan() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setStatus('正在扫描曲库…');
    try {
      const result = await getBridge('repairAPI').scan();
      if (!Array.isArray(result)) throw new Error('扫描结果格式错误');
      setEntries(result.map((item: DamagedSong) => ({ item, status: 'pending', message: '' })));
      setScanned(true);
      setStatus(result.length ? `发现 ${result.length} 首需要处理的歌曲` : '未发现损坏的歌曲');
    } catch (error) { setStatus(`扫描失败：${errorMessage(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function performRepair(item: DamagedSong, shareLink?: string): Promise<boolean> {
    update(item, 'repairing');
    try {
      const before = useAppStore.getState();
      const oldPath = item.audioPath ? canonicalRepairPath(before.songs, item.audioPath) : '';
      const repairsAudio = !shareLink && !item.issue.includes('歌词') && item.issue !== '版权信息缺失';
      const stopped = repairsAudio && !!oldPath && !before.player.preview && !!before.player.song && sameRepairPath(before.player.song.audioPath, oldPath);
      if (stopped) playerService.stop();
      const api = getBridge('repairAPI');
      const result = shareLink ? await api.repairLyricsManual(item.folder, shareLink) : await api.repair(item);
      if (!result?.ok) throw new Error(result?.message || '修复失败');
      let message = stopped ? '歌曲文件已更新，请重新播放。' : '';
      if (oldPath && result.data && (item.issue === '名称异常' || result.data.audioPath)) {
        await useAppStore.getState().reloadSongs();
        const newPath = repairedAudioPath(useAppStore.getState().songs, result.data);
        if (newPath && newPath !== oldPath) {
          applyUserDataChange(state => remapRepairData(state, oldPath, newPath));
          playerService.remapSongPath(oldPath, newPath);
          scheduleSave();
        } else if (!newPath) message = '文件已修复，未能确认新歌曲路径；请重新扫描曲库。';
      }
      update(item, 'done', message);
      return true;
    } catch (error) { update(item, 'failed', errorMessage(error)); return false; }
  }

  async function repairOne(item: DamagedSong, manual = false) {
    if (busyRef.current) return;
    let shareLink: string | null = null;
    if (manual) {
      shareLink = await promptText({ title: '手动修复歌词', message: `粘贴这首歌曲的分享链接，重新获取逐字歌词。\n${item.title} · ${item.folder}`, confirmText: '修复歌词' });
      if (!shareLink?.trim()) return;
    }
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const ok = await performRepair(item, shareLink?.trim());
      setStatus(ok ? `已修复「${item.title}」` : `「${item.title}」修复失败，可重试或删除`);
      if (ok) await useAppStore.getState().reloadSongs();
    } catch (error) { setStatus(`刷新曲库失败：${errorMessage(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function repairAll() {
    if (busyRef.current || !pending.length) return;
    busyRef.current = true; setBusy(true);
    let done = 0, failed = 0;
    try {
      for (let index = 0; index < pending.length; index++) {
        setStatus(`正在修复 ${index + 1} / ${pending.length}：${pending[index].item.title}`);
        if (await performRepair(pending[index].item)) done++; else failed++;
        if (index + 1 < pending.length) await new Promise(resolve => setTimeout(resolve, 500));
      }
      setStatus(`修复完成：成功 ${done} 首，失败 ${failed} 首${entries.some(entry => entry.item.issue.includes('需重新解析')) ? '；需重新解析的歌词请使用手动修复' : ''}`);
      if (done) await useAppStore.getState().reloadSongs();
    } catch (error) { setStatus(`操作失败：${errorMessage(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function deleteEntry(item: DamagedSong) {
    if (!item.audioPath || busyRef.current) return;
    if (!await confirmAction({ title: '彻底删除损坏歌曲', danger: true, confirmText: '彻底删除', message: `确定彻底删除「${item.title || item.folder}」吗？将删除磁盘上的整个歌曲文件夹（音频、封面、歌词），无法恢复。\n${item.audioPath}` })) return;
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const state = useAppStore.getState();
      const audioPath = canonicalRepairPath(state.songs, item.audioPath);
      if (!state.player.preview && state.player.song && sameRepairPath(state.player.song.audioPath, audioPath)) playerService.stop();
      const result = await getBridge('musicAPI').deleteSongFolder(audioPath);
      if (!result?.ok && result?.error !== 'not_found') throw new Error(result?.error || '删除失败');
      useAppStore.getState().removeSong(audioPath);
      setEntries(previous => previous.filter(entry => entry.item.folder !== item.folder));
      await useAppStore.getState().reloadSongs();
      setStatus(`已删除「${item.title || item.folder}」`);
    } catch (error) { setStatus(`删除失败：${errorMessage(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify('已复制'); }
    catch (error) { notify(`复制失败：${errorMessage(error)}`, 'error'); }
  }

  return <section className="panel repair-page">
    <div className="page-header"><div><h1>修复中心</h1><p className="muted">扫描音频损坏、文件缺失、名称异常及歌词精度问题，重新获取歌曲或修复歌词。</p></div></div>
    <div className="toolbar">
      <button className="button primary" disabled={busy} onClick={() => { void scan(); }}>{busy && !entries.length ? '扫描中…' : '扫描损坏歌曲'}</button>
      <button className="button" disabled={busy || !pending.length} onClick={() => { void repairAll(); }}>修复全部（{pending.length}）</button>
      {!!entries.length && <input className="field" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索歌曲、艺人或问题" aria-label="搜索修复条目" />}
    </div>
    {status && <p role="status" className="muted">{status}</p>}
    {!filtered.length ? <div className="empty">{scanned ? entries.length ? '没有匹配的条目。' : '曲库状态良好。' : '点击扫描，检查你的音乐文件。'}</div> : <div className="card">
      {filtered.map(({ item, status: entryStatus, message }) => {
        const manual = item.issue.includes('需重新解析');
        const repairable = manual || canAutoRepair(item);
        return <div className="row" key={item.folder}>
          {item.coverPath && <img src={mediaUrl(item.coverPath)} alt="" width="44" height="44" loading="lazy" style={{ borderRadius: 8, objectFit: 'cover' }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <button className="button" title="复制歌曲名" onClick={() => { void copy(item.title); }}><strong>{item.title || '未知歌曲'}</strong></button>
            <button className="button" title="复制艺人名" onClick={() => { void copy(item.artist); }}>{item.artist || '未知艺人'}</button>
            <div className="muted">Track ID：{item.trackId || '无'} · {item.folder}</div>
            {!!message && <div title={message} role="status" style={{ overflowWrap: 'anywhere' }}>{message}</div>}
          </div>
          <span className="badge">{item.issue}</span><span className="badge">{labels[entryStatus]}</span>
          {entryStatus !== 'done' && repairable && <button className="button primary" disabled={busy} onClick={() => { void repairOne(item, manual); }}>{entryStatus === 'failed' ? manual ? '重试手动修复' : '重试' : manual ? '手动修复' : '修复'}</button>}
          {!repairable && <span className="muted">无法自动修复</span>}
          {(entryStatus === 'failed' || !repairable || manual) && <button className="button danger" disabled={busy || !item.audioPath} title={item.audioPath ? '从磁盘删除歌曲所在文件夹' : '此条目没有音频路径，无法通过歌曲删除接口删除'} onClick={() => { void deleteEntry(item); }}>删除</button>}
        </div>;
      })}
    </div>}
  </section>;
}
