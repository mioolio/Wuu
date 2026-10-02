export const LYRIC_SIZE_KEY = 'wuu-mobile-lyric-size';
export const DEFAULT_LYRIC_SIZE = 22;
export const MIN_LYRIC_SIZE = 16;
export const MAX_LYRIC_SIZE = 36;
export const CURRENT_LYRIC_SIZE_KEY = 'wuu-mobile-current-lyric-size';
export const DEFAULT_CURRENT_LYRIC_SIZE = 28;
export const MAX_CURRENT_LYRIC_SIZE = 60;

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

export function normalizeCurrentLyricSize(value, ordinarySize = DEFAULT_LYRIC_SIZE) {
  const minimum = normalizeLyricSize(ordinarySize);
  const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_CURRENT_LYRIC_SIZE;
  return Math.min(MAX_CURRENT_LYRIC_SIZE, Math.max(minimum, size));
}

export function readCurrentLyricSize(storage) {
  const ordinarySize = readLyricSize(storage);
  try {
    const target = storage || globalThis.localStorage;
    const value = target?.getItem(CURRENT_LYRIC_SIZE_KEY);
    if (value != null && value.trim()) return normalizeCurrentLyricSize(Number(value), ordinarySize);
    const legacy = target?.getItem(LYRIC_SIZE_KEY);
    // Existing browser preferences retain the former 1.16x current-line size.
    const migrated = legacy?.trim() && Number.isFinite(Number(legacy)) ? ordinarySize * 1.16 : DEFAULT_CURRENT_LYRIC_SIZE;
    return normalizeCurrentLyricSize(migrated, ordinarySize);
  } catch { return normalizeCurrentLyricSize(DEFAULT_CURRENT_LYRIC_SIZE, ordinarySize); }
}

export function saveCurrentLyricSize(value, ordinarySize = DEFAULT_LYRIC_SIZE, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return false;
    target.setItem(CURRENT_LYRIC_SIZE_KEY, String(normalizeCurrentLyricSize(value, ordinarySize)));
    return true;
  } catch { return false; }
}
