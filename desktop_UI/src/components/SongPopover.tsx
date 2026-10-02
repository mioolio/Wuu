import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useSurfaceFocus, useSurfacePresence } from './PlayerSurface';
import Icon from './Icon';
import './song-actions.css';

export default function SongPopover({ open, onClose, label, id, triggerRef, children }: {
  open: boolean; onClose: () => void; label: string; id: string;
  triggerRef: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const presence = useSurfacePresence(open);
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!open || !card.current || !triggerRef.current) return;
    const target = card.current, trigger = triggerRef.current;
    const measure = () => {
      const anchor = trigger.getBoundingClientRect(), box = target.getBoundingClientRect();
      const left = Math.max(12, Math.min(innerWidth - box.width - 12, anchor.left + anchor.width / 2 - box.width / 2));
      const below = anchor.bottom + 8;
      const top = Math.max(12, Math.min(innerHeight - box.height - 12,
        below + box.height <= innerHeight - 12 ? below : anchor.top - box.height - 8));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(target); observer.observe(trigger);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, triggerRef]);
  useLayoutEffect(() => {
    const target = card.current;
    if (!open || !target) return;
    let focused: HTMLElement | null = target.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const remember = (event: FocusEvent) => { focused = event.target as HTMLElement; };
    // Share results replace their trigger, and saving a new tag disables its
    // submit button. Recover only unavailable focus, leaving ongoing edits alone.
    const observer = new MutationObserver(() => {
      if (!focused || (focused.isConnected && !focused.matches(':disabled')) || target.contains(document.activeElement) || document.activeElement !== document.body) return;
      const next = [...target.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .find(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
      (next || target).focus({ preventScroll: true });
    });
    target.addEventListener('focusin', remember);
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => { target.removeEventListener('focusin', remember); observer.disconnect(); };
  }, [open]);
  useSurfaceFocus(card, open, onClose, true, { returnTo: triggerRef });
  if (!presence.seen) return null;
  return createPortal(<div className="song-popover-backdrop" data-state={presence.state} hidden={!presence.visible} inert={!open}
    onMouseDown={event => { if (open && event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <div className="song-popover-card" ref={card} style={position} role="dialog" aria-modal="true" aria-label={label} aria-hidden={!open} id={id} tabIndex={-1}>
      <header className="song-popover-heading"><h2>{label}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={`关闭${label}`}><Icon name="close" size={17} /></button></header>
      {children}
    </div>
  </div>, document.querySelector('.app-shell') || document.body);
}
