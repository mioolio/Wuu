import { useMemo, useState } from 'react';
import { errorMessage } from '../api';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import { useAppStore } from '../store';
import { playerService } from '../services/player';
import { parseGenreInput, songGenres, summarizeListeningStyles } from '../services/listeningStyles';
import type { Song } from '../types';
import { formatDuration, notify, promptText } from '../ui';
import { useStatsSnapshot } from './useStatsSnapshot';
import './stats.css';

function percentage(value: number): string {
  return value > 0 && value < .1 ? '<0.1%' : `${(Math.floor(value * 10) / 10).toLocaleString()}%`;
}

function recentDuration(value: number): string {
  return value > 0 && value < 1 ? '少于 1 秒' : value < 60 ? `${Math.floor(value)} 秒` : formatDuration(value);
}

export default function StatsView() {
  const { songs, stats, collections, currentPath, playing, genreOverrides, day } = useStatsSnapshot();
  const [days, setDays] = useState<7 | 30>(7);
  const [genreLimit, setGenreLimit] = useState(12);
  const [sort, setSort] = useState<'plays' | 'duration'>('plays');
  const [limit, setLimit] = useState(50);
  const totals = useMemo(() => Object.values(stats).reduce((total, entry) => ({
    plays: total.plays + Math.max(0, Number(entry?.plays) || 0),
    duration: total.duration + Math.max(0, Number(entry?.duration) || 0),
  }), { plays: 0, duration: 0 }), [stats]);
  const likedCount = useMemo(() => new Set(collections.flatMap(collection => collection.songs)).size, [collections]);
  const ranked = useMemo(() => songs.map(song => ({ song, stats: {
    plays: Math.max(0, Number(stats[song.audioPath]?.plays) || 0),
    duration: Math.max(0, Number(stats[song.audioPath]?.duration) || 0),
  } }))
    .filter(entry => entry.stats.plays > 0 || entry.stats.duration > 0)
    .sort((a, b) => sort === 'plays'
      ? b.stats.plays - a.stats.plays || b.stats.duration - a.stats.duration
      : b.stats.duration - a.stats.duration || b.stats.plays - a.stats.plays), [songs, stats, sort]);
  const maximum = ranked[0]?.stats[sort] || 1;
  const minutes = Math.floor(totals.duration / 60);
  const listeningValue = minutes >= 60 ? Math.floor(minutes / 60) : minutes;
  const listeningUnit = minutes >= 60 ? `小时 ${minutes % 60} 分钟` : '分钟';
  const recent = useMemo(() => summarizeListeningStyles(songs, stats, genreOverrides, days), [songs, stats, genreOverrides, days, day]);
  const styleBuckets = useMemo(() => {
    const tagged = recent.buckets.filter(bucket => !bucket.unlabeled);
    const visible = tagged.slice(0, 4);
    const remaining = tagged.slice(4);
    if (remaining.length) visible.push({ name: '其他已标注', duration: remaining.reduce((total, bucket) => total + bucket.duration, 0), share: remaining.reduce((total, bucket) => total + bucket.share, 0), unlabeled: false });
    return [...visible, ...recent.buckets.filter(bucket => bucket.unlabeled)];
  }, [recent]);

  async function editGenres(song: Song) {
    const value = await promptText({ title: `编辑「${song.songName}」的曲风`, message: '用逗号分隔多个曲风，例如：流行, 摇滚。留空可以清除，之后也可恢复音频标签。', defaultValue: songGenres(song, genreOverrides).genres.join(', '), confirmText: '保存标签', allowEmpty: true });
    if (value === null) return;
    const genres = parseGenreInput(value);
    useAppStore.getState().setSongGenres(song.audioPath, genres);
    notify(genres.length ? '已保存曲风标签' : '已清除曲风标签');
  }

  return <section className="panel stats-page" aria-labelledby="stats-heading">
    <header className="stats-header"><h1 id="stats-heading">音乐统计</h1><p>累计聆听与歌曲排行</p></header>
    <dl className="stats-overview" aria-label="音乐统计总览">
      <div className="stats-metric"><dt>累计听歌时长</dt><dd><strong>{listeningValue.toLocaleString()}</strong><span>{listeningUnit}</span></dd></div>
      <div className="stats-metric"><dt>总播放次数</dt><dd><strong>{totals.plays.toLocaleString()}</strong><span>次</span></dd></div>
      <div className="stats-metric"><dt>收藏歌曲</dt><dd><strong>{likedCount.toLocaleString()}</strong><span>首</span></dd></div>
      <div className="stats-metric"><dt>曲库总数</dt><dd><strong>{songs.length.toLocaleString()}</strong><span>首</span></dd></div>
    </dl>
    <section className="stats-styles" aria-labelledby="stats-styles-heading">
      <div className="stats-ranking-header"><div><h2 id="stats-styles-heading">最近听的风格</h2><p>近 {days} 天 · {recentDuration(recent.totalDuration)} · 标签覆盖率 {percentage(recent.coverage)}</p></div><div className="stats-sort" role="group" aria-label="曲风统计时间范围">
        <button aria-pressed={days === 7} onClick={() => { setDays(7); setGenreLimit(12); }}>近 7 天</button>
        <button aria-pressed={days === 30} onClick={() => { setDays(30); setGenreLimit(12); }}>近 30 天</button>
      </div></div>
      {recent.totalDuration > 0 ? <ul className="stats-style-chart" aria-label="按聆听时长计算的曲风分布">{styleBuckets.map(bucket => <li className={bucket.unlabeled ? 'is-unlabeled' : ''} key={`${bucket.unlabeled ? 'unknown' : 'genre'}-${bucket.name}`}>
        <div><strong title={bucket.name}>{bucket.name}</strong><span>{percentage(bucket.share)}</span></div><progress max={100} value={bucket.share} aria-label={`${bucket.name}占近期聆听时长的${percentage(bucket.share)}`} /><small>{recentDuration(bucket.duration)}</small>
      </li>)}</ul> : <p className="stats-style-empty">{recent.tracks.length ? '已有播放记录，聆听时长还在积累。' : `近 ${days} 天还没有记录，播放曲库中的歌曲后会在这里更新。`}</p>}
      <p className="stats-history-note">近期记录从本次更新后开始积累，旧的累计记录保留。{recent.totalDuration > 0 && '占比按聆听时长计算，多曲风歌曲平均分配；未标注歌曲也计入总时长。'}</p>
      {recent.tracks.length > 0 && <details className="stats-genre-editor"><summary>补充歌曲曲风<span>近期听过 {recent.tracks.length.toLocaleString()} 首</span><Icon name="arrow" size={15} /></summary>
        <p className="stats-genre-help">标签来自本地音频，可自行补充；没有标签的歌曲会显示为未标注。</p>
        <ul className="stats-genre-tracks">{recent.tracks.slice(0, genreLimit).map(track => <li key={track.song.audioPath}>
          <div className="stats-genre-song"><strong title={track.song.songName}>{track.song.songName}</strong><span title={`${track.song.artist || '未知艺人'} · ${track.genres.join(' / ') || '未标注'}`}>{track.song.artist || '未知艺人'} · {track.genres.join(' / ') || '未标注'}{track.manual ? '（手动）' : ''}</span></div>
          <div className="stats-genre-actions"><button aria-label={`编辑 ${track.song.songName} 的曲风`} onClick={() => void editGenres(track.song)}>编辑曲风</button>{track.manual && <button aria-label={`恢复 ${track.song.songName} 的音频标签`} onClick={() => { useAppStore.getState().setSongGenres(track.song.audioPath, null); notify('已恢复音频标签'); }}>恢复音频标签</button>}</div>
        </li>)}</ul>
        {genreLimit < recent.tracks.length && <button className="stats-genre-more" onClick={() => setGenreLimit(value => value + 12)}>显示更多歌曲</button>}
      </details>}
    </section>
    <section className="stats-ranking" aria-labelledby="stats-ranking-heading">
      <div className="stats-ranking-header"><div><h2 id="stats-ranking-heading">歌曲排行</h2><p>听过 {ranked.length.toLocaleString()} 首 · 累计记录</p></div><div className="stats-sort" role="group" aria-label="排行排序">
        <button aria-pressed={sort === 'plays'} onClick={() => { setSort('plays'); setLimit(50); }}>播放次数</button>
        <button aria-pressed={sort === 'duration'} onClick={() => { setSort('duration'); setLimit(50); }}>听歌时长</button>
      </div></div>
      {!ranked.length ? <div className="stats-empty"><Icon name="headphones" size={28} /><h3>还没有播放记录</h3><p>播放曲库中的歌曲后，可以在这里查看累计聆听记录。</p><button onClick={() => useAppStore.getState().setView('list')}>打开音乐列表<Icon name="arrow" size={15} /></button></div> : <>
      <div className="stats-list-heading" aria-hidden="true"><span>#</span><span>歌曲 / 艺人</span><span>{sort === 'plays' ? '播放次数' : '听歌时长'}</span></div>
      <ol className="stats-ranking-list">
      {ranked.slice(0, limit).map(({ song, stats: entry }, index) => <li className={`stats-rank-row ${currentPath === song.audioPath ? 'is-current' : ''}`} key={song.audioPath}>
        <span className="stats-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <button className="stats-track" aria-label={`播放 ${song.songName}，${song.artist || '未知艺人'}`} onClick={() => {
          void playerService.playSong(song).then(() => useAppStore.getState().setView('player')).catch(error => notify(errorMessage(error), 'error'));
        }}><Cover path={song.coverPath} /><span className="stats-track-meta"><strong title={song.songName}>{song.songName}</strong><span title={song.artist || '未知艺人'}>{song.artist || '未知艺人'}</span></span>
          <span className="stats-track-state">{currentPath === song.audioPath ? <span>{playing ? '正在播放' : '当前歌曲'}</span> : <Icon name="play" size={15} />}</span>
        </button>
        <div className="stats-listening"><strong>{sort === 'plays' ? `${entry.plays.toLocaleString()} 次` : formatDuration(entry.duration)}</strong>
          <span>{sort === 'plays' ? formatDuration(entry.duration) : `${entry.plays.toLocaleString()} 次`}</span>
          <progress max={maximum} value={entry[sort]} aria-label={`${song.songName}的${sort === 'plays' ? '播放次数' : '听歌时长'}`} />
        </div>
      </li>)}
      </ol>
      <footer className="stats-list-footer"><span>显示 {Math.min(limit, ranked.length).toLocaleString()} / {ranked.length.toLocaleString()} 首</span>{limit < ranked.length && <button onClick={() => setLimit(value => value + 50)}>加载更多</button>}</footer>
      </>}
    </section>
  </section>;
}
