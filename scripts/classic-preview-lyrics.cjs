// Deterministic regression of actual classic preview/lyric functions. Only
// network, media and DOM boundaries are replaced; no server/Electron is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const fmSong = id => ({ id, source: 'fixture', name: `FM ${id}`, artist: 'Real artist' });
const plSong = id => ({ songName: `Playlist ${id}`, artist: 'Real artist', audioUrl: `https://fixture/${id}.wav`, lyricUrl: `https://fixture/${id}.lrc` });
function fixture(kind) {
  const lyricRequests = new Map(), streamRequests = new Map(), pushed = [], renders = [];
  const classes = { add() {}, remove() {}, toggle() {} }, node = () => ({ classList: classes, textContent: '' });
  const context = { console: { error() {} }, Promise, Number, Math, Set,
    fmPreviewMode: true, fmPreviewSong: null, fmPreviewLrc: [], fmPreviewLrcRaw: false,
    fmPreviewLrcText: '', fmPreviewHasValidLrc: false, lrc: [], lrcRaw: false,
    _classicPlayRequest: 0, _togetherRequest: 0, _togetherAcknowledged: 0, _togetherGeneration: 0,
    _togetherSeek: null, _fmCurrentSong: null, _fmTryingFallback: false, _fmSwitchingSource: false,
    _fmLastResults: [], fmPreviewQueue: [], fmPreviewIdx: -1, fmDownload: null,
    isPlaying: false, desktopLyricOn: false, prevCurLine: -1, lineMetrics: [], _cachedLineEls: null,
    empty: node(), player: node(), lyrics: node(), titleEl: node(), artistEl: node(), coverEl: node(),
    appSettings: { discCover: false }, ICON_PREVIEW: 'play',
    plImportList: { querySelectorAll: () => [] }, plParsedSongs: [plSong(0), plSong(1)],
    renderLrc: () => renders.push(context.lrc), syncLrc() {}, sendLyricDataToDesktop() {},
    syncDesktopState: force => pushed.push({ force, song: context.fmPreviewSong, source: context.audio.src,
      lyric: context.fmPreviewLrcText, paused: context.audio.paused }),
    parseRaw: () => [], parseEnhancedLRC: () => [], parseLRC: text => text ? [{ time: 30, text }] : [],
    updLikeBtn() {}, updNowPlaying() {}, setCoverImage() {}, applyCoverBackground() {},
    isFmSongInLibrary: () => false, updateFmSaveButton() {}, saveCurrentProgress() {},
    setVideoMode() {}, setTimeout() { throw Error('Unexpected fallback timer'); },
    audio: { src: '', currentTime: 0, paused: true, gate: null,
      removeAttribute() { this.src = ''; }, load() {}, pause() { this.paused = true; },
      async play() { if (this.gate) await this.gate.promise; this.paused = false; } },
    window: { freeMusicAPI: {
      streamUrl: song => { const value = deferred(); streamRequests.set(song.id, value); return value.promise; },
      lyric: song => { const value = deferred(); lyricRequests.set(song.id, value); return value.promise; },
    } },
    fetch: url => { const value = deferred(); lyricRequests.set(url, value); return value.promise; },
  };
  vm.createContext(context);
  if (kind === 'fm') {
    const source = fs.readFileSync(path.join(root, 'renderer/modules/free-music/player.js'), 'utf8');
    vm.runInContext(source, context);
  } else {
    const source = fs.readFileSync(path.join(root, 'renderer/modules/playlist-share.js'), 'utf8');
    const section = source.slice(source.indexOf('var _plPreviewReqId = 0;'), source.indexOf('function updatePlDownloadCount()'));
    vm.runInContext(section, context);
  }
  return { context, lyricRequests, streamRequests, pushed, renders };
}
async function classicPreviewLyricsChecks() {
  const checks = [];
  for (const stage of ['url', 'buffering']) {
    const { context: c, lyricRequests, streamRequests, pushed } = fixture('fm');
    const a = fmSong('A'), b = fmSong('B'); c.fmPreviewSong = a; c.audio.src = 'https://fixture/A.wav';
    const old = c.loadFmLyricToMain(a);
    const gate = c.audio.gate = deferred();
    const next = c.playFmPreview(b);
    if (stage === 'buffering') { streamRequests.get('B').resolve({ ok: true, data: 'https://fixture/B.wav' }); await flush(); }
    lyricRequests.get('A').resolve({ ok: true, data: '[00:30]old A words' }); await old;
    assert.equal(c.fmPreviewLrcText, '', `old A is discarded during B ${stage}`);
    assert.equal(pushed.length, 0);
    if (stage === 'url') { streamRequests.get('B').resolve({ ok: true, data: 'https://fixture/B.wav' }); await flush(); }
    gate.resolve(); await next; c.audio.gate = null; c.audio.pause();
    lyricRequests.get('B').resolve({ ok: true, data: '[00:30]real B words' }); await flush();
    assert.equal(c.fmPreviewLrcText, '[00:30]real B words'); assert.equal(pushed.at(-1).force, true);
    assert.equal(pushed.at(-1).song, b); assert.equal(pushed.at(-1).paused, true);
  }
  checks.push('FM old lyrics are rejected before stream resolution and during audio buffering; paused current lyrics force real state sync');
  {
    const { context: c, lyricRequests, pushed } = fixture('fm'); const a = fmSong('A');
    c.fmPreviewSong = a; c.audio.src = 'https://fixture/A.wav'; c.audio.paused = false;
    const pending = c.loadFmLyricToMain(a); await c.playFmPreview(a);
    lyricRequests.get('A').resolve({ ok: true, data: '[00:30]same song after pause' }); await pending;
    assert.equal(c.audio.paused, true); assert.equal(pushed.at(-1).lyric, '[00:30]same song after pause');
    const stale = c.loadFmLyricToMain(a); c.fmPreviewSong = { source: 'playlist', id: 'B' }; c.audio.src = 'https://fixture/B.wav';
    c.lrc = [{ text: 'keep actual B' }]; lyricRequests.get('A').reject(Error('old error')); await stale;
    assert.equal(c.lrc[0].text, 'keep actual B', 'old errors cannot replace another source with fallback');
  }
  checks.push('same-song pause keeps its pending lyrics; cross-source errors cannot replace current content');
  {
    const { context: c, streamRequests } = fixture('fm');
    c.fmPreviewMode = false; c.fmPreviewSong = null; c.audio.src = 'music:///old.wav';
    const pending = c.playFmPreview(fmSong('A'));
    c._classicPlayRequest++; c.audio.src = 'music:///manual-B.wav';
    streamRequests.get('A').resolve({ ok: true, data: 'https://fixture/A.wav' }); await pending;
    assert.equal(c.audio.src, 'music:///manual-B.wav'); assert.equal(c.fmPreviewMode, false);
  }
  checks.push('local selection during pending remote stream resolution keeps its source');
  for (const kind of ['fm', 'pl']) for (const origin of ['local', 'together']) {
    const { context: c, lyricRequests, streamRequests, pushed } = fixture(kind);
    const source = fs.readFileSync(path.join(root, 'renderer/modules/player-core.js'), 'utf8');
    const localPlay = source.slice(source.indexOf('async function play('), source.indexOf('// Only this active renderer subscribes'));
    assert.ok(localPlay.includes('request !== _classicPlayRequest'), 'Use the actual local loader and its guard');
    Object.assign(c, { songs: [{ audioPath: '/local/old-pending.wav', rawPath: 'old-local-lyrics' }],
      curIdx: -1, currentView: 'home', playContext: 'home', playMode: 1,
      initWebAudio() {}, cancelFade() {}, fmPreviewMode: false, fmPreviewSong: null });
    c.window.musicAPI = { getLyrics: key => { const value = deferred(); lyricRequests.set(key, value); return value.promise; } };
    vm.runInContext(localPlay, c);
    if (origin === 'together') { c._togetherRequest = 8; c._togetherAcknowledged = 7; c._togetherGeneration = 2; }
    const previous = c.play(0, true, true, false, origin === 'together' ? { autoplay: true } : null);
    const before = c._classicPlayRequest;
    let selected;
    if (kind === 'fm') {
      selected = c.playFmPreview(fmSong('new'));
      streamRequests.get('new').resolve({ ok: true, data: 'https://fixture/new-preview.wav' });
    } else selected = c.playPlPreview(1);
    await selected;
    const actualSource = c.audio.src, actualPreview = c.fmPreviewSong;
    assert.ok(c._classicPlayRequest > before, 'New preview supersedes the pending actual local loader');
    if (origin === 'together') {
      assert.equal(c._togetherAcknowledged, 8, 'Local preview releases the pending remote command');
      assert.equal(c._togetherGeneration, 3);
    }
    lyricRequests.get('old-local-lyrics').resolve('old local lyrics'); await previous;
    assert.equal(c.audio.src, actualSource, `old ${origin} source cannot replace new ${kind} preview`);
    assert.equal(c.fmPreviewSong, actualPreview); assert.equal(c.fmPreviewMode, true);
    assert.equal(pushed.length, 0, 'The stale local loader never publishes its source');
  }
  checks.push('FM and playlist selections supersede actual pending local/together loaders and release pending remote ownership');
  {
    const { context: c, lyricRequests, pushed } = fixture('pl');
    const a = { source: 'playlist', id: c.plParsedSongs[0].audioUrl };
    c.fmPreviewSong = a; c.audio.src = a.id;
    const old = c.loadPlLyricToMain(c.plParsedSongs[0].lyricUrl);
    const gate = c.audio.gate = deferred(); const next = c.playPlPreview(1);
    lyricRequests.get(c.plParsedSongs[0].lyricUrl).resolve({ ok: true, text: async () => '[00:30]old playlist A' }); await old;
    assert.equal(c.fmPreviewLrcText, ''); assert.equal(pushed.length, 0);
    gate.resolve(); await next; c.audio.gate = null; c.audio.pause();
    lyricRequests.get(c.plParsedSongs[1].lyricUrl).resolve({ ok: true, text: async () => '[00:30]real playlist B' }); await flush();
    assert.equal(pushed.at(-1).lyric, '[00:30]real playlist B'); assert.equal(pushed.at(-1).paused, true);
    assert.equal(pushed.at(-1).force, true); assert.equal(pushed.at(-1).song.id, c.plParsedSongs[1].audioUrl);
  }
  checks.push('playlist delayed A cannot overwrite buffering B; paused B receives and broadcasts only its own lyrics');
  for (const outcome of ['resolve', 'reject']) {
    const { context: c, lyricRequests, pushed } = fixture('pl');
    c.fmPreviewSong = { source: 'playlist', id: 'A' }; c.audio.src = 'https://fixture/A.wav';
    const old = c.loadPlLyricToMain('https://fixture/A.lrc');
    c.fmPreviewMode = false; c.fmPreviewSong = null; c.audio.src = 'music:///local-B.wav'; c.lrc = [{ text: 'keep local B' }];
    if (outcome === 'resolve') lyricRequests.get('https://fixture/A.lrc').resolve({ ok: true, text: async () => 'late A' });
    else lyricRequests.get('https://fixture/A.lrc').reject(Error('late A error'));
    await old; assert.equal(c.lrc[0].text, 'keep local B'); assert.equal(pushed.length, 0);
  }
  checks.push('playlist late success and error after exit cannot write local content or send stale room state');
  {
    const { context: c, lyricRequests, pushed } = fixture('pl');
    c.fmPreviewSong = { source: 'playlist', id: 'A' }; c.audio.src = 'https://fixture/A.wav';
    c.loadPlLyricToMain(''); assert.equal(pushed.at(-1).force, true); assert.equal(pushed.at(-1).lyric, '');
    const current = c.loadPlLyricToMain('https://fixture/current.lrc');
    lyricRequests.get('https://fixture/current.lrc').reject(Error('current failed')); await current;
    assert.equal(pushed.at(-1).force, true); assert.equal(c.lrc[0].text, '纯音乐，请欣赏');
  }
  checks.push('current empty/error fallback syncs independently of the floating lyric window');
  return checks;
}
module.exports = { classicPreviewLyricsChecks };
if (require.main === module) classicPreviewLyricsChecks().then(checks => console.log(JSON.stringify({ ok: true, checks }, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });
