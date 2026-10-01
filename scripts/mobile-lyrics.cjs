// Real Chromium regression using the production Vue build, fixture HTTP and native media.
// Run after building mobile_UI. No application components or test hooks are substituted.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'mobile');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], screenshots: [], media: [], lyricPositions: [], rendererErrors: [], boundaryFrames: [] };

async function waitUntil(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  assert.fail(message);
}

// These touch events go through the same Vue gesture handlers as a finger swipe.
// DOM event dispatch is used because Electron windows do not create a mobile context.
async function touchGesture(locator, direction) {
  await locator.evaluate((element, direction) => {
    const box = element.getBoundingClientRect();
    const left = box.left + box.width * .2, right = box.left + box.width * .8;
    const from = direction === 'left' ? right : left, to = direction === 'left' ? left : right;
    const y = box.top + Math.min(200, box.height * .35);
    const fire = (type, x, ended = false) => {
      const point = { identifier: 1, target: element, clientX: x, clientY: y, pageX: x, pageY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: ended ? [] : [point] }, changedTouches: { value: [point] } });
      element.dispatchEvent(event);
    };
    fire('touchstart', from); fire('touchmove', to); fire('touchend', to, true);
  }, direction);
}

(async () => {
  let app, page;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'mobile-smoke-main.cjs')], cwd: root,
      env: { ...process.env }, timeout: 30000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 414, height: 896 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const origin = await app.evaluate(() => global.__wuuMobileFixture.origin);
    await page.waitForURL(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.addInitScript(() => {
      window.__mobileMediaSamples = [];
      const started = performance.now();
      const sample = () => {
        const audio = document.querySelector('audio');
        if (audio?.getAttribute('src')) {
          window.__mobileMediaSamples.push({ at: performance.now(), readyState: audio.readyState, time: audio.currentTime,
            duration: Number.isFinite(audio.duration) ? audio.duration : null, paused: audio.paused,
            displayedTime: document.querySelector('.player-view .progress-bar .time')?.textContent?.trim() || '',
            lyric: document.querySelector('.lyric-line.cur .lyric-text, .lyric-line.active .lyric-text')?.textContent?.trim() || '' });
        }
        if (performance.now() - started < 15000) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await app.evaluate(() => { global.__wuuMobileFixture.requests.length = 0; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const cover = () => page.locator('.player-view');
    const lyricView = () => page.locator('.lyrics-view');
    const currentLine = () => page.locator('.lyrics-view .lyric-line.cur .lyric-text, .lyrics-view .lyric-line.active .lyric-text');
    const audio = () => page.locator('audio').evaluate(element => ({ time: element.currentTime, duration: element.duration,
      paused: element.paused, readyState: element.readyState, source: element.currentSrc || element.src }));
    const capture = async name => {
      const file = path.join(artifacts, name + '.png');
      await page.screenshot({ path: file }); report.screenshots.push(file);
    };
    const requireLine = async (text, message) => {
      await waitUntil(async () => (await currentLine().allTextContents()).some(value => value.trim() === text), message);
      await waitUntil(() => lyricView().evaluate(element => {
        const selected = element.querySelector('.lyric-line.cur, .lyric-line.active');
        if (!selected) return false;
        const box = element.getBoundingClientRect(), line = selected.getBoundingClientRect();
        return line.top >= box.top - 1 && line.bottom <= box.bottom + 1;
      }), message + ': selected lyric scrolls into view');
      const position = await lyricView().evaluate(element => {
        const selected = element.querySelector('.lyric-line.cur, .lyric-line.active');
        const box = element.getBoundingClientRect(), line = selected?.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height, scrollTop: element.scrollTop,
          lineTop: line?.top, lineBottom: line?.bottom, text: selected?.querySelector('.lyric-text')?.textContent?.trim() };
      });
      assert.ok(position.lineTop >= position.top - 1 && position.lineBottom <= position.bottom + 1, message + ': selected lyric is visible');
      report.lyricPositions.push(position);
    };
    const openLyrics = async () => { await cover().waitFor({ state: 'visible' }); await touchGesture(cover(), 'left'); await lyricView().waitFor({ state: 'visible' }); };
    const closeLyrics = async () => { await touchGesture(lyricView(), 'right'); await cover().waitFor({ state: 'visible' }); };

    await cover().waitFor({ state: 'visible' });
    await waitUntil(async () => { const media = await audio(); return media.readyState >= 1 && Math.abs(media.time - 35) < .2; }, 'Delayed metadata should apply the pending 35 second seek');
    const initial = await audio();
    assert.equal(initial.paused, true); assert.ok(Math.abs(initial.duration - 90) < .1);
    assert.equal((await cover().locator('.progress-bar .time').first().textContent()).trim(), '0:35');
    const pending = await page.evaluate(() => window.__mobileMediaSamples.filter(sample => sample.readyState < 1 && sample.displayedTime === '0:35'));
    assert.ok(pending.length, 'The paused 35 second position should be displayed before audio metadata arrives');
    report.pendingMetadata = { samples: pending.length, first: pending[0], last: pending.at(-1) };
    report.media.push({ step: 'initial-paused', ...initial });
    report.checks.push('paused startup restores 35 seconds before and after delayed native metadata');
    await capture('01-paused-cover');

    await openLyrics();
    await requireLine('海岸·30秒歌词', 'Opening paused lyrics immediately selects the 30 second line');
    assert.equal((await audio()).paused, true);
    await capture('02-paused-current-lyric');
    await lyricView().locator('.lyric-line').filter({ has: page.locator('.lyric-text', { hasText: /^海岸·50秒歌词$/ }) }).click();
    await waitUntil(async () => Math.abs((await audio()).time - 50) < .2, 'Clicking the 50 second lyric seeks the actual audio');
    await requireLine('海岸·50秒歌词', 'Paused seeking updates the lyric highlight');
    await capture('03-paused-lyric-seek');
    await closeLyrics();
    assert.equal((await cover().locator('.progress-bar .time').first().textContent()).trim(), '0:50');
    await openLyrics();
    await requireLine('海岸·50秒歌词', 'Reopening paused lyrics keeps the selected 50 second line');
    report.checks.push('paused lyric click seeks, highlights and survives cover/lyrics remount');

    await closeLyrics();
    // A progress tap is a real production seek; no composable state is accessed.
    await cover().locator('.p-track').evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width * 37.5 / 90, y = box.top + box.height / 2;
      const point = { identifier: 2, target: element, clientX: x, clientY: y, pageX: x, pageY: y };
      for (const type of ['touchstart', 'touchend']) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } });
        element.dispatchEvent(event);
      }
    });
    await waitUntil(async () => Math.abs((await audio()).time - 37.5) < .2, 'The production progress control seeks near the next lyric boundary');
    await cover().locator('.play-btn').click();
    await openLyrics();
    await requireLine('海岸·30秒歌词', 'Resumed playback starts on the current lyric');
    report.boundaryFrames = await page.evaluate(() => new Promise((resolve, reject) => {
      const frames = [], started = performance.now();
      const sample = () => {
        const audio = document.querySelector('audio');
        const text = document.querySelector('.lyric-line.cur .lyric-text, .lyric-line.active .lyric-text')?.textContent?.trim() || '';
        frames.push({ at: performance.now(), time: audio.currentTime, paused: audio.paused, lyric: text });
        if (audio.currentTime >= 40.2) return resolve(frames);
        if (performance.now() - started > 10000) return reject(new Error('Native playback did not reach the next lyric boundary'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const firstNewLine = report.boundaryFrames.find(frame => frame.time >= 40 && frame.lyric === '海岸·40秒歌词');
    assert.ok(report.boundaryFrames.some(frame => frame.time < 40 && frame.lyric === '海岸·30秒歌词'));
    assert.ok(firstNewLine && firstNewLine.time - 40 < .12, 'The next line highlights within a few rendered frames of the actual media boundary');
    await capture('04-playing-next-lyric');
    report.checks.push('real playback advances and highlights the next lyric without waiting for coarse timeupdate events');
    await closeLyrics();
    if (!(await audio()).paused) await cover().locator('.play-btn').click();

    const listTab = page.locator('.bottom-nav').getByRole('button', { name: '歌单', exact: true });
    const olderLyricResponse = page.waitForResponse(response => response.url().endsWith('/api/lyric/1'));
    await listTab.click();
    await page.locator('.song-list-view .song-item').filter({ hasText: '延迟返回的旧歌' }).click();
    await waitUntil(() => app.evaluate(() => global.__wuuMobileFixture.requests.some(request => request.path === '/api/lyric/1')), 'The first delayed lyric request starts');
    await listTab.click();
    await page.locator('.song-list-view .song-item').filter({ hasText: '最终选择的歌曲' }).click();
    await openLyrics();
    await waitUntil(async () => (await lyricView().locator('.lyric-text').allTextContents()).length === 8 &&
      (await lyricView().locator('.lyric-text').allTextContents()).every(text => text.startsWith('最终·')), 'The last selected song displays its own lyrics');
    await waitUntil(() => app.evaluate(() => global.__wuuMobileFixture.requests.some(request => request.path === '/api/lyric/1' && request.servedAt)), 'Wait for the older request to complete');
    await (await olderLyricResponse).text();
    // Allow the delivered fetch result and Vue update to finish before inspecting DOM.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const rows = await lyricView().locator('.lyric-text').allTextContents();
    assert.equal(rows.length, 8); assert.ok(rows.every(text => text.startsWith('最终·')));
    assert.ok(!(await lyricView().textContent()).includes('迟到·'));
    assert.ok((await audio()).source.endsWith('/api/stream/2'));
    await waitUntil(async () => (await currentLine().allTextContents()).some(text => text.startsWith('最终·')), 'The final song owns the active lyric as well');
    await capture('05-final-song-after-stale-lyrics');
    report.checks.push('rapid song selection ignores late lyrics from the previous song');

    report.fixture = await app.evaluate(() => ({ origin: global.__wuuMobileFixture.origin, requests: global.__wuuMobileFixture.requests }));
    const delayedAudio = report.fixture.requests.find(request => request.path.startsWith('/api/stream') && request.delayMs === 900 && request.servedAt);
    assert.ok(delayedAudio && delayedAudio.servedAt - delayedAudio.startedAt >= 850, 'The metadata test used a genuinely delayed HTTP audio response');
    const oldLyric = report.fixture.requests.find(request => request.path === '/api/lyric/1' && request.servedAt);
    const finalLyric = report.fixture.requests.find(request => request.path === '/api/lyric/2' && request.servedAt);
    assert.ok(oldLyric.servedAt > finalLyric.servedAt, 'The race test delivered older lyrics after the final song lyrics');
    assert.deepEqual(report.rendererErrors, [], 'The mobile renderer should not emit uncaught errors');
    report.ok = true;
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    process.exitCode = 1;
    if (page) {
      try { const file = path.join(artifacts, 'failure.png'); await page.screenshot({ path: file }); report.screenshots.push(file); } catch {}
    }
  } finally {
    if (app) {
      if (!report.fixture) { try { report.fixture = await app.evaluate(() => ({ origin: global.__wuuMobileFixture.origin, requests: global.__wuuMobileFixture.requests })); } catch {} }
      await app.close();
    }
    const file = path.join(artifacts, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, checks: report.checks, error: report.error?.message, report: file }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
