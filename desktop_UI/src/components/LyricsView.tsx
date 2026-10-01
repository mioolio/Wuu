import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAppStore } from '../store';
import { activeLyricIndex, lineText, lineTime, parseLyrics, type LyricLine } from '../services/lyrics';
import { playerService, isVideo } from '../services/player';
import Icon from './Icon';
import './lyrics-view.css';

interface Word { text: string; start: number; end: number }
interface LineMetrics { index: number; width: number; overflow: number; words: { left: number; width: number }[] }

function groupStart(lines: LyricLine[], index: number): number {
  // Track changes render the new (possibly empty) lyrics before active state resets.
  if (!lines.length || index < 0) return -1;
  index = Math.min(index, lines.length - 1);
  while (index > 0 && lineTime(lines[index - 1]) === lineTime(lines[index])) index--;
  return index;
}

function wordsForLine(line: LyricLine, next: LyricLine | undefined, duration: number, simulate: boolean): Word[] {
  if ('chars' in line) return line.chars.map(word => ({ text: word.text, start: line.start + word.offset, end: line.start + word.offset + word.dur }));
  if (!simulate) return [{ text: line.text, start: line.time, end: line.time }];
  const text = [...line.text];
  const interval = Math.max(0.2, Math.min(12, (next ? lineTime(next) : duration || line.time + 4) - line.time));
  return text.map((word, index) => ({ text: word, start: line.time + index * interval / text.length, end: line.time + (index + 1) * interval / text.length }));
}

