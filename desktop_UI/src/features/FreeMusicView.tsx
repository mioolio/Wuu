import { useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge } from '../api';
import { useAppStore } from '../store';
import { playerService } from '../services/player';
import { notify } from '../ui';
import LinkParser from './online/LinkParser';
import { Cover, durationLabel, inLibrary, songKey, songMeta, type RemoteSong } from './online/common';
import { inspectSong, playFreePreview, resolveFreePreview, saveFreeSong, sources, switchSong, type Inspection } from './online/freeMusic';
import './online/online.css';

interface SearchSnapshot { keyword: string; sources: string[]; type: SearchType }
type SearchType = 'song' | 'playlist' | 'album';
interface RemoteCollection { id: string | number; name: string; cover?: string; source: string; creator?: string; trackCount?: number }
function SongResult({ song, index, busy, onPlay, onSave, onSwitch }: { song: RemoteSong; index: number; busy: string; onPlay: () => void; onSave: () => void; onSwitch: () => void }) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [probeError, setProbeError] = useState(false);
  const key = songKey(song);
  useEffect(() => {
    let active = true; setInspection(null); setProbeError(false);
    void inspectSong(song).then(result => { if (active) setInspection(result); }).catch(() => { if (active) setProbeError(true); });
    return () => { active = false; };
  }, [key]);
  const meta = songMeta(song); const existing = inLibrary(song);
  return <div className="card row"><span className="muted">{index + 1}</span><button className="online-cover-button" onClick={onPlay} aria-label={`试听 ${meta.name}`}><Cover src={meta.cover} /></button><div className="online-song-info"><button className="online-song-title" onClick={onPlay}>{meta.name}</button><p className="muted">{meta.artist} {meta.album && `· ${meta.album}`} <span className="badge">{song.source}</span>{existing && <span className="badge">已添加</span>}</p><small className="muted">{probeError ? '探测暂时失败' : !inspection ? '正在探测音频…' : inspection.valid ? [inspection.size, inspection.bitrate].filter(Boolean).join(' · ') || '可试听' : '此源不可用，可换源试听'}</small></div><span className="muted">{durationLabel(song)}</span><button className="button" disabled={!!busy} onClick={onPlay}>{busy === 'play' ? '加载中…' : '试听'}</button><button className="button" disabled={!!busy} onClick={onSwitch}>{busy === 'switch' ? '换源中…' : '换源'}</button><button className="button primary" disabled={!!busy || existing} onClick={onSave}>{existing ? '已添加' : busy === 'save' ? '保存中…' : '保存'}</button></div>;
}

