export const THEME_KEY = 'wuu-mobile-theme';
export const THEME_OPTIONS = ['system', 'light', 'dark'];

export function normalizeTheme(value) {
  return THEME_OPTIONS.includes(value) ? value : 'system';
}

export function readTheme(storage) {
  try { return normalizeTheme((storage || globalThis.localStorage)?.getItem(THEME_KEY)); }
  catch { return 'system'; }
}

// Apply before Vue mounts; system changes stay live while an override stays fixed.
export function createThemeController({ document, storage, media, events, onChange = () => {} }) {
  let preference = readTheme(storage);
  function apply() {
    const theme = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121a17' : '#f5f7f4');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
    onChange({ preference, theme });
    return theme;
  }
  function setPreference(value) {
    preference = normalizeTheme(value);
    try { storage?.setItem(THEME_KEY, preference); } catch { /* Private browsing can deny storage. */ }
    apply();
  }
  function storageChanged(event) {
    if (event.key === THEME_KEY || event.key === null) {
      preference = readTheme(storage);
      apply();
    }
  }
  media?.addEventListener?.('change', apply);
  events?.addEventListener?.('storage', storageChanged);
  apply();
  return { apply, setPreference, destroy() {
    media?.removeEventListener?.('change', apply);
    events?.removeEventListener?.('storage', storageChanged);
  } };
}
