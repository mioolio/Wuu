// Real production renderer/media regression; run after the desktop build.
// node scripts/previous-desktop.cjs
// Uses only public player controls and the isolated three-song smoke fixture.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'previous');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], heard: [], reverse: [], forward: [], media: [], screenshots: [], rendererErrors: [], rendererCrashes: [] };
const normalize = value => value.replace(/\\/g, '/');

(async () => {
  let app, page;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'smoke-main.cjs')], cwd: root,
      env: { ...process.env, WUU_RENDERER_URL: process.env.WUU_PREVIOUS_RENDERER || '', WUU_SMOKE_PACKAGED: '0', WUU_VISUAL_FIXTURE: '',
        WUU_PLAYER_POLISH_FIXTURE: '1', WUU_COVER_STARTUP: '', WUU_REVIEW_PROFILE: 'previous-regression' }, timeout: 30000 });
    report.electronStderr = [];
    app.process().stderr?.on('data', data => { if (report.electronStderr.join('').length < 20000) report.electronStderr.push(String(data)); });
    await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      global.__previousRendererCrashes = [];
      for (const window of BrowserWindow.getAllWindows()) window.webContents.on('render-process-gone', (_event, details) => global.__previousRendererCrashes.push(details));
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'A genuine main renderer opens');
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    report.rendererBundle = await page.locator('script[type="module"]').getAttribute('src');
    const tracks = await app.evaluate(() => global.__wuuSmoke.songs.map(song => ({ name: song.songName, path: song.audioPath })));
    assert.equal(tracks.length, 3);
    tracks.forEach(track => { track.path = normalize(track.path); });
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.waitFor();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    // Audio songs use the production video element without mounting it in the
    // document. Observe its genuine play call instead of querying a DOM node.
    await page.evaluate(() => {
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        if (this.id === 'react-media-player') window.__previousMedia = this;
        return Reflect.apply(originalPlay, this, args);
      };
    });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => window.__previousMedia instanceof HTMLMediaElement && !window.__previousMedia.paused);
    await nav.getByRole('button', { name: '正在播放', exact: true }).click();
    await page.locator('.player-page .record-info h1').waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

    const sample = () => page.evaluate(() => {
      const media = window.__previousMedia;
      let path = '';
      try { path = decodeURIComponent(new URL(media.currentSrc || media.src).pathname).replace(/^\/(?=[a-z]:)/i, '').replace(/\\/g, '/'); } catch {}
      return { path, title: document.querySelector('.player-page .record-info h1')?.textContent, paused: media.paused,
        time: media.currentTime, readyState: media.readyState, source: media.currentSrc, duration: media.duration };
    });
    const waitMedia = async (expected, previous) => {
      await page.waitForFunction(({ expected, previous }) => {
        const media = window.__previousMedia;
        if (!media || media.paused || media.readyState < 3 || !media.currentSrc) return false;
        const normalize = url => decodeURIComponent(new URL(url).pathname).replace(/^\/(?=[a-z]:)/i, '').replace(/\\/g, '/');
        const path = normalize(media.currentSrc);
        return path === normalize(media.src) && (!expected || path === expected) && (!previous || path !== previous);
      }, { expected, previous });
      const value = await sample();
      const track = tracks.find(track => track.path === value.path);
      assert.ok(track, 'The genuinely playing path belongs to the isolated media fixture');
      assert.equal(value.title, track.name, 'The visible title matches the actual decoded media source');
      return value;
    };
    const capture = async name => {
      const file = path.join(artifacts, `${name}.png`);
      await page.screenshot({ path: file, scale: 'css' }); report.screenshots.push(file);
    };
    const setMode = async name => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await page.getByRole('button', { name: `播放模式：${name}`, exact: true }).count()) return;
        await page.getByRole('button', { name: /^播放模式：/ }).click();
      }
      assert.ok(await page.getByRole('button', { name: `播放模式：${name}`, exact: true }).count(), 'The requested mode is selected through the real control');
    };

    await setMode('随机播放');
    const first = await waitMedia();
    report.heard.push(first.path); report.media.push({ label: 'random-start', ...first });
    // Seven transitions visit more than two complete rounds of three tracks.
    // In particular, previous at indices 3 and 6 must cross the new-round pos 0.
    for (let step = 0; step < 7; step++) {
      const previous = report.heard.at(-1);
      await page.getByRole('button', { name: '下一首', exact: true }).click();
      const value = await waitMedia(undefined, previous);
      report.heard.push(value.path); report.media.push({ label: `random-next-${step + 1}`, ...value });
    }
    assert.equal(new Set(report.heard).size, 3, 'Every real queue track is heard across the shuffle rounds');
    await capture('random-rounds-before-return');
    report.checks.push('seven real next operations cross multiple random rounds without immediately repeating the active song');

    await page.getByRole('button', { name: '暂停', exact: true }).click();
    assert.equal((await sample()).paused, true);
    for (let position = report.heard.length - 2; position >= 0; position--) {
      await page.getByRole('button', { name: '上一首', exact: true }).click();
      const value = await waitMedia(report.heard[position]);
      report.reverse.push(value.path); report.media.push({ label: `previous-history-${position}`, ...value });
    }
    assert.deepEqual(report.reverse, report.heard.slice(0, -1).reverse());
    await capture('random-history-reversed');
    report.checks.push('previous returns the actual heard paths in reverse, including both shuffle-round boundaries and a paused starting state');

    // No prior heard song exists here. An extra previous must preserve pause
    // and seek position instead of replaying the same track from a reset point.
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('slider', { name: '播放进度', exact: true }).evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '9');
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => Math.abs(window.__previousMedia.currentTime - 9) < .1);
    await page.getByRole('button', { name: '上一首', exact: true }).click();
    const boundary = await sample(); report.media.push({ label: 'history-start-boundary', ...boundary });
    assert.equal(boundary.path, report.heard[0]); assert.equal(boundary.paused, true); assert.ok(Math.abs(boundary.time - 9) < .1);
    report.checks.push('the start of random playback history preserves the selected song, pause, and position');

    for (let position = 1; position < report.heard.length; position++) {
      await page.getByRole('button', { name: '下一首', exact: true }).click();
      const value = await waitMedia(report.heard[position]); report.forward.push(value.path);
    }
    assert.deepEqual(report.forward, report.heard.slice(1));
    report.checks.push('next after returning follows the already-heard forward path before creating any new random choice');

    await setMode('列表循环');
    await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
    await page.locator('.player-queue .queue-song').filter({ has: page.getByText(tracks[0].name, { exact: true }) }).click();
    await page.getByRole('button', { name: '关闭播放队列', exact: true }).click();
    await waitMedia(tracks[0].path);
    await page.getByRole('button', { name: '上一首', exact: true }).click();
    const tail = await waitMedia(tracks.at(-1).path); report.media.push({ label: 'list-first-to-last', ...tail });
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    const head = await waitMedia(tracks[0].path); report.media.push({ label: 'list-last-to-first', ...head });
    await capture('sequential-first-and-last');
    report.checks.push('list previous wraps from the first queue song to the last, and next returns to the first');
    report.rendererCrashes = await app.evaluate(() => global.__previousRendererCrashes);
    assert.deepEqual(report.rendererErrors, []); assert.deepEqual(report.rendererCrashes, []);
    report.ok = true;
    console.log(JSON.stringify({ ok: true, checks: report.checks, heard: report.heard, report: path.join(artifacts, 'report.json') }, null, 2));
  } catch (error) {
    report.error = error.stack || String(error);
    if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) report.rendererCrashes = await app.evaluate(() => global.__previousRendererCrashes || []).catch(() => report.rendererCrashes);
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
