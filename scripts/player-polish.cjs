// Real Electron regression for artwork palettes, lyric alignment, and cross-window interaction.
// Run after npm run build:desktop: node scripts/player-polish.cjs
// All media/profile data belongs to .test-artifacts; no user library or configuration is touched.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'player-polish');
fs.mkdirSync(artifacts, { recursive:true });
const report = { checks:[], screenshots:[], measurements:[] };

async function waitUntil(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  assert.fail(message);
}

async function reviewCoverLifecycle() {
  const result = {checks:[], screenshots:[], visibility:[]};
  const resultPath = path.join(artifacts, 'cover-lifecycle-report.json');
  for (const startup of ['hidden', 'minimized']) {
    const app = await electron.launch({
      executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
      env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'', WUU_PLAYER_POLISH_FIXTURE:'1', WUU_COVER_STARTUP:startup}, timeout:30000,
    });
    let page;
    try {
      await app.firstWindow();
      await waitUntil(() => {
        page = app.windows().find(window => window.url() && window.url() !== 'about:blank' && !window.url().includes('window=lyrics'));
        return !!page;
      }, 'The background renderer must load');
      page.setDefaultTimeout(10000);
      // Playwright enables focus emulation by default, which reports visible even
      // for a native hidden Electron window. Disable that override, not visibility.
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const nav = page.getByRole('navigation', {name:'主导航'});
      // DOM actions preserve the actual native hidden/minimized state during the background checks.
      await nav.getByRole('button', {name:'正在播放', exact:true}).evaluate(button => button.click());
      await waitUntil(() => page.evaluate(() => !!document.querySelector('.record-info h1')), 'The player page should mount while its native window is hidden');
      // Emulation belongs to each DevTools session. Sending this command through
      // a second public CDP session cannot cancel Playwright's own enabled flag.
      const driverPage = page._connection.toImpl(page);
      assert.ok(driverPage?.delegate?._mainFrameSession?._client, 'The local Playwright Electron driver exposes its original CDP session');
      await driverPage.delegate._mainFrameSession._client.send('Emulation.setFocusEmulationEnabled', {enabled:false});
      const visibility = async label => {
        const native = await app.evaluate(({BrowserWindow}) => {
          const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('window=lyrics'));
          return {visible:window.isVisible(), minimized:window.isMinimized()};
        });
        const documentState = await page.evaluate(() => document.visibilityState);
        result.visibility.push({label, ...native, documentState});
        return {...native, documentState};
      };
      const setWindowState = async action => {
        await app.evaluate(({BrowserWindow}, action) => {
          const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('window=lyrics'));
          if (action === 'hide') window.hide();
          else if (action === 'minimize') window.minimize();
          else { window.restore(); window.show(); window.focus(); }
        }, action);
        await waitUntil(() => page.evaluate(hidden => document.visibilityState === (hidden ? 'hidden' : 'visible'), action !== 'show'), 'Native window changes must reach document.visibilityState');
      };
      const hasCover = async file => page.evaluate(file => {
        const filename = file.replace(/\\/g, '/').split('/').at(-1);
        const loaded = selector => [...document.querySelectorAll(selector)].some(image => {
          const layer = image.closest('.artwork-layer');
          return decodeURIComponent(image.currentSrc || image.src).includes(filename) && image.complete && image.naturalWidth > 0 &&
            (!layer || (!layer.classList.contains('artwork-outgoing') && Number(getComputedStyle(layer).opacity) > .98));
        });
        return loaded('.record-artwork-stack img') && loaded('.now-playing-link img');
      }, file);
      const waitForCover = async (file, message) => waitUntil(() => hasCover(file), message, 7000);
      const imageServed = file => app.evaluate((_electron, file) => global.__wuuSmoke.polish.imageRequests.some(item => item.file.replace(/\\/g, '/') === file.replace(/\\/g, '/') && item.status === 'served'), file);
      const initial = await app.evaluate(() => global.__wuuSmoke.songs[0]);
      await waitUntil(() => page.evaluate(() => document.visibilityState === 'hidden'), 'Startup must remain genuinely hidden from Chromium');
      const initialState = await visibility(`${startup} startup`);
      assert.ok(startup === 'hidden' ? !initialState.visible : initialState.minimized, 'The fixture starts in the requested native background state');
      await waitUntil(() => imageServed(initial.coverPath), 'The startup image response arrives while the window remains in the background', 15000);
      const afterResponse = await visibility(`${startup} image delivered`);
      assert.equal(afterResponse.documentState, 'hidden', 'Waiting for a slow cover must not bring the app forward');
      await setWindowState('show');
      await waitForCover(initial.coverPath, 'Restoring a background launch displays the same cover in the sleeve and persistent player bar');
      result.checks.push(`${startup} startup restores a fully loaded cover in both locations`);
      const capture = async name => {
        const file = path.join(artifacts, name + '.png'); await page.screenshot({path:file}); result.screenshots.push(file);
      };
      await capture(`cover-${startup}-startup`);

      if (startup === 'hidden') {
        const refreshLibrary = async () => {
          await nav.getByRole('button', {name:'音乐列表', exact:true}).click();
          await page.getByRole('button', {name:'刷新歌库', exact:true}).click();
          await nav.getByRole('button', {name:'正在播放', exact:true}).click();
        };
        const slowCover = await app.evaluate(() => global.__wuuSmoke.polish.makeCoverVariant(1, 'slow-hidden-switch', {delayMs:9200}));
        await refreshLibrary();
        await setWindowState('hide');
        await page.getByRole('button', {name:'下一首', exact:true}).evaluate(button => button.click());
        await waitUntil(() => page.evaluate(() => document.querySelector('.record-info h1')?.textContent === '蓝色海岸'), 'Changing tracks in the background updates the intended song');
        await waitUntil(() => imageServed(slowCover), 'A cover taking over eight seconds to respond should complete in the background', 16000);
        const slowRequest = await app.evaluate((_electron, file) => global.__wuuSmoke.polish.imageRequests.find(item => item.file.replace(/\\/g, '/') === file.replace(/\\/g, '/') && item.status === 'served'), slowCover);
        assert.ok(slowRequest.finishedAt - slowRequest.startedAt >= 9000, 'The slow cover exceeds the former eight-second permanent failure deadline');
        await visibility('hidden delayed track change');
        await setWindowState('show');
        await waitForCover(slowCover, 'A late image remains eligible for display after a hidden track change');
        await capture('cover-hidden-slow-switch-restored');
        result.checks.push('hidden track change accepts a real image response later than eight seconds');

        for (const recovery of ['native-restore', 'route-return']) {
          const failingCover = await app.evaluate((_electron, tag) => global.__wuuSmoke.polish.makeCoverVariant(1, tag, {failuresRemaining:100}), recovery);
          await refreshLibrary();
          await waitUntil(() => app.evaluate((_electron, file) => global.__wuuSmoke.polish.imageRequests.some(item => item.file.replace(/\\/g, '/') === file.replace(/\\/g, '/') && item.status === 'failed'), failingCover), 'The real image request should encounter a recoverable failure');
          // Exhaust the one automatic retry before testing visibility recovery itself.
          await page.waitForTimeout(3000);
          assert.equal(await hasCover(failingCover), false, 'The failed image has not silently succeeded before the recovery trigger');
          if (recovery === 'native-restore') await setWindowState('hide');
          else await nav.getByRole('button', {name:'音乐列表', exact:true}).click();
          await app.evaluate((_electron, file) => { global.__wuuSmoke.polish.imageRules[file.toLowerCase()].failuresRemaining = 0; }, failingCover);
          if (recovery === 'native-restore') await setWindowState('show');
          else await nav.getByRole('button', {name:'正在播放', exact:true}).click();
          await waitForCover(failingCover, 'The same failed cover path retries when the player becomes visible again: ' + recovery);
          assert.equal(await page.locator('.record-info h1').textContent(), '蓝色海岸', 'Recovery keeps the intended track without requiring a song change');
          await capture(`cover-failure-${recovery}-recovered`);
          result.checks.push(`failed same-path image recovers after ${recovery}`);
        }

        // A solid fixture gives a direct rendered-pixel check that the artwork center is intact.
        await page.getByRole('button', {name:'暂停', exact:true}).click();
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.record-spindle').count(), 0, 'The record no longer overlays a center spindle onto the original cover');
        const imagePath = path.join(artifacts, 'cover-center-unobstructed.png');
        await page.locator('.record-sleeve').screenshot({path:imagePath}); result.screenshots.push(imagePath);
        const center = await app.evaluate(({nativeImage}, file) => {
          const image = nativeImage.createFromPath(file), {width, height} = image.getSize(), pixels = image.toBitmap();
          const index = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
          return [pixels[index + 2], pixels[index + 1], pixels[index]];
        }, imagePath);
        assert.ok(center.every((channel, index) => Math.abs(channel - [42,146,166][index]) <= 3), 'The rendered cover center preserves the original image pixels: ' + JSON.stringify(center));
        result.checks.push('rendered cover center preserves original pixels without an artificial hole');
      }
      assert.deepEqual(errors, [], 'Background cover recovery creates no renderer exceptions');
    } catch (error) {
      result.ok = false; result.error = error.stack || String(error);
      result.failureState = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(window => ({url:window.webContents.getURL(), visible:window.isVisible(), minimized:window.isMinimized()}))).catch(() => []);
      if (page) result.failureDocument = await page.evaluate(() => ({url:location.href, visibility:document.visibilityState})).catch(() => null);
      if (page) await page.screenshot({path:path.join(artifacts, `cover-failure-${startup}.png`)}).catch(() => {});
      throw error;
    } finally {
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      await app.evaluate(({app}) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    }
  }
  result.ok = true; fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ok:true, coverLifecycle:result.checks, screenshots:result.screenshots, report:resultPath}, null, 2));
}

