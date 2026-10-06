import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveLyricAppearance } from '../services/coverPalette';
import { applyDesktopLyricPayload, createDesktopLyricModel, desktopLyricTime } from '../services/desktopLyricFrame';

// Execute the production component's subscription, clock and refs offline.
// The tiny hook host replaces React scheduling; lyric rendering is real JSX.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as any[], effects: [] as (() => void)[], dirty: false }));
const bridge = vi.hoisted(() => ({ receive: null as ((payload: any) => void) | null, request: vi.fn(), ready: vi.fn(), unsubscribe: vi.fn(), lock: vi.fn(), interactive: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef(initial: unknown) { const index = hooks.cursor++; return hooks.cells[index] ||= { current: initial }; },
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.cells[index] ||= { value: initial };
    return [hooks.cells[index].value, (value: any) => {
      const previous = hooks.cells[index].value, next = typeof value === 'function' ? value(previous) : value;
      if (previous !== next) { hooks.cells[index].value = next; hooks.dirty = true; }
    }];
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = hooks.cursor++, previous = hooks.cells[index];
    if (previous && deps.every((value, position) => Object.is(value, previous.deps[position]))) return;
    const cell = hooks.cells[index] = { deps, cleanup: undefined as (() => void) | undefined };
    hooks.effects.push(() => { previous?.cleanup?.(); cell.cleanup = effect() || undefined; });
  },
  useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = hooks.cursor++, previous = hooks.cells[index];
    if (previous && deps.every((value, position) => Object.is(value, previous.deps[position]))) return;
    const cell = hooks.cells[index] = { deps, cleanup: undefined as (() => void) | undefined };
    hooks.effects.push(() => { previous?.cleanup?.(); cell.cleanup = effect() || undefined; });
  },
}));
vi.mock('../api', () => ({
  getBridge: () => ({ requestState: bridge.request, ready: bridge.ready, setInteractive: bridge.interactive, lock: bridge.lock, notifyLockChanged: vi.fn(), toggle: vi.fn(), notifyClosed: vi.fn() }),
  subscribe: (_name: string, _method: string, receive: (payload: any) => void) => { bridge.receive = receive; return bridge.unsubscribe; },
}));
import DesktopLyrics from './DesktopLyrics';

let now = 1000, rafId = 0, html = '', tree: any, currentTrack: any;
const frames = new Map<number, FrameRequestCallback>();
const motion = Object.assign(new EventTarget(), { matches: false });
const geometry = { rowTop: 20, mainHeight: 40, previewTop: 92, previewHeight: 24, mainSize: 30, previewSize: 18 };
const overlay = {};
const row = { clientWidth: 220, dataset: {} as Record<string, string>, closest: () => overlay,
  getBoundingClientRect: () => ({ top: geometry.rowTop }), get fontSize() { return geometry.mainSize + 'px'; } };
