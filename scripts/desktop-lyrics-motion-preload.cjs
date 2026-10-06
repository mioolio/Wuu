// Read-only frame recorder, added by the fixture session before the unchanged
// production preload. It never supplies lyrics, colors, state, or animation.
const { ipcRenderer } = require('electron');
if (location.search.includes('window=lyrics') || location.pathname.endsWith('/desktop-lyric.html')) {
  const opacity = element => {
    let value = 1;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible') return 0;
      value *= Number(style.opacity);
    }
    return value;
  };
  const geometry = element => {
    if (!element) return null;
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { text: element.textContent, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      center: box.top + box.height / 2, fontSize: parseFloat(style.fontSize) };
  };
  const matrix = transform => {
    const value = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    return { y: value.m42, scale: value.m22 };
  };
  const layer = track => {
    const wrapper = track.closest('.desktop-lyric-outgoing, .desktop-lyric-current-content') || track.parentElement;
    const box = track.getBoundingClientRect();
    const style = getComputedStyle(track);
    const ink = track.querySelector('.desktop-char, .desktop-outgoing-char') || track;
    const painted = opacity(track);
    const animator = track.closest('.desktop-line-enter') || wrapper;
    const animation = animator?.getAnimations().find(item => item.effect?.target === animator);
    return { text: track.textContent, outgoing: !!track.closest('.desktop-lyric-outgoing'),
      line: track.dataset.line, revision: track.dataset.revision, songKey: wrapper?.dataset.songKey,
      transition: wrapper?.dataset.transition, opacity: painted,
      visible: painted > .0001 && box.width > 0 && box.height > 0 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight,
      color: style.getPropertyValue('--lyric-color').trim(), secondary: style.getPropertyValue('--lyric-secondary').trim(),
      gradient: getComputedStyle(ink).backgroundImage, fill: ink.style.getPropertyValue('--fill'),
      fills: [...track.querySelectorAll('[data-char]')].map(char => parseFloat(char.style.getPropertyValue('--fill'))),
      transform: animator ? getComputedStyle(animator).transform : '', animation: animator ? getComputedStyle(animator).animationName : '',
      matrix: animator ? matrix(getComputedStyle(animator).transform) : null,
      keyframes: animation?.effect.getKeyframes().map(frame => ({ offset: frame.offset, opacity: frame.opacity,
        transform: frame.transform, ...(frame.transform ? matrix(frame.transform) : {}) })) || [],
      timing: animation?.effect.getComputedTiming(), fontSize: parseFloat(style.fontSize),
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    };
  };
  const record = time => {
    try {
      const root = document.querySelector('.desktop-lyrics');
      const stage = document.querySelector('.desktop-lyric-stage');
      ipcRenderer.send('wuu-lyrics-motion-frame', {
        wall: Date.now(), time, visibility: document.visibilityState, ready: root?.dataset.ready,
        colorSettled: root?.dataset.colorSettled, openingEpoch: root?.dataset.openingEpoch,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        currentWrappers: document.querySelectorAll('.desktop-lyric-current-content').length,
        outgoingWrappers: document.querySelectorAll('.desktop-lyric-outgoing').length,
        outgoingProtected: [...document.querySelectorAll('.desktop-lyric-outgoing')].every(node => node.hasAttribute('inert') && node.getAttribute('aria-hidden') === 'true'),
        layers: [...document.querySelectorAll('.desktop-lyric-track, .desktop-outgoing-track')].map(layer),
        next: document.querySelector('.desktop-next-row')?.textContent,
        viewport: { width: innerWidth, height: innerHeight }, controls: root?.querySelectorAll('button, .desktop-lyric-controls').length || 0,
        entering: geometry(document.querySelector('.desktop-line-enter')),
        preview: geometry(document.querySelector('.desktop-next-row')),
        translations: [...document.querySelectorAll('.desktop-current-translation')].map(geometry),
        slideDistance: parseFloat(stage?.style.getPropertyValue('--lyric-slide-distance')),
        slideScale: parseFloat(stage?.style.getPropertyValue('--lyric-slide-scale')),
      });
    } catch (error) { ipcRenderer.send('wuu-lyrics-motion-monitor-error', String(error)); }
    requestAnimationFrame(record);
  };
  requestAnimationFrame(record);
}
