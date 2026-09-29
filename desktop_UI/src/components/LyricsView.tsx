import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAppStore } from '../store';
import { activeLyricIndex, lineText, lineTime, parseLyrics, type LyricLine } from '../services/lyrics';
import { playerService, isVideo } from '../services/player';

interface Word { text: string; start: number; end: number }
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
  const playing = useAppStore(state => state.player.playing);
  const visible = useAppStore(state => state.view === 'player');
  const duration = useAppStore(state => state.player.duration);
  const settings = useAppStore(state => state.settings);
  const data = useMemo(() => parseLyrics(text, isVideo(song, preview)), [text, song?.audioPath, preview?.url]);
  const words = useMemo(() => data.lines.map((line, index) => wordsForLine(line, data.lines[index + 1], duration, settings.simulateLrcProgress)), [data, duration, settings.simulateLrcProgress]);
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[][]>([]);
  const tracks = useRef<(HTMLSpanElement | null)[]>([]);
  const lastActive = useRef(-1);
  const resumeTime = useRef(0);
  const marqueeOffset = useRef(0);
  const noTimestamps = data.lines.length > 1 && data.lines.every(line => lineTime(line) === 0);

  useEffect(() => {
    lastActive.current = -1; marqueeOffset.current = 0; resumeTime.current = 0; setActive(-1); setFollowing(true);
    wordRefs.current = wordRefs.current.slice(0, words.length);
    let frame = 0;
    const draw = () => {
      const time = playerService.media.currentTime || 0;
      const index = noTimestamps ? -1 : activeLyricIndex(data.lines, time);
      const changedIndex = index !== lastActive.current;
      if (resumeTime.current && performance.now() >= resumeTime.current) { resumeTime.current = 0; setFollowing(true); }
      if (index !== lastActive.current) {
        const oldIndex = lastActive.current;
        if (oldIndex >= 0) {
          wordRefs.current[oldIndex]?.forEach(node => node?.style.setProperty('--word-progress', index > oldIndex ? '100%' : '0%'));
          if (tracks.current[oldIndex]) tracks.current[oldIndex]!.style.transform = '';
        }
        lastActive.current = index; marqueeOffset.current = 0; setActive(index);
        if (index >= 0 && !resumeTime.current && container.current && lines.current[index]) {
          const node = lines.current[index]!;
          container.current.scrollTo({ top: Math.max(0, node.offsetTop - container.current.clientHeight / 2 + node.offsetHeight / 2), behavior: 'smooth' });
        }
      }
      if (index >= 0) {
        let fill = 0;
        words[index]?.forEach((word, wordIndex) => {
          const progress = word.end <= word.start ? (time >= word.start ? 1 : 0) : Math.max(0, Math.min(1, (time - word.start) / (word.end - word.start)));
          const node = wordRefs.current[index]?.[wordIndex];
          if (node) { node.style.setProperty('--word-progress', `${progress * 100}%`); node.style.opacity = String(progress >= 1 ? settings.lyricDone : 1); fill = Math.max(fill, progress > 0 ? node.offsetLeft + node.offsetWidth * progress : 0); }
        });
        const line = lines.current[index]; const track = tracks.current[index];
        if (line && track && settings.marqueeEnabled) {
          const overflow = Math.max(0, track.scrollWidth - line.clientWidth);
          const desired = overflow > line.clientWidth * Math.max(0, settings.marqueeThreshold - 1) ? Math.max(0, Math.min(overflow, fill - line.clientWidth * 0.7)) : 0;
          const delay = time - lineTime(data.lines[index]) < settings.marqueePause;
          marqueeOffset.current += ((delay ? 0 : desired) - marqueeOffset.current) * Math.min(0.4, Math.max(0.01, settings.marqueeSpeed / 600));
          track.style.transform = `translateX(${-marqueeOffset.current}px)`;
        }
      }
      if (!playerService.media.paused || changedIndex) frame = requestAnimationFrame(draw);
    };
    if (visible) draw();
    const refreshPaused = () => { if (visible && playerService.media.paused) draw(); };
    playerService.media.addEventListener('seeked', refreshPaused);
    playerService.media.addEventListener('timeupdate', refreshPaused);
    return () => { cancelAnimationFrame(frame); playerService.media.removeEventListener('seeked', refreshPaused); playerService.media.removeEventListener('timeupdate', refreshPaused); };
  }, [words, data, playing, visible, noTimestamps, settings.marqueeEnabled, settings.marqueeThreshold, settings.marqueeSpeed, settings.marqueePause, settings.lyricDone]);

  const pauseFollowing = () => { resumeTime.current = performance.now() + 6000; setFollowing(false); };
  const returnToCurrent = () => {
    resumeTime.current = 0; setFollowing(true);
    const node = lines.current[lastActive.current];
    if (node && container.current) container.current.scrollTo({ top: Math.max(0, node.offsetTop - container.current.clientHeight / 2 + node.offsetHeight / 2), behavior: 'smooth' });
  };
  const style = { '--lyric-active': settings.progressColorEnabled ? settings.progressColor : 'var(--accent, #fb7299)',
    '--lyric-wait-opacity': settings.lyricWait, '--lyric-size': `${settings.lyricSize}px`,
    '--lyric-wait-color': `color-mix(in srgb, var(--text) ${Math.round(settings.lyricWait * 100)}%, transparent)`,
    fontSize: settings.lyricSize, position: 'relative', overflow: 'hidden' } as CSSProperties;
  return <section className="lyrics-panel" aria-label="歌词" style={style}>
    <div className="lyrics-scroll" ref={container} onWheel={pauseFollowing} onTouchStart={pauseFollowing}>
      <div className="lyrics-lines">{data.lines.map((line, index) => <button key={`${index}:${lineTime(line)}:${lineText(line)}`} ref={node => { lines.current[index] = node; }}
        className={`lyric-line ${active === index ? 'current' : ''} ${settings.marqueeEnabled ? 'marquee-enabled' : ''}`} aria-current={active === index ? 'true' : undefined}
        title={`跳转到 ${Math.floor(lineTime(line) / 60)}:${String(Math.floor(lineTime(line) % 60)).padStart(2, '0')}`} disabled={noTimestamps || !duration} onClick={() => { playerService.seek(lineTime(line)); returnToCurrent(); }}
        style={{ opacity: active === index || noTimestamps ? 1 : settings.lyricWait }}>
        <span className="lyric-track" ref={node => { tracks.current[index] = node; }}>{words[index].map((word, wordIndex) => <span key={wordIndex} className="lyric-word" ref={node => { (wordRefs.current[index] ||= [])[wordIndex] = node; }} style={{
          '--word-progress': active > index ? '100%' : '0%', backgroundImage: 'linear-gradient(90deg, var(--lyric-active) 0%, var(--lyric-active) var(--word-progress), var(--lyric-wait-color) var(--word-progress), var(--lyric-wait-color) 100%)',
          backgroundClip: 'text', WebkitBackgroundClip: 'text', color: active === index ? 'transparent' : undefined, opacity: active === index && playerService.media.currentTime >= word.end ? settings.lyricDone : 1,
        } as CSSProperties}>{word.text}</span>)}</span>
      </button>)}</div>
    </div>
    {!following && <button className="button lyric-follow" onClick={returnToCurrent}>回到当前歌词</button>}
  </section>;
}
