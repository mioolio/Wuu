import { useMemo, useState } from 'react';
import { mediaUrl, errorMessage } from '../api';
import { useAppStore } from '../store';
import { playerService } from '../services/player';
import { formatDuration, notify } from '../ui';
import './utility-features.css';

export default function StatsView() {
  const songs = useAppStore(state => state.songs);
  const stats = useAppStore(state => state.stats);
  const collections = useAppStore(state => state.collections);
  const currentPath = useAppStore(state => state.player.song?.audioPath);
  const [sort, setSort] = useState<'plays' | 'duration'>('plays');
  const [limit, setLimit] = useState(50);
  const totals = useMemo(() => Object.values(stats).reduce((total, entry) => ({
    plays: total.plays + Math.max(0, Number(entry?.plays) || 0),
    duration: total.duration + Math.max(0, Number(entry?.duration) || 0),
  }), { plays: 0, duration: 0 }), [stats]);
  const likedCount = useMemo(() => new Set(collections.flatMap(collection => collection.songs)).size, [collections]);
  const ranked = useMemo(() => songs.map(song => ({ song, stats: stats[song.audioPath] || { plays: 0, duration: 0 } }))
    .filter(entry => entry.stats.plays > 0 || entry.stats.duration > 0)
    .sort((a, b) => sort === 'plays'
      ? b.stats.plays - a.stats.plays || b.stats.duration - a.stats.duration
      : b.stats.duration - a.stats.duration || b.stats.plays - a.stats.plays), [songs, stats, sort]);
  const maximum = ranked[0]?.stats[sort] || 1;

  return <section className="panel stats-page">
    <div className="page-header"><div><h1>音乐统计</h1><p className="muted">每一次播放，都留下属于你的音乐足迹。</p></div></div>
    <div className="grid">
      <div className="card"><span className="muted">累计听歌时长</span><h2>{formatDuration(totals.duration)}</h2><small className="muted">共 {Math.floor(totals.duration).toLocaleString()} 秒</small></div>
      <div className="card"><span className="muted">总播放次数</span><h2>{totals.plays.toLocaleString()}</h2></div>
      <div className="card"><span className="muted">收藏歌曲</span><h2>{likedCount.toLocaleString()}</h2></div>
      <div className="card"><span className="muted">曲库总数</span><h2>{songs.length.toLocaleString()}</h2></div>
    </div>
    <div className="page-header"><h2>最喜欢听的音乐</h2><div className="toolbar">
      <button className={`button ${sort === 'plays' ? 'primary' : ''}`} onClick={() => { setSort('plays'); setLimit(50); }}>按播放次数</button>
      <button className={`button ${sort === 'duration' ? 'primary' : ''}`} onClick={() => { setSort('duration'); setLimit(50); }}>按听歌时长</button>
    </div></div>
    {!ranked.length ? <div className="empty">还没有播放记录，开始听一首歌吧。</div> : <div className="card">
      {ranked.slice(0, limit).map(({ song, stats: entry }, index) => <div className="row" key={song.audioPath}>
        <span className="badge">{index + 1}</span>
        {song.coverPath && <img src={mediaUrl(song.coverPath)} alt="" loading="lazy" width="42" height="42" style={{ borderRadius: 8, objectFit: 'cover' }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
        <button className={`button ${currentPath === song.audioPath ? 'primary' : ''}`} style={{ flex: 1, textAlign: 'left' }} onClick={() => {
          void playerService.playSong(song).then(() => useAppStore.getState().setView('player')).catch(error => notify(errorMessage(error), 'error'));
        }}><strong>{song.songName}</strong><div className="muted">{song.artist || '未知艺人'}</div></button>
        <div style={{ width: 150, textAlign: 'right' }}><strong>{sort === 'plays' ? `${entry.plays} 次` : formatDuration(entry.duration)}</strong>
          <div className="muted">{sort === 'plays' ? formatDuration(entry.duration) : `${entry.plays} 次`}</div>
          <progress max={maximum} value={entry[sort]} style={{ width: '100%' }} aria-label={`${song.songName}的${sort === 'plays' ? '播放次数' : '听歌时长'}`} />
        </div>
      </div>)}
      {limit < ranked.length && <button className="button" onClick={() => setLimit(value => value + 50)}>加载更多（{Math.min(limit, ranked.length)} / {ranked.length}）</button>}
    </div>}
  </section>;
}
