import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LYRIC_SIZE, LYRIC_SIZE_KEY, normalizeLyricSize, readLyricSize, saveLyricSize, CURRENT_LYRIC_SIZE_KEY, DEFAULT_CURRENT_LYRIC_SIZE, normalizeCurrentLyricSize, readCurrentLyricSize, saveCurrentLyricSize } from './lyricPreferences.js';

test('lyric size persists per browser and tolerates missing or invalid preferences', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readLyricSize(storage), DEFAULT_LYRIC_SIZE);
  assert.equal(saveLyricSize(28, storage), true);
  assert.equal(readLyricSize(storage), 28);
  for (const invalid of ['', 'NaN', 'Infinity', 'broken']) {
    values.set(LYRIC_SIZE_KEY, invalid);
    assert.equal(readLyricSize(storage), DEFAULT_LYRIC_SIZE);
  }
  values.set(LYRIC_SIZE_KEY, '200'); assert.equal(readLyricSize(storage), 36);
  values.set(LYRIC_SIZE_KEY, '4'); assert.equal(readLyricSize(storage), 16);
  assert.equal(normalizeLyricSize(25.7), 26);
  assert.equal(normalizeLyricSize(NaN), DEFAULT_LYRIC_SIZE);
});

test('blocked browser storage does not prevent lyric display or font adjustment', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readLyricSize(storage), DEFAULT_LYRIC_SIZE);
  assert.equal(saveLyricSize(30, storage), false);
  assert.equal(readCurrentLyricSize(storage), DEFAULT_CURRENT_LYRIC_SIZE);
  assert.equal(saveCurrentLyricSize(42, 22, storage), false);
});

test('current lyric size migrates the old font and remains independently bounded above the ordinary size', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readCurrentLyricSize(storage), DEFAULT_CURRENT_LYRIC_SIZE);
  values.set(LYRIC_SIZE_KEY, '28');
  assert.equal(readCurrentLyricSize(storage), 32, 'older browsers preserve their former relative current-line font');
  assert.equal(values.get(LYRIC_SIZE_KEY), '28', 'migration preserves the existing ordinary preference');
  saveCurrentLyricSize(48, 28, storage);
  assert.equal(readCurrentLyricSize(storage), 48);
  assert.equal(readLyricSize(storage), 28);
  assert.equal(normalizeCurrentLyricSize(20, 28), 28);
  assert.equal(normalizeCurrentLyricSize(100, 28), 60);
  assert.equal(normalizeCurrentLyricSize(NaN, 36), 36);
  for (const invalid of ['NaN', 'Infinity', 'broken']) {
    values.set(CURRENT_LYRIC_SIZE_KEY, invalid);
    assert.equal(readCurrentLyricSize(storage), 28);
  }
});

test('settings and an existing lyric view share an immediate preference and reload from saved storage', async t => {
  const original = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; });
  const { useLyricPreferences } = await import('../composables/useLyricPreferences.js?settings-test');
  const settings = useLyricPreferences(), existingLyrics = useLyricPreferences();
  settings.setLyricSize(29);
  assert.equal(existingLyrics.lyricSize.value, 29);
  assert.equal(values.get(LYRIC_SIZE_KEY), '29');
  settings.setCurrentLyricSize(42);
  assert.equal(existingLyrics.currentLyricSize.value, 42);
  assert.equal(existingLyrics.lyricSize.value, 29, 'changing the current font leaves ordinary lyrics unchanged');
  assert.equal(values.get(CURRENT_LYRIC_SIZE_KEY), '42');
  const { useLyricPreferences: reload } = await import('../composables/useLyricPreferences.js?reload-test');
  assert.equal(reload().lyricSize.value, 29);
  assert.equal(reload().currentLyricSize.value, 42);
  settings.setCurrentLyricSize(20); assert.equal(existingLyrics.currentLyricSize.value, 29);
  settings.setLyricSize(36); assert.equal(existingLyrics.currentLyricSize.value, 36);
  settings.setLyricSize(22); assert.equal(existingLyrics.currentLyricSize.value, 36, 'lowering the ordinary font does not reset the chosen current size');
});
