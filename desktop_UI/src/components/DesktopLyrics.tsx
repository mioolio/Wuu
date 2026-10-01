import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getBridge, subscribe } from '../api';
import { normalizeCoverColor, resolveLyricAppearance, type LyricAppearanceSettings, type RGB } from '../services/coverPalette';
import Icon from './Icon';
import './desktop-lyrics.css';

interface Character { offset: number; dur: number; text: string }
interface Line { start?: number; time?: number; duration?: number; text?: string; chars?: Character[] }
interface LyricData { raw: boolean; lines: Line[] }
function lineText(line?: Line) { return line?.chars?.map(char => char.text).join('') || line?.text || ''; }
function lineTime(line: Line) { return line.start ?? line.time ?? 0; }

export default function DesktopLyrics() {
  const [data, setData] = useState<LyricData>({ raw: false, lines: [] });
  const [index, setIndex] = useState(-1);
  const [info, setInfo] = useState({ title: '', artist: '' });
  const [locked, setLocked] = useState(false);
  const [color, setColor] = useState<RGB | null>(null);
  const [appearanceSettings, setAppearanceSettings] = useState<LyricAppearanceSettings>({});
  const appearance = resolveLyricAppearance(color, appearanceSettings);
  const model = useRef({ data, simulate: false, lastTime: 0, lastWall: 0, playing: false, index: -1,
    marquee: true, threshold: 1, speed: 60, pause: 1.5, done: 0.9 });
  const track = useRef<HTMLSpanElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const interactive = useRef(false);
  const changeInteractive = (on: boolean) => {
    if (interactive.current === on) return;
    interactive.current = on;
    void getBridge('desktopLyric').setInteractive(on);
  };

  useEffect(() => {
    let measured: HTMLSpanElement | null = null;
    let width = 0, available = 0, charWidths: number[] = [], chars: HTMLSpanElement[] = [];
    let offset = 0, lastFrame = performance.now();
    const resize = new ResizeObserver(() => { measured = null; });
    // Observe the fixed overlay; a lyric row changes height when its text wraps.
    // Its own content changes must not invalidate measurements every frame.
    if (row.current?.parentElement) resize.observe(row.current.parentElement);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changeMotion = () => { measured = null; offset = 0; };
    motion.addEventListener('change', changeMotion);
    const unsubscribe = subscribe('lyricReceiver', 'onUpdate', (payload: any) => {
      if (payload.type === 'data' || payload.type === 'clear') {
        model.current.data = payload.type === 'data' && Array.isArray(payload.lrc?.lines) ? payload.lrc : { raw: false, lines: [] };
        model.current.simulate = payload.simulate === true;
        model.current.index = -2;
        setData(model.current.data); setIndex(-1); measured = null;
      } else if (payload.type === 'time') {
        model.current.lastTime = Number(payload.t) || 0;
        model.current.lastWall = performance.now(); model.current.playing = payload.playing === true;
      } else if (payload.type === 'info') { setInfo(payload.info || { title: '', artist: '' }); measured = null; }
      else if (payload.type === 'lock') setLocked(payload.locked === true);
      else if (payload.type === 'color') setColor(normalizeCoverColor(payload.color));
      else if (payload.type === 'settings') {
        const options = payload.settings || {};
        model.current.marquee = options.marqueeEnabled !== false;
        model.current.threshold = Math.max(1, Number(options.marqueeThreshold) || 1);
        model.current.speed = Math.max(10, Number(options.marqueeSpeed) || 60);
        model.current.pause = Math.max(0, Number(options.marqueePause) || 0);
        model.current.done = resolveLyricAppearance(null, options).done;
        setAppearanceSettings(options); measured = null;
      }
    });
    // React can subscribe after did-finish-load. Request a full state replay.
    getBridge('lyricReceiver').requestState?.();
    let raf = 0, lastIndex = -2;
    const update = () => {
      const now = performance.now();
      const elapsed = Math.min(0.05, Math.max(0, now - lastFrame) / 1000); lastFrame = now;
      const current = model.current;
      const time = current.lastTime + (current.playing ? Math.max(0, now - current.lastWall) / 1000 : 0);
      let active = -1;
      for (let i = 0; i < current.data.lines.length; i++) { if (lineTime(current.data.lines[i]) <= time) active = i; else break; }
      // Keep the original and its same-time translation in the two visible rows.
      while (active > 0 && lineTime(current.data.lines[active - 1]) === lineTime(current.data.lines[active])) active--;
      if (active !== lastIndex || current.index === -2) {
        lastIndex = active; current.index = active; setIndex(active); offset = 0; measured = null;
      }
      const line = current.data.lines[active];
      const element = track.current;
      if (element && element.dataset.line === String(active)) {
        if (measured !== element) {
          width = element.scrollWidth; available = row.current?.clientWidth || 860;
          chars = Array.from(element.querySelectorAll<HTMLSpanElement>('[data-char]'));
          charWidths = chars.map(span => span.offsetWidth);
          measured = element;
          if (row.current) row.current.dataset.overflow = String(width > available);
        }
        const local = line ? Math.max(0, time - lineTime(line)) : 0;
        let filled = 0;
        if (line && current.data.raw && line.chars?.length) {
          line.chars.forEach((char, i) => {
            const ratio = Math.max(0, Math.min(1, (local - char.offset) / Math.max(0.01, char.dur)));
            const span = chars[i];
            if (span) { span.style.setProperty('--fill', ratio * 100 + '%'); span.style.opacity = String(ratio >= 1 ? current.done : 1); filled += charWidths[i] * ratio; }
          });
        } else {
          let next = active + 1;
          while (line && next < current.data.lines.length && lineTime(current.data.lines[next]) === lineTime(line)) next++;
          const duration = line?.duration || (line && current.data.lines[next] ? lineTime(current.data.lines[next]) - lineTime(line) : 4);
          const ratio = line && current.simulate ? Math.max(0, Math.min(1, local / Math.max(duration, 0.01))) : 1;
          element.style.setProperty('--fill', ratio * 100 + '%');
          element.style.opacity = String(line && ratio >= 1 ? current.done : 1); filled = width * ratio;
        }
        const overflow = Math.max(0, width - available);
        let target = 0;
        if (!motion.matches && current.marquee && width > available * current.threshold) {
          target = current.data.raw || current.simulate ? Math.min(overflow, Math.max(0, filled - available * 0.7)) : Math.min(overflow, Math.max(0, local - current.pause) * current.speed);
        }
        // Reduced motion wraps long lines instead of sliding them horizontally.
        offset = motion.matches ? target : offset + (target - offset) * (1 - Math.exp(-elapsed * 12));
        element.style.transform = 'translateX(' + (-offset).toFixed(2) + 'px)';
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => { unsubscribe(); resize.disconnect(); motion.removeEventListener('change', changeMotion); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const leave = () => { if (locked) changeInteractive(false); };
    document.documentElement.addEventListener('mouseleave', leave);
    return () => document.documentElement.removeEventListener('mouseleave', leave);
  }, [locked]);
  const current = data.lines[index];
  const text = lineText(current);
  const style = { '--lyric-color': appearance.color, '--lyric-secondary': appearance.secondary,
    '--desktop-lyric-size': Math.round(appearance.size * 1.5) + 'px', '--lyric-wait': 'rgba(255, 255, 255, .9)',
    '--lyric-next-opacity': Math.max(0.5, appearance.wait) } as CSSProperties;

  return <div className="desktop-lyrics" style={style}>
    <div className="desktop-lyric-controls" onMouseEnter={() => { if (locked) changeInteractive(true); }} onMouseLeave={() => { if (locked) changeInteractive(false); }}>
      <button aria-label={locked ? '解锁歌词' : '锁定歌词'} aria-pressed={locked} title={locked ? '解锁歌词' : '锁定歌词（鼠标穿透）'} onClick={async () => {
        const next = !locked; await getBridge('desktopLyric').lock(next); setLocked(next); getBridge('desktopLyric').notifyLockChanged(next);
        interactive.current = !next;
      }}><Icon name={locked ? 'lock' : 'unlock'} size={16} /></button>
      <button aria-label="关闭桌面歌词" title="关闭桌面歌词" onClick={async () => { await getBridge('desktopLyric').toggle(false); getBridge('desktopLyric').notifyClosed(); }}><Icon name="close" size={16} /></button>
    </div>
    <div className="desktop-current-row" ref={row}>
      <div className="desktop-line-enter" key={index + ':' + text}>
        <span className={'desktop-lyric-track ' + (data.raw && current ? 'raw' : '')} ref={track} data-line={index}>
          {current ? data.raw && current.chars?.length ? current.chars.map((char, i) => <span data-char="true" className="desktop-char" key={i}>{char.text}</span>) : text : info.title ? info.title + (info.artist ? ' · ' + info.artist : '') : 'Wuu 音乐 · 桌面歌词'}
        </span>
      </div>
    </div>
    <div className="desktop-next-row" key={index + 1 + ':' + lineText(data.lines[index + 1])}>{lineText(data.lines[index + 1]) || '\u00a0'}</div>
  </div>;
}
