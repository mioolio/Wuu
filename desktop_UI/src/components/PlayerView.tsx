import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';
import { useAppStore } from '../store';
import { formatTime, notify, promptText } from '../ui';
import { isVideo, playerService } from '../services/player';
import { lyricCredits } from '../services/lyrics';
import Cover from './Cover';
import Icon from './Icon';
import LyricsView from './LyricsView';
import AudioFxPanel from './AudioFxPanel';

export default function PlayerView() {
  const song = useAppStore(state => state.player.song);
  const preview = useAppStore(state => state.player.preview);
  const playing = useAppStore(state => state.player.playing);
  const lyricText = useAppStore(state => state.player.lyricText);
  const error = useAppStore(state => state.player.error);
  const collections = useAppStore(state => state.collections);
  const discCover = useAppStore(state => state.settings.discCover);
  const [fxOpen, setFxOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const video = isVideo(song, preview);
  const liked = !!song && collections.some(collection => collection.songs.includes(song.audioPath));
  const title = preview?.name || song?.songName || '';
  const artist = preview?.artist || song?.artist || '';
  const credits = lyricCredits(lyricText);
  const lyricist = song?.lyricist || credits.lyricist;
  const composer = song?.composer || credits.composer;
  useEffect(() => {
    const target = mount.current;
    if (!video || !target) return;
    target.appendChild(playerService.media);
    playerService.media.controls = false;
    playerService.media.style.width = '100%'; playerService.media.style.height = '100%'; playerService.media.style.objectFit = 'contain';
    return () => { if (playerService.media.parentElement === target) target.removeChild(playerService.media); };
  }, [video]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFxOpen(false); setPickerOpen(false); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, []);
  const savePreview = async () => {
    if (!preview?.onSave || saving) return;
    setSaving(true); try { await preview.onSave(); } catch (error) { notify(errorMessage(error), 'error'); } finally { setSaving(false); }
  };
  const createCollection = async () => {
    const name = await promptText({ title: '新建歌单', defaultValue: '新建歌单', confirmText: '创建' });
    if (name && song) { const id = useAppStore.getState().createCollection(name); useAppStore.getState().setCollectionSong(id, song.audioPath, true); }
  };
  if (!song && !preview) return <section className="panel empty"><Icon name="music" size={56} /><h1>让音乐开始</h1><p className="muted">从歌库选择一首歌曲，或试听在线音乐。</p><button className="button primary" onClick={() => useAppStore.getState().setView('list')}>打开音乐列表</button></section>;
  return <section className={`player-page panel ${video ? 'video-player-page' : ''}`}>
    <header className="page-header"><div><span className="badge">{preview ? '在线试听' : video ? '视频播放' : '正在播放'}</span><h1>{title}</h1><p className="muted">{artist}{song?.album ? ` · ${song.album}` : ''}</p></div><button className="button" onClick={() => setFxOpen(true)}>音效</button></header>
    {error && <div className="status-error" role="status">{error}</div>}
    <div className="player-stage">
      {video ? <div className="video-stage"><div className="video-mount" ref={mount} /><button className="button video-fullscreen" onClick={() => { void mount.current?.requestFullscreen().catch(error => notify(errorMessage(error), 'error')); }}>全屏</button></div> : <div className="player-artwork"><Cover path={preview?.cover || song?.coverPath} className={`player-cover ${discCover ? 'disc' : ''} ${playing ? 'playing' : ''}`} /><div className="player-credits muted">{lyricist && <span>作词：{lyricist}</span>}{composer && <span>作曲：{composer}</span>}</div></div>}
      {!video && <LyricsView />}
    </div>
    <div className="toolbar player-actions">
      {song && <><button className={`button ${liked ? 'active' : ''}`} onClick={() => setPickerOpen(true)}><Icon name="heart" />{liked ? '已收藏' : '收藏'}</button><button className="button" onClick={() => setPickerOpen(true)}><Icon name="plus" />添加到歌单</button><button className="button" onClick={() => { useAppStore.setState({ shareSelection: [song.audioPath] }); useAppStore.getState().setView('playlist'); }}><Icon name="share" />分享</button></>}
      {preview?.onSave && <button className="button primary" disabled={saving} onClick={() => void savePreview()}><Icon name="import" />{saving ? '正在保存…' : '保存到歌库'}</button>}
      <span className="muted">{song?.realDuration ? formatTime(song.realDuration) : preview ? `${preview.source || '在线'} 试听` : ''}</span>
    </div>
    {fxOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFxOpen(false); }}><div className="modal-card wide" role="dialog" aria-modal="true" aria-label="音效与均衡器"><AudioFxPanel onClose={() => setFxOpen(false)} /></div></div>}
    {pickerOpen && song && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPickerOpen(false); }}><div className="modal-card" role="dialog" aria-modal="true" aria-label="选择歌单"><h2>添加到歌单</h2><p className="muted">{title}</p><div className="picker-list">{collections.map(collection => <label className="row card" key={collection.id}><input type="checkbox" checked={collection.songs.includes(song.audioPath)} onChange={event => useAppStore.getState().setCollectionSong(collection.id, song.audioPath, event.target.checked)} />{collection.name}<span className="muted">{collection.songs.length} 首</span></label>)}</div><div className="toolbar end"><button className="button" onClick={() => void createCollection()}>新建歌单</button><button className="button primary" onClick={() => setPickerOpen(false)}>完成</button></div></div></div>}
  </section>;
}
