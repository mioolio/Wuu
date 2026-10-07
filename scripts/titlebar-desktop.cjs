// Windows native hit-test regression against an isolated, production modern UI.
// Root runs GUI serially: node scripts/titlebar-desktop.cjs
// WUU_TITLEBAR_REPRODUCE_ONLY=1 records old-build failures without failing the run.
// --check-helper compiles the Win32 helper and checks signed coordinate packing only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'titlebar');
const tag = /^[a-z0-9-]{1,48}$/.test(process.env.WUU_TITLEBAR_TAG || '') ? process.env.WUU_TITLEBAR_TAG : '';
const reproduceOnly = process.env.WUU_TITLEBAR_REPRODUCE_ONLY === '1' || process.argv.includes('--reproduce-only');
const reportFile = path.join(artifacts, tag ? `${tag}-report.json` : 'report.json');

// Payload travels through stdin, never interpolation into executable shell code.
// Every message is scoped to the HWND and main-process PID returned by this fixture.
const powershellSource = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WuuTitlebarNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, UIntPtr wp, IntPtr lp, uint flags, uint timeout, out UIntPtr result);
  public static IntPtr PackPoint(int x, int y) {
    if (x < short.MinValue || x > short.MaxValue || y < short.MinValue || y > short.MaxValue) throw new ArgumentOutOfRangeException("screen point");
    return new IntPtr(unchecked((int)(((uint)(ushort)y << 16) | (ushort)x)));
  }
  public static int Message(IntPtr hwnd, uint ownerPid, uint message, uint wParam, int x, int y) {
    uint actualPid;
    if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, out actualPid) == 0 || actualPid != ownerPid)
      throw new InvalidOperationException("Fixture HWND no longer belongs to the expected Electron process");
    UIntPtr result;
    // SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT; no broadcasts or global input.
    if (SendMessageTimeoutW(hwnd, message, new UIntPtr(wParam), PackPoint(x,y), 0x23, 2000, out result) == IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Targeted window message failed or timed out");
    return unchecked((int)result.ToUInt64());
  }
}
'@
if ($payload.operation -eq 'self-test') {
  $packed = [WuuTitlebarNative]::PackPoint(-123,-456).ToInt64()
  $x = [int]($packed -band 65535)
  $y = [int](($packed -shr 16) -band 65535)
  # Convert UInt16 to signed shorts without PowerShell's checked cast.
  if (($packed -band 65535) -gt 32767) { $x = [int](($packed -band 65535) - 65536) }
  if ((($packed -shr 16) -band 65535) -gt 32767) { $y = [int]((($packed -shr 16) -band 65535) - 65536) }
  @{compiled=$true; packed=$packed; x=$x; y=$y} | ConvertTo-Json -Compress
  exit
}
$hwnd = [IntPtr]::new([Int64]::Parse([string]$payload.target.hwnd))
$owner = [uint32]0
if (-not [WuuTitlebarNative]::IsWindow($hwnd) -or [WuuTitlebarNative]::GetWindowThreadProcessId($hwnd,[ref]$owner) -eq 0 -or $owner -ne [uint32]$payload.target.pid) {
  throw 'Refusing a HWND outside the launched fixture process'
}
if ([WuuTitlebarNative]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero) { throw 'Per-monitor DPI awareness could not be enabled for the coordinate probe' }
$client = New-Object WuuTitlebarNative+RECT
$outer = New-Object WuuTitlebarNative+RECT
$origin = New-Object WuuTitlebarNative+POINT
if (-not [WuuTitlebarNative]::GetClientRect($hwnd,[ref]$client) -or -not [WuuTitlebarNative]::GetWindowRect($hwnd,[ref]$outer) -or -not [WuuTitlebarNative]::ClientToScreen($hwnd,[ref]$origin)) { throw 'Native window coordinates are unavailable' }
$scaleX = ($client.Right-$client.Left) / [double]$payload.viewport.width
$scaleY = ($client.Bottom-$client.Top) / [double]$payload.viewport.height
if ($scaleX -le 0 -or $scaleY -le 0) { throw 'The fixture has no usable client viewport' }
$points = @($payload.samples | ForEach-Object {
  $sx = $origin.X + [int][Math]::Round([double]$_.x * $scaleX)
  $sy = $origin.Y + [int][Math]::Round([double]$_.y * $scaleY)
  $hit = [WuuTitlebarNative]::Message($hwnd,$owner,0x84,0,$sx,$sy)
  $sent = $false
  if ($payload.operation -eq 'double-click' -and $hit -eq 2) {
    # Native non-client double-click, not a DOM dblclick or a programmatic resize.
    [void][WuuTitlebarNative]::Message($hwnd,$owner,0xA3,2,$sx,$sy)
    [void][WuuTitlebarNative]::Message($hwnd,$owner,0xA2,2,$sx,$sy)
    $sent = $true
  }
  @{name=$_.name; cssX=$_.x; cssY=$_.y; screenX=$sx; screenY=$sy; hit=$hit; expected=$_.expected; diagnosticOnly=[bool]$_.diagnosticOnly; doubleClickSent=$sent}
})
@{pid=$owner; dpi=[WuuTitlebarNative]::GetDpiForWindow($hwnd); client=@{x=$origin.X;y=$origin.Y;width=$client.Right-$client.Left;height=$client.Bottom-$client.Top}; outer=@{x=$outer.Left;y=$outer.Top;width=$outer.Right-$outer.Left;height=$outer.Bottom-$outer.Top}; scaleX=$scaleX; scaleY=$scaleY; points=$points} | ConvertTo-Json -Depth 8 -Compress
`;

function nativeProbe(payload) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(powershellSource, 'utf16le').toString('base64')], {windowsHide:true, stdio:['pipe','pipe','pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Native HWND probe exited ${code}: ${stderr.trim()}`));
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); }
      catch (error) { reject(new Error(`Native HWND probe did not return JSON: ${stdout}\n${stderr}\n${error.message}`)); }
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function windowState(app, id) {
  return app.evaluate(({BrowserWindow,screen}, id) => {
    const win = BrowserWindow.fromId(id);
    if (!win || win.isDestroyed()) return {destroyed:true};
    const display=screen.getDisplayMatching(win.getBounds());
    return {destroyed:false, visible:win.isVisible(), minimized:win.isMinimized(), maximized:win.isMaximized(), bounds:win.getBounds(), contentBounds:win.getContentBounds(), normalBounds:win.getNormalBounds(), workArea:display.workArea, displayScaleFactor:display.scaleFactor, zoom:win.webContents.getZoomFactor()};
  }, id);
}

