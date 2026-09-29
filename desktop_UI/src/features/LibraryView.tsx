import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../api';
import { useAppStore } from '../store';
import { confirmAction, formatTime, notify, promptText } from '../ui';
import { playerService } from '../services/player';
import type { Song } from '../types';
import Icon from '../components/Icon';
import Cover from '../components/Cover';

type Entry = { type: 'song'; song: Song } | { type: 'artist'; artist: string; count: number };
const SongRow = memo(function SongRow({ song, queue, onChooseCollection }: { song: Song; queue: Song[]; onChooseCollection: (song: Song) => void }) {
  const current = useAppStore(state => state.player.song?.audioPath === song.audioPath);
  const liked = useAppStore(state => state.collections.some(c => c.songs.includes(song.audioPath)));
  const disliked = useAppStore(state => state.dislikes[song.audioPath] !== undefined);
  const duration = useAppStore(state => state.actualDuration[song.audioPath] || song.realDuration || song.duration || 0);
  const play = () => { void playerService.playSong(song, queue).catch(error => notify(errorMessage(error), 'error')); };
  return <div className={`song-row ${current ? 'current' : ''}`} onDoubleClick={play}>
    <button className="song-main" onClick={play} title={`播放 ${song.songName}`}><Cover path={song.coverPath} /><span className="song-meta"><strong>{song.songName}</strong><span>{song.artist}{song.album ? ` · ${song.album}` : ''}</span></span></button>
    <span className="song-duration">{formatTime(duration)}</span>
    <button className={`icon-button ${liked ? 'active' : ''}`} aria-label={liked ? `编辑 ${song.songName} 的收藏歌单` : `收藏 ${song.songName}`} onClick={() => onChooseCollection(song)}><Icon name="heart" /></button>
    <button className="icon-button" aria-label={`添加 ${song.songName} 到歌单`} onClick={() => onChooseCollection(song)}><Icon name="plus" /></button>
    <button className={`icon-button ${disliked ? 'active' : ''}`} title="不推荐" aria-label={`不推荐 ${song.songName}`} onClick={() => useAppStore.getState().toggleDislike(song.audioPath)}><Icon name="dislike" style={{ transform: 'rotate(180deg)' }} /></button>
    <button className="icon-button" title="分享" aria-label={`分享 ${song.songName}`} onClick={() => { useAppStore.setState({ shareSelection: [song.audioPath] }); useAppStore.getState().setView('playlist'); }}><Icon name="share" /></button>
  </div>;
});

