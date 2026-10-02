// Native startup regression against the built production renderer and preload.
// Run after npm run build:desktop: node scripts/startup-desktop.cjs
// All media, deferred IPC, preferences, profiles and artifacts are isolated.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'startup');
fs.mkdirSync(artifacts, { recursive: true });
const runId = `${Date.now()}-${process.pid}`;
const report = { ok: false, runId, checks: [], screenshots: [], media: [], fixture: null, errors: [], consoleErrors: [], stderr: [] };
const copyFixture = app => app.evaluate(() => ({ state: global.__wuuStartup.state, events: global.__wuuStartup.events,
  writeAttempts: global.__wuuStartup.writeAttempts, writes: global.__wuuStartup.writes, deleted: global.__wuuStartup.deleted, data: global.__wuuStartup.data }));

async function setInput(locator, value) {
  await locator.evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function waitForMain(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    // Poll a specific condition; never wait out startup or a deferred fixture.
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(label);
}

(async () => {
  let app, page;
  try {
    assert.ok(fs.existsSync(path.join(root, 'desktop_UI', 'dist', 'index.html')), 'Build the production desktop renderer first');
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'startup-smoke-main.cjs')], cwd: root,
      env: { ...process.env, WUU_REVIEW_PROFILE: `startup-${runId}`, WUU_RENDERER_URL: '' }, timeout: 30000 });
    app.process().stderr?.on('data', value => { if (report.stderr.join('').length < 20000) report.stderr.push(value.toString()); });
    await app.firstWindow();
    await waitForMain(async () => {
      page = app.windows().find(window => window.url().includes('/desktop_UI/dist/index.html') && !window.url().includes('window=lyrics'));
      return !!page;
    }, 'The production main window must open independently of restored desktop lyrics');
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.waitForURL('**/desktop_UI/dist/index.html*');
    report.renderer = { url: page.url(), bundle: await page.locator('script[type="module"]').getAttribute('src') };
    assert.ok(report.renderer.url.includes('/desktop_UI/dist/index.html'), 'The initial document uses the production bundle');
    assert.ok(!report.renderer.url.includes('window=lyrics'), 'Startup controls belong to the main window');
    await app.evaluate(({ BrowserWindow }) => {
      global.__wuuStartupCrashes = [];
      BrowserWindow.getAllWindows().forEach(window => window.webContents.on('render-process-gone', (_event, details) => global.__wuuStartupCrashes.push(details)));
    });
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.waitFor();
    const tracks = await app.evaluate(() => global.__wuuStartup.originals);
    const [first, second, third] = tracks;
    const go = async (name, target) => {
      await nav.getByRole('button', { name, exact: true }).click();
      await page.locator(`.page-host[data-page="${target}"]`).waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
      assert.equal(await page.locator('.main-content > .loading-state').count(), 0, 'Startup loading cannot replace the active page');
    };
    const capture = async name => {
      const file = path.join(artifacts, `${runId}-${name}.png`);
      await page.screenshot({ path: file, scale: 'css' }); report.screenshots.push(file);
    };
    await go('音乐列表', 'library');
    const rows = page.locator('.library-page .song-row');
    await rows.filter({ has: page.getByText(first.songName, { exact: true }) }).waitFor();
    assert.equal(await rows.count(), 3, 'Basic songs appear while metadata and preferences remain deferred');
    assert.equal(await page.getByRole('heading', { name: '正在整理你的音乐', exact: true }).count(), 0);
    report.pendingStartup = await copyFixture(app);
    assert.deepEqual(report.pendingStartup.state, { metadataStarted: true, metadataReleased: false, userDataReleased: false });
    assert.equal(report.pendingStartup.events[0].name, 'startup-gates-installed');
    assert.equal(report.pendingStartup.events[0].windows, 0, 'Handlers are installed before creating any renderer window');
    assert.ok(report.pendingStartup.events.some(event => event.name === 'songs-returned' && event.metadataReleased === false));
    assert.equal(report.pendingStartup.writeAttempts.length, 0);
    assert.equal(report.pendingStartup.writes.length, 0);
    await page.evaluate(() => {
      // Audio-only playback uses the production video element without adding
      // it to the DOM. Observe its first real play call before opening the gate
      // or clicking Play; keep the exact receiver, arguments and native Promise.
      window.__startupMediaEvents = [];
      const originalPlay = HTMLMediaElement.prototype.play;
      const observed = new WeakSet();
      HTMLMediaElement.prototype.play = function (...args) {
        if (this.id === 'react-media-player') {
          window.__startupMedia = this;
          if (!observed.has(this)) {
            observed.add(this);
            const media = this;
            ['loadstart', 'emptied', 'playing', 'pause', 'ended', 'seeking'].forEach(type => media.addEventListener(type, () => {
              window.__startupMediaEvents.push({ type, time: media.currentTime, src: media.currentSrc, at: performance.now() });
            }));
          }
        }
        return Reflect.apply(originalPlay, this, args);
      };
      window.__startupMetadata = [];
      window.__startupUnsubscribe = window.musicAPI.onSongMetadataUpdate(patch => window.__startupMetadata.push(patch));
    });
    await rows.filter({ has: page.getByText(first.songName, { exact: true }) }).locator('.song-main').click();
    await page.waitForFunction(() => {
      const media = window.__startupMedia;
      return media && !media.paused && media.readyState >= 2 && media.currentTime > .2;
    });
    const media = () => page.evaluate(() => {
      const element = window.__startupMedia;
      if (!(element instanceof HTMLMediaElement) || element.id !== 'react-media-player') throw new Error('The production media instance was not captured');
      return { time: element.currentTime, src: element.currentSrc, paused: element.paused, readyState: element.readyState,
        title: document.querySelector('.player-bar .song-meta strong')?.textContent, events: window.__startupMediaEvents.slice() };
    });
    const early = await media(); report.media.push({ label: 'play-before-preferences-or-genres', ...early });
    assert.equal(early.title, first.songName);
    await go('设置', 'settings');
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    const opacity = page.locator('.settings-page').getByRole('slider', { name: '界面透明度', exact: true });
    await setInput(opacity, 86);
    await setInput(page.getByRole('slider', { name: '音量', exact: true }), .83);
    await go('正在播放', 'player');
    const comment = page.locator('#song-comment-popover'), genres = page.locator('#song-genre-menu');
    const openGenres = async () => {
      await page.locator('.player-actions').getByRole('button', { name: '评论', exact: true }).click();
      await comment.waitFor(); await comment.locator('.song-submenu-entry').click(); await genres.waitFor();
    };
    const closeGenres = async () => { await page.keyboard.press('Escape'); await comment.waitFor({ state: 'hidden' }); };
    const earlyGenre = '开机期间手动标注';
    await openGenres();
    await genres.locator('#new-song-genre').fill(earlyGenre); await genres.getByRole('button', { name: '添加', exact: true }).click();
    await genres.getByRole('button', { name: '保存标注', exact: true }).click(); await comment.waitFor({ state: 'hidden' });
    await go('音乐列表', 'library');
    await rows.filter({ has: page.getByText(third.songName, { exact: true }) }).getByRole('button', { name: `更多 ${third.songName} 操作`, exact: true }).click();
    await page.getByRole('menu', { name: `${third.songName} 的操作`, exact: true }).getByRole('menuitem', { name: '不推荐这首歌', exact: true }).click();
    await go('不推荐管理', 'management');
    const deletedRow = page.locator('.management-page .row').filter({ has: page.getByText(third.songName, { exact: true }) });
    await deletedRow.getByRole('button', { name: '彻底删除', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '从磁盘彻底删除', exact: true });
    await confirm.waitFor(); await confirm.getByRole('button', { name: '彻底删除', exact: true }).click(); await confirm.waitFor({ state: 'hidden' });
    await waitForMain(() => app.evaluate((_electron, songPath) => global.__wuuStartup.deleted.includes(songPath), third.audioPath), 'The fixture records the actual UI deletion');
    await go('音乐列表', 'library');
    await page.waitForFunction(() => document.querySelectorAll('.library-page .song-row').length === 2);
    await page.waitForFunction(time => window.__startupMedia.currentTime > time + 1, early.time);
    const beforePreferences = await media(); report.media.push({ label: 'navigation-and-edits-with-gates-pending', ...beforePreferences });
    assert.ok(!beforePreferences.paused && beforePreferences.src === early.src && beforePreferences.time > early.time + 1);
    const pending = await copyFixture(app);
    assert.equal(pending.writeAttempts.length, 0, 'The renderer must not even attempt to persist before reading stored user data');
    assert.equal(pending.writes.length, 0, 'Editing/playing during delayed user data must not write an empty/default snapshot');
    assert.equal(pending.state.userDataReleased, false); assert.equal(pending.state.metadataReleased, false);
    await capture('nonblocking-before-userdata');
    report.checks.push('First-launch songs, navigation, genuine playback, settings, manual genre and removal remain usable while genre and user data promises are unresolved; no unread preferences are overwritten');

    await app.evaluate(() => global.__wuuStartup.releaseUserData());
    await waitForMain(() => app.evaluate(() => global.__wuuStartup.events.some(event => event.name === 'userdata-returned')), 'The original preferences return');
    await go('我的歌单', 'library');
    await page.getByText('开机前保留的歌单', { exact: true }).waitFor();
    await go('设置', 'settings'); await page.getByRole('tab', { name: '外观', exact: true }).click();
    assert.equal(Number(await opacity.inputValue()), 86, 'Late saved settings do not replace an early opacity edit');
    assert.equal(Number(await page.getByRole('slider', { name: '音量', exact: true }).inputValue()), .83);
    await go('正在播放', 'player'); await openGenres();
    assert.ok(await genres.getByRole('checkbox', { name: earlyGenre, exact: true }).isChecked()); await closeGenres();
    const afterPreferences = await media(); report.media.push({ label: 'late-preferences-preserve-user-playback', ...afterPreferences });
    assert.equal(afterPreferences.src, early.src); assert.equal(afterPreferences.title, first.songName);
    assert.ok(!afterPreferences.paused && afterPreferences.time >= beforePreferences.time, 'Late lastSession cannot reopen the previously saved second song');
    await waitForMain(() => app.evaluate((_electron, { firstPath, thirdPath, secondPath, earlyGenre }) => {
      const data = global.__wuuStartup.data;
      return global.__wuuStartup.writes.length > 0 && data.settings.volume === .83 && data.settings.glassOpacity === .86
        && data.genreOverrides[firstPath]?.includes(earlyGenre) && data.genreOverrides[secondPath]?.includes('预存民谣')
        && !Object.hasOwn(data.genreOverrides, thirdPath) && data.collections.find(item => item.id === 'startup-existing')?.songs.includes(firstPath)
        && !data.collections.some(item => item.songs.includes(thirdPath));
    }, { firstPath: first.audioPath, thirdPath: third.audioPath, secondPath: second.audioPath, earlyGenre }), 'Hydration preserves existing preferences and saves only merged early changes');
    const hydrated = await copyFixture(app); report.hydrated = hydrated;
    assert.deepEqual(hydrated.data.startupSentinel, { value: 'keep-existing-unknown-fields' });
    assert.equal(hydrated.data.settings.lyricSize, 17); assert.equal(hydrated.data.settings.currentLyricSize, 30);
    assert.ok(hydrated.writes.every(write => write.at >= hydrated.events.find(event => event.name === 'userdata-released').at));
    assert.ok(hydrated.writeAttempts.every(attempt => attempt.userDataReleased), 'Every asynchronous or synchronous persistence attempt follows hydration');
    assert.ok(hydrated.writes.every(write => write.data.collections.some(item => item.id === 'startup-existing')), 'Every written snapshot preserves the preexisting collection');
    report.checks.push('Late hydration retains old collections, unknown fields and untouched settings, merges early changes/deletion, and cannot override an already selected playing song with lastSession');

    const beforeMetadata = await media();
    await app.evaluate(() => global.__wuuStartup.releaseMetadata());
    await page.waitForFunction(() => window.__startupMetadata.length === 3);
    await page.waitForFunction(time => window.__startupMedia.currentTime > time + .6, beforeMetadata.time);
    const afterMetadata = await media(); report.media.push({ label: 'late-metadata-continuity', before: beforeMetadata, after: afterMetadata });
    assert.equal(afterMetadata.src, beforeMetadata.src); assert.equal(afterMetadata.title, first.songName);
    assert.ok(!afterMetadata.paused && afterMetadata.time > beforeMetadata.time + .6);
    for (const type of ['loadstart', 'emptied', 'playing', 'pause', 'seeking']) {
      assert.equal(afterMetadata.events.filter(event => event.type === type).length, beforeMetadata.events.filter(event => event.type === type).length, `Genre metadata cannot cause a new native media ${type} event`);
    }
    await openGenres();
    assert.ok(await genres.getByRole('checkbox', { name: earlyGenre, exact: true }).isChecked(), 'Manual genre wins over the late embedded genre');
    assert.equal(await genres.getByRole('checkbox', { name: '电子', exact: true }).isChecked(), false);
    await genres.getByRole('button', { name: '恢复音频标签', exact: true }).click(); await comment.waitFor({ state: 'hidden' });
    await openGenres();
    assert.ok(await genres.getByRole('checkbox', { name: '电子', exact: true }).isChecked(), 'Restoring tags reads the incrementally updated current song');
    const previousGenre = genres.getByRole('checkbox', { name: earlyGenre, exact: true });
    assert.ok(await previousGenre.count() === 0 || !(await previousGenre.isChecked()), 'Restoring tags removes the previous manual selection');
    await closeGenres();
    await go('音乐列表', 'library');
    assert.equal(await rows.count(), 2); assert.equal(await rows.filter({ has: page.getByText(third.songName, { exact: true }) }).count(), 0);
    const received = await page.evaluate(() => window.__startupMetadata);
    assert.ok(received.some(patch => patch.audioPath === third.audioPath), 'A genuine late patch was sent for the deleted song');
    await capture('metadata-arrives-with-playback-continuing');
    report.metadata = received;
    report.checks.push('Deferred embedded genre arrives through the production preload event without reopening/seeking/pausing audio; manual labels stay authoritative, restore uses new tags, and deleted songs cannot return from late patches');
    report.fixture = await copyFixture(app);
    report.crashes = await app.evaluate(() => global.__wuuStartupCrashes);
    assert.deepEqual(report.crashes, []); assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error); process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(artifacts, `${runId}-failure.png`), scale: 'css' }).catch(() => {});
    if (app) report.fixture = await copyFixture(app).catch(() => null);
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ ok: report.ok, checks: report.checks, report: path.join(artifacts, 'report.json'), error: report.error }, null, 2) + '\n');
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  }
})();
