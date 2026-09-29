const path = require('path');

function loadRenderer(window, kind = 'main') {
  const developmentURL = !require('electron').app.isPackaged && process.env.WUU_RENDERER_URL;
  if (developmentURL) {
    const url = new URL(developmentURL);
    if (kind === 'lyrics') url.searchParams.set('window', 'lyrics');
    return window.loadURL(url.href);
  }
  return window.loadFile(path.join(__dirname, '..', 'desktop_UI', 'dist', 'index.html'), kind === 'lyrics' ? { query: { window: 'lyrics' } } : {});
}
module.exports = { loadRenderer };
