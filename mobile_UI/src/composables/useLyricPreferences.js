import { readonly, ref } from 'vue';
import { normalizeLyricSize, readLyricSize, saveLyricSize } from '../services/lyricPreferences.js';

const lyricSize = ref(readLyricSize());
const currentSize = readonly(lyricSize);

export function useLyricPreferences() {
  return {
    lyricSize: currentSize,
    setLyricSize(value) {
      lyricSize.value = normalizeLyricSize(value);
      saveLyricSize(lyricSize.value);
    },
  };
}
