import { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { registerNavigationAnimator } from '../services/navigation';
import type { View } from '../types';
import './page-motion.css';

const pageKey = (view: View) => view === 'list' || view === 'liked' ? 'library' : view;

export function usePageMotion(view: View, loading: boolean) {
  const transition = useRef<ViewTransition | null>(null);
  const entering = useRef<Animation[]>([]);
  const generation = useRef(0);
  const homeScroll = useRef(0);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    let shared: HTMLElement[] = [];
    const clearShared = () => {
      shared.forEach(element => element.style.removeProperty('view-transition-name'));
      shared = [];
      delete root.dataset.pageTransition;
    };
    const stopVisuals = () => {
      transition.current?.skipTransition();
      entering.current.forEach(animation => animation.cancel());
      entering.current = [];
    };
    const unregister = registerNavigationAnimator((from, to, commit) => {
      // Clicking the active page must leave its live entrance/snapshot alone.
      if (from === to) { commit(); return; }
      // display:none can report scrollTop as zero even though the browser restores
      // its saved position when shown. Read it before hiding the recommendation.
      if (from === 'home') homeScroll.current = document.querySelector('.home-page')?.scrollTop || 0;
      const request = ++generation.current;
      stopVisuals(); clearShared(); transition.current = null;
      const destination = document.querySelector<HTMLElement>(`[data-page="${pageKey(to)}"]`);
      if (preference.matches || document.visibilityState === 'hidden' || !document.startViewTransition || !destination) {
        commit(); return;
      }
      if ((from === 'home' && to === 'player') || (from === 'player' && to === 'home')) {
        const sleeve = document.querySelector<HTMLElement>('.record-artwork-stack');
        const recommendation = document.querySelector<HTMLElement>('.home-hero-cover > .home-artwork');
        const first = sleeve?.querySelector<HTMLImageElement>('.artwork-layer:not(.artwork-outgoing):not(.artwork-pending) img');
        const second = recommendation?.querySelector<HTMLImageElement>('img');
        const homeAtTop = homeScroll.current < 40;
        // Share only the same loaded rectangular cover. A circular record, preview
        // or failed image stays in its page snapshot instead of exposing a square backing.
        if (homeAtTop && sleeve && !sleeve.closest('.is-disc') && recommendation && first?.complete && first.naturalWidth && second?.complete && second.naturalWidth && first.src === second.src) {
          shared = [sleeve, recommendation];
          shared.forEach(element => { element.style.viewTransitionName = 'wuu-artwork'; });
        }
      }
      root.dataset.pageTransition = to === 'player' ? 'to-player' : from === 'player' ? 'from-player' : 'navigate';
      const next = document.startViewTransition(() => {
        // skipTransition still invokes its callback; an old click must not win later.
        if (generation.current === request) flushSync(commit);
      });
      transition.current = next;
      void next.ready.catch(() => {});
      void next.finished.catch(() => {}).finally(() => {
        if (generation.current !== request) return;
        transition.current = null; clearShared();
      });
    });
    const onVisibility = () => { if (document.visibilityState === 'hidden') stopVisuals(); };
    const onPreference = () => { if (preference.matches) stopVisuals(); };
    document.addEventListener('visibilitychange', onVisibility);
    preference.addEventListener('change', onPreference);
    return () => {
      generation.current++; unregister(); stopVisuals(); clearShared();
      document.removeEventListener('visibilitychange', onVisibility);
      preference.removeEventListener('change', onPreference);
    };
  }, []);

  useLayoutEffect(() => {
    entering.current.forEach(animation => animation.cancel());
    entering.current = [];
    if (loading || transition.current || document.visibilityState === 'hidden' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const page = document.querySelector<HTMLElement>(`[data-page="${pageKey(view)}"] > .panel`);
    if (!page) return;
    const sections = view === 'home'
      ? [...page.querySelectorAll<HTMLElement>('.home-header, .home-hero, .home-section, .home-library-card, .home-empty-state')]
      // A panel is the fixed scroll/layout viewport. Moving it exposes its edges
      // and changes the containing block of any fixed-position descendants.
      : [...page.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hidden && !element.matches('.modal-backdrop'));
    entering.current = sections.map((element, index) => element.animate([
      { opacity: .7, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 280, delay: Math.min(index * 20, 60), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
    return () => { entering.current.forEach(animation => animation.cancel()); entering.current = []; };
  }, [view, loading]);
}
