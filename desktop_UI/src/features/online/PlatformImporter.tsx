import { useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge, subscribe } from '../../api';
import { useAppStore } from '../../store';
import { playerService } from '../../services/player';
import { confirmAction, notify } from '../../ui';
import type { PreviewSong } from '../../types';
import AccountLogin from './AccountLogin';
import { Cover, Progress, SongTags, durationLabel, inLibrary, overwriteAll, platforms, songMeta, stages, type Platform, type RemotePlaylist, type RemoteSong } from './common';

interface PlaylistState { created: RemotePlaylist[]; collected: RemotePlaylist[] }
const emptyPlaylists: PlaylistState = { created: [], collected: [] };
function normalizePlaylist(value: any, platform: Platform): RemotePlaylist {
  return { id: platform === 'kugou' ? value.listid : value.id, title: value.title || value.name || '未知歌单', cover: String(value.cover || value.pic || value.create_user_pic || '').replace('{size}', '200'), count: Number(value.count_tracks || value.count || 0), original: value };
}

export default function PlatformImporter({ platform }: { platform: Platform }) {
  const config = platforms[platform];
  const api = () => getBridge(`${platform}API`);
  const [user, setUser] = useState<Record<string, any> | null>(null);
  const userRef = useRef<Record<string, any> | null>(null);
  const [accounts, setAccounts] = useState<Record<string, any>[]>([]);
  const [showLogin, setShowLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playlists, setPlaylists] = useState<PlaylistState>(emptyPlaylists);
  const [playlistTab, setPlaylistTab] = useState<'created' | 'collected'>('created');
  const [playlistPage, setPlaylistPage] = useState(1);
  const [morePlaylists, setMorePlaylists] = useState(false);
  const [current, setCurrent] = useState<RemotePlaylist | null>(null);
  const currentRef = useRef<RemotePlaylist | null>(null);
  const [tracks, setTracks] = useState<RemoteSong[]>([]);
  const tracksRef = useRef<RemoteSong[]>([]);
  const cursor = useRef('');
  const hasMore = useRef(false);
  const [moreTracks, setMoreTracks] = useState(false);
  const [trackPage, setTrackPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quality, setQuality] = useState(config.quality);
  const [strategy, setStrategy] = useState<'skip' | 'overwrite' | 'ask'>('skip');
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const abort = useRef(false);
  const [rowStatus, setRowStatus] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState({ text: '', pct: 0 });
  const requestId = useRef(0);
  const previewRequest = useRef(0);
  const songs = useAppStore(state => state.songs);
  void songs;
  async function fetchPlaylists(nextPage = 1, owner = userRef.current) {
    if (!owner) return;
    const result = platform === 'qishui' ? await api().getPlaylists(owner.aid, owner.sessionid) : platform === 'netease' ? await api().userPlaylists(nextPage, 100) : await api().playlists(nextPage, 100);
    if (!result.ok) throw new Error(result.message || '无法读取歌单');
    let next: PlaylistState;
    if (platform === 'kugou') {
      const values = Array.isArray(result.data?.info) ? result.data.info : [];
      next = { created: values.map((item: any) => normalizePlaylist(item, platform)), collected: [] };
      const total = Number(result.data?.count || result.data?.total || 0);
      setMorePlaylists(total ? nextPage * 100 < total : values.length >= 100);
    } else {
      const body = platform === 'qishui' ? result : result.data;
      next = { created: (Array.isArray(body?.created) ? body.created : []).map((item: any) => normalizePlaylist(item, platform)), collected: (Array.isArray(body?.collected) ? body.collected : []).map((item: any) => normalizePlaylist(item, platform)) };
      setMorePlaylists(platform === 'netease' && !!body?.more);
    }
    setPlaylists(value => nextPage === 1 ? next : { created: [...value.created, ...next.created], collected: [...value.collected, ...next.collected] });
    setPlaylistPage(nextPage);
  }
  async function refresh() {
    const run = ++requestId.current;
    setLoading(true); setError(''); setCurrent(null); currentRef.current = null; tracksRef.current = []; setTracks([]); setSelected(new Set()); setRowStatus({});
    try {
      const [login, saved] = await Promise.all([api().loginStatus(), api().listAccounts()]);
      if (run !== requestId.current) return;
      const nextUser = login.ok && login.loggedIn ? login.userInfo : null;
      userRef.current = nextUser; setUser(nextUser);
      const list = Array.isArray(saved.accounts) ? saved.accounts.map((account: any) => ({ ...account, current: account.current || String(account.userid) === String(saved.currentUserId) })) : [];
      setAccounts(list); setShowLogin(!nextUser && !list.length);
      if (login.needRelogin && login.message) notify(login.message, 'error');
      if (nextUser) await fetchPlaylists(1, nextUser); else setPlaylists(emptyPlaylists);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { if (run === requestId.current) setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    const method = platform === 'qishui' ? 'onImportProgress' : 'onDownloadProgress';
    const off = subscribe(`${platform}API`, method, (event: any) => {
      if (runningRef.current) setProgress(value => ({ text: `${value.text.split(' · ')[0]} · ${stages[event.stage] || event.stage || ''} ${Math.round(event.pct || 0)}%`, pct: event.pct || 0 }));
    });
    return () => { requestId.current++; previewRequest.current++; abort.current = true; off(); };
  }, [platform]);
  async function accountAction(action: 'switch' | 'remove' | 'logout', account?: Record<string, any>) {
    if (runningRef.current) return;
    if (action === 'remove' && !await confirmAction({ title: '删除已保存账号', message: `删除 ${account?.nickname || account?.userid} 后，需重新登录。`, confirmText: '删除', danger: true })) return;
    setLoading(true);
    try {
      const result = action === 'switch' ? await api().switchAccount(account?.userid) : action === 'remove' ? await api().removeAccount(account?.userid) : await api().logout();
      if (!result.ok) throw new Error(result.message || '操作失败');
      await refresh();
    } catch (failure) { notify(errorMessage(failure), 'error'); setLoading(false); }
  }
  async function fetchTrackPage(playlist = currentRef.current, first = false): Promise<RemoteSong[]> {
    const owner = userRef.current;
    if (!playlist || !owner) return [];
    const run = requestId.current;
    const result = platform === 'qishui' ? await api().getPlaylistDetail(owner.aid, owner.sessionid, playlist.id, first ? '' : cursor.current) : platform === 'netease' ? await api().playlistTracks(playlist.id) : await api().tracks(playlist.id);
    if (!result.ok) throw new Error(result.message || '无法读取曲目');
    if (run !== requestId.current || currentRef.current?.id !== playlist.id) return tracksRef.current;
    const body = platform === 'qishui' ? result : result.data;
    const values: RemoteSong[] = Array.isArray(body?.songs) ? body.songs : [];
    cursor.current = String(body?.next_cursor || ''); hasMore.current = platform === 'qishui' && !!body?.has_more; setMoreTracks(hasMore.current);
    const next = first ? values : [...tracksRef.current, ...values]; tracksRef.current = next; setTracks(next);
    return next;
  }
  async function openPlaylist(playlist: RemotePlaylist) {
    if (runningRef.current) return;
    const run = ++requestId.current;
    currentRef.current = playlist; setCurrent(playlist); tracksRef.current = []; setTracks([]); setSelected(new Set()); setRowStatus({}); setTrackPage(1); cursor.current = ''; hasMore.current = false; setLoading(true); setError('');
    try { await fetchTrackPage(playlist, true); } catch (failure) { if (run === requestId.current) setError(errorMessage(failure)); }
    finally { if (run === requestId.current) setLoading(false); }
  }
  async function loadMore() {
    if (loading || runningRef.current) return;
    setLoading(true); setError('');
    try { await fetchTrackPage(); } catch (failure) { setError(errorMessage(failure)); } finally { setLoading(false); }
  }
  async function importOne(song: RemoteSong, overwrite: boolean) {
    const owner = userRef.current;
    if (!owner) throw new Error('请先登录');
    if (platform === 'qishui') {
      const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
      const vid = song.vid || song.videoId || '';
      if (!song.id && !vid) throw new Error('缺少歌曲 ID 或视频 ID');
      return api().importSong(owner.aid, owner.sessionid, song.id || '', quality, song, mediaType, vid);
    }
    if (platform === 'netease') {
      if (!song.id) throw new Error('缺少歌曲 ID');
      return api().importSong(song.id, quality, song, overwrite ? overwriteAll : null);
    }
    if (!song.hash) throw new Error('缺少歌曲 hash');
    return api().importSong(song, quality, overwrite ? overwriteAll : null);
  }
  async function runImport(mode: 'all' | 'selected' | 'single', singleIndex?: number) {
    if (runningRef.current || loading) return;
    runningRef.current = true; setRunning(true); abort.current = false; setError('');
    let added = 0; let skipped = 0; let failed = 0;
    try {
      if (mode === 'all' && platform === 'qishui') {
        let guard = 0;
        while (hasMore.current && !abort.current && guard++ < 500) {
          const previousCursor = cursor.current;
          setProgress({ text: `正在加载整个歌单，已加载 ${tracksRef.current.length} 首`, pct: 0 });
          await fetchTrackPage();
          if (hasMore.current && cursor.current === previousCursor) throw new Error('歌单分页没有前进，请刷新后重试');
          if (hasMore.current) await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      if (abort.current) return;
      const indices = mode === 'single' ? [singleIndex!] : mode === 'selected' ? [...selected].sort((a, b) => a - b) : tracksRef.current.map((_, index) => index);
      if (!indices.length) { notify('请先选择要导入的歌曲'); return; }
      const exists = indices.filter(index => inLibrary(tracksRef.current[index], platform));
      let overwrite = strategy === 'overwrite';
      if (exists.length && (strategy === 'ask' || mode === 'single')) overwrite = await confirmAction({ title: '歌库中已有歌曲', message: `本次 ${indices.length} 首中有 ${exists.length} 首已存在。覆盖这些歌曲的文件？取消将跳过已存在的歌曲。`, confirmText: '覆盖已有歌曲', danger: true });
      for (let position = 0; position < indices.length; position++) {
        if (abort.current) break;
        const index = indices[position]; const song = tracksRef.current[index];
        if (!song) continue;
        const name = songMeta(song, platform).name;
        if (!overwrite && inLibrary(song, platform)) { skipped++; setRowStatus(value => ({ ...value, [index]: '已跳过' })); continue; }
        setProgress({ text: `[${position + 1}/${indices.length}] ${name}`, pct: 0 });
        setRowStatus(value => ({ ...value, [index]: '导入中…' }));
        try {
          const result = await importOne(song, overwrite);
          if (!result?.ok) throw new Error(result?.message || '导入失败');
          added++; setRowStatus(value => ({ ...value, [index]: '已导入' }));
          if (result.info?._neteaseMeta?.previewHits?.length) notify('此歌曲可能是试听版本，重新登录后可再次导入', 'error');
        } catch (failure) { failed++; setRowStatus(value => ({ ...value, [index]: `失败：${errorMessage(failure)}` })); }
        setProgress({ text: `[${position + 1}/${indices.length}] ${name}`, pct: ((position + 1) / indices.length) * 100 });
      }
      if (added) await useAppStore.getState().reloadSongs();
      const summary = `导入 ${added} 首，跳过 ${skipped} 首，失败 ${failed} 首${abort.current ? '（已停止）' : ''}`;
      setProgress({ text: summary, pct: 100 }); notify(summary, failed ? 'error' : 'success');
    } catch (failure) { notify(errorMessage(failure), 'error'); setError(errorMessage(failure)); }
    finally { runningRef.current = false; setRunning(false); }
  }
  async function resolvePreview(song: RemoteSong): Promise<PreviewSong> {
    const owner = userRef.current;
    if (!owner) throw new Error('请先登录');
    const meta = songMeta(song, platform);
    const mediaType = song.mediaType || (song.isVideo || song.isUgcClip ? 'video' : 'track');
    const result = platform === 'qishui' ? await api().preview(owner.aid, owner.sessionid, song.id || '', 'standard', mediaType, meta, song.vid || song.videoId || '') : platform === 'netease' ? await api().preview(song.id, 'standard') : await api().preview(song, '128');
    if (!result?.ok) throw new Error(result?.message || '试听失败');
    const data = result.data || {};
    if (!data.url) throw new Error('未获取到试听地址');
    if (data.vipWarning) notify(data.vipWarning, 'error');
    return { name: data.title || data.meta?.title || meta.name, artist: data.artist || data.meta?.artist || meta.artist, url: data.url, cover: meta.cover || data.cover || data.meta?.cover, lyric: data.krc || data.rawText || data.lrc || data.lrcText || '', mediaType: data.isVideo ? 'video' : 'audio', source: platform, original: song,
      onSave: async () => { const existing = inLibrary(song, platform); if (existing && !await confirmAction({ title: '歌曲已在歌库中', message: `覆盖 ${meta.name} 的本地文件？`, confirmText: '覆盖', danger: true })) return; const response = await importOne(song, existing); if (!response?.ok) throw new Error(response?.message || '保存失败'); await useAppStore.getState().reloadSongs(); notify('已保存到歌库', 'success'); },
    };
  }
  async function preview(index: number) {
    const run = ++previewRequest.current;
    const song = tracksRef.current[index]; if (!song) return;
    try {
      const queue: PreviewSong[] = tracksRef.current.map(item => ({ ...songMeta(item, platform), url: '', source: platform, original: item, resolve: () => resolvePreview(item) }));
      await playerService.playPreview({ ...queue[index], queue });
    } catch (failure) { if (run === previewRequest.current) notify(`试听失败：${errorMessage(failure)}`, 'error'); }
  }
  async function copyName(song: RemoteSong) { try { await navigator.clipboard.writeText(songMeta(song, platform).name); notify('已复制歌曲名称', 'success'); } catch { notify('复制失败', 'error'); } }
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(tracks.length / pageSize));
  const pageTracks = tracks.slice((trackPage - 1) * pageSize, trackPage * pageSize);
  const allSelected = tracks.length > 0 && selected.size === tracks.length;
  const toggle = (index: number, included: boolean) => setSelected(value => { const next = new Set(value); if (included) next.add(index); else next.delete(index); return next; });
  return <section className="panel">
    <div className="toolbar"><h2>{config.name}</h2><button className="button" disabled={loading || running} onClick={() => void refresh()}>刷新账号与歌单</button>{user && <><Cover src={user.pic} size={36} /><strong>{user.nickname || '已登录'}</strong>{user.vipType || user.vip_type ? <span className="badge">VIP</span> : null}<button className="button" disabled={running || loading} onClick={() => void accountAction('logout')}>退出当前账号</button></>}</div>
    <details className="card" open={!user || showLogin}><summary>账号管理 · {accounts.length} 个已保存账号</summary><div className="online-account-list">{accounts.map(account => <div className="row" key={account.userid}><Cover src={account.pic} size={36} /><div className="online-song-info"><strong>{account.nickname || account.userid}</strong><small className="muted"> ID: {account.userid}</small></div>{account.current && <span className="badge">当前</span>}<button className="button" disabled={running || loading || account.current} onClick={() => void accountAction('switch', account)}>切换</button><button className="button danger" disabled={running || loading} onClick={() => void accountAction('remove', account)}>删除</button></div>)}</div><button className="button" disabled={running} onClick={() => setShowLogin(true)}>添加账号</button></details>
    {showLogin && <AccountLogin platform={platform} onSuccess={async () => { await refresh(); setShowLogin(false); notify('登录成功', 'success'); }} onClose={() => setShowLogin(false)} canClose={!!user || accounts.length > 0} />}
    {error && <p className="error-text" role="alert">{error}</p>}
    {loading && <p role="status" className="muted">加载中…</p>}
    {user && !current && <><div className="toolbar">{platform !== 'kugou' && <><button className={`button ${playlistTab === 'created' ? 'primary' : ''}`} onClick={() => setPlaylistTab('created')}>创建的歌单 ({playlists.created.length})</button><button className={`button ${playlistTab === 'collected' ? 'primary' : ''}`} onClick={() => setPlaylistTab('collected')}>收藏的歌单 ({playlists.collected.length})</button></>}</div><div className="grid online-playlists">{playlists[playlistTab].map(playlist => <button className="card online-playlist" key={playlist.id} onClick={() => void openPlaylist(playlist)}><Cover src={playlist.cover} name={playlist.title} size={100} /><strong>{playlist.title}</strong><small className="muted">{playlist.count} 首</small></button>)}</div>{!loading && !playlists[playlistTab].length && <p className="empty">暂无歌单</p>}{morePlaylists && <button className="button" disabled={loading} onClick={() => { setLoading(true); void fetchPlaylists(playlistPage + 1).catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false)); }}>加载更多歌单</button>}</>}
    {current && <><div className="toolbar"><button className="button" disabled={running} onClick={() => { requestId.current++; currentRef.current = null; setCurrent(null); setLoading(false); setError(''); }}>返回歌单</button><h3>{current.title}</h3><span className="muted">已加载 {tracks.length} 首{moreTracks ? '，还有更多' : ''}</span></div><div className="toolbar"><label className="row"><input type="checkbox" checked={allSelected} disabled={running} onChange={() => setSelected(allSelected ? new Set() : new Set(tracks.map((_, index) => index)))} />全选已加载歌曲</label><label className="row">音质<select className="field" value={quality} disabled={running} onChange={event => setQuality(event.target.value)}>{config.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="row">已有歌曲<select className="field" value={strategy} disabled={running} onChange={event => setStrategy(event.target.value as typeof strategy)}><option value="skip">跳过</option><option value="overwrite">覆盖</option><option value="ask">导入时询问</option></select></label><button className="button" disabled={running || loading || !selected.size} onClick={() => void runImport('selected')}>导入选中 ({selected.size})</button><button className="button primary" disabled={running || loading || (!tracks.length && !moreTracks)} onClick={() => void runImport('all')}>导入全部</button>{running && <button className="button danger" onClick={() => { abort.current = true; }}>停止后续导入</button>}</div>
      <div className="online-song-list">{pageTracks.map((song, position) => { const index = (trackPage - 1) * pageSize + position; const meta = songMeta(song, platform); const status = rowStatus[index]; return <div className="card row" key={`${song.id || song.hash}:${index}`}><input type="checkbox" aria-label={`选择 ${meta.name}`} checked={selected.has(index)} disabled={running} onChange={event => toggle(index, event.target.checked)} /><button className="online-cover-button" aria-label={`试听 ${meta.name}`} onClick={() => void preview(index)}><Cover src={meta.cover} /></button><div className="online-song-info"><button className="online-song-title" onClick={() => void preview(index)}>{meta.name}</button><p className="muted">{meta.artist} {meta.album && `· ${meta.album}`}</p><div className="row"><SongTags song={song} existing={inLibrary(song, platform)} /></div>{status && <small className={status.startsWith('失败') ? 'error-text' : 'muted'}>{status}</small>}</div><span className="muted">{durationLabel(song, platform)}</span><button className="button" disabled={running || loading} onClick={() => void runImport('single', index)}>{status === '导入中…' ? status : '导入'}</button><button className="button" onClick={() => void copyName(song)}>复制名称</button></div>; })}</div>
      {!loading && !tracks.length && <p className="empty">歌单中没有歌曲</p>}<div className="toolbar"><button className="button" disabled={trackPage <= 1} onClick={() => setTrackPage(value => value - 1)}>上一页</button><span>第 {trackPage} / {pageCount} 页</span><button className="button" disabled={trackPage >= pageCount} onClick={() => setTrackPage(value => value + 1)}>下一页</button>{moreTracks && <button className="button" disabled={loading || running} onClick={() => void loadMore()}>加载更多曲目</button>}</div>
    </>}
    {progress.text && <Progress {...progress} />}
  </section>;
}
