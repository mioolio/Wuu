import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { View } from '../types';

export default function NavigationMarker({ navigation, view }: { navigation: RefObject<HTMLElement | null>; view: View }) {
  const [position, setPosition] = useState({ top: 0, left: 0, visible: false, animated: false });
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const current = nav.querySelector<HTMLElement>('button[aria-current="page"]');
      if (!current) return;
      const bounds = current.getBoundingClientRect(), container = nav.getBoundingClientRect();
      const scrollArea = current.closest('.sidebar-scroll')?.getBoundingClientRect() || container;
      setPosition({ top: bounds.top - container.top + (bounds.height - 16) / 2, left: bounds.left - container.left, visible: bounds.top >= scrollArea.top - 1 && bounds.bottom <= scrollArea.bottom + 1, animated: mounted.current });
      mounted.current = true;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(nav);
    nav.addEventListener('scroll', schedule, true);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); nav.removeEventListener('scroll', schedule, true); };
  }, [navigation, view]);
  return <span aria-hidden="true" className={`nav-selection-marker ${position.animated ? 'is-ready' : ''}`} style={{ transform: `translate(${position.left}px, ${position.top}px)`, opacity: position.visible ? 1 : 0 }} />;
}
