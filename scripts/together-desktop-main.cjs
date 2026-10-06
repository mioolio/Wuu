// Genuine desktop + mobile renderer and production HTTP/WS/IPC bridge.
// Only the library/configuration boundaries are isolated to the smoke WAVs.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { EventEmitter } = require('events');
const { app, BrowserWindow, ipcMain } = require('electron');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'together');
const configDir = path.join(artifacts, 'config');
fs.mkdirSync(configDir, { recursive: true });
require('./smoke-main.cjs');

const fixture = global.__wuuSmoke;
const startupTimes = [0, 5, 10, 20, 30, 40, 50, 70];
const startupLyrics = fixture.songs.map((song, index) => {
  const prefix = `首开${String.fromCharCode(65 + index)}`;
  const lyricist = `${prefix}词作者`, composer = `${prefix}曲作者`;
  const file = path.join(artifacts, `${prefix}.lrc`);
  const lines = startupTimes.map(time => `${prefix}·${time}秒歌词`);
  fs.writeFileSync(file, `[lyricist:${lyricist}]\n[composer:${composer}]\n` + startupTimes.map((time, i) =>
    `[${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}.00]${lines[i]}`).join('\n'), 'utf8');
  Object.assign(song, { lrcPath: file, rawPath: null, lyricist, composer });
  return { audioPath: song.audioPath, lines, lyricist, composer };
});
// Desktop library order stays A,B,C. The real production HTTP/WS server scans
// B,C,A, reproducing a desktop index that cannot identify a mobile lyric.
const serverSongs = [fixture.songs[1], fixture.songs[2], fixture.songs[0]].map((song, id) => ({ ...song, id }));
const port = Number(process.env.WUU_TOGETHER_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A dedicated fixture port is required');
Object.assign(fixture.data.settings, { interfaceMode: 'modern', mobileEnabled: true, serverEnabled: false,
  serverPort: port, serverBindIP: '127.0.0.1', syncMode: 'merged', playbackRate: 1 });
const storage = require('../core/storage');
Object.assign(storage, { configDir, ensureConfigDir: () => fs.mkdirSync(configDir, { recursive: true }) });

const log = { ipc: [], commands: [], scans: [], crashes: [], mainIds: [], upstream: [], audioOutput: [], mediaGates: [] };
const mediaGate = { armed: false, label: '', pending: [] };
const armMobileMediaGate = label => {
  if (mediaGate.pending.length) throw new Error('Release the previous native media gate first');
  mediaGate.armed = true; mediaGate.label = label;
};
const releaseMobileMediaGate = () => {
  mediaGate.armed = false;
  const pending = mediaGate.pending.splice(0);
  pending.forEach(deliver => deliver());
  return pending.length;
};
const unknownPath = path.join(artifacts, 'outside-library.wav');
fs.copyFileSync(fixture.songs[0].audioPath, unknownPath);
const previewLyric = '[lyricist:一起听测试作者]\n[composer:一起听测试作者]\n[00:00.00]试听中的海风\n[00:04.00]把远方的声音带到手机\n[00:12.00]暂存心动，选择保存';
const previewLines = ['试听中的海风', '把远方的声音带到手机', '暂存心动，选择保存'];
let previewOrigin = '';
const upstream = http.createServer((req, res) => {
  log.upstream.push({ at: Date.now(), path: req.url, range: req.headers.range || null, agent: req.headers['user-agent'] || '' });
  if (!/^\/preview\/[a-z\d-]+\.wav(?:\?.*)?$/i.test(req.url)) { res.writeHead(404); res.end(); return; }
  const content = fs.readFileSync(fixture.songs[0].audioPath);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? range[1] ? Number(range[1]) : Math.max(0, content.length - Number(range[2])) : 0;
  const end = range && range[1] && range[2] ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
  if (start > end || start >= content.length) { res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }); res.end(); return; }
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${content.length}` } : {}) });
  res.end(req.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
});
const upstreamReady = new Promise(resolve => upstream.listen(0, '127.0.0.1', () => {
  previewOrigin = `http://127.0.0.1:${upstream.address().port}`; resolve();
}));
upstream.unref();
ipcMain.removeHandler('netease-preview');
ipcMain.handle('netease-preview', async (_event, { songId: id, quality }) => {
  await upstreamReady;
  if (!/^[a-z\d-]+$/i.test(String(id))) throw new Error('Unknown isolated preview id');
  fixture.discovery.previewRequests.push({ id, quality });
  return { ok: true, data: { url: `${previewOrigin}/preview/${id}.wav`,
    meta: { title: `新曲 ${String(id).replace('remote-', '')}`, artist: '一起听试听', cover: fixture.songs[0].coverPath }, lrcText: previewLyric } };
});
global.__wuuTogether = { log, port, origin: `http://127.0.0.1:${port}`, configDir,
  unknownPath, previewLines, previewLyric, startupLyrics, serverSongs, armMobileMediaGate, releaseMobileMediaGate,
  get previewOrigin() { return previewOrigin; },
  unmuteMain: () => {
    // smoke-main mutes its windows at startup. The fixture WAV is already all
    // zero PCM, so keep real native output active without making any sound.
    const win = require('../core/state').getMainWindow();
    if (!win || win.isDestroyed()) throw new Error('The isolated main window is not available');
    win.webContents.setAudioMuted(false);
    const state = { at: Date.now(), role: 'desktop', windowId: win.id, muted: win.webContents.isAudioMuted() };
    log.audioOutput.push(state); return state;
  },
  openMobile: async () => {
    const win = new BrowserWindow({ width: 390, height: 844, show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: `together-mobile-${Date.now()}`, backgroundThrottling: false } });
    win.webContents.setAudioMuted(false);
    log.audioOutput.push({ at: Date.now(), role: 'phone', windowId: win.id, muted: win.webContents.isAudioMuted() });
    await win.loadURL(`http://127.0.0.1:${server.getPort()}/index.html`);
    return win.id;
  } };
