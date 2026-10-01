// Real Electron review of the persistent scroll rail and player surface details.
// Media, profile, screenshots, and recordings are isolated in .test-artifacts.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'detail');
fs.mkdirSync(artifacts, {recursive:true});
const report = {checks:[], screenshots:[], railTransitions:[], surfaces:[], recording:null};

function railSnapshot() {
  const rail = document.querySelector('.page-scroll-rail'), thumb = rail?.querySelector('.page-scroll-thumb');
  if (!rail || !thumb) return null;
  const box = rail.getBoundingClientRect(), css = getComputedStyle(thumb), clipping = css.clipPath.match(/calc\([^)]*\)|-?\d*\.?\d+(?:px|%)/g);
  const height = thumb.getBoundingClientRect().height;
  const terms = clipping?.[2]?.replace(/\s/g, '').match(/[+-]?(?:\d*\.)?\d+(?:px|%)/g) || [];
  const bottom = terms.reduce((sum, term) => sum + parseFloat(term) * (term.endsWith('%') ? height / 100 : 1), 0);
  const shift = css.transform === 'none' ? 0 : new DOMMatrixReadOnly(css.transform).m42;
  return {page:document.querySelector('.page-host:not([hidden])')?.dataset.page,
    markerY:document.querySelector('.nav-selection-marker')?.getBoundingClientRect().y,
    railY:box.y, railHeight:box.height, thumbY:box.y + shift, thumbSize:Math.max(0, height - bottom), clipPath:css.clipPath,
    opacity:Number(getComputedStyle(rail).opacity), visible:rail.getAttribute('aria-hidden') !== 'true',
    value:Number(rail.getAttribute('aria-valuenow')), maximum:Number(rail.getAttribute('aria-valuemax'))};
}

function requireIntermediateFrames(samples, property, message) {
  const begin = samples[0][property], end = samples.at(-1)[property];
  assert.ok(Math.abs(begin - end) > 4, message + ': the endpoints must differ');
  const low = Math.min(begin, end), high = Math.max(begin, end);
  const intermediate = samples.filter(sample => sample[property] > low + .5 && sample[property] < high - .5);
  assert.ok(new Set(intermediate.map(sample => sample[property].toFixed(2))).size >= 2, message + ': actual rendered frames must pass through intermediate values');
}

