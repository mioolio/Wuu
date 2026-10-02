import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as vue from 'vue';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as lyrics from './lyrics.js';
import * as preferences from './lyricPreferences.js';

test('standard repeats, offset and bilingual timestamp groups stay synchronized', () => {
  const lines = lyrics.parseLyrics('[offset:+1000]\n[00:10.25]原文\n[00:10.25]Translation\n[00:20.00][00:40.00]Repeat');
  assert.deepEqual(lines.map(line => line.time), [11.25, 11.25, 21, 41]);
  assert.equal(lyrics.activeLyricIndex(lines, 11.5), 0);
  assert.equal(lyrics.isCurrentLyric(lines, 1, 0), true);
  assert.equal(lyrics.lyricLineProgress(lines, 0, 16.125, 100), 0.5);
  assert.equal(lyrics.lyricLineProgress(lines, 1, 16.125, 100), 0.5);
  assert.equal(lyrics.activeLyricIndex(lines, 1), -1);
});

test('enhanced LRC produces one timed phrase and retains translated rows', () => {
  const lines = lyrics.parseLyrics('[00:10.00]你[00:10.50]好[00:11.00]呀\n[00:10.00]Hello\n[00:20.00]Next');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, '你好呀');
  assert.deepEqual(lines[0].chars.map(char => char.offset), [0, 0.5, 1]);
  assert.equal(lyrics.lyricCharProgress(lines[0].chars[1], 10, 10.75), 0.5);
  assert.equal(lines[1].text, 'Hello');
});

test('raw prefix and suffix tags preserve words, trailing text and line duration', () => {
  const prefix = lyrics.parseLyrics('[10000,2000]<0,500,0>你<500,600,0>好')[0];
  assert.equal(prefix.text, '你好'); assert.equal(prefix.duration, 2);
  assert.deepEqual(prefix.chars.map(char => char.offset), [0, 0.5]);
  const suffix = lyrics.parseLyrics('[10000,2000]你<0,500,0>好<500,600,0>呀')[0];
  assert.equal(suffix.text, '你好呀'); assert.equal(suffix.chars.at(-1).offset, 1.1);
  assert.equal(lyrics.lyricLineProgress([prefix], 0, 11, Infinity), 0.5);
  assert.equal(lyrics.lyricCharProgress({ offset: 0, dur: 0 }, 10, 10.05).toFixed(1), '0.5');
});

test('missing metadata uses restored progress and unsynchronized text remains visible', () => {
  assert.equal(lyrics.readLyricTime({ readyState: 0, currentTime: 0 }, 42), 42);
  assert.equal(lyrics.readLyricTime({ readyState: 2, currentTime: 12 }, 42), 12);
  assert.equal(lyrics.readLyricTime(null, NaN), 0);
  const plain = lyrics.parseLyrics('[ti:Title]\nPlain lyric\nAnother line');
  assert.deepEqual(plain, [{ time: null, text: 'Plain lyric' }, { time: null, text: 'Another line' }]);
  assert.equal(lyrics.activeLyricIndex(plain, 50), -1);
  assert.deepEqual(lyrics.parseLyrics('[ti:Title]'), []);
});

test('standalone and timed credits leave only real lyrics, with original named credits preferred', () => {
  const text = '[ti:唯一][ar:告五人]\n[作词：原作者][作曲:原作曲]\n作词: 备用作者\n[00:00]作曲：备用作曲\n[00:01]编曲: 编曲者\n[00:02]制作人：制作人甲\n[00:03]混音: 混音师甲\n[00:04]母带处理: 母带师甲\n[00:05]录音室: 录音室甲\n[00:10]唯一\n[00:20]作词的人：也是唱歌的人\n[00:30]这句歌词提到作曲：也只是普通歌词\n[00:40]正文中 [作词:不是真正署名] 仍需保留';
  assert.deepEqual(lyrics.parseLyrics(text).map(line => line.text), ['唯一', '作词的人：也是唱歌的人', '这句歌词提到作曲：也只是普通歌词', '正文中 [作词:不是真正署名] 仍需保留']);
  assert.deepEqual(lyrics.lyricCredits(text), { lyricist: '原作者', composer: '原作曲' });
  assert.deepEqual(lyrics.lyricCredits('这句歌词提到 [作词:一个人]'), { lyricist: '', composer: '' });
  assert.deepEqual(lyrics.parseLyrics('OP：版权方\nSP: 代理方\nLyrics: Author\nComposer：Composer\nArranger: Arranger\n唯一'), [{ time: null, text: '唯一' }]);
  assert.deepEqual(lyrics.parseLyrics('作词：\n录音: 录音师'), []);
});

