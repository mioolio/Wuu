// Native behind-window blur. CSS backdrop-filter cannot blur the desktop.
const os = require('node:os');
const windows = new WeakMap();

function getFrostedGlassSupport(win, platform = process.platform, release = os.release()) {
  if (platform === 'win32') {
    const [major, , build] = release.split('.').map(Number);
    if ((major > 10 || (major === 10 && build >= 22621)) && typeof win?.setBackgroundMaterial === 'function') {
      return { supported: true };
    }
    return { supported: false, reason: '磨砂玻璃需要 Windows 11 22H2 或更新版本。' };
  }
  if (platform === 'darwin' && typeof win?.setVibrancy === 'function') return { supported: true };
  return { supported: false, reason: '当前系统不支持原生磨砂玻璃。' };
}

function applyFrostedGlass(win, requested, platform = process.platform, release = os.release()) {
  const support = getFrostedGlassSupport(win, platform, release);
  const record = windows.get(win) || { mode: 'modern', enabled: false, applied: false };
  const enabled = requested === true && record.mode === 'modern';
  if (!support.supported) return { ...support, ok: !enabled, enabled: false };
  if (record.applied && record.enabled === enabled) return { ...support, ok: true, enabled };
  try {
    if (platform === 'win32') win.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
    else win.setVibrancy(enabled ? 'under-window' : null);
    windows.set(win, { ...record, enabled, applied: true });
    return { ...support, ok: true, enabled };
  } catch (error) {
    return { ...support, ok: false, enabled: record.enabled, reason: '磨砂玻璃应用失败，请关闭后重试。' };
  }
}

// Run before loading a renderer, including startup and interface-switch rollback.
function configureFrostedGlass(win, settings, platform = process.platform, release = os.release()) {
  const record = windows.get(win) || { enabled: false, applied: false };
  windows.set(win, { ...record, mode: settings?.interfaceMode === 'classic' ? 'classic' : 'modern' });
  return applyFrostedGlass(win, settings?.experimentalFrostedGlass === true, platform, release);
}

module.exports = { getFrostedGlassSupport, applyFrostedGlass, configureFrostedGlass };
