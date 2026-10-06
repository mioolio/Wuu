// Run after both production UI builds: node scripts/together-desktop.cjs
// Offline classic bridge check only: node scripts/together-desktop.cjs --classic-only
// Full mode uses actual Electron media, production Vue, server WS and IPC.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const vm = require('vm');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'together');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], media: [], rateMeasurements: [], streams: [], requests: [], screenshots: [], rendererErrors: [], rendererCrashes: [], transport: {} };
const normalize = value => String(value || '').replace(/\\/g, '/');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reportFile = path.join(artifacts, process.argv.includes('--classic-only') ? 'classic-report.json' : 'report.json');
const saveReport = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

// Observe the original native constructors/methods and media events. No context,
// audio node, media element, resume call, source or clock is supplied by the test.
function installClockObserver() {
  if (window.__togetherClockContexts) return;
  window.__togetherClockContexts = []; window.__togetherClockEvents = [];
  const events = window.__togetherClockEvents;
  const append = item => { events.push({ at: Date.now(), perf: performance.now(), ...item }); if (events.length > 2000) events.shift(); };
  const observeContext = (context, reason) => {
    let record = window.__togetherClockContexts.find(record => record.context === context);
    if (record) return record;
    record = { id: window.__togetherClockContexts.length + 1, context, reason, at: Date.now(), perf: performance.now() };
    window.__togetherClockContexts.push(record);
    append({ type: 'context-observed', id: record.id, reason, state: context.state, sampleRate: context.sampleRate, contextTime: context.currentTime });
    context.addEventListener('statechange', () => append({ type: 'context-statechange', id: record.id, state: context.state, contextTime: context.currentTime }));
    return record;
  };
  const NativeContext = window.AudioContext || window.webkitAudioContext;
  if (NativeContext) {
    for (const method of ['resume', 'createMediaElementSource']) {
      const original = NativeContext.prototype[method];
      if (typeof original !== 'function') continue;
      NativeContext.prototype[method] = function (...args) {
        observeContext(this, method);
        return Reflect.apply(original, this, args);
      };
    }
    const ObservedContext = new Proxy(NativeContext, { construct(Target, args, newTarget) {
      const context = Reflect.construct(Target, args, newTarget);
      observeContext(context, 'constructor'); return context;
    } });
    if (window.AudioContext === NativeContext) window.AudioContext = ObservedContext;
    if (window.webkitAudioContext === NativeContext) window.webkitAudioContext = ObservedContext;
  }
  const seenMedia = new WeakSet();
  window.__observeTogetherMedia = media => {
    if (!media || seenMedia.has(media)) return;
    seenMedia.add(media);
    for (const type of ['playing', 'waiting', 'stalled', 'seeking', 'seeked', 'ratechange', 'pause', 'emptied', 'loadedmetadata', 'canplay', 'timeupdate']) {
      media.addEventListener(type, () => append({ type: `media-${type}`, source: media.currentSrc || media.src,
        time: media.currentTime, rate: media.playbackRate, paused: media.paused, seeking: media.seeking,
        readyState: media.readyState, visibility: document.visibilityState }));
    }
  };
  const findMedia = () => document.querySelectorAll('audio, video').forEach(window.__observeTogetherMedia);
  new MutationObserver(findMedia).observe(document, { childList: true, subtree: true });
  findMedia();
}