export default function FreeMusicView() {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [mode, setMode] = useState<'search' | 'links'>('search');
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('正在检查服务…');
  const [statusVersion, setStatusVersion] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<SearchType>('song');
  const [selectedSources, setSelectedSources] = useState<string[]>(sources.map(([value]) => value));
  const [searching, setSearching] = useState(false);
  const [songs, setSongs] = useState<RemoteSong[]>([]);
  const songsRef = useRef<RemoteSong[]>([]); songsRef.current = songs;
  const [collections, setCollections] = useState<RemoteCollection[]>([]);
  const [detail, setDetail] = useState<RemoteCollection | null>(null);
  const [detailSongs, setDetailSongs] = useState<RemoteSong[]>([]);
  const detailSongsRef = useRef<RemoteSong[]>([]); detailSongsRef.current = detailSongs;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [serverPage, setServerPage] = useState(1);
  const [lastSearch, setLastSearch] = useState<SearchSnapshot | null>(null);
  const requestId = useRef(0);
  const previewRequest = useRef(0);
  const fallbackBusy = useRef(false);
  const fallbackSources = useRef(new Set<string>());
  const lastError = useRef('');
  const preview = useAppStore(state => state.player.preview);
  const playerError = useAppStore(state => state.player.error);
  const library = useAppStore(state => state.songs);
  void library;
  useEffect(() => {
    let active = true;
    void getBridge('freeMusicAPI').checkDisclaimer().then((value: any) => { if (active) setAccepted(value === true); }).catch((error: unknown) => { if (active) { setAccepted(false); notify(errorMessage(error), 'error'); } });
    return () => { active = false; requestId.current++; previewRequest.current++; };
  }, []);
  useEffect(() => {
    if (!accepted) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined; let attempts = 0;
    setReady(false); setStatus('服务启动中…');
    const check = async () => {
      try { const result = await getBridge('freeMusicAPI').status(); if (!active) return; if (result.ready) { setReady(true); setStatus('服务就绪'); return; } } catch { /* Retry while the bundled music service starts. */ }
      if (!active) return;
      if (++attempts >= 30) { setStatus('服务启动失败，请检查 music-dl.exe 后重试'); return; }
      timer = setTimeout(() => void check(), 1000);
    };
    void check(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [accepted, statusVersion]);
  const visibleSongs = detail ? detailSongs : songs;
  function replaceSong(original: RemoteSong, replacement: RemoteSong) {
    const replace = (values: RemoteSong[]) => values.map(item => songKey(item) === songKey(original) ? { ...replacement } : item);
    setSongs(replace); setDetailSongs(replace);
  }
  useEffect(() => {
    if (!playerError || !preview?.original?._freeMusicPreview || fallbackBusy.current) return;
    const current = preview.original as RemoteSong;
    const signature = `${songKey(current)}:${playerError}`;
    if (lastError.current === signature) return;
    lastError.current = signature; fallbackBusy.current = true;
    const run = ++previewRequest.current;
    const results = detail ? detailSongsRef.current : songsRef.current;
    void (async () => {
      try {
        await playerService.playPreview({ ...preview, url: '', resolve: async () => {
          const next = await switchSong(current, results, fallbackSources.current);
          const initialCover = typeof current._freeMusicInitialCover === 'string' ? current._freeMusicInitialCover : preview.cover || '';
          const resolved = await resolveFreePreview(next, results, replaceSong, fallbackSources.current, initialCover);
          if (run === previewRequest.current) { replaceSong(current, next); notify(`音频加载失败，已切换到 ${next.source}`); }
          return resolved;
        } });
      } catch (error) { if (run === previewRequest.current) notify(`所有可用源试听失败：${errorMessage(error)}`, 'error'); }
      finally { fallbackBusy.current = false; }
    })();
  }, [playerError]);
  async function accept() {
    setAcceptBusy(true);
    try { const result = await getBridge('freeMusicAPI').acceptDisclaimer(); if (!result.ok) throw new Error(result.message); setAccepted(true); }
    catch (error) { notify(errorMessage(error), 'error'); } finally { setAcceptBusy(false); }
  }
  async function search(nextServerPage = 1) {
    if (searching) return;
    const snapshot = nextServerPage === 1 ? { keyword: keyword.trim(), sources: selectedSources, type } : lastSearch;
    if (!snapshot?.keyword) { notify('请输入搜索关键词'); return; }
    if (!snapshot.sources.length) { notify('请至少选择一个平台'); return; }
    const run = ++requestId.current;
    setSearching(true); setMessage('搜索中…'); setDetail(null); setDetailSongs([]); setPage(1);
    try {
      const result = await getBridge('freeMusicAPI').search(snapshot.keyword, snapshot.sources, nextServerPage, snapshot.type);
      if (run !== requestId.current) return;
      if (!result.ok) throw new Error(result.message || '搜索失败');
      const values = Array.isArray(result.data) ? result.data : [];
      if (snapshot.type === 'song') { setSongs(values); setCollections([]); } else { setCollections(values); setSongs([]); }
      setLastSearch(snapshot); setServerPage(nextServerPage); setMessage(values.length ? `第 ${nextServerPage} 批，找到 ${values.length} ${snapshot.type === 'song' ? '首歌曲' : snapshot.type === 'playlist' ? '个歌单' : '张专辑'}` : '没有找到相关结果');
    } catch (error) { if (run === requestId.current) { setMessage(`搜索失败：${errorMessage(error)}`); notify(errorMessage(error), 'error'); } }
    finally { if (run === requestId.current) setSearching(false); }
  }
  async function openCollection(collection: RemoteCollection) {
    const run = ++requestId.current;
    setDetail(collection); setDetailSongs([]); setPage(1); setSearching(true); setMessage('正在加载详情…');
    try {
      const result = await getBridge('freeMusicAPI').playlistDetail(collection.source, collection.id, lastSearch?.type || type);
      if (run !== requestId.current) return;
      if (!result.ok) throw new Error(result.message);
      const values = Array.isArray(result.data) ? result.data : []; setDetailSongs(values); setMessage(`共 ${values.length} 首歌曲`);
    } catch (error) { if (run === requestId.current) setMessage(`详情加载失败：${errorMessage(error)}`); }
    finally { if (run === requestId.current) setSearching(false); }
  }
  async function action(song: RemoteSong, kind: 'play' | 'save' | 'switch') {
    const key = songKey(song); if (busy[key]) return;
    setBusy(value => ({ ...value, [key]: kind }));
    try {
      if (kind === 'save') await saveFreeSong(song);
      else if (kind === 'switch') { ++previewRequest.current; await playFreePreview(song, visibleSongs, replaceSong, true); }
      else {
        const run = ++previewRequest.current; fallbackSources.current = new Set(); lastError.current = '';
        await playFreePreview({ ...song, _freeMusicPreview: true }, visibleSongs, replaceSong);
        if (run !== previewRequest.current) return;
      }
    } catch (error) { notify(`${kind === 'save' ? '保存' : kind === 'switch' ? '换源' : '试听'}失败：${errorMessage(error)}`, 'error'); }
    finally { setBusy(value => { const next = { ...value }; delete next[key]; return next; }); }
  }
  const pageSize = 30;
  const resultsLength = detail || lastSearch?.type === 'song' ? visibleSongs.length : collections.length;
  const pageCount = Math.max(1, Math.ceil(resultsLength / pageSize));
  const currentSongs = visibleSongs.slice((page - 1) * pageSize, page * pageSize);
  if (accepted === null) return <div className="panel empty" role="status">正在加载在线音乐…</div>;
  if (!accepted) return <section className="panel card online-disclaimer"><h1>免费听音乐 · 使用说明</h1><p>本专区通过第三方 music-dl 引擎提供多平台音乐搜索、试听和保存能力。</p><p>资源来自第三方音乐平台，版权归原作者和原平台所有。请仅在获得授权的范围内使用音乐，不得将下载的音乐用于未经授权的商业用途。</p><p>第三方引擎与接口可能存在未知安全风险、资源失效或服务中断；使用前请了解并接受这些风险。</p><p>保存后歌曲会加入本地歌库。无歌词或纯音乐仍可保存音频、封面和歌曲信息；在线歌词可能缺失。</p><div className="toolbar"><button className="button" onClick={() => useAppStore.getState().setView('home')}>不同意，返回首页</button><button className="button primary" disabled={acceptBusy} onClick={() => void accept()}>{acceptBusy ? '保存中…' : '我已了解并同意'}</button></div></section>;
  return <div className="panel online-area"><div className="page-header"><div><h1>免费听音乐</h1><p className="muted">搜索多平台音乐、浏览歌单与专辑，试听和保存到本地歌库。</p></div><span className="badge" role="status">{status}</span>{!ready && <button className="button" onClick={() => setStatusVersion(value => value + 1)}>重试服务</button>}</div>
    <div className="toolbar"><button className={`button ${mode === 'search' ? 'primary' : ''}`} onClick={() => setMode('search')}>在线搜索</button><button className={`button ${mode === 'links' ? 'primary' : ''}`} onClick={() => setMode('links')}>链接解析</button></div>
    <div hidden={mode !== 'links'}><LinkParser /></div><section className="panel" hidden={mode !== 'search'}><form className="toolbar" onSubmit={event => { event.preventDefault(); void search(); }}><select className="field" aria-label="搜索类型" value={type} onChange={event => { setType(event.target.value as SearchType); requestId.current++; setSearching(false); setSongs([]); setCollections([]); setDetail(null); setLastSearch(null); setMessage(''); }}><option value="song">歌曲搜索</option><option value="playlist">歌单搜索</option><option value="album">专辑搜索</option></select><input className="field online-search-input" value={keyword} onChange={event => setKeyword(event.target.value)} aria-label="搜索关键词" placeholder={type === 'song' ? '输入歌曲名 / 歌手名' : type === 'playlist' ? '输入歌单名 / 关键词' : '输入专辑名 / 歌手名'} /><button className="button primary" type="submit" disabled={searching || !ready}>{searching ? '搜索中…' : '搜索'}</button></form>
      <div className="toolbar online-sources">{sources.map(([value, label]) => <button className={`button ${selectedSources.includes(value) ? 'online-source-active' : ''}`} aria-pressed={selectedSources.includes(value)} key={value} onClick={() => setSelectedSources(items => items.includes(value) ? items.filter(item => item !== value) : [...items, value])}>{label}</button>)}<button className="button" onClick={() => setSelectedSources(selectedSources.length === sources.length ? [] : sources.map(([value]) => value))}>{selectedSources.length === sources.length ? '清空' : '全选'}</button></div>
      {preview?.original?._freeMusicPreview && <div className="card row online-preview-card"><Cover src={preview.cover} size={40} /><div className="online-song-info"><strong>正在试听：{preview.name}</strong><p className="muted">{preview.artist} · {preview.source}</p></div><button className="button" onClick={() => void action(preview.original, 'switch')}>试听换源</button><button className="button primary" disabled={inLibrary(preview.original) || busy[songKey(preview.original)] === 'save'} onClick={() => void action(preview.original, 'save')}>{inLibrary(preview.original) ? '已添加到歌库' : '保存正在试听的歌曲'}</button></div>}
      {message && <p role="status">{message}</p>}{detail && <div className="toolbar"><button className="button" onClick={() => { requestId.current++; setDetail(null); setSearching(false); setPage(1); setMessage(''); }}>返回搜索结果</button><h3>{detail.name}</h3><span className="badge">{detail.source}</span></div>}
      {(detail || lastSearch?.type === 'song') ? <div className="online-song-list">{currentSongs.map((song, position) => <SongResult key={`${songKey(song)}:${position}`} song={song} index={(page - 1) * pageSize + position} busy={busy[songKey(song)] || ''} onPlay={() => void action(song, 'play')} onSave={() => void action(song, 'save')} onSwitch={() => void action(song, 'switch')} />)}</div> : <div className="grid online-playlists">{collections.slice((page - 1) * pageSize, page * pageSize).map(collection => <button className="card online-playlist" key={`${collection.source}:${collection.id}`} onClick={() => void openCollection(collection)}><Cover src={collection.cover} size={100} name={collection.name} /><strong>{collection.name}</strong><small className="muted">{collection.creator} · {collection.source} {collection.trackCount ? `· ${collection.trackCount} 首` : ''}</small></button>)}</div>}
      {resultsLength > 0 && <div className="toolbar"><button className="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} / {pageCount} 页</span><button className="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
      {!detail && lastSearch && <div className="toolbar"><button className="button" disabled={searching || serverPage <= 1} onClick={() => void search(serverPage - 1)}>上一批搜索</button><span className="muted">搜索批次 {serverPage}</span><button className="button" disabled={searching || !ready || !resultsLength} onClick={() => void search(serverPage + 1)}>下一批搜索</button></div>}
      {!lastSearch && !searching && <div className="empty">选择平台，搜索你想听的音乐。</div>}
    </section>
  </div>;
}