test('word-timed credits are reconstructed before filtering and combined authors fill only the footer fields', () => {
  const raw = '[1000,2000]<0,500,0>作词：<500,500,0>词作者\n[3000,2000]<0,500,0>Mixing:<500,500,0>混音师\n[10000,2000]<0,500,0>唯一';
  assert.deepEqual(lyrics.parseLyrics(raw).map(line => line.text), ['唯一']);
  assert.deepEqual(lyrics.lyricCredits(raw), { lyricist: '词作者', composer: '' });
  const enhanced = '[00:00.00]作曲：[00:00.50]曲作者\n[00:01.00]母带：[00:01.50]母带师\n[00:10.00]你[00:10.50]是唯一\n[00:10.00]You are the only one';
  assert.deepEqual(lyrics.parseLyrics(enhanced).map(line => line.text), ['你是唯一', 'You are the only one']);
  assert.deepEqual(lyrics.lyricCredits(enhanced), { lyricist: '', composer: '曲作者' });
  assert.deepEqual(lyrics.lyricCredits('[00:00]词 / 曲：共同作者'), { lyricist: '共同作者', composer: '共同作者' });
  assert.deepEqual(lyrics.parseLyrics('[00:00]词 / 曲：共同作者\n[00:10]唯一'), [{ time: 10, text: '唯一' }]);
});

const source = readFileSync(new URL('../components/LyricsView.vue', import.meta.url), 'utf8');
test('the actual Vue script and template compile with the new timing helpers', () => {
  const { descriptor, errors } = parse(source);
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'mobile-lyric-regression' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'LyricsView.vue', id: 'mobile-lyric-regression', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
});

function mountFixture({ time = 25, paused = true, readyState = 2, storedSize, rowHeights = [] } = {}) {
  const frames = new Map(), mounted = [], unmounted = [], scrolls = [], seeks = [];
  let frameId = 0, wall = 0, observe;
  const audio = new EventTarget();
  Object.assign(audio, { currentTime: readyState ? time : 0, readyState, paused, ended: false });
  const audioListeners = new Set();
  const add = audio.addEventListener.bind(audio), remove = audio.removeEventListener.bind(audio);
  audio.addEventListener = (name, callback) => { audioListeners.add(name); add(name, callback); };
  audio.removeEventListener = (name, callback) => { audioListeners.delete(name); remove(name, callback); };
  const player = {
    lyricText: vue.ref('[00:00]A\n[00:10]B\n[00:20]C\n[00:30]D'), currentTime: vue.ref(time), duration: vue.ref(120), isPlaying: vue.ref(!paused),
    getAudioEl: () => audio,
    seek(percent) { seeks.push({ kind: 'percent', value: percent }); audio.currentTime = percent / 100 * player.duration.value; player.currentTime.value = audio.currentTime; },
    seekTo(seconds) { seeks.push({ kind: 'seconds', value: seconds }); player.currentTime.value = seconds; if (audio.readyState >= 1) audio.currentTime = seconds; },
  };
  const container = { scrollTop: 0, clientHeight: 200, getBoundingClientRect: () => ({ top: 0 }), scrollTo(options) { scrolls.push(options); this.scrollTop = options.top; } };
  const heights = Array.from({ length: 8 }, (_, index) => rowHeights[index] || 40);
  const children = heights.map((height, index) => ({ getBoundingClientRect: () => {
    const top = 50 + heights.slice(0, index).reduce((sum, height) => sum + height + 60, 0) - container.scrollTop;
    return { top, bottom: top + height };
  } }));
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  const values = new Map(storedSize === undefined ? [] : [[preferences.LYRIC_SIZE_KEY, storedSize]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const size = vue.ref(preferences.readLyricSize(storage));
  const settingPreferences = { lyricSize: vue.readonly(size), setLyricSize(value) { size.value = preferences.normalizeLyricSize(value); preferences.saveLyricSize(size.value, storage); } };
  const context = vm.createContext({ ...vue, ...lyrics, ...preferences, console, document, window,
    useLyricPreferences: () => settingPreferences,
    usePlayer: () => player, defineEmits: () => () => {},
    onMounted: callback => mounted.push(callback), onUnmounted: callback => unmounted.push(callback),
    performance: { now: () => wall }, requestAnimationFrame: callback => { const id = frameId++; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class { constructor(callback) { observe = callback; } observe() {} disconnect() { observe = null; } },
    fixtureContainer: container, fixtureList: { children },
  });
  const run = code => vm.runInContext(code, context);
  const scope = vue.effectScope();
  scope.run(() => run(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .+;\s*$/gm, '')));
  run('viewRef.value = fixtureContainer; listRef.value = fixtureList');
  mounted.forEach(callback => callback());
  return { run, player, audio, audioListeners, frames, scrolls, seeks, document, storage, preferences: settingPreferences,
    step() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); },
    observe: visible => observe([{ isIntersecting: visible }]),
    setWall: value => { wall = value; },
    unmount() { unmounted.forEach(callback => callback()); scope.stop(); },
  };
}
const flush = async () => { await vue.nextTick(); await vue.nextTick(); };

