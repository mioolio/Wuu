import { useMemo } from 'react';
import { errorMessage } from '../api';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import { playerService } from '../services/player';
import { useAppStore } from '../store';
import type { Song } from '../types';
import { formatTime, notify } from '../ui';
import HomeDiscovery from './HomeDiscovery';
import './home.css';

function play(song: Song, queue: Song[]) {
  void playerService.playSong(song, queue).catch(error => notify(errorMessage(error), 'error'));
}

function AlbumArtwork({ song, className = '' }: { song: Song; className?: string }) {
  return <span className={`home-artwork ${className}`}><Cover path={song.coverPath} /><span className="home-artwork-disc" aria-hidden="true" /></span>;
}

export default function HomeView() {
  const songs = useAppStore(state => state.songs);
  const collections = useAppStore(state => state.collections);
  const dislikes = useAppStore(state => state.dislikes);
  const stats = useAppStore(state => state.stats);
  const lastSession = useAppStore(state => state.lastSession);
  const currentSong = useAppStore(state => state.player.song);
  const isPlaying = useAppStore(state => state.player.playing);
  const isPreview = useAppStore(state => !!state.player.preview);
  const actualDuration = useAppStore(state => state.actualDuration);
  const setView = useAppStore(state => state.setView);
  const availableSongs = useMemo(() => songs.filter(song => dislikes[song.audioPath] === undefined), [songs, dislikes]);
  const savedPaths = useMemo(() => new Set(collections.flatMap(collection => collection.songs)), [collections]);
  const localFeatured = useMemo(() => [...availableSongs].sort((a, b) => Number(savedPaths.has(b.audioPath)) - Number(savedPaths.has(a.audioPath)) || (stats[b.audioPath]?.plays || 0) - (stats[a.audioPath]?.plays || 0)).slice(0, 4), [availableSongs, savedPaths, stats]);
  const frequent = useMemo(() => [...availableSongs].filter(song => stats[song.audioPath]?.plays > 0).sort((a, b) => stats[b.audioPath].plays - stats[a.audioPath].plays).slice(0, 4), [availableSongs, stats]);
  const hero = availableSongs.find(song => song.audioPath === currentSong?.audioPath)
    || availableSongs.find(song => song.audioPath === lastSession?.audioPath)
    || localFeatured[0];
  const heroIsCurrent = !!hero && hero.audioPath === currentSong?.audioPath && !isPreview;
  const heroIsPlaying = heroIsCurrent && isPlaying;
  const hasHistory = heroIsCurrent || hero?.audioPath === lastSession?.audioPath;
  const artists = useMemo(() => new Set(songs.map(song => song.artist).filter(Boolean)).size, [songs]);
  const totalMinutes = Math.floor(Object.values(stats).reduce((sum, value) => sum + Math.max(0, value.duration || 0), 0) / 60);
  const recent = frequent.length ? frequent : availableSongs.slice(0, 4);
  const openLibrary = () => setView('list');
  const toggleHero = () => {
    if (!hero) return;
    if (heroIsCurrent) playerService.toggle();
    else play(hero, availableSongs);
  };

  return <section className="home-page panel" aria-label="音乐推荐">
    <header className="home-header"><div><h1>推荐</h1></div><button className="home-header-link" onClick={() => setView('import')}><Icon name="plus" size={17} />添加音乐</button></header>
    {hero ? <>
      <section className="home-hero" aria-label="本地歌曲">
        <div className="home-hero-copy"><span className="home-kicker"><span />{heroIsPlaying ? '正在播放' : hasHistory ? '继续聆听' : '本地音乐'}</span><h2 title={hero.songName}>{hero.songName}</h2><p className="home-hero-artist" title={`${hero.artist || '未知艺人'}${hero.album ? ` / ${hero.album}` : ''}`}>{hero.artist || '未知艺人'}{hero.album && <span> / {hero.album}</span>}</p><div className="home-hero-actions"><button className="home-listen-button" onClick={toggleHero} aria-label={`${heroIsPlaying ? '暂停歌曲' : '播放歌曲'} ${hero.songName}`}><Icon name={heroIsPlaying ? 'pause' : 'play'} size={18} />{heroIsPlaying ? '暂停播放' : hasHistory ? '继续播放' : '开始聆听'}</button><button className="home-browse-button" onClick={openLibrary}>浏览歌库<Icon name="arrow" size={17} /></button></div></div>
        <button className="home-hero-cover" onClick={() => { if (!heroIsCurrent) play(hero, availableSongs); setView('player'); }} aria-label={`打开歌曲 ${hero.songName}`}><AlbumArtwork song={hero} /></button>
      </section>
      <HomeDiscovery />
      <div className="home-lower-grid"><section className="home-section home-frequent" aria-labelledby="home-replay-heading"><div className="home-section-heading"><h2 id="home-replay-heading">{frequent.length ? '值得反复聆听' : '你的音乐'}</h2><button className="home-text-link" onClick={() => setView(frequent.length ? 'stats' : 'list')}>{frequent.length ? '聆听记录' : '打开歌库'}<Icon name="arrow" size={15} /></button></div><div className="home-song-list">{recent.map((song, index) => <button className={`home-song-row ${currentSong?.audioPath === song.audioPath && !isPreview ? 'is-current' : ''}`} key={song.audioPath} onClick={() => play(song, availableSongs)} aria-label={`播放 ${song.songName}`}><span className="home-song-index">{String(index + 1).padStart(2, '0')}</span><Cover path={song.coverPath} /><span className="home-song-info"><strong title={song.songName}>{song.songName}</strong><span title={song.artist || '未知艺人'}>{song.artist || '未知艺人'}</span></span><span className="home-song-time">{formatTime(actualDuration[song.audioPath] || song.realDuration || song.duration || 0)}</span><Icon name="play" size={15} /></button>)}</div></section><aside className="home-library-card"><h2>你的音乐库</h2><div className="home-library-numbers"><span><strong>{songs.length.toLocaleString()}</strong>首歌曲</span><span><strong>{collections.length.toLocaleString()}</strong>个歌单</span></div><div className="home-library-footnote"><span>{artists} 位艺人</span><span>{totalMinutes > 0 ? `已聆听 ${totalMinutes.toLocaleString()} 分钟` : '从一次播放开始'}</span></div><button className="home-library-button" onClick={() => { useAppStore.setState({ activeCollectionId: null }); setView('liked'); }}>打开我的歌单<Icon name="arrow" size={17} /></button></aside></div>
    </> : <><HomeDiscovery /><section className="home-import-note"><div><h2>{songs.length ? '继续发现新声音' : '从新歌开始，建立你的歌库'}</h2><p>试听新歌，喜欢再保存；也可以导入已有音乐。</p></div><button className="home-header-link" onClick={() => setView('import')}><Icon name="plus" size={17} />导入音乐</button></section></>}

  </section>;
}
