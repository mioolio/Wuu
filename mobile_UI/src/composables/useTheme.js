import { readonly, ref } from 'vue';
import { createThemeController } from '../services/themePreferences.js';

const preference = ref('system');
const theme = ref('light');
let controller;
export function initializeTheme() {
  if (controller) return;
  let storage;
  try { storage = window.localStorage; } catch { /* Theme still works without persistence. */ }
  controller = createThemeController({ document, storage,
    media: window.matchMedia('(prefers-color-scheme: dark)'), events: window,
    onChange: value => { preference.value = value.preference; theme.value = value.theme; },
  });
}
export function useTheme() {
  initializeTheme();
  return { preference: readonly(preference), theme: readonly(theme), setTheme: value => controller.setPreference(value) };
}
