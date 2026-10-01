import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge, subscribe } from './api';
import { useAppStore } from './store';
import { notify } from './ui';
import type { View } from './types';
import Icon from './components/Icon';
import GlobalUI from './components/GlobalUI';
import PlayerBar from './components/PlayerBar';
import LibraryView from './features/LibraryView';
import PlayerView from './components/PlayerView';
import HomeView from './features/HomeView';
import { usePageMotion } from './components/usePageMotion';
import PageScrollRail from './components/PageScrollRail';
import Sidebar from './components/Sidebar';

const ImportView = lazy(() => import('./features/ImportView'));
const FreeMusicView = lazy(() => import('./features/FreeMusicView'));
const RepairView = lazy(() => import('./features/RepairView'));
const StatsView = lazy(() => import('./features/StatsView'));
const PlaylistView = lazy(() => import('./features/PlaylistView'));
const ManagementView = lazy(() => import('./features/ManagementView'));
const SettingsView = lazy(() => import('./features/SettingsView'));
const pages = { home:HomeView, player:PlayerView, import:ImportView, 'free-music':FreeMusicView, repair:RepairView, stats:StatsView, playlist:PlaylistView, management:ManagementView, settings:SettingsView };

export default function App() {
  const view = useAppStore(state => state.view);
  const loading = useAppStore(state => state.loading);
  const error = useAppStore(state => state.error);
  const opacity = useAppStore(state => state.settings.glassOpacity);
  const intensity = useAppStore(state => state.settings.colorIntensity);
  const themeFollow = useAppStore(state => state.settings.themeFollowCover);
  const [visited,setVisited] = useState(new Set<View>([view]));
  const [maximized,setMaximized] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  usePageMotion(view, loading);
  useEffect(() => { setVisited(previous => previous.has(view) ? previous : new Set([...previous,view])); }, [view]);
  useEffect(() => subscribe('windowAPI','onWindowState',setMaximized), []);
  const control = (method: string) => { void Promise.resolve(getBridge('windowAPI')[method]()).then(value => { if (method === 'toggleMaximize') setMaximized(value === true); }).catch(error => notify(errorMessage(error),'error')); };
  return <div className={`app-shell interface-modern ${view === 'player' ? 'listening-view' : ''} ${themeFollow ? 'cover-theme' : ''}`} style={{ '--glass-opacity':opacity,'--color-intensity':intensity } as React.CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className={`app-backdrop ${themeFollow || view === 'player' ? 'visible' : ''}`} aria-hidden="true" />
    <header className="titlebar">
      <div className="titlebar-brand" aria-label="Wuu 音乐"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-wordmark">wuu<span>.</span></span></div>
      <div className="titlebar-spacer" />
      <div className="window-controls"><button aria-label="最小化" onClick={() => control('minimize')}><Icon name="minimize" size={16} /></button><button aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => control('toggleMaximize')}><Icon name="maximize" size={15} /></button><button className="window-close" aria-label="关闭窗口" onClick={() => control('close')}><Icon name="close" size={16} /></button></div>
    </header>
    <div className="workspace"><Sidebar />
      <main ref={mainContent} className="main-content" id="main-content" tabIndex={-1}>{loading ? <div className="empty loading-state"><span className="loading-disc" /><h2>正在整理你的音乐</h2><p>片刻之后，开始聆听。</p></div> : error ? <div className="empty"><h2>加载失败</h2><p>{error}</p><button onClick={() => location.reload()}>重试</button></div> : <>
        <div className="page-host" data-page="library" hidden={!['list','liked'].includes(view)}><LibraryView /></div>
        {Object.entries(pages).filter(([key]) => key === 'home' || key === 'player' || visited.has(key as View) || key === view).map(([key,Page]) => <div className="page-host" data-page={key} hidden={key !== view} key={key}><Suspense fallback={<div className="empty">正在加载…</div>}><Page /></Suspense></div>)}
      </>}</main>
      <PageScrollRail content={mainContent} view={view} loading={loading || !!error} />
    </div>
    <PlayerBar /><GlobalUI />
  </div>;
}
