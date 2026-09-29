// Offline visual/accessibility review using real Electron windows and isolated fixture IPC.
// Run after npm run build:desktop. Set WUU_VISUAL_EMPTY=1 to also capture empty states.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'visual');
fs.mkdirSync(artifacts, { recursive:true });
const results = [];
const screenshots = [];

async function review(empty = false) {
  const app = await electron.launch({
    executablePath:require('electron'), args:[path.join(__dirname, 'smoke-main.cjs')], cwd:root,
    env:{...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_VISUAL_FIXTURE:empty ? 'empty' : '1'}, timeout:30000,
  });
  const errors = [];
  try {
    let page;
    for (let attempt = 0; attempt < 200; attempt++) {
      page = app.windows().find(window => window.url() && window.url() !== 'about:blank' && !window.url().includes('window=lyrics'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'The React main window must load');
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({colorScheme:'light', reducedMotion:'reduce'});
    const nav = page.getByRole('navigation', {name:'主导航'});
    await nav.waitFor();
    if (!empty) await page.getByRole('button', {name:'暂停', exact:true}).waitFor({timeout:15000});

    async function resize(width, height) {
      // Frameless DWM windows may round by one CSS pixel at 150% scaling.
      let outerWidth = width, outerHeight = height;
      for (let attempt = 0; attempt < 4; attempt++) {
        await app.evaluate(({BrowserWindow}, size) => {
          BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('window=lyrics')).setSize(size.width, size.height);
        }, {width:outerWidth, height:outerHeight});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const viewport = await page.evaluate(() => ({width:innerWidth, height:innerHeight}));
        if (viewport.width === width && viewport.height === height) return;
        outerWidth += width - viewport.width;
        outerHeight += height - viewport.height;
      }
      await page.waitForFunction(size => Math.abs(innerWidth-size.width) <= 2 && Math.abs(innerHeight-size.height) <= 2, {width,height});
    }

    async function capture(name, route) {
      await nav.getByRole('button', {name:route, exact:true}).click();
      const active = page.locator('.page-host:not([hidden])');
      await active.getByRole('heading').first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('img')].filter(image => image.getClientRects().length).map(image => image.decode().catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const layout = await page.evaluate(() => {
        const selectors = ['html', 'body', '.app-shell', '.workspace', '.main-content', '.page-host:not([hidden])', '.page-host:not([hidden]) > .panel', '.player-bar'];
        const overflow = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2).map(element => ({selector, scrollWidth:element.scrollWidth, width:element.clientWidth})));
        const controls = ['播放', '音效', '桌面歌词', '音量', '队列'].map(name => {
          const query = {
            '播放':'button[aria-label="暂停"], button[aria-label="播放"]', '音效':'button[aria-label="打开音效"]',
            '桌面歌词':'button[aria-label="打开桌面歌词"], button[aria-label="关闭桌面歌词"]', '音量':'input[aria-label="音量"]',
            '队列':'button[aria-label="打开播放队列"]',
          }[name];
          const control = document.querySelector('.player-bar')?.querySelector(query);
          const rect = control?.getBoundingClientRect();
          const visible = !!rect && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
          return {name,visible};
        });
        return {width:innerWidth, height:innerHeight, overflow, controls, playButtonVisible:controls[0].visible};
      });
      const file = path.join(artifacts, name + '.png');
      await page.screenshot({path:file});
      screenshots.push(file);
      results.push({name, ...layout});
      console.log(JSON.stringify({name, ...layout}));
    }

    for (const [width, height] of [[1100,720], [800,500]]) {
      await resize(width, height);
      for (const [name, route] of [['home','推荐'], ['library','音乐列表'], ['player','正在播放'], ['settings','设置']]) {
        await capture(`${empty ? 'empty-' : ''}${name}-${width}x${height}`, route);
      }
    }

    if (!empty) {
      await nav.getByRole('button', {name:'音乐列表', exact:true}).click();
      const trigger = page.getByRole('button', {name:'更多 海岸慢车 操作', exact:true});
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', {name:'海岸慢车 的操作', exact:true});
      await menu.waitFor();
      const first = menu.getByRole('menuitem', {name:'添加到歌单', exact:true});
      assert.equal(await first.evaluate(element => element === document.activeElement), true, 'Opening the menu moves keyboard focus into it');
      await page.keyboard.press('ArrowDown');
      assert.equal(await menu.getByRole('menuitem', {name:'分享歌曲', exact:true}).evaluate(element => element === document.activeElement), true, 'Arrow keys move through song actions');
      await page.keyboard.press('ArrowUp');
      assert.equal(await first.evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Escape');
      await menu.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the menu trigger');
      const playingBefore = await page.locator('.player-bar button[aria-label="暂停"]').count();
      await page.getByRole('button', {name:'刷新歌库', exact:true}).focus();
      await page.keyboard.press('Space');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('.player-bar button[aria-label="暂停"]').count(), playingBefore, 'Space on a focused button must not toggle playback');
      assert.equal(playingBefore, 1, 'Playback remains active throughout navigation');
      await page.locator('.toast').waitFor({state:'hidden'});
      await resize(1200,800);
      await capture('home-1200x800', '推荐');
      await page.emulateMedia({colorScheme:'dark', reducedMotion:'reduce'});
      await resize(1100,720);
      await capture('home-dark-1100x720', '推荐');
      await capture('player-dark-1100x720', '正在播放');
      console.log('Passed: keyboard menu, Escape focus restoration, Space preserves playback on a focused button');
    }
    assert.deepEqual(errors, [], 'Renderer must not report errors');
  } finally {
    await app.evaluate(({app}) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

(async () => {
  await review();
  if (process.env.WUU_VISUAL_EMPTY === '1') await review(true);
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify({results, screenshots}, null, 2));
  const failed = results.filter(result => result.overflow.length || result.controls.some(control => !control.visible));
  assert.deepEqual(failed, [], 'Screens must have no horizontal overflow and keep all playback controls visible');
  console.log(JSON.stringify({ok:true, screenshots, report:path.join(artifacts, 'report.json')}));
})().catch(error => { console.error(error); process.exitCode = 1; });
