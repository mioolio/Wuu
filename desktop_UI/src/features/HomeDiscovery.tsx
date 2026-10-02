import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import { createDiscoverySession, discoverySongKey, isNewDiscoverySong, playDiscoverySong } from '../services/discovery';
import { useAppStore } from '../store';
import { songMeta, type RemoteSong } from './online/common';

export default function HomeDiscovery() {
  const songs = useAppStore(state => state.songs);
  const visible = useAppStore(state => state.view === 'home');
  const [session] = useState(createDiscoverySession);
  const [batch, setBatch] = useState<RemoteSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playingKey, setPlayingKey] = useState('');
  const requested = useRef(false);
  const request = useRef(0);
  const playRequest = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError('');
    try {
      const next = await session.next(useAppStore.getState().songs, { limit: 4, signal: pending.signal });
      if (version === request.current && !pending.signal.aborted) setBatch(next);
    } catch (failure) {
      if (version === request.current && !pending.signal.aborted) setError(errorMessage(failure) || '新歌暂时加载失败，请重试。');
    } finally {
      if (version === request.current && !pending.signal.aborted) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!visible || requested.current) return;
    requested.current = true;
    void refresh();
  }, [visible, refresh]);
  useEffect(() => () => {
    requested.current = false;
    controller.current?.abort();
    request.current++;
    playRequest.current++;
  }, []);

  const available = batch.filter(song => isNewDiscoverySong(song, songs));
  const listen = async (song: RemoteSong) => {
    const version = ++playRequest.current;
    setPlayingKey(discoverySongKey(song));
    setError('');
    try {
      const played = await playDiscoverySong(song, available);
      if (version !== playRequest.current) return;
      if (played) { if (useAppStore.getState().view === 'home') useAppStore.getState().setView('player'); }
      else setError('这首歌暂时无法试听，请试试其他歌曲。');
    } catch (failure) {
      if (version === playRequest.current) setError(errorMessage(failure) || '试听暂时不可用，请试试其他歌曲。');
    } finally {
      if (version === playRequest.current) setPlayingKey('');
    }
  };

  return <section className="home-section home-discovery" aria-labelledby="home-discovery-heading" aria-busy={loading}>
    <div className="home-section-heading">
      <div><h2 id="home-discovery-heading">新曲推荐</h2><p>随机发现歌库之外的音乐</p></div>
      <button className="home-text-link" disabled={loading} onClick={() => void refresh()}>{loading ? '寻找新歌…' : '换一批'}<Icon name="refresh" size={15} /></button>
    </div>
    {error && <div className="home-discovery-message" role="alert"><span>{error}</span><button className="home-text-link" disabled={loading} onClick={() => void refresh()}>再试一次</button></div>}
    <div className="home-album-grid">
      {available.map(song => {
        const meta = songMeta(song), key = discoverySongKey(song), pending = playingKey === key;
        return <button className="home-album-card" key={key} disabled={pending} aria-busy={pending} aria-label={`试听新歌 ${meta.name}`} onClick={() => void listen(song)}>
          <span className="home-card-image"><span className="home-artwork"><Cover path={meta.cover} /><span className="home-artwork-disc" aria-hidden="true" /></span><span className="home-card-play"><Icon name="play" size={20} /></span></span>
          <strong title={meta.name}>{meta.name}</strong><span className="home-card-artist" title={meta.artist || '未知艺人'}>{pending ? '正在准备试听…' : meta.artist || '未知艺人'}</span>
        </button>;
      })}
      {loading && !available.length && Array.from({ length: 4 }, (_, index) => <div className="home-discovery-placeholder" key={index} aria-hidden="true"><span /><i /><i /></div>)}
    </div>
    {!loading && !available.length && !error && <p className="home-discovery-message">这一批已在歌库中，换一批继续发现新歌。</p>}
    <p className="home-discovery-source">来自网易云公开歌单 · 喜欢的歌曲可在试听页保存</p>
  </section>;
}