test('opening lyrics while paused immediately highlights and centers restored position', async () => {
  const fixture = mountFixture({ readyState: 0 });
  await flush();
  assert.equal(fixture.run('curIdx.value'), 2);
  assert.equal(fixture.run('frameTime.value'), 25);
  assert.equal(fixture.scrolls.at(-1).top, 170);
  assert.equal(fixture.scrolls.at(-1).behavior, 'auto');
  assert.equal(fixture.frames.size, 0, 'paused opening must not create a 60fps loop');
  fixture.player.lyricText.value = '[00:00]X\n[00:25]Y\n[00:50]Z'; await flush();
  assert.equal(fixture.run('curIdx.value'), 1, 'new lyrics at an unchanged time synchronize immediately');
  fixture.audio.readyState = 2; fixture.audio.currentTime = 51;
  fixture.audio.dispatchEvent(new Event('seeked')); await flush();
  assert.equal(fixture.run('curIdx.value'), 2, 'native paused seek does not wait for a timeupdate');
  fixture.unmount(); assert.equal(fixture.audioListeners.size, 0);
});

test('the lyric footer contains only real author credits and clears on a song without credits', async () => {
  const fixture = mountFixture();
  fixture.player.lyricText.value = '[00:00]作词: 作者甲\n[00:01]作曲：作者乙\n[00:02]制作人: 制作人甲\n[00:20]唯一';
  await flush();
  assert.equal(fixture.run('lines.value.length'), 1);
  assert.equal(fixture.run('lines.value[0].text'), '唯一');
  assert.deepEqual(JSON.parse(fixture.run('JSON.stringify(credits.value)')), { lyricist: '作者甲', composer: '作者乙' });
  fixture.player.lyricText.value = '[00:20]没有制作元信息的歌词'; await flush();
  assert.deepEqual(JSON.parse(fixture.run('JSON.stringify(credits.value)')), { lyricist: '', composer: '' });
  fixture.unmount();
});

test('audio-clock frames cross lines before timeupdate and stop on pause, hidden view and unmount', async () => {
  const fixture = mountFixture({ paused: false }); await flush();
  assert.equal(fixture.frames.size, 1);
  fixture.audio.currentTime = 31; fixture.step(); await flush();
  assert.equal(fixture.run('curIdx.value'), 3);
  assert.equal(fixture.player.currentTime.value, 25, 'the reactive 4Hz clock did not advance');
  fixture.audio.paused = true; fixture.audio.currentTime = 32; fixture.audio.dispatchEvent(new Event('pause'));
  assert.equal(fixture.frames.size, 0); assert.equal(fixture.run('frameTime.value'), 32);
  fixture.audio.paused = false; fixture.audio.dispatchEvent(new Event('playing'));
  fixture.observe(false); assert.equal(fixture.frames.size, 0, 'a tab hidden by an ancestor v-show stops animation');
  fixture.audio.currentTime = 12; fixture.observe(true); await flush();
  assert.equal(fixture.run('curIdx.value'), 1); assert.equal(fixture.frames.size, 1);
  fixture.document.hidden = true; fixture.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(fixture.frames.size, 0);
  fixture.document.hidden = false; fixture.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(fixture.frames.size, 1);
  fixture.unmount(); assert.equal(fixture.frames.size, 0); assert.equal(fixture.audioListeners.size, 0);
});

test('manual scrolling holds follow, resumes after six seconds and lyrics click keeps seek broadcast path', async () => {
  const fixture = mountFixture({ time: 15, paused: false }); await flush();
  const before = fixture.scrolls.length;
  fixture.run('onTouchStart({touches:[{clientX:100,clientY:100}]}); onTouchMove({touches:[{clientX:100,clientY:150}]})');
  fixture.audio.currentTime = 25; fixture.step(); await flush();
  assert.equal(fixture.scrolls.length, before, 'auto follow cannot pull the list away from a held finger');
  fixture.run('onTouchEnd({changedTouches:[{clientX:100,clientY:150}]})');
  fixture.setWall(6001); fixture.audio.currentTime = 35; fixture.step(); await flush();
  assert.ok(fixture.scrolls.length > before);
  fixture.run('touchMoved = false; onLineClick(lines.value[1])');
  assert.equal(fixture.seeks.at(-1).kind, 'percent', 'normal click uses the user seek API that broadcasts to the room');
  assert.ok(Math.abs(fixture.audio.currentTime - 10) < 0.0001);
  assert.equal(fixture.run('curIdx.value'), 1, 'percentage rounding cannot leave the previous line highlighted');
  fixture.player.duration.value = 0; fixture.audio.readyState = 0;
  fixture.run('onLineClick(lines.value[2])');
  assert.deepEqual(fixture.seeks.at(-1), { kind: 'seconds', value: 20 });
  fixture.unmount();
});

