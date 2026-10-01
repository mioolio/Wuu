import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api';
import Icon from './Icon';

// A recovered sleeve also wakes a failed thumbnail of the same image. Keep only
// recent success evidence, never image data or an unbounded library-sized cache.
let loadVersion = 0;
const successfulLoads = new Map<string, number>();
const loadListeners = new Set<(source: string) => void>();
function coverLoaded(source: string) {
  successfulLoads.delete(source);
  successfulLoads.set(source, ++loadVersion);
  if (successfulLoads.size > 128) successfulLoads.delete(successfulLoads.keys().next().value!);
  loadListeners.forEach(listener => listener(source));
}

interface CoverProps {
  path?: string | null;
  className?: string;
  eager?: boolean;
  onLoad?: () => void;
  onError?: () => void;
  onRetry?: () => void;
}

export default function Cover(props: CoverProps) {
  // A new source must not inherit a failed request or callbacks from the last song.
  return <CoverImage key={props.path || ''} {...props} />;
}

function CoverImage({ path, className = '', eager = false, onLoad, onError, onRetry }: CoverProps) {
  const source = mediaUrl(path);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLSpanElement>(null);
  const needsRetry = useRef(false);
  const retriedAutomatically = useRef(false);
  const requestVersion = useRef(loadVersion);
  const retryCallback = useRef(onRetry);
  retryCallback.current = onRetry;

  useEffect(() => {
    if (!failed || !path) return;
    const target = container.current;
    if (!target) return;
    const retry = () => {
      if (!needsRetry.current || document.visibilityState === 'hidden' || !target.getClientRects().length) return;
      needsRetry.current = false;
      requestVersion.current = loadVersion;
      setFailed(false);
      setAttempt(value => value + 1);
      retryCallback.current?.();
    };
    const retryRecoveredSource = (loadedSource: string) => {
      if (loadedSource === source && (successfulLoads.get(source) || 0) > requestVersion.current) retry();
    };
    loadListeners.add(retryRecoveredSource);
    retryRecoveredSource(source);
    // Retry a transient failure once, then wait for a meaningful recovery event.
    const timer = window.setTimeout(() => {
      if (retriedAutomatically.current || document.visibilityState === 'hidden' || !target.getClientRects().length) return;
      retriedAutomatically.current = true;
      retry();
    }, 1200);
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('focus', retry);
    window.addEventListener('online', retry);
    window.addEventListener('pageshow', retry);
    // Kept-alive pages can become visible without a document visibility event.
    let wasVisible = !!target.getClientRects().length;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible && !wasVisible) retry();
      wasVisible = visible;
    });
    observer.observe(target);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      loadListeners.delete(retryRecoveredSource);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('focus', retry);
      window.removeEventListener('online', retry);
      window.removeEventListener('pageshow', retry);
    };
  }, [failed, path, source]);

  return <span ref={container} className={`cover-thumb ${className}`}>
    {path && !failed ? <img key={attempt} src={source} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async"
      onLoad={() => { needsRetry.current = false; coverLoaded(source); onLoad?.(); }}
      onError={() => { needsRetry.current = true; setFailed(true); onError?.(); }} /> : <Icon name="music" />}
  </span>;
}
