// Exercise the production HTTP dispatcher and WS welcome with only I/O
// boundaries replaced. No port, Electron window or user configuration opens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const songs = [
  { id: 0, songName: '服务目录第一首 B', audioPath: '/known/B.wav', rawPath: '/known/B.raw', lrcPath: '/known/B.lrc' },
  { id: 1, songName: '桌面排序第一首 A', audioPath: '/known/A.wav', rawPath: '/known/A.raw', lrcPath: '/known/A.lrc' },
];
function fixture() {
  let dispatch, worker, room;
  const files = new Map([['/known/A.raw', '[1000,500]<0,500,0>实际 A 逐字歌词'],
    ['/known/A.lrc', '[00:01]实际 A 标准歌词'], ['/known/B.raw', '[1000,500]<0,500,0>实际 B 逐字歌词']]);
  class ScanWorker extends EventEmitter {
    constructor() { super(); worker = this; }
    postMessage() {}
    terminate() {}
  }
  class Room extends EventEmitter { constructor() { super(); room = this; } close() {} }
  const commands = [];
  const desktop = new EventEmitter(); desktop.isDestroyed = () => false;
  desktop.send = (channel, command) => commands.push({ channel, command });
  const mainWindow = { isDestroyed: () => false, webContents: desktop };
  const ipc = new Map();
  const fakeHttp = { createServer: handler => {
    dispatch = handler;
    const server = new EventEmitter(); server.listen = (_port, _ip, ready) => ready?.(); server.close = () => {};
    return server;
  } };
  const replacements = {
    http: fakeHttp,
    fs: { existsSync: file => files.has(file), readFileSync: file => {
      if (!files.has(file)) throw Error('Unknown fixture file'); return files.get(file);
    }, mkdirSync() {} },
    worker_threads: { Worker: ScanWorker }, ws: { WebSocketServer: Room },
    '../core/storage': { configDir: '/isolated', ensureConfigDir() {}, readUserData: () => ({ settings: {} }), writeUserData() {} },
    '../core/logger': { dbgLog() {}, dbgErr() {} },
    '../core/state': { getMainWindow: () => mainWindow },
    './play-count': { incrementPlayCount() {} }, './together-state': require('./together-state'),
    electron: { ipcMain: { handle: (name, fn) => ipc.set(name, fn) } },
  };
  const context = vm.createContext({ console: { log() {}, error() {} }, URL, Buffer,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name),
    __dirname: path.join(root, 'server'), module: { exports: {} },
    setInterval: () => 1, clearInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), context);
  context.module.exports.startServer(12345, '127.0.0.1');
  const request = async url => {
    let status, body;
    await dispatch({ method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, {
      setHeader() {}, writeHead: value => { status = value; }, end: value => { body = value; },
    });
    return { status, body, json: () => JSON.parse(body) };
  };
  const scan = rows => worker.emit('message', { type: 'scan-result', ok: true, songs: rows });
  const update = (song, index = 0) => context.updateDesktopState({ index, songInfo: song,
    duration: 90, currentTime: 35, isPlaying: false, playbackRate: 2 });
  class Phone extends EventEmitter {
    readyState = 1; messages = [];
    send(text) { this.messages.push(JSON.parse(text)); }
    ping() {}
  }
  const join = async () => {
    await ipc.get('desktop-together-ready')({ sender: desktop }, true);
    context._ensureTogetherWss();
    const phone = new Phone(); room.emit('connection', phone, { headers: {}, socket: { remoteAddress: '127.0.0.1' } });
    return phone;
  };
  return { request, scan, update, join, context, files, commands, desktop };
}

test('首次 HTTP 状态按路径映射独立服务器索引；扫描前不返回桌面错位索引', async () => {
  const f = fixture(); f.update(songs[1], 0);
  let done = false;
  const pending = f.request('/api/state').then(value => { done = true; return value; });
  await flush(); assert.equal(done, false, 'State waits for the first server identity map, without a guessed index');
  f.scan(songs); const result = await pending;
  assert.equal(result.status, 200);
  const state = result.json().state;
  assert.equal(state.index, 1); assert.equal(state.songInfo.id, 1);
  assert.equal(state.audioPath, songs[1].audioPath); assert.equal(state.songInfo.songName, songs[1].songName);
  assert.equal(state.currentTime, 35); assert.equal(state.playbackRate, 2);
});

test('路径歌词与实际音源一致，旧索引仍兼容，陌生路径不回落其他歌', async () => {
  const f = fixture(); f.scan(songs); await flush();
  const actual = await f.request('/api/lyric-by-path?path=' + encodeURIComponent(songs[1].audioPath));
  assert.equal(actual.status, 200); assert.equal(actual.body, f.files.get(songs[1].rawPath));
  const legacy = await f.request('/api/lyric/0');
  assert.equal(legacy.status, 200); assert.equal(legacy.body, f.files.get(songs[0].rawPath));
  f.files.delete(songs[1].rawPath);
  const fallback = await f.request('/api/lyric-by-path?path=' + encodeURIComponent(songs[1].audioPath));
  assert.equal(fallback.body, f.files.get(songs[1].lrcPath), 'A missing raw file uses the same song standard lyric');
  const unknown = await f.request('/api/lyric-by-path?path=' + encodeURIComponent('/private/B.wav'));
  assert.equal(unknown.status, 403); assert.equal(unknown.body, undefined);
  assert.equal((await f.request('/api/lyric-by-path')).status, 403);
});

