import type { View } from '../types';

type NavigationAnimator = (from: View, to: View, commit: () => void) => void;
let animator: NavigationAnimator | undefined;

export function registerNavigationAnimator(next: NavigationAnimator) {
  animator = next;
  return () => { if (animator === next) animator = undefined; };
}

export function navigateView(from: View, to: View, commit: () => void) {
  if (animator) animator(from, to, commit);
  else commit();
}
