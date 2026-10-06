// Isolated HTTP fixture hosting the production mobile Vue build in Chromium.
// It does not import the desktop app or touch its music/preferences.
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'mobile_UI', 'dist');
const profile = path.join(root, '.test-artifacts', 'mobile', 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

const duration = 90, rate = 16000, audioBytes = duration * rate * 2;
const wav = Buffer.alloc(44 + audioBytes);
wav.write('RIFF'); wav.writeUInt32LE(36 + audioBytes, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(audioBytes, 40);
const times = [0, 5, 10, 20, 30, 40, 50, 70];
const records = [
  ['暂停定位测试', '海岸'], ['延迟返回的旧歌', '迟到'], ['最终选择的歌曲', '最终'],
];
const songs = records.map(([songName], id) => ({ id, songName, artist: 'Wuu 手机回归', album: '虚构歌库', hasCover: true }));
// The lyric regression deliberately restores a desktop index from a different
// ordering. Paths point to genuine, isolated WAVs; other visual fixtures retain
// their original small index-only contract.
const pathFixture = process.env.WUU_MOBILE_LYRIC_PATH_FIXTURE === '1';
if (pathFixture) {
  const musicDir = path.join(root, '.test-artifacts', 'mobile', 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  songs.forEach(song => {
    song.audioPath = path.join(musicDir, `${song.songName}.wav`);
    fs.writeFileSync(song.audioPath, wav);
  });
}
const lyrics = Object.fromEntries(records.map(([, prefix], id) => [id, times.map(time =>
  `[${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}.00]${prefix}·${time}秒歌词`).join('\n')]));
const state = { playMode: 1, isPlaying: false, index: 0, currentTime: 35, duration, songInfo: songs[0], updatedAt: Date.now() };
const fixture = { origin: '', songs, state, times, lyrics, lyricDelays: { 0: 0, 1: 1800, 2: 100 }, audioDelay: 900, requests: [], progress: {} };
if (pathFixture) { state.index = 1; state.audioPath = songs[0].audioPath; }
fixture.mediaGate = { armed: false, label: '', pending: [] };
fixture.armMediaGate = label => {
  if (fixture.mediaGate.pending.length) throw new Error('Release the previous native media gate first');
  fixture.mediaGate.armed = true; fixture.mediaGate.label = label;
};
fixture.releaseMediaGate = () => {
  fixture.mediaGate.armed = false;
  const pending = fixture.mediaGate.pending.splice(0);
  pending.forEach(deliver => deliver());
  return pending.length;
};
global.__wuuMobileFixture = fixture;

function send(res, status, content, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(content);
}
function json(res, value) { send(res, 200, JSON.stringify(value)); }
function stream(req, res, log, id) {
  const content = pathFixture ? fs.readFileSync(songs[id].audioPath) : wav;
  let start = 0, end = content.length - 1;
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (match) {
    if (!match[1]) start = Math.max(0, content.length - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= content.length) {
      send(res, 416, '', 'audio/wav', { 'Content-Range': `bytes */${content.length}` });
      return;
    }
  }
  const delay = id === 0 ? fixture.audioDelay : 0;
  log.delayMs = delay;
  const deliver = () => setTimeout(() => {
    if (res.destroyed) { log.abortedAt = Date.now(); return; }
    log.servedAt = Date.now(); log.start = start; log.end = end;
    res.writeHead(match ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store', 'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${content.length}` } : {}) });
    res.end(req.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
  }, delay);
  if (fixture.mediaGate.armed) {
    log.gate = fixture.mediaGate.label; log.heldAt = Date.now();
    fixture.mediaGate.pending.push(() => { log.releasedAt = Date.now(); deliver(); });
  } else deliver();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const log = { method: req.method, path: url.pathname, query: url.search, startedAt: Date.now() };
  fixture.requests.push(log);
  try {
    if (url.pathname === '/api/songs') {
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const filtered = songs.filter(song => `${song.songName} ${song.artist}`.toLowerCase().includes(query));
      return json(res, { ok: true, songs: filtered, total: filtered.length, page: 1, hasMore: false });
    }
    if (url.pathname === '/api/state') return json(res, { ok: true, state });
    if (url.pathname === '/api/sync-mode') return json(res, { ok: true, mode: 'merged' });
    if (url.pathname === '/api/random') return json(res, { ok: true, song: songs[0], index: 0, total: songs.length });
    if (url.pathname === '/api/liked') return json(res, { ok: true, likedIndices: [] });
    if (url.pathname === '/api/disliked') return json(res, { ok: true, dislikedIndices: [] });
    if (url.pathname === '/api/collections') return json(res, { ok: true, collections: [] });
    if (url.pathname === '/api/audio-fx-presets') return json(res, { ok: true, customs: [] });
    const lyric = /^\/api\/lyric\/(\d+)$/.exec(url.pathname);
    if (lyric || url.pathname === '/api/lyric-by-path') {
      const id = lyric ? Number(lyric[1]) : songs.findIndex(song => song.audioPath === url.searchParams.get('path'));
      if (id < 0) return send(res, 403, 'Unknown isolated song path', 'text/plain');
      log.id = id; log.delayMs = fixture.lyricDelays[id] || 0;
      return setTimeout(() => {
        if (res.destroyed) { log.abortedAt = Date.now(); return; }
        log.servedAt = Date.now();
        send(res, 200, fixture.lyrics[id] || '', 'text/plain; charset=utf-8');
      }, log.delayMs);
    }
    const audio = /^\/api\/stream\/(\d+)$/.exec(url.pathname);
    if (audio) return stream(req, res, log, Number(audio[1]));
    if (url.pathname === '/api/stream-by-path') {
      const id = pathFixture ? songs.findIndex(song => song.audioPath === url.searchParams.get('path')) : 0;
      if (id < 0) return send(res, 403, 'Unknown isolated song path', 'text/plain');
      log.id = id; return stream(req, res, log, id);
    }
    if (/^\/api\/cover\//.test(url.pathname) || url.pathname === '/api/cover-by-path') {
      return send(res, 200, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#345361"/><circle cx="200" cy="200" r="115" fill="#d7ab76"/><path d="M0 285 Q140 140 250 285 T400 250V400H0Z" fill="#345361"/></svg>', 'image/svg+xml');
    }
    const progress = /^\/api\/progress\/(\d+)$/.exec(url.pathname);
    if (progress) return json(res, { ok: true, progress: fixture.progress[progress[1]] || 0 });
    if (url.pathname === '/api/progress' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      fixture.progress[data.index] = data.time;
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/play-count' && req.method === 'POST') { req.resume(); return json(res, { ok: true }); }
    if (url.pathname.startsWith('/api/')) return send(res, 404, JSON.stringify({ ok: false, message: 'Unknown fixture endpoint' }));
    if (url.pathname === '/favicon.ico') return send(res, 204, '');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) { send(res, 500, JSON.stringify({ ok: false, message: error.message })); }
});

app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build mobile_UI before running the mobile regression');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.origin = `http://127.0.0.1:${server.address().port}`;
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({ width: 414, height: 896, useContentSize: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setAudioMuted(true);
  void window.loadURL(fixture.origin + '/index.html');
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => server.close());
