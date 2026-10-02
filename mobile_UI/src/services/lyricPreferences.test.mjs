import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LYRIC_SIZE, LYRIC_SIZE_KEY, normalizeLyricSize, readLyricSize, saveLyricSize } from './lyricPreferences.js';

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
  const { useLyricPreferences: reload } = await import('../composables/useLyricPreferences.js?reload-test');
  assert.equal(reload().lyricSize.value, 29);
});
