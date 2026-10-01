import { useEffect, useState } from 'react';
import Cover from './Cover';

type Status = 'loading' | 'ready' | 'error';
interface Artwork { path?: string | null; previous?: string | null; status: Status }

/** Load the displayed image itself: background decoding must never expire a valid cover. */
export default function RecordArtwork({ path, disc, playing }: { path?: string | null; disc: boolean; playing: boolean }) {
  const [artwork, setArtwork] = useState<Artwork>({ path, status: path ? 'loading' : 'ready' });
  if (artwork.path !== path) {
    const lastReady = artwork.status === 'ready' ? artwork.path : artwork.previous;
    setArtwork({ path, previous: lastReady === path ? null : lastReady, status: !path || lastReady === path ? 'ready' : 'loading' });
  }
  const settle = (status: Status) => setArtwork(active => active.path === path ? { ...active, status } : active);
  useEffect(() => {
    if (!artwork.previous || artwork.status === 'loading') return;
    const timer = window.setTimeout(() => setArtwork(active => active === artwork ? { ...active, previous: null } : active), 700);
    return () => window.clearTimeout(timer);
  }, [artwork]);

  const loading = artwork.status === 'loading';
  const coverClass = `player-cover ${disc ? 'disc' : ''} ${playing ? 'playing' : ''}`;
  return <div className={`record-sleeve ${disc ? 'is-disc' : ''}`} aria-busy={loading}>
    <div className="record-halo" aria-hidden="true" />
    <div className="record-artwork-stack">
      {artwork.previous && <div className={`artwork-layer ${loading ? '' : 'artwork-outgoing'}`} key={artwork.previous} aria-hidden="true"><Cover path={artwork.previous} className={coverClass} eager /></div>}
      {loading && !artwork.previous && <div className="artwork-layer artwork-placeholder" aria-hidden="true"><Cover className={coverClass} /></div>}
      <div className={`artwork-layer ${loading ? 'artwork-pending' : artwork.previous ? 'artwork-incoming' : ''}`} key={path || 'empty'}>
        <Cover path={path} className={coverClass} eager onLoad={() => settle('ready')} onError={() => settle('error')} onRetry={() => settle('loading')} />
      </div>
    </div>
    {loading && <span className="artwork-loading-label" role="status">正在加载封面…</span>}
  </div>;
}
