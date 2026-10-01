// User-facing experience regression in real Electron. Run after build:desktop.
// The existing offline fixture is reused; all captures/configuration stay in .test-artifacts.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'experience');
fs.mkdirSync(artifacts, { recursive:true });
const report = { ok:false, checks:[], layouts:[], playback:[], desktopLyrics:[], styles:[], screenshots:[], rendererErrors:[] };
const sourcePath = source => decodeURIComponent(source.replace(/^(?:file|music):\/\/\/?/i,'')).replace(/\\/g,'/').toLowerCase();

async function waitUntil(check, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  assert.fail(message);
}

(async () => {
  const app = await electron.launch({
    executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
    env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'1',
      WUU_PLAYER_POLISH_FIXTURE:'', WUU_COVER_STARTUP:'', WUU_REVIEW_PROFILE:'experience'}, timeout:30000,
  });
  let page;
  try {
    await waitUntil(() => {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics'));
      return !!page;
    }, 'The main renderer should load');
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.rendererErrors.push({url:page.url(), message:error.message}));
    await page.emulateMedia({ reducedMotion:'reduce', colorScheme:'dark' });
    const modernNav = () => page.getByRole('navigation', {name:'主导航'});
    const activePage = () => page.locator('.page-host:not([hidden])');
    await modernNav().waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});
    await page.getByRole('button', {name:'暂停', exact:true}).click();
    await page.getByRole('button', {name:'播放', exact:true}).waitFor();

    // Transparent observation of the actual browser media element, including audio
    // elements that intentionally remain outside the DOM. Playback is never mocked.
    await page.addInitScript(() => {
      const originalPlay = HTMLMediaElement.prototype.play;
      const seen = new WeakSet();
      window.__experienceMediaEvents = [];
      HTMLMediaElement.prototype.play = function(...args) {
        window.__experienceMedia = this;
        if (!window.__experienceFirstMedia) window.__experienceFirstMedia = this;
        if (!seen.has(this)) {
          seen.add(this);
          for (const type of ['pause', 'emptied', 'loadstart']) this.addEventListener(type, () => {
            window.__experienceMediaEvents.push({type, time:this.currentTime});
          });
        }
        return originalPlay.apply(this, args);
      };
    });

    const fixture = await app.evaluate(({ipcMain}) => {
      const fixture = global.__wuuSmoke;
      const labels = [['独立流行'], ['民谣', '原声'], [], ['古典'], ['氛围']];
      fixture.songs.forEach((song, index) => { song.genre = labels[index] || []; });
      // beforeunload writes the old renderer snapshot synchronously. Seed dated
      // records once at the following hydration, then leave every later save real.
      let seeded = false;
      ipcMain.removeHandler('get-userdata');
      ipcMain.handle('get-userdata', () => {
        fixture.calls.push('get-userdata');
        const data = fixture.data;
        if (!seeded) {
          seeded = true;
          const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
          const today = key(new Date());
          const earlier = new Date(); earlier.setDate(earlier.getDate()-10);
          data.genreOverrides = {};
          data.stats = Object.fromEntries(fixture.songs.map((song,index) => [song.audioPath, {
            plays:18-index, duration:18000-index*300,
            ...(index < 3 ? {recentDays:{[today]:{plays:index+1, duration:index === 1 ? 7200 : 3600}}} :
              index === 4 ? {recentDays:{[key(earlier)]:{plays:2, duration:7200}}} : {}),
          }]));
          data.settings = {...data.settings, interfaceMode:'modern'};
          data.lastSession = {audioPath:fixture.songs[0].audioPath, t:14};
          data.progress = {...data.progress, [fixture.songs[0].audioPath]:14};
        }
        return data;
      });
      return fixture.songs.map(song => ({name:song.songName, path:song.audioPath}));
    });
    await modernNav().getByRole('button', {name:'音乐列表', exact:true}).click();
    await page.getByRole('button', {name:'刷新歌库', exact:true}).click();
    await page.reload();
    await modernNav().waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});
    await page.waitForFunction(() => window.__experienceMedia?.currentTime >= 13);

    async function resize(width, height) {
      let outerWidth = width, outerHeight = height;
      for (let attempt = 0; attempt < 4; attempt++) {
        await app.evaluate(({BrowserWindow}, size) => {
          BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(size.width,size.height);
        }, {width:outerWidth, height:outerHeight});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const viewport = await page.evaluate(() => ({width:innerWidth, height:innerHeight}));
        if (viewport.width === width && viewport.height === height) return;
        outerWidth += width-viewport.width; outerHeight += height-viewport.height;
      }
      await page.waitForFunction(size => Math.abs(innerWidth-size.width) <= 2 && Math.abs(innerHeight-size.height) <= 2, {width,height});
    }
    async function openModern(route) {
      await modernNav().getByRole('button', {name:route, exact:true}).click();
      await activePage().getByRole('heading').first().waitFor();
    }
    const mediaSnapshot = () => page.evaluate(() => {
      const media = window.__experienceMedia;
      return {time:media?.currentTime || 0, src:media?.currentSrc || '', paused:media?.paused,
        sameElement:media === window.__experienceFirstMedia, events:window.__experienceMediaEvents?.length || 0};
    });
    async function confirmNavigationPlayback(before, label) {
      await waitUntil(async () => (await mediaSnapshot()).time > before.time+.1, `${label}: playback should continue advancing`);
      const after = await mediaSnapshot();
      const interruptions = await page.evaluate(start => window.__experienceMediaEvents.slice(start), before.events);
      assert.ok(after.sameElement && !after.paused && after.src === before.src, `${label}: navigation retains the playing media element and song`);
      assert.deepEqual(interruptions, [], `${label}: navigation must not pause or reload the song`);
      report.playback.push({label, before:before.time, after:after.time, interruptions});
    }
    async function capture(name, classic = false) {
      await page.mouse.move(0,0);
      await page.evaluate(async classic => {
        await document.fonts.ready;
        const panel = document.querySelector(classic ? '#app > section:not(.hidden)' : '.page-host:not([hidden]) > .panel');
        panel?.scrollTo(0,0);
        await Promise.all([...document.querySelectorAll('img')].filter(image => image.getClientRects().length).map(image => image.decode().catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, classic);
      const layout = await page.evaluate(classic => {
        const selectors = classic ? ['html','body','#app','#app > section:not(.hidden)','#ctrl'] :
          ['html','body','.app-shell','.workspace','.main-content','.page-host:not([hidden])','.page-host:not([hidden]) > .panel','.settings-content','.stats-overview','.player-bar'];
        const overflow = selectors.flatMap(selector => [...document.querySelectorAll(selector)]
          .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth+2)
          .map(element => ({selector, width:element.clientWidth, contentWidth:element.scrollWidth})));
        const queries = classic ? ['#btn-prev','#btn-play','#btn-next','#btn-fx','#btn-desktop-lyric','#btn-vol'] :
          ['.player-bar button[aria-label="上一首"]','.player-bar button[aria-label="暂停"],.player-bar button[aria-label="播放"]',
            '.player-bar button[aria-label="下一首"]','.player-bar button[aria-label="打开音效"]','.player-bar input[aria-label="音量"]'];
        const controls = queries.map(selector => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return {selector, visible:!!rect && rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth+1 && rect.bottom <= innerHeight+1};
        });
        return {width:innerWidth, height:innerHeight, overflow, controls};
      }, classic);
      const file = path.join(artifacts, `${name}.png`);
      await page.screenshot({path:file}); report.screenshots.push(file); report.layouts.push({name,...layout});
      assert.deepEqual(layout.overflow, [], `${name}: content fits the window without horizontal overflow`);
      assert.ok(layout.controls.every(control => control.visible), `${name}: essential playback controls remain visible`);
    }
    async function settingsKeyboard() {
      await openModern('设置');
      const appearance = page.getByRole('tab', {name:'外观', exact:true});
      await appearance.click(); await appearance.focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.getByRole('tab', {name:'播放', exact:true}).getAttribute('aria-selected'), 'true');
      await page.keyboard.press('End');
      assert.equal(await page.getByRole('tab', {name:'网络服务', exact:true}).getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Home');
      assert.equal(await appearance.getAttribute('aria-selected'), 'true');
      const details = activePage().locator('details').filter({has:page.getByText('背景细节', {exact:true})});
      if (await details.evaluate(element => element.open)) await details.locator('summary').click();
      assert.equal(await page.getByRole('slider', {name:'封面背景强度', exact:true}).isVisible(), false, 'Advanced settings are initially folded');
      await details.locator('summary').focus(); await page.keyboard.press('Enter');
      await page.getByRole('slider', {name:'封面背景强度', exact:true}).waitFor();
      await details.locator('summary').focus(); await page.keyboard.press('Space');
      assert.equal(await details.evaluate(element => element.open), false, 'Advanced settings can be collapsed with the keyboard');
    }
    async function lyricsHierarchy() {
      await openModern('正在播放');
      await page.getByRole('button', {name:'晚风吹过你的肩头，从 0:12 播放', exact:true}).click();
      await page.mouse.move(0,0);
      await page.waitForFunction(() => document.querySelector('.lyric-line.current')?.textContent === '晚风吹过你的肩头');
      const styles = await page.evaluate(() => {
        const current = document.querySelector('.lyric-line.current');
        const passed = document.querySelector('.lyric-line.passed');
        const waiting = [...document.querySelectorAll('.lyric-line')].find(line => !line.matches('.current,.passed'));
        const measure = element => ({size:parseFloat(getComputedStyle(element).fontSize), opacity:parseFloat(getComputedStyle(element).opacity), weight:parseFloat(getComputedStyle(element).fontWeight)});
        return {current:measure(current), passed:measure(passed), waiting:measure(waiting)};
      });
      assert.ok(styles.current.size > styles.passed.size && styles.current.size > styles.waiting.size, 'The current lyric is larger than surrounding lines');
      assert.ok(styles.current.opacity > styles.passed.opacity && styles.current.weight > styles.passed.weight, 'Previously sung lyrics are visibly quieter than the current line');
      report.styles.push({type:'lyrics',...styles});
    }
    async function statsOverview() {
      await openModern('音乐统计');
      const overview = await page.locator('.stats-overview').evaluate(element => [...element.children].map(metric => {
        const rect = metric.getBoundingClientRect(); return {top:rect.top, left:rect.left};
      }));
      assert.equal(overview.length, 4);
      assert.ok(Math.max(...overview.map(metric => metric.top))-Math.min(...overview.map(metric => metric.top)) <= 2, 'All four music totals fit on one row');
    }

    await resize(1100,720);
    await settingsKeyboard();
    await page.getByRole('tab', {name:'歌词', exact:true}).click();
    const lyricSize = page.getByRole('slider', {name:'歌词字号', exact:true});
    const savedSize = Number(await lyricSize.inputValue())+1;
    await lyricSize.focus(); await page.keyboard.press('ArrowRight');
    await waitUntil(() => app.evaluate((_electron,value) => global.__wuuSmoke.data.settings.lyricSize === value && global.__wuuSmoke.calls.includes('save-userdata'), savedSize), 'Settings changes are saved through the real save IPC');
    report.checks.push('settings categories support keyboard navigation and progressively reveal advanced controls');
    report.checks.push('settings changes save through IPC');

    await statsOverview();
    const chart = () => page.getByRole('list', {name:'按聆听时长计算的曲风分布'});
    await chart().waitFor();
    const distribution = await chart().evaluate(element => [...element.children].map(item => ({name:item.querySelector('strong').textContent, share:item.querySelector('progress').value})));
    const coverageText = await page.locator('.stats-styles .stats-ranking-header p').textContent();
    const coverage = Number(/标签覆盖率\s*([\d.]+)%/.exec(coverageText)?.[1]);
    assert.ok(coverage >= 74 && coverage <= 76, 'Coverage includes the real amount of unlabeled listening time');
    assert.ok(distribution.some(bucket => bucket.name === '未标注'), 'Missing tags remain explicitly unlabeled');
    assert.ok(!distribution.some(bucket => ['古典','氛围'].includes(bucket.name)), 'Undated lifetime totals and records outside the chosen period are excluded');
    assert.ok(Math.abs(distribution.reduce((sum,bucket) => sum+bucket.share,0)-100) < .1, 'Multiple genre tags divide listening time without counting it twice');
    await page.getByRole('button', {name:'近 30 天', exact:true}).click();
    await chart().getByText('氛围', {exact:true}).waitFor();
    await page.getByRole('button', {name:'近 7 天', exact:true}).click();
    report.styles.push({type:'genres',coverage,distribution});
    report.checks.push('recent genres use dated listening, explicit tags, honest coverage, and 7/30 day windows');

    await page.locator('.stats-genre-editor summary').click();
    await page.getByRole('button', {name:`编辑 ${fixture[0].name} 的曲风`, exact:true}).click();
    const dialog = page.getByRole('dialog', {name:`编辑「${fixture[0].name}」的曲风`, exact:true});
    await dialog.getByRole('textbox').fill('摇滚, 爵士');
    await dialog.getByRole('button', {name:'保存标签', exact:true}).click();
    await chart().getByText('摇滚', {exact:true}).waitFor();
    await waitUntil(() => app.evaluate((_electron,path) => JSON.stringify(global.__wuuSmoke.data.genreOverrides?.[path]) === JSON.stringify(['摇滚','爵士']), fixture[0].path), 'Manual genre labels save through IPC');
    await page.getByRole('button', {name:`恢复 ${fixture[0].name} 的音频标签`, exact:true}).click();
    await chart().getByText('独立流行', {exact:true}).waitFor();
    await waitUntil(() => app.evaluate((_electron,path) => !Object.hasOwn(global.__wuuSmoke.data.genreOverrides || {},path), fixture[0].path), 'Restoring audio tags removes the manual override');
    // Keep one extra user tag for the real legacy round trip, which must preserve
    // new metadata even though the old renderer does not expose its editor.
    await page.getByRole('button', {name:`编辑 ${fixture[2].name} 的曲风`, exact:true}).click();
    const secondDialog = page.getByRole('dialog', {name:`编辑「${fixture[2].name}」的曲风`, exact:true});
    await secondDialog.getByRole('textbox').fill('电子');
    await secondDialog.getByRole('button', {name:'保存标签', exact:true}).click();
    await chart().getByText('电子', {exact:true}).waitFor();
    await waitUntil(() => app.evaluate((_electron,path) => global.__wuuSmoke.data.genreOverrides?.[path]?.[0] === '电子', fixture[2].path), 'The round-trip genre label is saved');
    await page.locator('.stats-genre-editor summary').click();
    report.checks.push('manual genres can be edited, saved, and restored to original audio tags');

    for (const [width,height] of [[1100,720],[800,500]]) {
      await resize(width,height);
      const beforeNavigation = await mediaSnapshot();
      await settingsKeyboard();
      await capture(`modern-settings-${width}x${height}`);
      await statsOverview(); await capture(`modern-stats-${width}x${height}`);
      await openModern('正在播放');
      await confirmNavigationPlayback(beforeNavigation, `modern navigation ${width}×${height}`);
      await lyricsHierarchy(); await capture(`modern-player-${width}x${height}`);

      const beforeSwitch = await mediaSnapshot();
      await openModern('设置'); await page.getByRole('tab', {name:'外观', exact:true}).click();
      await page.getByRole('button', {name:'切换到旧版界面', exact:true}).click();
      await page.waitForURL(/\/renderer\/index\.html(?:[?#]|$)/, {timeout:15000});
      await page.locator('#nav').waitFor();
      await page.waitForFunction(() => window.__experienceMedia?.readyState >= 2 && window.__experienceMedia.currentTime >= 1);
      const legacySession = await mediaSnapshot();
      assert.equal(sourcePath(legacySession.src), sourcePath(beforeSwitch.src), 'The genuine old renderer restores the same song');
      assert.ok(legacySession.time >= beforeSwitch.time-2, 'Switching to the original renderer restores the saved position');
      assert.equal(legacySession.paused, false, 'The original renderer retains the playing state');
      await waitUntil(async () => {
        const current = await mediaSnapshot();
        return !current.paused && current.time > legacySession.time+.15;
      }, 'Playback continues advancing in the original renderer');
      await waitUntil(() => app.evaluate(() => global.__wuuSmoke.data.settings.interfaceMode === 'classic'), 'The original UI preference is persisted');
      await page.locator('#nav [data-view="list"]').click(); await page.locator('#view-list').waitFor({state:'visible'});
      assert.ok(await page.locator('#list li').count() > 0, 'The original music list shows the familiar songs');
      await capture(`classic-home-${width}x${height}`, true);
      await page.locator('#now-playing').click(); await page.locator('#view-player').waitFor({state:'visible'});
      await capture(`classic-player-${width}x${height}`, true);
      const beforeReturn = await mediaSnapshot();
      if (!await page.locator('#btn-modern-interface').isVisible()) await page.locator('#nav [data-view="settings"]').click();
      await page.locator('#btn-modern-interface').click();
      await page.waitForURL(/\/desktop_UI\/dist\/index\.html(?:[?#]|$)/, {timeout:15000});
      await modernNav().waitFor();
      await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});
      await page.waitForFunction(() => window.__experienceMedia?.currentTime >= 1);
      const restored = await mediaSnapshot();
      assert.equal(sourcePath(restored.src), sourcePath(beforeReturn.src), 'Returning to modern UI restores the same song');
      assert.ok(restored.time >= beforeReturn.time-2, 'Returning to modern UI restores the saved position');
      const saved = await app.evaluate(() => global.__wuuSmoke.data);
      assert.equal(saved.settings.interfaceMode,'modern');
      assert.equal(saved.settings.lyricSize,savedSize, 'Both renderers retain user settings');
      assert.deepEqual(saved.genreOverrides?.[fixture[2].path],['电子'], 'The old renderer preserves new user genre metadata');
      report.playback.push({label:`genuine renderer round trip ${width}×${height}`, before:beforeSwitch.time, legacy:legacySession.time, returned:restored.time});
      report.checks.push(`modern and original renderers fit ${width}×${height}, with song, position, preferences, and genre metadata restored`);
    }

    // A separate paused round trip checks the branch that sends interfacePaused.
    // Desktop lyrics must follow the actual renderer, even while its audio clock
    // stays still; matching the visible current line also checks state replay.
    async function confirmPaused(before, label) {
      await page.waitForFunction(() => window.__experienceMedia?.readyState >= 2 && window.__experienceMedia.paused === true);
      const sample = await page.evaluate(async () => {
        const media = window.__experienceMedia;
        const time = media.currentTime;
        await new Promise(resolve => setTimeout(resolve, 600));
        return {time, after:media.currentTime, paused:media.paused};
      });
      const restored = await mediaSnapshot();
      assert.ok(sample.paused && restored.paused, `${label}: playback remains paused`);
      assert.ok(Math.abs(sample.after-sample.time) <= .05, `${label}: the paused playback position does not advance`);
      assert.equal(sourcePath(restored.src), sourcePath(before.src), `${label}: the same song is restored`);
      assert.ok(Math.abs(restored.time-before.time) <= 1, `${label}: the paused position is restored accurately`);
      report.playback.push({label, before:before.time, restored:restored.time, paused:true, drift:sample.after-sample.time});
      return restored;
    }
    const observedLyricPages = new WeakSet();
    async function confirmDesktopLyrics(mode, expectedText, label) {
      let nativeWindows, lyricPage;
      const match = mode === 'classic' ? /\/renderer\/desktop-lyric\.html(?:[?#]|$)/ : /\/desktop_UI\/dist\/index\.html\?[^#]*\bwindow=lyrics(?:[&#]|$)/;
      await waitUntil(async () => {
        nativeWindows = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()
          .filter(window => /desktop-lyric\.html|[?&]window=lyrics(?:[&#]|$)/.test(window.webContents.getURL()))
          .map(window => ({id:window.id, url:window.webContents.getURL(), visible:window.isVisible()})));
        const current = nativeWindows.find(window => match.test(window.url) && window.visible);
        lyricPage = current && app.windows().find(window => window.url() === current.url);
        return !!lyricPage;
      }, `${label}: the matching native desktop lyric window becomes visible`, 15000);
      assert.equal(nativeWindows.filter(window => window.visible).length, 1, `${label}: exactly one desktop lyric window is visible`);
      if (!observedLyricPages.has(lyricPage)) {
        observedLyricPages.add(lyricPage);
        lyricPage.on('pageerror', error => report.rendererErrors.push({url:lyricPage.url(), message:error.message}));
      }
      const selector = mode === 'classic' ? '#cur-row .lyric-base' : '.desktop-current-row .desktop-lyric-track';
      await lyricPage.waitForFunction(({selector, expectedText}) => document.querySelector(selector)?.textContent.trim() === expectedText, {selector,expectedText}, {timeout:10000});
      const text = await lyricPage.locator(selector).textContent();
      const file = path.join(artifacts, `${label}.png`);
      await lyricPage.screenshot({path:file}); report.screenshots.push(file);
      report.desktopLyrics.push({label, mode, windows:nativeWindows, text:text.trim()});
    }

    await resize(1100,720);
    await lyricsHierarchy();
    await page.getByRole('button', {name:'暂停', exact:true}).click();
    await page.getByRole('button', {name:'播放', exact:true}).waitFor();
    await page.waitForFunction(() => window.__experienceMedia?.paused === true);
    const pausedModern = await mediaSnapshot();
    const currentLyric = (await page.locator('.lyric-line[aria-current="true"]').first().textContent()).trim();
    await page.getByRole('button', {name:'打开桌面歌词', exact:true}).click();
    await confirmDesktopLyrics('modern', currentLyric, 'paused-modern-desktop-lyrics');
    const modernLyricPage = app.windows().find(window => /[?&]window=lyrics(?:[&#]|$)/.test(window.url()));
    await modernLyricPage.getByRole('button', {name:'锁定歌词', exact:true}).click();
    await modernLyricPage.getByRole('button', {name:'解锁歌词', exact:true}).click();
    await waitUntil(() => app.evaluate(() => global.__wuuSmoke.data.settings.desktopLyricLocked === false), 'Unlocking from desktop lyrics saves the actual lock state');
    await confirmPaused(pausedModern, 'modern paused with desktop lyrics');
    await openModern('设置'); await page.getByRole('tab', {name:'外观', exact:true}).click();
    await page.getByRole('button', {name:'切换到旧版界面', exact:true}).click();
    await page.waitForURL(/\/renderer\/index\.html(?:[?#]|$)/, {timeout:15000});
    await page.locator('#nav').waitFor();
    const pausedClassic = await confirmPaused(pausedModern, 'modern to original while paused');
    await page.locator('#now-playing').click(); await page.locator('#view-player').waitFor({state:'visible'});
    assert.equal((await page.locator('#title').textContent()).trim(), fixture[0].name, 'The original player keeps the paused song title');
    await confirmDesktopLyrics('classic', currentLyric, 'paused-classic-desktop-lyrics');
    const classicLyricPage = app.windows().find(window => /\/renderer\/desktop-lyric\.html(?:[?#]|$)/.test(window.url()));
    assert.equal(await classicLyricPage.locator('#btn-lock').getAttribute('title'), '锁定(鼠标穿透)', 'The original desktop lyric window replays the latest unlocked state');
    report.checks.push('unlocking in desktop lyrics remains unlocked after changing the interface');
    await capture('paused-classic-player-1100x720', true);
    await page.locator('#nav [data-view="settings"]').click();
    await page.locator('#btn-modern-interface').click();
    await page.waitForURL(/\/desktop_UI\/dist\/index\.html(?:[?#]|$)/, {timeout:15000});
    await modernNav().waitFor();
    await page.getByRole('button', {name:'播放', exact:true}).waitFor({timeout:15000});
    const pausedReturn = await confirmPaused(pausedClassic, 'original to modern while paused');
    await openModern('正在播放');
    assert.equal((await page.locator('.record-info h1').textContent()).trim(), fixture[0].name, 'The modern player keeps the paused song title');
    await page.waitForFunction(expectedText => document.querySelector('.lyric-line[aria-current="true"]')?.textContent.trim() === expectedText, currentLyric);
    await confirmDesktopLyrics('modern', currentLyric, 'paused-return-modern-desktop-lyrics');
    await capture('paused-return-modern-player-1100x720');
    await page.getByRole('button', {name:'关闭桌面歌词', exact:true}).click();
    await page.getByRole('button', {name:'播放', exact:true}).click();
    await waitUntil(async () => {
      const current = await mediaSnapshot();
      return !current.paused && current.time > pausedReturn.time+.15;
    }, 'Playback can resume after the paused round trip');
    report.checks.push('paused renderer switching retains the song and position, keeps both native desktop lyric renderers visible and synchronized, and allows playback to resume');
    assert.deepEqual(report.rendererErrors, [], 'Neither renderer reports uncaught errors');
    report.ok = true;
  } catch (error) {
    report.failure = {message:error.message, stack:error.stack};
    if (page) {
      const file = path.join(artifacts,'failure.png');
      await page.screenshot({path:file}).then(() => report.screenshots.push(file)).catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts,'report.json'), JSON.stringify(report,null,2));
    await app.evaluate(({app}) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  console.log(JSON.stringify({ok:true, checks:report.checks, screenshots:report.screenshots, report:path.join(artifacts,'report.json')}));
})().catch(error => { console.error(error); process.exitCode = 1; });
