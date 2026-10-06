// Real production Vue/theme/media at phone sizes. Run after the mobile build.
// Controlled HTTP data supplies playlists and a delayed startup snapshot; this
// suite deliberately does not imitate or claim desktop WebSocket participation.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'mobile-appearance');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok: false, checks: [], contrast: [], layouts: [], themes: [], screenshots: [], errors: [] };
async function waitUntil(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail(message);
}
const luminance = color => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrastRatio = (text, background) => { const values = [luminance(text), luminance(background)].sort((a,b) => a-b); return (values[1]+.05)/(values[0]+.05); };

(async () => {
  let app, page, releaseStartup, releaseLike, releaseCollection;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'mobile-smoke-main.cjs')], cwd: root, timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const fixture = await app.evaluate(() => ({ origin: global.__wuuMobileFixture.origin, songs: global.__wuuMobileFixture.songs }));
    await page.waitForURL(fixture.origin + '/index.html');
    const collections = [
      { id: 'mobile-liked', name: '我喜欢', songs: [fixture.songs[0]], songCount: 1 },
      { id: 'walking', name: '散步与很长的歌单名字仍然留在这个屏幕里', songs: [], songCount: 0 },
    ];
    let startupHeld = true, startupRequested = false, holdNextLike = false, heldLikeBody;
    let collectionFetchCount = 0, holdNextCollection = false;
    const startupGate = new Promise(resolve => { releaseStartup = resolve; });
    await page.route('**/api/state', async route => {
      if (!startupHeld) return route.continue();
      startupRequested = true;
      await startupGate;
      await route.fulfill({ json: { ok: true, state: { index: 2, songInfo: fixture.songs[2], currentTime: 70, duration: 90, playMode: 1, isPlaying: false, updatedAt: Date.now() } } });
    });
    await page.route('**/api/collections', async route => {
      collectionFetchCount++;
      if (holdNextCollection) {
        holdNextCollection = false;
        await new Promise(resolve => { releaseCollection = resolve; });
        // A stale fetch belongs to a closed opening and must not replace the
        // latest server list in the next opening.
        return route.fulfill({ json: { ok: true, collections: [{ id: 'stale', name: '迟到的旧歌单', songs: [], songCount: 0 }] } });
      }
      await route.fulfill({ json: { ok: true, collections } });
    });
    await page.route('**/api/collections/create', async route => {
      const { name } = route.request().postDataJSON();
      const collection = { id: 'created-' + collections.length, name, songs: [], songCount: 0 };
      collections.push(collection); await route.fulfill({ json: { ok: true, collection } });
    });
    await page.route('**/api/like-collection', async route => {
      const body = route.request().postDataJSON();
      if (holdNextLike) {
        holdNextLike = false; heldLikeBody = body;
        await new Promise(resolve => { releaseLike = resolve; });
      }
      const collection = collections.find(collection => collection.id === body.collectionId);
      collection.songs = body.add ? [...collection.songs.filter(song => song.id !== body.index), fixture.songs[body.index]] : collection.songs.filter(song => song.id !== body.index);
      collection.songCount = collection.songs.length;
      await route.fulfill({ json: { ok: true } });
    });
    await page.addInitScript(() => {
      window.__appearanceThemeFrames = [];
      const record = () => {
        const app = document.querySelector('.app');
        if (app?.getClientRects().length && window.__appearanceThemeFrames.length < 20) {
          window.__appearanceThemeFrames.push({ at: performance.now(), theme: document.documentElement.dataset.theme,
            preference: document.documentElement.dataset.themePreference, background: getComputedStyle(document.body).backgroundColor });
        }
        if (window.__appearanceThemeFrames.length < 20) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    const nav = page.locator('.bottom-nav');
    const tab = name => nav.getByRole('button', { name, exact: true });
    const player = page.locator('.player-view');
    const media = () => page.locator('audio').evaluate(audio => {
      window.__appearanceAudio ||= audio;
      return { source: audio.currentSrc || audio.src, time: audio.currentTime, paused: audio.paused, ready: audio.readyState, sameElement: window.__appearanceAudio === audio };
    });
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const capture = async name => { const file = path.join(artifacts, name + '.png'); await page.screenshot({ path: file }); report.screenshots.push(file); };
    const requireTheme = async (theme, preference) => {
      await page.waitForFunction(({ theme, preference }) => document.documentElement.dataset.theme === theme && document.documentElement.dataset.themePreference === preference, { theme, preference });
      // The data attribute can change before Chromium has applied the new
      // media-query style. Observe actual frames and the resulting surface.
      await frames();
      const expectedBackground = theme === 'dark' ? 'rgb(18, 26, 23)' : 'rgb(245, 247, 244)';
      await page.waitForFunction(expected => getComputedStyle(document.body).backgroundColor === expected, expectedBackground);
      const state = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, preference: document.documentElement.dataset.themePreference,
        saved: localStorage.getItem('wuu-mobile-theme'), body: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').content }));
      assert.equal(state.body, expectedBackground, 'The visible page surface matches its resolved theme');
      report.themes.push(state); return state;
    };
    const checkContrast = async (selectors, label) => {
      const values = await page.evaluate(selectors => {
        const parse = color => { const match = /rgba?\(([^)]+)\)/.exec(color); return match ? match[1].split(/[\s,\/]+/).filter(Boolean).map(Number) : null; };
        const visible = node => {
          if (!node.getClientRects().length) return false;
          // Closed details may retain descendant boxes and stale styles in
          // Chromium's skipped content. Only their first summary is exposed.
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(node)) return false;
          }
          return !node.checkVisibility || node.checkVisibility({ contentVisibilityAuto: true, checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
        };
        return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map(node => {
          let background;
          for (let parent = node; parent; parent = parent.parentElement) {
            const color = parse(getComputedStyle(parent).backgroundColor);
            if (color && (color[3] ?? 1) === 1) { background = color; break; }
          }
          return { selector, text: node.textContent.trim().slice(0, 70), color: parse(getComputedStyle(node).color), background };
        }));
      }, selectors);
      assert.ok(values.length > 0, label + ': visible text was measured');
      for (const value of values) {
        assert.ok(value.color && value.background, label + ': actual foreground and background resolve');
        value.ratio = contrastRatio(value.color, value.background);
        assert.ok(value.ratio >= 4.5, label + ': readable text contrast ≥4.5:1: ' + JSON.stringify(value));
      }
      report.contrast.push({ label, values });
    };
    const checkLayout = async label => {
      const result = await page.evaluate(() => {
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const navigation = document.querySelector('.bottom-nav'), mini = document.querySelector('.mini-player');
        const controls = [...navigation.querySelectorAll('button'), ...document.querySelectorAll('.mini-open,.mini-toggle')].map(node => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), ...box(node) }));
        const overflow = [...document.querySelectorAll('html,body,.app,.main,.song-list-view,.collections-view,.settings-page,.picker-sheet,.create-dialog')]
          .filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth+1).map(node => ({ className: node.className, client: node.clientWidth, scroll: node.scrollWidth }));
        return { width: innerWidth, height: innerHeight, navigation: box(navigation), mini: mini && box(mini), controls, overflow };
      });
      assert.deepEqual(result.overflow, [], label + ': no page or dialog has horizontal overflow');
      assert.ok(result.controls.every(control => control.width >= 43.9 && control.height >= 43.9 && control.left >= -1 && control.right <= result.width+1 && control.top >= -1 && control.bottom <= result.height+1), label + ': navigation and mini player provide visible 44px touch targets');
      if (result.mini) assert.ok(result.mini.bottom <= result.navigation.top+1, label + ': the mini player remains above the navigation');
      report.layouts.push({ label, ...result });
    };
    const openPicker = async () => { await player.locator('.like-btn').click(); await page.getByRole('dialog', { name: '添加到歌单', exact: true }).waitFor(); };
    const picker = () => page.getByRole('dialog', { name: '添加到歌单', exact: true });
    const walking = () => picker().locator('.collection-row').filter({ hasText: '散步与很长' });
    const checkAdvancedContrast = async label => {
      const advanced = page.locator('.lyric-advanced');
      const audio = page.locator('.audio-settings');
      const advancedWasOpen = await advanced.evaluate(node => node.open), audioWasOpen = await audio.evaluate(node => node.open);
      if (!advancedWasOpen) await advanced.locator('> summary').click();
      await page.getByRole('slider', { name: '普通歌词字号', exact: true }).waitFor({ state: 'visible' });
      await frames();
      await checkContrast(['.lyric-advanced .setting-name','.lyric-advanced .setting-desc','.lyric-advanced .lyric-size-value'], label + ' expanded ordinary lyric settings');
      if (!audioWasOpen) await audio.locator('> summary').click();
      await audio.getByRole('button', { name: '自定义', exact: true }).click();
      await page.locator('.fx-eq').waitFor(); await frames();
      await checkContrast(['.audio-fx-panel .group-title','.fx-chip','.fx-eq-label','.fx-eq-val','.fx-sub-title','.fx-slider-val','.tip'], label + ' expanded audio settings');
      if (!advancedWasOpen) await advanced.locator('> summary').click();
      if (!audioWasOpen) await audio.locator('> summary').click();
    };

    await nav.waitFor();
    await waitUntil(() => startupRequested, 'The real startup desktop snapshot request is deliberately pending');
    await page.getByRole('button', { name: '随机播放', exact: true }).click();
    await player.waitFor();
    await waitUntil(async () => { const audio = await media(); return audio.ready >= 2 && !audio.paused && audio.source.endsWith('/api/stream/0'); }, 'An early choice plays real buffered audio before desktop initialization finishes');
    const early = await media(); startupHeld = false;
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/state'));
    releaseStartup(); await (await lateResponse).json(); await frames();
    const afterStartup = await media();
    assert.ok(afterStartup.sameElement && afterStartup.source === early.source && !afterStartup.paused && afterStartup.time >= early.time-.1 && afterStartup.time < 20, 'A late desktop song/70-second snapshot cannot replace the user\'s early real playback');
    report.checks.push('early playback stays usable and a delayed desktop startup snapshot cannot overwrite the chosen song or position');

    await requireTheme('dark', 'system');
    await tab('设置').click();
    assert.equal(await page.getByRole('switch', { name: '与电脑一起听', exact: true }).isChecked(), false, 'Listening together requires explicit opt-in');
    assert.ok((await page.locator('.sync-status').textContent()).includes('各听各的'));
    assert.equal(await page.locator('.audio-settings').evaluate(node => node.open), false, 'Advanced audio settings begin folded');
    assert.equal(await page.locator('.lyric-advanced').evaluate(node => node.open), false, 'Ordinary lyric size stays under its advanced disclosure');
    await page.getByRole('slider', { name: '当前歌词字号', exact: true }).waitFor({ state: 'visible' });
    const beforeTheme = await media();
    await page.emulateMedia({ colorScheme: 'light' }); await requireTheme('light', 'system');
    await checkContrast(['.settings-title','.setting-name','.setting-desc','.sync-status','.group-title'], 'system light settings');
    await checkAdvancedContrast('system light');
    await tab('音乐库').click(); await checkContrast(['.song-list-view .song-name','.song-list-view .song-artist','.song-list-view .subtitle'], 'system light library');
    await capture('01-light-library');
    await page.emulateMedia({ colorScheme: 'dark' }); await requireTheme('dark', 'system');
    await checkContrast(['.song-list-view .song-name','.song-list-view .song-artist','.song-list-view .subtitle'], 'system dark library');
    const afterTheme = await media();
    assert.ok(afterTheme.sameElement && afterTheme.source === beforeTheme.source && !afterTheme.paused && afterTheme.time >= beforeTheme.time, 'Live system theme changes retain the real playing audio');
    await tab('设置').click();
    await checkContrast(['.settings-title','.setting-name','.setting-desc','.sync-status','.group-title'], 'system dark settings');
    await checkAdvancedContrast('system dark');
    const theme = page.getByRole('combobox', { name: '手机配色', exact: true });
    await theme.selectOption('dark'); await requireTheme('dark', 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await requireTheme('dark', 'dark');
    await page.reload({ waitUntil: 'domcontentloaded' }); await nav.waitFor(); await requireTheme('dark', 'dark');
    await page.waitForFunction(() => window.__appearanceThemeFrames.length >= 3);
    const firstThemeFrames = await page.evaluate(() => window.__appearanceThemeFrames);
    assert.ok(firstThemeFrames.every(frame => frame.theme === 'dark' && frame.preference === 'dark' && frame.background === 'rgb(18, 26, 23)'), 'A saved dark override is present from the first visible production UI frame under a light system');
    report.firstThemeFrames = firstThemeFrames;
    await tab('设置').click(); await theme.selectOption('light'); await requireTheme('light', 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await requireTheme('light', 'light');
    await theme.selectOption('system'); await requireTheme('dark', 'system');
    report.checks.push('system light/dark changes apply live, manual overrides stay fixed and save, and saved dark appears on the first UI frame');

    for (const [width, height] of [[320,568],[320,480],[375,812],[667,375]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['音乐库','歌单','设置']) { await tab(name).click(); await checkLayout(name + ' ' + width + '×' + height); }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await tab('设置').click(); await page.locator('.audio-settings > summary').click();
    await page.locator('.audio-settings').getByRole('button', { name: '自定义', exact: true }).click();
    await page.locator('.fx-eq').waitFor(); await checkLayout('320px custom EQ');
    assert.ok(await page.locator('.fx-eq').evaluate(node => node.scrollWidth <= node.clientWidth+1), 'All ten native EQ sliders fit the small screen without horizontal scrolling');
    assert.ok((await page.locator('.fx-eq input').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))).every(width => width >= 43.9), 'Every EQ slider has a 44px touch width');
    await checkContrast(['.fx-chip','.fx-eq-label','.fx-eq-val','.tip'], 'dark audio settings');
    await capture('02-dark-audio-settings-320');
    const miniBefore = await media();
    await page.locator('.mini-toggle').click();
    await waitUntil(async () => (await media()).paused !== miniBefore.paused, 'The mini player controls the actual media');
    await page.locator('.mini-open').click(); await player.waitFor();
    assert.equal((await media()).source, miniBefore.source, 'Opening the full player retains the song');
    report.checks.push('320px, short and landscape screens retain navigation and mini controls without overflow; advanced EQ is readable with 44px sliders');

    for (const mode of ['light','dark']) {
      await tab('设置').click(); await theme.selectOption(mode); await requireTheme(mode, mode);
      await tab('歌单').click();
      await page.locator('.collections-view .add-btn').click();
      const create = page.getByRole('dialog', { name: '新建歌单', exact: true });
      await create.waitFor();
      assert.equal(await page.getByRole('textbox', { name: '歌单名称', exact: true }).evaluate(node => node === document.activeElement), true, 'The create dialog initially focuses its named input');
      await page.keyboard.press('Shift+Tab');
      assert.ok(await create.evaluate(node => node.contains(document.activeElement)), 'Create dialog backward tab stays in the modal');
      await checkContrast(['.create-title','.create-btn'], mode + ' create dialog'); await checkLayout(mode + ' create dialog');
      await capture('03-' + mode + '-create-dialog');
      await page.keyboard.press('Escape'); await create.waitFor({ state: 'hidden' });
      assert.ok(await page.locator('.collections-view .add-btn').evaluate(node => node === document.activeElement), 'Closing the dialog restores its launcher focus');
      await tab('播放').click(); await openPicker();
      await walking().waitFor();
      assert.equal(await picker().getByRole('button', { name: '关闭歌单选择', exact: true }).evaluate(node => node === document.activeElement), true, 'The picker initially focuses its close control');
      await page.keyboard.press('Shift+Tab');
      assert.ok(await picker().evaluate(node => node.contains(document.activeElement)), 'Picker backward tab stays in the modal');
      await checkContrast(['.picker-title','.col-name','.col-count'], mode + ' playlist picker'); await checkLayout(mode + ' playlist picker');
      await capture('04-' + mode + '-playlist-picker');
      await page.keyboard.press('Escape'); await picker().waitFor({ state: 'hidden' });
      assert.ok(await player.locator('.like-btn').evaluate(node => node === document.activeElement), 'Closing the picker restores its launcher focus');
    }
    report.checks.push('library, settings and playlist dialogs retain ≥4.5:1 text contrast in both themes; modal focus enters, stays contained and returns');

    await openPicker(); await walking().click();
    await waitUntil(async () => await walking().getAttribute('aria-pressed') === 'true', 'A real successful fixture response updates playlist membership');
    await page.keyboard.press('Escape'); await tab('歌单').click();
    await waitUntil(async () => (await page.locator('.collection-item').filter({ hasText: '散步与很长' }).textContent()).includes('1 首'), 'The existing playlist page refreshes after a successful picker edit');
    await page.locator('.collections-view .add-btn').click();
    await page.getByRole('textbox', { name: '歌单名称', exact: true }).fill('夜间散步');
    await page.getByRole('dialog', { name: '新建歌单', exact: true }).getByRole('button', { name: '创建', exact: true }).click();
    await page.locator('.collection-item').filter({ hasText: '夜间散步' }).waitFor();
    await tab('播放').click(); await openPicker(); holdNextLike = true;
    const night = () => picker().locator('.collection-row').filter({ hasText: '夜间散步' });
    await night().click();
    await waitUntil(() => !!releaseLike, 'An old-song playlist response is genuinely deferred');
    assert.equal(heldLikeBody.index, 0);
    await page.keyboard.press('Escape'); await tab('音乐库').click();
    await page.locator('.song-list-view .song-item').filter({ hasText: fixture.songs[2].songName }).click();
    await player.waitFor(); await openPicker(); await night().waitFor();
    assert.equal(await night().getAttribute('aria-pressed'), 'false', 'The new song is initially absent from that playlist');
    const fetchesBeforeLateLike = collectionFetchCount;
    const likedRequestsBefore = await app.evaluate(() => global.__wuuMobileFixture.requests.filter(request => request.path === '/api/liked').length);
    const oldLike = page.waitForResponse(response => response.url().endsWith('/api/like-collection'));
    releaseLike(); await (await oldLike).json(); await frames();
    assert.equal(await night().getAttribute('aria-pressed'), 'false', 'A late old-song response cannot change new-song membership or a reopened picker');
    assert.equal(await app.evaluate(() => global.__wuuMobileFixture.requests.filter(request => request.path === '/api/liked').length), likedRequestsBefore, 'A stale picker result does not emit a current-song liked update');
    await waitUntil(() => collectionFetchCount > fetchesBeforeLateLike, 'A successful server change refreshes the playlist cache even after its picker closes');
    await page.keyboard.press('Escape'); await tab('歌单').click();
    const savedNight = page.locator('.collection-item').filter({ hasText: '夜间散步' });
    await waitUntil(async () => (await savedNight.textContent()).includes('1 首'), 'The closed-picker response refreshes the already mounted playlist page');
    await savedNight.click();
    await page.locator('.collections-view .song-item').filter({ hasText: fixture.songs[0].songName }).waitFor();
    assert.equal(await page.locator('.collections-view .song-item').filter({ hasText: fixture.songs[2].songName }).count(), 0, 'The saved playlist contains the old requested song, not the new current song');
    await page.getByRole('button', { name: '返回歌单列表', exact: true }).click(); await tab('播放').click();
    holdNextCollection = true; await openPicker();
    await waitUntil(() => !!releaseCollection, 'A fetch from the previous picker opening is genuinely deferred');
    await page.keyboard.press('Escape'); await openPicker(); await walking().waitFor();
    const staleFetch = page.waitForResponse(response => response.url().endsWith('/api/collections'));
    releaseCollection(); await (await staleFetch).json(); await frames();
    assert.equal(await picker().locator('.collection-row').filter({ hasText: '迟到的旧歌单' }).count(), 0, 'A response from a closed opening cannot replace the reopened picker list');
    await walking().waitFor(); await page.keyboard.press('Escape');
    report.checks.push('playlist creation and picker edits refresh cached lists; late old-song writes update the saved old song without altering the new picker, and stale opening fetches are ignored');
    assert.deepEqual(report.errors, [], 'The production mobile renderer has no uncaught errors');
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page) { const file = path.join(artifacts, 'failure.png'); await page.screenshot({ path: file }).catch(() => {}); report.screenshots.push(file); }
    throw error;
  } finally {
    releaseStartup?.(); releaseLike?.(); releaseCollection?.();
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  }
  console.log(JSON.stringify({ ok: true, checks: report.checks, report: path.join(artifacts, 'report.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
