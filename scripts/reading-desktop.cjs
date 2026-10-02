// Real Electron regression for cover compositing and readable desktop lyrics.
// Run after npm run build:desktop: node scripts/reading-desktop.cjs
// Media, IPC persistence, screenshots, and reports use isolated smoke fixtures.
const {_electron:electron} = require('../desktop_UI/node_modules/playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname,'..');
const artifacts = path.join(root,'.test-artifacts','reading');
fs.mkdirSync(artifacts,{recursive:true});
const actionsOnly=process.argv.includes('--actions-only');
const playerStartup=process.argv.includes('--player-startup');
const reportFile=path.join(artifacts,playerStartup?'player-startup-report.json':actionsOnly?'actions-report.json':'report.json');
const report = {ok:false,actionsOnly,playerStartup,checks:[],screenshots:[],interactions:[],transitions:[],fonts:[],lyrics:[],layouts:[],songActions:[],trackChanges:[],focusFailures:[],consoleErrors:[],duplicateKeys:[],errors:[]};
// Interior samples compare the actual decoded PNG with native transition snapshots.
const sampleFractions = [[.12,.3],[.65,.16],[.85,.6],[.18,.7],[.65,.82]];

async function setInput(locator,value) {
  await locator.evaluate((input,value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
}

(async () => {
  let app,page;
  try {
    app = await electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'smoke-main.cjs')],cwd:root,
      env:{...process.env,WUU_RENDERER_URL:process.env.WUU_READING_RENDERER||'',WUU_SMOKE_PACKAGED:'0',WUU_VISUAL_FIXTURE:'',WUU_PLAYER_POLISH_FIXTURE:'1',WUU_COVER_STARTUP:'',WUU_REVIEW_PROFILE:process.env.WUU_READING_PROFILE||'reading-regression'},timeout:30000});
    report.electronStderr=[];
    app.process().stderr?.on('data',data=>{if(report.electronStderr.join('').length<20000)report.electronStderr.push(data.toString());});
    await app.firstWindow();
    // Exercise the renderer's real bridge/IPC serialization while keeping share
    // generation inside this test process; no network listener or user files.
    await app.evaluate(({ipcMain,BrowserWindow})=>{
      global.__readingRendererCrashes=[];
      BrowserWindow.getAllWindows().forEach(window=>window.webContents.on('render-process-gone',(_event,details)=>global.__readingRendererCrashes.push(details)));
      global.__readingShareRequests=[];
      ipcMain.removeHandler('playlist-export');
      ipcMain.handle('playlist-export',(_event,payload)=>{
        global.__readingShareRequests.push(payload);
        return {ok:true,id:'reading-share',shareLink:'http://127.0.0.1:30967/share/reading-test',key:'reading-fixture-key',expireAt:payload.expireAt,maxUses:payload.maxUses};
      });
    });
    for (let attempt=0;attempt<200;attempt++) {
      page=app.windows().find(window=>window.url().includes('index.html')&&!window.url().includes('window=lyrics'));
      if(page) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(page); page.setDefaultTimeout(10000);
    report.rendererBundle=await page.locator('script[type="module"]').getAttribute('src');
    page.on('pageerror',error=>report.errors.push(error.message));
    page.on('console',message=>{
      if(message.type()==='error')report.consoleErrors.push(message.text());
      if(/Encountered two children with the same key|unique.*key|duplicate.*key/i.test(message.text()))report.duplicateKeys.push(message.text());
    });
    await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'dark'});
    const nav=page.getByRole('navigation',{name:'主导航'});
    await nav.waitFor(); await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
    // Also support the same player-first route used by the playback suite.
    // The default retains the immediate pause/navigation regression probe.
    if(playerStartup){
      await nav.getByRole('button',{name:'正在播放',exact:true}).click();
      await page.locator('.player-page .record-info h1').waitFor();
      await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);
    }
    report.startup=await page.evaluate(()=>({page:document.querySelector('.page-host:not([hidden])')?.dataset.page,ready:document.readyState,settingsHost:!!document.querySelector('[data-page="settings"]'),animations:document.getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime,target:animation.effect?.target?.className})),images:[...document.images].map(image=>({src:image.src,complete:image.complete,naturalWidth:image.naturalWidth}))}));
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const settled=()=>page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);
    const go=async name=>{await nav.getByRole('button',{name,exact:true}).click();await settled();await page.waitForTimeout(340);};
    const capture=async name=>{const file=path.join(artifacts,name+'.png');await page.screenshot({path:file,scale:'css'});report.screenshots.push(file);return file;};
    const pixels=async(file,points)=>app.evaluate(({nativeImage},{file,points})=>{
      const image=nativeImage.createFromPath(file),{width,height}=image.getSize(),bitmap=image.toBitmap();
      return points.map(([x,y])=>{const offset=(Math.min(height-1,Math.max(0,Math.round(y)))*width+Math.min(width-1,Math.max(0,Math.round(x))))*4;
        return {r:bitmap[offset+2],g:bitmap[offset+1],b:bitmap[offset],a:bitmap[offset+3]};});
    },{file,points});
    const resize=async(width,height)=>{
      let outerWidth=width,outerHeight=height;
      for(let attempt=0;attempt<4;attempt++) {
        await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('window=lyrics')).setSize(size.width,size.height),{width:outerWidth,height:outerHeight});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
        if(Math.abs(actual.width-width)<1&&Math.abs(actual.height-height)<1) break;
        outerWidth+=width-actual.width;outerHeight+=height-actual.height;
      }
      await page.waitForTimeout(350);
    };
    if(!actionsOnly){
    // The real-media fixture starts with a circular record. Square-cover native
    // snapshots are tested first, and circular records separately below.
    await go('设置');await page.getByRole('tab',{name:'外观',exact:true}).click();
    const disc=page.locator('.setting-row').filter({hasText:'圆盘封面'}).locator('input[type="checkbox"]');
    await disc.uncheck();await go('推荐');
    await page.waitForFunction(()=>['.home-hero-cover img','.record-artwork-stack .artwork-layer:not(.artwork-pending):not(.artwork-outgoing) img'].every(selector=>{
      const image=document.querySelector(selector);return image?.complete&&image.naturalWidth;
    }));
    const coverState=locator=>locator.evaluate(button=>{
      const artwork=button.querySelector('.home-artwork'),style=getComputedStyle(button),artStyle=getComputedStyle(artwork),box=artwork.getBoundingClientRect();
      return {background:style.backgroundColor,shadow:style.boxShadow,filter:artStyle.filter,artShadow:artStyle.boxShadow,rect:{x:box.x,y:box.y,width:box.width,height:box.height}};
    });
    const clearBackground=value=>/^rgba\([^)]*,\s*0\)$/.test(value)||value==='transparent'||/\/\s*0\s*\)$/.test(value);
    const hero=page.locator('.home-hero-cover');
    await page.mouse.move(12,32);
    const idle=await coverState(hero),idleFile=await capture('hover-idle');
    const box=idle.rect,haloPoints=[[box.x-10,box.y+box.height/2],[box.x+box.width+10,box.y+box.height/2],[box.x-8,box.y+box.height+8],[box.x+box.width+8,box.y+box.height+8]];
    const idlePixels=await pixels(idleFile,haloPoints);
    await hero.hover(); await page.waitForTimeout(520);
    const hover=await coverState(hero),hoverFile=await capture('hover-clean'),hoverPixels=await pixels(hoverFile,haloPoints);
    report.interactions.push({target:'hero',idle,hover,idlePixels,hoverPixels});
    assert.ok(clearBackground(hover.background),'Hero hover retains a transparent button background');
    assert.equal(hover.filter,'none');assert.equal(hover.shadow,'none');assert.equal(hover.artShadow,'none');
    for(let index=0;index<idlePixels.length;index++) for(const component of ['r','g','b']) assert.ok(Math.abs(idlePixels[index][component]-hoverPixels[index][component])<=6,'Hover does not paint a dark halo outside the actual artwork');
    for(const locator of [hero,page.locator('.home-album-card').first()]) {
      await locator.focus();await page.waitForTimeout(250);
      const focus=await coverState(locator);assert.ok(clearBackground(focus.background)&&focus.shadow==='none');
      await locator.hover();await page.mouse.down();
      const active=await coverState(locator);assert.ok(clearBackground(active.background)&&active.shadow==='none');
      report.interactions.push({target:await locator.getAttribute('class'),focus,active});
      // Release over the titlebar so this interaction probe does not play a new album.
      await page.mouse.move(12,32);await page.mouse.up();
    }
    await hero.evaluate(element=>element.blur());
    await page.locator('.home-page').evaluate(element=>{element.scrollTop=0;});
    await page.mouse.move(12,32);await page.waitForTimeout(150);
    report.checks.push('hero and album hover/focus/press have transparent backgrounds, with actual outside-cover pixels free of a new dark halo');

    const heroName=await page.locator('.home-hero-copy h2').innerText();
    const expectedPixels=await app.evaluate(({nativeImage},{name,fractions})=>{
      // Decode the same local cover file. This avoids depending on browser
      // canvas CORS rules for the application's custom music: media scheme.
      const song=global.__wuuSmoke.songs.find(song=>song.songName===name),image=nativeImage.createFromPath(song.coverPath),{width,height}=image.getSize(),bitmap=image.toBitmap();
      return fractions.map(([x,y])=>{const offset=(Math.round(y*(height-1))*width+Math.round(x*(width-1)))*4;return {r:bitmap[offset+2],g:bitmap[offset+1],b:bitmap[offset]};});
    },{name:heroName,fractions:sampleFractions});
    report.expectedCoverPixels=expectedPixels;
    await page.evaluate(()=>{
      window.__readingTransitions=[];const start=document.startViewTransition.bind(document);
      document.startViewTransition=(...args)=>{
        const transition=start(...args),record={ready:false,finished:false};window.__readingTransitions.push(record);
        transition.ready.then(()=>{
          record.ready=true;record.shared=[...document.querySelectorAll('[style*="view-transition-name"]')].length===2;
          if(window.__readingFreezeNext){window.__readingFreezeNext=false;
            window.__readingFrozen=document.getAnimations().filter(animation=>animation.effect?.pseudoElement?.includes('view-transition'));
            window.__readingFrozen.forEach(animation=>{animation.pause();animation.currentTime=0;});record.pseudos=window.__readingFrozen.map(animation=>animation.effect.pseudoElement);}
        }).catch(error=>{record.skipped=error.name;});
        transition.finished.then(()=>{record.finished=true;}).catch(error=>{record.error=error.message;});return transition;
      };
    });
    const nativeFrames=async(label,name)=>{
      const count=await page.evaluate(()=>{window.__readingFreezeNext=true;return window.__readingTransitions.length;});
      await nav.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(count=>window.__readingTransitions.length>count&&window.__readingTransitions.at(-1).ready,count);
      const record=await page.evaluate(()=>window.__readingTransitions.at(-1));assert.ok(record.shared,'The same actual cover participates in a native shared transition');
      assert.ok(record.pseudos.some(value=>value.includes('wuu-artwork'))&&record.pseudos.some(value=>value.includes('wuu-page')),'Both page and artwork group animations are frozen');
      const frames=[];report.transitions.push({name,record,frames});
      for(const fraction of [.08,.5,.9]){
        const frame=await page.evaluate(async fraction=>{
          window.__readingFrozen.forEach(animation=>{animation.currentTime=Number(animation.effect.getTiming().duration)*fraction;});
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const root=document.documentElement,group=getComputedStyle(root,'::view-transition-group(wuu-artwork)'),fresh=getComputedStyle(root,'::view-transition-new(wuu-artwork)'),old=getComputedStyle(root,'::view-transition-old(wuu-artwork)');
          const matrix=new DOMMatrixReadOnly(group.transform),width=parseFloat(group.width),height=parseFloat(group.height);
          return {fraction,group:{overflow:group.overflow,borderRadius:group.borderRadius,transform:group.transform,x:matrix.m41,y:matrix.m42,width,height},
            fresh:{opacity:Number(fresh.opacity),blend:fresh.mixBlendMode,animation:fresh.animationName},old:{display:old.display,animation:old.animationName},
            animations:window.__readingFrozen.map(animation=>({pseudo:animation.effect.pseudoElement,state:animation.playState,currentTime:animation.currentTime,progress:animation.effect.getComputedTiming().progress}))};
        },fraction);
        const file=await capture(`${name}-${Math.round(fraction*100)}pct`);
        frame.pixels=await pixels(file,sampleFractions.map(([x,y])=>[frame.group.x+x*frame.group.width,frame.group.y+y*frame.group.height]));frames.push(frame);
        assert.ok(frame.group.overflow==='clip'||frame.group.overflow==='hidden');assert.ok(parseFloat(frame.group.borderRadius)>=8);
        assert.equal(frame.fresh.opacity,1);assert.equal(frame.fresh.blend,'normal');assert.equal(frame.fresh.animation,'none');assert.equal(frame.old.display,'none');
        for(let index=0;index<frame.pixels.length;index++) for(const channel of ['r','g','b']) assert.ok(Math.abs(frame.pixels[index][channel]-expectedPixels[index][channel])<20,`${name} ${fraction} captures the real cover pixels without a dark rectangle or faded snapshot`);
      }
      await page.evaluate(()=>{window.__readingFrozen.forEach(animation=>animation.play());window.__readingFrozen=[];});await settled();
    };
    await nativeFrames('正在播放','home-to-player');await nativeFrames('推荐','player-to-home');
    report.checks.push('both native directions at 8%, 50%, and 90% retain the actual decoded cover colors with a clipped rounded opaque image group');

    await go('设置');await page.getByRole('tab',{name:'外观',exact:true}).click();
    await disc.check();await go('推荐');
    const beforeDisc=await page.evaluate(()=>window.__readingTransitions.length);await go('正在播放');
    assert.ok(await page.locator('.record-sleeve.is-disc').isVisible());
    assert.equal(await page.evaluate(count=>window.__readingTransitions.slice(count).some(record=>record.shared),beforeDisc),false,'Circular record artwork stays in the page instead of entering a square shared snapshot');
    await capture('disc-without-square-snapshot');
    await go('设置');await page.getByRole('tab',{name:'外观',exact:true}).click();await disc.uncheck();await go('正在播放');
    report.checks.push('circular records skip the rectangular shared artwork snapshot');

    // The old renderer reused the same sibling key for record-info and actions;
    // every actual song change left another stale information block behind.
    // Inspect every step, since a final-only assertion can miss transient layers.
    const tracks=await app.evaluate(()=>global.__wuuSmoke.songs.map(song=>({name:song.songName,path:song.audioPath})));
    const uniqueTrack=async(label,index)=>{
      await page.waitForFunction(name=>document.querySelector('.player-bar .song-meta strong')?.textContent===name,tracks[index].name);
      await page.waitForTimeout(100);
      const value=await page.evaluate(()=>({count:document.querySelectorAll('.player-artwork .record-info').length,titles:[...document.querySelectorAll('.player-artwork .record-info h1')].map(node=>node.textContent),actions:document.querySelectorAll('.player-artwork .player-actions').length,bar:document.querySelector('.player-bar .song-meta strong')?.textContent}));
      report.trackChanges.push({label,expected:tracks[index].name,...value});
      assert.equal(value.count,1,'Every song change retains exactly one information block');assert.equal(value.actions,1);assert.deepEqual(value.titles,[tracks[index].name],'The sole song title matches the actual playing track');assert.deepEqual(report.duplicateKeys,[],'React reports no duplicate sibling keys');
    };
    await uniqueTrack('initial',0);
    for(const [label,index] of [['next',1],['next',2],['previous',1],['previous',0],['next',1],['previous',0],['next',1],['next',2],['previous',1],['previous',0]]){
      await page.getByRole('button',{name:label==='next'?'下一首':'上一首',exact:true}).click();await uniqueTrack(label,index);
    }
    for(const index of [2,0,1,0]){
      await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.locator('.player-queue').waitFor();
      await page.locator('.player-queue .queue-song').filter({has:page.locator('strong').filter({hasText:tracks[index].name})}).click();
      await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();await uniqueTrack('queue',index);
    }
    if(await page.getByRole('button',{name:'暂停',exact:true}).count())await page.getByRole('button',{name:'暂停',exact:true}).click();
    await capture('rapid-track-changes-single-info');
    report.checks.push('14 next/previous/real-queue song changes keep exactly one current information/actions block and report no duplicate React keys');

    const seek=async time=>{await setInput(page.getByRole('slider',{name:'播放进度',exact:true}),time);await page.waitForFunction(time=>Math.abs(Number(document.querySelector('[aria-label="播放进度"]').value)-time)<.4,time);await page.waitForTimeout(250);};
    const fontSlider=page.locator('.settings-page').getByRole('slider',{name:'当前歌词字号',exact:true});
    const ordinaryFontSlider=page.locator('.settings-page input[aria-label="普通歌词字号"]');
    const fontSetting=async size=>{
      await go('设置');await page.getByRole('tab',{name:'歌词',exact:true}).click();await fontSlider.waitFor();
      assert.equal(await fontSlider.getAttribute('min'),'20');assert.equal(await fontSlider.getAttribute('max'),'60');
      assert.equal(Number(await ordinaryFontSlider.inputValue()),20,'Changing the current-line font leaves the ordinary font unchanged');
      await setInput(fontSlider,size);assert.equal(Number(await fontSlider.inputValue()),size);
      await go('正在播放');
      assert.equal(await page.locator('.player-page [aria-label="歌词字号"],.player-page [aria-label="当前歌词字号"],.player-page [aria-label="普通歌词字号"],.lyrics-panel .lyric-size-toolbar,.lyrics-panel input[type="range"]').count(),0,'Font controls exist only in Settings');
    };
    const lyricState=()=>page.locator('.lyrics-panel').evaluate(panel=>{
      const probe=document.createElement('span');panel.append(probe);probe.style.color='var(--lyric-active)';const activeColor=getComputedStyle(probe).color;probe.remove();
      return {base:parseFloat(getComputedStyle(panel).getPropertyValue('--lyric-size')),currentSize:parseFloat(getComputedStyle(panel).getPropertyValue('--lyric-current-size')),activeColor,rows:[...panel.querySelectorAll('.lyric-line')].map(line=>{
        const css=getComputedStyle(line),word=line.querySelector('.lyric-word'),wordStyle=getComputedStyle(word),mark=getComputedStyle(line,'::before');
        return {text:line.textContent,state:line.dataset.lyricState,font:parseFloat(css.fontSize),weight:Number(css.fontWeight),color:css.color,opacity:Number(css.opacity),
          wordColor:wordStyle.color,wordBackground:wordStyle.backgroundImage,progress:word.style.getPropertyValue('--word-progress'),markerContent:mark.content,markerWidth:parseFloat(mark.width)};})};
    });
    for(const size of [20,36,60]) {
      await fontSetting(size);await seek(21);const state=await lyricState();report.fonts.push({size,...state});
      assert.equal(state.base,20);assert.equal(state.currentSize,size);
      assert.equal(state.rows.find(row=>row.state==='current').font,size,'The current line uses the chosen absolute font size');
      assert.ok(state.rows.filter(row=>row.state!=='current').every(row=>row.font===20),'Past and future lines keep their ordinary size');
    }
    await resize(800,500);await seek(31);await capture('lyrics-max-800x500');
    const layout=await page.locator('.lyrics-panel').evaluate(panel=>{
      const box=panel.getBoundingClientRect(),scroll=panel.querySelector('.lyrics-scroll'),viewport=scroll.getBoundingClientRect(),line=panel.querySelector('.lyric-line.current'),track=line.querySelector('.lyric-track'),css=getComputedStyle(track);
      const words=[...line.querySelectorAll('.lyric-word')].map(word=>{const rect=word.getBoundingClientRect();return {text:word.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};});
      const row=line.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,panel:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},
        viewport:{left:viewport.left,right:viewport.right,top:viewport.top,bottom:viewport.bottom},scrollHeight:scroll.clientHeight,contentHeight:scroll.scrollHeight,
        line:{text:line.textContent,width:row.width,height:row.height,clientWidth:line.clientWidth,scrollWidth:line.scrollWidth,marquee:line.dataset.marquee},
        track:{whiteSpace:css.whiteSpace,transform:css.transform,textOverflow:css.textOverflow},words};
    });report.layouts.push(layout);
    assert.equal(layout.pageOverflow,false);assert.ok(layout.scrollHeight>=70,'The max-font small window keeps a usable lyric viewport');
    assert.equal(layout.line.text,await app.evaluate(()=>global.__wuuSmoke.polish.lines.find(([time])=>time===22)[1]),'The full long fixture text remains in the rendered line');
    assert.ok(layout.words.length>60&&new Set(layout.words.map(word=>Math.round(word.top))).size>=3,'The long current lyric genuinely wraps across multiple lines');
    assert.ok(layout.track.whiteSpace!=='nowrap'&&layout.track.transform==='none'&&layout.track.textOverflow!=='ellipsis'&&!layout.line.marquee,'Full lyrics use wrapping without horizontal marquee or truncation');
    assert.ok(layout.line.scrollWidth<=layout.line.clientWidth+1&&layout.words.every(word=>word.left>=layout.viewport.left-1&&word.right<=layout.viewport.right+1),'Every lyric character fits horizontally in the readable viewport');
    const browseEndpoint=async endpoint=>{
      const geometry=await page.locator('.lyrics-scroll').evaluate(async(scroll,endpoint)=>{
        const words=scroll.querySelectorAll('.lyric-line.current .lyric-word'),word=endpoint==='first'?words[0]:words[words.length-1];
        const before=word.getBoundingClientRect(),viewport=scroll.getBoundingClientRect();
        // Genuine vertical overflow is allowed; reach both ends of the full text
        // through the scroll container rather than shrinking the user's font.
        scroll.scrollTo({top:scroll.scrollTop+(before.top+before.bottom)/2-(viewport.top+viewport.bottom)/2,behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const after=word.getBoundingClientRect();return {endpoint,text:word.textContent,scrollTop:scroll.scrollTop,word:{top:after.top,bottom:after.bottom,left:after.left,right:after.right},viewport:{top:viewport.top,bottom:viewport.bottom,height:viewport.height}};
      },endpoint);
      report.layouts.push(geometry);assert.ok(geometry.word.top>=geometry.viewport.top+geometry.viewport.height*.12&&geometry.word.bottom<=geometry.viewport.top+geometry.viewport.height*.84,'The first and final words are independently readable inside the unfaded vertical band');
      await capture(`long-lyric-${endpoint}-800x500`);
    };
    await browseEndpoint('first');await browseEndpoint('last');
    await fontSetting(26);
    for(let attempt=0;attempt<100;attempt++){if(await app.evaluate(()=>global.__wuuSmoke.data.settings.currentLyricSize===26))break;await page.waitForTimeout(50);}
    assert.deepEqual(await app.evaluate(()=>({ordinary:global.__wuuSmoke.data.settings.lyricSize,current:global.__wuuSmoke.data.settings.currentLyricSize})),{ordinary:20,current:26},'The real save-userdata IPC persists the independent current font without overwriting the ordinary preference');
    await page.reload();await nav.waitFor();await go('设置');await page.getByRole('tab',{name:'歌词',exact:true}).click();await fontSlider.waitFor();assert.equal(Number(await fontSlider.inputValue()),26,'Reload restores the persisted lyric font in Settings');
    assert.equal(Number(await ordinaryFontSlider.inputValue()),20,'Reload retains the ordinary font in its advanced setting');
    await go('正在播放');const restoredFont=await lyricState();assert.equal(restoredFont.base,20);assert.equal(restoredFont.currentSize,26,'The restored current-line preference applies to the playback lyrics');
    assert.equal(await page.locator('.lyrics-panel .lyric-size-toolbar,.lyrics-panel input[type="range"]').count(),0);
    if(await page.getByRole('button',{name:'暂停',exact:true}).count())await page.getByRole('button',{name:'暂停',exact:true}).click();
    report.checks.push('Settings alone adjusts the absolute current-line font from 20 to 60px, leaves ordinary lines at 20px, and persists/restores currentLyricSize=26 independently through real IPC');
    report.checks.push('at 800×500 and current size 60px, the entire long lyric wraps horizontally and its first and final words remain readable through vertical scrolling');

    for(const time of [21,6,21,1]) {
      await seek(time);const state=await lyricState();report.lyrics.push({time,...state});
      const current=state.rows.filter(row=>row.state==='current'),past=state.rows.filter(row=>row.state==='past'),future=state.rows.filter(row=>row.state==='future');
      assert.equal(current.length,1);assert.equal(current[0].weight,750);assert.equal(current[0].font,26,'The current lyric uses the independently selected absolute size');
      assert.ok(current[0].markerContent==='none'||current[0].markerContent==='normal','The current lyric has no side marker pseudo-element');
      assert.ok([...past,...future].every(row=>row.font===20),'Completed and upcoming rows use the ordinary font size');
      assert.ok(past.every(row=>row.color===state.activeColor&&row.wordColor===state.activeColor&&row.wordBackground==='none'),'Already sung rows retain the cover color');
      assert.ok(future.length&&future.every(row=>row.color==='rgb(255, 255, 255)'&&row.wordColor==='rgb(255, 255, 255)'&&row.wordBackground==='none'&&!row.progress),'Future rows are plain white and clear stale word progress after seeking backwards');
      assert.equal(past.length,time>=20?3:time>=5?1:0,'Seeking backward recomputes the actual past/current/future boundary');
      await capture(`lyric-state-${time}s-${report.lyrics.length}`);
    }
    report.checks.push('past lyrics retain cover color and return to ordinary size, future lyrics stay white, current lyrics use the selected absolute size/stronger weight without a marker, and backward seeks clear obsolete progress');

    // Keep the real audio and provider word timings, but give the first RAW
    // line a genuine 3–5s silence interval through this isolated fixture IPC.
    // Read fixture files in this Node process: serialized main-process callbacks
    // do not have CommonJS require. No media or lyric files are rewritten.
    const lyricFiles=await app.evaluate(()=>({rawPath:global.__wuuSmoke.songs[0].rawPath,
      paths:[...new Set(global.__wuuSmoke.songs.flatMap(song=>[song.rawPath,song.lrcPath].filter(Boolean)))]}));
    const lyricContents=lyricFiles.paths.map(file=>[file,fs.readFileSync(file,'utf8')]);
    const rawGap=await app.evaluate(({ipcMain},{file,lyrics})=>{
      const originals=new Map(lyrics),original=originals.get(file);
      if(!original.includes('[0,5000]'))throw new Error('The RAW first-line fixture no longer has its expected declared duration');
      const content=original.replace('[0,5000]','[0,3000]');
      global.__readingRawGapEnabled=true;
      ipcMain.removeHandler('get-lyrics');
      ipcMain.handle('get-lyrics',(_event,requested)=>{
        if(!originals.has(requested))throw new Error(`Unknown isolated lyric fixture: ${requested}`);
        return global.__readingRawGapEnabled&&requested===file?content:originals.get(requested);
      });
      return {declaredEnd:3,nextLineStart:5,lastWordEnd:1.4};
    },{file:lyricFiles.rawPath,lyrics:lyricContents});
    await page.reload();await nav.waitFor();await go('正在播放');
    if(await page.getByRole('button',{name:'暂停',exact:true}).count())await page.getByRole('button',{name:'暂停',exact:true}).click();
    const gapState=async(time,label)=>{
      await seek(time);const state=await lyricState();report.lyrics.push({time,label,rawGap,...state});return state;
    };
    const tail=await gapState(2.5,'RAW declared duration preserves the tail');
    assert.equal(tail.rows[0].state,'current');assert.equal(tail.rows[0].font,26,'A capped last-word fill must not shrink the line before its declared RAW end');
    const gap=await gapState(3.5,'RAW completed line before next timestamp');
    assert.equal(gap.rows.filter(row=>row.state==='current').length,0,'A RAW silence interval has no artificially prolonged current line');
    assert.equal(gap.rows[0].state,'past');assert.equal(gap.rows[0].font,20);assert.equal(gap.rows[0].wordColor,gap.activeColor);assert.equal(gap.rows[0].wordBackground,'none');
    assert.ok(gap.rows.slice(1).every(row=>row.state==='future'&&row.font===20&&row.wordColor==='rgb(255, 255, 255)'),'The next RAW group remains white and ordinary-sized during the gap');
    await capture('raw-gap-completed-ordinary');
    const rewind=await gapState(1,'RAW rewind restores current size');
    assert.equal(rewind.rows[0].state,'current');assert.equal(rewind.rows[0].font,26);assert.equal(rewind.rows.filter(row=>row.state==='past').length,0);
    assert.ok(rewind.rows[0].wordBackground!=='none'&&rewind.rows.slice(1).every(row=>row.state==='future'&&row.font===20&&row.wordColor==='rgb(255, 255, 255)'&&!row.progress),'Rewinding restores current word fill and clears obsolete historical colors/progress');
    await seek(2.8);await page.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(()=>{
      const time=Number(document.querySelector('[aria-label="播放进度"]').value);
      return time>=3&&time<5&&document.querySelectorAll('.lyrics-panel .lyric-line.current').length===0;
    },null,{timeout:2500});
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const crossed=await lyricState();report.lyrics.push({time:Number(await page.getByRole('slider',{name:'播放进度',exact:true}).inputValue()),label:'Native audio crosses RAW completion during playback',rawGap,...crossed});
    assert.equal(crossed.rows[0].state,'past');assert.equal(crossed.rows[0].font,20,'Native playback immediately returns the completed line to the ordinary font');
    assert.equal(crossed.rows.filter(row=>row.state==='current').length,0);
    assert.deepEqual(await app.evaluate(()=>({ordinary:global.__wuuSmoke.data.settings.lyricSize,current:global.__wuuSmoke.data.settings.currentLyricSize})),{ordinary:20,current:26},'Completion and rewind never modify either saved font preference');
    report.checks.push('RAW provider duration keeps the tail enlarged after last-word fill, completion at 3s restores 20px during the 3–5s gap, native playback crosses the boundary, and rewind to 1s restores the saved 26px/current fill');
    await app.evaluate(()=>{global.__readingRawGapEnabled=false;});
    await page.reload();await nav.waitFor();await go('正在播放');
    if(await page.getByRole('button',{name:'暂停',exact:true}).count())await page.getByRole('button',{name:'暂停',exact:true}).click();
    await seek(1);
    }else{
      // The focused phase also exercises immediate navigation on a persisted
      // active page while its genuine startup entrances may still be running.
      report.actionsStartState=await page.evaluate(()=>({page:document.querySelector('.page-host:not([hidden])')?.dataset.page,pending:document.documentElement.dataset.pageTransition,title:document.querySelector('.record-info h1')?.textContent,animations:document.getAnimations().length}));
      await go('正在播放');await resize(800,500);
    }

    const actions=page.getByRole('group',{name:'当前歌曲操作',exact:true});
    const plus=actions.getByRole('button',{name:'添加到歌单',exact:true});
    const shareTrigger=actions.getByRole('button',{name:'分享当前歌曲',exact:true});
    const commentTrigger=actions.getByRole('button',{name:'评论',exact:true});
    const currentName=await page.locator('.player-artwork .record-info h1').innerText();
    const currentSong=await app.evaluate((_electron,name)=>global.__wuuSmoke.songs.find(song=>song.songName===name),currentName);assert.ok(currentSong);
    const samePage=async()=>assert.equal(await page.locator('.page-host:not([hidden])').getAttribute('data-page'),'player','Song actions preserve the current playback page');
    const waitSaved=async(check,label)=>{for(let attempt=0;attempt<100;attempt++){if(await check())return;await page.waitForTimeout(50);}assert.fail(label);};
    const plusIcon=async()=>{
      assert.equal((await plus.innerText()).trim(),'','The collection entry contains only an icon');
      assert.equal(await plus.locator('svg path').getAttribute('d'),'M12 5v14M5 12h14','The entry keeps its plus icon even after collection membership changes');
    };
    await plusIcon();await plus.click();
    const picker=page.getByRole('dialog',{name:'选择歌单',exact:true});await picker.waitFor();await samePage();
    await picker.getByRole('button',{name:'新建歌单',exact:true}).click();
    const prompt=page.getByRole('dialog',{name:'新建歌单',exact:true});await prompt.waitFor();
    await prompt.getByRole('button',{name:'取消',exact:true}).click();await prompt.waitFor({state:'hidden'});
    assert.ok(await picker.isVisible(),'Cancelling a nested new-playlist prompt preserves the outer picker');
    await picker.getByRole('button',{name:'新建歌单',exact:true}).click();
    await prompt.getByRole('textbox',{name:'新建歌单',exact:true}).fill('阅读回归歌单');await prompt.getByRole('button',{name:'创建',exact:true}).click();
    await prompt.waitFor({state:'hidden'});
    const collection=picker.locator('.picker-list label').filter({hasText:'阅读回归歌单'});await collection.waitFor();assert.ok(await collection.getByRole('checkbox').isChecked());
    await picker.getByRole('button',{name:'完成',exact:true}).click();await picker.waitFor({state:'hidden'});
    assert.ok(await plus.evaluate(element=>element===document.activeElement));await plusIcon();
    report.checks.push('the icon-only plus keeps its shape after real playlist creation; nested cancel and completion preserve the page and restore focus');

    const popoverGeometry=async(locator,label)=>{
      await page.waitForTimeout(210);
      const geometry=await locator.evaluate(element=>{
        const rect=element.getBoundingClientRect(),controls=[...element.querySelectorAll('button,input,select')].filter(control=>control.getClientRects().length).map(control=>{const box=control.getBoundingClientRect();return {left:box.left,right:box.right};});
        return {viewport:{width:innerWidth,height:innerHeight},box:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},focused:element.contains(document.activeElement),controls};
      });report.songActions.push({label,...geometry});await samePage();
      assert.ok(geometry.box.left>=11&&geometry.box.right<=geometry.viewport.width-11&&geometry.box.top>=11&&geometry.box.bottom<=geometry.viewport.height-11,'The entire popover fits within the 800×500 viewport');
      if(!geometry.focused)report.focusFailures.push({label,reason:'Focus leaves the open popover'});
      assert.ok(geometry.controls.every(control=>control.left>=geometry.box.left-1&&control.right<=geometry.box.right+1),'Popover control widths remain inside the surface');
      await capture(label);
    };
    const closeEscape=async(locator,trigger)=>{
      await page.keyboard.press('Shift+Tab');assert.ok(await locator.evaluate(element=>element.contains(document.activeElement)),'Shift+Tab remains inside the popover');
      await page.keyboard.press('Escape');await locator.waitFor({state:'hidden'});
      assert.ok(await trigger.evaluate(element=>element===document.activeElement),'Escape restores the exact action trigger');await samePage();
    };
    const share=page.locator('#song-share-popover');
    await shareTrigger.click();await share.waitFor();await popoverGeometry(share,'share-before-generation-800x500');
    // Smoke server-start merely updates fixture state, so this tests both UI
    // steps without opening a real HTTP port.
    await share.getByRole('button',{name:'开启分享服务',exact:true}).click();
    await share.getByRole('button',{name:'生成分享',exact:true}).click();
    await share.getByLabel('分享链接',{exact:true}).waitFor();
    assert.equal(await share.getByLabel('分享链接',{exact:true}).inputValue(),'http://127.0.0.1:30967/share/reading-test');
    assert.equal(await share.getByLabel('解密密钥',{exact:true}).inputValue(),'reading-fixture-key');
    const exportRequests=await app.evaluate(()=>global.__readingShareRequests);report.songActions.push({label:'share-real-IPC',exportRequests});
    assert.equal(exportRequests.length,1);assert.equal(exportRequests[0].name,currentSong.songName);assert.equal(exportRequests[0].songs.length,1);assert.equal(exportRequests[0].songs[0].audioPath,currentSong.audioPath);
    assert.equal(exportRequests[0].maxUses,1);assert.equal(exportRequests[0].publicHost,'');assert.equal(exportRequests[0].publicPort,0);assert.ok(Math.abs(exportRequests[0].expireAt-Date.now()-86400000)<15000);
    await popoverGeometry(share,'share-result-800x500');await closeEscape(share,shareTrigger);
    await shareTrigger.click();await share.waitFor();
    await page.locator('.song-popover-backdrop[data-state="open"]').click({position:{x:4,y:4}});await share.waitFor({state:'hidden'});
    const outsideFocus=await shareTrigger.evaluate(element=>({returned:element===document.activeElement,activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute('aria-label')}));
    report.songActions.push({label:'share-outside-focus',...outsideFocus});if(!outsideFocus.returned)report.focusFailures.push({label:'share-outside-focus',...outsideFocus});await samePage();
    report.checks.push('share uses a current-page bounded popover, real IPC exports only the current song, link/key render, and Escape/outside dismissal restore the trigger');

    const comment=page.locator('#song-comment-popover'),genreMenu=page.locator('#song-genre-menu');
    const openGenres=async()=>{await commentTrigger.click();await comment.waitFor();await comment.locator('.song-submenu-entry').click();await genreMenu.waitFor();};
    await commentTrigger.click();await comment.waitFor();assert.equal(await comment.locator('#song-genre-menu').count(),0,'Song styles begin behind a second-level menu');
    await popoverGeometry(comment,'comment-main-800x500');await comment.locator('.song-submenu-entry').click();await genreMenu.waitFor();
    await genreMenu.getByRole('checkbox',{name:'摇滚',exact:true}).check();
    const customGenre='阅读回归·海岸';await genreMenu.locator('#new-song-genre').fill(customGenre);await genreMenu.getByRole('button',{name:'添加',exact:true}).click();
    assert.ok(await genreMenu.getByRole('checkbox',{name:customGenre,exact:true}).isChecked());await popoverGeometry(comment,'genre-submenu-800x500');
    await genreMenu.getByRole('button',{name:'保存标注',exact:true}).click();await comment.waitFor({state:'hidden'});
    assert.ok(await commentTrigger.evaluate(element=>element===document.activeElement));
    await waitSaved(()=>app.evaluate((_electron,{songPath,customGenre})=>JSON.stringify(global.__wuuSmoke.data.genreOverrides?.[songPath])===JSON.stringify(['摇滚',customGenre]),{songPath:currentSong.audioPath,customGenre}),'Genre choices persist through save-userdata');
    await openGenres();assert.ok(await genreMenu.getByRole('checkbox',{name:'摇滚',exact:true}).isChecked());assert.ok(await genreMenu.getByRole('checkbox',{name:customGenre,exact:true}).isChecked());
    await genreMenu.getByRole('checkbox',{name:'爵士',exact:true}).check();await comment.getByRole('button',{name:'关闭评论',exact:true}).click();await comment.waitFor({state:'hidden'});
    await openGenres();assert.equal(await genreMenu.getByRole('checkbox',{name:'爵士',exact:true}).isChecked(),false,'Closing discards unsaved genre changes');await closeEscape(comment,commentTrigger);
    await page.reload();await nav.waitFor();await go('正在播放');if(await page.getByRole('button',{name:'暂停',exact:true}).count())await page.getByRole('button',{name:'暂停',exact:true}).click();
    await openGenres();assert.ok(await genreMenu.getByRole('checkbox',{name:'摇滚',exact:true}).isChecked());assert.ok(await genreMenu.getByRole('checkbox',{name:customGenre,exact:true}).isChecked(),'Custom genres restore after a renderer reload');
    const checkedGenres=genreMenu.locator('input[type="checkbox"]:checked');
    while(await checkedGenres.count())await checkedGenres.first().uncheck();
    await genreMenu.getByRole('button',{name:'保存标注',exact:true}).click();await comment.waitFor({state:'hidden'});
    await waitSaved(()=>app.evaluate((_electron,songPath)=>Array.isArray(global.__wuuSmoke.data.genreOverrides?.[songPath])&&global.__wuuSmoke.data.genreOverrides[songPath].length===0,currentSong.audioPath),'An empty manual override is preserved');
    await openGenres();assert.equal(await genreMenu.locator('input[type="checkbox"]:checked').count(),0);await genreMenu.getByRole('button',{name:'恢复音频标签',exact:true}).click();await comment.waitFor({state:'hidden'});
    await waitSaved(()=>app.evaluate((_electron,songPath)=>!Object.prototype.hasOwnProperty.call(global.__wuuSmoke.data.genreOverrides,songPath),currentSong.audioPath),'Restore removes the manual override instead of saving an empty tag list');
    report.checks.push('the comment popover uses a genuine second-level style menu; existing/custom choices save and restore, unsaved edits cancel, and clear/restore have distinct persisted meanings');

    await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
    const timeBefore=Number(await page.getByRole('slider',{name:'播放进度',exact:true}).inputValue());
    await actions.getByRole('button',{name:'不喜欢',exact:true}).click();const undoDislike=actions.getByRole('button',{name:'取消不喜欢',exact:true});await undoDislike.waitFor();assert.equal(await undoDislike.getAttribute('aria-pressed'),'true');
    await waitSaved(()=>app.evaluate((_electron,songPath)=>global.__wuuSmoke.data.dislikes.some(entry=>entry.path===songPath)&&global.__wuuSmoke.data.collections.every(collection=>!collection.songs.includes(songPath)),currentSong.audioPath),'The actual dislike marker and existing collection behavior persist');
    await go('推荐');await page.locator('.home-page .home-song-row').first().waitFor();
    assert.equal(await page.locator('.home-page .home-song-row').filter({has:page.getByText(currentSong.songName,{exact:true})}).count(),0,'The local home song list omits the disliked song');
    await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.locator('.player-queue').waitFor();
    assert.equal(await page.locator('.player-queue .queue-song strong').filter({hasText:currentSong.songName}).count(),0,'The actual playback queue omits the disliked song');
    await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();await go('正在播放');
    assert.equal(await page.locator('.player-artwork .record-info h1').innerText(),currentSong.songName);assert.ok(await page.getByRole('button',{name:'暂停',exact:true}).isVisible());
    const timeAfter=Number(await page.getByRole('slider',{name:'播放进度',exact:true}).inputValue());assert.ok(timeAfter>timeBefore+.2,'Dislike and page operations do not interrupt the already-playing audio');
    await undoDislike.click();await actions.getByRole('button',{name:'不喜欢',exact:true}).waitFor();await page.getByRole('button',{name:'暂停',exact:true}).click();
    await waitSaved(()=>app.evaluate((_electron,songPath)=>!global.__wuuSmoke.data.dislikes.some(entry=>entry.path===songPath),currentSong.audioPath),'Undo removes the persisted dislike marker');
    report.songActions.push({label:'dislike-continuity',timeBefore,timeAfter,songPath:currentSong.audioPath});await capture('song-actions-final-800x500');
    report.checks.push('dislike and undo persist the actual marker; the local home song list/queue skip the song while ongoing playback keeps its track and advances');

    const footer=await page.locator('.player-credits').evaluate(element=>({inLyricsColumn:!!element.closest('.player-lyrics-column'),inArtwork:!!element.closest('.player-artwork'),text:element.textContent}));
    report.songActions.push({label:'credits-footer',...footer});assert.ok(footer.inLyricsColumn&&!footer.inArtwork&&footer.text.includes('作词')&&footer.text.includes('作曲'),'Only real lyricist/composer credits sit below the lyrics column');
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.duplicateKeys,[]);assert.deepEqual(report.focusFailures,[],'Every popover transition and dismissal preserves or restores focus');report.ok=true;
  } catch(error) {
    report.error=error.stack||String(error);process.exitCode=1;
    if(page)await page.screenshot({path:path.join(artifacts,'failure.png'),scale:'css'}).catch(()=>{});
  } finally {
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
    if(app){report.renderProcessGone=await app.evaluate(()=>global.__readingRendererCrashes).catch(error=>({error:error.message}));fs.writeFileSync(reportFile,JSON.stringify(report,null,2));}
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  }
  console.log(JSON.stringify({ok:report.ok,checks:report.checks,error:report.error,report:reportFile,screenshotsCount:report.screenshots.length},null,2));
})();