const entering = { offsetTop: 4, get offsetHeight() { return geometry.mainHeight; }, get fontSize() { return geometry.mainSize + 'px'; } };
const preview = { getBoundingClientRect: () => ({ top: geometry.previewTop, height: geometry.previewHeight }), get fontSize() { return geometry.previewSize + 'px'; } };
const stage = { dataset: {} as Record<string, string>, style: styles(), getBoundingClientRect: () => ({ top: geometry.rowTop }) };
function styles(initial: any = {}) {
  const values = new Map(Object.entries(initial).filter(([key]) => key.startsWith('--')));
  return { opacity: String(initial.opacity ?? ''), transform: initial.transform || '',
    setProperty: (key: string, value: string) => values.set(key, value), getPropertyValue: (key: string) => String(values.get(key) || '') };
}
function flatten(value: any): any[] { return Array.isArray(value) ? value.flatMap(flatten) : value ? [value] : []; }
function attach(element: any) {
  if (!element?.props) return;
  const props = element.props;
  if (props.className === 'desktop-current-row') props.ref.current = row;
  if (props.className === 'desktop-line-enter') props.ref.current = entering;
  if (props.className === 'desktop-next-row') props.ref.current = preview;
  if (props.className === 'desktop-lyric-stage') props.ref.current = stage;
  if (props.trackRef) {
    const rendered = element.type(props), span = rendered.props;
    if (currentTrack?.key !== props.frame.key) {
      currentTrack = { key: props.frame.key, dataset: { line: String(span['data-line']), revision: String(span['data-revision']) },
        style: styles(span.style), scrollWidth: 320, children: [] as any[], querySelectorAll() { return this.children; } };
    }
    currentTrack.style.setProperty('--fill', span.style['--fill']); currentTrack.style.opacity = String(span.style.opacity);
    const characters = flatten(span.children).filter(child => child?.props?.['data-char']);
    currentTrack.children = characters.map((child, index) => {
      const char = currentTrack.children[index] || { offsetWidth: 160, style: styles() };
      char.style.setProperty('--fill', child.props.style['--fill']); char.style.opacity = String(child.props.style.opacity);
      return char;
    });
    props.trackRef.current = currentTrack;
  }
  flatten(props.children).forEach(attach);
}
function render() {
  let attempts = 0;
  do {
    hooks.dirty = false; hooks.cursor = 0; tree = DesktopLyrics(); attach(tree); html = renderToStaticMarkup(tree);
    hooks.effects.splice(0).forEach(effect => effect());
    if (++attempts > 10) throw new Error('The component did not settle');
  } while (hooks.dirty);
  return html;
}
function emit(payload: any) { bridge.receive!(payload); return render(); }
function tick(milliseconds: number) {
  now += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); return render();
}
const raw = { raw: true, lines: [
  { start: 0, duration: 4, chars: [{ offset: 0, dur: 1, text: 'First ' }, { offset: 2, dur: 2, text: 'tail' }] },
  { start: 0, duration: 4, chars: [{ offset: 0, dur: 4, text: '第一句译文' }] },
  { start: 4, duration: 2, chars: [{ offset: 0, dur: 2, text: 'Second' }] },
  { start: 8, duration: 1, chars: [{ offset: 0, dur: 1, text: 'Last' }] },
] };
const snapshot = (overrides: any = {}) => ({ type: 'snapshot', lrc: raw, simulate: false, info: { title: 'Song', artist: 'Artist' }, settings: {},
  color: { r: 42, g: 146, b: 166 }, colorReady: true, locked: false, t: 3.9, playing: true, songKey: 'isolated/song.wav', ...overrides });

