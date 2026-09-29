import { useMemo } from 'react';
import { errorMessage } from '../api';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import { playerService } from '../services/player';
import { useAppStore } from '../store';
import type { Song } from '../types';
import { formatTime, notify } from '../ui';
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
  const recommendations = useMemo(() => songs.filter(song => dislikes[song.audioPath] === undefined), [songs, dislikes]);
  const savedPaths = useMemo(() => new Set(collections.flatMap(collection => collection.songs)), [collections]);
  const featured = useMemo(() => [...recommendations].sort((a, b) => Number(savedPaths.has(b.audioPath)) - Number(savedPaths.has(a.audioPath)) || (stats[b.audioPath]?.plays || 0) - (stats[a.audioPath]?.plays || 0)).slice(0, 4), [recommendations, savedPaths, stats]);
  const frequent = useMemo(() => [...recommendations].filter(song => stats[song.audioPath]?.plays > 0).sort((a, b) => stats[b.audioPath].plays - stats[a.audioPath].plays).slice(0, 4), [recommendations, stats]);
  const hero = recommendations.find(song => song.audioPath === currentSong?.audioPath)
    || recommendations.find(song => song.audioPath === lastSession?.audioPath)
    || featured[0];
  const heroIsCurrent = !!hero && hero.audioPath === currentSong?.audioPath && !isPreview;
  const heroIsPlaying = heroIsCurrent && isPlaying;
  const hasHistory = heroIsCurrent || hero?.audioPath === lastSession?.audioPath;
  const artists = useMemo(() => new Set(songs.map(song => song.artist).filter(Boolean)).size, [songs]);
  const totalMinutes = Math.floor(Object.values(stats).reduce((sum, value) => sum + Math.max(0, value.duration || 0), 0) / 60);
  const recent = frequent.length ? frequent : recommendations.slice(0, 4);
  const openLibrary = () => setView('list');
  const toggleHero = () => {
    if (!hero) return;
    if (heroIsCurrent) playerService.toggle();
    else play(hero, recommendations);
  };

  return <section className="home-page panel" aria-label="音乐推荐">
    <header className="home-header"><div><span className="home-eyebrow">MADE FOR YOU</span><h1>推荐</h1></div><button className="home-header-link" onClick={() => setView('import')}><Icon name="plus" size={17} />添加音乐</button></header>
    {hero ? <>
      <section className="home-hero" aria-label="推荐歌曲">
        <div className="home-hero-copy"><span className="home-kicker"><span />{heroIsPlaying ? '此刻，正在播放' : hasHistory ? '从这里，继续聆听' : '发现歌库里的好声音'}</span><h2 title={hero.songName}>{hero.songName}</h2><p className="home-hero-artist" title={`${hero.artist || '未知艺人'}${hero.album ? ` / ${hero.album}` : ''}`}>{hero.artist || '未知艺人'}{hero.album && <span> / {hero.album}</span>}</p><p className="home-hero-note">熟悉的旋律，新的心情。</p><div className="home-hero-actions"><button className="home-listen-button" onClick={toggleHero} aria-label={`${heroIsPlaying ? '暂停歌曲' : '播放歌曲'} ${hero.songName}`}><Icon name={heroIsPlaying ? 'pause' : 'play'} size={18} />{heroIsPlaying ? '暂停播放' : hasHistory ? '继续播放' : '开始聆听'}</button><button className="home-browse-button" onClick={openLibrary}>浏览歌库<Icon name="arrow" size={17} /></button></div></div>
        <button className="home-hero-cover" onClick={() => { if (!heroIsCurrent) play(hero, recommendations); setView('player'); }} aria-label={`打开歌曲 ${hero.songName}`}><AlbumArtwork song={hero} /><span className="home-hero-caption"><Icon name="disc" size={14} />WUU · YOUR MUSIC</span></button>
      </section>
      <section className="home-section" aria-labelledby="home-listen-heading"><div className="home-section-heading"><div><h2 id="home-listen-heading">今天，听这些</h2><p>来自你的私人音乐收藏</p></div><button className="home-text-link" onClick={openLibrary}>查看全部<Icon name="arrow" size={15} /></button></div><div className="home-album-grid">{featured.map((song, index) => <button className="home-album-card" key={song.audioPath} onClick={() => play(song, recommendations)} aria-label={`播放推荐歌曲 ${song.songName}`}><span className={`home-card-image home-art-tone-${index}`}><AlbumArtwork song={song} /><span className="home-card-play"><Icon name="play" size={20} /></span></span><strong title={song.songName}>{song.songName}</strong><span className="home-card-artist" title={song.artist || '未知艺人'}>{song.artist || '未知艺人'}</span></button>)}</div></section>
      <div className="home-lower-grid"><section className="home-section home-frequent" aria-labelledby="home-replay-heading"><div className="home-section-heading"><h2 id="home-replay-heading">{frequent.length ? '值得反复聆听' : '你的音乐'}</h2><button className="home-text-link" onClick={() => setView(frequent.length ? 'stats' : 'list')}>{frequent.length ? '聆听记录' : '打开歌库'}<Icon name="arrow" size={15} /></button></div><div className="home-song-list">{recent.map((song, index) => <button className={`home-song-row ${currentSong?.audioPath === song.audioPath && !isPreview ? 'is-current' : ''}`} key={song.audioPath} onClick={() => play(song, recommendations)} aria-label={`播放 ${song.songName}`}><span className="home-song-index">{String(index + 1).padStart(2, '0')}</span><Cover path={song.coverPath} /><span className="home-song-info"><strong title={song.songName}>{song.songName}</strong><span title={song.artist || '未知艺人'}>{song.artist || '未知艺人'}</span></span><span className="home-song-time">{formatTime(actualDuration[song.audioPath] || song.realDuration || song.duration || 0)}</span><Icon name="play" size={15} /></button>)}</div></section><aside className="home-library-card"><span className="home-eyebrow">YOUR COLLECTION</span><h2>音乐，属于你。</h2><p>把喜欢的声音收好，<br />随时回来听。</p><div className="home-library-numbers"><span><strong>{songs.length.toLocaleString()}</strong>首歌曲</span><span><strong>{collections.length.toLocaleString()}</strong>个歌单</span></div><div className="home-library-footnote"><span>{artists} 位艺人</span><span>{totalMinutes > 0 ? `已聆听 ${totalMinutes.toLocaleString()} 分钟` : '从一次播放开始'}</span></div><button className="home-library-button" onClick={() => { useAppStore.setState({ activeCollectionId: null }); setView('liked'); }}>打开我的歌单<Icon name="arrow" size={17} /></button></aside></div>
    </> : <section className="home-empty-state"><div className="home-empty-art" aria-hidden="true"><span className="home-empty-sleeve"><span>WUU</span><strong>YOUR<br />NEXT<br />FAVORITE.</strong><span>音乐 / 每一天</span></span><span className="home-empty-vinyl" /></div><div className="home-empty-copy"><span className="home-eyebrow">YOUR MUSIC STARTS HERE</span><h2>{songs.length ? '好音乐，还在歌库里。' : '给生活，一点好声音。'}</h2><p>{songs.length ? '当前歌曲已设为不推荐。浏览音乐列表，或为歌库加入一些新声音。' : '导入喜欢的歌曲和歌单，建立属于你的音乐空间。'}</p><div className="home-hero-actions"><button className="home-listen-button" onClick={() => setView('import')}><Icon name="plus" size={18} />导入音乐</button><button className="home-browse-button" onClick={() => setView(songs.length ? 'list' : 'free-music')}>{songs.length ? '浏览歌库' : '发现音乐'}<Icon name="arrow" size={17} /></button></div></div></section>}
    <footer className="home-footer"><span>好音乐，常相伴。</span><span>WUU MUSIC</span></footer>
  </section>;
}
