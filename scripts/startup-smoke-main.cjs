// Fixture gates are installed synchronously, before smoke-main's whenReady
// callback can create the first production renderer. No reload is involved.
const { ipcMain, BrowserWindow } = require('electron');
process.env.WUU_SMOKE_PACKAGED = '0';
process.env.WUU_VISUAL_FIXTURE = '';
process.env.WUU_PLAYER_POLISH_FIXTURE = '1';
process.env.WUU_COVER_STARTUP = '';
process.env.WUU_RENDERER_URL = '';
require('./smoke-main.cjs');

const originals = global.__wuuSmoke.songs.map(song => ({ ...song, genre: [] }));
const songs = global.__wuuSmoke.songs;
songs.forEach(song => { song.genre = []; });
const [first, second, third] = originals;
let data = {
  startupSentinel: { value: 'keep-existing-unknown-fields' },
  likes: [{ path: first.audioPath, ts: 123 }, { path: third.audioPath, ts: 124 }],
  dislikes: [],
  collections: [{ id: 'startup-existing', name: '开机前保留的歌单', songs: [first.audioPath, third.audioPath], createdAt: 123 }],
  stats: { [first.audioPath]: { plays: 4, duration: 320 }, [third.audioPath]: { plays: 1, duration: 20 } },
  progress: { [first.audioPath]: 12, [third.audioPath]: 3 }, actualDuration: {},
  lastSession: { audioPath: second.audioPath, t: 19 },
  genreOverrides: { [first.audioPath]: ['开机前手动标注'], [second.audioPath]: ['预存民谣'], [third.audioPath]: ['已删除标签'] },
  settings: { ...global.__wuuSmoke.data.settings, volume: .42, glassOpacity: .61, lyricSize: 17, currentLyricSize: 30,
    fadePause: false, discCover: false, themeFollowCover: false, serverEnabled: false, mobileEnabled: false },
};
const events = [], writeAttempts = [], writes = [], deleted = [], patches = originals.map((song, index) => ({ audioPath: song.audioPath, genre: [['电子'], ['爵士'], ['民谣']][index] }));
const record = (name, details = {}) => { events.push({ name, at: Date.now(), ...details }); };
let metadataReleased = false, userDataReleased = false, metadataStarted = false;
let releaseMetadata, releaseUserData;
const metadataGate = new Promise(resolve => { releaseMetadata = resolve; });
const userDataGate = new Promise(resolve => { releaseUserData = resolve; });
const copy = value => JSON.parse(JSON.stringify(value));
const replace = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
const write = (value, source) => {
  writeAttempts.push({ source, at: Date.now(), userDataReleased });
  if (!userDataReleased) throw new Error('The renderer attempted to overwrite unread user data');
  data = copy(value); writes.push({ source, at: Date.now(), data: copy(value) }); record('save', { source });
  return true;
};
replace('get-songs', () => {
  record('get-songs');
  if (!metadataStarted) {
    metadataStarted = true; record('metadata-started');
    void metadataGate.then(() => {
      for (const patch of patches) {
        const song = songs.find(item => item.audioPath === patch.audioPath);
        if (song) song.genre = [...patch.genre];
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('song-metadata-update', copy(patch));
        }
        record('metadata-patch', { audioPath: patch.audioPath });
      }
    });
  }
  record('songs-returned', { count: songs.length, metadataReleased });
  return copy(songs);
});
replace('get-userdata', async () => {
  record('get-userdata');
  const stored = copy(data);
  await userDataGate;
  record('userdata-returned');
  return stored;
});
replace('save-userdata', (_event, value) => write(value, 'async-ipc'));
ipcMain.removeAllListeners('save-userdata-sync');
ipcMain.on('save-userdata-sync', (event, value) => { event.returnValue = write(value, 'sync-ipc'); });
replace('delete-song-folder', (_event, audioPath) => {
  // Exercise the real removal UI while retaining every isolated fixture file.
  const index = songs.findIndex(song => song.audioPath === audioPath);
  if (index >= 0) songs.splice(index, 1);
  deleted.push(audioPath); record('song-deleted', { audioPath });
  return { ok: true };
});
global.__wuuStartup = {
  originals, events, writeAttempts, writes, deleted, patches,
  get data() { return data; },
  get state() { return { metadataStarted, metadataReleased, userDataReleased }; },
  releaseUserData() { if (!userDataReleased) { userDataReleased = true; record('userdata-released'); releaseUserData(); } },
  releaseMetadata() { if (!metadataReleased) { metadataReleased = true; record('metadata-released'); releaseMetadata(); } },
};
record('startup-gates-installed', { windows: BrowserWindow.getAllWindows().length });
