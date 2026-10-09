// Root launches GUI serially. All windows, user data and captures belong to this fixture.
// Checks actual DWM composition, not WebContents screenshots or CSS blur declarations.
// --startup-only tests a saved true preference; --check-helper compiles native code only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.join(__dirname,'..');
const artifacts = path.join(root,'.test-artifacts','frosted');
const tag = /^[a-z0-9-]{1,48}$/.test(process.env.WUU_FROSTED_TAG || '') ? process.env.WUU_FROSTED_TAG : '';
const reportFile = path.join(artifacts,`${tag ? tag+'-' : ''}report.json`);
const powershellSource = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class WuuFrostedNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public uint BatteryLifeTime; public uint BatteryFullLifeTime; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint processId);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool ClientToScreen(IntPtr hwnd,ref POINT point);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd,uint attribute,out int value,int size);
  [DllImport("dwmapi.dll")] public static extern int DwmIsCompositionEnabled(out bool enabled);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
  [DllImport("user32.dll",SetLastError=true)] private static extern IntPtr SendMessageTimeoutW(IntPtr hwnd,uint msg,UIntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);
  public static void ValidateOwner(IntPtr hwnd,uint expectedPid) {
    uint actualPid;
    if(!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd,out actualPid)==0 || actualPid!=expectedPid)
      throw new InvalidOperationException("Refusing a HWND outside the launched fixture process");
  }
  public static int HitTest(IntPtr hwnd,uint pid,int x,int y) {
    ValidateOwner(hwnd,pid);
    if(x<short.MinValue || x>short.MaxValue || y<short.MinValue || y>short.MaxValue)throw new ArgumentOutOfRangeException("screen point");
    IntPtr point=new IntPtr(unchecked((int)(((uint)(ushort)y<<16)|(ushort)x)));UIntPtr result;
    if(SendMessageTimeoutW(hwnd,0x84,UIntPtr.Zero,point,0x23,2000,out result)==IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(),"Targeted fixture hit-test failed");
    return unchecked((int)result.ToUInt64());
  }
  public static bool Intersects(RECT a,RECT b) {
    return a.Left<b.Right && a.Right>b.Left && a.Top<b.Bottom && a.Bottom>b.Top;
  }
  public static void ValidateCapture(IntPtr main,IntPtr background,uint pid,RECT source) {
    ValidateOwner(main,pid); ValidateOwner(background,pid);
    if(!IsWindowVisible(main) || IsIconic(main) || !IsWindowVisible(background) || GetForegroundWindow()!=main)
      throw new InvalidOperationException("Only the visible foreground fixture may be screen-captured");
    RECT backing;
    if(!GetWindowRect(background,out backing) || backing.Left>source.Left || backing.Top>source.Top || backing.Right<source.Right || backing.Bottom<source.Bottom)
      throw new InvalidOperationException("The fixture's opaque background must cover its whole capture rectangle");
    RECT screen;
    screen.Left=GetSystemMetrics(76);screen.Top=GetSystemMetrics(77);
    screen.Right=screen.Left+GetSystemMetrics(78);screen.Bottom=screen.Top+GetSystemMetrics(79);
    if(source.Left<screen.Left || source.Top<screen.Top || source.Right>screen.Right || source.Bottom>screen.Bottom)
      throw new InvalidOperationException("The fixture capture must stay within physical displays");
    // Reject every visible intersecting window above the fixture, including
    // overlays. No pixels from another application are intentionally captured.
    IntPtr above=GetWindow(main,3);int count=0;
    while(above!=IntPtr.Zero && count++<2048) {
      RECT box;
      if(IsWindowVisible(above) && GetWindowRect(above,out box) && Intersects(source,box))
        throw new InvalidOperationException("Another visible window obscures the fixture capture");
      above=GetWindow(above,3);
    }
    if(count>=2048)throw new InvalidOperationException("Window ownership audit exceeded its bound");
    // Verify screen hit ownership away from rounded, transparent corner pixels.
    for(int y=source.Top+10;y<source.Bottom-10;y+=32)for(int x=source.Left+10;x<source.Right-10;x+=32) {
      POINT point;point.X=x;point.Y=y;
      if(GetAncestor(WindowFromPoint(point),2)!=main)
        throw new InvalidOperationException("A screen point does not belong to the fixture root window");
    }
  }
  public static double[] Capture(IntPtr main,IntPtr background,uint pid,RECT source,RECT sample,string output) {
    ValidateCapture(main,background,pid,source);
    int width=source.Right-source.Left,height=source.Bottom-source.Top;
    int sx=sample.Left,sy=sample.Top,sw=sample.Right-sample.Left,sh=sample.Bottom-sample.Top;
    if(sx<0 || sy<0 || sw<32 || sh<1 || sample.Right>width || sample.Bottom>height)
      throw new InvalidOperationException("The composition sample must stay inside the fixture client");
    using(Bitmap bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
      using(Graphics graphics=Graphics.FromImage(bitmap))
        graphics.CopyFromScreen(source.Left,source.Top,0,0,new Size(width,height),CopyPixelOperation.SourceCopy);
      ValidateCapture(main,background,pid,source);
      double[] columns=new double[sw];
      for(int x=0;x<sw;x++)for(int y=0;y<sh;y++) {
        Color p=bitmap.GetPixel(sx+x,sy+y);
        columns[x]+=(.2126*p.R+.7152*p.G+.0722*p.B)/sh;
      }
      double mean=0,variance=0,energy=0,leftMean=0,rightMean=0;int quarter=sw/4;double[] deltas=new double[sw-1];
      foreach(double v in columns)mean+=v/sw;
      for(int x=0;x<quarter;x++) {leftMean+=columns[x]/quarter;rightMean+=columns[sw-quarter+x]/quarter;}
      for(int x=0;x<sw;x++) {
        variance+=(columns[x]-mean)*(columns[x]-mean)/sw;
        if(x>0) {deltas[x-1]=Math.Abs(columns[x]-columns[x-1]);energy+=deltas[x-1]/(sw-1);}
      }
      Array.Sort(deltas);
      bitmap.Save(output,ImageFormat.Png);
      return new double[]{mean,Math.Sqrt(variance),energy,deltas[(int)Math.Floor((deltas.Length-1)*.95)],deltas[deltas.Length-1],sw,sh,leftMean,rightMean,Math.Abs(rightMean-leftMean)};
    }
  }
}
'@
if($payload.operation -eq 'self-test') { @{compiled=$true;drawAssembly=[System.Drawing.Bitmap].Assembly.GetName().Name} | ConvertTo-Json -Compress;exit }
$hwnd=[IntPtr]::new([Int64]::Parse([string]$payload.target.hwnd))
$pidExpected=[uint32]$payload.target.pid
[WuuFrostedNative]::ValidateOwner($hwnd,$pidExpected)
if([WuuFrostedNative]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero) { throw 'Per-monitor DPI awareness could not be enabled' }
$client=New-Object WuuFrostedNative+RECT
$origin=New-Object WuuFrostedNative+POINT
if(-not [WuuFrostedNative]::GetClientRect($hwnd,[ref]$client) -or -not [WuuFrostedNative]::ClientToScreen($hwnd,[ref]$origin)) { throw 'The fixture has no native client coordinates' }
$backdrop=[int]0;$composition=[bool]$false
$result=[WuuFrostedNative]::DwmGetWindowAttribute($hwnd,38,[ref]$backdrop,4)
$compositionResult=[WuuFrostedNative]::DwmIsCompositionEnabled([ref]$composition)
$transparency=$null
try { $transparency=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name EnableTransparency -ErrorAction Stop } catch {}
$power=New-Object WuuFrostedNative+SYSTEM_POWER_STATUS
$powerAvailable=[WuuFrostedNative]::GetSystemPowerStatus([ref]$power)
$answer=@{hresult=$result;backdrop=$backdrop;composition=$composition;compositionResult=$compositionResult;transparency=$transparency;batterySaver=$(if($powerAvailable){[int]$power.SystemStatusFlag}else{$null});remoteSession=[WuuFrostedNative]::GetSystemMetrics(4096);dpi=[WuuFrostedNative]::GetDpiForWindow($hwnd);client=@{x=$origin.X;y=$origin.Y;width=$client.Right-$client.Left;height=$client.Bottom-$client.Top}}
if($payload.samples) {
  $scaleX=($client.Right-$client.Left)/[double]$payload.viewport.width
  $scaleY=($client.Bottom-$client.Top)/[double]$payload.viewport.height
  $answer.hits=@($payload.samples | ForEach-Object {
    $x=$origin.X+[int][Math]::Round($_.x*$scaleX);$y=$origin.Y+[int][Math]::Round($_.y*$scaleY)
    @{name=$_.name;expected=$_.expected;hit=[WuuFrostedNative]::HitTest($hwnd,$pidExpected,$x,$y)}
  })
}
if($payload.operation -eq 'capture') {
  $background=[IntPtr]::new([Int64]::Parse([string]$payload.background.hwnd))
  if([uint32]$payload.background.pid -ne $pidExpected) { throw 'The fixture background must share the captured process owner' }
  $scaleX=($client.Right-$client.Left)/[double]$payload.viewport.width
  $scaleY=($client.Bottom-$client.Top)/[double]$payload.viewport.height
  $source=New-Object WuuFrostedNative+RECT
  $source.Left=$origin.X;$source.Top=$origin.Y;$source.Right=$origin.X+$client.Right-$client.Left;$source.Bottom=$origin.Y+$client.Bottom-$client.Top
  $sample=New-Object WuuFrostedNative+RECT
  $sample.Left=[int][Math]::Ceiling($payload.sample.x*$scaleX);$sample.Top=[int][Math]::Ceiling($payload.sample.y*$scaleY)
  $sample.Right=[int][Math]::Floor(($payload.sample.x+$payload.sample.width)*$scaleX);$sample.Bottom=[int][Math]::Floor(($payload.sample.y+$payload.sample.height)*$scaleY)
  [void][WuuFrostedNative]::DwmFlush()
  $stats=[WuuFrostedNative]::Capture($hwnd,$background,$pidExpected,$source,$sample,[string]$payload.output)
  $answer.capture=@{file=$payload.output;mean=$stats[0];stddev=$stats[1];edgeEnergy=$stats[2];p95Edge=$stats[3];maxEdge=$stats[4];sampleWidth=$stats[5];sampleHeight=$stats[6];leftQuarterMean=$stats[7];rightQuarterMean=$stats[8];coarseContrast=$stats[9];sample=@{x=$sample.Left;y=$sample.Top;width=$sample.Right-$sample.Left;height=$sample.Bottom-$sample.Top}}
}
$answer | ConvertTo-Json -Depth 6 -Compress
`;

function nativeProbe(payload) {
  return new Promise((resolve,reject) => {
    const exe=path.join(process.env.SystemRoot || 'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(powershellSource,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',bytes => {stdout+=bytes;});child.stderr.on('data',bytes => {stderr+=bytes;});
    child.on('error',reject);
    child.on('close',code => {
      if(code!==0)return reject(new Error(`Native fixture probe failed (${code}): ${stderr.trim()}`));
      try {resolve(JSON.parse(stdout.replace(/^\uFEFF/,'').trim()));}catch(error){reject(new Error(`Native probe returned invalid JSON: ${stdout}\n${stderr}\n${error.message}`));}
    });
    child.stdin.on('error',error => {if(error.code!=='EPIPE')reject(error);});child.stdin.end(JSON.stringify(payload));
  });
}

async function openAppearance(page) {
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('tabpanel',{name:'外观',exact:true}).waitFor();
}

async function waitSaved(app,expected) {
  const until=Date.now()+5000;let latest;
  while(Date.now()<until) {
    latest=await app.evaluate(() => global.__wuuSmoke.data.settings);
    if(Object.entries(expected).every(([key,value]) => latest[key]===value))return latest;
    await new Promise(resolve => setTimeout(resolve,30));
  }
  assert.fail('Fixture saved preferences did not match '+JSON.stringify({expected,actual:latest}));
}

async function sliderByKeyboard(page,label,value) {
  const slider=page.getByRole('slider',{name:label,exact:true});
  const minimum=Number(await slider.getAttribute('min')),step=Number(await slider.getAttribute('step'))||1;
  await slider.focus();await slider.press('Home');
  for(let i=0;i<Math.round((value-minimum)/step);i++)await slider.press('ArrowRight');
  assert.equal(Number(await slider.inputValue()),value,`Real keyboard input sets ${label}`);
}

async function prepareBackground(app,target) {
  return app.evaluate(async ({BrowserWindow},target) => {
    const main=BrowserWindow.fromId(target.id);
    if(!main || main.isDestroyed() || process.pid!==target.pid)throw new Error('Missing owned fixture window');
    const bounds=main.getBounds();
    const background=new BrowserWindow({x:bounds.x-24,y:bounds.y-24,width:bounds.width+48,height:bounds.height+48,show:false,frame:false,transparent:false,backgroundColor:'#101010',focusable:false,skipTaskbar:true,resizable:false,movable:false,alwaysOnTop:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    // Fine stripes have equal contrast on both large dark/light halves. A tint
    // scales both frequencies; blur must preferentially remove the fine edges.
    const html='<!doctype html><html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0,rgba(255,255,255,.22) 8px,rgba(0,0,0,.22) 8px,rgba(0,0,0,.22) 16px),linear-gradient(90deg,#202020 0,#202020 50%,#b0b0b0 50%,#b0b0b0 100%)}</style><body></body></html>';
    await background.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    background.showInactive();background.moveTop();main.setAlwaysOnTop(true);main.show();main.moveTop();main.focus();
    global.__wuuFrostedBackgroundId=background.id;
    const handle=background.getNativeWindowHandle();
    return {id:background.id,pid:process.pid,hwnd:handle.length===8?handle.readBigUInt64LE(0).toString():handle.readUInt32LE(0).toString()};
  },target);
}

async function compositionCapture(app,page,target,background,stage,report) {
  await app.evaluate(({BrowserWindow},id) => {const win=BrowserWindow.fromId(id);win.show();win.moveTop();win.focus();},target.id);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry=await page.evaluate(() => {
    const header=document.querySelector('.titlebar').getBoundingClientRect(),spacer=document.querySelector('.titlebar-spacer').getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},sample:{x:spacer.x+24,y:header.y+header.height/2-2,width:spacer.width-48,height:4}};
  });
  const output=path.join(artifacts,`${tag?tag+'-':''}${stage}-composition.png`);
  const native=await nativeProbe({operation:'capture',target,background,...geometry,output});
  assert.ok(Math.abs(native.client.width-geometry.viewport.width*geometry.viewport.devicePixelRatio)<=3 && Math.abs(native.client.height-geometry.viewport.height*geometry.viewport.devicePixelRatio)<=3,'Native capture dimensions match physical renderer pixels');
  report.captures.push({stage,geometry,native});
  return native;
}

async function checkHitRegions(page,target,stage,report) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry=await page.evaluate(() => {
    const h=document.querySelector('.titlebar').getBoundingClientRect(),b=document.querySelector('.titlebar-brand').getBoundingClientRect(),s=document.querySelector('.titlebar-spacer').getBoundingClientRect();
    const samples=[{name:'brand',x:b.x+b.width/2,y:h.y+h.height/2,expected:2},
      ...[.05,.5,.95].map((fraction,index) => ({name:`blank-${index+1}`,x:s.x+12+(s.width-24)*fraction,y:h.y+h.height/2,expected:2})),
      ...[...document.querySelectorAll('.titlebar .window-controls button')].map(button => {const r=button.getBoundingClientRect();return {name:button.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2,expected:1};})];
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},samples};
  });
  const native=await nativeProbe({operation:'query',target,...geometry});
  assert.ok(Math.abs(native.client.width-geometry.viewport.width*geometry.viewport.devicePixelRatio)<=3 && Math.abs(native.client.height-geometry.viewport.height*geometry.viewport.devicePixelRatio)<=3,'Native hit samples match the actual renderer pixel dimensions');
  for(const point of native.hits)assert.equal(point.hit,point.expected,`${stage}: ${point.name} keeps its native caption/client interaction with acrylic active`);
  report.hitTests.push({stage,native});
}

async function maximizeAndRestore(app,page,target,report) {
  const state=async() => app.evaluate(({BrowserWindow,screen},id) => {
    const win=BrowserWindow.fromId(id),bounds=win.getBounds();
    const display=screen.getDisplayMatching(bounds);
    return {bounds,contentBounds:win.getContentBounds(),workArea:display.workArea,displayScaleFactor:display.scaleFactor,zoom:win.webContents.getZoomFactor()};
  },target.id);
  const equal=(a,b) => ['x','y','width','height'].every(key => Math.abs(a[key]-b[key])<=1);
  const wait=async(expected,label) => {
    const until=Date.now()+5000;let latest;
    while(Date.now()<until) {latest=await state();if(equal(latest.bounds,expected))return latest;await new Promise(resolve => setTimeout(resolve,30));}
    assert.fail(label+': '+JSON.stringify({expected,actual:latest}));
  };
  const before=await state();
  await page.locator('.titlebar .window-maximize').click();
  const maximized=await wait(before.workArea,'The actual maximize button fills its display work area');
  await page.getByRole('button',{name:'还原窗口',exact:true}).waitFor();
  // Wait for the matching viewport instead of treating a stale DOM as native pixels.
  await page.waitForFunction(({contentBounds,zoom,displayScaleFactor}) =>
    Math.abs(devicePixelRatio-displayScaleFactor*zoom)<.01 && Math.abs(innerWidth-contentBounds.width/zoom)<=2 && Math.abs(innerHeight-contentBounds.height/zoom)<=2,maximized);
  await checkHitRegions(page,target,'maximized-acrylic',report);
  await page.locator('.titlebar .window-maximize').click();
  const restored=await wait(before.bounds,'The actual restore button returns the fixture to its saved bounds');
  await page.getByRole('button',{name:'最大化',exact:true}).waitFor();
  await page.waitForFunction(({contentBounds,zoom,displayScaleFactor}) =>
    Math.abs(devicePixelRatio-displayScaleFactor*zoom)<.01 && Math.abs(innerWidth-contentBounds.width/zoom)<=2 && Math.abs(innerHeight-contentBounds.height/zoom)<=2,restored);
  report.windowActions={before,maximized,restored};
  report.checks.push('Actual maximize and restore controls work with acrylic, and native drag/button hits stay correct when maximized');
}

function compareComposition(off,on,position,report) {
  const limited=off.transparency===0 || on.transparency===0 || off.batterySaver===1 || on.batterySaver===1 || !off.composition || !on.composition || off.remoteSession!==0 || on.remoteSession!==0;
  const ratio=on.capture.edgeEnergy/off.capture.edgeEnergy;
  const normalizedRatio=(on.capture.edgeEnergy/on.capture.coarseContrast)/(off.capture.edgeEnergy/off.capture.coarseContrast);
  const result={position,off:off.capture,on:on.capture,edgeEnergyRatio:ratio,normalizedFineEdgeRatio:normalizedRatio,limited};
  report.comparisons.push(result);
  if(limited) {
    report.limitations.push('Composition contrast was not asserted because Windows transparency is disabled, battery saver is active, DWM composition is unavailable, or this is a remote session; system settings were not changed.');
    return;
  }
  assert.ok(off.capture.edgeEnergy>.75,'The controlled striped fixture background must be visible without frosting: '+JSON.stringify(result));
  assert.ok(off.capture.coarseContrast>20,'The controlled large background halves must remain distinguishable without frosting: '+JSON.stringify(result));
  assert.ok(on.capture.coarseContrast>Math.max(1,off.capture.coarseContrast*.02),'Native frosting must retain coarse background variation instead of replacing it with an opaque fill: '+JSON.stringify(result));
  assert.ok(Number.isFinite(ratio) && ratio<.7 && Number.isFinite(normalizedRatio) && normalizedRatio<.7,'Native blur must attenuate fine stripes relative to retained coarse background contrast, rather than simply tinting everything: '+JSON.stringify(result));
  report.checks.push(`Native foreground composition preserves coarse background variation while attenuating normalized fine stripe edges in the Apple ${position} layout`);
}

async function scenario(startup,report) {
  const section={startup,checks:[],attributes:[],captures:[],comparisons:[],preferences:[],hitTests:[],errors:[],crashes:[],limitations:[],stderr:[],ok:false};
  report.scenarios.push(section);let app,page;
  try {
    const {_electron:electron}=require('../desktop_UI/node_modules/playwright');
    app=await electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'smoke-main.cjs')],cwd:root,env:{...process.env,WUU_RENDERER_URL:'',WUU_SMOKE_PACKAGED:'0',WUU_VISUAL_FIXTURE:'1',WUU_PLAYER_POLISH_FIXTURE:'0',WUU_COVER_STARTUP:'',WUU_FROSTED_STARTUP:startup?'1':'0',WUU_REVIEW_PROFILE:startup?'frosted-startup':'frosted-regression'},timeout:30000});
    app.process().stderr?.on('data',bytes => {if(section.stderr.join('').length<20000)section.stderr.push(bytes.toString());});
    await app.firstWindow();
    for(let attempt=0;attempt<200;attempt++) {
      page=app.windows().find(win => /\/desktop_UI\/dist\/index\.html/.test(win.url()) && !win.url().includes('window=lyrics'));
      if(page)break;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.ok(page,'The fixture loads the production modern renderer');page.setDefaultTimeout(10000);
    page.on('pageerror',error => section.errors.push(error.message));page.on('crash',() => section.crashes.push('Renderer page crash'));
    await page.locator('.titlebar').waitFor();
    section.bundle=await page.locator('script[type="module"]').getAttribute('src');
    const target=section.target=await app.evaluate(({BrowserWindow},url) => {
      const matches=BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.webContents.getURL()===url);
      if(matches.length!==1)throw new Error('The connected fixture must own exactly one production main page');
      const win=matches[0],handle=win.getNativeWindowHandle();
      global.__wuuFrostedCrashes=[];win.webContents.on('render-process-gone',(_event,details) => global.__wuuFrostedCrashes.push(details));
      return {id:win.id,pid:process.pid,hwnd:handle.length===8?handle.readBigUInt64LE(0).toString():handle.readUInt32LE(0).toString(),url,electron:process.versions.electron};
    },page.url());
    const support=section.support=await page.evaluate(() => window.windowAPI.getFrostedGlassSupport());
    const query=async(stage,value) => {
      let latest;
      for(let attempt=0;attempt<5;attempt++) {
        latest=await nativeProbe({operation:'query',target});
        if(latest.hresult===0 && latest.backdrop===value)break;
        await new Promise(resolve => setTimeout(resolve,60));
      }
      section.attributes.push({stage,expected:value,native:latest});
      assert.equal(latest.hresult,0,'The actual fixture HWND exposes DWM_SYSTEMBACKDROP_TYPE');
      assert.equal(latest.backdrop,value,`${stage} applies the expected real DWM backdrop type`);
      return latest;
    };
    await openAppearance(page);
    const toggle=page.getByRole('checkbox',{name:'磨砂玻璃（实验性）',exact:true});
    await toggle.waitFor();
    if(!support.supported) {
      await page.locator('#settings-frosted-glass-description').filter({hasText:support.reason}).waitFor();
      await page.waitForFunction(() => document.querySelector('input[aria-label="磨砂玻璃（实验性）"]')?.disabled);
      assert.equal(await toggle.isEnabled(),false,'Unsupported systems cannot enable native frosting');
      assert.equal(await toggle.isChecked(),false,'Unsupported systems do not present a retained saved preference as an applied native effect');
      assert.ok(typeof support.reason==='string' && support.reason.length>0,'Unsupported systems give a concrete reason');
      if(startup)await waitSaved(app,{experimentalFrostedGlass:true});
      section.limitations.push(support.reason);section.checks.push('Unsupported native frosting is disabled with a clear explanation');
    } else {
      await page.waitForFunction(() => document.querySelector('input[aria-label="磨砂玻璃（实验性）"]')?.disabled===false);
      assert.equal(await toggle.isChecked(),startup,'Saved experimental frosting preference is reflected by the actual supported UI');
      await query(startup?'saved-startup-on':'default-off',startup?3:1);
      if(startup) {
        await waitSaved(app,{experimentalFrostedGlass:true});
        await toggle.setChecked(false);await waitSaved(app,{experimentalFrostedGlass:false});await query('saved-startup-restored-off',1);
        section.checks.push('A saved true preference applies actual acrylic on startup and can be restored off');
      } else {
        await sliderByKeyboard(page,'界面透明度',37);
        await page.getByRole('checkbox',{name:'全局背景跟随封面',exact:true}).setChecked(true);
        await page.getByRole('checkbox',{name:'Apple 风格（实验性）',exact:true}).setChecked(true);
        await page.locator('.titlebar[data-window-style="apple"][data-controls-position="left"]').waitFor();
        const preserved={glassOpacity:.37,themeFollowCover:true,experimentalAppleUI:true};
        await waitSaved(app,{...preserved,experimentalFrostedGlass:false,appleControlsPosition:'left'});
        const background=section.background=await prepareBackground(app,target);
        const offLeft=await compositionCapture(app,page,target,background,'left-off',section);
        await toggle.setChecked(true);await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'left'});await query('apple-left-on',3);
        await checkHitRegions(page,target,'apple-left-acrylic',section);
        const onLeft=await compositionCapture(app,page,target,background,'left-on',section);
        compareComposition(offLeft,onLeft,'left',section);
        await page.getByRole('combobox',{name:'窗口按钮位置',exact:true}).selectOption('right');
        await page.locator('.titlebar[data-window-style="apple"][data-controls-position="right"]').waitFor();
        await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'right'});await query('apple-right-on',3);
        const onRight=await compositionCapture(app,page,target,background,'right-on',section);
        await checkHitRegions(page,target,'apple-right-acrylic',section);
        await maximizeAndRestore(app,page,target,section);await query('after-maximize-restored-on',3);
        await toggle.setChecked(false);await waitSaved(app,{...preserved,experimentalFrostedGlass:false,appleControlsPosition:'right'});await query('apple-right-off',1);
        const offRight=await compositionCapture(app,page,target,background,'right-off',section);
        compareComposition(offRight,onRight,'right',section);
        await toggle.setChecked(true);await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'right'});await query('before-reload-on',3);
        await page.reload();await page.locator('.titlebar[data-window-style="apple"][data-controls-position="right"]').waitFor();await openAppearance(page);
        assert.equal(await toggle.isChecked(),true,'Renderer reload retains the enabled experimental frosting preference');await query('after-reload-on',3);
        section.preferences.push({stage:'after-reload',saved:await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'right'})});
        await page.getByRole('button',{name:'切换到旧版界面',exact:true}).click();await page.waitForURL(/\/renderer\/index\.html(?:[?#]|$)/);await page.locator('#top-bar').waitFor();
        await query('classic-no-frosting',1);
        section.preferences.push({stage:'classic-preserves-experiment',saved:await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'right'})});
        await page.locator('.nav-item[data-view="settings"]').click();await page.waitForFunction(() => typeof _userDataReady!=='undefined' && _userDataReady);await page.locator('#btn-modern-interface').click();
        const original=new URL(target.url);await page.waitForURL(url => url.protocol===original.protocol && url.host===original.host && url.pathname===original.pathname);
        await page.locator('.titlebar[data-window-style="apple"][data-controls-position="right"]').waitFor();await openAppearance(page);await query('returned-modern-frosting',3);
        section.preferences.push({stage:'returned-modern',saved:await waitSaved(app,{...preserved,experimentalFrostedGlass:true,appleControlsPosition:'right'})});
        await toggle.setChecked(false);await query('final-restored-off',1);section.preferences.push({stage:'final-restored-off',saved:await waitSaved(app,{...preserved,experimentalFrostedGlass:false,appleControlsPosition:'right'})});
        section.checks.push('Actual settings toggle saves on/off, reload keeps on, classic removes native frosting, and returning modern restores it without resetting Apple position, opacity or cover following');
      }
    }
    assert.deepEqual(section.errors,[],'No renderer errors occur during native frosting changes');assert.deepEqual(section.crashes,[]);
    assert.deepEqual(await app.evaluate(() => global.__wuuFrostedCrashes),[],'No production render-process-gone event occurs during native frosting changes');
    section.ok=true;
  } catch(error) {
    section.error=error.stack || String(error);throw error;
  } finally {
    if(app) {
      section.renderProcessGone=await app.evaluate(() => global.__wuuFrostedCrashes).catch(()=>null);
      await app.evaluate(({app}) => app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
    }
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  }
}

async function run() {
  assert.equal(process.platform,'win32','This native DWM regression requires Windows');
  if(process.argv.includes('--check-helper')) {console.log(JSON.stringify(await nativeProbe({operation:'self-test'})));return;}
  fs.mkdirSync(artifacts,{recursive:true});
  const report={ok:false,scenarios:[],sources:[
    'https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type',
    'https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute',
    'https://learn.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen',
    'https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-system_power_status',
  ]};
  try {
    if(!process.argv.includes('--startup-only'))await scenario(false,report);
    await scenario(true,report);report.ok=report.scenarios.every(item => item.ok);
  } catch(error) {report.error=error.stack || String(error);process.exitCode=1;}
  finally {fs.writeFileSync(reportFile,JSON.stringify(report,null,2));}
  console.log(JSON.stringify({ok:report.ok,scenarios:report.scenarios.map(item => ({startup:item.startup,ok:item.ok,support:item.support,checks:item.checks,limitations:item.limitations,error:item.error})),report:reportFile},null,2));
}
run().catch(error => {console.error(error);process.exitCode=1;});