async function classicBridgeCheck() {
  const source = fs.readFileSync(path.join(root, 'renderer', 'modules', 'player-core.js'), 'utf8');
  const prefix = source.slice(0, source.indexOf('// =========== Video'));
  const rateStart = source.indexOf('function applyPlaybackRate()');
  const rate = source.slice(rateStart, source.indexOf('// 音量', rateStart));
  const commandStart = source.indexOf('async function applyTogetherCommand');
  const bridge = source.slice(commandStart, source.indexOf('function onEnd()', commandStart));
  assert.ok(prefix.includes('function syncDesktopState') && rate.includes('audio.playbackRate') && bridge.includes('onTogetherCommand'), 'Read the actual classic bridge');
  const updates = [], seeks = [], plays = [];
  const songs = [0, 1].map(id => ({ id, audioPath: `D:\\fixture\\${id}.wav`, songName: `Classic ${id}` }));
  let listener, disposed = false, saves = 0;
  const context = vm.createContext({ console, Date, Number, Math, Promise, songs, curIdx: 0, playMode: 1,
    isPlaying: false, appSettings: { playbackRate: 1 },
    audio: { readyState: 2, currentTime: 7, duration: 90, paused: true, playbackRate: 1, defaultPlaybackRate: 1,
      pause() { this.paused = true; context.isPlaying = false; },
      play() { this.paused = false; context.isPlaying = true; return Promise.resolve(); } },
    getDuration: () => 90, cancelFade: () => {}, syncLrc: position => seeks.push(position),
    saveUserData: () => { saves++; }, pickNextIdx: direction => (context.curIdx + direction + songs.length) % songs.length,
    window: { stateAPI: { updateDesktopState: state => updates.push(state),
      onTogetherCommand: callback => { listener = callback; return () => { disposed = true; }; } },
      addEventListener: (name, callback) => { if (name === 'beforeunload') context.unload = callback; } } });
  vm.runInContext(prefix + rate + `
    async function play(index, a, b, countPlay, options = {}) {
      _classicPlayRequest++; curIdx = index; _togetherSeek = null;
      audio.currentTime = options.position || 0; plays.push({ index, countPlay, options });
      if (options.autoplay === false) audio.pause(); else await audio.play();
    }
  ` + bridge, Object.assign(context, { plays }));
  assert.equal(typeof listener, 'function', 'The real classic bridge installs its IPC subscription');
  const apply = (seq, op, payload, session = 'native-fixture') => context.applyTogetherCommand({ seq, op, payload, session });
  await apply(1, 'rate', { playbackRate: .5 });
  assert.equal(context.audio.playbackRate, .5); assert.equal(context.audio.defaultPlaybackRate, .5);
  assert.equal(context.audio.preservesPitch, true); assert.equal(updates.at(-1).togetherSeq, 1);
  await apply(1, 'seek', { position: 80 }); assert.equal(context.audio.currentTime, 7, 'Stale sequence cannot seek');
  await apply(2, 'pause', { position: 20 });
  assert.equal(context.audio.paused, true); assert.equal(context.audio.currentTime, 20); assert.equal(updates.at(-1).isPlaying, false);
  await apply(3, 'play', { position: 21 });
  assert.equal(context.audio.paused, false); assert.equal(updates.at(-1).isPlaying, true);
  await apply(4, 'song', { audioPath: songs[1].audioPath, position: 34, isPlaying: false, playbackRate: 2 });
  assert.equal(context.curIdx, 1); assert.equal(context.audio.currentTime, 34); assert.equal(context.audio.paused, true);
  assert.equal(context.audio.playbackRate, 2); assert.equal(updates.at(-1).songInfo.audioPath, songs[1].audioPath);
  assert.equal(updates.at(-1).togetherSeq, 4); assert.equal(plays.at(-1).countPlay, false);
  await apply(5, 'song', { audioPath: 'D:\\outside\\not-in-library.wav', position: 88 });
  assert.equal(plays.length, 1, 'Unknown client source cannot enter the classic loader');
  context.audio.readyState = 0; context.audio.currentTime = 0;
  await apply(6, 'seek', { position: 52 });
  assert.equal(updates.at(-1).currentTime, 52, 'Pending metadata reports the intended seek, not zero');
  assert.equal(seeks.at(-1), 52);
  await apply(1, 'rate', { playbackRate: 1.25 }, 'restarted-server');
  assert.equal(context.audio.playbackRate, 1.25, 'A new server session accepts a reset sequence');
  assert.equal(updates.at(-1).togetherSession, 'restarted-server');
  context.unload(); assert.equal(disposed, true); assert.ok(saves >= 3);
  return 'classic actual bridge (offline media boundary): session/sequence, source validation, paused song, metadata seek, rate persistence and teardown';
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function run() {
  report.phase = 'classic-offline-bridge';
  report.checks.push(await classicBridgeCheck());
  if (process.argv.includes('--classic-only')) { report.ok = true; return; }
  const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
  let app, desktop, phone;
  const phoneHistory = [];
  try {
    report.phase = 'native-desktop-startup';
    const port = await availablePort();
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'together-desktop-main.cjs')], cwd: root,
      env: { ...process.env, WUU_RENDERER_URL: process.env.WUU_TOGETHER_RENDERER || '', WUU_SMOKE_PACKAGED: '0',
        WUU_VISUAL_FIXTURE: '', WUU_PLAYER_POLISH_FIXTURE: '1', WUU_COVER_STARTUP: '', WUU_REVIEW_PROFILE: 'together-real', WUU_TOGETHER_PORT: String(port) }, timeout: 30000 });
    report.electronStderr = [];
    app.process().stderr?.on('data', data => { if (report.electronStderr.join('').length < 24000) report.electronStderr.push(String(data)); });
    await app.firstWindow();
    const nativeOutput = await app.evaluate(() => global.__wuuTogether.unmuteMain());
    assert.equal(nativeOutput.muted, false, 'The silent PCM fixture uses genuine native output rather than a muted host sink');
    report.nativeOutput = nativeOutput;
    await app.context().addInitScript(installClockObserver);
    await app.context().addInitScript(() => {
      if (location.protocol !== 'http:') return;
      window.__togetherSockets = []; window.__togetherTransport = [];
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, { construct(Target, args) {
        const socket = Reflect.construct(Target, args);
        window.__togetherSockets.push(socket);
        const record = (direction, data) => { let message; try { message = JSON.parse(data); } catch { return; }
          window.__togetherTransport.push({ at: Date.now(), direction, message }); };
        socket.addEventListener('message', event => record('receive', event.data));
        const originalSend = socket.send;
        socket.send = function (...values) { record('send', values[0]); return Reflect.apply(originalSend, this, values); };
        return socket;
      } });
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      desktop = app.windows().find(page => page.url().includes('index.html') && !page.url().startsWith('http:') && !page.url().includes('window=lyrics'));
      if (desktop) break; await delay(50);
    }
    assert.ok(desktop, 'The production desktop renderer opens');
    desktop.setDefaultTimeout(15000);
    desktop.on('pageerror', error => report.rendererErrors.push({ page: 'desktop', message: error.message }));
    report.desktopBundle = await desktop.locator('script[type="module"]').getAttribute('src');
    const tracks = await app.evaluate(() => global.__wuuSmoke.songs.map(song => ({ name: song.songName, path: song.audioPath, id: song.id })));
    tracks.forEach(track => { track.rawPath = track.path; track.path = normalize(track.path); }); assert.equal(tracks.length, 3);
    assert.ok(tracks.every(track => track.path.includes('/.test-artifacts/') && !track.path.includes('/.output/')), 'All genuine library audio lives outside .output');
    const nav = desktop.getByRole('navigation', { name: '主导航' }); await nav.waitFor();
    const desktopButton = name => desktop.locator('.player-bar').getByRole('button', { name, exact: true });
    await desktopButton('暂停').waitFor();
    await desktop.evaluate(installClockObserver);
    // Production audio lives in a detached video; observe its actual play call.
    await desktop.evaluate(() => {
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        if (this.id === 'react-media-player') { window.__togetherMedia = this; window.__observeTogetherMedia?.(this); }
        return Reflect.apply(original, this, args);
      };
    });
    await desktopButton('暂停').click(); await desktopButton('播放').click();
    await desktop.waitForFunction(() => window.__togetherMedia?.readyState >= 3 && !window.__togetherMedia.paused);
    await desktopButton('暂停').click();
    const rangeValue = async (locator, value) => locator.evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    const desktopSeek = value => rangeValue(desktop.locator('.player-bar').getByRole('slider', { name: '播放进度', exact: true }), value);
    const desktopRate = async value => {
      await nav.getByRole('button', { name: '设置', exact: true }).click();
      await desktop.getByRole('tab', { name: '播放', exact: true }).click();
      await desktop.getByRole('combobox', { name: '播放倍速', exact: true }).selectOption(String(value));
    };
    const sample = page => page.evaluate(() => {
      const media = window.__togetherMedia || document.querySelector('audio');
      if (!media) return null;
      const source = media.currentSrc || media.src; let file = '';
      try { const url = new URL(source); file = url.searchParams.get('path') ||
        (media === window.__togetherMedia && /^https?:$/.test(url.protocol) ? url.href : decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:)/i, '')); } catch {}
      const contexts = (window.__togetherClockContexts || []).map(({ id, context, reason, at, perf }) => {
        let outputTimestamp = null;
        try { outputTimestamp = context.getOutputTimestamp?.() || null; } catch {}
        return { id, reason, observedAt: at, observedPerf: perf, state: context.state, sampleRate: context.sampleRate,
          time: context.currentTime, baseLatency: context.baseLatency, outputLatency: context.outputLatency, outputTimestamp };
      });
      const buffered = Array.from({ length: media.buffered.length }, (_, index) => [media.buffered.start(index), media.buffered.end(index)]);
      return { at: Date.now(), perf: performance.now(), visibility: document.visibilityState, path: file.replace(/\\/g, '/'), source, paused: media.paused,
        time: media.currentTime, duration: Number.isFinite(media.duration) ? media.duration : null,
        rate: media.playbackRate, defaultRate: media.defaultPlaybackRate, preservesPitch: media.preservesPitch,
        readyState: media.readyState, seeking: media.seeking, buffered, contexts };
    });
    const waitMedia = async (page, expected = {}) => {
      let value;
      for (let attempt = 0; attempt < 200; attempt++) {
        value = await sample(page);
        const pathMatches = !expected.path || value?.path === expected.path || /\/api\/stream\/\d+$/.test(value?.path || '') && Number(value.path.split('/').at(-1)) === tracks.find(track => track.path === expected.path)?.id;
        if (value && value.readyState >= 2 && pathMatches &&
          (expected.paused == null || value.paused === expected.paused) &&
          (expected.rate == null || value.rate === expected.rate) &&
          (expected.time == null || Math.abs(value.time - expected.time) < (expected.tolerance || .3))) return value;
        await delay(65);
      }
      assert.fail(`Actual media failed to reach ${JSON.stringify(expected)}; last ${JSON.stringify(value)}`);
    };
    const mark = async label => report.media.push({ label, desktop: await sample(desktop), phone: phone ? await sample(phone) : null });
    const aligned = async (label, expected = {}, tolerance = .7) => {
      report.phase = label;
      await waitMedia(desktop, expected); await waitMedia(phone, expected);
      let a, b;
      for (let attempt = 0; attempt < 100; attempt++) {
        a = await sample(desktop); b = await sample(phone);
        if (Math.abs(a.time - b.time) < tolerance && a.paused === b.paused && a.rate === b.rate) break;
        await delay(60);
      }
      assert.equal(a.paused, b.paused, `${label}: pause state aligns`); assert.equal(a.rate, b.rate, `${label}: actual rate aligns`);
      assert.ok(Math.abs(a.time - b.time) < tolerance, `${label}: actual audio clocks align (${a.time}, ${b.time})`);
      assert.equal(b.defaultRate, b.rate); assert.equal(b.preservesPitch, true);
      await mark(label);
    };
    const commandCount = () => app.evaluate(() => global.__wuuTogether.log.commands.length);
    const readStream = async audioPath => {
      const result = await phone.evaluate(async audioPath => {
        const response = await fetch('/api/stream-by-path?path=' + encodeURIComponent(audioPath), { headers: { Range: 'bytes=0-127' } });
        const bytes = [...new Uint8Array(await response.arrayBuffer())];
        return { status: response.status, contentRange: response.headers.get('content-range'), contentType: response.headers.get('content-type'),
          length: bytes.length, signature: String.fromCharCode(...bytes.slice(0, 4)), bytes };
      }, audioPath);
      report.streams.push({ audioPath, ...result }); return result;
    };
    const phoneTab = name => phone.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
    const phoneButton = name => phone.locator('.player-view .controls').getByRole('button', { name, exact: true });
    const phoneRate = async value => { await phoneTab('设置'); await phone.locator('#mobile-playback-rate').selectOption(String(value)); };
    const phoneSeek = async value => { await phoneTab('播放'); await rangeValue(phone.locator('.player-view .progress-range'), value / 90 * 100); };
    const phoneSong = async index => {
      await phoneTab('音乐库');
      await phone.locator('.song-list-view .song-item').filter({ has: phone.getByText(tracks[index].name, { exact: true }) }).click();
      await phoneTab('播放');
    };
    const membership = async enabled => {
      await phoneTab('设置');
      const control = phone.getByRole('switch', { name: '与电脑一起听', exact: true });
      if (enabled) await control.check(); else await control.uncheck();
      assert.equal(await control.isChecked(), enabled);
    };

    await desktopSeek(20); await desktopRate(.5);
    await waitMedia(desktop, { path: tracks[0].path, paused: true, time: 20, rate: .5 });
    report.phase = 'production-mobile-startup-and-path-validation';
    await app.evaluate(() => global.__wuuTogether.openMobile());
    phone = app.windows().find(page => page.url().startsWith(`http://127.0.0.1:${port}/`));
    assert.ok(phone, 'The production mobile renderer is served by the genuine HTTP server');
    phone.setDefaultTimeout(15000); phone.on('pageerror', error => report.rendererErrors.push({ page: 'phone', message: error.message }));
    phone.on('request', request => {
      if (/\/api\//.test(request.url())) report.requests.push({ at: Date.now(), url: request.url(), method: request.method(), body: request.postData() });
    });
    await phone.locator('.bottom-nav').waitFor();
    assert.equal(await phone.locator('audio').count(), 1, 'The mobile UI owns one actual audio element');
    const syncMode = await phone.evaluate(async () => (await fetch('/api/sync-mode')).json());
    assert.equal(syncMode.mode, 'merged', 'Default-off independence is checked with merged storage mode');
    const localRange = await readStream(tracks[0].rawPath);
    assert.equal(localRange.status, 206); assert.equal(localRange.signature, 'RIFF'); assert.equal(localRange.length, 128);
    assert.equal(localRange.contentType, 'audio/wav'); assert.match(localRange.contentRange, /^bytes 0-127\/\d+$/);
    const unlistedPath = await app.evaluate(() => global.__wuuTogether.unknownPath);
    assert.equal((await readStream(unlistedPath)).status, 403, 'An existing WAV outside the exact library cannot be read');
    report.checks.push('production path streaming serves genuine .test-artifacts library audio outside .output with Range; an existing unlisted audio file returns 403');
    report.mobileBundle = await phone.locator('script[type="module"]').getAttribute('src');
    await phoneTab('设置'); assert.equal(await phone.getByRole('switch', { name: '与电脑一起听', exact: true }).isChecked(), false);
    report.phase = 'default-off-independent';
    const initialCommands = await commandCount();
    await phoneSong(1); await waitMedia(phone, { path: tracks[1].path, paused: false });
    await phoneButton('暂停').click(); await phoneSeek(47); await phoneRate(2);
    await waitMedia(phone, { path: tracks[1].path, paused: true, time: 47, rate: 2 });
    await waitMedia(desktop, { path: tracks[0].path, paused: true, time: 20, rate: .5 });
    assert.equal(await commandCount(), initialCommands);
    assert.equal(await phone.evaluate(() => window.__togetherTransport.filter(entry => entry.message.type === 'welcome').length), 0);
    await mark('default-off-independent'); report.checks.push('default-off mobile song/pause/seek/rate remain independent even with merged storage synchronization');

    await membership(true); await aligned('join-paused-desktop', { path: tracks[0].path, paused: true, time: 20, rate: .5 });
    const joinedSource = new URL((await sample(phone)).source);
    assert.equal(joinedSource.pathname, '/api/stream-by-path'); assert.equal(joinedSource.searchParams.get('path'), tracks[0].rawPath);
    await phone.getByText('已连接电脑', { exact: true }).waitFor();
    await phoneTab('播放'); await phoneButton('播放').click(); await aligned('phone-play', { path: tracks[0].path, paused: false, rate: .5 });
    await phoneButton('暂停').click(); await aligned('phone-pause', { path: tracks[0].path, paused: true, rate: .5 });
    const progress = phone.locator('.player-view .progress-range');
    await progress.focus(); await progress.press('Home'); await progress.press('ArrowRight');
    await aligned('phone-keyboard-seek', { path: tracks[0].path, paused: true, time: .09, rate: .5 }, .2);
    await phoneSeek(31); await aligned('phone-seek', { path: tracks[0].path, paused: true, time: 30.96, rate: .5 }, .2);
    await phoneSong(2); await aligned('phone-song', { path: tracks[2].path, paused: false, rate: .5 });
    const measureNativeRate = async rate => {
      report.phase = `native-${rate}x-clock-measurement`;
      const measurement = { rate, stability: [], timeline: [], before: null, after: null, windows: {}, events: {} };
      report.rateMeasurements.push(measurement);
      let previousClocks = null, consecutiveMoving = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const clocks = { desktop: await sample(desktop), phone: await sample(phone) };
        measurement.stability.push(clocks);
        const advancing = previousClocks && ['desktop', 'phone'].every(name => {
          const current = clocks[name], previous = previousClocks[name];
          return !current.paused && !current.seeking && current.readyState >= 3 && current.rate === rate &&
            current.time - previous.time > .03;
        });
        consecutiveMoving = advancing ? consecutiveMoving + 1 : 0;
        previousClocks = clocks;
        if (consecutiveMoving >= 3) break;
        await delay(80);
      }
      measurement.stabilitySatisfied = consecutiveMoving >= 3;
      measurement.before = { desktop: await sample(desktop), phone: await sample(phone) };
      measurement.timeline.push(measurement.before);
      const started = performance.now();
      while (performance.now() - started < 3000) {
        await delay(80);
        measurement.timeline.push({ desktop: await sample(desktop), phone: await sample(phone) });
      }
      measurement.after = measurement.timeline.at(-1);
      for (const [name, page] of [['desktop', desktop], ['phone', phone]]) {
        const before = measurement.before[name], after = measurement.after[name];
        const elapsed = (after.at - before.at) / 1000, perfElapsed = (after.perf - before.perf) / 1000, delta = after.time - before.time;
        const contextWindows = before.contexts.map(context => {
          const latest = after.contexts.find(item => item.id === context.id);
          const contextDelta = latest ? latest.time - context.time : null;
          return { id: context.id, contextDelta, perWall: contextDelta / elapsed, perPerf: contextDelta / perfElapsed,
            mediaPerContext: contextDelta > 0 ? delta / contextDelta : null };
        });
        measurement.windows[name] = { elapsed, perfElapsed, delta, ratio: delta / elapsed, perfRatio: delta / perfElapsed, contextWindows };
        measurement.events[name] = await page.evaluate(at => (window.__togetherClockEvents || []).filter(event => event.at >= at), measurement.stability[0][name].at);
      }
      saveReport(); return measurement;
    };
    await phoneRate(1); await aligned('phone-rate-one-baseline', { path: tracks[2].path, paused: false, rate: 1 });
    await measureNativeRate(1);
    await phoneRate(2); await aligned('phone-rate-two', { path: tracks[2].path, paused: false, rate: 2 });
    const rateMeasurement = await measureNativeRate(2);
    assert.ok(rateMeasurement.stabilitySatisfied, 'Both actual native clocks begin steadily advancing without a pending seek');
    for (const name of ['desktop', 'phone']) {
      const { elapsed, delta, ratio } = rateMeasurement.windows[name];
      assert.ok(delta > elapsed * 1.6 && delta < elapsed * 2.4,
        `${name} native media advances at 2x rather than merely displaying a rate label (delta=${delta}, elapsed=${elapsed}, ratio=${ratio})`);
    }
    await app.evaluate(() => global.__wuuSmoke.data.settings.playbackRate).then(rate => assert.equal(rate, 2, 'Phone rate change persists desktop settings'));
    report.checks.push('phone membership, real play/pause, keyboard and slider seek, source change and 2x rate traverse WS→IPC→actual desktop audio with ACK');

    await desktopButton('暂停').click(); await aligned('desktop-pause', { path: tracks[2].path, paused: true, rate: 2 });
    await desktopRate(.5); await aligned('desktop-rate-half', { path: tracks[2].path, paused: true, rate: .5 });
    await desktopSeek(48); await aligned('desktop-seek', { path: tracks[2].path, paused: true, time: 48, rate: .5 }, .2);
    await desktopButton('下一首').click(); await aligned('desktop-song', { path: tracks[0].path, paused: false, rate: .5 });
    report.checks.push('desktop pause/rate/seek/next reach production mobile audio through genuine host state broadcasts');

    await membership(false); await delay(150);
    const detachedCommands = await commandCount(); const detachedDesktop = await sample(desktop);
    await phoneTab('播放'); await phoneButton('暂停').click(); await phoneSeek(11); await phoneRate(1);
    await phoneSong(1); await waitMedia(phone, { path: tracks[1].path, paused: false, rate: 1 });
    const independent = await waitMedia(desktop, { path: tracks[0].path, paused: false, rate: .5 });
    assert.ok(independent.time >= detachedDesktop.time); assert.equal(await commandCount(), detachedCommands);
    await mark('disabled-independent'); report.checks.push('leaving does not pause the desktop, and subsequent mobile controls do not send room commands');
    await membership(true); await aligned('rejoin-latest-desktop', { path: tracks[0].path, paused: false, rate: .5 });
    const welcomeCount = await phone.evaluate(() => window.__togetherTransport.filter(entry => entry.message.type === 'welcome').length);
    await phone.evaluate(() => window.__togetherSockets.filter(socket => socket.readyState === 1).forEach(socket => socket.close(1000, 'QA reconnect')));
    await phone.waitForFunction(count => window.__togetherTransport.filter(entry => entry.message.type === 'welcome').length > count, welcomeCount);
    await aligned('socket-reconnect-desktop', { path: tracks[0].path, paused: false, rate: .5 });
    phoneHistory.push(...await phone.evaluate(() => window.__togetherTransport));
    await phone.reload(); await phone.locator('.bottom-nav').waitFor();
    await aligned('reload-rejoin-desktop', { path: tracks[0].path, paused: false, rate: .5 });
    await phoneTab('设置'); assert.equal(await phone.getByRole('switch', { name: '与电脑一起听', exact: true }).isChecked(), true);
    report.checks.push('switch rejoin, genuine WebSocket reconnect and page reload all recover the latest desktop clock with saved membership');

    await membership(false);
    await phoneTab('播放'); await phoneButton('暂停').click();
    await waitMedia(phone, { paused: true });
    await desktopButton('暂停').click(); await desktopSeek(45); await desktopRate(2); await desktopButton('播放').click();
    await waitMedia(desktop, { path: tracks[0].path, paused: false, rate: 2 });
    await phone.evaluate(() => {
      const original = HTMLMediaElement.prototype.play;
      window.__togetherRestorePlay = () => { HTMLMediaElement.prototype.play = original; };
      let denied = false;
      HTMLMediaElement.prototype.play = function (...args) {
        if (!denied && this === document.querySelector('audio')) {
          denied = true; window.__togetherAutoplayDenied = true;
          return Promise.reject(new DOMException('QA browser autoplay denial', 'NotAllowedError'));
        }
        return Reflect.apply(original, this, args);
      };
    });
    await membership(true);
    await phone.locator('.sync-notice .join-button').waitFor();
    assert.equal(await phone.evaluate(() => window.__togetherAutoplayDenied), true);
    assert.equal((await sample(phone)).paused, true);
    assert.equal((await sample(desktop)).paused, false);
    await phoneTab('播放');
    await phone.evaluate(() => window.__togetherRestorePlay());
    await phone.locator('.join-notice').getByRole('button', { name: '加入播放', exact: true }).click();
    await aligned('autoplay-click-resume', { path: tracks[0].path, paused: false, rate: 2 });
    await phone.locator('.join-notice').waitFor({ state: 'hidden' });
    report.checks.push('one explicitly injected NotAllowedError exposes the join UI without pausing desktop; a real click resumes actual mobile audio at the latest 2x desktop clock');

    await phoneButton('暂停').click(); await aligned('before-preview-paused', { path: tracks[0].path, paused: true, rate: 2 });
    await delay(650); // Let the real debounced save of the preceding library song settle.
    const previousLibraryPosition = (await sample(desktop)).time;
    const previewBaseline = await app.evaluate(() => ({ count: global.__wuuSmoke.songs.length, saves: global.__wuuSmoke.discovery.saveRequests.length,
      stats: JSON.stringify(global.__wuuSmoke.data.stats), progress: JSON.stringify(global.__wuuSmoke.data.progress),
      likes: JSON.stringify(global.__wuuSmoke.data.likes), dislikes: JSON.stringify(global.__wuuSmoke.data.dislikes), collections: JSON.stringify(global.__wuuSmoke.data.collections) }));
    const previewStartedAt = Date.now();
    const startPreview = async index => {
      await nav.getByRole('button', { name: '推荐', exact: true }).click();
      const cards = desktop.locator('.home-discovery .home-album-card'); await cards.nth(index).waitFor();
      await desktop.waitForFunction(() => document.querySelector('.home-discovery')?.getAttribute('aria-busy') === 'false');
      const title = await cards.nth(index).locator(':scope > strong').textContent();
      await cards.nth(index).click();
      await desktop.waitForFunction(title => document.querySelector('.player-page .record-info h1')?.textContent === title, title);
      await desktop.waitForFunction(() => window.__togetherMedia?.readyState >= 3 && !window.__togetherMedia.paused && /^http:/.test(window.__togetherMedia.currentSrc));
      const media = await sample(desktop); assert.ok(media.path.includes('/preview/'), 'Desktop actually plays the isolated upstream HTTP media');
      await aligned(`preview-${index}-join`, { path: media.path, paused: false, rate: 2 });
      const source = new URL((await sample(phone)).source);
      assert.equal(source.pathname, '/api/stream-by-path'); assert.equal(source.searchParams.get('path'), media.path, 'Mobile audio plays the production proxy, never the arbitrary remote URL directly');
      return media.path;
    };
    const firstPreview = await startPreview(0);
    await delay(600);
    const switchedProgress = await app.evaluate(() => JSON.stringify(global.__wuuSmoke.data.progress));
    const beforeProgress = JSON.parse(previewBaseline.progress), afterSwitchProgress = JSON.parse(switchedProgress);
    const withoutPrevious = values => Object.fromEntries(Object.entries(values).filter(([key]) => key !== tracks[0].rawPath));
    assert.deepEqual(withoutPrevious(afterSwitchProgress), withoutPrevious(beforeProgress), 'Entering preview can save only the genuinely preceding library song');
    assert.ok(Math.abs(afterSwitchProgress[tracks[0].rawPath] - previousLibraryPosition) < .1, 'The final library position is saved before preview begins');
    previewBaseline.progress = switchedProgress;
    const previewLike = phone.locator('.player-view .like-btn');
    assert.equal(await previewLike.isDisabled(), true);
    assert.equal(await previewLike.getAttribute('aria-label'), '先在电脑保存到音乐库');
    assert.equal(await previewLike.getAttribute('title'), '先在电脑保存到音乐库');
    await previewLike.dispatchEvent('click');
    assert.equal(await phone.locator('.picker-mask').count(), 0, 'Preview cannot open a collection for a virtual library index');
    await phone.locator('.player-view .secondary-controls').getByRole('button', { name: /^更多播放设置/ }).click();
    const previewDislike = phone.locator('.more-sheet .sheet-row');
    assert.equal(await previewDislike.isDisabled(), true);
    assert.equal(await previewDislike.getAttribute('aria-label'), '先在电脑保存到音乐库');
    await previewDislike.dispatchEvent('click');
    await phone.getByRole('button', { name: '关闭播放设置', exact: true }).click();
    const proxyRange = await readStream(firstPreview);
    assert.equal(proxyRange.status, 206); assert.equal(proxyRange.contentType, 'audio/wav'); assert.equal(proxyRange.length, 128);
    assert.deepEqual(proxyRange.bytes, localRange.bytes, 'The production proxy returns the actual upstream WAV bytes');
    assert.match(proxyRange.contentRange, /^bytes 0-127\/\d+$/);
    await phoneButton('暂停').click(); await aligned('preview-phone-pause', { path: firstPreview, paused: true, rate: 2 });
    await phoneSeek(5); await aligned('preview-phone-seek', { path: firstPreview, paused: true, time: 4.95, rate: 2 }, .2);
    await phoneRate(.5); await aligned('preview-phone-rate', { path: firstPreview, paused: true, time: 4.95, rate: .5 }, .2);
    await phoneTab('播放'); await phone.locator('.view-switch').getByRole('button', { name: '歌词', exact: true }).click();
    const expectedLines = await app.evaluate(() => global.__wuuTogether.previewLines);
    await phone.locator('.lyrics-view .lyric-line.cur').filter({ hasText: expectedLines[1] }).waitFor();
    assert.deepEqual(await phone.locator('.lyrics-view .lyric-text').allTextContents(), expectedLines, 'Phone uses actual preview lyric metadata without a fabricated library index');
    await phone.locator('.view-switch').getByRole('button', { name: '封面', exact: true }).click();
    await phoneButton('播放').click(); await aligned('preview-phone-play', { path: firstPreview, paused: false, rate: .5 });
    await desktopButton('暂停').click(); await aligned('preview-desktop-pause', { path: firstPreview, paused: true, rate: .5 });
    await desktopSeek(12); await aligned('preview-desktop-seek', { path: firstPreview, paused: true, time: 12, rate: .5 }, .2);
    await desktopRate(2); await aligned('preview-desktop-rate', { path: firstPreview, paused: true, time: 12, rate: 2 }, .2);
    report.checks.push('actual desktop HTTP preview is played through the production mobile Range proxy; pause/play/seek/rate remain bidirectional and actual preview lyrics appear');

    const secondPreview = await startPreview(1); assert.notEqual(secondPreview, firstPreview);
    assert.equal((await readStream(firstPreview)).status, 403, 'A previous desktop preview URL loses authorization immediately after switching');
    const arbitraryPreview = await app.evaluate(() => `${global.__wuuTogether.previewOrigin}/preview/arbitrary-unselected.wav`);
    assert.equal((await readStream(arbitraryPreview)).status, 403, 'A real but unselected upstream URL cannot become a client proxy target');
    const commandsBeforeInvalid = await commandCount();
    await phone.evaluate(audioPath => {
      const socket = window.__togetherSockets.findLast(socket => socket.readyState === 1);
      socket.send(JSON.stringify({ type: 'op', op: 'song', payload: { song: { id: `preview:${audioPath}`, audioPath, preview: true }, position: 0, isPlaying: true } }));
    }, arbitraryPreview);
    await delay(200); assert.equal(await commandCount(), commandsBeforeInvalid, 'A phone cannot choose its own arbitrary preview URL via the real WS channel');
    await aligned('invalid-preview-stays-current', { path: secondPreview, paused: false, rate: 2 });
    await phoneButton('暂停').click(); await aligned('preview-final-paused', { path: secondPreview, paused: true, rate: 2 });
    await delay(300);
    const previewAfter = await app.evaluate(() => ({ count: global.__wuuSmoke.songs.length, saves: global.__wuuSmoke.discovery.saveRequests.length,
      stats: JSON.stringify(global.__wuuSmoke.data.stats), progress: JSON.stringify(global.__wuuSmoke.data.progress),
      likes: JSON.stringify(global.__wuuSmoke.data.likes), dislikes: JSON.stringify(global.__wuuSmoke.data.dislikes), collections: JSON.stringify(global.__wuuSmoke.data.collections) }));
    assert.deepEqual(previewAfter, previewBaseline, 'Listening to previews does not import songs or write local-song statistics/progress');
    assert.equal(report.requests.filter(entry => entry.at >= previewStartedAt && /\/api\/(?:lyric|progress|play-count)/.test(entry.url)).length, 0,
      'Preview never fetches fake-index lyrics/progress or reports fake-index listening statistics');
    assert.equal(report.requests.filter(entry => entry.at >= previewStartedAt && entry.method === 'POST' && /\/api\/(?:like|dislike|collections)/.test(entry.url)).length, 0,
      'Preview controls cannot write local likes, dislikes or collections');
    report.checks.push('replaced and arbitrary preview URLs are denied by HTTP and real WS validation; previews never import or alter library statistics/progress');

    report.transport.phone = [...phoneHistory, ...await phone.evaluate(() => window.__togetherTransport)];
    report.transport.main = await app.evaluate(() => global.__wuuTogether.log);
    const mainLog = report.transport.main;
    const mainWc = mainLog.mainIds[0]?.webContentsId;
    assert.ok(mainWc && mainLog.ipc.some(entry => entry.channel === 'desktop-together-ready' && entry.senderId === mainWc && entry.result?.ok), 'The real main WebContents owns the bridge');
    const commands = mainLog.commands.map(entry => entry.command).filter(command => command.op !== 'cancel');
    for (const op of ['play', 'pause', 'seek', 'song', 'rate']) assert.ok(commands.some(command => command.op === op), `Real ${op} IPC exists`);
    for (const command of commands) assert.ok(mainLog.ipc.some(entry => entry.channel === 'desktop-state-update' && entry.senderId === mainWc &&
      entry.payload?.togetherSession === command.session && entry.payload?.togetherSeq >= command.seq), `Actual renderer ACK exists for ${command.op} #${command.seq}`);
    const welcome = report.transport.phone.find(entry => entry.message.type === 'welcome')?.message;
    assert.equal(welcome.hostId, 0); assert.equal(welcome.desktopConnected, true); assert.ok(welcome.hostSong.song.audioPath);
    assert.ok(report.transport.phone.some(entry => entry.message.op === 'state' && entry.message.from === 0));
    const httpState = await phone.evaluate(async () => (await fetch('/api/state')).json()); report.httpState = httpState;
    const state = httpState.state || httpState; assert.equal(state.audioPath, secondPreview); assert.equal(state.playbackRate, 2);
    assert.equal(state.index, -1); assert.equal(state.songInfo.preview, true); assert.equal(state.songInfo.lyric, await app.evaluate(() => global.__wuuTogether.previewLyric));
    assert.equal(report.rendererErrors.length, 0, 'No production renderer errors'); assert.equal(mainLog.crashes.length, 0, 'No native renderer crashes');
    for (const [page, name] of [[desktop, 'desktop'], [phone, 'phone']]) {
      const file = path.join(artifacts, `${name}.png`); await page.screenshot({ path: file, scale: 'css' }); report.screenshots.push(file);
    }
    report.checks.push('real server welcome/state, sender authentication and completion ACKs match actual audio; no fake WS or extra media element');
    report.phase = 'complete';
    report.ok = true;
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    console.error('[together] Native regression failed:', error);
    saveReport();
    if (app) {
      try { report.transport.main = await app.evaluate(() => global.__wuuTogether.log); report.rendererCrashes = report.transport.main.crashes; } catch {}
    }
    report.failureMedia = {};
    for (const [page, name] of [[desktop, 'desktop'], [phone, 'phone']]) if (page && !page.isClosed()) {
      try { report.failureMedia[name] = await page.evaluate(() => {
        const media = window.__togetherMedia || document.querySelector('audio');
        return { url: location.href, title: document.querySelector('.player-page .record-info h1, .player-view .song-name')?.textContent,
          media: media ? { source: media.currentSrc || media.src, time: media.currentTime, duration: media.duration,
            paused: media.paused, rate: media.playbackRate, readyState: media.readyState, error: media.error?.message } : null,
          transport: window.__togetherTransport, body: document.body.innerText.slice(0, 6000) };
      }); } catch {}
    }
    saveReport();
    for (const [page, name] of [[desktop, 'desktop-failure'], [phone, 'phone-failure']]) if (page && !page.isClosed()) {
      try { const file = path.join(artifacts, `${name}.png`); await page.screenshot({ path: file, timeout: 3000 }); report.screenshots.push(file); } catch {}
    }
    throw error;
  } finally {
    if (app) {
      try { report.transport.main = await app.evaluate(() => global.__wuuTogether.log); report.rendererCrashes = report.transport.main.crashes; } catch {}
      if (phone && !phone.isClosed()) try { report.transport.phone = [...phoneHistory, ...await phone.evaluate(() => window.__togetherTransport)]; } catch {}
      report.nativeClockEvents = {};
      for (const [page, name] of [[desktop, 'desktop'], [phone, 'phone']]) if (page && !page.isClosed()) {
        try { report.nativeClockEvents[name] = await page.evaluate(() => window.__togetherClockEvents || []); } catch {}
      }
      // Keep diagnostics available even when Electron's normal quit is held by
      // its windows/server. Exit only this isolated child launched by this script.
      saveReport();
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
  }
}
run().catch(error => { report.error ||= { message: error.message, stack: error.stack }; console.error(error); process.exitCode = 1; }).finally(() => {
  saveReport();
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, error: report.error?.message }, null, 2));
});