(async () => {
  const launch = {executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
    env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:'1', WUU_PLAYER_POLISH_FIXTURE:'', WUU_COVER_STARTUP:'', WUU_REVIEW_PROFILE:'detail'},
    recordVideo:{dir:artifacts, size:{width:1100, height:650}}, timeout:30000};
  let app, page, video;
  try {
    try { app = await electron.launch(launch); }
    catch (error) {
      if (!/ffmpeg|video recording|executable doesn't exist/i.test(error.message)) throw error;
      report.recordingUnavailable = error.message;
      const {recordVideo, ...withoutVideo} = launch;
      app = await electron.launch(withoutVideo);
    }
    for (let attempt = 0; attempt < 200; attempt++) {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'The real Electron renderer loads');
    video = page.video();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(1100, 650));
    await page.emulateMedia({reducedMotion:'no-preference', colorScheme:'dark'});
    const nav = page.getByRole('navigation', {name:'主导航'});
    await nav.waitFor(); await page.getByRole('button', {name:'暂停', exact:true}).waitFor();
    const settled = async () => { await page.waitForFunction(() => !document.documentElement.dataset.pageTransition); await page.waitForTimeout(430); };
    const go = async name => { await nav.getByRole('button', {name, exact:true}).click(); await settled(); };
    const capture = async name => { const file = path.join(artifacts, name + '.png'); await page.screenshot({path:file}); report.screenshots.push(file); };
    await go('正在播放');
    assert.equal(await page.getByRole('button', {name:'打开音效', exact:true}).count(), 1, 'There is only one visible audio-effects entry');
    assert.equal(await page.locator('.player-page > .listening-header').count(), 0, 'The player removes its redundant status header');
    await capture('player-control-hierarchy');
    report.checks.push('player removes its redundant status header; one bottom-right effects entry remains');

    // Warm lazy pages so the measurements concern navigation, not first network/module loading.
    await go('设置'); await go('音乐列表'); await go('推荐');
    await page.getByRole('scrollbar', {name:'页面滚动'}).waitFor();
    const rail = page.locator('.page-scroll-rail');
    await rail.focus(); await page.keyboard.press('End'); await page.waitForTimeout(450);
    let position = await page.locator('.home-page').evaluate(element => element.scrollTop);
    assert.ok(position > 0, 'The persistent rail keyboard scrolls the active recommendation panel');
    await page.keyboard.press('Home'); await page.keyboard.press('PageDown'); await page.waitForTimeout(450);
    position = await page.locator('.home-page').evaluate(element => element.scrollTop);
    assert.ok(position > 0, 'PageDown remains usable after Home');
    report.checks.push('scroll rail supports Home, End, and PageDown on the active native scroll area');

    const sampleRoute = async (name, duration = 780) => {
      const result = await page.evaluate(async ({name, duration, snapshot}) => {
        const state = (0, eval)('(' + snapshot + ')');
        const frames = [{elapsed:0, ...state()}], started = performance.now();
        document.querySelector(`nav button[aria-label="${name}"]`).click();
        while (performance.now() - started < duration) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          frames.push({elapsed:performance.now() - started, ...state()});
        }
        return frames;
      }, {name, duration, snapshot:railSnapshot.toString()});
      report.railTransitions.push({to:name, frames:result}); return result;
    };
    let frames = await sampleRoute('音乐列表');
    assert.ok(frames.at(-1).visible, 'The library has its own scrollable viewport');
    requireIntermediateFrames(frames, 'railY', 'Recommendation-to-library rail placement');
    requireIntermediateFrames(frames, 'thumbSize', 'Recommendation-to-library thumb size');
    requireIntermediateFrames(frames, 'markerY', 'Sidebar selection indicator');
    await capture('library-scroll-rail');
    frames = await sampleRoute('设置');
    assert.ok(frames.at(-1).visible, 'The long settings panel remains scrollable');
    requireIntermediateFrames(frames, 'railY', 'Library-to-settings rail placement');
    if (Math.abs(frames[0].thumbSize - frames.at(-1).thumbSize) > 4) requireIntermediateFrames(frames, 'thumbSize', 'Library-to-settings thumb size');
    await capture('settings-scroll-rail');
    report.checks.push('persistent right rail, thumb, and sidebar selection indicator render continuous intermediate positions across pages');

    // Drag near the end of a long settings page, then bring it back with the same native target.
    const dragBox = await rail.boundingBox();
    const beforeDrag = Number(await rail.getAttribute('aria-valuenow'));
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 10);
    await page.mouse.down(); await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height * .72, {steps:10}); await page.mouse.up();
    await page.waitForTimeout(70);
    assert.ok(Number(await rail.getAttribute('aria-valuenow')) > beforeDrag + 100, 'Dragging changes real panel scrollTop');
    await rail.focus(); await page.keyboard.press('Home');
    await go('推荐');
    assert.equal(await page.locator('.home-page').evaluate(element => element.scrollTop), position, 'Recommendation scroll position survives several different page visits');
    report.checks.push('rail dragging moves the real page and returning preserves recommendation scroll position');
    frames = await sampleRoute('正在播放', 600);
    assert.equal(frames.at(-1).visible, false, 'A listening page without page overflow removes the rail');
    assert.ok(frames.some(frame => frame.opacity > .02 && frame.opacity < frames[0].opacity - .02), 'The rail fades out through real intermediate opacity values');
    assert.equal(frames.at(-1).opacity, 0, 'The rail becomes fully transparent after its exit');
    await page.evaluate(async () => {
      for (const label of ['推荐', '音乐列表', '设置', '正在播放', '推荐', '设置', '正在播放']) {
        document.querySelector(`nav button[aria-label="${label}"]`).click();
        await new Promise(resolve => setTimeout(resolve, 35));
      }
    });
    await settled();
    assert.equal(await page.locator('.page-host:not([hidden])').getAttribute('data-page'), 'player');
    assert.equal(await rail.getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.page-scroll-rail').count(), 1, 'Rapid page switches keep one persistent rail');
    report.checks.push('non-overflow rail fades away and rapid page changes end on the final page without duplicate rails');

    const fxButton = page.getByRole('button', {name:'打开音效', exact:true});
    await fxButton.click();
    const fx = page.locator('#player-fx-dialog');
    await page.waitForTimeout(320);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭音效', 'A modal starts focus on a useful control');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '重置', 'Shift+Tab wraps focus to the last modal control');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭音效', 'Tab wraps focus back inside the modal');
    await fx.getByRole('slider', {name:'均衡器频段 7 增益', exact:true}).focus();
    assert.equal(await fx.locator('.fx-band-detail strong').textContent(), '频段 7');
    assert.equal(await fx.locator('.fx-band.selected input').getAttribute('aria-label'), '均衡器频段 7 增益');
    await fx.getByRole('textbox', {name:'音效方案名称', exact:true}).fill('保留我的音效草稿');
    report.checks.push('effects modal traps keyboard focus and focusing an equalizer band updates its matching detail panel');
    const sampleClose = async selector => page.evaluate(async selector => {
      const surface = document.querySelector(selector), frames = [], started = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
      while (performance.now() - started < 230) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const css = getComputedStyle(surface);
        frames.push({elapsed:performance.now() - started, state:surface.dataset.state, hidden:surface.hidden, opacity:Number(css.opacity), inert:surface.inert, pointerEvents:css.pointerEvents});
      }
      return frames;
    }, selector);
    const sampleReopen = async (selector, trigger) => {
      const frames = await page.evaluate(async ({selector, trigger}) => {
        const surface = document.querySelector(selector), frames = [], started = performance.now();
        let reopened = false;
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
        while (performance.now() - started < 430) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const elapsed = performance.now() - started;
          if (elapsed >= 110 && !reopened) { document.querySelector(`button[aria-label="${trigger}"]`).click(); reopened = true; }
          const css = getComputedStyle(surface);
          frames.push({elapsed, state:surface.dataset.state, hidden:surface.hidden, opacity:Number(css.opacity), transform:css.transform});
        }
        return frames;
      }, {selector, trigger});
      report.surfaces.push({name:trigger + ' interrupted close/reopen', frames});
      const closing = frames.filter(frame => frame.state === 'closing'), opening = frames.filter(frame => frame.state === 'open');
      assert.ok(closing.some(frame => frame.opacity > .05 && frame.opacity < .98), 'The close was actually in progress before reversal');
      assert.ok(opening.some(frame => frame.opacity > .05 && frame.opacity < .98), 'Reopening continues through visible intermediate opacity');
      assert.ok(opening[0].opacity > closing.at(-1).opacity - .15, 'Reopening does not reset opacity to zero');
      assert.equal(opening.at(-1).hidden, false, 'The cancelled close does not hide the reopened surface');
      assert.ok(opening.at(-1).opacity > .98, 'The reversed transition finishes fully visible');
      return frames;
    };
    let closeFrames = await sampleClose('.player-dialog-surface:has(#player-fx-dialog)');
    report.surfaces.push({name:'effects Escape close', frames:closeFrames});
    assert.ok(closeFrames.some(frame => frame.state === 'closing' && !frame.hidden && frame.opacity > .02 && frame.opacity < .98), 'Effects close renders a visible intermediate exit frame');
    assert.ok(closeFrames.filter(frame => frame.state === 'closing').every(frame => frame.inert && frame.pointerEvents === 'none'), 'Closing modal stops intercepting interactions immediately');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '打开音效', 'Escape returns focus to the original effects trigger');
    assert.equal(closeFrames.at(-1).hidden, true, 'The effects surface is hidden after the exit completes');
    await fxButton.click(); await page.waitForTimeout(320);
    await sampleReopen('.player-dialog-surface:has(#player-fx-dialog)', '打开音效');
    assert.equal(await fx.getAttribute('aria-hidden'), 'false', 'Reopening before the close completes cancels the pending hide');
    assert.equal(await fx.getByRole('textbox', {name:'音效方案名称', exact:true}).inputValue(), '保留我的音效草稿', 'Interrupted close preserves the draft');
    assert.equal(await fx.locator('.fx-band-detail strong').textContent(), '频段 7', 'Interrupted close preserves the selected band');
    await capture('effects-keyboard-and-preserved-draft');
    await page.keyboard.press('Escape'); await page.waitForTimeout(230);
    report.checks.push('effects Escape renders exit frames, returns focus, and a rapid reopen preserves draft and selected band');

    const queueButton = page.getByRole('button', {name:'打开播放队列', exact:true});
    await queueButton.click(); await page.waitForTimeout(330);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭播放队列');
    closeFrames = await sampleClose('#player-queue');
    report.surfaces.push({name:'queue Escape close', frames:closeFrames});
    assert.ok(closeFrames.some(frame => frame.state === 'closing' && !frame.hidden && frame.opacity > .02 && frame.opacity < .98), 'Queue close renders a visible intermediate exit frame');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '打开播放队列');
    assert.equal(closeFrames.at(-1).hidden, true);
    await queueButton.click(); await page.waitForTimeout(330);
    await sampleReopen('#player-queue', '打开播放队列');
    assert.equal(await page.locator('#player-queue').getAttribute('data-state'), 'open');
    await capture('queue-rapid-reopen');
    await fxButton.click(); await page.waitForTimeout(320);
    assert.equal(await page.locator('#player-queue').getAttribute('data-state'), 'closed', 'Opening effects dismisses the previous queue');
    await page.keyboard.press('Escape'); await page.waitForTimeout(230);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '打开音效', 'Closing effects opened from a queue still restores the effects trigger');
    report.checks.push('queue Escape renders exit frames and returns focus; rapid reopen cancels its pending disappearance');

    const volume = page.getByRole('slider', {name:'音量', exact:true});
    await volume.focus(); await page.keyboard.press('Home');
    for (let press = 0; press < 35; press++) await page.keyboard.press('ArrowRight');
    assert.equal(Number(await volume.inputValue()), .35);
    await page.getByRole('button', {name:'静音', exact:true}).click(); assert.equal(Number(await volume.inputValue()), 0);
    await page.getByRole('button', {name:'取消静音', exact:true}).click(); assert.equal(Number(await volume.inputValue()), .35);
    report.checks.push('muting and unmuting restores the actual previous 35% listening volume');
    await page.emulateMedia({reducedMotion:'reduce'});
    await go('推荐'); await go('正在播放');
    assert.equal(await rail.getAttribute('aria-hidden'), 'true');
    assert.ok(await rail.evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) < .001)), 'Reduced-motion rail transitions finish in less than one millisecond');
    await fxButton.click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.player-dialog-surface:has(#player-fx-dialog)').hidden);
    assert.deepEqual(errors, [], 'All details work without renderer exceptions');
    report.checks.push('reduced motion disables rail transitions and closes surfaces directly without renderer errors');
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error);
    console.error(report.error);
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (page) await page.screenshot({path:path.join(artifacts, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    let sourceVideo;
    if (video) sourceVideo = await video.path().catch(() => null);
    if (app) await Promise.race([app.context().close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (app) await app.evaluate(({app}) => app.exit(0)).catch(() => {});
    if (app) await app.close().catch(() => {});
    if (sourceVideo && fs.existsSync(sourceVideo)) {
      const output = path.join(artifacts, 'detail-interactions.webm');
      fs.copyFileSync(sourceVideo, output); report.recording = output;
    }
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ok:report.ok, checks:report.checks, screenshots:report.screenshots, recording:report.recording, report:path.join(artifacts, 'report.json')}, null, 2));
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
