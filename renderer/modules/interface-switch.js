// The classic interface is the original renderer; switching reloads the window.
(function () {
  const button = document.getElementById('btn-modern-interface');
  if (!button) return;
  button.addEventListener('click', async () => {
    if (!_userDataReady) {
      if (typeof showToast === 'function') showToast('音乐库正在加载，请稍后切换界面', 'error');
      return;
    }
    button.disabled = true;
    const previous = appSettings.interfaceMode;
    try {
      if (typeof window.windowAPI.switchInterface !== 'function') throw new Error('当前应用尚不支持界面切换');
      flushDuration(); await saveCurrentProgress();
      appSettings.interfaceMode = 'modern';
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      const data = _serializeUserData();
      const saved = typeof window.musicAPI.saveUserDataSync === 'function'
        ? window.musicAPI.saveUserDataSync(data) : await window.musicAPI.saveUserData(data);
      if (saved === false) throw new Error('保存设置失败，请重试');
      const result = await window.windowAPI.switchInterface('modern', { playing: !audio.paused });
      if (result?.ok === false) throw new Error(result.message || '切换界面失败');
    } catch (error) {
      appSettings.interfaceMode = previous;
      saveUserDataImmediate();
      button.disabled = false;
      if (typeof showToast === 'function') showToast(error.message || '切换界面失败', 'error');
      console.error('[interface-switch]', error);
    }
  });
})();