export default function LyricsView() {
  const text = useAppStore(state => state.player.lyricText);
  const song = useAppStore(state => state.player.song);
  const preview = useAppStore(state => state.player.preview);
  const visible = useAppStore(state => state.view === 'player');
  const loading = useAppStore(state => state.player.loading);
  const duration = useAppStore(state => state.player.duration);
  const settings = useAppStore(state => state.settings);
  const video = isVideo(song, preview);
  const songKey = preview?.url || song?.audioPath || '';
  const data = useMemo(() => parseLyrics(text, video), [text, video]);
  const words = useMemo(() => data.lines.map((line, index) => {
    let next = index + 1;
    // Original text and its translation may share a timestamp.
    while (next < data.lines.length && lineTime(data.lines[next]) === lineTime(line)) next++;
    return wordsForLine(line, data.lines[next], duration, settings.simulateLrcProgress);
  }), [data, duration, settings.simulateLrcProgress]);
  // A single untimed line is still plain text; a real [00:00] line is seekable.
  const synced = data.raw || /\[\d{1,3}[.:]\d{1,2}(?:[.:]\d{1,3})?\]/.test(text);
  const hasLyrics = text.split(/\r?\n/).some(line => line.trim() && !/^\s*\[[^\]]+\]\s*$/.test(line));
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const container = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[][]>([]);
  const tracks = useRef<(HTMLSpanElement | null)[]>([]);
  const activeRef = useRef(-1);
  const followingRef = useRef(true);
  const keyboardBrowsing = useRef(false);
  const pointerBrowsing = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marqueeOffset = useRef(0);
  const metrics = useRef<LineMetrics | null>(null);
  const refresh = useRef<(snap?: boolean) => void>(() => {});

  const centerLine = useCallback((index: number, immediate = false) => {
    const box = container.current;
    const last = Math.max(0, index);
    const node = lines.current[groupStart(data.lines, last)];
    const end = lines.current[last];
    if (!box || !node || !end || !synced) return;
    const startRect = node.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();
    const top = box.scrollTop + startRect.top - box.getBoundingClientRect().top - (box.clientHeight - (endRect.bottom - startRect.top)) / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: reducedMotionRef.current || immediate ? 'instant' : 'smooth' });
  }, [data.lines, synced]);

  const clearResume = useCallback(() => {
    if (resumeTimer.current !== null) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  }, []);

  const returnToCurrent = useCallback(() => {
    clearResume();
    followingRef.current = true;
    setFollowing(true);
    centerLine(activeRef.current);
  }, [centerLine, clearResume]);

  const pauseFollowing = useCallback((hold = false) => {
    if (!synced) return;
    clearResume();
    followingRef.current = false;
    setFollowing(false);
    const box = container.current;
    if (box) box.scrollTo({ top: box.scrollTop, behavior: 'instant' });
    // This timer runs independently of audio frames, including while paused.
    if (!hold && !keyboardBrowsing.current && !pointerBrowsing.current) resumeTimer.current = setTimeout(returnToCurrent, 6000);
  }, [clearResume, returnToCurrent, synced]);

  useEffect(() => {
    const release = () => {
      if (!pointerBrowsing.current) return;
      pointerBrowsing.current = false;
      if (!followingRef.current) pauseFollowing();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [pauseFollowing]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    clearResume();
    activeRef.current = -1;
    marqueeOffset.current = 0;
    metrics.current = null;
    followingRef.current = true;
    keyboardBrowsing.current = false;
    pointerBrowsing.current = false;
    setActive(-1);
    setFollowing(true);
    lines.current = lines.current.slice(0, words.length);
    tracks.current = tracks.current.slice(0, words.length);
    wordRefs.current = wordRefs.current.slice(0, words.length);
    wordRefs.current.forEach(row => row?.forEach(node => {
      if (node) { node.style.opacity = ''; node.style.removeProperty('--word-progress'); }
    }));
    if (container.current) container.current.scrollTop = 0;
    return clearResume;
  }, [data, songKey, clearResume]);

  useLayoutEffect(() => {
    if (!visible || !synced || !hasLyrics) return;
    const media = playerService.media;
    let frame = 0;
    let previousFrame = 0;
    const draw = (now: number, snap = false) => {
      frame = 0;
      const time = media.currentTime || 0;
      const index = activeLyricIndex(data.lines, time);
      if (index !== activeRef.current) {
        const oldIndex = activeRef.current;
        for (let row = groupStart(data.lines, oldIndex); row <= oldIndex; row++) {
          wordRefs.current[row]?.forEach(node => { if (node) node.style.opacity = ''; });
          if (tracks.current[row]) tracks.current[row]!.style.transform = '';
        }
        activeRef.current = index;
        marqueeOffset.current = 0;
        setActive(index);
      }
      const first = groupStart(data.lines, index);
      const geometry = metrics.current?.index === first ? metrics.current : null;
      let fill = 0;
      for (let row = first; row <= index; row++) words[row]?.forEach((word, wordIndex) => {
        const progress = word.end <= word.start ? (time >= word.start ? 1 : 0) : Math.max(0, Math.min(1, (time - word.start) / (word.end - word.start)));
        const node = wordRefs.current[row]?.[wordIndex];
        if (node) {
          node.style.setProperty('--word-progress', `${progress * 100}%`);
          node.style.opacity = String(progress >= 1 ? settings.lyricDone : 1);
        }
        const bounds = row === first ? geometry?.words[wordIndex] : null;
        if (bounds && progress > 0) fill = Math.max(fill, bounds.left + bounds.width * progress);
      });
      const track = tracks.current[first];
      if (geometry && track) {
        const delay = time - lineTime(data.lines[index]) < settings.marqueePause;
        const desired = delay ? 0 : Math.max(0, Math.min(geometry.overflow, fill - geometry.width * 0.7));
        const seconds = previousFrame ? Math.min(0.064, (now - previousFrame) / 1000) : 1 / 60;
        const delta = desired - marqueeOffset.current;
        // Honor pixels/second instead of tying speed to the monitor's refresh rate.
        marqueeOffset.current = snap ? desired : marqueeOffset.current + Math.sign(delta) * Math.min(Math.abs(delta), Math.max(1, settings.marqueeSpeed) * seconds);
        track.style.transform = `translate3d(${-marqueeOffset.current}px, 0, 0)`;
      }
      previousFrame = now;
      if (!media.paused) frame = requestAnimationFrame(draw);
    };
    const redraw = (snap = false) => {
      cancelAnimationFrame(frame);
      draw(performance.now(), snap);
    };
    refresh.current = redraw;
    const update = () => { if (media.paused) redraw(true); };
    const seek = () => redraw(true);
    const play = () => redraw();
    const pause = () => redraw();
    media.addEventListener('play', play);
    media.addEventListener('pause', pause);
    media.addEventListener('seeked', seek);
    media.addEventListener('timeupdate', update);
    redraw(true);
    return () => {
      cancelAnimationFrame(frame);
      refresh.current = () => {};
      media.removeEventListener('play', play);
      media.removeEventListener('pause', pause);
      media.removeEventListener('seeked', seek);
      media.removeEventListener('timeupdate', update);
    };
  }, [data, words, songKey, visible, synced, hasLyrics, settings.marqueePause, settings.marqueeSpeed, settings.lyricDone]);

  useLayoutEffect(() => {
    const box = container.current;
    if (!box || !visible) return;
    const first = groupStart(data.lines, active);
    const line = lines.current[first];
    const track = tracks.current[first];
    const measure = (resize = false) => {
      box.style.setProperty('--lyrics-half-height', `${box.clientHeight / 2}px`);
      metrics.current = null;
      if (line && track) {
        track.style.transform = '';
        line.dataset.marquee = 'false';
        if (settings.marqueeEnabled && !reducedMotion) {
          line.dataset.marquee = 'measure';
          const width = line.clientWidth;
          const textWidth = track.offsetWidth;
          const overflow = textWidth - width;
          if (width > 0 && overflow > 1 && textWidth > width * Math.max(1, settings.marqueeThreshold)) {
            line.dataset.marquee = 'true';
            metrics.current = { index: first, width, overflow, words: (wordRefs.current[first] || []).map(node => ({ left: node?.offsetLeft || 0, width: node?.offsetWidth || 0 })) };
          } else line.dataset.marquee = 'false';
        }
      }
      // Read dimensions on line/size changes, never in the audio animation loop.
      refresh.current(true);
      if (followingRef.current) centerLine(active, resize);
    };
    measure();
    let measuredWidth = box.clientWidth;
    let measuredHeight = box.clientHeight;
    const observer = new ResizeObserver(() => {
      if (measuredWidth === box.clientWidth && measuredHeight === box.clientHeight) return;
      measuredWidth = box.clientWidth;
      measuredHeight = box.clientHeight;
      measure(true);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      if (line) delete line.dataset.marquee;
      if (track) track.style.transform = '';
    };
  }, [active, words, songKey, visible, reducedMotion, settings.marqueeEnabled, settings.marqueeThreshold, settings.lyricSize, settings.interfaceMode, centerLine]);

  useEffect(() => {
    if (!visible) clearResume();
    else if (!followingRef.current) returnToCurrent();
  }, [visible, clearResume, returnToCurrent]);

  const seekLine = (index: number) => {
    playerService.seek(lineTime(data.lines[index]));
    clearResume();
    followingRef.current = true;
    keyboardBrowsing.current = false;
    setFollowing(true);
    refresh.current(true);
    centerLine(index);
  };
  const style = {
    '--lyric-active': settings.progressColorEnabled ? settings.progressColor : 'var(--cover-accent, var(--accent))',
    '--lyric-active-end': settings.progressColorEnabled ? settings.progressColor2 || settings.progressColor : 'var(--cover-accent-secondary, var(--cover-accent, var(--accent)))',
    '--lyric-size': `${settings.lyricSize}px`,
    '--lyric-wait-color': 'color-mix(in srgb, var(--text) 88%, transparent)',
  } as CSSProperties;
  const firstActive = groupStart(data.lines, active);

  return <section className={`lyrics-panel polished-lyrics ${!synced ? 'unsynced-lyrics' : ''}`} aria-label="歌词" style={style}>
    {!hasLyrics ? <div className="lyrics-empty" role="status"><Icon name="headphones" size={30} /><p>{loading ? '正在载入歌词' : '让旋律陪你片刻'}</p><span>{loading ? '音乐与文字，即将相遇' : '这首歌暂时没有歌词'}</span></div> : <>
      <div className="lyrics-scroll" ref={container} tabIndex={0} aria-label={synced ? '歌词，点击任意一句可跳转播放' : '未同步歌词'} onWheel={() => pauseFollowing()}
        onPointerDown={event => { if (event.isPrimary && event.button === 0) { pointerBrowsing.current = true; pauseFollowing(true); } }}
        onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pauseFollowing(); }}
        onFocusCapture={event => { if (event.target.matches(':focus-visible')) { keyboardBrowsing.current = true; pauseFollowing(true); } }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { keyboardBrowsing.current = false; pauseFollowing(); } }}>
        <div className="lyrics-lines" key={songKey}>{data.lines.map((line, index) => {
          const current = synced && active >= 0 && index >= firstActive && index <= active;
          const passed = synced && active > index;
          const stamp = `${Math.floor(lineTime(line) / 60)}:${String(Math.floor(lineTime(line) % 60)).padStart(2, '0')}`;
          return <button key={`${index}:${lineTime(line)}:${lineText(line)}`} type="button" ref={node => { lines.current[index] = node; }}
            className={`lyric-line ${current ? 'current' : ''} ${current && index > firstActive ? 'lyric-companion' : ''} ${passed && !current ? 'passed' : ''}`} aria-current={current ? 'true' : undefined}
            title={synced ? `从 ${stamp} 播放` : undefined} aria-label={synced ? `${lineText(line)}，从 ${stamp} 播放` : undefined}
            disabled={!synced || !duration} onClick={() => seekLine(index)}
            style={{ opacity: current || !synced ? 1 : settings.lyricWait }}>
            <span className="lyric-track" ref={node => { tracks.current[index] = node; }}>{words[index].map((word, wordIndex) => <span key={wordIndex} className="lyric-word" ref={node => { (wordRefs.current[index] ||= [])[wordIndex] = node; }}>{word.text}</span>)}</span>
          </button>;
        })}</div>
      </div>
      {!synced && <span className="lyrics-unsynced-note">未同步歌词 · 自由浏览</span>}
      {!following && synced && <button type="button" className="button lyric-follow" onClick={returnToCurrent}><Icon name="lyrics" size={15} />回到当前歌词</button>}
    </>}
  </section>;
}
