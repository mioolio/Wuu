import { useMemo, useRef, useState } from 'react';
import { getBridge, errorMessage, mediaUrl } from '../api';
import { applyUserDataChange, useAppStore, scheduleSave } from '../store';
import { playerService } from '../services/player';
import { confirmAction, notify } from '../ui';
import type { Song } from '../types';
import './utility-features.css';

export default function ManagementView() {
  const songs = useAppStore(state => state.songs);
  const dislikes = useAppStore(state => state.dislikes);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const marked = useMemo(() => songs.filter(song => dislikes[song.audioPath] !== undefined)
    .sort((a, b) => dislikes[b.audioPath] - dislikes[a.audioPath]), [songs, dislikes]);
  const filtered = useMemo(() => marked.filter(song => `${song.songName} ${song.artist} ${song.audioPath}`.toLowerCase().includes(query.toLowerCase().trim())), [marked, query]);
  const selectedSongs = marked.filter(song => selected.has(song.audioPath));
  const allSelected = filtered.length > 0 && filtered.every(song => selected.has(song.audioPath));

  function cancelMarks(paths: string[]) {
    applyUserDataChange(state => {
      const dislikes = { ...state.dislikes };
      paths.forEach(path => { delete dislikes[path]; });
      return { dislikes };
    });
    scheduleSave();
    setSelected(previous => new Set([...previous].filter(path => !paths.includes(path))));
    notify(`已取消 ${paths.length} 条不推荐标记`, 'success');
  }

  async function deleteSongs(targets: Song[]) {
    if (busyRef.current || !targets.length) return;
    const confirmed = await confirmAction({ title: '从磁盘彻底删除', danger: true, confirmText: '彻底删除',
      message: targets.length === 1
        ? `确定彻底删除「${targets[0].songName}」吗？将删除歌曲所在文件夹中的音频、封面、歌词及信息文件，无法恢复。\n${targets[0].audioPath}`
        : `确定彻底删除选中的 ${targets.length} 首歌曲吗？将删除各歌曲所在文件夹中的音频、封面、歌词及信息文件，无法恢复。` });
    if (!confirmed || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let deleted = 0;
    const failures: string[] = [];
    try {
      for (const song of targets) {
        try {
          const state = useAppStore.getState();
          if (!state.player.preview && state.player.song?.audioPath === song.audioPath) playerService.stop();
          const result = await getBridge('musicAPI').deleteSongFolder(song.audioPath);
          if (!result?.ok && result?.error !== 'not_found') throw new Error(result?.error || '删除失败');
          useAppStore.getState().removeSong(song.audioPath);
          setSelected(previous => new Set([...previous].filter(path => path !== song.audioPath)));
          deleted++;
        } catch (error) { failures.push(`${song.songName}：${errorMessage(error)}`); }
      }
      if (deleted) await useAppStore.getState().reloadSongs();
      notify(`已删除 ${deleted} 首${failures.length ? `，失败 ${failures.length} 首：${failures[0]}` : ''}`, failures.length ? 'error' : 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <section className="panel management-page">
    <div className="page-header"><div><h1>不推荐管理</h1><p className="muted">管理不推荐的音乐，取消标记或从磁盘移除。</p></div><span className="badge">{marked.length} 首</span></div>
    <div className="toolbar">
      <input className="field" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索歌曲、艺人或文件路径" aria-label="搜索不推荐歌曲" />
      <button className="button" disabled={busy} onClick={() => { void useAppStore.getState().reloadSongs().then(() => notify('曲库已刷新')).catch(error => notify(errorMessage(error), 'error')); }}>刷新</button>
      <button className="button" disabled={busy || !Object.keys(dislikes).length} onClick={() => { void confirmAction({ title: '清空不推荐标记', message: `清空全部 ${Object.keys(dislikes).length} 条标记？歌曲文件会保留。`, confirmText: '清空标记' }).then(confirmed => { if (confirmed) cancelMarks(Object.keys(useAppStore.getState().dislikes)); }); }}>清空标记</button>
    </div>
    {!!marked.length && <div className="toolbar">
      <label><input type="checkbox" disabled={busy || !filtered.length} checked={allSelected} onChange={() => setSelected(previous => {
        const next = new Set(previous); filtered.forEach(song => allSelected ? next.delete(song.audioPath) : next.add(song.audioPath)); return next;
      })} /> 全选当前列表</label>
      <span className="muted">已选 {selectedSongs.length} 首</span>
      <button className="button" disabled={busy || !selectedSongs.length} onClick={() => cancelMarks(selectedSongs.map(song => song.audioPath))}>取消选中标记</button>
      <button className="button danger" disabled={busy || !selectedSongs.length} onClick={() => { void deleteSongs(selectedSongs); }}>{busy ? '删除中…' : '彻底删除选中'}</button>
    </div>}
    {!filtered.length ? <div className="empty">{marked.length ? '没有匹配的歌曲。' : '暂无标记为不推荐的音乐。'}</div> : <div className="card">
      {filtered.map(song => <div className="row" key={song.audioPath}>
        <input type="checkbox" disabled={busy} checked={selected.has(song.audioPath)} aria-label={`选择${song.songName}`} onChange={() => setSelected(previous => { const next = new Set(previous); next.has(song.audioPath) ? next.delete(song.audioPath) : next.add(song.audioPath); return next; })} />
        {song.coverPath && <img src={mediaUrl(song.coverPath)} alt="" loading="lazy" width="44" height="44" style={{ objectFit: 'cover', borderRadius: 8 }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
        <div style={{ flex: 1, minWidth: 0 }}><strong>{song.songName}</strong><div className="muted">{song.artist || '未知艺人'} · 标记于 {new Date(dislikes[song.audioPath]).toLocaleString()}</div><small className="muted" title={song.audioPath} style={{ overflowWrap: 'anywhere' }}>{song.audioPath}</small></div>
        <button className="button" disabled={busy} onClick={() => cancelMarks([song.audioPath])}>取消标记</button>
        <button className="button danger" disabled={busy} onClick={() => { void deleteSongs([song]); }}>彻底删除</button>
      </div>)}
    </div>}
  </section>;
}
