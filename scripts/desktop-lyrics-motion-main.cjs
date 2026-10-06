// Production Electron/windows/preload, isolated music and configuration from
// smoke-main, and real cover/color PNG decoding behind explicit test gates.
const { app, ipcMain, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
process.env.WUU_SMOKE_PACKAGED = '0';
process.env.WUU_VISUAL_FIXTURE = '';
process.env.WUU_PLAYER_POLISH_FIXTURE = '1';
process.env.WUU_COVER_STARTUP = '';
process.env.WUU_REVIEW_PROFILE = `lyrics-motion-${Date.now()}`;
process.env.WUU_RENDERER_URL = process.env.WUU_LYRICS_MOTION_RENDERER || '';
const frames = [], requests = [], monitorErrors = [], crashes = [], shows = [], nativeEvents = [], openingAcks = [], clockEvents = [], rawLines = [];
const openings = [], frameStats = { received: 0, native: 0 }, invariantViolations = [];
let observationOrder = 0;
const gates = new Map(), windowShows = new Map();
const normalize = source => String(source).replace(/\\/g, '/').toLowerCase();
const nativeState = contents => {
  try {
    const window = BrowserWindow.fromWebContents(contents);
    return { id: contents.id, url: contents.isDestroyed() ? '' : contents.getURL(),
      visible: !!window && !window.isDestroyed() && window.isVisible(), minimized: !!window && !window.isDestroyed() && window.isMinimized() };
  } catch (error) { return { stateError: String(error) }; }
};
const arm = (source, label) => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  gates.set(normalize(source), { label, promise, release, released: false });
};
global.__wuuLyricsMotion = {
  frames, requests, monitorErrors, crashes, shows, nativeEvents, openingAcks, clockEvents, rawLines, openings, frameStats, invariantViolations, arm,
  lastNativeFrame: null,
  writeRecordings(output) {
    const recordings = { frames, requests, crashes, errors: monitorErrors, shows, nativeEvents, openingAcks, clockEvents, rawLines, openings, frameStats, invariantViolations };
    fs.writeFileSync(output, JSON.stringify(recordings, null, 2));
    const { frames: fullFrames, ...summary } = recordings;
    return { ...summary, retainedFrames: fullFrames.length };
  },
  release(label) {
    const gate = [...gates.values()].find(item => item.label === label && !item.released);
    if (!gate) throw new Error(`Unknown pending palette gate: ${label}`);
    gate.released = true; gate.releasedAt = Date.now(); gate.release();
  },
};
app.on('browser-window-created', (_event, window) => {
  const contents = window.webContents;
  windowShows.set(contents.id, 0);
  for (const type of ['show', 'hide', 'minimize', 'restore', 'closed']) {
    window.on(type, () => nativeEvents.push({ type, at: Date.now(), order: ++observationOrder, ...nativeState(contents) }));
  }
  window.on('show', () => {
    const sequence = (windowShows.get(window.webContents.id) || 0) + 1;
    windowShows.set(window.webContents.id, sequence);
    shows.push({ id: window.webContents.id, sequence, at: Date.now(), order: nativeEvents.findLast(event => event.type === 'show' && event.id === contents.id)?.order });
  });
  window.webContents.on('render-process-gone', (_event, details) => crashes.push({ url: window.webContents.getURL(), ...details }));
});
ipcMain.on('lyric-opening-ready', (event, epoch) => {
  openingAcks.push({ at: Date.now(), order: ++observationOrder, epoch, ...nativeState(event.sender) });
});
ipcMain.on('lyric-data', (_event, payload) => {
  if (payload.type === 'time' || payload.type === 'snapshot') {
    clockEvents.push({ at: Date.now(), nativeSequence: frameStats.native, type: payload.type, t: payload.t, playing: payload.playing, playbackRate: payload.playbackRate, songKey: payload.songKey });
    if (clockEvents.length > 3000) clockEvents.shift();
  }
});
ipcMain.on('wuu-lyrics-motion-frame', (event, frame) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const sequence = windowShows.get(event.sender.id) || 0;
  const shownAt = shows.findLast(show => show.id === event.sender.id && show.sequence === sequence)?.at || Infinity;
  const recorded = { ...frame, sequence: ++frameStats.received, id: event.sender.id, url: event.sender.getURL(), show: windowShows.get(event.sender.id) || 0,
    nativeVisible: !!window && window.isVisible() && !window.isMinimized() && frame.visibility === 'visible' && frame.wall >= shownAt };
  if (recorded.nativeVisible) {
    recorded.nativeSequence = ++frameStats.native;
    global.__wuuLyricsMotion.lastNativeFrame = recorded;
    let opening = openings.find(item => item.id === recorded.id && item.show === recorded.show);
    if (!opening) {
      opening = { id: recorded.id, show: recorded.show, firstNative: recorded, firstWord: null, pendingFrames: 0, pendingPainted: 0 };
      openings.push(opening);
    }
    const painted = recorded.layers.some(layer => layer.visible);
    if (painted && !opening.firstWord) opening.firstWord = recorded;
    if (recorded.ready === 'false') { opening.pendingFrames++; if (painted) opening.pendingPainted++; }
    // Check every genuine native visible frame, even after its full geometry
    // is evicted from the bounded diagnostic buffer on a high-refresh display.
    if (recorded.outgoingWrappers > 1 || recorded.currentWrappers > 1 || recorded.layers.length > 2 || !recorded.outgoingProtected || recorded.controls !== 0) {
      if (invariantViolations.length < 20) invariantViolations.push(recorded);
    }
  }
  frames.push(recorded);
  if (frames.length > 12000) frames.shift();
});
ipcMain.on('wuu-lyrics-motion-monitor-error', (_event, error) => monitorErrors.push(error));
// Register first: smoke-main's later whenReady callback creates the actual
// production windows only after the read-only recorder and real decoder exist.
app.whenReady().then(() => {
  session.defaultSession.setPreloads([...session.defaultSession.getPreloads(), path.join(__dirname, 'desktop-lyrics-motion-preload.cjs')]);
  const decoder = require('../cover/color');
  for (const [channel, method] of [['extract-cover-color', 'extractCoverColor'], ['extract-cover-color-url', 'extractCoverColorFromURL']]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, source) => {
      const gate = gates.get(normalize(source));
      const request = { channel, source, label: gate?.label, started: Date.now(), resolved: null, palette: null };
      requests.push(request);
      if (gate && !gate.released) await gate.promise;
      const palette = await decoder[method](source);
      Object.assign(request, { resolved: Date.now(), palette });
      return palette;
    });
  }
});
require('./smoke-main.cjs');
// These are only the isolated fixture's starting settings, not application code.
Object.assign(global.__wuuSmoke.data.settings, { discCover: false, fadePause: false, currentLyricSize: 30 });
// Distinct actual RAW files reveal stale words when an existing overlay is shown
// again; the shared smoke fixture otherwise gives all three songs identical text.
for (const song of global.__wuuSmoke.songs) {
  const file = path.join(path.dirname(song.audioPath), `${song.songName}-motion.raw`);
  const lines = global.__wuuSmoke.polish.lines.map(([time, original], index, all) => {
    const text = `${song.songName} · ${original}`;
    const duration = ((all[index + 1]?.[0] || 88) - time) * 1000;
    const step = Math.min(700, Math.floor(duration / [...text].length));
    rawLines.push({ songName: song.songName, text, time, duration: duration / 1000, step: step / 1000, characters: [...text].length });
    const main = `[${time * 1000},${duration}]` + [...text].map((char, i) => `<${i * step},${step},0>${char}`).join('');
    // A real same-timestamp companion exercises translation grouping and the
    // entire 900×140 viewport at the user's maximum ordinary lyric font size.
    return main + `\n[${time * 1000},${duration}]<0,${duration},0>Translation ${index + 1}`;
  });
  fs.writeFileSync(file, '[lyricist:Wuu 测试]\n[composer:Wuu 测试]\n' + lines.join('\n'), 'utf8');
  song.rawPath = file;
}
arm(global.__wuuSmoke.songs[0].coverPath, 'first-open');