app.on('browser-window-created', (_event, win) => {
  const wc = win.webContents;
  wc.on('render-process-gone', (_e, details) => log.crashes.push({ windowId: win.id, url: wc.getURL(), ...details }));
  const originalSend = wc.send;
  wc.send = function (channel, ...args) {
    if (channel === 'desktop-together-command') log.commands.push({ at: Date.now(), windowId: win.id, command: args[0] });
    return Reflect.apply(originalSend, this, [channel, ...args]);
  };
});

// Replace the smoke stubs with the actual server handlers before the production
// renderer mounts. Observers delegate unchanged; they never acknowledge a command.
for (const channel of ['desktop-state-update', 'server-start', 'server-stop', 'server-get-access-logs',
  'server-clear-access-logs', 'playlist-server-status']) ipcMain.removeHandler(channel);
const originalHandle = ipcMain.handle;
ipcMain.handle = function (channel, listener) {
  if (!['desktop-state-update', 'desktop-together-ready'].includes(channel)) return Reflect.apply(originalHandle, this, [channel, listener]);
  return Reflect.apply(originalHandle, this, [channel, async (event, ...args) => {
    const entry = { at: Date.now(), channel, senderId: event.sender.id, payload: args[0] };
    log.ipc.push(entry);
    if (log.ipc.length > 8000) log.ipc.shift();
    entry.result = await listener(event, ...args);
    return entry.result;
  }]);
};

// The production scanner worker targets the user's library. This fixture worker
// supplies only the same existing, real local audio files exposed by smoke IPC.
// HTTP validation/streaming, WS, state merging and renderer handling remain real.
const workerThreads = require('worker_threads');
const OriginalWorker = workerThreads.Worker;
workerThreads.Worker = class FixtureLibraryWorker extends EventEmitter {
  constructor(file) {
    super();
    if (path.basename(file) !== 'scanner-worker.js') throw new Error(`Unexpected fixture worker: ${file}`);
  }
  postMessage(message) {
    if (message?.type !== 'scan') throw new Error('Unexpected fixture scanner request');
    log.scans.push({ at: Date.now(), paths: serverSongs.map(song => song.audioPath) });
    setImmediate(() => this.emit('message', { type: 'scan-result', ok: true, songs: serverSongs }));
  }
  terminate() { return Promise.resolve(0); }
};
let server;
try { server = require('../server'); }
finally { workerThreads.Worker = OriginalWorker; ipcMain.handle = originalHandle; }
ipcMain.handle('playlist-server-status', () => ({ ok: true, running: server.isRunning(), port: server.getPort() }));
// Hold only controlled native-test audio requests. Releasing delegates to the
// unmodified production request listener, Range validation and real file bytes.
const originalCreateServer = http.createServer;
http.createServer = function (...args) {
  const listener = typeof args.at(-1) === 'function' ? args.pop() : null;
  if (listener) args.push((req, res) => {
    if (mediaGate.armed && /^\/api\/stream(?:-by-path|\/)/.test(req.url || '')) {
      const entry = { label: mediaGate.label, requestedAt: Date.now(), url: req.url };
      log.mediaGates.push(entry);
      mediaGate.pending.push(() => {
        entry.releasedAt = Date.now();
        if (res.destroyed) { entry.aborted = true; return; }
        listener(req, res);
      });
    } else listener(req, res);
  });
  return Reflect.apply(originalCreateServer, this, args);
};
try { server.startServer(port, '127.0.0.1', [], 0, false); }
finally { http.createServer = originalCreateServer; }
app.whenReady().then(() => {
  const main = require('../core/state').getMainWindow();
  if (main) log.mainIds.push({ windowId: main.id, webContentsId: main.webContents.id });
});
app.on('before-quit', () => { server.stopServer(); upstream.closeAllConnections(); upstream.close(); });
