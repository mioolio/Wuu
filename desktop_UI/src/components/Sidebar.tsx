import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useAppStore } from '../store';
import type { View } from '../types';
import { fitSidebarWidth, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_MIN_WIDTH, sidebarWidthLimit } from '../services/sidebarPreferences';
import Icon from './Icon';
import NavigationMarker from './NavigationMarker';
import './sidebar.css';

const navigation: { view: View; label: string; icon: string }[] = [
  { view: 'home', label: '推荐', icon: 'home' },
  { view: 'list', label: '音乐列表', icon: 'list' },
  { view: 'liked', label: '我的歌单', icon: 'heart' },
  { view: 'player', label: '正在播放', icon: 'music' },
  { view: 'import', label: '音乐导入', icon: 'import' },
  { view: 'free-music', label: '免费听音乐', icon: 'search' },
  { view: 'repair', label: '修复中心', icon: 'repair' },
  { view: 'stats', label: '音乐统计', icon: 'stats' },
  { view: 'playlist', label: '歌单分享', icon: 'share' },
  { view: 'management', label: '不推荐管理', icon: 'dislike' },
];
const groups: { label: string; views: View[] }[] = [
  { label: '聆听', views: ['home', 'player', 'free-music'] },
  { label: '我的音乐', views: ['list', 'liked', 'import'] },
  { label: '音乐工具', views: ['stats', 'playlist', 'repair', 'management'] },
];
interface ResizeSession { pointerId: number; startX: number; startWidth: number; width: number; moved: boolean }

export default function Sidebar() {
  const view = useAppStore(state => state.view);
  const collapsedPreference = useAppStore(state => state.settings.sidebarCollapsed);
  const savedWidth = useAppStore(state => state.settings.sidebarWidth);
  const songCount = useAppStore(state => state.songs.length);
  const collectionCount = useAppStore(state => state.collections.length);
  const playing = useAppStore(state => state.player.playing);
  const setSettings = useAppStore(state => state.setSettings);
  const setView = useAppStore(state => state.setView);
  const navigationElement = useRef<HTMLElement>(null);
  const resizeSession = useRef<ResizeSession | null>(null);
  const contentId = useId();
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const collapsed = draftWidth === null && collapsedPreference;
  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : fitSidebarWidth(draftWidth ?? savedWidth, workspaceWidth);
  const maximumWidth = sidebarWidthLimit(workspaceWidth);

  useLayoutEffect(() => {
    const workspace = navigationElement.current?.parentElement;
    if (!workspace) return;
    const measure = () => setWorkspaceWidth(workspace.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    measure();
    return () => observer.disconnect();
  }, []);

  const toggle = () => setSettings({ sidebarCollapsed: !collapsedPreference });
  const finishResize = (event: PointerEvent<HTMLDivElement>, save: boolean) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resizeSession.current = null;
    if (save && session.moved) setSettings({ sidebarCollapsed: false, sidebarWidth: session.width });
    setDraftWidth(null);
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSession.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width, moved: false };
    setResizing(true);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const delta = event.clientX - session.startX;
    if (!session.moved && Math.abs(delta) < 4) return;
    session.moved = true;
    session.width = fitSidebarWidth(session.startWidth + delta, workspaceWidth);
    setDraftWidth(session.width);
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && resizeSession.current) {
      const session = resizeSession.current;
      resizeSession.current = null;
      setDraftWidth(null); setResizing(false);
      if (event.currentTarget.hasPointerCapture(session.pointerId)) event.currentTarget.releasePointerCapture(session.pointerId);
      event.preventDefault(); event.stopPropagation();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (resizing) return;
    if (event.key === 'Enter') { toggle(); return; }
    if (collapsed && ['ArrowLeft', 'Home'].includes(event.key)) return;
    const step = event.shiftKey ? 24 : 8;
    const nextWidth = event.key === 'Home' ? SIDEBAR_MIN_WIDTH : event.key === 'End' ? maximumWidth
      : collapsed ? savedWidth : width + (event.key === 'ArrowRight' ? step : -step);
    setSettings({ sidebarCollapsed: false, sidebarWidth: fitSidebarWidth(nextWidth, workspaceWidth) });
  };
  const navButton = (item: { view: View; label: string; icon: string }) => <button key={item.view} className={view === item.view ? 'active' : ''} aria-label={item.label} aria-current={view === item.view ? 'page' : undefined} title={item.label} onClick={() => setView(item.view)}>
    <Icon name={item.icon} size={19} style={item.icon === 'dislike' ? { transform: 'rotate(180deg)' } : undefined} />
    <span className="nav-label">{item.label}</span>
    {item.view === 'list' && <span className="nav-count" aria-hidden="true">{songCount}</span>}
    {item.view === 'liked' && <span className="nav-count" aria-hidden="true">{collectionCount}</span>}
    {item.view === 'player' && playing && <span className="nav-playing" aria-hidden="true"><i /><i /><i /></span>}
  </button>;

  return <nav ref={navigationElement} className="sidebar collapsible-sidebar" aria-label="主导航" data-collapsed={collapsed} data-resizing={resizing} style={{ '--sidebar-size': `${width}px` } as CSSProperties}>
    <div className="sidebar-toolbar"><button className="sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} aria-controls={contentId} title={collapsed ? '展开侧栏' : '收起侧栏'} onClick={toggle}><Icon name="back" size={17} style={collapsed ? { transform: 'rotate(180deg)' } : undefined} /><span className="sidebar-toggle-label">收起侧栏</span></button></div>
    <div id={contentId} className="sidebar-scroll">{groups.map(group => <div className="nav-group" key={group.label} role="group" aria-label={group.label}><div className="nav-group-label" aria-hidden="true">{group.label}</div>{group.views.map(target => navButton(navigation.find(item => item.view === target)!))}</div>)}</div>
    <div className="sidebar-bottom">{navButton({ view: 'settings', label: '设置', icon: 'settings' })}</div>
    <NavigationMarker navigation={navigationElement} view={view} />
    <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls={contentId} aria-valuemin={collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_MIN_WIDTH} aria-valuemax={maximumWidth} aria-valuenow={width} aria-valuetext={collapsed ? '侧栏已收起，向右拖动或按右方向键展开' : `${width} 像素`} title="拖动调整侧栏宽度，双击收起；方向键也可调整" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={event => finishResize(event, true)} onPointerCancel={event => finishResize(event, false)} onLostPointerCapture={event => finishResize(event, false)} onDoubleClick={toggle} onKeyDown={resizeWithKeyboard} />
  </nav>;
}
