import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './design-system.css';
import App from './App';
import DesktopLyrics from './components/DesktopLyrics';
import { errorMessage } from './api';
import { disposeSongMetadata, persistNow } from './store';
import { playerService } from './services/player';
import { notify } from './ui';

class ErrorBoundary extends Component<{ children:ReactNode },{ error:string }> {
  state = { error:'' };
  static getDerivedStateFromError(error:unknown) { return { error:errorMessage(error) }; }
  componentDidCatch(error:Error,info:ErrorInfo) { console.error('Wuu 界面错误',error,info.componentStack); }
  render() { return this.state.error ? <div className="empty"><h1>界面加载失败</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>重新加载</button></div> : this.props.children; }
}

const lyricsWindow = new URLSearchParams(location.search).get('window') === 'lyrics';
if (lyricsWindow) document.documentElement.classList.add('lyrics-window');
createRoot(document.getElementById('root')!).render(<ErrorBoundary>{lyricsWindow ? <DesktopLyrics /> : <App />}</ErrorBoundary>);

if (!lyricsWindow) {
  void playerService.initialize().catch(error => notify(errorMessage(error),'error'));
  const keyboard = (event:KeyboardEvent) => {
    if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,button,a,summary,[contenteditable="true"],[role="separator"],[role="dialog"],[role="menu"]') || document.querySelector('[role="dialog"]'))) return;
    if (event.code === 'Space') { event.preventDefault(); playerService.toggle(); }
    if (event.ctrlKey && event.key === 'ArrowRight') { event.preventDefault(); playerService.next(1); }
    if (event.ctrlKey && event.key === 'ArrowLeft') { event.preventDefault(); playerService.next(-1); }
  };
  document.addEventListener('keydown',keyboard);
  const unload = () => { playerService.dispose(); disposeSongMetadata(); persistNow(true); };
  window.addEventListener('beforeunload',unload);
  import.meta.hot?.dispose(() => { document.removeEventListener('keydown',keyboard); window.removeEventListener('beforeunload',unload); playerService.dispose(); disposeSongMetadata(); });
}
