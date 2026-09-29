import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, getBridge, subscribe } from '../api';
import { useAppStore } from '../store';
import { playerService } from '../services/player';
import { confirmAction, formatTime, notify } from '../ui';
import type { PreviewSong } from '../types';
import SharedPlaylistCard, { copyShareText } from './SharedPlaylistCard';
import { collectSharingSongs, remoteDownloadProgress, shareExpiry, shareUsage } from './playlist-data';
import type { AccessLog, RemotePlaylistSong, ServerStatus, SharedPlaylist } from './playlist-data';
import './utility-features.css';

const expiries = [{ value: 3600000, label: '1 小时' }, { value: 86400000, label: '1 天' }, { value: 604800000, label: '7 天' }, { value: 2592000000, label: '30 天' }, { value: 0, label: '永久' }];
const uses = [{ value: 1, label: '1 次' }, { value: 5, label: '5 次' }, { value: 30, label: '30 次' }, { value: 0, label: '不限' }];

export default function PlaylistView() {
  const songs = useAppStore(state => state.songs);
  const collections = useAppStore(state => state.collections);
  const settings = useAppStore(state => state.settings);
  const shareSelection = useAppStore(state => state.shareSelection);
  const view = useAppStore(state => state.view);
  const currentPreview = useAppStore(state => state.player.preview);
  const playing = useAppStore(state => state.player.playing);
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [explicitPaths, setExplicitPaths] = useState<Set<string>>(() => new Set(shareSelection));
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState(-1);
  const [maxUses, setMaxUses] = useState(-1);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<SharedPlaylist | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [records, setRecords] = useState<SharedPlaylist[]>([]);
  const [recordLimit, setRecordLimit] = useState(10);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [link, setLink] = useState('');
  const [key, setKey] = useState('');
  const [parseBusy, setParseBusy] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [remoteSongs, setRemoteSongs] = useState<RemotePlaylistSong[]>([]);
  const [remoteName, setRemoteName] = useState('');
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());
  const [remoteLimit, setRemoteLimit] = useState(100);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const downloadedRef = useRef(new Set<string>());
  const [downloadBusy, setDownloadBusy] = useState(false);
  const downloadBusyRef = useRef(false);
  const progressDispose = useRef<(() => void) | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [logsEnabled, setLogsEnabled] = useState(false);
  const [logsStatus, setLogsStatus] = useState('');

  useEffect(() => {
    if (!shareSelection.length) return;
    setExplicitPaths(new Set(shareSelection)); setSources(new Set()); setExcludedPaths(new Set());
  }, [shareSelection]);
  const exportSongs = useMemo(() => collectSharingSongs(songs, collections, sources, explicitPaths, excludedPaths), [songs, collections, sources, explicitPaths, excludedPaths]);
  const libraryPaths = useMemo(() => new Set(songs.map(song => song.audioPath)), [songs]);
  const sourceNames = [...sources].map(id => id === 'all' ? '全部歌曲' : collections.find(collection => collection.id === id)?.name).filter(Boolean);
  const autoName = sourceNames.length ? sourceNames.join(' + ') : exportSongs.length === 1 ? exportSongs[0].songName : '精选歌单';

  const refresh = useCallback(async () => {
    setRecordsLoading(true); setRecordError('');
    const results = await Promise.allSettled([getBridge('playlistAPI').serverStatus(), getBridge('playlistAPI').listSharedPlaylists()]);
    const statusResult = results[0];
    if (statusResult.status === 'fulfilled' && statusResult.value?.ok) setServer(statusResult.value);
    else setServer(null);
    const listResult = results[1];
    if (listResult.status === 'fulfilled' && listResult.value?.ok) { setRecords(listResult.value.records || []); setRecordLimit(10); }
    else setRecordError(listResult.status === 'rejected' ? errorMessage(listResult.reason) : listResult.value?.message || '分享记录读取失败');
    setRecordsLoading(false);
  }, []);
  useEffect(() => { if (view === 'playlist') void refresh().catch(error => { setRecordError(errorMessage(error)); setRecordsLoading(false); }); }, [refresh, view]);
  useEffect(() => () => { progressDispose.current?.(); progressDispose.current = null; }, []);

  function toggleSource(id: string) {
    setSources(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
    setExcludedPaths(new Set());
  }

  async function generateShare() {
    if (exportBusy || !exportSongs.length || expiry < 0 || maxUses < 0) return;
    setExportBusy(true);
    try {
      const api = getBridge('playlistAPI');
      const status = await api.serverStatus();
      setServer(status);
      if (!status?.ok || !status.running) throw new Error('请先开启网络服务');
      const playlistName = name.trim() || autoName;
      const result = await api.exportPlaylist(playlistName, exportSongs, expiry === 0 ? 0 : Date.now() + expiry, maxUses,
        settings.publicHostMode === 'manual' ? settings.publicHost.trim() : '', Number(settings.publicPort) || 0);
      if (!result?.ok) throw new Error(result?.message || '分享生成失败');
      setExportResult({ id: result.id, name: playlistName, songCount: exportSongs.length, createdAt: Date.now(),
        shareLink: result.shareLink, key: result.key, expireAt: result.expireAt, maxUses: result.maxUses, usedCount: 0 });
      notify('分享链接已生成', 'success');
      await refresh();
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExportBusy(false); }
  }

  async function destroyShare(record: SharedPlaylist) {
    if (!await confirmAction({ title: '销毁分享', danger: true, confirmText: '销毁分享', message: `确定销毁「${record.name}」吗？原分享链接会立即失效，本地歌曲会保留。` })) return;
    try {
      const result = await getBridge('playlistAPI').deleteSharedPlaylist(record.id);
      if (!result?.ok) throw new Error(result?.message || '分享销毁失败');
      setRecords(previous => previous.filter(entry => entry.id !== record.id));
      setExportResult(previous => previous?.id === record.id ? null : previous);
      notify('分享已销毁', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function exportResultCrt() {
    if (!exportResult?.key || !exportResult.shareLink || exportBusy) return;
    setExportBusy(true);
    try {
      const result = await getBridge('playlistAPI').exportCrt(exportResult.key, exportResult.shareLink, exportResult.name);
      if (result?.ok) notify('CRT 密钥文件已保存', 'success');
      else if (!result?.canceled) throw new Error(result?.message || 'CRT 导出失败');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExportBusy(false); }
  }

  async function toggleServer() {
    if (serverBusy) return;
    setServerBusy(true);
    try {
      const api = getBridge('playlistAPI');
      const current = await api.serverStatus();
      const result = current?.running ? await api.stopServer() : await api.startServer(settings.serverPort, settings.serverBindIP, settings.serverWhitelist, settings.serverRateLimit, settings.serverAccessLog);
      if (!result?.ok) throw new Error(result?.message || '网络服务操作失败');
      useAppStore.getState().setSettings({ serverEnabled: !current?.running });
      await refresh();
      notify(current?.running ? '网络服务已停止' : '网络服务已开启', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setServerBusy(false); }
  }

  async function loadLogs(clear = false) {
    try {
      const api = getBridge('playlistAPI');
      if (clear) { const result = await api.clearAccessLogs(); if (!result?.ok) throw new Error(result?.message || '清空日志失败'); }
      const result = await api.getAccessLogs();
      if (!result?.ok) throw new Error(result?.message || '日志读取失败');
      setLogs(result.logs || []); setLogsEnabled(result.enabled); setLogsStatus(clear ? '日志已清空' : '');
    } catch (error) { setLogsStatus(errorMessage(error)); }
  }

  async function parsePlaylist() {
    if (!link.trim() || !key.trim() || parseBusy || downloadBusyRef.current) return;
    setParseBusy(true); setImportStatus('正在解密并连接远程服务器…'); setRemoteSongs([]);
    try {
      const result = await getBridge('playlistAPI').parseLink(link.trim(), key.trim(), '');
      if (!result?.ok || !Array.isArray(result.songs)) throw new Error(result?.message || '歌单解析失败');
      setRemoteSongs(result.songs); setRemoteName(result.playlistName || '未命名歌单');
      setRemoteSelected(new Set(result.songs.map((song: RemotePlaylistSong) => song.audioUrl))); setRemoteLimit(100);
      downloadedRef.current = new Set(); setDownloaded(new Set()); setDownloadStatus('');
      setImportStatus(`已解析 ${result.songs.length} 首歌曲`);
    } catch (error) { setImportStatus(`解析失败：${errorMessage(error)}`); }
    finally { setParseBusy(false); }
  }

  async function importCrt() {
    if (parseBusy || downloadBusyRef.current) return;
    setParseBusy(true);
    try {
      const result = await getBridge('playlistAPI').importCrt();
      if (result?.ok) { setLink(result.link || ''); setKey(result.key || ''); setImportStatus(`已导入 ${result.name || 'CRT 文件'}，点击解析歌单继续`); }
      else if (!result?.canceled) throw new Error(result?.message || 'CRT 文件无效');
    } catch (error) { setImportStatus(`导入失败：${errorMessage(error)}`); }
    finally { setParseBusy(false); }
  }

  async function downloadSongs(targets: RemotePlaylistSong[]) {
    if (downloadBusyRef.current) throw new Error('已有歌单下载任务正在进行');
    const pending = targets.filter(song => !downloadedRef.current.has(song.audioUrl));
    if (!pending.length) return { done: 0, failed: 0 };
    downloadBusyRef.current = true; setDownloadBusy(true); setDownloadPct(0);
    let current = 0, done = 0, failed = 0, firstError = '';
    try {
      const api = getBridge('playlistAPI');
      progressDispose.current = subscribe('playlistAPI', 'onDownloadProgress', (payload: { stage: string; pct?: number; message?: string }) => {
        if (typeof payload.pct !== 'number' || payload.stage === 'error') return;
        const percent = remoteDownloadProgress(payload.stage, payload.pct);
        setDownloadPct(previous => Math.max(previous, ((current + percent / 100) / pending.length) * 100));
      });
      for (current = 0; current < pending.length; current++) {
        const song = pending[current];
        setDownloadStatus(`下载 ${current + 1} / ${pending.length}：${song.songName}`);
        try {
          const result = await api.downloadSong(song, false);
          if (!result?.ok) throw new Error(result?.message || '下载失败');
          downloadedRef.current.add(song.audioUrl); setDownloaded(new Set(downloadedRef.current)); done++;
        } catch (error) { failed++; if (!firstError) firstError = errorMessage(error); }
        setDownloadPct((current + 1) / pending.length * 100);
      }
      setDownloadStatus(`完成：成功 ${done} 首，失败 ${failed} 首${firstError ? `。${firstError}` : ''}`);
      if (done) await useAppStore.getState().reloadSongs();
      notify(`下载完成：成功 ${done} 首${failed ? `，失败 ${failed} 首` : ''}`, failed ? 'error' : 'success');
      return { done, failed };
    } finally {
      progressDispose.current?.(); progressDispose.current = null;
      downloadBusyRef.current = false; setDownloadBusy(false);
    }
  }
  async function saveSong(song: RemotePlaylistSong) {
    const result = await downloadSongs([song]);
    if (result.failed) throw new Error(`「${song.songName}」下载失败，请查看下载状态`);
  }
  async function previewSong(song: RemotePlaylistSong) {
    if (currentPreview?.source === 'playlist' && currentPreview.url === song.audioUrl) { playerService.toggle(); return; }
    const queue: PreviewSong[] = remoteSongs.map(entry => ({ name: entry.songName, artist: entry.artist, url: entry.audioUrl,
      cover: entry.coverUrl, source: 'playlist', original: entry, onSave: () => saveSong(entry) }));
    const preview = queue.find(entry => entry.url === song.audioUrl);
    if (!preview) return;
    preview.queue = queue;
    try { await playerService.playPreview(preview); }
    catch (error) { notify(`试听失败：${errorMessage(error)}`, 'error'); }
  }
  const selectedDownloads = remoteSongs.filter(song => remoteSelected.has(song.audioUrl) && !downloaded.has(song.audioUrl));
  const allRemoteSelected = remoteSongs.length > 0 && remoteSongs.every(song => remoteSelected.has(song.audioUrl));

  return <section className="panel playlist-page">
    <div className="page-header"><div><h1>歌单分享</h1><p className="muted">分享本地音乐，或连接朋友的曲库试听与下载。</p></div><span className="badge">{server ? server.running ? `服务运行中 · :${server.port}` : '服务未开启' : '服务状态待确认'}</span></div>
    <div className="card">
      <div className="toolbar"><strong>网络服务</strong><span className="muted">{settings.serverBindIP}:{server?.port || settings.serverPort}</span>
        <button className="button" disabled={serverBusy} onClick={() => { void toggleServer(); }}>{serverBusy ? '处理中…' : server?.running ? '停止服务' : '开启服务'}</button>
        <button className="button" onClick={() => useAppStore.getState().setView('settings')}>地址与访问设置</button>
      </div>
      <p className="muted">对外地址：{settings.publicHostMode === 'manual' && settings.publicHost ? `${settings.publicHost}:${settings.publicPort || server?.port || settings.serverPort}` : '自动识别本机地址'}；分享期间请保持应用与网络服务运行。</p>
      <details onToggle={event => { if (event.currentTarget.open) void loadLogs(); }}><summary>访问日志</summary>
        <div className="toolbar"><button className="button" onClick={() => { void loadLogs(); }}>刷新日志</button><button className="button" onClick={() => { void loadLogs(true); }}>清空日志</button></div>
        {!logsEnabled && <p className="muted">访问日志未启用，可在设置中开启。</p>}{logsStatus && <p role="status">{logsStatus}</p>}
        {!logs.length ? <p className="muted">暂无访问记录。</p> : logs.slice(0, 100).map((entry, index) => <div className="row" key={`${entry.ts}-${index}`}><span className="muted">{new Date(entry.ts).toLocaleString()}</span><span>{entry.ip}</span><strong>{entry.action}</strong><span className="muted" title={entry.path}>{entry.detail || entry.path}</span></div>)}
      </details>
    </div>
    <div className="grid">
      <div className="card"><h2>生成新分享</h2><p className="muted">选择歌曲来源，重叠的歌曲会自动去重。</p>
        <div className="toolbar"><label><input type="checkbox" checked={sources.has('all')} onChange={() => toggleSource('all')} /> 全部歌曲（{songs.length}）</label>
          {collections.map(collection => <label key={collection.id}><input type="checkbox" checked={sources.has(collection.id)} onChange={() => toggleSource(collection.id)} /> {collection.name}（{collection.songs.filter(path => libraryPaths.has(path)).length}）</label>)}
        </div>
        {!!explicitPaths.size && <div className="toolbar"><span className="badge">快捷选择 {explicitPaths.size} 首</span><button className="button" onClick={() => setExplicitPaths(new Set())}>清除快捷选择</button></div>}
        <label>歌单名称<input className="field" value={name} onChange={event => setName(event.target.value)} placeholder={autoName} /></label>
        <div className="row"><label>有效期<select className="field" value={expiry} onChange={event => setExpiry(Number(event.target.value))}><option value="-1" disabled>请选择有效期</option>{expiries.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>访问次数<select className="field" value={maxUses} onChange={event => setMaxUses(Number(event.target.value))}><option value="-1" disabled>请选择次数</option>{uses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
        {(exportSongs.length > 0 || excludedPaths.size > 0) && <details><summary>将分享 {exportSongs.length} 首歌曲 · 编辑选择</summary>{exportSongs.map(song => <div className="row" key={song.audioPath}><label><input type="checkbox" checked onChange={() => setExcludedPaths(previous => new Set([...previous, song.audioPath]))} /> {song.songName} · {song.artist}</label></div>)}{!!excludedPaths.size && <button className="button" onClick={() => setExcludedPaths(new Set())}>恢复排除的歌曲（{excludedPaths.size}）</button>}</details>}
        {!exportSongs.length && <p className="muted">请选择歌曲来源。</p>}
        <button className="button primary" disabled={exportBusy || !exportSongs.length || expiry < 0 || maxUses < 0} onClick={() => { void generateShare(); }}>{exportBusy ? '处理中…' : `生成分享链接（${exportSongs.length} 首）`}</button>
        {exportResult && <div className="card"><h3>{exportResult.name} · 分享已生成</h3><p className="muted">{exportResult.songCount} 首 · {shareExpiry(exportResult)} · 访问 {shareUsage(exportResult)}</p>
          <label>分享链接<input className="field" readOnly value={exportResult.shareLink} onFocus={event => event.target.select()} /></label>
          <label>解密密钥<input className="field" readOnly value={exportResult.key} onFocus={event => event.target.select()} /></label>
          <div className="toolbar"><button className="button" onClick={() => { void copyShareText(exportResult.shareLink || ''); }}>复制链接</button><button className="button" onClick={() => { void copyShareText(exportResult.key || ''); }}>复制密钥</button>
            <button className="button" disabled={exportBusy} onClick={() => { void exportResultCrt(); }}>导出 CRT 密钥文件</button><button className="button danger" onClick={() => { void destroyShare(exportResult); }}>销毁此分享</button></div>
        </div>}
      </div>
      <div className="card"><div className="page-header"><h2>已生成的分享</h2><button className="button" disabled={recordsLoading} onClick={() => { void refresh().catch(error => notify(errorMessage(error), 'error')); }}>{recordsLoading ? '加载中…' : '刷新'}</button></div>
        {recordError && <p role="alert">{recordError}</p>}
        {!records.length && !recordsLoading && <div className="empty">尚未生成任何分享。</div>}
        {records.slice(0, recordLimit).map(record => <SharedPlaylistCard key={record.id} record={record} onDelete={destroyShare} />)}
        {recordLimit < records.length && <button className="button" onClick={() => setRecordLimit(value => value + 10)}>加载更多（{recordLimit} / {records.length}）</button>}
      </div>
    </div>
    <div className="card"><h2>导入歌单</h2><div className="toolbar">
      <input className="field" value={link} disabled={parseBusy || downloadBusy} onChange={event => setLink(event.target.value)} placeholder="粘贴 wuu:// 分享链接" aria-label="wuu 分享链接" />
      <input className="field" value={key} disabled={parseBusy || downloadBusy} onChange={event => setKey(event.target.value)} placeholder="解密密钥" aria-label="分享解密密钥" />
      <button className="button primary" disabled={parseBusy || downloadBusy || !link.trim() || !key.trim()} onClick={() => { void parsePlaylist(); }}>{parseBusy ? '处理中…' : '解析歌单'}</button>
      <button className="button" disabled={parseBusy || downloadBusy} onClick={() => { void importCrt(); }}>导入 CRT 文件</button>
    </div>
      {importStatus && <p role="status" className="muted">{importStatus}</p>}
      {!!remoteSongs.length && <><div className="page-header"><h3>{remoteName} · {remoteSongs.length} 首</h3><div className="toolbar">
        <label><input type="checkbox" checked={allRemoteSelected} disabled={downloadBusy} onChange={() => setRemoteSelected(allRemoteSelected ? new Set() : new Set(remoteSongs.map(song => song.audioUrl)))} /> 全选</label>
        <button className="button primary" disabled={downloadBusy || !selectedDownloads.length} onClick={() => { void downloadSongs(selectedDownloads).catch(error => notify(errorMessage(error), 'error')); }}>下载选中（{selectedDownloads.length}）</button>
      </div></div>
        {remoteSongs.slice(0, remoteLimit).map(song => <div className="row" key={song.audioUrl}>
          <input type="checkbox" disabled={downloadBusy} checked={remoteSelected.has(song.audioUrl)} aria-label={`选择${song.songName}`} onChange={() => setRemoteSelected(previous => { const next = new Set(previous); next.has(song.audioUrl) ? next.delete(song.audioUrl) : next.add(song.audioUrl); return next; })} />
          <div style={{ flex: 1 }}><strong>{song.songName}</strong><div className="muted">{song.artist} {song.album ? `· ${song.album}` : ''}</div></div><span className="muted">{song.realDuration ? formatTime(song.realDuration) : ''}</span>
          <button className="button" onClick={() => { void previewSong(song); }}>{currentPreview?.url === song.audioUrl && playing ? '暂停' : '试听'}</button>
          <button className="button" disabled={downloadBusy || downloaded.has(song.audioUrl)} onClick={() => { void saveSong(song).catch(error => notify(errorMessage(error), 'error')); }}>{downloaded.has(song.audioUrl) ? '已下载' : '下载'}</button>
        </div>)}
        {remoteLimit < remoteSongs.length && <button className="button" onClick={() => setRemoteLimit(value => value + 100)}>显示更多（{remoteLimit} / {remoteSongs.length}）</button>}
      </>}
      {downloadStatus && <div role="status"><progress value={downloadPct} max="100" style={{ width: '100%' }} aria-label="歌单下载进度" /><p className="muted">{downloadStatus}</p></div>}
    </div>
  </section>;
}
