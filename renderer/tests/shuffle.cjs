// Execute the shipped classic queue and local play() functions. Only media/DOM
// boundaries are isolated; no Electron, application library, or network opens.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'modules', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(random = () => 0) {
  const node = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, textContent: '' });
  const media = { src: '', currentTime: 0, readyState: 2, paused: true, reject: false, listeners: new Map(),
    play() { if (this.reject) return Promise.reject(new Error('unavailable native source')); this.paused = false; this.listeners.get('playing')?.(); return Promise.resolve(); },
    pause() { this.paused = true; }, addEventListener(type, callback) { this.listeners.set(type, callback); },
  };
  const context = vm.createContext({ console, Math: Object.assign(Object.create(Math), { random }),
    audio: media, _classicPlayRequest: 0, _togetherRequest: 0, _togetherAcknowledged: 0, _togetherGeneration: 0, _togetherSeek: null,
    lastAudioTime: 0, lastProgressSave: 0, dragging: false,
    empty: node(), player: node(), lyrics: node(), titleEl: node(), artistEl: node(), creditsEl: null, coverEl: node(), pFill: node(), tNow: node(),
    initWebAudio() {}, cancelFade() {}, flushDuration() {}, saveCurrentProgress() {}, setVideoMode() {},
    getDuration: () => 90, toUrl: value => `music:///${value}`, fmt: String,
    updLikeBtn() {}, updNowPlaying() {}, setCoverImage() {}, applyCoverBackground() {}, renderLrc() {}, syncDesktopState() {}, syncLrc() {},
    window: { musicAPI: { getLyrics: async () => '' } },
  });
  const run = source => vm.runInContext(source, context);
  run(read('state.js')); run(read('list.js'));
  context.updCur = () => {}; context.scrollCur = () => {};
  const source = read('player-core.js');
  run(source.slice(source.indexOf('async function play('), source.indexOf('// Only this active renderer subscribes')));
  run(source.slice(source.indexOf("audio.addEventListener('playing'"), source.indexOf("audio.addEventListener('pause'")));
  run(`songs = ['A','B','C','D'].map(audioPath => ({audioPath,songName:audioPath,artist:'fixture'})); playMode = 2;`);
  const select = async (index, manual = true) => { await context.play(index, false, manual, false); return run('songs[curIdx]?.audioPath'); };
  const next = async direction => { const index = context.pickNextIdx(direction || 1); return index < 0 ? null : select(index, false); };
  return { context, run, media, select, next };
}

test('manual first selection does not discard unplayed prefix; each complete random round covers all eligible paths', async () => {
  const f = fixture(); const heard = [await f.select(3)];
  for (let i = 0; i < 3; i++) heard.push(await f.next());
  assert.equal(new Set(heard).size, 4, `No song repeats before all four paths are heard: ${heard}`);
  assert.deepEqual([...heard].sort(), ['A','B','C','D']);
  const following = await f.next(); assert.notEqual(following, heard.at(-1), 'The next round avoids an immediate same-song boundary');
});

test('revisiting the same scope or reselecting the current song preserves the unplayed round', async () => {
  const f = fixture(); const heard = [await f.select(0), await f.next()];
  f.context.buildShuffleQueue('home');
  await f.select(f.run('curIdx'));
  heard.push(await f.next(), await f.next());
  assert.equal(new Set(heard).size, 4, `Routine UI/library synchronization cannot restart the round: ${heard}`);
});

test('browsing a different collection does not change the actual playing collection or its round', async () => {
  const f = fixture();
  f.run(`collections = [{id:'one',songs:new Set(['A','B'])},{id:'two',songs:new Set(['C','D'])}];
    likedSet = new Map(songs.map(song => [song.audioPath, 1])); currentView='liked'; activeCollectionId='one';`);
  await f.select(0);
  f.run(`activeCollectionId='two'; buildShuffleQueue('liked'); currentView='home';`);
  assert.equal(await f.next(), 'B', 'Next continues in the selected playing collection after UI browsing');
  assert.equal(await f.next(), 'A');
  f.run(`currentView='liked'; activeCollectionId='two';`); await f.select(2);
  assert.equal(await f.next(), 'D', 'An explicit selection starts the newly selected collection scope');
});

test('random playback skips disliked paths while explicit selection and ordered/single modes retain their existing behavior', async () => {
  const f = fixture(); f.run(`dislikedSet.set('B',1);`);
  const heard = [await f.select(0), await f.next(), await f.next()];
  assert.deepEqual([...heard].sort(), ['A','C','D']);
  assert.equal(await f.select(1), 'B', 'A deliberate click can still select the disliked song');
  f.run('playMode=1; curIdx=0;'); assert.equal(f.context.pickNextIdx(1), 1, 'Ordered navigation keeps its original sequence');
  assert.equal(f.context.pickNextIdx(-1), 3, 'Ordered previous still wraps');
});

test('previous and forward replay the actual cross-round trail without consuming the new unplayed round', async () => {
  const f = fixture(); const first = [await f.select(0), await f.next(), await f.next(), await f.next()];
  assert.equal(new Set(first).size, 4);
  const start = await f.next();
  assert.equal(await f.next(-1), first.at(-1), 'Previous returns the genuinely heard last song across a shuffle boundary');
  assert.equal(await f.next(), start, 'Next first walks forward to the genuinely heard song');
  const second = [start, await f.next(), await f.next(), await f.next()];
  assert.equal(new Set(second).size, 4, `History playback does not steal any unplayed member of the new round: ${second}`);
});

