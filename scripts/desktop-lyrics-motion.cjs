// First-visible-frame and lyric handoff regression against the production bundle.
// Run after the desktop build: node scripts/desktop-lyrics-motion.cjs
// Fixture gates delay real PNG decoding; no product source, color or media is mocked.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'desktop-lyrics-motion');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], firstFrames: [], transitions: [], rates: [], screenshots: [], errors: [] };
const rgb = value => {
  if (/^#[\da-f]{6}$/i.test(value || '')) return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16));
  const match = /rgba?\(([^)]+)\)/.exec(value || '');
  return match ? match[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
};
async function waitUntil(check, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}
const visible = frame => frame.layers.filter(layer => layer.visible);
const live = frame => visible(frame).find(layer => !layer.outgoing);
function assertInk(frame, expected, message) {
  const actual = live(frame);
  assert.ok(actual, `${message}: a current lyric is visibly painted`);
  assert.deepEqual(rgb(actual.color), rgb(expected), `${message}: current CSS ink matches the resolved color`);
  assert.deepEqual(rgb(actual.gradient), rgb(expected), `${message}: the painted word gradient agrees`);
}

(async () => {
  let app, page, desktop;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'desktop-lyrics-motion-main.cjs')], cwd: root,
      env: { ...process.env, WUU_LYRICS_MOTION_RENDERER: process.env.WUU_LYRICS_MOTION_RENDERER || '' }, timeout: 30000 });
    report.stderr = [];
    app.process().stderr?.on('data', data => { if (report.stderr.join('').length < 16000) report.stderr.push(String(data)); });
    await app.firstWindow();
    await waitUntil(() => {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics'));
      return !!page;
    }, 'The real main renderer opens');
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.errors.push(error.message));
    report.bundle = await page.locator('script[type="module"]').getAttribute('src');
    const fixture = await app.evaluate(() => ({ songs: global.__wuuSmoke.songs, lines: global.__wuuSmoke.polish.lines, colors: global.__wuuSmoke.polish.expectedColors }));
    const textAt = (song, time) => `${fixture.songs[song].songName} · ${fixture.lines.filter(([start]) => start <= time).at(-1)[1]}`;
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.waitFor();
    // Audio uses a detached production video. Observe its next real play call
    // without creating another media element or changing the returned promise.
    await page.evaluate(() => {
      const original = HTMLMediaElement.prototype.play, seen = new WeakSet();
      window.__motionMediaEvents = []; window.__motionPlayCalls = 0;
      HTMLMediaElement.prototype.play = function(...args) {
        window.__motionMedia = this; window.__motionPlayCalls++;
        window.__motionFirstMedia ||= this;
        if (!seen.has(this)) {
          seen.add(this);
          for (const type of ['pause', 'playing', 'emptied', 'loadstart', 'ratechange']) this.addEventListener(type, () => {
            window.__motionMediaEvents.push({ type, at: performance.now(), time: this.currentTime, rate: this.playbackRate });
          });
        }
        return Reflect.apply(original, this, args);
      };
    });
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await page.locator('.record-info h1').waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    const setInput = (locator, value) => locator.evaluate((input, next) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    const seek = async time => {
      await setInput(page.getByRole('slider', { name: '播放进度', exact: true }), time);
      await page.waitForFunction(time => Math.abs(Number(document.querySelector('[aria-label="播放进度"]').value) - time) < .15, time);
    };
    const pause = async () => {
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await page.getByRole('button', { name: '播放', exact: true }).waitFor();
    };
    const mediaSnapshot = () => page.evaluate(() => {
      const media = window.__motionMedia;
      return { at: performance.now(), time: media?.currentTime, src: media?.currentSrc, paused: media?.paused,
        rate: media?.playbackRate, defaultRate: media?.defaultPlaybackRate, preservesPitch: media?.preservesPitch,
        sameElement: media === window.__motionFirstMedia, playCalls: window.__motionPlayCalls, events: window.__motionMediaEvents.length };
    });
    const setRate = async rate => {
      const before = await mediaSnapshot();
      await nav.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('tab', { name: '播放', exact: true }).click();
      const select = page.getByRole('combobox', { name: '播放倍速', exact: true });
      assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(option => Number(option.value))), [.5,.75,1,1.25,1.5,1.75,2]);
      await select.selectOption(String(rate));
      await page.waitForFunction(rate => window.__motionMedia?.playbackRate === rate && window.__motionMedia?.defaultPlaybackRate === rate, rate);
      await waitUntil(() => app.evaluate((_electron, rate) => global.__wuuSmoke.data.settings.playbackRate === rate, rate), 'Playback speed is saved through the real application');
      const after = await mediaSnapshot();
      assert.ok(after.sameElement && after.src === before.src && after.paused === before.paused, 'Changing speed retains the same media, source and playing state');
      assert.equal(after.playCalls, before.playCalls, 'Changing speed does not restart playback');
      assert.equal(after.preservesPitch, true, 'The real media preserves audio pitch');
      if (before.paused) assert.ok(Math.abs(after.time-before.time) < .05, 'A paused rate change preserves the exact position');
      const events = await page.evaluate(start => window.__motionMediaEvents.slice(start), before.events);
      assert.ok(events.every(event => event.type === 'ratechange'), 'A rate change does not pause, empty or reload media');
      report.rates.push({ requested: rate, before, after, events });
      await nav.getByRole('button', { name: '正在播放', exact: true }).click();
      return after;
    };
    // The main shell legitimately interpolates its accent. Compare the overlay's
    // first paint with the decoder-derived author target, never that interim tint.
    const accent = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--cover-accent').trim());
    const waitCover = index => page.waitForFunction(expected => getComputedStyle(document.documentElement).getPropertyValue('--cover-color-rgb').split(',').map(Number).every((channel, index) => channel === expected[index]), fixture.colors[index]);
    const paletteRequest = label => app.evaluate((_electron, label) => global.__wuuLyricsMotion.requests.find(request => request.label === label), label);
    const release = async label => {
      // Observe the blocked request for at least 650ms; the gate is still closed
      // while all frames above are collected. There is no post-failure sleep.
      await waitUntil(async () => { const request = await paletteRequest(label); return request && Date.now() - request.started >= 650; }, 'The genuine extraction is deliberately held beyond 500ms');
      await app.evaluate((_electron, label) => global.__wuuLyricsMotion.release(label), label);
      await waitUntil(async () => (await paletteRequest(label))?.resolved, 'The released request completes real image decoding');
      const request = await paletteRequest(label);
      assert.ok(request.resolved - request.started >= 650);
      return request;
    };
    const latestFrame = () => app.evaluate(() => global.__wuuLyricsMotion.lastNativeFrame);
    const framesAfter = wall => app.evaluate((_electron, wall) => global.__wuuLyricsMotion.frames.filter(frame => frame.nativeVisible && frame.wall >= wall), wall);
    const openingStats = show => app.evaluate((_electron, show) => global.__wuuLyricsMotion.openings.find(opening => opening.show === show && opening.firstNative.url.includes('window=lyrics')),
      show);
    const settled = async (text, color) => waitUntil(async () => {
      const frame = await latestFrame(), layer = frame && live(frame);
      return layer?.text === text && frame.outgoingWrappers === 0 && layer.transition === 'false'
        && (!color || JSON.stringify(rgb(layer.color)) === JSON.stringify(rgb(color)));
    }, 'Actual frames settle on the intended lyric and color');
    const capture = async name => {
      const file = path.join(artifacts, `${name}.png`);
      await desktop.screenshot({ path: file, scale: 'css' }); report.screenshots.push(file);
    };
    const open = async () => {
      await page.getByRole('button', { name: '打开桌面歌词', exact: true }).click();
      await waitUntil(() => {
        desktop = app.windows().find(window => window.url().includes('window=lyrics'));
        return !!desktop;
      }, 'The production independent desktop lyric window opens');
      desktop.setDefaultTimeout(12000);
      // Playwright's focus override can report visible for a native hidden window.
      // Use its original CDP session, as the existing coverLifecycle suite does.
      const driver = desktop._connection.toImpl(desktop);
      assert.ok(driver?.delegate?._mainFrameSession?._client);
      await driver.delegate._mainFrameSession._client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    };
    const firstPaint = async (show, text, color) => {
      let frame;
      await waitUntil(async () => {
        frame = (await openingStats(show))?.firstWord;
        return !!frame;
      }, 'The first visible word frame was captured by the preload recorder');
      assert.equal(live(frame)?.text, text, 'The first visible frame contains the intended paused lyric, without previous-song words');
      assertInk(frame, color, `show ${show} first visible frame`);
      report.firstFrames.push(frame);
      return frame;
    };
    const assertOpeningOrder = async () => {
      const { frames, shows, acks } = await app.evaluate(() => ({ frames: global.__wuuLyricsMotion.openings.map(opening => opening.firstNative),
        shows: global.__wuuLyricsMotion.shows, acks: global.__wuuLyricsMotion.openingAcks }));
      const lyricIds = new Set(frames.filter(frame => frame.url.includes('window=lyrics')).map(frame => frame.id));
      const previous = new Map(), openings = [];
      for (const show of shows.filter(show => lyricIds.has(show.id))) {
        const frame = frames.find(frame => frame.id === show.id && frame.show === show.sequence && frame.nativeVisible);
        assert.ok(frame, 'Every native lyric show has a recorded visible frame');
        const epoch = Number(frame.openingEpoch);
        assert.ok(Number.isSafeInteger(epoch) && epoch > 0, 'The visible DOM identifies its committed opening epoch');
        const ack = acks.findLast(ack => ack.id === show.id && Number(ack.epoch) === epoch && ack.order < show.order);
        assert.ok(ack, 'Native show occurs strictly after the real same-window ACK for its visible DOM epoch');
        const prior = previous.get(show.id);
        if (prior) {
          assert.ok(epoch > prior.epoch, 'Reopening cannot reuse a stale opening epoch');
          assert.ok(ack.order > prior.show.order, 'Every reopening requires a fresh ACK after the preceding show');
        }
        assert.equal(ack.visible, false, 'The DOM commit is acknowledged before the native window becomes visible');
        previous.set(show.id, { epoch, show }); openings.push({ epoch, show, ack, firstFrameAt: frame.wall });
      }
      assert.ok(openings.length >= 2, 'Initial open and paused reopening both follow the real ACK protocol');
      report.openingOrdering = openings;
    };

    // 1. Open during a deliberately stalled real palette extraction, then reopen
    // paused after changing to another fully decoded cover while the overlay is hidden.
    await seek(16.35);
    await open();
    desktop.on('pageerror', error => report.errors.push(error.message));
    await waitUntil(async () => (await openingStats(1))?.pendingFrames >= 4,
      'Several native visible frames are observed before the pending color is released');
    const pending = await openingStats(1);
    assert.ok(pending.pendingPainted === 0 && !pending.firstWord, 'Pending extraction never paints the default pink lyrics');
    const firstRequest = await release('first-open');
    assert.deepEqual(firstRequest.palette.slice(0, 1).map(color => [color.r, color.g, color.b]), [fixture.colors[0]], 'The test delays actual production PNG decoding, without supplying synthetic colors');
    await waitCover(0);
    const rose = await accent();
    await firstPaint(1, textAt(0, 16.35), rose);
    await desktop.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    await settled(textAt(0, 16.35), rose);
    await capture('slow-first-open');
    await page.getByRole('button', { name: '关闭桌面歌词', exact: true }).click();
    const blueStart = Date.now();
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await page.locator('.record-info h1').filter({ hasText: fixture.songs[1].songName }).waitFor();
    await pause(); await seek(16.35);
    await waitUntil(() => app.evaluate((_electron, { source, start }) => global.__wuuLyricsMotion.requests.some(request => request.source === source && request.started >= start && request.resolved),
      { source: fixture.songs[1].coverPath, start: blueStart }), 'The new cover genuinely resolves before paused reopening');
    await waitCover(1);
    const blue = await accent();
    await open();
    await firstPaint(2, textAt(1, 16.35), blue);
    await settled(textAt(1, 16.35), blue);
    await assertOpeningOrder();
    await capture('paused-different-song-reopen');
    report.checks.push('delayed real PNG extraction has no pink first frame; paused reopening begins with the new song and resolved color');

    // 2. Manual colors remain authoritative before and after a late real palette;
    // a coverless song then clears that palette through the public player controls.
    await nav.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.getByLabel('自定义进度条颜色', { exact: false }).check();
    await setInput(page.getByLabel('起始颜色', { exact: false }), '#f3bd47');
    await setInput(page.getByLabel('结束颜色', { exact: false }), '#ed754a');
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await settled(textAt(1, 16.35), '#f3bd47');
    await app.evaluate((_electron, source) => global.__wuuLyricsMotion.arm(source, 'custom-pending'), fixture.songs[0].coverPath);
    const customStart = Date.now();
    await page.getByRole('button', { name: '上一首', exact: true }).click();
    await page.locator('.record-info h1').filter({ hasText: fixture.songs[0].songName }).waitFor();
    await pause(); await seek(16.35);
    await waitUntil(async () => !!await paletteRequest('custom-pending'), 'The next real extraction is pending');
    await settled(textAt(0, 16.35), '#f3bd47');
    const customPending = await framesAfter(customStart);
    assert.ok(customPending.some(frame => live(frame)?.text.startsWith(fixture.songs[0].songName)), 'Custom color permits visible lyrics while extraction is still pending');
    for (const frame of customPending.filter(frame => live(frame)?.text.startsWith(fixture.songs[0].songName))) assertInk(frame, '#f3bd47', 'custom color during pending extraction');
    await release('custom-pending');
    await settled(textAt(0, 16.35), '#f3bd47');
    await nav.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.getByLabel('自定义进度条颜色', { exact: false }).uncheck();
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await settled(textAt(0, 16.35), rose);
    for (const index of [1, 2]) {
      await page.getByRole('button', { name: '下一首', exact: true }).click();
      await page.locator('.record-info h1').filter({ hasText: fixture.songs[index].songName }).waitFor();
      await pause();
    }
    await seek(16.35);
    const fallback = await accent();
    await settled(textAt(2, 16.35), fallback);
    assert.notDeepEqual(rgb(fallback), rgb(blue), 'Coverless lyrics clear the preceding cover hue');
    await capture('coverless-resolved-fallback');
    report.checks.push('manual color works during delayed extraction and survives its completion; coverless lyrics use the resolved fallback');

    // 3. Exercise the saved speed setting on real media, then observe the full
    // preview-to-current upward trajectory and word clock at 2× playback.
    await setRate(.5); await setRate(2);
    await nav.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '歌词', exact: true }).click();
    const ordinary = page.locator('.settings-advanced').filter({ hasText: '普通歌词字号' });
    await ordinary.locator('summary').click();
    await setInput(page.getByRole('slider', { name: '普通歌词字号', exact: true }), 36);
    const lyricSettings = page.locator('#settings-panel-lyrics');
    await lyricSettings.getByRole('checkbox', { name: '锁定桌面歌词（鼠标穿透）', exact: true }).check();
    await waitUntil(() => app.evaluate(() => global.__wuuSmoke.data.settings.desktopLyricLocked === true), 'Settings lock the native desktop lyric window');
    await lyricSettings.getByRole('checkbox', { name: '锁定桌面歌词（鼠标穿透）', exact: true }).uncheck();
    await waitUntil(() => app.evaluate(() => global.__wuuSmoke.data.settings.desktopLyricLocked === false), 'Settings unlock the native desktop lyric window');
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await seek(4.15); await settled(textAt(2, 4.15), fallback);
    const maximum = await latestFrame();
    assert.ok(Math.abs(maximum.viewport.width-900) <= 2 && Math.abs(maximum.viewport.height-140) <= 2, 'The real default 900×140 lyric viewport allows native DPI/border rounding: ' + JSON.stringify(maximum.viewport));
    assert.equal(live(maximum).fontSize, 42, 'The ordinary-font maximum renders the current desktop lyric at 42px');
    assert.equal(maximum.translations.length, 1, 'The real RAW parser renders the same-timestamp translation in the current group');
    assert.equal(maximum.preview.text, textAt(2, 5), 'The next preview is the next different timestamp original, never the current translation');
    for (const box of [maximum.entering, ...maximum.translations, maximum.preview]) {
      assert.ok(box.top >= -1 && box.bottom <= maximum.viewport.height+1 && box.left >= -1 && box.right <= maximum.viewport.width+1, 'Every maximum-size original, translation and preview remains inside the actual native viewport: ' + JSON.stringify(box));
    }
    report.maximumBilingual = maximum;
    const motionStart = Date.now();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => window.__motionMedia && !window.__motionMedia.paused && window.__motionMedia.currentTime >= 4.25);
    const clockBefore = await mediaSnapshot();
    await waitUntil(async () => (await mediaSnapshot()).time - clockBefore.time >= 2.1, 'The real audio clock advances through the next lyric at 2×');
    const clockAfter = await mediaSnapshot();
    const actualRate = (clockAfter.time-clockBefore.time) / ((clockAfter.at-clockBefore.at) / 1000);
    assert.ok(actualRate > 1.7 && actualRate < 2.3, 'Actual audio time advances at twice real elapsed time: ' + actualRate);
    const pauseStarted = Date.now();
    await pause();
    let pausedPacket;
    await waitUntil(async () => {
      pausedPacket = await app.evaluate((_electron, after) => global.__wuuLyricsMotion.clockEvents.findLast(packet => packet.at >= after && !packet.playing), pauseStarted);
      if (!pausedPacket) return false;
      const frame = await latestFrame();
      return frame?.wall >= pausedPacket.at && frame.nativeSequence >= pausedPacket.nativeSequence+3;
    }, 'The real paused clock packet has been rendered across several native frames');
    await settled(textAt(2, 5), fallback);
    const motionFrames = await framesAfter(motionStart), finalMotion = motionFrames.at(-1);
    const handoff = motionFrames.filter(frame => frame.outgoingWrappers === 1 && live(frame)?.text === textAt(2, 5));
    assert.ok(handoff.length >= 3, 'Several genuinely painted frames capture the physical old/new handoff');
    const incoming = handoff.map(frame => live(frame));
    assert.ok(incoming.some(layer => layer.opacity > 0 && layer.opacity < 1), 'The incoming lyric retains the visible preview opacity during its upward movement');
    assert.ok(handoff.some(frame => visible(frame).some(layer => layer.outgoing && layer.opacity > 0 && layer.opacity < 1)), 'The old current lyric visibly exits while the new line moves upward');
    const beforeBoundary = motionFrames.filter(frame => live(frame)?.text === textAt(2, 4.15)).at(-1);
    assert.ok(beforeBoundary, 'The recorder observes the actual next-line preview before the boundary');
    const distance = beforeBoundary.preview.center - finalMotion.entering.center;
    assert.ok(distance > 25, 'The incoming line travels the complete distance between the separate preview and current rows');
    const measured = handoff.find(frame => live(frame).keyframes.length >= 2);
    assert.ok(measured, 'Chromium exposes the running production CSS animation keyframes');
    const keyframes = live(measured).keyframes, firstKey = keyframes[0], lastKey = keyframes.at(-1);
    assert.ok(Math.abs(measured.slideDistance-distance) < 2.5, 'The stage distance equals the old preview center minus the new current center');
    assert.ok(Math.abs(firstKey.y-distance) < 2.5 && Math.abs(lastKey.y) < .1, 'Native incoming keyframes span the full preview-to-current row distance');
    assert.ok(Math.abs(firstKey.scale-beforeBoundary.preview.fontSize/finalMotion.entering.fontSize) < .02 && Math.abs(lastKey.scale-1) < .01, 'The old small preview grows to the actual current lyric font');
    assert.equal(live(measured).timing.duration, 280, 'The measured handoff uses the production 280ms animation');
    const centers = handoff.map(frame => frame.entering.center);
    assert.ok(Math.max(...centers)-Math.min(...centers) > distance*.15 && centers[0] > centers.at(-1), 'Recorded intermediate centers move upward toward the current row');
    assert.ok(centers.every(center => center >= finalMotion.entering.center-2 && center <= beforeBoundary.preview.center+2), 'The visible incoming line follows the actual row-to-row path');
    const exiting = handoff.map(frame => frame.layers.find(layer => layer.outgoing)).find(layer => layer?.keyframes.length >= 2);
    assert.ok(exiting && Math.abs(exiting.keyframes.at(-1).y+distance) < 2.5, 'The outgoing original moves upward by the same full distance');
    assert.ok(handoff.every(frame => frame.next !== beforeBoundary.preview.text), 'The moved next original becomes current while the preview advances to the following timestamp');
    report.transitions.push(...handoff);
    report.motionGeometry = { distance, keyframes, centers, before: beforeBoundary.preview, after: finalMotion.entering };

    // Compare the rendered partial RAW character with real public clock packets.
    // Only late frames between packets count, so a 1× interpolation that happens
    // to resynchronize every 200ms cannot pass as a correct 2× word clock.
    const timing = await app.evaluate(() => ({ events: global.__wuuLyricsMotion.clockEvents, lines: global.__wuuLyricsMotion.rawLines }));
    const fillSamples = [];
    for (const frame of motionFrames) {
      const layer = live(frame), line = timing.lines.find(line => line.text === layer?.text);
      if (!line || !layer.fills?.length) continue;
      const packet = timing.events.findLast(packet => packet.at <= frame.wall && packet.at >= motionStart);
      if (!packet?.playing || packet.playbackRate !== 2) continue;
      const age = (frame.wall-packet.at) / 1000;
      if (age < .12 || age > .185) continue;
      const index = layer.fills.findIndex(fill => fill > 5 && fill < 95);
      if (index < 0) continue;
      const paintedTime = line.time + (index+layer.fills[index]/100)*line.step;
      const expectedTime = packet.t + age*2;
      fillSamples.push({ at: frame.wall, age, paintedTime, expectedTime, error: Math.abs(paintedTime-expectedTime), text: layer.text });
    }
    assert.ok(fillSamples.length >= 3, 'Real partial words are sampled well after clock packets, while audio advances at 2×');
    const errors = fillSamples.map(sample => sample.error).sort((a,b) => a-b);
    assert.ok(errors[Math.floor(errors.length/2)] < .065 && errors.at(-1) < .11, 'The between-packet word clock follows 2× time without a 1× lag: ' + JSON.stringify(fillSamples));
    report.rateClock = { before: clockBefore, after: clockAfter, actualRate, fillSamples };

    const pausedBefore = await mediaSnapshot(), pausedFrame = await latestFrame();
    const pausedInk = live(pausedFrame).fills;
    await waitUntil(async () => (await latestFrame()).nativeSequence >= pausedFrame.nativeSequence+8, 'Several actual native frames are observed with a paused 2× clock');
    const pausedAfter = await mediaSnapshot();
    assert.ok(Math.abs(pausedAfter.time-pausedBefore.time) < .03, 'A paused 2× media clock remains still');
    assert.deepEqual(live(await latestFrame()).fills, pausedInk, 'The paused 2× word fill remains still');
    await seek(5.35); await settled(textAt(2, 5.35), fallback);
    const seeked = await mediaSnapshot();
    await waitUntil(async () => {
      const layer = live(await latestFrame()), line = timing.lines.find(line => line.text === layer?.text);
      const index = layer?.fills?.findIndex(fill => fill > 0 && fill < 100);
      return index >= 0 && Math.abs(line.time+(index+layer.fills[index]/100)*line.step-seeked.time) < .04;
    }, 'A paused seek updates the 2× word clock immediately to the genuine new audio position');
    await nav.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '歌词', exact: true }).click();
    await lyricSettings.getByRole('button', { name: '关闭桌面歌词', exact: true }).click();
    const reopenBefore = await mediaSnapshot();
    await lyricSettings.getByRole('button', { name: '打开桌面歌词', exact: true }).click();
    await firstPaint(3, textAt(2, 5.35), fallback);
    await settled(textAt(2, 5.35), fallback);
    const reopenAfter = await mediaSnapshot();
    assert.ok(reopenAfter.paused && reopenAfter.src === reopenBefore.src && Math.abs(reopenAfter.time-reopenBefore.time) < .03 && reopenAfter.rate === 2, 'Reopening paused desktop lyrics retains the same real media, position and 2× speed');
    await page.getByRole('tab', { name: '播放', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '播放倍速', exact: true }).inputValue(), '2', 'Reopening retains the saved playback-speed setting');
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => !window.__motionMedia.paused);
    await setRate(1.5); await setRate(2); await pause();
    report.checks.push('saved 0.5–2× settings preserve media/pitch/state; real 2× audio and between-packet RAW fill stay synchronized across the upward boundary, paused seek and exact-color reopening');
    report.checks.push('bilingual maximum 42px original, translation and next fit 900×140; native 280ms keyframes and intermediate positions span the full preview-to-current row distance');

    // Interrupt with paused seeks and two genuine next operations.
    for (const time of [10.3, 40.2, 16.5, 56.2, 5.2]) await seek(time);
    await settled(textAt(2, 5.2), fallback);
    await app.evaluate((_electron, source) => global.__wuuLyricsMotion.arm(source, 'superseded-next'), fixture.songs[0].coverPath);
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await waitUntil(async () => !!await paletteRequest('superseded-next'), 'The earlier next operation reaches its real extraction gate');
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await page.locator('.record-info h1').filter({ hasText: fixture.songs[1].songName }).waitFor();
    await pause(); await seek(16.35);
    await settled(textAt(1, 16.35), blue);
    await release('superseded-next');
    await settled(textAt(1, 16.35), blue);
    await capture('rapid-next-final-song');
    report.checks.push('interrupted seeks and late extraction after rapid next retain at most two layers and the final song');

    // 4. Reduced motion bypasses handoff layers on the same real clock boundary.
    await desktop.emulateMedia({ reducedMotion: 'reduce' });
    await seek(4.7); await settled(textAt(1, 4.7), blue);
    const reducedStart = Date.now();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await waitUntil(async () => { const frame = await latestFrame(); return frame.wall >= reducedStart && frame.reduced && live(frame)?.text === textAt(1, 5); }, 'Reduced motion follows the real next lyric');
    await pause(); await settled(textAt(1, 5), blue);
    const reducedFrames = (await framesAfter(reducedStart)).filter(frame => frame.reduced);
    assert.ok(reducedFrames.length >= 2);
    assert.ok(reducedFrames.every(frame => frame.outgoingWrappers === 0 && frame.layers.every(layer => layer.animation === 'none')), 'Reduced motion never creates old animated layers');
    const frameSummary = await app.evaluate(() => ({ counts: global.__wuuLyricsMotion.frameStats, violations: global.__wuuLyricsMotion.invariantViolations, retained: global.__wuuLyricsMotion.frames.length }));
    assert.ok(frameSummary.counts.native > 0);
    assert.deepEqual(frameSummary.violations, [], 'Every native recorded frame contains lyrics only, with at most one current and one inert outgoing layer');
    await capture('reduced-motion');
    await assertOpeningOrder();
    report.checks.push('reduced motion switches directly without old layers; every recorded frame preserves the two-layer bound');
    const diagnostics = await app.evaluate(() => ({ errors: global.__wuuLyricsMotion.monitorErrors, crashes: global.__wuuLyricsMotion.crashes, requests: global.__wuuLyricsMotion.requests }));
    assert.deepEqual(diagnostics.errors, []); assert.deepEqual(diagnostics.crashes, []); assert.deepEqual(report.errors, []);
    report.requests = diagnostics.requests;
    report.frameCount = frameSummary.counts.native; report.retainedFrames = frameSummary.retained;
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (app) report.failureNative = await app.evaluate(({ BrowserWindow }) => ({ at: Date.now(),
      windows: BrowserWindow.getAllWindows().map(window => ({ id: window.webContents.id, url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(), loading: window.webContents.isLoading() })),
      shows: global.__wuuLyricsMotion.shows, nativeEvents: global.__wuuLyricsMotion.nativeEvents,
      openingAcks: global.__wuuLyricsMotion.openingAcks,
    })).catch(() => null);
    if (desktop) report.failureDOM = await desktop.evaluate(() => {
      const root = document.querySelector('.desktop-lyrics'), stage = document.querySelector('.desktop-lyric-stage');
      return { at: Date.now(), url: location.href, visibility: document.visibilityState, hidden: document.hidden, readyState: document.readyState,
        rootDataset: root ? { ...root.dataset } : null, stageVisibility: stage ? getComputedStyle(stage).visibility : null,
        inlineColor: root?.style.getPropertyValue('--lyric-color'), color: root ? getComputedStyle(root).getPropertyValue('--lyric-color') : null,
        currentText: document.querySelector('.desktop-current-row')?.textContent, nextText: document.querySelector('.desktop-next-row')?.textContent,
        currentDataset: document.querySelector('.desktop-lyric-current-content') ? { ...document.querySelector('.desktop-lyric-current-content').dataset } : null,
      };
    }).catch(() => null);
    if (desktop) await desktop.screenshot({ path: path.join(artifacts, 'failure-desktop.png') }).catch(() => {});
    if (page) await page.screenshot({ path: path.join(artifacts, 'failure-main.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      const recordings = await app.evaluate((_electron, output) => global.__wuuLyricsMotion.writeRecordings(output), path.join(artifacts, 'frames.json')).catch(() => null);
      report.diagnostics = recordings && { crashes: recordings.crashes, errors: recordings.errors, requests: recordings.requests,
        shows: recordings.shows, nativeEvents: recordings.nativeEvents, openingAcks: recordings.openingAcks,
        frameStats: recordings.frameStats, retainedFrames: recordings.retainedFrames, openings: recordings.openings };
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    }
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, frames: report.frameCount, report: path.join(artifacts, 'report.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
