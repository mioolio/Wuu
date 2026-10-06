import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThemeController, readTheme, THEME_KEY } from './themePreferences.js';

function fixture(initial, dark = false) {
  const data = new Map(initial ? [[THEME_KEY, initial]] : []);
  const listeners = new Map(), meta = {}, statusBar = {};
  const media = { matches: dark, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const document = { documentElement: { dataset: {} }, querySelector: selector => ({ setAttribute: (key, value) => { (selector.includes('theme-color') ? meta : statusBar)[key] = value; } }) };
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  return { data, listeners, meta, statusBar, media, document, storage };
}
test('defaults to the live system theme; an override persists and ignores system changes', () => {
  const env = fixture(undefined, true);
  const controller = createThemeController(env);
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.equal(env.statusBar.content, 'black-translucent');
  env.media.matches = false; env.listeners.get('change')();
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  assert.equal(env.statusBar.content, 'default');
  controller.setPreference('dark');
  assert.equal(env.data.get(THEME_KEY), 'dark');
  env.listeners.get('change')();
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.equal(env.meta.content, '#121a17');
  controller.setPreference('system');
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  controller.destroy();
  assert.equal(env.listeners.size, 0);
});
test('saved preference applies immediately; invalid and unavailable storage fall back gracefully', () => {
  const env = fixture('light', true);
  createThemeController(env);
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readTheme(broken), 'system');
  const fresh = fixture('invalid', true);
  const controller = createThemeController({ ...fresh, storage: broken });
  assert.doesNotThrow(() => controller.setPreference('light'));
  assert.equal(fresh.document.documentElement.dataset.theme, 'light');
});