function sameBounds(actual, expected) {
  return !!actual && !!expected && ['x','y','width','height'].every(key => Math.abs(actual[key]-expected[key]) <= 1);
}

async function waitState(app, id, predicate, label) {
  const until = Date.now() + 5000;
  let latest;
  while (Date.now() < until) {
    latest = await windowState(app, id);
    if (predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`${label}: ${JSON.stringify(latest)}`);
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    const header = document.querySelector('.titlebar'), brand = header.querySelector('.titlebar-brand'), spacer = header.querySelector('.titlebar-spacer'), controls = header.querySelector('.window-controls');
    const h = rect(header), b = rect(brand), s = rect(spacer), c = rect(controls), buttons = [...controls.querySelectorAll('button')].map(node => ({...rect(node),label:node.getAttribute('aria-label'),region:getComputedStyle(node).getPropertyValue('-webkit-app-region')}));
    const samples = [
      {name:'left-brand',x:b.x+b.width/2,y:h.y+h.height/2,expected:2},
      {name:'left-blank',x:s.x+Math.min(18,s.width/4),y:h.y+h.height/2,expected:2},
      {name:'middle-blank',x:s.x+s.width/2,y:h.y+h.height/2,expected:2},
      {name:'right-blank',x:s.right-Math.min(18,s.width/4),y:h.y+h.height/2,expected:2},
      ...buttons.map(button => ({name:button.label,x:button.x+button.width/2,y:button.y+button.height/2,expected:1})),
    ];
    // Cover the user's whole right-hand blank area, rather than a single edge
    // point. Both rows stay inside the header, away from native resize borders.
    const rightStart=Math.max(s.x+12,h.x+h.width/2), rightEnd=Math.min(s.right-12,c.x-12);
    if(rightEnd>rightStart) for(const [row,y] of [['upper',h.y+h.height*.34],['lower',h.y+h.height*.72]]) {
      [.05,.25,.5,.75,.95].forEach((fraction,index) => samples.push({name:`right-half-${row}-${index+1}`,x:rightStart+(rightEnd-rightStart)*fraction,y,expected:2}));
    }
    const gap = (name,x,y) => samples.push({name,x,y,expected:2,diagnosticOnly:true});
    if (buttons[0].x > c.x) gap('controls-left-padding',(c.x+buttons[0].x)/2,h.y+h.height/2);
    for (let i=1;i<buttons.length;i++) if (buttons[i].x>buttons[i-1].right) gap(`controls-gap-${i}`,(buttons[i].x+buttons[i-1].right)/2,h.y+h.height/2);
    if (c.right>buttons.at(-1).right) gap('controls-right-padding',(c.right+buttons.at(-1).right)/2,h.y+h.height/2);
    if (buttons[1].y>h.y) gap('controls-above',buttons[1].x+buttons[1].width/2,(h.y+buttons[1].y)/2);
    if (buttons[1].bottom<h.bottom) gap('controls-below',buttons[1].x+buttons[1].width/2,(buttons[1].bottom+h.bottom)/2);
    samples.forEach(point => {
      const node = document.elementFromPoint(point.x,point.y);
      point.element = node ? {tag:node.tagName,className:node.getAttribute('class'),label:node.getAttribute('aria-label'),region:getComputedStyle(node).getPropertyValue('-webkit-app-region')} : null;
    });
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},header:h,brand:b,spacer:s,controls:c,buttons,samples};
  });
}

