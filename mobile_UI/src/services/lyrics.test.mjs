import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as vue from 'vue';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as lyrics from './lyrics.js';

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

const source = readFileSync(new URL('../components/LyricsView.vue', import.meta.url), 'utf8');
test('the actual Vue script and template compile with the new timing helpers', () => {
  const { descriptor, errors } = parse(source);
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'mobile-lyric-regression' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'LyricsView.vue', id: 'mobile-lyric-regression', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
});

function mountFixture({ time = 25, paused = true, readyState = 2 } = {}) {
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
  const children = Array.from({ length: 8 }, (_, index) => ({ getBoundingClientRect: () => ({ top: 50 + index * 100 - container.scrollTop, bottom: 90 + index * 100 - container.scrollTop }) }));
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  const context = vm.createContext({ ...vue, ...lyrics, console, document, window,
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
  return { run, player, audio, audioListeners, frames, scrolls, seeks, document,
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
