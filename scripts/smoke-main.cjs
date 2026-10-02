// A real Electron renderer with fixture IPC. User music/configuration is never written.
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const runtimeRoot = process.env.WUU_SMOKE_PACKAGED === '1' ? path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar') : root;
const artifacts = path.join(root, '.test-artifacts');
const polishFixture = process.env.WUU_PLAYER_POLISH_FIXTURE === '1';
const coverStartup = polishFixture && ['hidden', 'minimized'].includes(process.env.WUU_COVER_STARTUP) ? process.env.WUU_COVER_STARTUP : '';
const visualFixture = ['1', 'empty'].includes(process.env.WUU_VISUAL_FIXTURE);
const emptyFixture = process.env.WUU_VISUAL_FIXTURE === 'empty';
const reviewProfile = /^[a-z0-9-]+$/.test(process.env.WUU_REVIEW_PROFILE || '') ? '-' + process.env.WUU_REVIEW_PROFILE : '';
const profile = path.join(artifacts, (polishFixture ? `electron-player-polish-profile${coverStartup ? '-' + coverStartup : ''}` : visualFixture ? `electron-visual-profile${emptyFixture ? '-empty' : ''}` : process.env.WUU_SMOKE_PACKAGED === '1' ? 'electron-packed-profile' : 'electron-profile') + reviewProfile);
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const fixture = path.join(artifacts, polishFixture ? '播放器细节验证音乐' : visualFixture ? '视觉验证音乐' : '音乐 文件');
fs.mkdirSync(fixture, { recursive: true });
const audioPath = path.join(fixture, 'React 测试歌曲.wav');
const lyricPath = path.join(fixture, '测试歌词.lrc');
const seconds = 90, rate = 16000, bytes = seconds * rate * 2;
const wav = Buffer.alloc(44 + bytes);
wav.write('RIFF'); wav.writeUInt32LE(36 + bytes,4); wav.write('WAVE',8); wav.write('fmt ',12);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24);
wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(bytes,40);
fs.writeFileSync(audioPath,wav);
const secondPath = path.join(fixture,'第二首测试歌曲.wav');
fs.copyFileSync(audioPath,secondPath);
fs.writeFileSync(lyricPath,'[00:00.00]React 桌面播放器\n[00:03.00]页面切换时音乐继续播放\n[00:08.00]歌词与进度保持同步\n[00:15.00]欢迎使用 Wuu 音乐','utf8');
const artwork = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#ffc2cf"/><stop offset="1" stop-color="#7061a8"/></linearGradient></defs><rect width="400" height="400" fill="url(#a)"/><circle cx="200" cy="200" r="95" fill="#fff" opacity=".14"/><text x="200" y="220" font-size="68" fill="white" text-anchor="middle" font-family="sans-serif">Wuu</text></svg>');
let songs = [
  { id:0,audioPath,songName:'React 测试歌曲',artist:'Wuu',album:'桌面迁移验证',coverPath:artwork,lrcPath:lyricPath,rawPath:null,realDuration:seconds },
  { id:1,audioPath:secondPath,songName:'第二首测试歌曲',artist:'Wuu',coverPath:artwork,lrcPath:lyricPath,realDuration:seconds },
];
let userData = { likes:[],dislikes:[],collections:[{id:'existing',name:'原有歌单',songs:[audioPath],createdAt:123}],stats:{[audioPath]:{plays:4,duration:320}},progress:{[audioPath]:0},actualDuration:{},lastSession:null,settings:{playMode:1,volume:.5,serverEnabled:false,mobileEnabled:false} };
// Original geometric artwork and invented metadata keep visual review offline and reproducible.
if (visualFixture) {
  const records = [
    ['海岸慢车', '林间来信', '向海而生', '#192f39', '#d7ab76'],
    ['蓝色凌晨', '岛屿电台', '城市漫游', '#202945', '#838acb'],
    ['晚风经过天台', '陈一日', '把时间放慢', '#c55d40', '#edd8ac'],
    ['雨后的森林', '山野合奏', '自然来信', '#304b3c', '#a1be86'],
    ['周末没有计划', '小岛与朋友', '松弛的生活', '#b48746', '#eadbbc'],
    ['流动的光', '空白乐队', '另一种可能', '#586373', '#bdccda'],
    ['等最后一班地铁带我穿过这座还未入睡的城市', '城市边缘的旅人', '在路上的每个夜晚', '#483548', '#c5a1b1'],
    ['温柔的引力', '苏眠', '浮光', '#76432c', '#e6b98b'],
    ['云停在这里', '白昼梦', '晴朗之后', '#567f89', '#c5d7d0'],
    ['我们还有整个夏天', '南方公园', '夏日终曲', '#485232', '#d4c381'],
  ];
  songs = emptyFixture ? [] : records.map(([songName, artist, album, ink, paper], index) => {
    const file = path.join(fixture, `${songName}.wav`);
    fs.copyFileSync(audioPath, file);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs><pattern id="lines" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 24 24 0" stroke="${paper}" stroke-opacity=".09"/></pattern></defs><rect width="640" height="640" fill="${ink}"/><rect width="640" height="640" fill="url(#lines)"/><circle cx="${220 + index * 19}" cy="${230 + index * 11}" r="${135 + index * 5}" fill="${paper}"/><path d="M-40 440 Q140 ${130 + index * 17} 380 430 T700 340 V700 H-40Z" fill="${ink}" opacity=".72"/><path d="M-40 475 Q140 260 360 490 T700 420" fill="none" stroke="${paper}" stroke-width="2" opacity=".7"/><text x="44" y="73" font-family="sans-serif" font-size="18" letter-spacing="6" fill="${paper}">WUU / ORIGINALS</text><text x="44" y="570" font-family="sans-serif" font-size="29" letter-spacing="3" fill="${paper}">${album}</text><text x="598" y="605" font-family="sans-serif" font-size="15" text-anchor="end" fill="${paper}">SIDE ${String(index + 1).padStart(2, '0')}</text></svg>`;
    return { id:index, audioPath:file, songName, artist, album, coverPath:'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), lrcPath:lyricPath, rawPath:null, realDuration:seconds };
  });
  fs.writeFileSync(lyricPath, '[00:00.00]沿着海岸慢慢走\n[00:05.00]把喧嚣留在身后\n[00:12.00]晚风吹过你的肩头\n[00:20.00]这一刻让时间停留\n[00:35.00]沿着海岸慢慢走\n[00:50.00]下一站会有温柔', 'utf8');
  userData = {
    likes:songs.slice(0,4).map((song,index) => ({path:song.audioPath,ts:1700000000000+index*60000})),dislikes:[],
    collections:emptyFixture ? [] : [
      {id:'existing',name:'我喜欢的音乐',songs:songs.slice(0,4).map(song=>song.audioPath),createdAt:1700000000000},
      {id:'slow-days',name:'慢下来的日子',songs:[songs[0].audioPath,songs[3].audioPath,songs[4].audioPath],createdAt:1700000060000},
      {id:'after-hours',name:'深夜耳机',songs:[songs[1].audioPath,songs[5].audioPath,songs[6].audioPath],createdAt:1700000120000},
    ],
    stats:Object.fromEntries(songs.slice(0,6).map((song,index)=>[song.audioPath,{plays:18-index*2,duration:2400-index*250}])),
    progress:{},actualDuration:{},lastSession:null,
    settings:{playMode:1,volume:.5,serverEnabled:false,mobileEnabled:false,discCover:false},
  };
}
// The polish suite deliberately exercises the production palette IPC and PNG decoder.
// Existing smoke/visual fixtures keep their original small, deterministic RGB stub.
const polish = { lyricPayloads: [], expectedColors: [[206, 76, 87], [42, 146, 166]], lines: [], imageRules:{}, imageRequests:[] };
if (polishFixture) {
  const zlib = require('zlib');
  const crc32 = buffer => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const writeCover = (file, rgb) => {
    const width = 128, height = 128;
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    const pixels = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = rgb[0]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[2]; pixels[offset + 3] = 255;
    }
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  };
  polish.lines = [
    [0, '晚风'], [5, '沿着海岸慢慢走'], [10, '把喧嚣留在身后'], [16, '下一站会有温柔'],
    [22, '我们把今天的故事留给漫长的海岸线然后一起穿过那座仍然灯火通明的城市继续向着星光走去直到下一次日出再把没有说完的话慢慢说给彼此听'],
    [34, '听'], [40, '这一刻让时间停留'], [48, '日落之后还有星光'], [56, '沿着来时的路'], [64, '一起回家'], [76, '明天见'],
  ];
  const rawPath = path.join(fixture, '逐字与长短行.raw');
  fs.writeFileSync(rawPath, '[lyricist:Wuu 测试]\n[composer:Wuu 测试]\n' + polish.lines.map(([time, text], index) => {
    const duration = ((polish.lines[index + 1]?.[0] || 88) - time) * 1000;
    const step = Math.min(700, Math.floor(duration / [...text].length));
    return `[${time * 1000},${duration}]` + [...text].map((character, i) => `<${i * step},${step},0>${character}`).join('');
  }).join('\n'), 'utf8');
  songs = ['玫瑰色的黄昏', '蓝色海岸', '没有封面的歌'].map((songName, index) => {
    const file = path.join(fixture, `${songName}.wav`); fs.copyFileSync(audioPath, file);
    const coverPath = index < 2 ? path.join(fixture, `${songName}.png`) : null;
    if (coverPath) writeCover(coverPath, polish.expectedColors[index]);
    return { id:index, audioPath:file, songName, artist:'Wuu 细节验证', album:'封面与歌词', coverPath, lrcPath:lyricPath, rawPath, realDuration:seconds };
  });
  polish.makeCoverVariant = (index, tag, rule = {}) => {
    const file = path.join(fixture, `${songs[index].songName}-${tag}.png`);
    writeCover(file, polish.expectedColors[index]);
    songs[index].coverPath = file;
    polish.imageRules[file.toLowerCase()] = { ...rule };
    return file;
  };
  if (coverStartup) polish.makeCoverVariant(0, `startup-${coverStartup}`, { delayMs:coverStartup === 'hidden' ? 9200 : 1200 });
  userData = { likes:[], dislikes:[], collections:[], stats:{}, progress:{}, actualDuration:{}, lastSession:null,
    settings:{ playMode:1, volume:.5, fadePause:false, serverEnabled:false, mobileEnabled:false, discCover:true, themeFollowCover:false,
      progressColorEnabled:false, simulateLrcProgress:true, marqueeEnabled:true, marqueeSpeed:90, marqueePause:.3, lyricSize:20, lyricWait:.55, lyricDone:.9 } };
  ipcMain.on('lyric-data', (_event, payload) => {
    polish.lyricPayloads.push(payload);
    if (polish.lyricPayloads.length > 2000) polish.lyricPayloads.shift();
  });
}
let serverRunning = false, accepted = false;
const calls = [];
const discovery = { requests:[], previewRequests:[], saveRequests:[], failNext:false, previewFailure:false, previewDelayMs:0, delayMs:Number(process.env.WUU_DISCOVERY_DELAY) || 0 };
global.__wuuSmoke = { songs,calls,polish,discovery,get data() { return userData; } };
const handle = (channel, callback) => ipcMain.handle(channel, (event,...args) => { calls.push(channel); return callback(event,...args); });
handle('netease-discover', async (_event, {page=0}={}) => {
  discovery.requests.push(page);
  if (discovery.delayMs) await new Promise(resolve=>setTimeout(resolve,discovery.delayMs));
  if (discovery.failNext) { discovery.failNext=false; return {ok:false,message:'测试网络暂时不可用'}; }
  const external = Array.from({length:4},(_,index)=>({id:`remote-${page}-${index}`,source:'netease',name:`新曲 ${page}-${index}`,artist:'发现艺人',cover:songs[index%songs.length]?.coverPath || artwork,duration:90000}));
  // Matching local metadata deliberately appears in the provider response.
  const existing=songs[0] ? [{id:'existing-remote',source:'netease',name:songs[0].songName,artist:songs[0].artist,cover:songs[0].coverPath}] : [];
  return {ok:true,data:[...existing,...external],provider:'netease',catalogLabel:'网易云公开歌单'};
});
handle('netease-preview', async (_event,{songId:id,quality}) => {
  discovery.previewRequests.push({id,quality});
  if(discovery.previewDelayMs)await new Promise(resolve=>setTimeout(resolve,discovery.previewDelayMs));
  if(discovery.previewFailure)return {ok:false,message:'测试曲目暂时无法试听'};
  return {ok:true,data:{url:'music:///'+audioPath.replace(/\\/g,'/'),meta:{title:`新曲 ${String(id).replace('remote-','')}`,artist:'发现艺人',cover:artwork},lrcText:'[00:00.00]发现新的声音\n[00:05.00]喜欢再保存'}};
});
handle('netease-import-song', (_event,{songId:id,quality,songMeta:meta}) => {
  discovery.saveRequests.push({id,quality});
  if(!songs.some(song=>song.source==='netease'&&song.trackId===id)){
    const importedPath=path.join(fixture,`${id}.wav`);fs.copyFileSync(audioPath,importedPath);
    songs.push({id:songs.length,audioPath:importedPath,songName:meta?.name||id,artist:meta?.artist||'发现艺人',coverPath:meta?.cover||artwork,lrcPath:lyricPath,realDuration:seconds,source:'netease',trackId:id});
  }
  return {ok:true};
});
handle('get-songs', () => songs);
handle('get-userdata', () => userData);
handle('save-userdata', (_event,data) => { userData=data; });
ipcMain.on('save-userdata-sync',(event,data) => { userData=data; event.returnValue=true; });
handle('get-lyrics',(_event,file) => fs.readFileSync(file,'utf8'));
if (!polishFixture) {
  const visualColor = source => {
    if (visualFixture && typeof source === 'string' && source.startsWith('data:image/svg+xml')) {
      const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1));
      const color = /<circle[^>]+fill="(#\w{6})"/.exec(svg)?.[1];
      if (color) return { r:parseInt(color.slice(1,3),16), g:parseInt(color.slice(3,5),16), b:parseInt(color.slice(5,7),16) };
    }
    return {r:212,g:117,b:158};
  };
  handle('extract-cover-color',(_event, source) => visualColor(source));
  handle('extract-cover-color-url',(_event, source) => visualColor(source));
}
handle('desktop-state-update',() => ({ok:true}));
handle('report-play-failed',() => ({ok:true}));
handle('scan-damaged-songs',() => []);
handle('playlist-list-shared',() => ({ok:true,playlists:[]}));
handle('playlist-server-status',() => ({ok:true,running:serverRunning,port:30967}));
handle('server-start',() => { serverRunning=true; return {ok:true,port:30967}; });
handle('server-stop',() => { serverRunning=false; return {ok:true}; });
handle('server-get-access-logs',() => ({ok:true,logs:[],enabled:false}));
handle('server-clear-access-logs',() => ({ok:true}));
handle('free-music-disclaimer-check',() => ({accepted}));
handle('free-music-disclaimer-accept',() => { accepted=true; return {ok:true}; });
handle('free-music-status',() => ({ready:true}));
for (const platform of ['qishui','kugou','netease']) {
  handle(`${platform}-list-accounts`,() => ({ok:true,accounts:[],activeUserid:null}));
  handle(`${platform}-login-status`,() => ({ok:true,loggedIn:false}));
  handle(`${platform}-qr-key`,() => ({ok:true,key:'test-key'}));
  handle(`${platform}-qr-create`,() => ({ok:true,qrimg:artwork}));
  handle(`${platform}-qr-check`,() => ({ok:true,status:1,code:801}));
}
handle('qishui-peek-profile',() => ({ok:false}));
handle('qishui-get-qrcode',() => ({ok:true,token:'test-key',qrcode:artwork}));
handle('qishui-check-qrcode',() => ({ok:true,status:'waiting'}));
const storage = require.resolve(path.join(runtimeRoot, 'core', 'storage'));
require.cache[storage] = { id:storage,filename:storage,loaded:true,exports:{readUserData:()=>userData,writeUserData:data=>{userData=data;}},children:[],paths:[] };
protocol.registerSchemesAsPrivileged([{scheme:'music',privileges:{stream:true,supportFetchAPI:true,bypassCSP:true,corsEnabled:true}}]);
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (polishFixture) require(path.join(runtimeRoot, 'cover', 'color'));
  protocol.handle('music', async request => {
    const file = decodeURIComponent(request.url.replace(/^music:\/\/\/?/,'').split(/[?#]/)[0]);
    if (polishFixture && /\.png$/i.test(file)) {
      const rule = polish.imageRules[file.replace(/\//g, path.sep).toLowerCase()];
      const log = {file, startedAt:Date.now(), delayMs:rule?.delayMs || 0, status:'pending'};
      polish.imageRequests.push(log);
      if (rule?.delayMs) await new Promise(resolve => setTimeout(resolve, rule.delayMs));
      if (rule?.failuresRemaining > 0) {
        rule.failuresRemaining--; log.status = 'failed'; log.finishedAt = Date.now();
        return new Response('Fixture image temporarily unavailable', {status:503, headers:{'Cache-Control':'no-store'}});
      }
      log.status = 'served'; log.finishedAt = Date.now();
    }
    const content = fs.readFileSync(file);
    const range = request.headers.get('range')?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]),content.length-1) : content.length-1;
    return new Response(content.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':polishFixture && /\.png$/i.test(file) ? 'image/png' : 'audio/wav','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Content-Length':String(end-start+1),...(polishFixture && /\.png$/i.test(file) ? {'Cache-Control':'no-store'} : {}),...(range?{'Content-Range':`bytes ${start}-${end}/${content.length}`}:{})}});
  });
  const netease = require(path.join(runtimeRoot, 'tools', 'netease-api', 'main'));
  if (typeof netease.login_qr_key !== 'function') throw new Error('Packaged NetEase dependencies are incomplete');
  require(path.join(runtimeRoot, 'window', 'main-window')).createWindow();
  if (coverStartup) {
    const mainWindow = require(path.join(runtimeRoot, 'core', 'state')).getMainWindow();
    // Hide after the initial document exists so Electron emits real page visibility.
    // The delayed PNG is still pending throughout this native transition.
    mainWindow.webContents.once('did-finish-load', () => {
      if (coverStartup === 'hidden') mainWindow.hide(); else mainWindow.minimize();
    });
  }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
});
app.on('before-quit',() => { require(path.join(runtimeRoot, 'window', 'desktop-lyric')).destroyDesktopLyricWindow(); });
