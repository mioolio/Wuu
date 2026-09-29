import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../api';
import { useAppStore } from '../store';
import { formatTime, notify, promptText } from '../ui';
import { normalizeFxSettings, resolveFxConfig } from '../services/audioFx';
import { playerService } from '../services/player';
import Cover from './Cover';
import Icon from './Icon';
import AudioFxPanel from './AudioFxPanel';

const modes = ['单曲循环', '列表循环', '随机播放'];
const modeIcons = ['↻', '⇄', '⤨'];
export default function PlayerBar() {
  const player = useAppStore(state => state.player);
  const settings = useAppStore(state => state.settings);
  const liked = useAppStore(state => !!state.player.song && state.collections.some(collection => collection.songs.includes(state.player.song!.audioPath)));
  const songs = useAppStore(state => state.songs);
  const collections = useAppStore(state => state.collections);
  const dislikes = useAppStore(state => state.dislikes);
  const [fxOpen, setFxOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const dragTimeRef = useRef<number | null>(null);
  const available = !!player.song || !!player.preview;
  const title = player.preview?.name || player.song?.songName || '未选择歌曲';
  const artist = player.preview?.artist || player.song?.artist || 'Wuu 音乐';
  const fx = normalizeFxSettings(settings.audioFx);
  const fxName = resolveFxConfig(fx).name;
  const queue = useMemo(() => playerService.getQueue().filter(song => !query || `${song.songName} ${song.artist}`.toLowerCase().includes(query.toLowerCase())), [queueOpen, query, songs, player.song, dislikes, collections]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFxOpen(false); setQueueOpen(false); setPickerOpen(false); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, []);
  const invoke = (action: () => Promise<unknown>) => { void action().catch(error => notify(errorMessage(error), 'error')); };
  const savePreview = async () => { if (!player.preview?.onSave || saving) return; setSaving(true); try { await player.preview.onSave(); } catch (error) { notify(errorMessage(error), 'error'); } finally { setSaving(false); } };
  const createCollection = async () => {
    const name = await promptText({ title: '新建歌单', defaultValue: '新建歌单', confirmText: '创建' });
    if (name && player.song) { const id = useAppStore.getState().createCollection(name); useAppStore.getState().setCollectionSong(id, player.song.audioPath, true); }
  };
  const commitSeek = () => {
    const target = dragTimeRef.current;
    dragTimeRef.current = null;
    if (target !== null) playerService.seek(target);
    setDragTime(null);
  };
  const time = dragTime ?? player.time;
  return <>
    <footer className="player-bar" aria-label="播放控制">
      <div className="now-playing"><button className="now-playing-link" aria-label="打开正在播放" onClick={() => useAppStore.getState().setView('player')}><Cover path={player.preview?.cover || player.song?.coverPath} /><span className="song-meta"><strong>{title}</strong><span>{player.loading ? '正在加载…' : artist}</span></span></button>
        {player.song && <button className={`icon-button ${liked ? 'active' : ''}`} aria-label="选择当前歌曲的收藏歌单" onClick={() => setPickerOpen(true)}><Icon name="heart" /></button>}
        {player.preview?.onSave && <button className="icon-button" disabled={saving} aria-label="保存试听到歌库" onClick={() => void savePreview()}><Icon name="plus" /></button>}
      </div>
      <div className="player-central"><div className="player-transport"><button className="icon-button mode-button" title={modes[settings.playMode]} aria-label={`播放模式：${modes[settings.playMode]}`} onClick={() => useAppStore.getState().setSettings({ playMode: (settings.playMode + 1) % 3 })}>{modeIcons[settings.playMode]}</button><button className="icon-button" aria-label="上一首" disabled={!available} onClick={() => playerService.next(-1)}><Icon name="previous" /></button><button className="play-button primary" aria-label={player.playing ? '暂停' : '播放'} disabled={!available && !songs.length} onClick={() => playerService.toggle()}><Icon name={player.playing ? 'pause' : 'play'} size={24} /></button><button className="icon-button" aria-label="下一首" disabled={!available} onClick={() => playerService.next(1)}><Icon name="next" /></button></div>
        <div className="player-progress"><span>{formatTime(time)}</span><input aria-label="播放进度" type="range" min={0} max={player.duration || 1} step={0.1} disabled={!player.duration} value={Math.min(time, player.duration || 0)} onPointerDown={event => {
          dragTimeRef.current = Number(event.currentTarget.value); setDragTime(dragTimeRef.current);
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onChange={event => {
          const target = Number(event.currentTarget.value);
          if (dragTimeRef.current !== null) { dragTimeRef.current = target; setDragTime(target); } else playerService.seek(target);
        }} onPointerUp={event => { if (dragTimeRef.current !== null) dragTimeRef.current = Number(event.currentTarget.value); commitSeek(); }} onPointerCancel={() => { dragTimeRef.current = null; setDragTime(null); }} onKeyUp={commitSeek} onBlur={commitSeek} style={{ accentColor: settings.progressColorEnabled ? settings.progressColor : undefined }} /><span>{formatTime(player.duration)}</span></div>
      </div>
      <div className="player-extras"><button className={`icon-button ${fx.preset !== 'off' ? 'active' : ''}`} title={`音效：${fxName}`} aria-label="打开音效" onClick={() => setFxOpen(true)}>EQ</button><button className={`icon-button ${player.desktopLyricOn ? 'active' : ''}`} title="桌面歌词" aria-label={player.desktopLyricOn ? '关闭桌面歌词' : '打开桌面歌词'} onClick={() => invoke(() => playerService.toggleDesktopLyric())}>词</button>{player.desktopLyricOn && <button className={`icon-button ${settings.desktopLyricLocked ? 'active' : ''}`} aria-label={settings.desktopLyricLocked ? '解锁桌面歌词' : '锁定桌面歌词'} onClick={() => invoke(() => playerService.toggleLyricLock())}>{settings.desktopLyricLocked ? '🔒' : '🔓'}</button>}
        <label className="volume-control" title={`音量 ${Math.round(settings.volume * 100)}%`}><button className="icon-button" aria-label={settings.volume === 0 ? '取消静音' : '静音'} onClick={() => playerService.setVolume(settings.volume === 0 ? 1 : 0)}>{settings.volume === 0 ? '◌' : '◖'}</button><input aria-label="音量" type="range" min={0} max={1.5} step={0.01} value={settings.volume} onChange={event => playerService.setVolume(Number(event.target.value))} /></label>
        {settings.showFloatListBtn && <button className={`icon-button ${queueOpen ? 'active' : ''}`} title="播放队列" aria-label="打开播放队列" onClick={() => setQueueOpen(!queueOpen)}><Icon name="list" /></button>}
      </div>
    </footer>
    {queueOpen && <aside className="player-queue panel" aria-label="播放队列"><header className="page-header"><h2>播放队列 <span className="badge">{player.preview?.queue?.length || queue.length}</span></h2><button className="icon-button" aria-label="关闭播放队列" onClick={() => setQueueOpen(false)}>×</button></header><input aria-label="搜索播放队列" placeholder="搜索队列…" value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} />
      <div className="queue-list">{player.preview ? (player.preview.queue || [player.preview]).filter(item => !query || `${item.name} ${item.artist}`.toLowerCase().includes(query.toLowerCase())).slice(0, limit).map((item, index) => <button className={`queue-song ${item.name === player.preview?.name && item.artist === player.preview?.artist ? 'active' : ''}`} key={index} onClick={() => invoke(() => playerService.playPreview({ ...item, queue: player.preview?.queue }))}><Cover path={item.cover} /><span className="song-meta"><strong>{item.name}</strong><span>{item.artist}</span></span></button>) : queue.slice(0, limit).map(song => <button className={`queue-song ${song.audioPath === player.song?.audioPath ? 'active' : ''}`} key={song.audioPath} onClick={() => invoke(() => playerService.playSong(song, playerService.getQueue()))}><Cover path={song.coverPath} /><span className="song-meta"><strong>{song.songName}</strong><span>{song.artist}</span></span></button>)}{(player.preview?.queue?.length || queue.length) > limit && <button className="button" onClick={() => setLimit(previous => previous + 100)}>显示更多</button>}{!player.preview && !queue.length && <div className="empty">队列为空</div>}</div>
    </aside>}
    {fxOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFxOpen(false); }}><div className="modal-card wide" role="dialog" aria-modal="true" aria-label="音效与均衡器"><AudioFxPanel onClose={() => setFxOpen(false)} /></div></div>}
    {pickerOpen && player.song && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPickerOpen(false); }}><div className="modal-card" role="dialog" aria-modal="true" aria-label="选择歌单"><h2>添加到歌单</h2><p className="muted">{title}</p><div className="picker-list">{collections.map(collection => <label className="row card" key={collection.id}><input type="checkbox" checked={collection.songs.includes(player.song!.audioPath)} onChange={event => useAppStore.getState().setCollectionSong(collection.id, player.song!.audioPath, event.target.checked)} />{collection.name}<span className="muted">{collection.songs.length} 首</span></label>)}</div><div className="toolbar end"><button className="button" onClick={() => void createCollection()}>新建歌单</button><button className="button primary" onClick={() => setPickerOpen(false)}>完成</button></div></div></div>}
  </>;
}
