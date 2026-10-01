// Real Electron regression for manual sidebar sizing and appearance controls in Settings.
// Run after npm run build:desktop: node scripts/freedom-desktop.cjs
// Fixture media/configuration and review output stay inside .test-artifacts.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'freedom');
fs.mkdirSync(artifacts, { recursive:true });
const report = { ok:false, checks:[], screenshots:[], sidebar:[], opacity:[], themes:[], layouts:[], errors:[] };

async function until(check, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 65));
  }
  assert.fail(message);
}

function surfaceState() {
  const shell = document.querySelector('.app-shell');
  const selectors = ['.titlebar', '.sidebar', '.main-content', '.player-bar'];
  return {
    opacity:Number(getComputedStyle(shell).getPropertyValue('--glass-opacity')),
    accent:getComputedStyle(shell).getPropertyValue('--accent').trim(),
    coverAccent:getComputedStyle(shell).getPropertyValue('--cover-accent').trim(),
    surfaces:selectors.map(selector => {
      const element = document.querySelector(selector), css = getComputedStyle(element);
      return {selector, background:css.backgroundColor, image:css.backgroundImage};
    }),
  };
}

function colorAlpha(color) {
  const modern = /\/\s*([\d.]+)\s*\)/.exec(color);
  if (modern) return Number(modern[1]);
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);
  return rgba ? Number(rgba[1]) : color === 'transparent' ? 0 : 1;
}