test('settings font updates persist immediately, reach the active lyric view and respect manual browsing', async () => {
  const fixture = mountFixture({ storedSize: '28' }); await flush();
  assert.equal(fixture.run('lyricSize.value'), 28);
  fixture.preferences.setLyricSize(30); await flush();
  assert.equal(fixture.run('lyricSize.value'), 30);
  assert.equal(fixture.storage.getItem(preferences.LYRIC_SIZE_KEY), '30');
  assert.equal(fixture.run('curIdx.value'), 2);
  assert.equal(fixture.audio.currentTime, 25);
  assert.equal(fixture.frames.size, 0, 'changing fonts while paused must not start animation');
  fixture.run('onWheel()');
  const count = fixture.scrolls.length;
  fixture.preferences.setLyricSize(28); await flush();
  assert.equal(fixture.scrolls.length, count, 'font changes must not interrupt manual lyric browsing');
  const saved = fixture.storage.getItem(preferences.LYRIC_SIZE_KEY);
  fixture.unmount();
  const reopened = mountFixture({ storedSize: saved }); await flush();
  assert.equal(reopened.run('lyricSize.value'), 28);
  reopened.preferences.setLyricSize(100); await flush(); assert.equal(reopened.run('lyricSize.value'), 36);
  reopened.preferences.setLyricSize(-100); await flush(); assert.equal(reopened.run('lyricSize.value'), 16);
  reopened.unmount();
});

test('very tall lyrics start at their opening words and remain browsable during settings changes', async () => {
  const fixture = mountFixture({ paused: false, rowHeights: [40, 40, 420] }); await flush();
  assert.equal(fixture.scrolls.at(-1).top, 234, 'the opening of a phrase taller than the viewport remains visible');
  fixture.run('onScrollKey({key:"PageDown"})');
  const before = fixture.scrolls.length;
  fixture.audio.currentTime = 35; fixture.step(); await flush();
  fixture.preferences.setLyricSize(36); await flush();
  fixture.observe(false); fixture.observe(true); await flush();
  assert.equal(fixture.scrolls.length, before, 'manual reading survives the next line, a settings change and returning from another view');
  fixture.unmount();
});

test('bilingual current groups and word colors restore after seeking backward', async () => {
  const fixture = mountFixture({ time: 15 });
  fixture.player.lyricText.value = '[00:00]Intro\n[00:10]原文\n[00:10]Translation\n[00:20]Next';
  await flush();
  assert.equal(fixture.run('lineClass(0)'), 'sung');
  assert.equal(fixture.run('lineClass(1)'), 'cur'); assert.equal(fixture.run('lineClass(2)'), 'cur');
  assert.equal(fixture.run('lineClass(3)'), 'unsung');
  assert.equal(fixture.run('charStyle({offset:0,dur:2}, lines.value[1]).color'), 'var(--lyric-sung)');
  assert.equal(fixture.run('charStyle({offset:8,dur:2}, lines.value[1]).color'), 'var(--lyric-wait)');
  const fill = fixture.run('charStyle({offset:4,dur:2}, lines.value[1]).backgroundImage');
  assert.ok(fill.includes('var(--lyric-sung)') && fill.includes('var(--lyric-wait)'));
  assert.deepEqual([...fill.matchAll(/ ([\d.]+)%/g)].map(match => Number(match[1])), [50, 50]);
  fixture.audio.currentTime = 25; fixture.audio.dispatchEvent(new Event('seeked')); await flush();
  assert.equal(fixture.run('lineClass(1)'), 'sung'); assert.equal(fixture.run('lineClass(2)'), 'sung');
  fixture.run('onLineClick(lines.value[1])'); await flush();
  assert.equal(fixture.run('lineClass(1)'), 'cur'); assert.equal(fixture.run('lineClass(2)'), 'cur');
  assert.equal(fixture.run('lineClass(3)'), 'unsung');
  assert.equal(fixture.run('charStyle({offset:0,dur:2}, lines.value[1]).color'), 'var(--lyric-wait)');
  assert.equal(fixture.frames.size, 0);
  fixture.unmount();
});
