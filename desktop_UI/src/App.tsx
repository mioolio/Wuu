import { lazy, Suspense, useEffect, useState } from 'react';
import { errorMessage, getBridge, mediaUrl, subscribe } from './api';
import { useAppStore } from './store';
import { notify } from './ui';
import type { View } from './types';
import Icon from './components/Icon';
import GlobalUI from './components/GlobalUI';
import PlayerBar from './components/PlayerBar';
import LibraryView from './features/LibraryView';

const PlayerView = lazy(() => import('./components/PlayerView'));
const HomeView = lazy(() => import('./features/HomeView'));
const ImportView = lazy(() => import('./features/ImportView'));
const FreeMusicView = lazy(() => import('./features/FreeMusicView'));
const RepairView = lazy(() => import('./features/RepairView'));
const StatsView = lazy(() => import('./features/StatsView'));
const PlaylistView = lazy(() => import('./features/PlaylistView'));
const ManagementView = lazy(() => import('./features/ManagementView'));
const SettingsView = lazy(() => import('./features/SettingsView'));
const navigation: { view: View; label: string; icon: string }[] = [
  { view:'home',label:'推荐',icon:'home' }, { view:'list',label:'音乐列表',icon:'list' },
  { view:'liked',label:'我的歌单',icon:'heart' }, { view:'player',label:'正在播放',icon:'music' },
  { view:'import',label:'音乐导入',icon:'import' }, { view:'free-music',label:'免费听音乐',icon:'search' },
  { view:'repair',label:'修复中心',icon:'repair' }, { view:'stats',label:'音乐统计',icon:'stats' },
  { view:'playlist',label:'歌单分享',icon:'share' }, { view:'management',label:'不推荐管理',icon:'dislike' },
];
const pages = { home:HomeView, player:PlayerView, import:ImportView, 'free-music':FreeMusicView, repair:RepairView, stats:StatsView, playlist:PlaylistView, management:ManagementView, settings:SettingsView };
const groups = [
  { title:'聆听', views:['home','player','free-music'] },
  { title:'我的音乐', views:['list','liked','import'] },
  { title:'音乐工具', views:['stats','playlist','repair','management'] },
];

export default function App() {
  const view = useAppStore(state => state.view);
  const loading = useAppStore(state => state.loading);
  const error = useAppStore(state => state.error);
  const opacity = useAppStore(state => state.settings.glassOpacity);
  const intensity = useAppStore(state => state.settings.colorIntensity);
  const themeFollow = useAppStore(state => state.settings.themeFollowCover);
  const cover = useAppStore(state => state.player.preview?.cover || state.player.song?.coverPath);
  const songCount = useAppStore(state => state.songs.length);
  const collectionCount = useAppStore(state => state.collections.length);
  const playing = useAppStore(state => state.player.playing);
  const [visited,setVisited] = useState(new Set<View>([view]));
  const [maximized,setMaximized] = useState(false);
  useEffect(() => { setVisited(previous => previous.has(view) ? previous : new Set([...previous,view])); }, [view]);
  useEffect(() => subscribe('windowAPI','onWindowState',setMaximized), []);
  const control = (method: string) => { void Promise.resolve(getBridge('windowAPI')[method]()).then(value => { if (method === 'toggleMaximize') setMaximized(value === true); }).catch(error => notify(errorMessage(error),'error')); };
  const currentLabel = navigation.find(item => item.view === view)?.label || '设置';
  return <div className="app-shell" style={{ '--glass-opacity':opacity,'--color-intensity':intensity } as React.CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className={`app-backdrop ${themeFollow || view === 'player' ? 'visible' : ''}`} style={{ backgroundImage:cover ? `url("${mediaUrl(cover)}")` : undefined }} />
    <header className="titlebar">
      <div className="titlebar-brand" aria-label="Wuu 音乐"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-wordmark">wuu<span>.</span></span></div>
      <div className="titlebar-context"><span>你的音乐空间</span><span className="context-divider">/</span><strong>{currentLabel}</strong></div>
      <div className="titlebar-status"><span className={`status-dot ${playing ? 'playing' : ''}`} />{playing ? '音乐正在发生' : '让喜欢，随时响起'}</div>
      <div className="window-controls"><button aria-label="最小化" onClick={() => control('minimize')}><Icon name="minimize" size={16} /></button><button aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => control('toggleMaximize')}><Icon name="maximize" size={15} /></button><button className="window-close" aria-label="关闭窗口" onClick={() => control('close')}><Icon name="close" size={16} /></button></div>
    </header>
    <div className="workspace"><nav className="sidebar" aria-label="主导航">
      <div className="sidebar-scroll">{groups.map(group => <div className="nav-group" key={group.title}>
        <div className="nav-group-label">{group.title}</div>
        {group.views.map(key => {
          const item = navigation.find(entry => entry.view === key)!;
          return <button key={item.view} className={view === item.view ? 'active' : ''} aria-label={item.label} aria-current={view === item.view ? 'page' : undefined} title={item.label} onClick={() => useAppStore.getState().setView(item.view)}>
            <Icon name={item.icon} size={19} style={item.icon === 'dislike' ? { transform:'rotate(180deg)' } : undefined} /><span className="nav-label">{item.label}</span>
            {item.view === 'list' && <span className="nav-count" aria-hidden="true">{songCount}</span>}
            {item.view === 'liked' && <span className="nav-count" aria-hidden="true">{collectionCount}</span>}
            {item.view === 'player' && playing && <span className="nav-playing" aria-hidden="true"><i /><i /><i /></span>}
          </button>;
        })}
      </div>)}</div>
      <div className="sidebar-bottom"><div className="library-status"><Icon name="headphones" size={18} /><span><strong>私人音乐库</strong><small>{songCount} 首音乐，随心聆听</small></span></div>
        <button className={view === 'settings' ? 'active' : ''} aria-label="设置" aria-current={view === 'settings' ? 'page' : undefined} title="设置" onClick={() => useAppStore.getState().setView('settings')}><Icon name="settings" size={19} /><span className="nav-label">设置</span></button>
      </div>
    </nav>
      <main className="main-content" id="main-content" tabIndex={-1}>{loading ? <div className="empty loading-state"><span className="loading-disc" /><h2>正在整理你的音乐</h2><p>片刻之后，开始聆听。</p></div> : error ? <div className="empty"><h2>加载失败</h2><p>{error}</p><button onClick={() => location.reload()}>重试</button></div> : <>
        <div className="page-host" hidden={!['list','liked'].includes(view)}><LibraryView /></div>
        {Object.entries(pages).filter(([key]) => visited.has(key as View) || key === view).map(([key,Page]) => <div className="page-host" hidden={key !== view} key={key}><Suspense fallback={<div className="empty">正在加载…</div>}><Page /></Suspense></div>)}
      </>}</main>
    </div>
    <PlayerBar /><GlobalUI />
  </div>;
}
