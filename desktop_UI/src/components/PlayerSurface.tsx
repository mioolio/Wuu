import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './player-surface.css';

// Keep a surface's contents mounted after its first opening. A cancelled close
// resumes from the same form values rather than recreating the panel.
export function useSurfacePresence(open: boolean, duration = 170) {
  const seen = useRef(open);
  const [present, setPresent] = useState(open);
  if (open) seen.current = true;
  useLayoutEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (open) { setPresent(true); return; }
    if (!present || preference.matches) { setPresent(false); return; }
    const timeout = window.setTimeout(() => setPresent(false), duration);
    const reduce = () => { if (preference.matches) { window.clearTimeout(timeout); setPresent(false); } };
    preference.addEventListener('change', reduce);
    return () => { window.clearTimeout(timeout); preference.removeEventListener('change', reduce); };
  }, [open, present, duration]);
  return { seen: seen.current, visible: open || present, state: open ? 'open' : present ? 'closing' : 'closed' };
}

function topDialog() {
  const visible = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length);
  // Global prompts use a higher visual layer. Portal insertion order can put
  // their outer player dialog later in the DOM, without making it topmost.
  return visible.filter(element => element.closest('.global-dialog-surface')).at(-1) || visible.at(-1);
}

export function useSurfaceFocus<T extends HTMLElement>(ref: RefObject<T | null>, open: boolean, close: () => void, modal = false, options: { returnTo?: RefObject<HTMLElement | null>; restore?: boolean } = {}) {
  const closeRef = useRef(close);
  const optionsRef = useRef(options);
  closeRef.current = close;
  optionsRef.current = options;
  useLayoutEffect(() => {
    const surface = ref.current;
    if (!open || !surface) return;
    const previous = optionsRef.current.returnTo?.current || document.activeElement as HTMLElement | null;
    const controls = () => [...surface.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
      .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
    (controls()[0] || surface).focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      const top = topDialog();
      if (event.defaultPrevented || (modal ? top !== surface : !!top)) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (!modal || event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); surface.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      // Non-modal queue closing must not steal focus from another clicked control.
      if (optionsRef.current.restore !== false && previous?.isConnected && (modal || surface.contains(document.activeElement) || document.activeElement === document.body)) previous.focus({ preventScroll: true });
    };
  }, [open, modal, ref]);
}

export default function PlayerDialog({ open, onClose, label, id, wide = false, triggerRef, children }: {
  open: boolean; onClose: () => void; label: string; id: string; wide?: boolean; triggerRef?: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const presence = useSurfacePresence(open);
  const card = useRef<HTMLDivElement>(null);
  useSurfaceFocus(card, open, onClose, true, { returnTo: triggerRef });
  if (!presence.seen) return null;
  // The app frame owns theme/opacity variables and never participates in page
  // motion. Keep full-window dialogs outside a page's transformed snapshot.
  const frame = document.querySelector('.app-shell') || document.body;
  return createPortal(<div className="modal-backdrop player-dialog-surface" data-state={presence.state} hidden={!presence.visible} inert={!open} onMouseDown={event => { if (open && event.target === event.currentTarget) onClose(); }}>
    <div className={`modal-card ${wide ? 'wide' : ''}`} ref={card} id={id} role="dialog" aria-modal="true" aria-label={label} aria-hidden={!open} tabIndex={-1}>{children}</div>
  </div>, frame);
}
