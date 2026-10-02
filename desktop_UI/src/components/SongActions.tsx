import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, getBridge } from '../api';
import { useAppStore } from '../store';
import type { Song } from '../types';
import { notify, promptText } from '../ui';
import { normalizeGenres, songGenres } from '../services/listeningStyles';
import { copyShareText } from '../features/SharedPlaylistCard';
import Icon from './Icon';
import PlayerDialog from './PlayerSurface';
import SongPopover from './SongPopover';

const commonGenres = ['流行', '摇滚', '民谣', '电子', '古典', '爵士', '嘻哈', '轻音乐'];

export default function SongActions({ song }: { song: Song }) {
  const collections = useAppStore(state => state.collections);
  const disliked = useAppStore(state => state.dislikes[song.audioPath] !== undefined);
  const genres = useAppStore(state => state.genreOverrides);
  const songs = useAppStore(state => state.songs);
  const settings = useAppStore(state => state.settings);
  const [panel, setPanel] = useState<'collection' | 'share' | 'comment' | null>(null);
  const collectionTrigger = useRef<HTMLButtonElement>(null);
  const shareTrigger = useRef<HTMLButtonElement>(null);
  const commentTrigger = useRef<HTMLButtonElement>(null);
  const genreEntry = useRef<HTMLButtonElement>(null);
  const genreOptions = useRef<HTMLDivElement>(null);
  const statusRequest = useRef(0);
  const [genreMenu, setGenreMenu] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [customGenre, setCustomGenre] = useState('');
  const [share, setShare] = useState<{ shareLink: string; key: string } | null>(null);
  const [shareError, setShareError] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [serverRunning, setServerRunning] = useState<boolean | null>(null);
  const [expiry, setExpiry] = useState(86400000);
  const [uses, setUses] = useState(1);
  const included = collections.some(collection => collection.songs.includes(song.audioPath));
  const saved = songGenres(song, genres);
  const options = useMemo(() => normalizeGenres([...commonGenres, ...songs.flatMap(item => item.genre || []), ...Object.values(genres).flat(), ...draft]), [songs, genres, draft]);
  const close = () => { statusRequest.current++; setPanel(null); };
  useLayoutEffect(() => {
    if (panel !== 'comment') return;
    const target = genreMenu ? genreOptions.current?.querySelector<HTMLInputElement>('input') : genreEntry.current;
    target?.focus({ preventScroll: true });
  }, [panel, genreMenu]);

  async function createCollection() {
    const name = await promptText({ title: '新建歌单', defaultValue: '新建歌单', confirmText: '创建' });
    if (name) { const id = useAppStore.getState().createCollection(name); useAppStore.getState().setCollectionSong(id, song.audioPath, true); }
  }
  async function openShare() {
    const request = ++statusRequest.current;
    setPanel('share'); setShareError(''); setServerRunning(null);
    try {
      const result = await getBridge('playlistAPI').serverStatus();
      if (request === statusRequest.current) setServerRunning(!!result?.ok && !!result.running);
    } catch (error) { if (request === statusRequest.current) setShareError(errorMessage(error)); }
  }
  async function startSharing() {
    setShareBusy(true); setShareError('');
    try {
      const result = await getBridge('playlistAPI').startServer(settings.serverPort, settings.serverBindIP, settings.serverWhitelist, settings.serverRateLimit, settings.serverAccessLog);
      if (!result?.ok) throw new Error(result?.message || '分享服务启动失败');
      useAppStore.getState().setSettings({ serverEnabled: true }); setServerRunning(true);
    } catch (error) { setShareError(errorMessage(error)); }
    finally { setShareBusy(false); }
  }
  async function generateShare() {
    if (shareBusy) return;
    setShareBusy(true); setShareError('');
    try {
      const api = getBridge('playlistAPI'), status = await api.serverStatus();
      if (!status?.ok || !status.running) { setServerRunning(false); throw new Error('请先开启分享服务'); }
      const result = await api.exportPlaylist(song.songName, [song], expiry === 0 ? 0 : Date.now() + expiry, uses,
        settings.publicHostMode === 'manual' ? settings.publicHost.trim() : '', Number(settings.publicPort) || 0);
      if (!result?.ok || !result.shareLink) throw new Error(result?.message || '分享生成失败');
      setShare({ shareLink: result.shareLink, key: result.key || '' });
    } catch (error) { setShareError(errorMessage(error)); }
    finally { setShareBusy(false); }
  }
  function addGenre() {
    const value = customGenre.trim();
    if (!value) return;
    setDraft(previous => normalizeGenres([...previous, value])); setCustomGenre('');
  }

  return <>
    <div className="toolbar player-actions" role="group" aria-label="当前歌曲操作">
      <button ref={collectionTrigger} className={`icon-button collection-entry ${included ? 'active' : ''}`} type="button" title="添加到歌单" aria-label="添加到歌单" aria-haspopup="dialog" aria-expanded={panel === 'collection'} aria-controls="listening-collection-dialog" onClick={() => setPanel('collection')}><Icon name="plus" size={19} /></button>
      <button ref={shareTrigger} className="icon-button" type="button" title="分享当前歌曲" aria-label="分享当前歌曲" aria-haspopup="dialog" aria-expanded={panel === 'share'} aria-controls="song-share-popover" onClick={() => void openShare()}><Icon name="share" size={18} /></button>
      <button className={`icon-button ${disliked ? 'active' : ''}`} type="button" title={disliked ? '取消不喜欢' : '不喜欢'} aria-label={disliked ? '取消不喜欢' : '不喜欢'} aria-pressed={disliked} onClick={() => { useAppStore.getState().toggleDislike(song.audioPath); notify(disliked ? '已取消不喜欢' : '已标记不喜欢，推荐和播放队列将跳过这首歌'); }}><Icon name="dislike" size={18} style={{ transform: 'rotate(180deg)' }} /></button>
      <button ref={commentTrigger} className="icon-button" type="button" title="评论" aria-label="评论" aria-haspopup="dialog" aria-expanded={panel === 'comment'} aria-controls="song-comment-popover" onClick={() => { setDraft(saved.genres); setCustomGenre(''); setGenreMenu(false); setPanel('comment'); }}><Icon name="comment" size={18} /></button>
    </div>
    <PlayerDialog open={panel === 'collection'} onClose={close} label="选择歌单" id="listening-collection-dialog" triggerRef={collectionTrigger}>
      <h2>添加到歌单</h2><p className="muted">{song.songName}</p>
      <div className="picker-list">{collections.map(collection => <label className="row card" key={collection.id}><input type="checkbox" checked={collection.songs.includes(song.audioPath)} onChange={event => useAppStore.getState().setCollectionSong(collection.id, song.audioPath, event.target.checked)} />{collection.name}<span className="muted">{collection.songs.length} 首</span></label>)}</div>
      <div className="toolbar end"><button className="button" onClick={() => void createCollection()}>新建歌单</button><button className="button primary" onClick={close}>完成</button></div>
    </PlayerDialog>
    <SongPopover open={panel === 'share'} onClose={close} label="分享当前歌曲" id="song-share-popover" triggerRef={shareTrigger}>
      <p className="song-popover-title">{song.songName}</p>
      {share ? <div className="song-share-result"><label>分享链接<input className="field" value={share.shareLink} readOnly onFocus={event => event.target.select()} /></label>{share.key && <label>解密密钥<input className="field" value={share.key} readOnly onFocus={event => event.target.select()} /></label>}<div className="toolbar"><button onClick={() => void copyShareText(share.shareLink)}>复制链接</button>{share.key && <button onClick={() => void copyShareText(share.key)}>复制密钥</button>}</div></div> : <>
        <details className="song-share-options"><summary>分享选项</summary><label>有效期<select className="field" value={expiry} onChange={event => setExpiry(Number(event.target.value))}><option value={3600000}>1 小时</option><option value={86400000}>1 天</option><option value={604800000}>7 天</option><option value={0}>永久</option></select></label><label>访问次数<select className="field" value={uses} onChange={event => setUses(Number(event.target.value))}><option value={1}>1 次</option><option value={5}>5 次</option><option value={0}>不限</option></select></label></details>
        {serverRunning === false ? <div className="song-share-off"><p className="muted">分享服务未开启</p><button disabled={shareBusy} onClick={() => void startSharing()}>开启分享服务</button></div> : <button className="button primary" disabled={shareBusy || serverRunning === null} onClick={() => void generateShare()}>{shareBusy ? '正在生成…' : '生成分享'}</button>}
      </>}
      {shareError && <p className="status-error" role="alert">{shareError}</p>}
    </SongPopover>
    <SongPopover open={panel === 'comment'} onClose={close} label="评论" id="song-comment-popover" triggerRef={commentTrigger}>
      <p className="song-popover-title">{song.songName}</p>
      {!genreMenu ? <button ref={genreEntry} className="song-submenu-entry" aria-expanded={false} aria-controls="song-genre-menu" onClick={() => setGenreMenu(true)}><span>歌曲风格<small>{saved.genres.join('、') || '尚未标注'}</small></span><Icon name="arrow" size={17} /></button> : <div id="song-genre-menu" className="song-genre-menu">
        <button className="song-submenu-back" onClick={() => setGenreMenu(false)}><Icon name="back" size={16} />歌曲风格</button>
        <div ref={genreOptions} className="song-genre-options" role="group" aria-label="选择歌曲风格">{options.map(genre => <label key={genre}><input type="checkbox" checked={draft.some(value => value.toLocaleLowerCase() === genre.toLocaleLowerCase())} onChange={event => setDraft(previous => event.target.checked ? normalizeGenres([...previous, genre]) : previous.filter(value => value.toLocaleLowerCase() !== genre.toLocaleLowerCase()))} /><span>{genre}</span></label>)}</div>
        <form className="song-genre-create" onSubmit={event => { event.preventDefault(); addGenre(); }}><label htmlFor="new-song-genre">新建风格</label><div><input className="field" id="new-song-genre" maxLength={40} value={customGenre} onChange={event => setCustomGenre(event.target.value)} placeholder="输入风格名称" /><button disabled={!customGenre.trim()} type="submit">添加</button></div></form>
        <div className="toolbar end"><button onClick={() => { useAppStore.getState().setSongGenres(song.audioPath, null); close(); }}>恢复音频标签</button><button className="button primary" onClick={() => { useAppStore.getState().setSongGenres(song.audioPath, draft); close(); notify('风格标注已保存'); }}>保存标注</button></div>
      </div>}
    </SongPopover>
  </>;
}
