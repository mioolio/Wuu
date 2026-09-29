// A real Electron renderer with fixture IPC. User music/configuration is never written.
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const runtimeRoot = process.env.WUU_SMOKE_PACKAGED === '1' ? path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar') : root;
const artifacts = path.join(root, '.test-artifacts');
const visualFixture = ['1', 'empty'].includes(process.env.WUU_VISUAL_FIXTURE);
const emptyFixture = process.env.WUU_VISUAL_FIXTURE === 'empty';
const profile = path.join(artifacts, visualFixture ? `electron-visual-profile${emptyFixture ? '-empty' : ''}` : process.env.WUU_SMOKE_PACKAGED === '1' ? 'electron-packed-profile' : 'electron-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const fixture = path.join(artifacts, visualFixture ? '视觉验证音乐' : '音乐 文件');
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
let serverRunning = false, accepted = false;
const calls = [];
global.__wuuSmoke = { songs,calls,get data() { return userData; } };
const handle = (channel, callback) => ipcMain.handle(channel, (event,...args) => { calls.push(channel); return callback(event,...args); });
handle('get-songs', () => songs);
handle('get-userdata', () => userData);
handle('save-userdata', (_event,data) => { userData=data; });
ipcMain.on('save-userdata-sync',(event,data) => { userData=data; event.returnValue=true; });
handle('get-lyrics',(_event,file) => fs.readFileSync(file,'utf8'));
handle('extract-cover-color',() => ({r:212,g:117,b:158}));
handle('extract-cover-color-url',() => ({r:212,g:117,b:158}));
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
  protocol.handle('music', request => {
    const file = decodeURIComponent(request.url.replace(/^music:\/\/\/?/,''));
    const content = fs.readFileSync(file);
    const range = request.headers.get('range')?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]),content.length-1) : content.length-1;
    return new Response(content.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${content.length}`}:{})}});
  });
  const netease = require(path.join(runtimeRoot, 'tools', 'netease-api', 'main'));
  if (typeof netease.login_qr_key !== 'function') throw new Error('Packaged NetEase dependencies are incomplete');
  require(path.join(runtimeRoot, 'window', 'main-window')).createWindow();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
});
app.on('before-quit',() => { require(path.join(runtimeRoot, 'window', 'desktop-lyric')).destroyDesktopLyricWindow(); });