(async () => {
  if (process.env.WUU_PLAYER_POLISH_COVERS_ONLY === '1') { await reviewCoverLifecycle(); return; }
  const app = await electron.launch({
    executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
    env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'', WUU_PLAYER_POLISH_FIXTURE:'1'}, timeout:30000,
  });
  let page, desktop;
  const errors = [];
  try {
    await app.firstWindow();
    await waitUntil(() => {
      page = app.windows().find(window => window.url() && window.url() !== 'about:blank' && !window.url().includes('window=lyrics'));
      return !!page;
    }, 'The main React renderer should load');
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({colorScheme:'dark', reducedMotion:'no-preference'});
    const nav = page.getByRole('navigation', {name:'主导航'});
    await nav.waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});
    await nav.getByRole('button', {name:'正在播放', exact:true}).click();
    await page.locator('.record-info h1').filter({hasText:'玫瑰色的黄昏'}).waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).click();
    await page.getByRole('button', {name:'播放', exact:true}).waitFor();

    const fixture = await app.evaluate(() => ({songs:global.__wuuSmoke.songs, ...global.__wuuSmoke.polish}));
    for (let index = 0; index < 2; index++) {
      const palette = await page.evaluate(file => window.musicAPI.extractCoverColor(file), fixture.songs[index].coverPath);
      assert.ok(Array.isArray(palette) && palette.length, 'The production IPC returns a palette array, not a synthetic RGB object');
      assert.deepEqual([palette[0].r, palette[0].g, palette[0].b], fixture.expectedColors[index], 'Actual PNG pixels retain their hue through palette extraction');
      const dataUrl = 'data:image/png;base64,' + fs.readFileSync(fixture.songs[index].coverPath).toString('base64');
      const urlPalette = await page.evaluate(url => window.musicAPI.extractCoverColorFromURL(url), dataUrl);
      assert.deepEqual(urlPalette, palette, 'The preview URL palette IPC agrees with local cover extraction');
    }
    report.checks.push('production PNG decoding and palette-array IPC');

    async function setNativeInput(locator, value) {
      // Range/color controls cannot use Playwright's text-fill action. Preserve their real React handlers.
      await locator.evaluate((input, next) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(next));
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
      }, value);
    }
    async function seek(time) {
      await setNativeInput(page.getByRole('slider', {name:'播放进度', exact:true}), time);
      await page.waitForFunction(value => Math.abs(Number(document.querySelector('[aria-label="播放进度"]').value) - value) < .5, time);
    }
    async function mainInk() {
      return page.locator('.lyric-line.current .lyric-word').first().evaluate(node => getComputedStyle(node).backgroundImage);
    }
    async function desktopInk() {
      return desktop.locator('.desktop-current-row [data-char], .desktop-lyric-track').last().evaluate(node => getComputedStyle(node).backgroundImage);
    }
    async function screenshot(name, target = page) {
      const file = path.join(artifacts, name + '.png');
      await target.screenshot({path:file}); report.screenshots.push(file);
    }
    async function resize(width, height) {
      let outerWidth = width, outerHeight = height;
      for (let attempt = 0; attempt < 4; attempt++) {
        await app.evaluate(({BrowserWindow}, size) => {
          BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(size.width, size.height);
        }, {width:outerWidth, height:outerHeight});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const actual = await page.evaluate(() => ({width:innerWidth, height:innerHeight}));
        if (Math.abs(actual.width - width) <= 1 && Math.abs(actual.height - height) <= 1) return;
        outerWidth += width - actual.width; outerHeight += height - actual.height;
      }
    }
    async function assertCentered(label) {
      const measured = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const sleeve = rect('.record-sleeve'), title = rect('.record-info'), panel = rect('.lyrics-panel'), actions = rect('.player-actions'), bar = rect('.player-bar');
        const credit=document.querySelector('.record-info .record-credits'),creditBox=credit.getBoundingClientRect(),heading=credit.previousElementSibling,artist=credit.nextElementSibling;
        const credits={text:credit.textContent,entries:credit.children.length,immediatelyBelowTitle:heading.matches('h1')&&creditBox.top>=heading.getBoundingClientRect().bottom-1,
          artistAfter:artist.matches('p')&&artist.getBoundingClientRect().top>=creditBox.bottom-1,position:getComputedStyle(credit).position,bottom:creditBox.bottom};
        const lines = [...document.querySelectorAll('.lyric-line')].filter(line => line.textContent.length < 15).map(line => {
          const text = line.querySelector('.lyric-track').getBoundingClientRect();
          const row = line.getBoundingClientRect();
          return {text:line.textContent, align:getComputedStyle(line).textAlign, offset:Math.abs(text.x + text.width / 2 - row.x - row.width / 2)};
        });
        const overflow = ['html', '.app-shell', '.player-page', '.player-stage'].filter(selector => {
          const node = document.querySelector(selector); return node && node.scrollWidth > node.clientWidth + 2;
        });
        return {width:innerWidth, height:innerHeight, titleBelow:title.top >= sleeve.bottom - 2, titleCenter:Math.abs(title.x + title.width / 2 - sleeve.x - sleeve.width / 2), titleBottom:title.bottom, actionsTop:actions.top, actionsBottom:actions.bottom, barTop:bar.top, panelWidth:panel.width, lines, overflow,credits,
          lyricCreditCount:document.querySelectorAll('.player-lyrics-column [aria-label="词曲信息"],.player-lyrics-column footer,.lyrics-panel .record-credits,.lyrics-panel .player-credits').length};
      });
      report.measurements.push({label, ...measured});
      assert.equal(measured.titleBelow, true, 'Track metadata belongs beneath the record');
      assert.ok(measured.titleCenter <= 3, 'Track metadata is centered under the record');
      assert.ok(measured.titleBottom <= measured.barTop - 4 && measured.actionsBottom <= measured.barTop - 4, 'Track metadata and actions keep clearance above the playback bar');
      assert.ok(measured.credits.immediatelyBelowTitle&&measured.credits.artistAfter&&measured.credits.bottom<=measured.actionsTop,'Song credits belong directly below the title and preserve playback actions');
      assert.equal(measured.credits.text,'作词 / 作曲 Wuu 测试');assert.equal(measured.credits.entries,1,'The real shared fixture author is displayed once');
      assert.ok(!['fixed','absolute'].includes(measured.credits.position));assert.equal(measured.lyricCreditCount,0,'The lyric column contains no credit footer');
      assert.ok(measured.lines.length >= 3, 'The fixture includes multiple different short lyric lengths');
      assert.deepEqual(measured.lines.filter(line => line.align !== 'center' || line.offset > 3), [], 'Every short lyric text shares the row center');
      assert.deepEqual(measured.overflow, [], 'The listening page must not overflow horizontally');
    }

    await seek(16.35);
    await page.waitForFunction(() => document.querySelector('.lyric-line.current')?.textContent === '下一站会有温柔');
    await page.getByRole('button', {name:'打开桌面歌词', exact:true}).click();
    await waitUntil(() => {
      desktop = app.windows().find(window => window.url().includes('window=lyrics'));
      return !!desktop;
    }, 'A real desktop lyric window should exist');
    desktop.setDefaultTimeout(10000);
    desktop.on('pageerror', error => errors.push(error.message));
    await desktop.emulateMedia({colorScheme:'dark', reducedMotion:'no-preference'});
    await desktop.waitForFunction(() => document.querySelector('.desktop-current-row')?.textContent === '下一站会有温柔');
    await waitUntil(async () => (await app.evaluate(() => global.__wuuSmoke.polish.lyricPayloads)).some(payload => payload.type === 'color' && payload.color && !Array.isArray(payload.color) && Number.isFinite(payload.color.r)), 'The main renderer sends normalized RGB through real desktop lyric IPC');
    const roseInk = await mainInk(), roseDesktop = await desktopInk();
    assert.ok(roseInk.includes('gradient') && !roseInk.includes('undefined'), 'Main lyrics have a valid foreground gradient');
    assert.ok(roseDesktop.includes('gradient') && !roseDesktop.includes('undefined'), 'Desktop words have a valid foreground gradient');
    const wordFill = async () => ({
      main:await page.locator('.lyric-line.current .lyric-word').first().evaluate(node => parseFloat(node.style.getPropertyValue('--word-progress'))),
      desktop:await desktop.locator('.desktop-current-row [data-char]').first().evaluate(node => parseFloat(node.style.getPropertyValue('--fill'))),
    });
    await waitUntil(async () => {
      const fill = await wordFill(); return fill.main > 10 && fill.main < 90 && fill.desktop > 10 && fill.desktop < 90;
    }, 'Both windows render partial raw-word progress from the paused media clock');
    const beforeFill = await wordFill();
    await page.waitForTimeout(220);
    const heldFill = await wordFill();
    assert.ok(Math.abs(beforeFill.main - heldFill.main) < 2 && Math.abs(beforeFill.desktop - heldFill.desktop) < 2, 'Word fill remains frozen while playback is paused');
    await seek(16.55);
    await waitUntil(async () => {
      const fill = await wordFill(); return fill.main > beforeFill.main + 15 && fill.desktop > beforeFill.desktop + 15;
    }, 'Seeking within a raw word updates its fill in both windows');
    await seek(16.35);
    report.checks.push('paused seek updates the main and desktop current line', 'real desktop lyric color IPC');
    report.checks.push('raw word fill stays paused and updates on intra-word seek');

    for (const [width, height] of [[1100,720], [800,500]]) {
      await resize(width, height);
      await page.waitForTimeout(800);
      await assertCentered(`${width}x${height}`);
      await screenshot(`player-dark-${width}x${height}`);
    }
    await resize(1100,720);
    await screenshot('desktop-rose', desktop);
    report.checks.push('short and medium lyric lines centered', 'track metadata beneath artwork with genuine credits directly below the song title', 'pure lyric column without a credit footer', '800x500 and 1100x720 without horizontal overflow');

    // A click while paused must seek to the requested line and immediately use that line's center.
    await page.locator('.lyric-line').filter({hasText:'这一刻让时间停留'}).click();
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('[aria-label="播放进度"]').value) - 40) < .5);
    await page.waitForFunction(() => document.querySelector('.lyric-line.current')?.textContent === '这一刻让时间停留');
    await desktop.waitForFunction(() => document.querySelector('.desktop-current-row')?.textContent === '这一刻让时间停留');
    const centeredCurrent = () => page.evaluate(() => {
      const panel = document.querySelector('.lyrics-scroll').getBoundingClientRect(), line = document.querySelector('.lyric-line.current').getBoundingClientRect();
      return Math.abs(line.y + line.height / 2 - panel.y - panel.height / 2) < 6;
    });
    await waitUntil(centeredCurrent, 'Clicking a lyric recenters the new current line, including while paused');
    report.checks.push('click-to-seek recenters the selected lyric while paused');

    const scroll = page.locator('.lyrics-scroll');
    await scroll.hover(); await page.mouse.wheel(0, -200);
    await page.getByRole('button', {name:'回到当前歌词', exact:true}).waitFor();
    await page.waitForTimeout(350);
    const manuallyScrolled = await scroll.evaluate(element => element.scrollTop);
    await page.waitForTimeout(500);
    assert.ok(Math.abs(await scroll.evaluate(element => element.scrollTop) - manuallyScrolled) < 3, 'Manual lyric browsing remains stable instead of snapping back');
    await page.getByRole('button', {name:'回到当前歌词', exact:true}).click();
    await waitUntil(centeredCurrent, 'Return-to-current restores centering');
    await scroll.hover(); await page.mouse.wheel(0, -160);
    await page.getByRole('button', {name:'回到当前歌词', exact:true}).waitFor();
    await page.getByRole('button', {name:'回到当前歌词', exact:true}).waitFor({state:'hidden', timeout:9000});
    await waitUntil(centeredCurrent, 'Manual following timeout recenters even while paused');
    report.checks.push('manual scroll override and return-to-current', 'paused manual-follow timeout');

    await page.getByRole('button', {name:'下一首', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.record-info h1')?.textContent === '蓝色海岸');
    await page.getByRole('button', {name:'暂停', exact:true}).click();
    await seek(16.35);
    await waitUntil(async () => await mainInk() !== roseInk, 'Changing artwork must change the main lyric color');
    await waitUntil(async () => await desktopInk() !== roseDesktop, 'Changing artwork must change the desktop lyric color');
    const oceanInk = await mainInk();
    const colors = await app.evaluate(() => global.__wuuSmoke.polish.lyricPayloads.filter(payload => payload.type === 'color' && payload.color).map(payload => payload.color));
    assert.ok(new Set(colors.map(color => `${color.r},${color.g},${color.b}`)).size >= 2, 'Distinct cover colors travel through the real IPC bus');
    await screenshot('player-ocean'); await screenshot('desktop-ocean', desktop);
    report.checks.push('different real covers change main and desktop lyric colors');

    await nav.getByRole('button', {name:'设置', exact:true}).click();
    await page.getByRole('tab', {name:'外观', exact:true}).click();
    await page.getByLabel('自定义进度条颜色', {exact:false}).check();
    await setNativeInput(page.getByLabel('起始颜色', {exact:false}), '#f3bd47');
    await setNativeInput(page.getByLabel('结束颜色', {exact:false}), '#ed754a');
    await nav.getByRole('button', {name:'正在播放', exact:true}).click();
    await waitUntil(async () => (await mainInk()).includes('243, 189, 71'), 'Explicit custom color overrides the artwork for the main lyric');
    await waitUntil(async () => (await desktopInk()).includes('243, 189, 71'), 'Explicit custom color overrides the artwork for desktop lyrics');
    await page.getByRole('button', {name:'上一首', exact:true}).click();
    await page.getByRole('button', {name:'暂停', exact:true}).click(); await seek(16.35);
    assert.ok((await mainInk()).includes('243, 189, 71'), 'Manual color survives a track change');
    assert.ok((await desktopInk()).includes('243, 189, 71'), 'Desktop manual color survives a track change');
    await nav.getByRole('button', {name:'设置', exact:true}).click();
    await page.getByRole('tab', {name:'外观', exact:true}).click();
    await page.getByLabel('自定义进度条颜色', {exact:false}).uncheck();
    await nav.getByRole('button', {name:'正在播放', exact:true}).click();
    await waitUntil(async () => !(await mainInk()).includes('243, 189, 71'), 'Disabling custom color returns to artwork-derived color');
    report.checks.push('custom gradient overrides and restores cover colors in both windows');

    // Main lyrics always expose the complete long line through wrapping,
    // including paused seeks in either direction. The desktop overlay keeps its
    // own marquee and reduced-motion font-fitting behavior.
    await seek(31);
    await page.waitForFunction(() => document.querySelector('.lyric-line.current')?.textContent.length > 40);
    const longText = fixture.lines.find(([time]) => time === 22)[1];
    const assertWrappedMainLine = async () => {
      const wrapped = await page.locator('.lyric-line.current .lyric-track').evaluate(node => {
        const line = node.closest('.lyric-line'), style = getComputedStyle(node), track = node.getBoundingClientRect(), box = line.getBoundingClientRect();
        const characters = [...node.querySelectorAll('.lyric-word')].flatMap(word => [...word.getClientRects()]);
        return {text:node.textContent, whiteSpace:style.whiteSpace, transform:style.transform, textOverflow:style.textOverflow,
          marquee:line.dataset.marquee, trackWidth:track.width, available:box.width, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth,
          charactersFit:characters.every(character => character.left >= box.left - 1 && character.right <= box.right + 1)};
      });
      report.measurements.push({label:'main long lyric without horizontal marquee', wrapped});
      assert.equal(wrapped.text, longText, 'The main lyric preserves the complete original long text');
      assert.notEqual(wrapped.whiteSpace, 'nowrap', 'Main lyrics wrap in normal motion mode');
      assert.equal(wrapped.transform, 'none', 'Paused and backward seeks never leave the main text shifted to its sung tail');
      assert.notEqual(wrapped.textOverflow, 'ellipsis', 'Main lyrics do not truncate their tail');
      assert.ok(!wrapped.marquee && wrapped.trackWidth <= wrapped.available + 2 && wrapped.scrollWidth <= wrapped.clientWidth + 2 && wrapped.charactersFit,
        'Every lyric character stays within the row horizontally and remains vertically browsable');
    };
    for (const time of [31, 24, 31]) { await seek(time); await assertWrappedMainLine(); }
    await screenshot('player-long-line');
    await page.emulateMedia({reducedMotion:'reduce'});
    await desktop.emulateMedia({reducedMotion:'reduce'});
    const assertReducedLongLine = async (target, trackSelector, viewportSelector) => {
      await waitUntil(() => target.locator(trackSelector).evaluate(node => {
        const transform = getComputedStyle(node).transform;
        return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).m41) < .5;
      }), 'Reduced motion stops long-line marquee translation');
      const readability = await target.evaluate(({trackSelector, viewportSelector}) => {
        const node = document.querySelector(trackSelector), viewport = document.querySelector(viewportSelector);
        const track = node.getBoundingClientRect(), box = viewport.getBoundingClientRect(), style = getComputedStyle(node);
        return {whiteSpace:style.whiteSpace, align:getComputedStyle(viewport).textAlign, rowStyle:viewport.getAttribute('style'), trackWidth:track.width, available:box.width, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth, height:track.height,
          top:track.top, bottom:track.bottom, viewportTop:box.top, viewportBottom:box.bottom, windowHeight:innerHeight};
      }, {trackSelector, viewportSelector});
      report.measurements.push({label:trackSelector, reducedMotion:readability});
      assert.ok(readability.trackWidth <= readability.available + 2 && readability.scrollWidth <= readability.clientWidth + 2, 'Long lyrics wrap within the readable viewport when motion is reduced');
      assert.notEqual(readability.whiteSpace, 'nowrap', 'Reduced motion exposes long text through wrapping');
      assert.equal(readability.align, 'center', 'Wrapped long lyric lines stay centered when motion is reduced');
      assert.ok(readability.top >= readability.viewportTop - 2 && readability.bottom <= readability.viewportBottom + 2 && readability.bottom <= readability.windowHeight + 2, 'Reduced-motion wrapped lyrics retain every line within the visible window');
      const settled = [];
      for (let sample = 0; sample < 8; sample++) {
        await target.waitForTimeout(80);
        settled.push(await target.evaluate(({trackSelector, viewportSelector}) => {
          const node = document.querySelector(trackSelector), viewport = document.querySelector(viewportSelector);
          const track = node.getBoundingClientRect(), box = viewport.getBoundingClientRect();
          return {fontSize:getComputedStyle(node).fontSize, height:track.height, top:track.top, bottom:track.bottom, viewportTop:box.top, viewportBottom:box.bottom, windowHeight:innerHeight};
        }, {trackSelector, viewportSelector}));
      }
      report.measurements.push({label:trackSelector, reducedMotionSettled:settled});
      assert.ok(settled.every(sample => sample.top >= sample.viewportTop - 2 && sample.bottom <= sample.viewportBottom + 2 && sample.bottom <= sample.windowHeight + 2), 'Wrapped lyrics remain fully visible across settled frames: ' + JSON.stringify(settled));
      assert.equal(new Set(settled.map(sample => sample.fontSize)).size, 1, 'Reduced-motion font fitting must stabilize without cycling between sizes');
    };
    await assertReducedLongLine(page, '.lyric-line.current .lyric-track', '.lyric-line.current');
    await assertReducedLongLine(desktop, '.desktop-lyric-track', '.desktop-current-row');
    const desktopNext = await desktop.locator('.desktop-next-row').evaluate(node => {
      const box = node.getBoundingClientRect(); return {top:box.top, bottom:box.bottom, windowHeight:innerHeight};
    });
    assert.ok(desktopNext.top >= 0 && desktopNext.bottom <= desktopNext.windowHeight + 1, 'Wrapping the current desktop lyric preserves the next-line preview inside the window: ' + JSON.stringify(desktopNext));
    await screenshot('player-long-line-reduced-motion');
    await screenshot('desktop-long-line-reduced-motion', desktop);
    await page.getByRole('button', {name:'播放', exact:true}).click();
    await seek(16.35);
    await page.waitForTimeout(200);
    const motion = await page.evaluate(() => [...document.querySelectorAll('.player-cover.disc, .record-info, .artwork-layer, .lyric-line.current')].map(node => {
      const style = getComputedStyle(node);
      return {className:node.className, animation:style.animationName, duration:style.animationDuration, transition:style.transitionDuration};
    }));
    assert.ok(motion.every(item => item.animation === 'none' || item.duration.split(',').every(value => parseFloat(value) <= .01)), 'Reduced motion disables record rotation and entrance motion');
    await page.getByRole('button', {name:'暂停', exact:true}).click();
    await page.emulateMedia({colorScheme:'light'});
    await screenshot('player-system-light-reduced-motion');
    await screenshot('desktop-reduced-motion', desktop);
    report.checks.push('main long lyrics preserve the full original text through stable wrapping after paused forward and backward seeks', 'reduced motion keeps main wrapping and stops desktop marquee with stable font fitting', 'reduced motion disables decorative animation', 'screenshots under dark and light system preferences');

    // Closing and reopening a paused overlay must replay its data, color, and current clock.
    await desktop.getByRole('button', {name:'关闭桌面歌词', exact:true}).click();
    await page.getByRole('button', {name:'打开桌面歌词', exact:true}).waitFor();
    await seek(48.35);
    await page.getByRole('button', {name:'打开桌面歌词', exact:true}).click();
    await desktop.waitForFunction(() => document.querySelector('.desktop-current-row')?.textContent === '日落之后还有星光');
    assert.ok((await desktopInk()).includes('gradient'), 'Reopened desktop lyrics receive color and data without playback');
    await page.getByRole('button', {name:'播放', exact:true}).waitFor();
    report.checks.push('closing and reopening paused desktop lyrics restores current data and time');

    // Coverless tracks must clear the previous album's accent in both windows.
    await page.getByRole('button', {name:'下一首', exact:true}).click();
    await page.getByRole('button', {name:'下一首', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.record-info h1')?.textContent === '没有封面的歌');
    await page.getByRole('button', {name:'暂停', exact:true}).click(); await seek(16.35);
    await waitUntil(async () => (await mainInk()) !== oceanInk, 'A coverless track does not retain the previous cover color');
    const fallbackColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cover-color-rgb').split(',').map(Number));
    assert.notDeepEqual(fallbackColor, fixture.expectedColors[1], 'The main window clears the previous track palette for coverless tracks');
    const lastColor = await app.evaluate(() => global.__wuuSmoke.polish.lyricPayloads.filter(payload => payload.type === 'color').at(-1));
    assert.equal(lastColor.color, null, 'A coverless track clears the desktop color through IPC');
    await screenshot('player-coverless');
    await desktop.getByRole('button', {name:'关闭桌面歌词', exact:true}).click();
    await page.getByRole('button', {name:'打开桌面歌词', exact:true}).waitFor();
    report.checks.push('coverless fallback clears previous accent', 'desktop close updates main controls');
    // Five immediate changes from index two end at index one; older decoded artwork must not win later.
    await page.getByRole('button', {name:'下一首', exact:true}).evaluate(button => {
      for (let index = 0; index < 5; index++) button.click();
    });
    await page.waitForFunction(() => document.querySelector('.record-info h1')?.textContent === '蓝色海岸');
    await page.getByRole('button', {name:'暂停', exact:true}).click(); await seek(16.35);
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.record-info h1').textContent(), '蓝色海岸', 'Rapid track changes retain the final song metadata');
    const finalCover = await page.locator('.artwork-layer:not(.artwork-outgoing) img').getAttribute('src');
    assert.ok(decodeURIComponent(finalCover).includes('蓝色海岸.png'), 'Older artwork decoding cannot replace the final track cover');
    const finalColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cover-color-rgb'));
    assert.deepEqual(finalColor.split(',').map(Number), fixture.expectedColors[1], 'Older palette extraction cannot replace the final track color');
    await screenshot('player-rapid-next-final');
    report.checks.push('rapid next does not roll back final metadata, artwork, or color');
    assert.deepEqual(errors, [], 'Both React renderers remain free of page errors');
    report.checks.push('no renderer page errors');
    report.ok = true;
    console.log(JSON.stringify({ok:true, checks:report.checks, screenshots:report.screenshots, report:path.join(artifacts, 'report.json')}, null, 2));
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error);
    if (page) await page.screenshot({path:path.join(artifacts, 'failure-main.png')}).catch(() => {});
    if (desktop) await desktop.screenshot({path:path.join(artifacts, 'failure-desktop.png')}).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await app.evaluate(({app}) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  await reviewCoverLifecycle();
})().catch(error => { console.error(error); process.exitCode = 1; });
