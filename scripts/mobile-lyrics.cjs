// Real Chromium regression using the production Vue build, fixture HTTP and native media.
// Run after building mobile_UI. No application components or test hooks are substituted.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'mobile');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], screenshots: [], media: [], lyricPositions: [], rendererErrors: [], boundaryFrames: [], fonts: [], lyricStyles: [] };

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
    await app.evaluate(() => {
      const fixture = global.__wuuMobileFixture;
      fixture.requests.length = 0;
      fixture.lyrics[0] = '[作词:真实署名作者][作曲:真实署名作曲]\n[00:02.00]编曲:制作署名\n[00:03.00]混音:混音署名\n' + fixture.lyrics[0];
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const cover = () => page.locator('.player-view');
    const lyricView = () => page.locator('.lyrics-view');
    const currentLine = () => page.locator('.lyrics-view .lyric-line.cur .lyric-text, .lyrics-view .lyric-line.active .lyric-text');
    const settingsTab = () => page.locator('.bottom-nav').getByRole('button', { name: '设置', exact: true });
    const recommendTab = () => page.locator('.bottom-nav').getByRole('button', { name: '推荐', exact: true });
    const fontRange = () => page.getByRole('slider', { name: '当前歌词字号', exact: true });
    const ordinaryRange = () => page.getByRole('slider', { name: '普通歌词字号', exact: true });
    const fontSize = async () => Number(await page.locator('#mobile-current-lyric-size').inputValue());
    const ordinarySize = async () => Number(await page.locator('#mobile-lyric-size').inputValue());
    const showSettings = async () => { await settingsTab().click(); await page.locator('.settings-page').waitFor({ state: 'visible' }); };
    const returnToLyrics = async () => { await recommendTab().click(); await lyricView().waitFor({ state: 'visible' }); };
    const setFont = async value => {
      await showSettings(); await fontRange().focus(); await fontRange().press('Home');
      while ((await fontSize()) < value) await fontRange().press('ArrowRight');
      assert.equal(await fontSize(), value);
    };
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
    const seekCoverTo = seconds => cover().locator('.p-track').evaluate((element, seconds) => {
      const box = element.getBoundingClientRect(), x = box.left + box.width * seconds / 90, y = box.top + box.height / 2;
      const point = { identifier: 2, target: element, clientX: x, clientY: y, pageX: x, pageY: y };
      for (const type of ['touchstart', 'touchend']) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } });
        element.dispatchEvent(event);
      }
    }, seconds);
    const styles = () => lyricView().evaluate(element => {
      const describe = selector => {
        const line = element.querySelector(selector), text = line?.querySelector('.lyric-text');
        if (!line || !text) return null;
        const css = getComputedStyle(line), content = getComputedStyle(text);
        return { text: text.textContent.trim(), color: css.color, fontSize: parseFloat(css.fontSize), weight: Number(css.fontWeight), opacity: Number(css.opacity), gradient: content.backgroundImage,
          background: css.backgroundColor, shadow: css.boxShadow, borderWidth: parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth) };
      };
      return { past: describe('.lyric-line.sung'), current: describe('.lyric-line.cur, .lyric-line.active'), future: describe('.lyric-line.unsung') };
    });
    const requireColors = async message => {
      const value = await styles();
      assert.ok(value.past && value.current && value.future, message + ': timed rows expose all three states');
      assert.equal(value.future.color, 'rgb(255, 255, 255)', message + ': future lyrics are white');
      assert.equal(value.future.opacity, 1, message + ': future white remains readable');
      assert.notEqual(value.past.color, value.future.color, message + ': past lyrics use the sung color');
      assert.ok(value.current.gradient.includes(value.past.color) && value.current.gradient.includes(value.future.color), message + ': the current fill uses sung color and white');
      assert.ok(value.current.fontSize > value.future.fontSize && value.current.weight >= 600, message + ': the current line stands out');
      assert.equal(value.current.background, 'rgba(0, 0, 0, 0)', message + ': the current lyric has no selection background');
      assert.equal(value.current.shadow, 'none', message + ': the current lyric has no selection shadow');
      assert.equal(value.current.borderWidth, 0, message + ': the current lyric has no selection border');
      assert.equal(await lyricView().locator('.cur-meta, .hover-meta').count(), 0, message + ': no side selection or timestamp marker is shown');
      assert.equal(value.past.fontSize, value.future.fontSize, message + ': completed lyrics use the ordinary size');
      report.lyricStyles.push({ step: message, ...value });
    };

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
    await requireColors('initial paused lyric colors');
    const footer = page.locator('footer[aria-label="词曲信息"]');
    await footer.waitFor({ state: 'visible' });
    assert.deepEqual((await footer.locator('span').allTextContents()).map(text => text.trim()), ['作词 真实署名作者', '作曲 真实署名作曲']);
    assert.equal(await lyricView().locator('.lyric-line').count(), 8, 'Credit rows do not occupy the sing-along lyrics');
    assert.ok(!(await lyricView().textContent()).includes('制作署名') && !(await lyricView().textContent()).includes('混音署名'));
    report.checks.push('only genuine lyricist and composer credits appear below the lyrics, with production credits excluded from sung rows');
    assert.equal(await fontRange().count(), 0, 'The playback view exposes no font control');
    const beforeFont = (await styles()).current.fontSize;
    const beforeOrdinary = (await styles()).future.fontSize;
    await showSettings(); await fontRange().waitFor({ state: 'visible' });
    assert.equal(await ordinaryRange().count(), 0, 'The ordinary lyric font is tucked into the advanced disclosure');
    const advanced = page.locator('.lyric-advanced summary');
    await advanced.focus(); await advanced.press('Enter'); await ordinaryRange().waitFor({ state: 'visible' });
    assert.equal(await ordinarySize(), beforeOrdinary);
    await advanced.press('Enter');
    const beforeSize = await fontSize();
    await fontRange().focus(); await fontRange().press(beforeSize < 60 ? 'ArrowRight' : 'ArrowLeft');
    const chosenSize = await fontSize();
    assert.notEqual(chosenSize, beforeSize);
    await page.waitForFunction(value => localStorage.getItem('wuu-mobile-current-lyric-size') === String(value), chosenSize);
    await waitUntil(async () => (await styles()).current.fontSize === chosenSize, 'Settings update the existing current lyric immediately');
    assert.equal((await styles()).future.fontSize, beforeOrdinary, 'Adjusting the current font leaves ordinary lyrics unchanged');
    await capture('02a-lyric-size-settings');
    await returnToLyrics();
    await waitUntil(async () => (await styles()).current.fontSize !== beforeFont && (await styles()).current.fontSize === chosenSize, 'Returning from settings displays the adjusted current lyric size');
    report.fonts.push({ step: 'keyboard', beforeSize, chosenSize, rendered: (await styles()).current.fontSize, ordinary: (await styles()).future.fontSize });
    await capture('02-paused-current-lyric');
    await closeLyrics(); await openLyrics();
    assert.equal(await fontSize(), chosenSize, 'The font preference survives returning to the cover and reopening lyrics');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await cover().waitFor({ state: 'visible' });
    await waitUntil(async () => { const media = await audio(); return media.readyState >= 1 && Math.abs(media.time - 35) < .2; }, 'Reload restores the native paused position');
    await openLyrics(); await requireLine('海岸·30秒歌词', 'Reloaded paused lyrics synchronize before playback');
    assert.equal(await fontSize(), chosenSize, 'The font preference survives a real page reload');
    assert.equal((await styles()).current.fontSize, chosenSize);
    assert.equal((await styles()).future.fontSize, beforeOrdinary);
    assert.equal(await fontRange().count(), 0, 'Font controls remain confined to settings after reload');
    report.checks.push('settings current lyric size responds independently to keyboard and persists across remount and reload; ordinary size stays in advanced settings');
    await lyricView().locator('.lyric-line').filter({ has: page.locator('.lyric-text', { hasText: /^海岸·50秒歌词$/ }) }).click();
    await waitUntil(async () => Math.abs((await audio()).time - 50) < .2, 'Clicking the 50 second lyric seeks the actual audio');
    await requireLine('海岸·50秒歌词', 'Paused seeking updates the lyric highlight');
    await requireColors('forward seek lyric colors');
    assert.equal(await lyricView().locator('.lyric-line').filter({ hasText: '海岸·30秒歌词' }).evaluate(row => parseFloat(getComputedStyle(row).fontSize)), beforeOrdinary, 'The former current line immediately returns to the ordinary font');
    await capture('03-paused-lyric-seek');
    await closeLyrics();
    assert.equal((await cover().locator('.progress-bar .time').first().textContent()).trim(), '0:50');
    await openLyrics();
    await requireLine('海岸·50秒歌词', 'Reopening paused lyrics keeps the selected 50 second line');
    report.checks.push('paused lyric click seeks, highlights and survives cover/lyrics remount');
    await lyricView().locator('.lyric-line').filter({ has: page.locator('.lyric-text', { hasText: /^海岸·10秒歌词$/ }) }).click();
    await waitUntil(async () => Math.abs((await audio()).time - 10) < .2, 'Backward lyric selection seeks the actual audio');
    await requireLine('海岸·10秒歌词', 'Backward seeking restores the earlier current line');
    await requireColors('backward seek lyric colors');
    assert.equal(await lyricView().locator('.lyric-line').filter({ hasText: '海岸·50秒歌词' }).evaluate(row => getComputedStyle(row).color), 'rgb(255, 255, 255)', 'A previously played future row returns to white after seeking backward');
    report.checks.push('backward seeking restores white future lyrics and colored past lyrics');
    await lyricView().locator('.lyric-line').filter({ has: page.locator('.lyric-text', { hasText: /^海岸·50秒歌词$/ }) }).click();
    await requireLine('海岸·50秒歌词', 'Return to the paused 50 second position');

    await page.setViewportSize({ width: 375, height: 812 });
    await showSettings(); await fontRange().focus(); await fontRange().press('End');
    assert.equal(await fontSize(), 60, 'Current font growth stops at the advertised upper bound');
    await returnToLyrics();
    await requireLine('海岸·50秒歌词', 'Maximum font size keeps the current line visible');
    const narrow = await page.evaluate(() => {
      const shell = document.querySelector('.lyrics-shell'), view = document.querySelector('.lyrics-view');
      const box = view.getBoundingClientRect();
      return { width: innerWidth, shellWidth: shell.clientWidth, shellScroll: shell.scrollWidth, viewWidth: view.clientWidth, viewScroll: view.scrollWidth,
        rowsInside: [...view.querySelectorAll('.lyric-line')].every(row => { const line = row.getBoundingClientRect(); return line.left >= box.left - 1 && line.right <= box.right + 1; }) };
    });
    assert.equal(narrow.width, 375); assert.ok(narrow.shellScroll <= narrow.shellWidth + 1 && narrow.viewScroll <= narrow.viewWidth + 1 && narrow.rowsInside, '375px screens contain maximum-size lyrics without horizontal overflow');
    report.fonts.push({ step: '375px-maximum', chosenSize: await fontSize(), ...narrow });
    await capture('03a-375px-maximum-font');
    await setFont(chosenSize); await returnToLyrics();
    await page.setViewportSize({ width: 414, height: 896 });
    report.checks.push('maximum lyric font wraps within a 375px screen');

    await closeLyrics();
    // A progress tap is a real production seek; no composable state is accessed.
    await seekCoverTo(37.5);
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
    assert.equal(await lyricView().locator('.lyric-line').filter({ hasText: '海岸·30秒歌词' }).evaluate(row => parseFloat(getComputedStyle(row).fontSize)), beforeOrdinary, 'Natural playback restores the completed line to the ordinary font');
    assert.equal((await styles()).current.fontSize, chosenSize);
    report.checks.push('real playback enlarges the next current line immediately and restores the completed line to the ordinary font');
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

    // A real HTTP lyric response supplies a phrase substantially taller than the
    // phone. Verify actual first/last glyph visibility rather than a text-only DOM check.
    const longPhrase = '超长歌词起点' + '我们把今天的故事留给漫长的海岸线再一起穿过灯火通明的城市直到下一次日出把没有说完的话慢慢说给彼此听'.repeat(10) + '完整歌词终点';
    await setFont(60);
    await app.evaluate((_electron, text) => {
      global.__wuuMobileFixture.lyrics[0] = `[00:00.00]开场\n[00:30.00]${text}\n[01:10.00]下一段歌词`;
    }, longPhrase);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await cover().waitFor({ state: 'visible' });
    await waitUntil(async () => { const media = await audio(); return media.readyState >= 1 && Math.abs(media.time - 35) < .2; }, 'Long lyric scene restores the real audio position');
    await cover().locator('.play-btn').click();
    await waitUntil(async () => { const media = await audio(); return !media.paused && media.readyState >= 2; }, 'The long lyric reading scene begins genuine buffered playback');
    await openLyrics();
    await waitUntil(async () => (await currentLine().textContent()).trim() === longPhrase, 'The current long phrase is not shortened');
    assert.equal(await page.locator('.lyric-credits').count(), 0, 'A song without author credits has no invented footer');
    const longGeometry = () => lyricView().evaluate(element => {
      const text = [...element.querySelectorAll('.lyric-text')].find(node => node.textContent.startsWith('超长歌词起点'));
      const node = text.firstChild, box = element.getBoundingClientRect();
      const endpoint = (start, end) => {
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
        const rect = range.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom };
      };
      return { text: text.textContent, start: endpoint(0, 6), end: endpoint(node.length - 6, node.length),
        top: box.top, bottom: box.bottom, height: box.height, scrollTop: element.scrollTop,
        phraseHeight: text.getBoundingClientRect().height, horizontalOverflow: element.scrollWidth > element.clientWidth + 1 };
    });
    await waitUntil(async () => { const box = await longGeometry(); return box.start.top >= box.top - 1 && box.start.bottom <= box.bottom + 1; }, 'A tall current phrase initially shows its opening words');
    const beginning = await longGeometry();
    assert.ok(beginning.phraseHeight > beginning.height, 'The fixture is genuinely taller than the viewport');
    assert.equal(beginning.text, longPhrase); assert.equal(beginning.horizontalOverflow, false);
    await capture('06-long-lyric-start');
    const box = await lyricView().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, beginning.end.top - beginning.top - 40);
    await waitUntil(async () => { const box = await longGeometry(); return box.end.top >= box.top - 1 && box.end.bottom <= box.bottom + 1; }, 'Native scrolling can reveal the final words of the complete phrase');
    // Observe after Chromium has applied the wheel movement, so the protection
    // assertion compares stable manual reading rather than native scroll easing.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const view = document.querySelector('.lyrics-view'), started = performance.now();
      let previous = view.scrollTop, stable = 0;
      const check = () => {
        const position = view.scrollTop;
        stable = Math.abs(position - previous) < .5 ? stable + 1 : 0;
        previous = position;
        if (stable >= 4) return resolve();
        if (performance.now() - started > 1500) return reject(new Error('Native manual scrolling did not settle'));
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    const ending = await longGeometry();
    await capture('07-long-lyric-end');
    const probe = await page.evaluate(() => new Promise(resolve => {
      const view = document.querySelector('.lyrics-view'), audio = document.querySelector('audio');
      const time = audio.currentTime, scrollTop = view.scrollTop, started = performance.now(), samples = [];
      const measure = () => {
        samples.push({ time: audio.currentTime, scrollTop: view.scrollTop });
        if (audio.currentTime >= time + 1 || performance.now() - started >= 4000) return resolve({ time, scrollTop, samples });
        requestAnimationFrame(measure);
      };
      requestAnimationFrame(measure);
    }));
    report.longLyrics = { characters: longPhrase.length, beginning, ending, manualPlayback: probe };
    assert.ok(probe.samples.at(-1).time - probe.time >= .8, 'The manual reading check runs during genuine playback');
    assert.ok(probe.samples.every(sample => Math.abs(sample.scrollTop - probe.scrollTop) < 2), 'Live lyric frames do not pull manual reading back to the current phrase beginning');
    report.checks.push('complete long lyrics expose both ends and preserve manual scrolling during real playback');

    // Word fill and phrase duration can finish before the next lyric. Both
    // timestamp companions must keep focus through that silent gap.
    await app.evaluate(() => {
      global.__wuuMobileFixture.lyrics[0] = '[30000,3000]<0,200,0>RAW原文持续音\n[30000,5000]<0,200,0>RAW译文延后结束\n[34000,3000]<0,1000,0> <1000,1000,0>\n[50000,2000]<0,200,0>RAW下一句';
    });
    await page.setViewportSize({ width: 414, height: 896 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await cover().waitFor({ state: 'visible' });
    await waitUntil(async () => { const media = await audio(); return media.readyState >= 1 && Math.abs(media.time - 35) < .2; }, 'RAW scene restores the paused position');
    await seekCoverTo(34);
    await waitUntil(async () => Math.abs((await audio()).time - 34) < .2, 'The production progress control seeks inside the RAW group');
    await cover().locator('.play-btn').click();
    await waitUntil(async () => { const media = await audio(); return !media.paused && media.readyState >= 2; }, 'The RAW scene begins genuine buffered playback');
    await openLyrics();
    await waitUntil(async () => await lyricView().locator('.lyric-line.cur').count() === 2, 'Both RAW timestamp companions remain current through the silent gap');
    report.rawBoundaryFrames = await page.evaluate(() => new Promise((resolve, reject) => {
      const frames = [], started = performance.now();
      const sample = () => {
        const audio = document.querySelector('audio');
        const current = document.querySelectorAll('.lyrics-view .lyric-line.cur').length;
        frames.push({ time: audio.currentTime, current });
        if (audio.currentTime >= 35.2) return resolve(frames);
        if (performance.now() - started > 10000) return reject(new Error('Native RAW playback did not reach the silent gap'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    assert.ok(report.rawBoundaryFrames.some(frame => frame.time < 35 && frame.current === 2));
    assert.ok(report.rawBoundaryFrames.some(frame => frame.time >= 35));
    assert.ok(report.rawBoundaryFrames.every(frame => frame.current === 2), 'Completing RAW duration never leaves the gap without a current group');
    const rawRows = await lyricView().locator('.lyric-line').evaluateAll(rows => rows.map(row => ({ state: row.className, size: parseFloat(getComputedStyle(row).fontSize), color: getComputedStyle(row).color,
      words: [...row.querySelectorAll('.char')].map(char => getComputedStyle(char).color) })));
    assert.ok(rawRows.slice(0, 2).every(row => row.state.includes('cur') && row.size === 60 && row.words.length && row.words.every(color => color !== 'rgb(255, 255, 255)')), 'The fully sung RAW companions stay enlarged and colored throughout the gap');
    assert.ok(rawRows[2].state.includes('unsung') && rawRows[2].size === beforeOrdinary && rawRows[2].color === 'rgb(255, 255, 255)');
    await capture('08-raw-gap-current-font');
    await closeLyrics(); if (!(await audio()).paused) await cover().locator('.play-btn').click();
    await seekCoverTo(48.5);
    await waitUntil(async () => Math.abs((await audio()).time - 48.5) < .2, 'The production progress control seeks before the next RAW group');
    await cover().locator('.play-btn').click(); await openLyrics();
    report.rawNextFrames = await page.evaluate(() => new Promise((resolve, reject) => {
      const frames = [], started = performance.now();
      const sample = () => {
        const audio = document.querySelector('audio');
        const current = [...document.querySelectorAll('.lyrics-view .lyric-line.cur .lyric-text')].map(text => text.textContent.trim());
        frames.push({ time: audio.currentTime, current });
        if (audio.currentTime >= 50.2) return resolve(frames);
        if (performance.now() - started > 10000) return reject(new Error('Native RAW playback did not reach the next timestamp'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    assert.ok(report.rawNextFrames.some(frame => frame.time < 50 && frame.current.length === 2), 'The previous RAW group keeps focus right up to the next timestamp');
    const rawNext = report.rawNextFrames.find(frame => frame.time >= 50 && frame.current.length === 1 && frame.current[0] === 'RAW下一句');
    assert.ok(rawNext && rawNext.time - 50 < .12, 'The next RAW group takes focus within a few native media frames');
    const afterNext = await lyricView().locator('.lyric-line').evaluateAll(rows => rows.map(row => ({ state: row.className, size: parseFloat(getComputedStyle(row).fontSize) })));
    assert.ok(afterNext.slice(0, 2).every(row => row.state.includes('sung') && row.size === beforeOrdinary), 'Only the next timestamp returns the previous companions to the ordinary size');
    assert.ok(afterNext[2].state.includes('cur') && afterNext[2].size === 60);
    await capture('09-raw-next-group-current-font');
    await closeLyrics(); if (!(await audio()).paused) await cover().locator('.play-btn').click(); await openLyrics();
    await lyricView().locator('.lyric-line').first().click();
    await waitUntil(async () => Math.abs((await audio()).time - 30) < .2 && await lyricView().locator('.lyric-line.cur').count() === 2, 'Paused backward RAW seeking restores both current companion lines');
    assert.ok((await lyricView().locator('.lyric-line.cur').evaluateAll(rows => rows.map(row => parseFloat(getComputedStyle(row).fontSize)))).every(size => size === 60));
    const rewoundWords = await lyricView().locator('.lyric-line.cur .char').evaluateAll(words => words.map(word => getComputedStyle(word).color));
    assert.ok(rewoundWords.length && rewoundWords.every(color => color === 'rgb(255, 255, 255)'), 'Backward RAW seeking also restores unsung word fill');
    await capture('10-raw-seek-restores-current-font');
    report.checks.push('RAW companions retain enlarged colored focus through silent gaps, shrink only when the next timestamp starts and restore white fill on backward seek');

    // Observe the native ended event without suppressing normal automatic next
    // song behavior. The final group still owns focus until the song changes.
    await closeLyrics(); await seekCoverTo(88.5);
    await waitUntil(async () => Math.abs((await audio()).time - 88.5) < .2, 'The production progress control seeks near the actual track end');
    await openLyrics(); await requireLine('RAW下一句', 'The final RAW group keeps focus after its word and phrase duration');
    assert.equal((await styles()).current.fontSize, 60);
    await capture('11-final-lyric-before-track-end');
    await page.evaluate(() => {
      window.__mobileEndedFocus = null;
      const audio = document.querySelector('audio');
      audio.addEventListener('ended', () => {
        const rows = [...document.querySelectorAll('.lyrics-view .lyric-line.cur')];
        window.__mobileEndedFocus = { time: audio.currentTime, duration: audio.duration,
          source: audio.currentSrc, current: rows.map(row => ({ text: row.textContent.trim(), size: parseFloat(getComputedStyle(row).fontSize),
            words: [...row.querySelectorAll('.char')].map(word => getComputedStyle(word).color) })) };
      }, { once: true });
    });
    await closeLyrics(); await cover().locator('.play-btn').click(); await openLyrics();
    await waitUntil(() => page.evaluate(() => !!window.__mobileEndedFocus), 'Native audio reaches the actual track end');
    report.finalFocus = await page.evaluate(() => window.__mobileEndedFocus);
    assert.ok(Math.abs(report.finalFocus.time - report.finalFocus.duration) < .02);
    assert.ok(report.finalFocus.source.endsWith('/api/stream/0'));
    assert.equal(report.finalFocus.current.length, 1);
    assert.equal(report.finalFocus.current[0].text, 'RAW下一句');
    assert.equal(report.finalFocus.current[0].size, 60);
    assert.ok(report.finalFocus.current[0].words.length && report.finalFocus.current[0].words.every(color => color !== 'rgb(255, 255, 255)'));
    report.checks.push('the final fully sung lyric stays enlarged through native track end until automatic song change');

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