beforeEach(() => {
  hooks.cursor = 0; hooks.cells = []; hooks.effects = []; hooks.dirty = false;
  now = 1000; rafId = 0; frames.clear(); currentTrack = null; motion.matches = false; row.dataset = {};
  Object.assign(geometry, { rowTop: 20, mainHeight: 40, previewTop: 92, previewHeight: 24, mainSize: 30, previewSize: 18 });
  stage.dataset = {}; stage.style = styles();
  bridge.receive = null; bridge.request.mockClear(); bridge.ready.mockReset(); bridge.unsubscribe.mockClear();
  bridge.lock.mockClear(); bridge.interactive.mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { matchMedia: () => motion });
  vi.stubGlobal('document', { documentElement: new EventTarget() });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('getComputedStyle', (element: any) => ({ fontSize: element.fontSize }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++rafId, callback); return rafId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  render();
});
afterEach(() => {
  hooks.cells.forEach(cell => cell?.cleanup?.()); expect(frames.size).toBe(0);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('real desktop lyric component state and handoff', () => {
  it('commits each opening palette without interpolation and acknowledges it before any hidden animation frame', () => {
    bridge.ready.mockImplementation(epoch => {
      expect(html).toContain('data-opening-epoch="' + epoch + '"');
      expect(html).toContain('data-color-settled="false"');
      expect(html).toContain('data-ready="true"');
    });
    emit(snapshot({ openingEpoch: 1, color: { r: 206, g: 76, b: 87 }, playing: false }));
    expect(bridge.ready).toHaveBeenCalledExactlyOnceWith(1);
    tick(16); tick(16); expect(html).toContain('data-color-settled="true"');
    emit(snapshot({ openingEpoch: 2, t: 4.5, playing: false }));
    expect(bridge.ready.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(html).toContain('--lyric-color:' + resolveLyricAppearance(snapshot().color).color);
    expect(currentTrack.dataset.line).toBe('2'); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(25);
    expect(html).not.toContain('desktop-lyric-outgoing');
    tick(16); tick(16); expect(html).toContain('data-color-settled="true"');
  });

  it('does not reopen or restart an in-flight handoff for ordinary snapshots and settings', () => {
    emit(snapshot({ openingEpoch: 1, t: 3.6 })); tick(16); tick(16); tick(400);
    expect(html).toContain('data-transition="true"'); expect(html).toContain('data-color-settled="true"');
    const visible = currentTrack;
    emit(snapshot({ openingEpoch: 1, t: 4.032 }));
    expect(currentTrack).toBe(visible); expect(html).toContain('desktop-lyric-outgoing'); expect(html).toContain('data-color-settled="true"');
    const ordinary = snapshot({ t: 4.032 });
    emit(ordinary); emit({ type: 'settings', settings: { lyricDone: .8 }, colorReady: true });
    expect(currentTrack).toBe(visible); expect(html).toContain('data-opening-epoch="1"'); expect(html).toContain('data-transition="true"');
    expect(bridge.ready).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a pending reopen as a committed hidden stage and clears the old texture/layer', () => {
    emit(snapshot({ openingEpoch: 1 })); tick(16); tick(16); tick(100);
    expect(html).toContain('desktop-lyric-outgoing');
    bridge.ready.mockImplementation(epoch => {
      expect(epoch).toBe(2); expect(html).toContain('data-ready="false"'); expect(html).toContain('data-color-settled="false"');
      expect(html).not.toContain('desktop-lyric-outgoing');
    });
    emit(snapshot({ openingEpoch: 2, songKey: 'isolated/pending.wav', t: 1, playing: false, color: null, colorReady: false }));
    expect(bridge.ready.mock.calls.map(call => call[0])).toEqual([1, 2]); expect(currentTrack.dataset.line).toBe('0');
    emit({ type: 'color', color: snapshot().color, colorReady: true });
    expect(html).toContain('data-ready="true"'); expect(html).toContain('data-color-settled="false"');
    expect(html).toContain('--lyric-color:' + resolveLyricAppearance(snapshot().color).color); expect(bridge.ready).toHaveBeenCalledTimes(2);
  });

  it('gates first paint until an atomic ready palette and directly renders its paused lyric group', () => {
    expect(html).toContain('data-ready="false"'); expect(bridge.request).toHaveBeenCalledTimes(1);
    emit(snapshot({ color: null, colorReady: false, playing: false })); expect(html).toContain('data-ready="false"');
    expect(currentTrack.dataset.line).toBe('0'); expect(currentTrack.children[1].style.getPropertyValue('--fill')).toBe('95%');
    emit({ type: 'color', color: snapshot().color, colorReady: true });
    expect(html).toContain('data-ready="true"'); expect(html).toContain('data-color-settled="false"');
    expect(html).toContain('--lyric-color:' + resolveLyricAppearance(snapshot().color).color);
    expect(html).not.toContain('Song · Artist'); expect(html).not.toContain('desktop-lyric-outgoing');
    tick(16); tick(16); expect(html).toContain('data-color-settled="true"');
  });

  it('promotes the next timestamp preview across the measured row distance while freezing one bilingual outgoing frame', () => {
    emit(snapshot()); tick(80);
    expect(html).toContain('class="desktop-current-translation">第一句译文');
    expect(html).toContain('class="desktop-next-row">Second');
    const frozenFill = currentTrack.children[1].style.getPropertyValue('--fill');
    tick(40); expect(currentTrack.dataset.line).toBe('2');
    expect(html).toContain('data-transition="true"'); expect(html).toContain('aria-hidden="true" inert=""');
    expect(html.match(/class="desktop-lyric-outgoing"/g)).toHaveLength(1);
    expect(html).toContain('class="desktop-outgoing-char" style="--fill:' + frozenFill);
    expect(html).toContain('第一句译文');
    expect(html).not.toContain('desktop-outgoing-next-row');
    expect(stage.style.getPropertyValue('--lyric-slide-distance')).toBe('60.00px');
    expect(stage.style.getPropertyValue('--lyric-slide-scale')).toBe('0.6');
    expect(stage.style.getPropertyValue('--lyric-outgoing-top')).toBe('0.00px');
    expect(stage.dataset.slideDistance).toBe('60.00');
    tick(80); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(5);
    emit({ type: 'time', t: 1, playing: false });
    expect(currentTrack.dataset.line).toBe('0'); expect(html).not.toContain('desktop-lyric-outgoing'); expect(html).toContain('data-transition="false"');
  });

  it('does not reset live word fill on palette, lock, settings or outgoing cleanup rerenders', () => {
    emit(snapshot()); tick(120); now += 1480;
    emit({ type: 'lock', locked: true }); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(75);
    emit({ type: 'color', color: { r: 206, g: 76, b: 87 }, colorReady: true }); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(75);
    emit({ type: 'settings', settings: { lyricDone: .7, marqueeEnabled: false }, colorReady: true }); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(75);
    now += 100; vi.advanceTimersByTime(280); render();
    expect(html).not.toContain('desktop-lyric-outgoing'); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(80);
  });

  it('preserves the displayed custom palette when disabled during pending extraction and accepts a final null fallback', () => {
    emit(snapshot({ color: null, colorReady: false, settings: { progressColorEnabled: true, progressColor: '#aabbcc' } }));
    expect(html).toContain('data-ready="true"'); expect(html).toContain('--lyric-color:#aabbcc');
    emit({ type: 'settings', settings: { progressColorEnabled: false }, colorReady: false }); expect(html).toContain('--lyric-color:#aabbcc');
    emit({ type: 'color', color: null, colorReady: true }); expect(html).toContain('--lyric-color:' + resolveLyricAppearance(null).color);
  });

  it('does not treat a malformed persisted color array as a valid custom first-paint palette', () => {
    emit(snapshot({ color: null, colorReady: false, settings: { progressColorEnabled: true, progressColor: ['#aabbcc'] } }));
    expect(html).toContain('data-ready="false"');
  });

  it('remeasures a different row/font layout and keeps only one frozen layer until the 280ms handoff completes', () => {
    Object.assign(geometry, { rowTop: 8, mainHeight: 54.6, previewTop: 108, previewHeight: 27.5, mainSize: 42, previewSize: 22 });
    emit(snapshot()); tick(120);
    expect(stage.style.getPropertyValue('--lyric-slide-distance')).toBe('82.45px');
    expect(Number(stage.style.getPropertyValue('--lyric-slide-scale'))).toBeCloseTo(22 / 42);
    vi.advanceTimersByTime(279); render(); expect(html.match(/class="desktop-lyric-outgoing"/g)).toHaveLength(1);
    vi.advanceTimersByTime(1); render(); expect(html).not.toContain('desktop-lyric-outgoing');
    emit({ type: 'time', t: 7.95, playing: true }); tick(60);
    expect(html.match(/class="desktop-lyric-outgoing"/g)).toHaveLength(1);
    emit({ type: 'time', t: 1, playing: false }); expect(html).not.toContain('desktop-lyric-outgoing');
  });

  it('follows 2x, paused and 0.5x media clocks for raw fill and timestamp handoffs without a progress jump on rate change', () => {
    emit(snapshot({ playbackRate: 2 })); tick(60);
    expect(currentTrack.dataset.line).toBe('2'); expect(html).toContain('data-transition="true"');
    expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(1);
    tick(90); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(10);
    emit({ type: 'time', t: 4.2, playing: false, playbackRate: 2 }); tick(1000);
    expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(10);
    emit({ type: 'time', t: 4.2, playing: true, playbackRate: .5 }); tick(1000);
    expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(35);
    emit({ type: 'time', playing: true, playbackRate: 2 });
    expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(35);
    tick(100); expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(45);
    emit(snapshot({ openingEpoch: 2, t: 4.9, playing: false, playbackRate: 2 })); tick(1000);
    expect(parseFloat(currentTrack.children[0].style.getPropertyValue('--fill'))).toBeCloseTo(45); expect(html).not.toContain('desktop-lyric-outgoing');
  });

  it('clamps supplied playback rates and preserves the previous rate for legacy time packets', () => {
    const model = createDesktopLyricModel();
    applyDesktopLyricPayload(model, snapshot({ t: 1, playbackRate: 8 }), 1000);
    expect(desktopLyricTime(model, 1500)).toBe(2);
    applyDesktopLyricPayload(model, { type: 'time', t: 2, playing: true }, 1500);
    expect(desktopLyricTime(model, 2000)).toBe(3);
    applyDesktopLyricPayload(model, { type: 'time', t: 3, playing: true, playbackRate: .1 }, 2000);
    expect(desktopLyricTime(model, 3000)).toBe(3.5);
    applyDesktopLyricPayload(model, { type: 'time', t: 3.5, playing: true, playbackRate: 'invalid' }, 3000);
    expect(desktopLyricTime(model, 3500)).toBe(4);
  });

  it('exposes no floating buttons or mouse-through controls regardless of native locked state', () => {
    emit(snapshot({ locked: true })); emit({ type: 'lock', locked: false });
    expect(html).not.toContain('<button'); expect(html).not.toContain('desktop-lyric-controls');
    expect(tree.props.onMouseEnter).toBeUndefined(); expect(tree.props.onMouseLeave).toBeUndefined();
    expect(bridge.lock).not.toHaveBeenCalled(); expect(bridge.interactive).not.toHaveBeenCalled();
  });

  it('keeps duplicate data/settings on the same row, clears rapid song/seek layers, and retains the final group', () => {
    emit(snapshot()); const original = currentTrack;
    emit({ type: 'data', lrc: JSON.parse(JSON.stringify(raw)) }); expect(currentTrack).toBe(original);
    emit({ type: 'settings', settings: { lyricSize: 24 }, colorReady: true }); expect(currentTrack).toBe(original);
    tick(120); expect(html).toContain('desktop-lyric-outgoing');
    emit(snapshot({ songKey: 'isolated/other.wav', t: 8.1, playing: false })); expect(html).not.toContain('desktop-lyric-outgoing');
    emit({ type: 'time', t: 90, playing: false }); expect(currentTrack.dataset.line).toBe('3'); expect(html).toContain('Last');
    emit({ type: 'clear' }); expect(html).toContain('Song · Artist'); expect(html).not.toContain('desktop-lyric-outgoing');
    emit(snapshot({ songKey: 'isolated/new.wav', lrc: { raw: false, lines: [{ time: 0, text: 'New' }] }, t: 0, playing: false }));
    expect(html).toContain('New'); expect(html).not.toContain('Song · Artist');
  });

  it('settles directly under reduced motion and disposes the IPC, timer and frame loop', () => {
    motion.matches = true; emit(snapshot()); tick(120); tick(16);
    expect(currentTrack.dataset.line).toBe('2'); expect(html).not.toContain('desktop-lyric-outgoing'); expect(html).toContain('data-transition="false"');
    expect(currentTrack.style.transform).toBe('translateX(0.00px)');
    hooks.cells.forEach(cell => { cell?.cleanup?.(); if (cell) cell.cleanup = undefined; });
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
