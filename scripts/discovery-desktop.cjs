// Real production Electron UI and bridge, with isolated catalog/media IPC.
const { _electron: electron } = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'discovery');
fs.mkdirSync(artifacts, { recursive: true });
const report = { ok:false, checks:[], batches:[], screenshots:[], errors:[] };

async function run(empty) {
  let app;
  try {
    app = await electron.launch({ executablePath:require('electron'), args:[path.join(__dirname,'smoke-main.cjs')], cwd:root,
      env:{ ...process.env, WUU_RENDERER_URL:'', WUU_SMOKE_PACKAGED:'0', WUU_PLAYER_POLISH_FIXTURE:'0', WUU_COVER_STARTUP:'', WUU_VISUAL_FIXTURE:empty?'empty':'1', WUU_REVIEW_PROFILE:empty?'discovery-empty':'discovery' }, timeout:30000 });
    await app.firstWindow();
    let page;
    for(let attempt=0;attempt<200;attempt++){
      page=app.windows().find(window=>window.url().includes('index.html')&&!window.url().includes('window=lyrics'));
      if(page)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(page,'The production main renderer must load');
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.getByRole('navigation', { name:'主导航' }).waitFor();
    await page.evaluate(() => { localStorage.setItem('sqet-current-view','home'); });
    await page.reload();
    const nav = page.getByRole('navigation', { name:'主导航' });
    await nav.waitFor();
    const home = page.locator('.home-page');
    const cards = home.locator('.home-discovery .home-album-card');
    const batch = () => cards.locator(':scope > strong').allTextContents();
    const ready = () => page.waitForFunction(() => document.querySelectorAll('.home-discovery .home-album-card').length === 4 && document.querySelector('.home-discovery').getAttribute('aria-busy') === 'false');
    const go = async name => { await nav.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition); };
    const capture = async label => {const file=path.join(artifacts,label+'.png');await page.screenshot({path:file});report.screenshots.push(file);};
    await ready();
    const first = await batch();
    report.batches.push({empty,first});
    const local = await app.evaluate(()=>global.__wuuSmoke.songs.map(song=>song.songName));
    assert.equal(first.length,4);assert.ok(first.every(name=>!local.includes(name)));
    assert.equal(new Set(first).size,4);
    await capture(empty?'empty-library-discovery':'outside-library-discovery');
    if(empty) {
      assert.equal(await home.locator('.home-hero').count(),0);
      assert.ok(await home.getByRole('button',{name:'导入音乐',exact:true}).isVisible());
      report.checks.push('an empty music library still displays four external songs and an import entry');
      return;
    }
    report.checks.push('the provider deliberately returns an existing local song; all four displayed recommendations are external and unique');

    await app.evaluate(()=>{global.__wuuSmoke.discovery.failNext=true;});
    await home.getByRole('button',{name:'换一批',exact:true}).click();
    await home.getByRole('alert').filter({hasText:'测试网络暂时不可用'}).waitFor();
    assert.deepEqual(await batch(),first);
    await home.getByRole('button',{name:'再试一次',exact:true}).click();await ready();
    const second=await batch();report.batches.push({second});assert.ok(second.every(name=>!first.includes(name)));
    assert.equal(await home.getByRole('alert').count(),0);
    report.checks.push('network failure retains the last usable batch; retry replaces it with previously unseen songs');

    await app.evaluate(()=>{global.__wuuSmoke.discovery.previewDelayMs=650;});
    await cards.nth(0).click();await cards.nth(1).click();
    await page.waitForFunction(()=>document.querySelector('.page-host[data-page="player"]')?.hidden===false);
    await page.waitForFunction(name=>document.querySelector('.player-artwork .record-info h1')?.textContent===name,second[1]);
    assert.equal(await page.locator('.player-artwork .record-info').count(),1);
    const played=await app.evaluate(()=>({requests:global.__wuuSmoke.discovery.previewRequests,saves:global.__wuuSmoke.discovery.saveRequests,local:global.__wuuSmoke.songs.length}));
    assert.ok(played.requests.length>=2&&played.requests.every(item=>item.quality==='standard'));
    assert.equal(played.saves.length,0);assert.equal(played.local,local.length);
    await capture('latest-preview-wins');
    report.checks.push('two rapid preview requests play the latest selected song without importing it or piling up information blocks');

    await page.getByRole('button',{name:'保存到歌库',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.toasts')?.textContent?.includes('已保存到歌库') || document.body.textContent.includes('已保存到歌库'));
    const saved=await app.evaluate(()=>global.__wuuSmoke.discovery.saveRequests);
    assert.equal(saved.length,1);assert.equal(saved[0].quality,'standard');
    await go('推荐');
    await page.waitForFunction(name=>![...document.querySelectorAll('.home-discovery .home-album-card > strong')].some(node=>node.textContent===name),second[1]);
    assert.equal(await cards.count(),3);
    report.checks.push('explicit saving imports once through standard quality and immediately removes the newly local song from discovery');

    await app.evaluate(()=>{global.__wuuSmoke.discovery.previewDelayMs=0;global.__wuuSmoke.discovery.previewFailure=true;});
    await cards.first().click();
    await home.getByRole('alert').filter({hasText:'这首歌暂时无法试听'}).waitFor();
    assert.ok(await home.isVisible());
    await app.evaluate(()=>{global.__wuuSmoke.discovery.previewFailure=false;global.__wuuSmoke.discovery.previewDelayMs=800;});
    await cards.first().click();await go('设置');await page.waitForTimeout(1100);
    assert.ok(await page.locator('.settings-page').isVisible());
    report.checks.push('failed previews stay on discovery; a pending preview cannot force navigation after the user opens Settings');
  } finally {
    if(app) { await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{}); }
  }
}

(async()=>{
  try { await run(false);await run(true);assert.deepEqual(report.errors,[]);report.ok=true; }
  catch(error) { report.errors.push(error.stack||String(error));process.exitCode=1; }
  finally { fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,screenshots:report.screenshots.length,errors:report.errors},null,2)); }
})();
