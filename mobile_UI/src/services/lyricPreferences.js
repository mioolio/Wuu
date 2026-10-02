export const LYRIC_SIZE_KEY = 'wuu-mobile-lyric-size';
export const DEFAULT_LYRIC_SIZE = 22;
export const MIN_LYRIC_SIZE = 16;
export const MAX_LYRIC_SIZE = 36;

export function normalizeLyricSize(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_LYRIC_SIZE, Math.max(MIN_LYRIC_SIZE, Math.round(value)))
    : DEFAULT_LYRIC_SIZE;
}

export function readLyricSize(storage) {
  try {
    const value = (storage || globalThis.localStorage)?.getItem(LYRIC_SIZE_KEY);
    return value == null || !value.trim() ? DEFAULT_LYRIC_SIZE : normalizeLyricSize(Number(value));
  } catch { return DEFAULT_LYRIC_SIZE; }
}

export function saveLyricSize(value, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return false;
    target.setItem(LYRIC_SIZE_KEY, String(normalizeLyricSize(value)));
    return true;
  } catch { return false; }
}
