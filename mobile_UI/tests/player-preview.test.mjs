import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as vue from 'vue';
import { lyricCredits } from '../src/services/lyrics.js';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

function fixture(song) {
  const source = readFileSync(new URL('../src/components/Player.vue', import.meta.url), 'utf8');
  let dislikes = 0;
  const player = { currentSong: vue.ref(song), lyricText: vue.ref(''), handleToggleDislike: () => { dislikes++; } };
  const context = vm.createContext({ ...vue, lyricCredits, usePlayer: () => player, defineEmits: () => () => {},
    onUnmounted: () => {}, coverUrl: () => '', coverByPath: () => '' });
  const scope = vue.effectScope();
  scope.run(() => vm.runInContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .+;\s*$/gm, ''), context));
  return { player, run: code => vm.runInContext(code, context), dislikes: () => dislikes, stop: () => scope.stop(), source };
}

test('an active preview cannot open a local collection or send a dislike, including an accidental numeric preview id', async () => {
  const view = fixture({ id: 0, audioPath: 'D:/library.wav' });
  try {
    assert.equal(view.run('librarySongIndex.value'), 0);
    view.run('openPicker()'); assert.equal(view.run('showPicker.value'), true);
    view.player.currentSong.value = { id: 'preview:http://host/song.wav', preview: true, audioPath: 'http://host/song.wav' };
    await vue.nextTick();
    assert.equal(view.run('librarySongIndex.value'), -1); assert.equal(view.run('showPicker.value'), false);
    view.run('openPicker(); onToggleDislike()');
    assert.equal(view.run('showPicker.value'), false); assert.equal(view.dislikes(), 0);
    view.player.currentSong.value = { id: 0, preview: true };
    view.run('openPicker(); onToggleDislike()');
    assert.equal(view.run('librarySongIndex.value'), -1); assert.equal(view.dislikes(), 0);
  } finally { view.stop(); }
});

test('only a nonnegative integer library id can enter local actions, and returning from preview restores them', () => {
  const view = fixture({ id: '1' });
  try {
    for (const id of ['1', -1, NaN, 1.5, undefined]) {
      view.player.currentSong.value = { id };
      view.run('openPicker(); onToggleDislike()');
      assert.equal(view.run('librarySongIndex.value'), -1); assert.equal(view.dislikes(), 0);
    }
    view.player.currentSong.value = { id: 2, preview: false };
    view.run('openPicker(); onToggleDislike()');
    assert.equal(view.run('librarySongIndex.value'), 2); assert.equal(view.run('showPicker.value'), true); assert.equal(view.dislikes(), 1);
    const { descriptor } = parse(view.source);
    const script = compileScript(descriptor, { id: 'preview-actions' });
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'Player.vue', id: 'preview-actions',
      compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  } finally { view.stop(); }
});