async function synchronizedGeometry(app,page,id) {
  const expected=await windowState(app,id);
  assert.equal(expected.destroyed,false,'The fixture must exist before measuring its viewport');
  // getZoomFactor()/bounds can update before the renderer receives the matching
  // resize and zoom. Wait for those facts only, never for a desired hit result.
  await page.waitForFunction(({contentBounds,zoom,displayScaleFactor}) =>
    Math.abs(devicePixelRatio-displayScaleFactor*zoom)<.01 &&
    Math.abs(innerWidth-contentBounds.width/zoom)<=2 &&
    Math.abs(innerHeight-contentBounds.height/zoom)<=2,
  expected,{timeout:10000});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dom=await geometry(page), state=await windowState(app,id), viewport=dom.viewport;
  assert.equal(state.zoom,expected.zoom,'Window zoom must remain stable while geometry is captured');
  assert.equal(state.displayScaleFactor,expected.displayScaleFactor,'Window display scale must remain stable while geometry is captured');
  assert.ok(sameBounds(state.contentBounds,expected.contentBounds),'Window content bounds must remain stable while geometry is captured');
  assert.ok(Math.abs(viewport.devicePixelRatio-state.displayScaleFactor*state.zoom)<.01 &&
    Math.abs(viewport.width-state.contentBounds.width/state.zoom)<=2 &&
    Math.abs(viewport.height-state.contentBounds.height/state.zoom)<=2,
  'Captured renderer geometry must match its native zoom, display scale and content bounds: '+JSON.stringify({viewport,state}));
  return {dom,state};
}

function assertNativeGeometry(native,dom) {
  const {width,height,devicePixelRatio}=dom.viewport;
  assert.ok(Math.abs(native.client.width-width*devicePixelRatio)<=3 && Math.abs(native.client.height-height*devicePixelRatio)<=3,
    'The HWND client pixel size must match the synchronized renderer geometry: '+JSON.stringify({client:native.client,viewport:dom.viewport}));
}

