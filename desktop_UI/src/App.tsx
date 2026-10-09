import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge, subscribe } from './api';
import { useAppStore } from './store';
import { notify } from './ui';
import type { View } from './types';
import WindowControls from './components/WindowControls';
import GlobalUI from './components/GlobalUI';
import PlayerBar from './components/PlayerBar';
import LibraryView from './features/LibraryView';
import PlayerView from './components/PlayerView';
import HomeView from './features/HomeView';
import { usePageMotion } from './components/usePageMotion';
import PageScrollRail from './components/PageScrollRail';
import Sidebar from './components/Sidebar';
import { playerService } from './services/player';

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
  const appleStyle = useAppStore(state => state.settings.experimentalAppleUI);
  const appleControlsPosition = useAppStore(state => state.settings.appleControlsPosition);
  const frostedGlass = useAppStore(state => state.settings.experimentalFrostedGlass);
  const hydrated = useAppStore(state => state.hydrated);
  const [visited,setVisited] = useState(new Set<View>([view]));
  const [maximized,setMaximized] = useState(false);
  const [showStartup,setShowStartup] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  usePageMotion(view, loading);
  useEffect(() => { setVisited(previous => previous.has(view) ? previous : new Set([...previous,view])); }, [view]);
  useEffect(() => subscribe('windowAPI','onWindowState',setMaximized), []);
  useEffect(() => {
    if (!hydrated || typeof window.windowAPI?.setFrostedGlass !== 'function') return;
    let disposed = false;
    void Promise.resolve(window.windowAPI.setFrostedGlass(frostedGlass)).then(result => {
      if (!disposed && !result.ok && result.supported) notify(result.reason || '磨砂玻璃应用失败', 'error');
    }).catch(error => { if (!disposed) notify(errorMessage(error), 'error'); });
    return () => { disposed = true; };
  }, [hydrated, frostedGlass]);
  useEffect(() => {
    if (!loading) { setShowStartup(false); return; }
    // Only delay the notice: pages and playback remain available immediately.
    const timer = setTimeout(() => setShowStartup(true), 500);
    return () => clearTimeout(timer);
  }, [loading]);
  const retryStartup = () => {
    void useAppStore.getState().initialize().then(() => playerService.initialize()).catch(error => notify(errorMessage(error), 'error'));
  };
  const control = (method: string) => { void Promise.resolve(getBridge('windowAPI')[method]()).then(value => { if (method === 'toggleMaximize') setMaximized(value === true); }).catch(error => notify(errorMessage(error),'error')); };
  const controlsOnLeft = appleStyle && appleControlsPosition === 'left';
  const controlsPosition = controlsOnLeft ? 'left' : 'right';
  const windowControls = <WindowControls appleStyle={appleStyle} position={controlsPosition} maximized={maximized} onControl={control} />;
  return <div className={`app-shell interface-modern ${appleStyle ? 'apple-ui' : ''} ${view === 'player' ? 'listening-view' : ''} ${themeFollow ? 'cover-theme' : ''}`} style={{ '--glass-opacity':opacity,'--color-intensity':intensity } as React.CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className={`app-backdrop ${themeFollow || view === 'player' ? 'visible' : ''}`} aria-hidden="true" />
    <header className="titlebar" data-window-style={appleStyle ? 'apple' : 'default'} data-controls-position={controlsPosition}>
      {controlsOnLeft && windowControls}
      <div className="titlebar-brand" aria-label="Wuu 音乐"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-wordmark">wuu<span>.</span></span></div>
      <div className="titlebar-spacer" />
      {!controlsOnLeft && windowControls}
    </header>
    {(error || (showStartup && loading)) && <div className="library-startup-status" role={error ? 'alert' : 'status'}>
      <span>{error ? `读取未完成：${error}` : '正在读取歌库，已载入的歌曲可以先播放。'}</span>
      {error && <button type="button" onClick={retryStartup}>重试</button>}
    </div>}
    <div className="workspace"><Sidebar />
      <main ref={mainContent} className="main-content" id="main-content" tabIndex={-1}>
        <div className="page-host" data-page="library" hidden={!['list','liked'].includes(view)}><LibraryView /></div>
        {Object.entries(pages).filter(([key]) => key === 'home' || key === 'player' || visited.has(key as View) || key === view).map(([key,Page]) => <div className="page-host" data-page={key} hidden={key !== view} key={key}><Suspense fallback={<div className="empty">正在加载…</div>}><Page /></Suspense></div>)}
      </main>
      <PageScrollRail content={mainContent} view={view} loading={false} />
    </div>
    <PlayerBar /><GlobalUI />
  </div>;
}
