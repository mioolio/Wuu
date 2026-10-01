// Real Electron checks for intermediate transition pixels, fixed glass surfaces,
// interruptible navigation, shared artwork, and the collection summary.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'motion');
fs.mkdirSync(artifacts, {recursive:true});
const report = {checks:[], screenshots:[], transitions:[], layouts:[], continuity:[], fallback:[]};

(async () => {
  const app = await electron.launch({executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
    env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'1', WUU_PLAYER_POLISH_FIXTURE:'', WUU_COVER_STARTUP:'', WUU_REVIEW_PROFILE:'motion'}});
  let page;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({reducedMotion:'no-preference', colorScheme:'dark'});
    const nav = page.getByRole('navigation', {name:'主导航'});
    await nav.waitFor();
    await page.getByRole('button', {name:'暂停', exact:true}).waitFor();
    await nav.getByRole('button', {name:'推荐', exact:true}).click();
    await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
    await page.waitForFunction(() => ['.home-hero-cover img', '.record-artwork-stack img'].every(selector => {
      const image = document.querySelector(selector); return image?.complete && image.naturalWidth;
    }));
    await page.evaluate(() => {
      window.__motionChecks = [];
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const result = start(...args);
        const record = {ready:false, finished:false, shared:false}; window.__motionChecks.push(record);
        result.ready.then(() => {
          record.ready = true;
          record.shared = [...document.querySelectorAll('[style*="view-transition-name"]')].length === 2;
          record.animations = document.getAnimations().filter(animation => animation.effect?.pseudoElement?.includes('view-transition')).length;
          if (window.__freezeNextPageTransition) {
            window.__freezeNextPageTransition = false;
            window.__frozenPageAnimations = document.getAnimations().filter(animation => animation.effect?.pseudoElement?.includes('wuu-page'));
            window.__frozenPageAnimations.forEach(animation => { animation.pause(); animation.currentTime = 0; });
            record.frozen = window.__frozenPageAnimations.length;
          }
        }).catch(error => { record.skipped = error.name; });
        result.finished.then(() => { record.finished = true; }).catch(error => { record.error = error.message; });
        return result;
      };
    });
    const capture = async (name, transparent = false) => {
      const file = path.join(artifacts, name + '.png'); await page.screenshot({path:file, omitBackground:transparent, scale:'css'}); report.screenshots.push(file); return file;
    };
    const settled = () => page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
    const surface = () => page.evaluate(() => {
      const main = document.querySelector('.main-content'), host = document.querySelector('.page-host:not([hidden])'), panel = host?.querySelector(':scope > .panel');
      const box = element => { const rect = element.getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; };
      const style = getComputedStyle(main);
      const color = style.backgroundColor.match(/[\d.]+/g).map(Number);
      return {main:box(main), host:host && box(host), panel:panel && box(panel), page:host?.dataset.page,
        background:style.backgroundColor, alpha:color.length > 3 ? color[3] : 1, glass:Number(style.getPropertyValue('--glass-opacity')),
        transform:style.transform, opacity:Number(style.opacity), mainName:style.viewTransitionName, hostName:host && getComputedStyle(host).viewTransitionName,
        panelTransform:panel && getComputedStyle(panel).transform, panelOpacity:panel && Number(getComputedStyle(panel).opacity)};
    });
    const pixels = async (file, box) => app.evaluate(({nativeImage}, {file, box}) => {
      const image = nativeImage.createFromPath(file), bitmap = image.toBitmap(), {width,height} = image.getSize();
      const locations = {
        topLeft:[box.x + 3,box.y + 3], topRight:[box.x + box.width - 4,box.y + 3],
        bottomLeft:[box.x + 3,box.y + box.height - 4], bottomRight:[box.x + box.width - 4,box.y + box.height - 4],
        topMiddle:[box.x + box.width / 2,box.y + 3], bottomMiddle:[box.x + box.width / 2,box.y + box.height - 4],
      };
      return Object.fromEntries(Object.entries(locations).map(([name,[x,y]]) => {
        const offset = (Math.min(height - 1,Math.max(0,Math.round(y))) * width + Math.min(width - 1,Math.max(0,Math.round(x)))) * 4;
        return [name,{r:bitmap[offset + 2],g:bitmap[offset + 1],b:bitmap[offset],a:bitmap[offset + 3]}];
      }));
    }, {file,box});
    const assertSurface = (value, baseline) => {
      for (const key of ['x','y','width','height']) {
        assert.ok(Math.abs(value.main[key] - baseline.main[key]) < 1, `The glass ${key} stays fixed during navigation`);
        assert.ok(Math.abs(value.host[key] - value.main[key]) < 1, `The page host covers the complete glass ${key}`);
      }
      assert.equal(value.transform, 'none', 'The glass background is never translated');
      assert.equal(value.opacity, 1, 'The glass background is never faded');
      assert.equal(value.mainName, 'none', 'The glass is excluded from page snapshots');
      assert.equal(value.hostName, 'wuu-page', 'Only the full content viewport is named for page snapshots');
      assert.ok(Math.abs(value.alpha - value.glass) < .015 && Math.abs(value.alpha - baseline.alpha) < .015, 'Actual glass alpha remains at the user setting throughout the transition');
    };
    const transitionFrames = async (label, name) => {
      await settled();
      const before = await surface(), beforeFile = await capture(name + '-before', true), beforePixels = await pixels(beforeFile, before.main);
      const count = await page.evaluate(() => { window.__freezeNextPageTransition = true; return window.__motionChecks.length; });
      await nav.getByRole('button', {name:label, exact:true}).click();
      await page.waitForFunction(count => window.__motionChecks.length > count && window.__motionChecks.at(-1)?.ready, count);
      assert.ok(await page.evaluate(() => window.__motionChecks.at(-1).frozen >= 2), 'Real native old/new snapshot animations can be held at intermediate frames');
      const frames = [];
      for (const fraction of [.08,.5,.9]) {
        const animationState = await page.evaluate(async fraction => {
          const animations = window.__frozenPageAnimations;
          animations.forEach(animation => { animation.currentTime = Number(animation.effect.getTiming().duration) * fraction; });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return animations.map(animation => ({pseudo:animation.effect.pseudoElement,progress:animation.effect.getComputedTiming().progress,currentTime:animation.currentTime,state:animation.playState}));
        }, fraction);
        const value = await surface(); assertSurface(value, before);
        const file = await capture(`${name}-${Math.round(fraction * 100)}pct`, true);
        frames.push({fraction, ...value, animations:animationState, pixels:await pixels(file,value.main)});
      }
      await page.evaluate(() => { window.__frozenPageAnimations.forEach(animation => animation.play()); window.__frozenPageAnimations = []; });
      await settled();
      const after = await surface(), afterFile = await capture(name + '-after', true), afterPixels = await pixels(afterFile, after.main);
      for (const frame of frames) for (const [edge,rgba] of Object.entries(frame.pixels)) {
        assert.ok(rgba.a >= Math.min(beforePixels[edge].a,afterPixels[edge].a) - 6, `${name} ${edge} retains its background alpha at ${frame.fraction}`);
        assert.ok(rgba.a <= Math.max(beforePixels[edge].a,afterPixels[edge].a) + 8, `${name} ${edge} does not accumulate an extra glass layer at ${frame.fraction}`);
        assert.ok(Math.max(rgba.r,rgba.g,rgba.b) < 135, `${name} ${edge} has no bright blank strip at ${frame.fraction}`);
      }
      report.continuity.push({name,before:{...before,pixels:beforePixels},frames,after:{...after,pixels:afterPixels}});
    };
    await transitionFrames('正在播放', 'home-to-player');
    assert.equal(await page.locator('.page-host:not([hidden])').count(), 1);
    await capture('player-lyrics-left');
    const lyricGeometry = await page.evaluate(() => {
      const lyrics = document.querySelector('.lyrics-panel').getBoundingClientRect();
      const active = document.querySelector('.lyric-line.current .lyric-track').getBoundingClientRect();
      return {offset:parseFloat(getComputedStyle(document.querySelector('.lyrics-panel')).left), centered:Math.abs(active.left + active.width / 2 - lyrics.left - lyrics.width / 2) < 3};
    });
    assert.ok(lyricGeometry.offset <= -16 && lyricGeometry.centered, 'The entire lyric column moves left while its text remains centered');
    report.checks.push('lyrics move left while preserving centered alignment');
    await transitionFrames('推荐', 'player-to-home');
    const roundTrip = await page.evaluate(() => window.__motionChecks.slice(0, 2));
    assert.ok(roundTrip.every(record => record.ready && record.finished && record.shared), 'Both directions use a successful shared-artwork view transition');
    report.checks.push('home and player exchange the same loaded artwork in both directions');
    report.checks.push('8%, 50%, and 90% native transition frames retain fixed full-size glass geometry, configured alpha, and actual edge pixels');

    // Interrupt before and after a snapshot callback; the final click must always win.
    await page.evaluate(async () => {
      for (const label of ['正在播放', '推荐', '正在播放', '推荐', '正在播放', '推荐']) {
        document.querySelector(`nav button[aria-label="${label}"]`).click();
        await new Promise(resolve => setTimeout(resolve, 35));
      }
    });
    await settled();
    assert.equal(await page.locator('.page-host:not([hidden])').getAttribute('data-page'), 'home');
    assert.equal(await page.locator('[style*="view-transition-name"]').count(), 0);
    assert.equal(await page.getByRole('button', {name:'暂停', exact:true}).count(), 1, 'Audio remains playing across interrupted navigation');
    report.checks.push('rapid navigation lands on the final page, keeps audio playing, and clears snapshot names');

    for (const width of [1100, 800, 980]) {
      await app.evaluate(({BrowserWindow}, width) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(width, 720), width);
      await page.locator('.home-library-card').scrollIntoViewIfNeeded();
      // Large counts reveal the original cramped-number layout even with a small fixture library.
      await page.locator('.home-library-numbers strong').evaluateAll(nodes => { nodes[0].textContent = '128,640'; nodes[1].textContent = '2,048'; });
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('.home-library-card');
        const list = document.querySelector('.home-frequent');
        const box = card.getBoundingClientRect(), other = list.getBoundingClientRect();
        const overlaps = box.left < other.right - 1 && box.right > other.left + 1 && box.top < other.bottom - 1 && box.bottom > other.top + 1;
        const children = [...card.children].map(element => element.getBoundingClientRect());
        const escaped = [...card.querySelectorAll('*')].some(element => { const rect = element.getBoundingClientRect(); return rect.left < box.left - 1 || rect.right > box.right + 1; });
        const intersecting = children.some((a, index) => children.slice(index + 1).some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
        return {width:innerWidth, overlaps, escaped, intersecting, stacked:box.top >= other.bottom};
      });
      report.layouts.push(geometry);
      assert.equal(geometry.overlaps || geometry.escaped || geometry.intersecting, false, 'Collection card and large counts must not overlap or overflow');
      await capture(`collection-summary-${width}`);
    }
    report.checks.push('collection summary stays separate and large counts fit at 800, 980, and 1100 widths');
    const previousScroll = await page.locator('.home-page').evaluate(element => element.scrollTop);
    await nav.getByRole('button', {name:'正在播放', exact:true}).click(); await settled();
    await nav.getByRole('button', {name:'推荐', exact:true}).click(); await settled();
    assert.equal(await page.locator('.home-page').evaluate(element => element.scrollTop), previousScroll, 'Returning preserves the recommendation scroll position');
    assert.equal(await page.evaluate(() => window.__motionChecks.at(-1).shared), false, 'Offscreen artwork must not fly across the foreground');
    report.checks.push('scrolled pages keep their position and skip offscreen artwork travel');
    await page.locator('.home-page').evaluate(element => { element.scrollTop = 0; });

    // Keep the real transparency setting low enough to reveal a moving or
    // duplicated background. A short settings panel must still have a full host.
    await nav.getByRole('button', {name:'设置', exact:true}).click(); await settled();
    await page.getByRole('tab', {name:'外观', exact:true}).click();
    const follow = page.locator('.setting-row').filter({hasText:'全局背景跟随封面'}).locator('input[type="checkbox"]');
    if (await follow.isChecked()) await follow.uncheck();
    await page.getByRole('slider', {name:'界面透明度', exact:true}).evaluate(element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '37');
      element.dispatchEvent(new Event('input', {bubbles:true}));
    });
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--glass-opacity')) === .37);
    await page.waitForTimeout(800);
    await nav.getByRole('button', {name:'音乐统计', exact:true}).click(); await settled();
    await page.locator('.page-host[data-page="stats"] > .panel').waitFor();
    await nav.getByRole('button', {name:'设置', exact:true}).click(); await settled();
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(1480, 900));
    await page.waitForFunction(() => innerWidth === 1480);
    const shortPanel = await surface();
    assert.ok(shortPanel.panel.width < shortPanel.host.width - 100, 'The bounded settings panel is narrower than the full transition viewport');
    await transitionFrames('音乐列表', 'settings-to-library-wide');
    await transitionFrames('音乐统计', 'library-to-stats-wide');
    await transitionFrames('设置', 'stats-to-settings-wide');
    report.checks.push('different panel widths and scrolling pages retain the complete glass viewport at 37% opacity');

    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(800, 500));
    await page.waitForFunction(() => innerWidth === 800 && innerHeight === 500);
    await transitionFrames('正在播放', 'settings-to-player-small');
    await transitionFrames('推荐', 'player-to-home-small');
    const homeOverflow = await page.locator('.home-page').evaluate(element => { element.scrollTop = element.scrollHeight; return {top:element.scrollTop,height:element.clientHeight,total:element.scrollHeight}; });
    assert.ok(homeOverflow.top > 0 && homeOverflow.total > homeOverflow.height, 'The small-window recommendation is genuinely scrolled');
    await transitionFrames('设置', 'scrolled-home-to-settings-small');
    await transitionFrames('推荐', 'settings-to-scrolled-home-small');
    assert.equal(await page.locator('.home-page').evaluate(element => element.scrollTop), homeOverflow.top);
    await page.evaluate(async () => {
      window.__rapidSurfaces = [];
      let running = true;
      const sample = () => {
        const main = document.querySelector('.main-content'), rect = main.getBoundingClientRect(), style = getComputedStyle(main);
        window.__rapidSurfaces.push({width:rect.width,height:rect.height,x:rect.x,y:rect.y,transform:style.transform,opacity:style.opacity,background:style.backgroundColor});
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      for (const label of ['正在播放','音乐列表','设置','推荐','正在播放','音乐统计','推荐']) {
        document.querySelector(`nav button[aria-label="${label}"]`).click();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await new Promise(resolve => setTimeout(resolve, 700)); running = false;
    });
    await settled();
    const rapid = await page.evaluate(() => window.__rapidSurfaces);
    assert.ok(rapid.length >= 10, 'Rapid switching samples real display frames');
    assert.ok(rapid.every(value => value.transform === 'none' && value.opacity === '1' && value.background === rapid[0].background && Math.abs(value.width - rapid[0].width) < 1 && Math.abs(value.height - rapid[0].height) < 1), 'Fast navigation preserves stationary glass on every measured frame');
    assert.equal(await page.locator('.page-host:not([hidden])').getAttribute('data-page'), 'home');
    assert.equal(await page.getByRole('button', {name:'暂停', exact:true}).count(), 1);
    await capture('rapid-small-settled'); report.rapidFrames = rapid;
    report.checks.push('800×500 mid-transition pixels and rapid page changes keep edges covered, scrolling intact, and music playing');

    // Exercise the non-native path too. Freeze its real content animations at
    // their midpoint; the panel/scroll viewport must never be one of the targets.
    await page.evaluate(() => { window.__nativePageTransition = document.startViewTransition; document.startViewTransition = undefined; });
    const fallback = await page.evaluate(async () => {
      document.querySelector('nav button[aria-label="音乐列表"]').click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const host = document.querySelector('.page-host:not([hidden])'), panel = host.querySelector(':scope > .panel');
      const animations = document.getAnimations().filter(animation => animation.effect?.target instanceof HTMLElement && panel.contains(animation.effect.target) && animation.effect.target !== panel);
      animations.forEach(animation => { animation.pause(); const timing = animation.effect.getTiming(); animation.currentTime = Number(timing.delay) + Number(timing.duration) / 2; });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {count:animations.length,panelAnimations:panel.getAnimations().length,panelTransform:getComputedStyle(panel).transform,panelOpacity:getComputedStyle(panel).opacity,
        hostHeight:host.getBoundingClientRect().height,panelHeight:panel.getBoundingClientRect().height,
        targets:animations.map(animation => ({className:animation.effect.target.className,transform:getComputedStyle(animation.effect.target).transform,progress:animation.effect.getComputedTiming().progress}))};
    });
    assert.ok(fallback.count > 0 && fallback.targets.some(target => target.transform !== 'none'), 'The fallback actually animates content at an intermediate frame');
    assert.equal(fallback.panelAnimations, 0); assert.equal(fallback.panelTransform, 'none'); assert.equal(fallback.panelOpacity, '1');
    assert.ok(Math.abs(fallback.hostHeight - fallback.panelHeight) < 1);
    const fallbackSurface = await surface(), fallbackFile = await capture('fallback-library-midpoint', true);
    fallback.pixels = await pixels(fallbackFile, fallbackSurface.main);
    for (const rgba of Object.values(fallback.pixels)) assert.ok(rgba.a >= .37 * 255 - 6 && Math.max(rgba.r,rgba.g,rgba.b) < 135, 'Fallback edges retain the actual translucent background');
    report.fallback.push(fallback);
    await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'paused').forEach(animation => animation.play()));
    await page.waitForTimeout(350);
    await page.evaluate(() => { document.startViewTransition = window.__nativePageTransition; });
    report.checks.push('the fallback animates content while the scroll panel and real edge pixels stay fixed');

    await page.getByRole('button', {name:'打开播放队列'}).click();
    await page.locator('.player-queue').waitFor();
    await page.waitForTimeout(370);
    await capture('queue-motion-settled');
    await page.getByRole('button', {name:'关闭播放队列'}).click();
    await page.getByRole('button', {name:'打开音效', exact:true}).click();
    await page.getByRole('dialog').waitFor();
    const dialog = await page.getByRole('dialog').evaluate(element => {
      const backdrop = element.parentElement, box = backdrop.getBoundingClientRect(), app = document.querySelector('.app-shell');
      return {outsidePage:!element.closest('.page-host'),parent:backdrop.parentElement.className,x:box.x,y:box.y,width:box.width,height:box.height,
        glass:getComputedStyle(backdrop).getPropertyValue('--glass-opacity'),appGlass:getComputedStyle(app).getPropertyValue('--glass-opacity'),
        accent:getComputedStyle(backdrop).getPropertyValue('--accent'),appAccent:getComputedStyle(app).getPropertyValue('--accent'),focused:element.contains(document.activeElement)};
    });
    assert.ok(dialog.outsidePage && dialog.parent.includes('app-shell') && dialog.focused, 'The dialog lives in the themed app frame and receives focus');
    assert.ok(Math.abs(dialog.x) < 1 && Math.abs(dialog.y) < 1 && Math.abs(dialog.width - 800) < 1 && Math.abs(dialog.height - 500) < 1, 'The modal backdrop covers the complete small-window viewport');
    assert.equal(dialog.glass,dialog.appGlass); assert.equal(dialog.accent,dialog.appAccent);
    report.dialog = dialog;
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.getByRole('dialog').evaluate(element => element.contains(document.activeElement)), 'Modal focus remains trapped after Shift+Tab');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button', {name:'打开音效', exact:true}).evaluate(element => element === document.activeElement), true, 'Closing restores the effects trigger focus');
    report.checks.push('queue and effects dialog close correctly, inherit the live theme, cover the viewport, trap focus, and restore it on Escape');

    await page.getByRole('button', {name:'选择当前歌曲的收藏歌单', exact:true}).click();
    const picker = page.getByRole('dialog', {name:'选择歌单', exact:true});
    await picker.waitFor();
    await picker.getByRole('button', {name:'新建歌单', exact:true}).click();
    const prompt = page.getByRole('dialog', {name:'新建歌单', exact:true});
    await prompt.waitFor();
    await page.waitForTimeout(350);
    const nested = await prompt.evaluate(element => {
      const outer = document.querySelector('#player-collection-dialog');
      // React may append a newly opened global prompt after an existing portal.
      // Exercise the problematic ordering explicitly rather than depending on
      // insertion timing: visual stacking and keyboard ownership must agree.
      const active = document.activeElement;
      const beforeMoveFocused = element.contains(active), activeTag = active?.tagName;
      const promptWasBeforeOuter = !!(element.compareDocumentPosition(outer) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (!promptWasBeforeOuter) outer.parentElement.parentElement.insertBefore(element.parentElement,outer.parentElement);
      // Moving a focused subtree can blur its input. Restore only that original
      // focus so the ordering probe does not create an unrelated production bug.
      const focusLostByMove = beforeMoveFocused && !element.contains(document.activeElement);
      if (focusLostByMove && active instanceof HTMLElement) active.focus({preventScroll:true});
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2,box.y + box.height / 2);
      return {promptZ:Number(getComputedStyle(element.parentElement).zIndex),outerZ:Number(getComputedStyle(outer.parentElement).zIndex),
        hitPrompt:element.contains(hit),focused:element.contains(document.activeElement),
        beforeMoveFocused,activeTag,focusLostByMove,promptWasBeforeOuter,promptBeforeOuter:!!(element.compareDocumentPosition(outer) & Node.DOCUMENT_POSITION_FOLLOWING)};
    });
    report.nestedDialog = nested;
    assert.ok(nested.beforeMoveFocused, 'Opening the production prompt automatically focuses its own input before any test DOM reordering');
    assert.ok(nested.promptBeforeOuter, 'The regression exercises the global prompt before its portaled outer dialog in DOM order');
    assert.ok(nested.promptZ > nested.outerZ && nested.hitPrompt && nested.focused, 'The global prompt is visually and interactively above its outer player dialog');
    await capture('nested-collection-prompt');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await prompt.getByRole('button', {name:'创建', exact:true}).evaluate(element => element === document.activeElement), true, 'Shift+Tab wraps inside the inner prompt');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.getByRole('textbox', {name:'新建歌单', exact:true}).evaluate(element => element === document.activeElement), true, 'Tab returns to the inner prompt input');
    await page.keyboard.press('Escape');
    await prompt.waitFor({state:'hidden'});
    assert.ok(await picker.isVisible(), 'The first Escape closes only the inner prompt');
    assert.equal(await picker.getByRole('button', {name:'新建歌单', exact:true}).evaluate(element => element === document.activeElement), true, 'Inner dismissal restores the outer new-playlist button');
    await picker.getByRole('button', {name:'新建歌单', exact:true}).click();
    await prompt.getByRole('textbox', {name:'新建歌单', exact:true}).fill('切页弹窗回归歌单');
    await prompt.getByRole('button', {name:'创建', exact:true}).click();
    await prompt.waitFor({state:'hidden'});
    const createdCollection = picker.locator('.picker-list label').filter({hasText:'切页弹窗回归歌单'});
    await createdCollection.waitFor();
    assert.equal(await createdCollection.getByRole('checkbox').isChecked(), true, 'The actual created playlist immediately contains the playing song');
    assert.match(await createdCollection.locator('.muted').innerText(), /^1\s*首$/, 'The new playlist reports its actual song count');
    assert.ok(await picker.isVisible(), 'Creating a playlist preserves the outer picker');
    await page.keyboard.press('Escape');
    await picker.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button', {name:'选择当前歌曲的收藏歌单', exact:true}).evaluate(element => element === document.activeElement), true, 'The second Escape closes the outer picker and restores its entry');
    report.checks.push('nested global prompts override portal DOM order, trap their own focus, dismiss independently, and allow actual playlist creation');

    await page.emulateMedia({reducedMotion:'reduce'});
    const count = await page.evaluate(() => window.__motionChecks.length);
    await nav.getByRole('button', {name:'正在播放', exact:true}).click();
    await nav.getByRole('button', {name:'推荐', exact:true}).click();
    assert.equal(await page.evaluate(() => window.__motionChecks.length), count, 'Reduced motion bypasses all native page transitions');
    report.checks.push('reduced motion switches directly with no snapshot transition');
    report.transitions = await page.evaluate(() => window.__motionChecks);
    assert.deepEqual(errors, []);
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error);
    if (page) await page.screenshot({path:path.join(artifacts, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await app.evaluate(({app}) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
  }
  console.log(JSON.stringify({ok:report.ok,checks:report.checks,report:path.join(artifacts,'report.json'),screenshotsCount:report.screenshots.length}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