test('history skips deleted/disliked paths, and failed playback never becomes a heard previous entry', async () => {
  const f = fixture(); await f.select(0); await f.next(); await f.next();
  const current = f.run('songs[curIdx].audioPath');
  f.run(`dislikedSet.set('B',1);`);
  assert.equal(await f.next(-1), 'A', 'Previous skips the disliked heard song');
  assert.equal(await f.next(), current, 'Forward still returns to the actual former current song');
  f.media.reject = true;
  await f.select(3); f.media.reject = false;
  assert.equal(await f.next(-1), 'A', 'A rejected source does not replace or append successful playback history');
  f.run(`songs = songs.filter(song => song.audioPath !== 'B'); curIdx = songs.findIndex(song => song.audioPath === 'A');`);
  assert.notEqual(await f.next(), 'B', 'A deleted heard path is not resurrected by navigation');
});

test('temporarily removing then re-adding a heard path does not replay it before remaining cold songs', async () => {
  const f = fixture(); await f.select(0); const previous = await f.next();
  f.run(`dislikedSet.set(${JSON.stringify(previous)},1); buildShuffleQueue('home'); dislikedSet.delete(${JSON.stringify(previous)});`);
  const remaining = [await f.next(), await f.next()];
  assert.equal(new Set(['A', previous, ...remaining]).size, 4, 'Restored eligibility cannot reset the round consumption');
});

test('actual mode button and same-current playback preserve the remaining round', async () => {
  const f = fixture(); let click;
  f.context.btnMode = { addEventListener: (_event, callback) => { click = callback; } };
  f.context.MODE_ICONS = ['single','ordered','random']; f.context.MODE_NAMES = ['single','ordered','random']; f.context.saveUserData = () => {};
  const events = read('events.js'); f.run(events.slice(events.indexOf('// 播放模式'), events.indexOf('// 音量')));
  const heard = [await f.select(3)]; f.context.buildShuffleQueue('home');
  click(); click(); click(); assert.equal(f.run('playMode'), 2);
  await f.select(f.run('curIdx'));
  heard.push(await f.next(), await f.next(), await f.next());
  assert.equal(new Set(heard).size, 4, `Mode settings do not drop unplayed prefix or restart the round: ${heard}`);
});

test('paused initial selection is recorded by the actual playing event on later direct resume', async () => {
  const f = fixture(); await f.context.play(0, false, true, false, { autoplay: false });
  assert.equal(f.media.paused, true); assert.equal(f.context.pickNextIdx(-1), -1);
  await f.media.play(); const next = await f.next();
  assert.notEqual(next, 'A'); assert.equal(await f.next(-1), 'A', 'Resume that bypasses play(index) still records the true first heard song');
});

test('real library refresh preserves current identity and unplayed paths across reorder, addition and deletion', async () => {
  const f = fixture(); await f.select(0); await f.next();
  const current = f.run('songs[curIdx].audioPath');
  const source = read('free-music/save.js'); f.run(source.slice(source.indexOf('async function refreshMainLibrary()'), source.indexOf('// 退出试听模式')));
  f.context.window.musicAPI.getSongs = async () => ['D','C','B','A','E'].map(audioPath => ({ audioPath, songName: audioPath, artist: 'fixture' }));
  f.context.renderList = () => {}; f.context.renderFloatList = () => {};
  await f.context.refreshMainLibrary(); assert.equal(f.run('songs[curIdx].audioPath'), current);
  f.run(`songs = songs.filter(song => song.audioPath !== 'D'); curIdx = songs.findIndex(song => song.audioPath === ${JSON.stringify(current)});`);
  assert.deepEqual([await f.next(), await f.next()].sort(), ['C','E'], 'Only genuinely unplayed, still available paths remain after a library change');
});

test('actual floating queue keeps playing scope while browsing another collection and clicking its current row', async () => {
  const f = fixture();
  f.run(`collections = [{id:'one',songs:new Set(['A','B'])},{id:'two',songs:new Set(['C','D'])}];
    likedSet = new Map(songs.map(song => [song.audioPath,1])); currentView='liked'; activeCollectionId='one';`);
  await f.select(0); f.run(`activeCollectionId='two';`);
  const element = () => ({ style: {}, dataset: {}, children: [], handlers: {}, appendChild(child) { this.children.push(child); },
    addEventListener(event, callback) { this.handlers[event] = callback; } });
  f.context.document = { createElement: element, createDocumentFragment: element };
  f.context.flSearch = { value: '' }; f.context.flList = element();
  f.context.renderFloatList();
  const items = f.context.flList.children[0].children;
  assert.deepEqual(items.map(item => item.dataset.idx), [0,1], 'The floating playback queue shows the actual playing collection');
  let pending; const actualPlay = f.context.play;
  f.context.play = (...args) => { pending = actualPlay(...args); return pending; };
  items[0].handlers.click(); await pending;
  assert.equal(f.run('playCollectionId'), 'one'); assert.equal(await f.next(), 'B');
});

test('empty and single eligible libraries terminate cleanly and do not expand a deleted selected collection', async () => {
  const f = fixture(); f.run(`dislikedSet = new Map(songs.map(song => [song.audioPath,1]));`);
  assert.equal(await f.next(), null); assert.equal(await f.next(-1), null);
  f.run(`dislikedSet.delete('C');`); assert.equal(await f.next(), 'C'); assert.equal(await f.next(), 'C');
  f.run(`collections=[]; playContext='liked'; playCollectionId='deleted'; likedSet=new Map([['C',1]]);`);
  assert.equal(await f.next(), null, 'Missing selected collection does not fall back to an unrelated union');
});