test('首次 WS 欢迎等待路径索引，取扫描完成时最新曲目；已关闭手机无迟到欢迎', async () => {
  const f = fixture(); f.update(songs[1], 0);
  const phone = await f.join(); const closed = await f.join();
  assert.equal(phone.messages.some(message => message.type === 'welcome'), false);
  closed.readyState = 3; closed.emit('close');
  f.update(songs[0], 1); f.scan(songs); await flush();
  const welcome = phone.messages.find(message => message.type === 'welcome');
  assert.equal(welcome.hostSong.song.id, 0); assert.equal(welcome.hostSong.audioPath, songs[0].audioPath);
  assert.equal(welcome.hostSong.position, 35); assert.equal(welcome.hostSong.playbackRate, 2);
  assert.equal(closed.messages.some(message => message.type === 'welcome'), false);
  for (const message of phone.messages.filter(message => message.op === 'state')) {
    assert.equal(message.payload.song.id, 0, 'Cold-cache publications never leak desktop indices');
  }
});

test('真实试听快照无需歌库扫描；未知本地路径不能伪装成库内曲目', async () => {
  const f = fixture(); f.update({ preview: true, audioPath: 'https://trusted/current.wav', lyric: '[00:00]真实试听词' }, -1);
  const result = await f.request('/api/state');
  assert.equal(result.status, 200); assert.equal(result.json().state.index, -1);
  assert.equal(result.json().state.songInfo.lyric, '[00:00]真实试听词');
  const phone = await f.join();
  assert.equal(phone.messages.find(message => message.type === 'welcome').hostSong.song.preview, true);
  f.scan(songs); await flush(); f.update({ audioPath: '/private/outside.wav', songName: '不在库中' }, 0);
  assert.equal((await f.request('/api/state')).json().state.index, -1);
  assert.equal(f.context._desktopTogetherSnapshot().song, null);
});

test('冷扫描期间新命令未 ACK，迟到广播及欢迎只使用此前确认的播放状态', async () => {
  const f = fixture(); f.update(songs[1], 0);
  const phone = await f.join();
  f.update(songs[1], 0); // Accepted publication now waits for the cold scan.
  // A rate command is valid even before the library identity scan finishes.
  phone.emit('message', Buffer.from(JSON.stringify({ type: 'op', op: 'rate', payload: { playbackRate: .5 } })));
  const command = f.commands.at(-1).command;
  f.context.updateDesktopState({ index: 1, songInfo: songs[0], currentTime: 0, isPlaying: false, playbackRate: .5 });
  f.scan(songs); await flush();
  assert.equal(phone.messages.filter(message => message.op === 'state').length, 0, 'Deferred broadcasts cannot bypass a new pending command');
  const welcome = phone.messages.find(message => message.type === 'welcome');
  assert.equal(welcome.hostSong.audioPath, songs[1].audioPath);
  assert.equal(welcome.hostSong.position, 35); assert.equal(welcome.hostSong.playbackRate, 2);
  phone.emit('message', Buffer.from(JSON.stringify({ type: 'get-state' })));
  const explicit = phone.messages.filter(message => message.op === 'state').at(-1).payload;
  assert.equal(explicit.audioPath, songs[1].audioPath); assert.equal(explicit.position, 35);
  assert.equal((await f.request('/api/state')).json().state.audioPath, songs[1].audioPath);
  f.context.updateDesktopState({ index: 1, songInfo: songs[0], currentTime: 18, isPlaying: false,
    playbackRate: .5, togetherSession: command.session, togetherSeq: command.seq });
  const accepted = phone.messages.filter(message => message.op === 'state').at(-1).payload;
  assert.equal(accepted.audioPath, songs[0].audioPath); assert.equal(accepted.position, 18); assert.equal(accepted.playbackRate, .5);
});

test('冷扫描回调不再发布已经销毁的桌面发送端状态', async () => {
  const f = fixture(); f.update(songs[1], 0);
  const phone = await f.join(); f.update(songs[1], 0);
  f.desktop.emit('destroyed'); f.scan(songs); await flush();
  assert.equal(phone.messages.filter(message => message.op === 'state').length, 0);
  const welcome = phone.messages.find(message => message.type === 'welcome');
  assert.equal(welcome.desktopConnected, false); assert.equal(welcome.hostSong.desktopConnected, false);
});

test('mobile API 有路径时优先稳定歌词身份，无路径时保留旧请求', async t => {
  const requests = [], original = global.fetch;
  global.fetch = async url => { requests.push(url); return { ok: true, text: async () => '真实词' }; };
  t.after(() => { global.fetch = original; });
  const { fetchLyric } = await import('../mobile_UI/src/api.js');
  const audioPath = 'D:\\音乐库\\A & B.wav';
  assert.equal(await fetchLyric(0, audioPath), '真实词');
  assert.equal(requests[0], '/api/lyric-by-path?path=' + encodeURIComponent(audioPath));
  await fetchLyric(3); assert.equal(requests[1], '/api/lyric/3');
});
