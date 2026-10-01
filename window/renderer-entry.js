const path = require('path');

function rendererPath(kind = 'main', mode = 'modern') {
  return mode === 'classic'
    ? path.join(__dirname, '..', 'renderer', kind === 'lyrics' ? 'desktop-lyric.html' : 'index.html')
    : path.join(__dirname, '..', 'desktop_UI', 'dist', 'index.html');
}

function loadRenderer(window, kind = 'main', session = {}) {
  const mode = session.mode || require('../core/storage').readUserData().settings?.interfaceMode || 'modern';
  const query = kind === 'lyrics' ? { window: 'lyrics' } : {};
  if (kind === 'main' && session.mode) query.interfaceSwitch = '1';
  if (kind === 'main' && session.playing === false) query.interfacePaused = '1';
  if (kind === 'main' && session.desktopLyrics) query.desktopLyrics = '1';
  // The original renderer is always loaded from its own files, also in development.
  if (mode === 'classic') return window.loadFile(rendererPath(kind, mode), { query });
  const developmentURL = !require('electron').app.isPackaged && process.env.WUU_RENDERER_URL;
  if (developmentURL) {
    const url = new URL(developmentURL);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key, value);
    return window.loadURL(url.href);
  }
  return window.loadFile(rendererPath(kind, mode), { query });
}
module.exports = { loadRenderer, rendererPath };