(async () => {
  let app, page;
  try {
    app = await electron.launch({
      executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
      env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'1', WUU_PLAYER_POLISH_FIXTURE:'', WUU_COVER_STARTUP:'', WUU_REVIEW_PROFILE:'freedom'}, timeout:30000,
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      page = app.windows().find(window => window.url() && window.url() !== 'about:blank' && !window.url().includes('window=lyrics'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'The real Electron renderer must load');
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.emulateMedia({colorScheme:'dark', reducedMotion:'no-preference'});
    const nav = page.getByRole('navigation', {name:'主导航'});
    await nav.waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});
    const capture = async name => {
      const file = path.join(artifacts, `${name}.png`);
      await page.screenshot({path:file}); report.screenshots.push(file);
    };
    const settledPage = async () => {
      await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
      await page.waitForTimeout(340);
    };
    const go = async name => { await nav.getByRole('button', {name, exact:true}).click(); await settledPage(); };
    const resize = async (width, height) => {
      let outerWidth = width, outerHeight = height;
      for (let attempt = 0; attempt < 4; attempt++) {
        await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(size.width, size.height), {width:outerWidth, height:outerHeight});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const viewport = await page.evaluate(() => ({width:innerWidth, height:innerHeight}));
        if (Math.abs(viewport.width - width) <= 1 && Math.abs(viewport.height - height) <= 1) return;
        outerWidth += width - viewport.width; outerHeight += height - viewport.height;
      }
      await page.waitForFunction(size => Math.abs(innerWidth - size.width) <= 2 && Math.abs(innerHeight - size.height) <= 2, {width,height});
    };
    const sidebarWidth = () => nav.evaluate(element => element.getBoundingClientRect().width);
    const settleSidebar = async () => page.evaluate(async () => {
      const sidebar = document.querySelector('.sidebar'), started = performance.now();
      let previous = sidebar.getBoundingClientRect().width, unchanged = 0;
      while (performance.now() - started < 1600) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const width = sidebar.getBoundingClientRect().width;
        unchanged = Math.abs(width - previous) < .1 ? unchanged + 1 : 0;
        previous = width;
        if (unchanged >= 6 && performance.now() - started > 320) return width;
      }
      throw new Error('The rendered sidebar width did not settle');
    });
    const layout = async label => {
      const result = await page.evaluate(label => {
        const selectors = ['html', 'body', '.app-shell', '.titlebar', '.workspace', '.main-content', '.page-host:not([hidden])', '.page-host:not([hidden]) > .panel', '.player-bar'];
        const overflow = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2).map(element => ({selector, width:element.clientWidth, scrollWidth:element.scrollWidth})));
        const queries = [
          'button[aria-label="展开侧栏"], button[aria-label="收起侧栏"]', '.window-controls button[aria-label="关闭窗口"]',
          '.player-bar button[aria-label="暂停"]', '.player-bar button[aria-label="打开音效"]', '.player-bar input[aria-label="音量"]', '.player-bar button[aria-label="打开播放队列"]',
        ];
        const controls = queries.map(query => {
          const element = document.querySelector(query), box = element?.getBoundingClientRect();
          return {query, visible:!!box && box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1};
        });
        return {label, width:innerWidth, height:innerHeight, overflow, controls};
      }, label);
      report.layouts.push(result);
      assert.deepEqual(result.overflow, [], `${label}: page chrome and content must not overflow horizontally`);
      assert.ok(result.controls.every(control => control.visible), `${label}: sidebar, window, and playback controls remain in the window`);
    };
    const verifyNoPageTitle = async name => {
      assert.equal(await page.locator('.titlebar-context').count(), 0, 'The titlebar removes redundant page context');
      const duplicated = await page.locator('.titlebar').evaluate((element, name) => [...element.querySelectorAll('strong, h1, h2, p, span')].some(node => node.textContent.trim() === name), name);
      assert.equal(duplicated, false, 'The current page title is not repeated in the titlebar');
      assert.equal(await page.locator('.titlebar').locator('input, select, [role="switch"]').count(), 0, 'The titlebar has no appearance sliders, selectors, or switches');
      const buttonNames = await page.locator('.titlebar button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
      assert.equal(buttonNames.length, 3, 'Only the three window controls remain in the titlebar');
      assert.deepEqual(buttonNames.filter(name => !['最小化', '最大化', '还原窗口', '关闭窗口'].includes(name)), [], 'The titlebar has no extra control buttons');
    };
    const saved = async (predicate, expected) => until(() => app.evaluate((_electron, {expression, expected}) => (0, eval)(expression)(global.__wuuSmoke, expected), {expression:predicate.toString(), expected}), 'The final preference must reach fixture IPC storage');
    const appearanceSettings = async () => {
      await go('设置');
      await page.getByRole('tab', {name:'外观', exact:true}).click();
      const appearance = page.getByRole('tabpanel', {name:'外观', exact:true});
      await appearance.waitFor();
      return appearance;
    };
    const beginPlaybackCheck = async label => {
      const timeBefore = Number(await page.getByRole('slider', {name:'播放进度', exact:true}).inputValue());
      await page.evaluate(() => {
        const original = HTMLMediaElement.prototype.pause;
        window.__freedomPauseProbe = {original, calls:[]};
        HTMLMediaElement.prototype.pause = function(...args) {
          if (this.id === 'react-media-player') window.__freedomPauseProbe.calls.push({time:this.currentTime, src:this.currentSrc || this.src});
          return original.apply(this, args);
        };
      });
      return {label, timeBefore};
    };
    const endPlaybackCheck = async check => {
      const timeAfter = Number(await page.getByRole('slider', {name:'播放进度', exact:true}).inputValue());
      const pauses = await page.evaluate(() => {
        const probe = window.__freedomPauseProbe;
        HTMLMediaElement.prototype.pause = probe.original;
        return probe.calls;
      });
      report.playback ||= [];
      report.playback.push({...check, timeAfter, pauses});
      assert.deepEqual(pauses, [], `${check.label}: appearance/navigation operations never pause the actual media element`);
      assert.ok(timeAfter > check.timeBefore + .05, `${check.label}: real playback progress keeps advancing`);
      assert.equal(await page.getByRole('button', {name:'暂停', exact:true}).count(), 1);
    };

    await resize(1100, 720); await go('推荐');
    await verifyNoPageTitle('推荐');
    assert.equal(await nav.getAttribute('data-collapsed'), 'true', 'The default sidebar starts collapsed');
    const collapsedWidth = await settleSidebar();
    await capture('default-collapsed-1100x720'); await layout('default collapsed');
    await go('正在播放');
    assert.equal(await page.locator('.player-page').getByText('正在聆听', {exact:true}).count(), 0, 'The player removes the redundant listening status text');
    await verifyNoPageTitle('正在播放'); await capture('player-clean-header-1100x720');
    await go('推荐');
    report.checks.push('titlebar has only window controls, player has no redundant listening text, and the default sidebar is collapsed');

    const appearancePlayback = await beginPlaybackCheck('sidebar and opacity');
    const expansionFrames = await page.evaluate(async () => {
      const sidebar = document.querySelector('.sidebar');
      const frames = [{elapsed:0, width:sidebar.getBoundingClientRect().width}], started = performance.now();
      document.querySelector('button[aria-label="展开侧栏"]').click();
      while (performance.now() - started < 430) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frames.push({elapsed:performance.now() - started, width:sidebar.getBoundingClientRect().width});
      }
      return frames;
    });
    const expandedWidth = await settleSidebar();
    assert.equal(await nav.getAttribute('data-collapsed'), 'false');
    assert.ok(expandedWidth > collapsedWidth + 40, 'Manual expansion changes the real rendered width');
    assert.ok(new Set(expansionFrames.filter(frame => frame.width > collapsedWidth + 1 && frame.width < expandedWidth - 1).map(frame => frame.width.toFixed(1))).size >= 2, 'Expansion renders multiple intermediate widths');
    report.sidebar.push({label:'expand', collapsedWidth, expandedWidth, frames:expansionFrames});

    const separator = page.getByRole('separator', {name:'调整侧栏宽度', exact:true});
    await separator.waitFor();
    const box = await separator.boundingBox();
    assert.ok(box && box.height > 20, 'The expanded sidebar has a usable drag handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2, {steps:12}); await page.mouse.up();
    const draggedWidth = await settleSidebar();
    assert.ok(draggedWidth > expandedWidth + 20, 'Dragging widens the sidebar');
    await separator.focus(); await page.keyboard.press('ArrowRight');
    const keyRightWidth = await settleSidebar();
    await page.keyboard.press('ArrowLeft');
    const keyLeftWidth = await settleSidebar();
    assert.ok(keyRightWidth > draggedWidth + 4, 'ArrowRight widens the focused sidebar separator');
    assert.ok(Math.abs(keyLeftWidth - draggedWidth) < 2, 'ArrowLeft reverses the keyboard width adjustment');
    await saved((smoke, width) => smoke.data.settings.sidebarCollapsed === false && Math.abs(smoke.data.settings.sidebarWidth - width) < 2, draggedWidth);
    report.sidebar.push({label:'drag and keyboard', expandedWidth, draggedWidth, keyRightWidth, keyLeftWidth});
    await capture('expanded-resized-1100x720'); await layout('expanded and resized');
    report.checks.push('sidebar drag and left/right keyboard resizing change and persist its real width');

    await page.getByRole('button', {name:'收起侧栏', exact:true}).click(); await settleSidebar();
    await resize(800, 500); await settleSidebar(); await layout('800x500 collapsed');
    await capture('collapsed-800x500');
    const smallCollapsed = await sidebarWidth();
    await page.getByRole('button', {name:'展开侧栏', exact:true}).click();
    const smallExpanded = await settleSidebar();
    assert.ok(smallExpanded > smallCollapsed + 40, 'The small window still permits manual expansion');
    await layout('800x500 expanded'); await capture('expanded-800x500');
    await page.getByRole('button', {name:'收起侧栏', exact:true}).click();
    assert.ok(Math.abs(await settleSidebar() - smallCollapsed) < 2, 'The small window still permits manual collapse');
    await layout('800x500 collapsed again');
    report.sidebar.push({label:'small window', collapsedWidth:smallCollapsed, expandedWidth:smallExpanded});
    report.checks.push('800x500 keeps both manual sidebar states and all playback controls usable');

    const appearance = await appearanceSettings(); await verifyNoPageTitle('设置');
    const settingsOpacity = appearance.getByRole('slider', {name:'界面透明度', exact:true});
    await settingsOpacity.waitFor();
    await settingsOpacity.scrollIntoViewIfNeeded();
    assert.equal(Number(await settingsOpacity.getAttribute('min')), 12);
    assert.equal(Number(await settingsOpacity.getAttribute('max')), 100);
    const changeOpacity = async (selector, values) => page.evaluate(async ({selector, values, snapshot}) => {
      const input = document.querySelector(selector), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const read = (0, eval)('(' + snapshot + ')'), samples = [];
      for (const value of values) {
        setter.call(input, String(value)); input.dispatchEvent(new Event('input', {bubbles:true}));
        await new Promise(resolve => requestAnimationFrame(resolve));
        samples.push({requested:value, input:Number(input.value), ...read()});
      }
      return samples;
    }, {selector, values, snapshot:surfaceState.toString()});
    const opacitySelector = '#settings-panel-appearance input[aria-label="界面透明度"]';
    const rapidFrames = await changeOpacity(opacitySelector, [13, 83, 22, 92, 35, 68, 16]);
    assert.ok(rapidFrames.every(frame => Math.abs(frame.opacity - frame.requested / 100) < .011), 'Rapid settings input updates the opacity CSS variable within the next rendered frame');
    assert.ok(new Set(rapidFrames.map(frame => frame.surfaces.find(surface => surface.selector === '.main-content').background)).size > 2, 'Rapid settings input changes actual rendered surface colors, not only slider labels');
    report.opacity.push({label:'rapid settings input', frames:rapidFrames});
    await saved(smoke => Math.abs(smoke.data.settings.glassOpacity - .16) < .001 && smoke.calls.includes('save-userdata'));
    await page.waitForTimeout(800); await capture('transparent-800x500');
    await changeOpacity(opacitySelector, [88]);
    await page.waitForTimeout(800); await capture('opaque-800x500');

    const settingsFrames = await changeOpacity(opacitySelector, [43, 81]);
    assert.ok(settingsFrames.every(frame => Math.abs(frame.opacity - frame.requested / 100) < .011), 'The settings percentage slider updates the live opacity preference');
    assert.equal(Number(await settingsOpacity.inputValue()), 81, 'The settings slider retains the selected percentage');
    await saved(smoke => Math.abs(smoke.data.settings.glassOpacity - .81) < .001);
    await page.waitForTimeout(800);
    const finalOpacity = await page.evaluate(surfaceState);
    for (const surface of finalOpacity.surfaces) assert.ok(Math.abs(colorAlpha(surface.background) - .81) < .025, `${surface.selector} uses the selected opacity on its real background`);
    report.opacity.push({label:'settings input and persisted final value', frames:settingsFrames, final:finalOpacity});
    await endPlaybackCheck(appearancePlayback);
    report.checks.push('the settings opacity control updates real backgrounds immediately and saves through IPC without interrupting playback');

    await resize(1100, 720); await go('音乐列表');
    const records = await app.evaluate(() => global.__wuuSmoke.songs.slice(0, 2).map(song => ({songName:song.songName, coverPath:song.coverPath})));
    assert.ok(records.length === 2 && records[0].coverPath && records[1].coverPath && records[0].coverPath !== records[1].coverPath, 'Theme regression uses two different real fixture cover images');
    const playRecord = async record => {
      await go('音乐列表');
      await page.locator('.song-main').filter({hasText:record.songName}).click();
      await until(async () => (await page.locator('.now-playing-link strong').textContent()) === record.songName, 'The intended fixture song must become current');
      await page.getByRole('button', {name:'暂停', exact:true}).waitFor();
      await page.waitForTimeout(1000);
    };
    const setFollow = async value => {
      const continuity = await beginPlaybackCheck(`cover follow ${value ? 'on' : 'off'}`);
      const settings = await appearanceSettings();
      const checkbox = settings.locator('.setting-row').filter({hasText:'全局背景跟随封面'}).locator('input[type="checkbox"]');
      await checkbox.setChecked(value);
      assert.equal(await checkbox.isChecked(), value, 'The cover-follow setting reflects the requested state');
      await saved((smoke, expected) => smoke.data.settings.themeFollowCover === expected, value);
      await go('音乐列表'); await page.waitForTimeout(1000);
      await endPlaybackCheck(continuity);
    };
    await setFollow(false);
    await playRecord(records[0]);
    await setFollow(true);
    const firstTheme = await page.evaluate(surfaceState); await capture('cover-follow-first');
    await playRecord(records[1]);
    const secondTheme = await page.evaluate(surfaceState); await capture('cover-follow-second');
    assert.notEqual(firstTheme.coverAccent, secondTheme.coverAccent, 'Two actual cover images yield different extracted palettes');
    assert.notEqual(firstTheme.surfaces.find(surface => surface.selector === '.main-content').background, secondTheme.surfaces.find(surface => surface.selector === '.main-content').background, 'Following the cover changes an actual page surface');
    assert.notEqual(firstTheme.surfaces.find(surface => surface.selector === '.sidebar').background, secondTheme.surfaces.find(surface => surface.selector === '.sidebar').background, 'Following the cover changes the actual navigation background');
    await setFollow(false);
    const neutralSecond = await page.evaluate(surfaceState);
    await playRecord(records[0]);
    const neutralFirst = await page.evaluate(surfaceState); await capture('cover-follow-off-neutral');
    assert.deepEqual(neutralFirst.surfaces, neutralSecond.surfaces, 'Ordinary page backgrounds remain neutral across cover changes while follow is off');
    assert.equal(neutralFirst.accent, neutralSecond.accent, 'The neutral interface accent stays stable while follow is off');
    await saved(smoke => smoke.data.settings.themeFollowCover === false);
    report.themes.push({records:records.map(record => record.songName), firstTheme, secondTheme, neutralSecond, neutralFirst});
    await layout('final neutral library');
    report.checks.push('the settings cover switch changes real backgrounds for different covers and restores a neutral ordinary page when disabled without pausing playback');
    assert.deepEqual(report.errors, [], 'The renderer reports no uncaught errors');
    report.ok = true;
  } catch (error) {
    report.failure = {message:error.message, stack:error.stack};
    if (page) {
      const file = path.join(artifacts, 'failure.png');
      await page.screenshot({path:file}).then(() => report.screenshots.push(file)).catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (app) { await app.evaluate(({app}) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  }
  console.log(JSON.stringify({ok:true, checks:report.checks, screenshots:report.screenshots, report:path.join(artifacts, 'report.json')}));
})().catch(error => { console.error(error); process.exitCode = 1; });
