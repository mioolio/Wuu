import { readonly, ref } from 'vue';
import { normalizeLyricSize, readLyricSize, saveLyricSize, normalizeCurrentLyricSize, readCurrentLyricSize, saveCurrentLyricSize } from '../services/lyricPreferences.js';

const lyricSize = ref(readLyricSize());
const currentLyricSize = ref(readCurrentLyricSize());
const ordinarySize = readonly(lyricSize);
const activeSize = readonly(currentLyricSize);

function setCurrentLyricSize(value) {
  currentLyricSize.value = normalizeCurrentLyricSize(value, lyricSize.value);
  saveCurrentLyricSize(currentLyricSize.value, lyricSize.value);
}

export function useLyricPreferences() {
  return {
    lyricSize: ordinarySize,
    currentLyricSize: activeSize,
    setCurrentLyricSize,
    setLyricSize(value) {
      lyricSize.value = normalizeLyricSize(value);
      saveLyricSize(lyricSize.value);
      if (currentLyricSize.value < lyricSize.value) setCurrentLyricSize(lyricSize.value);
    },
  };
}
