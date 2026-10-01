import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';
import { useAppStore } from '../store';
import { formatTime, notify, promptText } from '../ui';
import { isVideo, playerService } from '../services/player';
import { lyricCredits } from '../services/lyrics';
import RecordArtwork from './RecordArtwork';
import Icon from './Icon';
import LyricsView from './LyricsView';
import PlayerDialog from './PlayerSurface';

export default function PlayerView() {
  const song = useAppStore(state => state.player.song);
  const preview = useAppStore(state => state.player.preview);
  const playing = useAppStore(state => state.player.playing);
  const lyricText = useAppStore(state => state.player.lyricText);
  const error = useAppStore(state => state.player.error);
  const collections = useAppStore(state => state.collections);
  const discCover = useAppStore(state => state.settings.discCover);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const artwork = useRef<HTMLDivElement>(null);
  const video = isVideo(song, preview);
  const liked = !!song && collections.some(collection => collection.songs.includes(song.audioPath));
  const title = preview?.name || song?.songName || '';
  const artist = preview?.artist || song?.artist || '';
  const credits = lyricCredits(lyricText);
  const lyricist = song?.lyricist || credits.lyricist;
  const composer = song?.composer || credits.composer;
  useLayoutEffect(() => {
    const layout = stage.current;
    const group = artwork.current;
    if (video || !layout || !group) return;
    const sleeve = group.querySelector<HTMLElement>('.record-sleeve');
    const details = [...group.querySelectorAll<HTMLElement>('.record-info, .player-actions, .player-credits')];
    if (!sleeve) return;
    let frame = 0;
    const measure = () => {
      const height = layout.getBoundingClientRect().height;
      if (!height || !layout.getClientRects().length) return;
      const occupied = details.reduce((total, element) => {
        const style = getComputedStyle(element);
        return total + element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      }, 0);
      const sleeveStyle = getComputedStyle(sleeve);
      // Reserve actual text, controls and credits; change both artwork dimensions together.
      const space = Math.max(0, Math.floor(height - occupied - parseFloat(sleeveStyle.marginTop) - parseFloat(sleeveStyle.marginBottom) - 1));
      const value = `${space}px`;
      if (group.style.getPropertyValue('--artwork-space') !== value) group.style.setProperty('--artwork-space', value);
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    // Observing the artwork itself would feed its calculated size back into this measurement.
    observer.observe(layout);
    details.forEach(element => observer.observe(element));
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); group.style.removeProperty('--artwork-space'); };
  }, [video, song?.audioPath, preview?.url]);
  useEffect(() => {
    const target = mount.current;
    if (!video || !target) return;
    target.appendChild(playerService.media);
    playerService.media.controls = false;
    playerService.media.style.width = '100%'; playerService.media.style.height = '100%'; playerService.media.style.objectFit = 'contain';
    return () => { if (playerService.media.parentElement === target) target.removeChild(playerService.media); };
  }, [video]);
  const savePreview = async () => {
    if (!preview?.onSave || saving) return;
    setSaving(true); try { await preview.onSave(); } catch (error) { notify(errorMessage(error), 'error'); } finally { setSaving(false); }
  };
  const createCollection = async () => {
    const name = await promptText({ title: '新建歌单', defaultValue: '新建歌单', confirmText: '创建' });
    if (name && song) { const id = useAppStore.getState().createCollection(name); useAppStore.getState().setCollectionSong(id, song.audioPath, true); }
  };
  const songActions = <div className="toolbar player-actions" role="group" aria-label="当前歌曲操作">
    {song && <><button className={`button collection-entry ${liked ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={pickerOpen} aria-controls="listening-collection-dialog" onClick={() => setPickerOpen(true)}><Icon name={liked ? 'list' : 'plus'} size={17} />{liked ? '管理歌单' : '添加到歌单'}</button><button className="icon-button" title="分享当前歌曲" aria-label="分享当前歌曲" onClick={() => { useAppStore.setState({ shareSelection: [song.audioPath] }); useAppStore.getState().setView('playlist'); }}><Icon name="share" size={17} /></button></>}
    {preview?.onSave && <button className="button primary" disabled={saving} onClick={() => void savePreview()}><Icon name="import" size={17} />{saving ? '正在保存…' : '保存到歌库'}</button>}
  </div>;
  const songInfo = <div className="record-info" key={preview?.url || song?.audioPath}>
    <h1 title={title}>{title}</h1><p title={artist || '未知歌手'}>{artist || '未知歌手'}</p>
    <div className="record-details">
      {song?.album && <span className="record-album" title={song.album}>{song.album}</span>}
      {song?.realDuration ? <span className="record-duration" aria-label={`歌曲时长 ${formatTime(song.realDuration)}`}>{formatTime(song.realDuration)}</span> : preview ? <span className="record-duration">{preview.source || '在线'} 试听</span> : null}
      {video && <span className="record-kind">视频</span>}
    </div>
  </div>;
  if (!song && !preview) return <section className="panel empty player-empty"><div className="player-empty-icon"><Icon name="headphones" size={40} /></div><span className="listening-eyebrow">你的专属音乐时刻</span><h1>让音乐开始</h1><p className="muted">从歌库选择一首歌曲，享受此刻。</p><button className="button primary" onClick={() => useAppStore.getState().setView('list')}>打开音乐列表<Icon name="arrow" size={17} /></button></section>;
  return <section className={`player-page panel immersive-player ${video ? 'video-player-page' : ''}`}>
    {error && <div className="status-error" role="status">{error}</div>}
    <div className="player-stage" ref={stage}>
      {video ? <div className="video-stage"><div className="video-mount" ref={mount} /><button className="button video-fullscreen" onClick={() => { void mount.current?.requestFullscreen().catch(error => notify(errorMessage(error), 'error')); }}><Icon name="maximize" size={16} />全屏</button></div> : <div className="player-artwork" ref={artwork}><RecordArtwork path={preview?.cover || song?.coverPath} disc={discCover} playing={playing} />{songInfo}{songActions}<div className="player-credits muted">{lyricist && <span>作词 {lyricist}</span>}{composer && <span>作曲 {composer}</span>}</div></div>}
      {!video && <LyricsView />}
    </div>
    {video && <div className="video-record-info">{songInfo}{songActions}</div>}
    {song && <PlayerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} label="选择歌单" id="listening-collection-dialog"><h2>添加到歌单</h2><p className="muted">{title}</p><div className="picker-list">{collections.map(collection => <label className="row card" key={collection.id}><input type="checkbox" checked={collection.songs.includes(song.audioPath)} onChange={event => useAppStore.getState().setCollectionSong(collection.id, song.audioPath, event.target.checked)} />{collection.name}<span className="muted">{collection.songs.length} 首</span></label>)}</div><div className="toolbar end"><button className="button" onClick={() => void createCollection()}>新建歌单</button><button className="button primary" onClick={() => setPickerOpen(false)}>完成</button></div></PlayerDialog>}
  </section>;
}
