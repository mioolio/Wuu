import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { View } from '../types';
import './page-scroll-rail.css';

type Metrics = { top: number; height: number; thumb: number; position: number; maximum: number; value: number };
const initial: Metrics = { top: 8, height: 0, thumb: 36, position: 0, maximum: 0, value: 0 };

/** One persistent rail follows the active native scroll area, including virtual lists. */
export default function PageScrollRail({ content, view, loading }: { content: RefObject<HTMLElement | null>; view: View; loading: boolean }) {
  const [metrics, setMetrics] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const latest = useRef(initial);
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const managed = useRef(new Set<HTMLElement>());

  useLayoutEffect(() => () => {
    managed.current.forEach(area => area.classList.remove('has-scroll-rail'));
    managed.current.clear();
  }, []);

  useLayoutEffect(() => {
    const main = content.current;
    if (!main || loading) {
      setMetrics(previous => ({ ...previous, maximum: 0, value: 0 }));
      return;
    }
    let disposed = false;
    let scrollArea: HTMLElement | null = null;
    let frame = 0;
    let idle = 0;
    const host = main.querySelector<HTMLElement>('.page-host:not([hidden])');
    const sizes = new ResizeObserver(() => schedule());
    const observeSizes = () => {
      if (disposed) return;
      sizes.disconnect(); sizes.observe(main);
      const panel = host?.querySelector<HTMLElement>(':scope > .panel');
      if (panel) sizes.observe(panel);
      if (scrollArea) {
        sizes.observe(scrollArea);
        [...scrollArea.children].forEach(child => sizes.observe(child));
      }
    };
    const scroll = () => {
      if (disposed) return;
      setScrolling(true); clearTimeout(idle);
      idle = window.setTimeout(() => { if (!disposed) setScrolling(false); }, 120);
      schedule();
    };
    const measure = () => {
      if (disposed) return;
      frame = 0;
      const panel = host?.querySelector<HTMLElement>(':scope > .panel');
      // Library headers stay fixed while their virtual list or collection grid scrolls.
      const nested = panel?.querySelector<HTMLElement>('.song-viewport, .collection-grid');
      const next = nested || panel || null;
      if (next !== scrollArea) {
        scrollArea?.removeEventListener('scroll', scroll);
        scrollArea = next;
        target.current = next;
        next?.classList.add('has-scroll-rail');
        if (next) managed.current.add(next);
        // Kept-alive pages retain the same content width while hidden. Restoring
        // native scrollbar width between visits would reflow and shift scrollTop.
        managed.current.forEach(area => { if (!area.isConnected) managed.current.delete(area); });
        next?.addEventListener('scroll', scroll, { passive: true });
        observeSizes();
      }
      const maximum = next ? Math.max(0, next.scrollHeight - next.clientHeight) : 0;
      if (!next || maximum < 2 || next.clientHeight < 1) {
        // Keep the old geometry during disappearance instead of snapping to the top.
        setMetrics(previous => previous.maximum ? { ...previous, maximum: 0, value: 0 } : previous);
        latest.current = { ...latest.current, maximum: 0, value: 0 };
        return;
      }
      const bounds = next.getBoundingClientRect();
      const workspace = main.parentElement!.getBoundingClientRect();
      const height = Math.max(0, next.clientHeight - 16);
      const thumb = Math.min(height, Math.max(36, height * next.clientHeight / next.scrollHeight));
      const value = Math.min(maximum, Math.max(0, next.scrollTop));
      const measured = { top: bounds.top - workspace.top + 8, height, thumb, position: (height - thumb) * value / maximum, maximum, value };
      latest.current = measured;
      setMetrics(previous => Object.keys(measured).every(key => Math.abs(previous[key as keyof Metrics] - measured[key as keyof Metrics]) < .25) ? previous : measured);
    };
    function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(measure); }
    const structure = new MutationObserver(() => {
      if (disposed) return;
      // New sections can change scrollHeight without changing the fixed viewport box.
      observeSizes();
      schedule();
    });
    if (host) structure.observe(host, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); clearTimeout(idle); sizes.disconnect(); structure.disconnect();
      scrollArea?.removeEventListener('scroll', scroll);
      // An old callback/cleanup owns only its captured page, never a newer
      // effect's interaction target or observers after lazy mounting.
      if (target.current === scrollArea) {
        target.current = null;
        drag.current = null; setDragging(false); setScrolling(false);
      }
      scrollArea = null;
    };
  }, [content, view, loading]);

  const seekFromPointer = (clientY: number, offset: number) => {
    const area = target.current, box = rail.current?.getBoundingClientRect(), state = latest.current;
    if (!area || !box || !state.maximum) return;
    area.scrollTop = Math.max(0, Math.min(1, (clientY - box.top - offset) / Math.max(1, state.height - state.thumb))) * state.maximum;
  };
  const visible = metrics.maximum > 1;
  const style = { '--rail-top': `${metrics.top}px`, '--rail-height': `${metrics.height}px`, '--thumb-position': `${metrics.position}px`, '--thumb-size': `${metrics.thumb}px` } as CSSProperties;
  return <div ref={rail} className={`page-scroll-rail ${visible ? 'is-visible' : ''} ${dragging ? 'is-dragging' : ''} ${scrolling ? 'is-scrolling' : ''}`} style={style}
    role="scrollbar" aria-label="页面滚动" aria-controls="main-content" aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={Math.round(metrics.maximum)} aria-valuenow={Math.round(metrics.value)}
    aria-valuetext={`${Math.round(metrics.maximum ? metrics.value / metrics.maximum * 100 : 0)}%`} aria-hidden={!visible} tabIndex={visible ? 0 : -1}
    onPointerDown={event => {
      if (event.button !== 0 || !visible) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      const box = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - box.top;
      const state = latest.current;
      const displayedPosition = new DOMMatrix(getComputedStyle(event.currentTarget.firstElementChild!).transform).m42;
      const onThumb = y >= displayedPosition && y <= displayedPosition + state.thumb;
      const offset = onThumb ? y - displayedPosition : state.thumb / 2;
      drag.current = { pointer: event.pointerId, offset }; setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      seekFromPointer(event.clientY, offset);
    }}
    onPointerMove={event => { if (drag.current?.pointer === event.pointerId) seekFromPointer(event.clientY, drag.current.offset); }}
    onPointerUp={() => { drag.current = null; setDragging(false); }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onWheel={event => { if (target.current) target.current.scrollTop += event.deltaY; }}
    onKeyDown={event => {
      const area = target.current;
      if (!area) return;
      const step = area.clientHeight * .85;
      const positions: Record<string, number> = { ArrowDown: area.scrollTop + 48, ArrowUp: area.scrollTop - 48, PageDown: area.scrollTop + step, PageUp: area.scrollTop - step, Home: 0, End: latest.current.maximum };
      if (!(event.key in positions)) return;
      event.preventDefault(); area.scrollTop = positions[event.key];
    }}><span className="page-scroll-thumb" aria-hidden="true" /></div>;
}