async function run() {
  assert.equal(process.platform,'win32','This HWND regression requires Windows');
  if (process.argv.includes('--check-helper')) {
    const result = await nativeProbe({operation:'self-test'});
    assert.equal(result.x,-123); assert.equal(result.y,-456);
    console.log(JSON.stringify(result)); return;
  }
  fs.mkdirSync(artifacts,{recursive:true});
  const report = {ok:false,reproduceOnly,checks:[],probes:[],mismatches:[],actions:[],doubleClick:null,errors:[],crashes:[],stderr:[],screenshots:[],sources:[
    'https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest',
    'https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-clienttoscreen',
    'https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_views_win.cc',
  ]};
  let app, page;
  try {
    const {_electron:electron} = require('../desktop_UI/node_modules/playwright');
    app = await electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'smoke-main.cjs')],cwd:root,env:{...process.env,WUU_RENDERER_URL:process.env.WUU_TITLEBAR_RENDERER || '',WUU_SMOKE_PACKAGED:'0',WUU_VISUAL_FIXTURE:'1',WUU_PLAYER_POLISH_FIXTURE:'0',WUU_COVER_STARTUP:'',WUU_REVIEW_PROFILE:'titlebar-regression'},timeout:30000});
    app.process().stderr?.on('data', bytes => { if(report.stderr.join('').length<20000) report.stderr.push(bytes.toString()); });
    app.process().on('exit',(code,signal) => { report.processExit={code,signal}; });
    await app.firstWindow();
    for (let attempt=0;attempt<200;attempt++) {
      page = app.windows().find(window => window.url().includes('index.html') && !window.url().includes('window=lyrics') && !/\/renderer\//.test(window.url()));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.ok(page,'The fixture must load the production modern UI');
    page.setDefaultTimeout(10000);
    page.on('pageerror',error => report.errors.push(error.message));
    page.on('crash',() => report.crashes.push({source:'Playwright page crash'}));
    await page.locator('.titlebar .window-controls button').last().waitFor();
    report.rendererBundle = await page.locator('script[type="module"]').getAttribute('src');
    report.target = await app.evaluate(({BrowserWindow,ipcMain}, url) => {
      const matches = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.webContents.getURL() === url);
      if (matches.length !== 1) throw new Error('The connected fixture must own exactly one window matching the production page URL');
      const win = matches[0];
      global.__wuuTitlebarNativeEvents=[];global.__wuuTitlebarCrashes=[];global.__wuuTitlebarCalls=[];
      // Observe the existing production handlers without replacing their results.
      // This private handler map is a test-only Electron 33 instrumentation hook.
      for(const channel of ['window-minimize','window-maximize','window-close']) {
        const original=ipcMain._invokeHandlers.get(channel);
        if(typeof original!=='function')throw new Error('Missing production window IPC: '+channel);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel,(event,...args) => {
          if(event.sender===win.webContents)global.__wuuTitlebarCalls.push({channel,senderId:event.sender.id,url:event.sender.getURL(),at:Date.now()});
          return original(event,...args);
        });
      }
      win.webContents.on('render-process-gone',(_event,details) => global.__wuuTitlebarCrashes.push(details));
      for(const message of [0x84,0xA3]) win.hookWindowMessage(message,(wParam,lParam) => {
        const list=global.__wuuTitlebarNativeEvents;
        if(list.length<400)list.push({message,wParam:wParam.toString('hex'),lParam:lParam.toString('hex'),at:Date.now()});
      });
      const handle=win.getNativeWindowHandle();
      return {id:win.id,pid:process.pid,hwnd:handle.length===8?handle.readBigUInt64LE(0).toString():handle.readUInt32LE(0).toString(),url:win.webContents.getURL(),electron:process.versions.electron};
    }, page.url());
    // Playwright can launch through a Windows wrapper. Native ownership uses
    // process.pid from this connected Electron main process, not the launcher.
    report.target.launcherPid=app.process().pid;
    const nav=page.getByRole('navigation',{name:'主导航'});
    const captureProbe=async(stage,route,width,zoom) => {
      const {dom,state}=await synchronizedGeometry(app,page,report.target.id);
      const native=await nativeProbe({operation:'query',target:report.target,viewport:dom.viewport,samples:dom.samples});
      assertNativeGeometry(native,dom);
      const probe={stage,route,width:width??state.contentBounds.width,zoom:zoom??state.zoom,dom,state,native};
      report.probes.push(probe);
      for(const point of native.points) if(!point.diagnosticOnly && point.hit!==point.expected) report.mismatches.push({stage,route,width:probe.width,zoom:probe.zoom,name:point.name,expected:point.expected,actual:point.hit,screenX:point.screenX,screenY:point.screenY});
      return probe;
    };
    for(const route of ['推荐','设置']) {
      await nav.getByRole('button',{name:route,exact:true}).click();
      await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
      for(const width of [1100,800]) for(const zoom of [1,1.25]) {
        await app.evaluate(({BrowserWindow},{id,width,zoom}) => { const win=BrowserWindow.fromId(id);win.setContentSize(width,width===800?500:720);win.webContents.setZoomFactor(zoom); },{id:report.target.id,width,zoom});
        await captureProbe('restored',route,width,zoom);
        const file=path.join(artifacts,`${tag?tag+'-':''}${route==='推荐'?'home':'settings'}-${width}-zoom-${zoom}.png`);
        await page.screenshot({path:file,scale:'css'});report.screenshots.push(file);
      }
    }
    report.checks.push('Native WM_NCHITTEST sampled two real pages, two window sizes and two zoom factors; control gaps are diagnostic only');
    await app.evaluate(({BrowserWindow},id) => { const win=BrowserWindow.fromId(id);win.webContents.setZoomFactor(1);win.setContentSize(1100,720); },report.target.id);
    const {dom,state:before}=await synchronizedGeometry(app,page,report.target.id);
    const native=await nativeProbe({operation:'double-click',target:report.target,viewport:dom.viewport,samples:[dom.samples.find(point => point.name==='right-blank')]});
    assertNativeGeometry(native,dom);
    const after=await windowState(app,report.target.id);
    report.doubleClick={before,native,after,note:'Electron 33 transparent windows suppress native SC_MAXIMIZE; record actual behavior without requiring maximize or faking a resize.'};
    if(after.maximized) {
      const {dom:nextDom}=await synchronizedGeometry(app,page,report.target.id);
      const nextNative=await nativeProbe({operation:'double-click',target:report.target,viewport:nextDom.viewport,samples:[nextDom.samples.find(point => point.name==='right-blank')]});
      assertNativeGeometry(nextNative,nextDom);
      report.doubleClick.restored=await windowState(app,report.target.id);
    }
    const controls=page.locator('.titlebar .window-controls button');
    const normal=await windowState(app,report.target.id);
    assert.equal(await controls.nth(1).getAttribute('aria-label'),'最大化','The isolated fixture starts this action in its restored state');
    await controls.nth(1).click();
    const maximized=await waitState(app,report.target.id,state => sameBounds(state.bounds,normal.workArea),'The actual maximize button must fill its display work area');
    await page.getByRole('button',{name:'还原窗口',exact:true}).waitFor();
    await captureProbe('after-maximize','设置');
    await nav.getByRole('button',{name:'推荐',exact:true}).click();
    await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
    await captureProbe('after-maximize-page-switch','推荐');
    report.checks.push('Right-half upper/lower blank points remain native HTCAPTION after actual maximize and page navigation; buttons remain HTCLIENT');
    await controls.nth(1).click();
    const restored=await waitState(app,report.target.id,state => sameBounds(state.bounds,normal.bounds),'The actual restore button must restore its original fixture bounds');
    await page.getByRole('button',{name:'最大化',exact:true}).waitFor();
    report.actions.push({action:'maximize/restore',normal,maximized,restored});
    await controls.nth(0).click();
    const minimized=await waitState(app,report.target.id,state => state.minimized,'The actual minimize button must minimize its fixture window');
    await app.evaluate(({BrowserWindow},id) => { const win=BrowserWindow.fromId(id);win.restore();win.show();win.focus(); },report.target.id);
    await waitState(app,report.target.id,state => !state.minimized && state.visible,'The fixture restores after minimizing');
    report.actions.push({action:'minimize',minimized});
    await controls.nth(2).click();
    const closed=await waitState(app,report.target.id,state => !state.visible,'Close must hide the fixture to its tray');
    assert.equal(closed.destroyed,false,'Close preserves the application window for the tray');
    report.actions.push({action:'close-to-tray',closed});
    const calls=await app.evaluate(() => global.__wuuTitlebarCalls);
    assert.deepEqual(calls.map(call => call.channel),['window-maximize','window-maximize','window-minimize','window-close'],'Actual UI buttons call each production window handler with the expected sequence');
    report.checks.push('The three actual HTML buttons invoke production IPC to minimize, maximize, restore and hide to tray');
    assert.deepEqual(report.errors,[]);
    assert.deepEqual(report.crashes,[]);
    report.ok=report.mismatches.length===0;
    if(!reproduceOnly)assert.deepEqual(report.mismatches,[],'Empty titlebar regions must be native HTCAPTION; actual buttons must be HTCLIENT');
  } catch(error) {
    report.error=error.stack||String(error);process.exitCode=1;
    if(page)await page.screenshot({path:path.join(artifacts,`${tag?tag+'-':''}failure.png`)}).catch(()=>{});
  } finally {
    if(app) {
      report.nativeEvents=await app.evaluate(() => global.__wuuTitlebarNativeEvents).catch(()=>null);
      report.ipcCalls=await app.evaluate(() => global.__wuuTitlebarCalls).catch(()=>null);
      report.renderProcessGone=await app.evaluate(() => global.__wuuTitlebarCrashes).catch(()=>null);
      await app.evaluate(({app}) => app.exit(0)).catch(()=>{});
      await app.close().catch(()=>{});
    }
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({ok:report.ok,reproduceOnly,mismatches:report.mismatches,error:report.error,report:reportFile},null,2));
}

run().catch(error => {console.error(error);process.exitCode=1;});
