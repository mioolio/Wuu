import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { getBridge, subscribe } from '../api';
import { resolveLyricAppearance, type LyricAppearanceSettings, type RGB } from '../services/coverPalette';
import { applyDesktopLyricPayload, createDesktopLyricModel, desktopLineRatio, desktopLineText, desktopLineTime,
  desktopLyricHandoff, desktopLyricIndex, desktopLyricTime, desktopNextIndex, type DesktopLyricData } from '../services/desktopLyricFrame';
import './desktop-lyrics.css';

interface Frame { data: DesktopLyricData; index: number; revision: number; key: string; songKey: string; time: number; simulate: boolean; info: { title: string; artist: string } }
interface FrozenFrame { frame: Frame; transform: string; fill: string; opacity: string; chars: { fill: string; opacity: string }[]; overflow: boolean;
  previewCenter: number; previewSize: number; rowTop: number; rowSize: number }
const handoffDuration = 280;

function companions(frame: Frame) {
  const next = desktopNextIndex(frame.data.lines, frame.index);
  return frame.index < 0 ? [] : frame.data.lines.slice(frame.index + 1, next < 0 ? undefined : next);
}

function nextText(frame: Frame) { return desktopLineText(frame.data.lines[desktopNextIndex(frame.data.lines, frame.index)]); }

function frameText(frame: Frame) {
  return desktopLineText(frame.data.lines[frame.index]) || (frame.info.title ? frame.info.title + (frame.info.artist ? ' · ' + frame.info.artist : '') : 'Wuu 音乐 · 桌面歌词');
}

function LyricTrack({ frame, done, frozen, trackRef }: { frame: Frame; done: number; frozen?: FrozenFrame; trackRef?: Ref<HTMLSpanElement> }) {
  const line = frame.data.lines[frame.index];
  const ratio = desktopLineRatio(frame.data, frame.index, frame.time, frame.simulate);
  const style = { '--fill': frozen?.fill || ratio * 100 + '%', opacity: frozen?.opacity || (line && ratio >= 1 ? done : 1),
    transform: frozen?.transform } as CSSProperties;
  const outgoing = !!frozen;
  return <span className={(outgoing ? 'desktop-outgoing-track ' : 'desktop-lyric-track ') + (frame.data.raw && line ? 'raw' : '')}
    ref={trackRef} data-line={frame.index} data-revision={frame.revision} style={style}>
    {line && frame.data.raw && line.chars?.length ? line.chars.map((char, index) => {
      const filled = Math.max(0, Math.min(1, (frame.time - desktopLineTime(line) - char.offset) / Math.max(0.01, char.dur)));
      const charStyle = { '--fill': frozen?.chars[index]?.fill || filled * 100 + '%', opacity: frozen?.chars[index]?.opacity || (filled >= 1 ? done : 1) } as CSSProperties;
      return <span data-char="true" className={outgoing ? 'desktop-outgoing-char' : 'desktop-char'} key={index} style={charStyle}>{char.text}</span>;
    }) : frameText(frame)}
  </span>;
}