export default function LibraryView() {
  const view = useAppStore(state => state.view);
  const songs = useAppStore(state => state.songs);
  const collections = useAppStore(state => state.collections);
  const dislikes = useAppStore(state => state.dislikes);
  const likeTimes = useAppStore(state => state.likeTimes);
  const collectionId = useAppStore(state => state.activeCollectionId);
  const artistMode = useAppStore(state => state.settings.artistGroupMode);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [pickerSong, setPickerSong] = useState<Song | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const viewport = useRef<HTMLDivElement>(null);
  const collection = collections.find(c => c.id === collectionId);
  const showCollections = view === 'liked' && !collection;
  const filtered = useMemo(() => {
    let result = songs.filter(song => view !== 'home' || dislikes[song.audioPath] === undefined);
    if (view === 'liked') result = result.filter(song => collection?.songs.includes(song.audioPath)).sort((a,b) => (likeTimes[b.audioPath] || 0) - (likeTimes[a.audioPath] || 0));
    if (search) result = result.filter(song => `${song.songName} ${song.artist} ${song.album || ''}`.toLowerCase().includes(search));
    return result;
  }, [songs, view, collection, dislikes, likeTimes, search]);
  const entries = useMemo<Entry[]>(() => {
    if (!grouped) return filtered.map(song => ({ type: 'song', song }));
    const buckets = new Map<string, Song[]>();
    for (const song of filtered) {
      const artists = artistMode === 'split' ? [...new Set(song.artist.replace(/\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+/gi, '|').split(/[、,，;；|\/／&＆]/).map(a => a.trim()).filter(Boolean))] : [song.artist || '未知艺人'];
      for (const artist of artists.length ? artists : ['未知艺人']) buckets.set(artist, [...(buckets.get(artist) || []), song]);
    }
    return [...buckets.entries()].sort(([a],[b]) => a.localeCompare(b,'zh')).flatMap(([artist, group]) => [{ type: 'artist', artist, count: group.length } as Entry, ...(!collapsed.has(artist) ? group.map(song => ({ type: 'song', song } as Entry)) : [])]);
  }, [grouped, filtered, artistMode, collapsed]);
  useEffect(() => { setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0; }, [search, view, collectionId, grouped]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(records => setHeight(records[0].contentRect.height));
    observer.observe(viewport.current); return () => observer.disconnect();
  }, [showCollections]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerSong(null); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown',close); }, []);
  const create = async () => {
    const value = await promptText({ title: '新建歌单', defaultValue: '新建歌单', allowEmpty: true, confirmText: '创建' });
    if (value === null) return;
    let name = value || '新建歌单'; let counter = 2; const base = name;
    while (collections.some(c => c.name === name)) name = `${base} ${counter++}`;
    useAppStore.getState().createCollection(name);
    useAppStore.setState({ activeCollectionId: null }); useAppStore.getState().setView('liked'); notify(`已创建歌单：${name}`, 'success');
  };
  const rename = async (id: string, name: string) => { const value = await promptText({ title: '重命名歌单', defaultValue: name }); if (value) useAppStore.getState().renameCollection(id,value); };
  const remove = async (id: string, name: string) => { if (await confirmAction({ title: '删除歌单', message: `删除「${name}」？歌曲文件会保留。`, danger: true })) useAppStore.getState().deleteCollection(id); };
  const start = Math.max(0, Math.floor(scrollTop / 64) - 5);
  const end = Math.min(entries.length, Math.ceil((scrollTop + height) / 64) + 5);
  return <section className="library-page panel">
    <header className="page-header"><div className="row">{collection && <button className="icon-button" aria-label="返回歌单" onClick={() => useAppStore.setState({ activeCollectionId: null })}><Icon name="back" /></button>}<div><h1>{showCollections ? '我的歌单' : collection?.name || (view === 'home' ? '推荐' : '音乐列表')}</h1><p className="muted">{showCollections ? `${collections.length} 个歌单` : `${filtered.length} 首歌曲`}</p></div></div>
      <div className="toolbar"><button onClick={() => { void useAppStore.getState().reloadSongs().then(() => notify('歌库已刷新','success')).catch(error => notify(errorMessage(error),'error')); }} aria-label="刷新歌库"><Icon name="refresh" />刷新</button><button className="primary" onClick={() => void create()}><Icon name="plus" />新建歌单</button></div>
    </header>
    {showCollections ? <div className="collection-grid">{collections.map(item => <article className="collection-card card" key={item.id}>
      <button className="collection-open" onClick={() => useAppStore.setState({ activeCollectionId: item.id })}><Cover path={songs.find(song => item.songs.includes(song.audioPath))?.coverPath} /><strong>{item.name}</strong><span className="muted">{item.songs.length} 首歌曲</span></button>
      <div className="toolbar"><button onClick={() => void rename(item.id,item.name)}>重命名</button><button onClick={() => { useAppStore.setState({ shareSelection: item.songs }); useAppStore.getState().setView('playlist'); }}>分享</button><button className="danger" onClick={() => void remove(item.id,item.name)}>删除</button></div>
    </article>)}{!collections.length && <div className="empty">创建歌单，把喜欢的音乐收在一起。</div>}</div> : <>
      <div className="toolbar library-tools"><label className="search-box"><Icon name="search" /><input aria-label="搜索本地歌曲" placeholder="搜索歌曲、歌手或专辑…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className={grouped ? 'active' : ''} onClick={() => setGrouped(!grouped)}><Icon name="group" />按歌手分组</button><button disabled={!filtered.length} onClick={() => void playerService.playSong(filtered[0],filtered)}><Icon name="play" />播放全部</button></div>
      <div className="song-viewport" ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}><div style={{ height: entries.length * 64, position: 'relative' }}>
        {entries.slice(start,end).map((entry,index) => <div style={{ position: 'absolute', top: (start+index)*64, height:64, left:0, right:0 }} key={entry.type === 'artist' ? `artist:${entry.artist}` : `song:${start+index}:${entry.song.audioPath}`}>
          {entry.type === 'artist' ? <button className="artist-header" onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(entry.artist) ? next.delete(entry.artist) : next.add(entry.artist); return next; })}>{collapsed.has(entry.artist) ? '▸' : '▾'} {entry.artist}<span className="badge">{entry.count}</span></button> : <SongRow song={entry.song} queue={filtered} onChooseCollection={setPickerSong} />}
        </div>)}
      </div>{!filtered.length && <div className="empty">{query ? '没有找到匹配的歌曲' : '暂无歌曲，可从音乐导入或免费听音乐添加。'}</div>}</div>
    </>}
    {pickerSong && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPickerSong(null); }}><div className="modal-card" role="dialog" aria-modal="true" aria-label="选择歌单"><h2>添加到歌单</h2><p className="muted">{pickerSong.songName}</p><div className="picker-list">{collections.map(item => <label className="row card" key={item.id}><input type="checkbox" checked={item.songs.includes(pickerSong.audioPath)} onChange={event => useAppStore.getState().setCollectionSong(item.id,pickerSong.audioPath,event.target.checked)} />{item.name}<span className="muted">{item.songs.length} 首</span></label>)}</div><div className="toolbar end"><button onClick={() => void create()}>新建歌单</button><button className="primary" onClick={() => setPickerSong(null)}>完成</button></div></div></div>}
  </section>;
}