export default function DesktopLyrics() {
  const model = useRef(createDesktopLyricModel());
  const initialFrame: Frame = { data: model.current.data, index: -1, revision: 0, key: '', songKey: '', time: 0, simulate: false, info: model.current.info };
  const shown = useRef(initialFrame);
  const [presentation, setPresentation] = useState({ current: initialFrame, previous: null as FrozenFrame | null, transitioning: false });
  const [appearanceState, setAppearanceState] = useState({ color: null as RGB | null, settings: {} as LyricAppearanceSettings, ready: false, colorReady: false, openingEpoch: 0 });
  const [colorSettled, setColorSettled] = useState(false);
  const resolved = resolveLyricAppearance(appearanceState.color, appearanceState.settings);
  const palette = useRef({ color: resolved.color, secondary: resolved.secondary });
  const custom = appearanceState.settings.progressColorEnabled && typeof appearanceState.settings.progressColor === 'string' && /^#[\da-f]{6}$/i.test(appearanceState.settings.progressColor);
  // Disabling a custom color while extraction is pending retains the last
  // visible palette until the actual cover result (including null) is ready.
  if (appearanceState.colorReady || custom) palette.current = { color: resolved.color, secondary: resolved.secondary };
  const appearance = { ...resolved, ...palette.current };
  const track = useRef<HTMLSpanElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const entering = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previous = presentation.previous;
    if (!previous || !presentation.transitioning || !row.current || !entering.current || !stage.current) return;
    // offset geometry excludes the animation's own transform. The next preview
    // starts at its old center and grows into the current row's real position.
    const center = row.current.getBoundingClientRect().top + entering.current.offsetTop + entering.current.offsetHeight / 2;
    const distance = Math.max(0, previous.previewCenter - center);
    const size = parseFloat(getComputedStyle(entering.current).fontSize) || previous.rowSize;
    stage.current.style.setProperty('--lyric-slide-distance', distance.toFixed(2) + 'px');
    stage.current.style.setProperty('--lyric-slide-scale', String(Math.min(1, Math.max(0.1, previous.previewSize / size))));
    stage.current.style.setProperty('--lyric-outgoing-top', (previous.rowTop - stage.current.getBoundingClientRect().top).toFixed(2) + 'px');
    stage.current.dataset.slideDistance = distance.toFixed(2);
  }, [presentation.current.key, presentation.previous, presentation.transitioning]);

  useLayoutEffect(() => {
    if (appearanceState.openingEpoch > 0) getBridge('lyricReceiver').ready?.(appearanceState.openingEpoch);
  }, [appearanceState.openingEpoch]);

  useEffect(() => {
    if (!appearanceState.ready) return;
    // First visible paint has the final initial palette, without interpolation
    // from a registered property's pink default. Later sleeve changes can fade.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setColorSettled(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [appearanceState.ready, appearanceState.openingEpoch]);

  useEffect(() => {
    let measured: HTMLSpanElement | null = null;
    let width = 0, available = 0, charWidths: number[] = [], chars: HTMLSpanElement[] = [];
    let offset = 0, lastFrame = performance.now(), snapOffset = true;
    let removal: ReturnType<typeof setTimeout> | undefined;
    const resize = new ResizeObserver(() => { measured = null; });
    const overlay = row.current?.closest('.desktop-lyrics');
    if (overlay) resize.observe(overlay);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const removePrevious = () => {
      clearTimeout(removal);
      setPresentation(value => value.previous || value.transitioning ? { ...value, previous: null, transitioning: false } : value);
    };
    const publish = (continuous: boolean) => {
      const current = model.current;
      const time = desktopLyricTime(current, performance.now());
      const index = desktopLyricIndex(current.data.lines, time);
      const text = index >= 0 ? desktopLineText(current.data.lines[index]) : current.info.title + ' · ' + current.info.artist;
      const key = current.openingEpoch + ':' + current.songKey + ':' + current.revision + ':' + index + ':' + text;
      if (key === shown.current.key) { if (!continuous) removePrevious(); return; }
      const frame: Frame = { data: current.data, index, revision: current.revision, key, songKey: current.songKey, time, simulate: current.simulate, info: current.info };
      const previous = shown.current;
      const transition = current.ready && previous.data === frame.data && previous.songKey === frame.songKey &&
        desktopLyricHandoff(frame.data.lines, previous.index, index, continuous && current.playing, motion.matches);
      // Freeze the DOM's latest fill/offset, rather than the line-entry time.
      // Only one inert outgoing frame ever exists, including interrupted seeks.
      const frozen: FrozenFrame | null = transition ? { frame: previous, transform: track.current?.style.transform || '',
        fill: track.current?.style.getPropertyValue('--fill') || '', opacity: track.current?.style.opacity || '',
        chars: Array.from(track.current?.querySelectorAll<HTMLSpanElement>('[data-char]') || []).map(char => ({ fill: char.style.getPropertyValue('--fill'), opacity: char.style.opacity })),
        overflow: row.current?.dataset.overflow === 'true',
        previewCenter: preview.current ? preview.current.getBoundingClientRect().top + preview.current.getBoundingClientRect().height / 2 : 0,
        previewSize: preview.current ? parseFloat(getComputedStyle(preview.current).fontSize) || 18 : 18,
        rowTop: row.current?.getBoundingClientRect().top || 0,
        rowSize: row.current ? parseFloat(getComputedStyle(row.current).fontSize) || 30 : 30 } : null;
      shown.current = frame; clearTimeout(removal);
      setPresentation({ current: frame, previous: frozen, transitioning: transition });
      offset = 0; measured = null; snapOffset = true;
      if (transition) removal = setTimeout(removePrevious, handoffDuration);
    };
    const changeMotion = () => { measured = null; offset = 0; snapOffset = true; removePrevious(); };
    motion.addEventListener('change', changeMotion);
    const unsubscribe = subscribe('lyricReceiver', 'onUpdate', (payload: any) => {
      const update = applyDesktopLyricPayload(model.current, payload, performance.now());
      if (update.opening) setColorSettled(false);
      if (update.appearance) {
        const current = model.current;
        setAppearanceState({ color: current.color, settings: current.settings, ready: current.ready, colorReady: current.colorReady, openingEpoch: current.openingEpoch });
        measured = null;
      }
      if (update.reset || update.seek) { measured = null; offset = 0; snapOffset = true; removePrevious(); }
      if (update.content || payload.type === 'time') publish(!update.reset && !update.seek);
    });
    getBridge('lyricReceiver').requestState?.();
    let raf = 0;
    const update = () => {
      const now = performance.now();
      const elapsed = Math.min(0.05, Math.max(0, now - lastFrame) / 1000); lastFrame = now;
      publish(true);
      const current = model.current;
      const time = desktopLyricTime(current, now);
      const active = desktopLyricIndex(current.data.lines, time);
      const line = current.data.lines[active];
      const element = track.current;
      if (element && element.dataset.line === String(active) && element.dataset.revision === String(current.revision)) {
        if (measured !== element) {
          width = element.scrollWidth; available = row.current?.clientWidth || 860;
          chars = Array.from(element.querySelectorAll<HTMLSpanElement>('[data-char]'));
          charWidths = chars.map(span => span.offsetWidth); measured = element;
          if (row.current) row.current.dataset.overflow = String(width > available);
        }
        const options = current.settings;
        const done = resolveLyricAppearance(null, options).done;
        const local = line ? Math.max(0, time - desktopLineTime(line)) : 0;
        let filled = 0;
        if (line && current.data.raw && line.chars?.length) {
          line.chars.forEach((char, index) => {
            const ratio = Math.max(0, Math.min(1, (local - char.offset) / Math.max(0.01, char.dur)));
            const span = chars[index];
            if (span) { span.style.setProperty('--fill', ratio * 100 + '%'); span.style.opacity = String(ratio >= 1 ? done : 1); filled += charWidths[index] * ratio; }
          });
        } else {
          const ratio = desktopLineRatio(current.data, active, time, current.simulate);
          element.style.setProperty('--fill', ratio * 100 + '%');
          element.style.opacity = String(line && ratio >= 1 ? done : 1); filled = width * ratio;
        }
        const overflow = Math.max(0, width - available);
        let target = 0;
        if (!motion.matches && options.marqueeEnabled !== false && width > available * Math.max(1, Number(options.marqueeThreshold) || 1)) {
          target = current.data.raw || current.simulate ? Math.min(overflow, Math.max(0, filled - available * 0.7)) :
            Math.min(overflow, Math.max(0, local - Math.max(0, Number(options.marqueePause) || 0)) * Math.max(10, Number(options.marqueeSpeed) || 60));
        }
        offset = motion.matches || snapOffset ? target : offset + (target - offset) * (1 - Math.exp(-elapsed * 12));
        snapOffset = false;
        element.style.transform = 'translateX(' + (-offset).toFixed(2) + 'px)';
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => { unsubscribe(); resize.disconnect(); motion.removeEventListener('change', changeMotion); cancelAnimationFrame(raf); clearTimeout(removal); };
  }, []);

  const { current, previous } = presentation;
  // React rerenders for lock, palette and outgoing cleanup must use today's
  // clock, never restore the entry-time fill before the next animation frame.
  const liveFrame = { ...current, time: desktopLyricTime(model.current, performance.now()), simulate: model.current.simulate };
  const style = { '--lyric-color': appearance.color, '--lyric-secondary': appearance.secondary,
    '--desktop-lyric-size': Math.round(appearance.size * 1.5) + 'px', '--lyric-wait': 'rgba(255, 255, 255, .9)',
    '--lyric-next-opacity': Math.max(0.5, appearance.wait) } as CSSProperties;

  return <div className="desktop-lyrics" style={style} data-ready={appearanceState.ready} data-color-settled={colorSettled} data-opening-epoch={appearanceState.openingEpoch}>
    <div className="desktop-lyric-stage" ref={stage}>
      <div className="desktop-lyric-current-content" data-transition={presentation.transitioning} data-song-key={current.songKey} key={current.key}>
        <div className="desktop-current-row" ref={row}>
          <div className="desktop-line-enter" ref={entering}><LyricTrack frame={liveFrame} done={appearance.done} trackRef={track} /></div>
          {companions(current).map((line, index) => <div className="desktop-current-translation" key={index}>{desktopLineText(line)}</div>)}
        </div>
        <div className="desktop-next-row" ref={preview}>{nextText(current) || '\u00a0'}</div>
      </div>
      {previous && <div className="desktop-lyric-outgoing" aria-hidden="true" inert>
        <div className="desktop-outgoing-current-row" data-overflow={previous.overflow} style={{ fontSize: previous.rowSize }}>
          <LyricTrack frame={previous.frame} done={appearance.done} frozen={previous} />
          {companions(previous.frame).map((line, index) => <div className="desktop-outgoing-translation" key={index}>{desktopLineText(line)}</div>)}
        </div>
      </div>}
    </div>
  </div>;
}
