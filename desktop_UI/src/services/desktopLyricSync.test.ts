import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

function fixture(initialURL = 'file:///D:/Wuu-main/desktop_UI/dist/index.html?window=lyrics', initialMode?: 'classic' | 'modern') {
  const listeners: Record<string, (...args: any[]) => void> = {}, handlers: Record<string, (...args: any[]) => void> = {};
  const send = vi.fn();
  let destroyed = false, url = initialURL;
  const capturePage = vi.fn(async (_rect?: unknown, _opts?: unknown): Promise<unknown> => ({}));
  const webContents = { send, capturePage, on: vi.fn(), isDestroyed: () => destroyed, getURL: () => url };
  const win = { webContents, isDestroyed: () => destroyed, show: vi.fn(), hide: vi.fn(), setSkipTaskbar: vi.fn(),
    setIgnoreMouseEvents: vi.fn(), setAlwaysOnTop: vi.fn(), on: vi.fn(), destroy: () => { destroyed = true; } };
  let currentWin: typeof win | null = initialMode ? null : win;
  const loadRenderer = vi.fn(async () => {});
  const state = { getLyricWin: () => currentWin, setLyricWin: (value: typeof win | null) => { currentWin = value; },
    sendToLyric: (channel: string, payload: unknown) => { if (currentWin && !destroyed) send(channel, payload); } };
  const module = { exports: {} as { destroyDesktopLyricWindow: () => void } };
  runInNewContext(readFileSync(new URL('../../../window/desktop-lyric.js', import.meta.url), 'utf8'), {
    module, console, __dirname: '/fixture/window', require: (name: string) => {
      if (name === 'electron') return { BrowserWindow: function () { return win; },
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
        ipcMain: { on: (channel: string, fn: (...args: any[]) => void) => { listeners[channel] = fn; }, handle: (channel: string, fn: (...args: any[]) => void) => { handlers[channel] = fn; } } };
      if (name === 'path') return { join };
      if (name === './renderer-entry') return { loadRenderer };
      if (name === '../core/storage') return { readUserData: () => ({ settings: { interfaceMode: initialMode || 'modern' } }) };
      if (name === '../core/state') return state;
      return {};
    },
  });
  return { listeners, handlers, send, win, webContents, capturePage, loadRenderer, module,
    destroy: () => { destroyed = true; },
    recreate: (nextURL: string) => { destroyed = false; url = nextURL; currentWin = win; } };
}
const snapshot = { type: 'snapshot', songKey: 'current.mp3', info: { title: 'Current song', artist: 'Artist' },
  lrc: { raw: false, lines: [{ time: 48, text: '日落之后还有星光' }] }, simulate: false,
  color: null, colorReady: false, settings: { lyricSize: 28 }, locked: true, t: 48.35, playing: false };

describe('desktop lyric state replay after a delayed React subscription', () => {
  it('preserves the playback rate through full snapshots, time updates and classic state replay', () => {
    const modern = fixture();
    modern.listeners['lyric-data']({}, { ...snapshot, playbackRate: 2 });
    modern.listeners['lyric-data']({}, { type: 'time', t: 50, playing: true, playbackRate: .75 });
    modern.listeners['lyric-data']({}, { type: 'time', t: 51, playing: false });
    modern.send.mockClear();
    modern.listeners['lyric-request-state']({ sender: modern.webContents });
    expect(modern.send).toHaveBeenCalledExactlyOnceWith('lyric-update', expect.objectContaining({ t: 51, playing: false, playbackRate: .75 }));
    const classic = fixture('file:///D:/Wuu-main/renderer/desktop-lyric.html');
    classic.listeners['lyric-data']({}, { ...snapshot, playbackRate: 1.5 });
    classic.send.mockClear();
    classic.listeners['lyric-request-state']({ sender: classic.webContents });
    expect(classic.send).toHaveBeenCalledWith('lyric-update', { type: 'time', t: snapshot.t, playing: false, playbackRate: 1.5 });
  });
  it('shows a newly created classic window still at about:blank without requiring a React opening acknowledgement', async () => {
    const { handlers, listeners, send, win, webContents, capturePage, loadRenderer } = fixture('about:blank', 'classic');
    expect(await handlers['lyric-toggle']({}, true, snapshot)).toBe(true);
    expect(loadRenderer).toHaveBeenCalledExactlyOnceWith(win, 'lyrics', { mode: 'classic' });
    expect(win.show).toHaveBeenCalledTimes(1); expect(capturePage).not.toHaveBeenCalled();
    expect(send.mock.calls.map(call => call[1].type)).toEqual(['settings', 'color', 'lock', 'info', 'data', 'time']);
    send.mockClear(); listeners['lyric-request-state']({ sender: webContents });
    expect(send.mock.calls.map(call => call[1].type)).toEqual(['settings', 'color', 'lock', 'info', 'data', 'time']);
  });
  it('coalesces legacy updates into one complete replay only to the actual modern lyric receiver', () => {
    const { listeners, send, webContents, destroy } = fixture();
    const payloads = [{ type: 'color', color: { r: 42, g: 146, b: 166 } }, { type: 'settings', settings: { lyricSize: 28 } },
      { type: 'data', lrc: snapshot.lrc }, { type: 'time', t: 48.35, playing: false }];
    for (const payload of payloads) listeners['lyric-data']({}, payload);
    send.mockClear();
    listeners['lyric-request-state']({ sender: { send } });
    expect(send).not.toHaveBeenCalled();
    listeners['lyric-request-state']({ sender: webContents });
    expect(send).toHaveBeenCalledExactlyOnceWith('lyric-update', expect.objectContaining({ type: 'snapshot', lrc: snapshot.lrc,
      color: payloads[0].color, colorReady: true, settings: { lyricSize: 28 }, t: 48.35, playing: false }));
    send.mockClear(); destroy(); listeners['lyric-request-state']({ sender: webContents });
    expect(send).not.toHaveBeenCalled();
  });
  it('shows only after the real committed epoch is acknowledged, while preserving it on ordinary snapshots', async () => {
    const { listeners, handlers, send, win, webContents, capturePage } = fixture();
    const showing = handlers['lyric-toggle']({}, true, snapshot);
    const epoch = send.mock.calls[0][1].openingEpoch;
    expect(epoch).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledWith('lyric-update', { ...snapshot, openingEpoch: epoch });
    expect(win.show).not.toHaveBeenCalled(); expect(capturePage).not.toHaveBeenCalled();
    await listeners['lyric-opening-ready']({ sender: { capturePage } }, epoch);
    await listeners['lyric-opening-ready']({ sender: webContents }, String(epoch));
    await listeners['lyric-opening-ready']({ sender: webContents }, epoch + 1);
    expect(capturePage).not.toHaveBeenCalled();
    listeners['lyric-data']({}, { ...snapshot, openingEpoch: epoch + 100 });
    expect(send).toHaveBeenLastCalledWith('lyric-update', { ...snapshot, openingEpoch: epoch });
    await listeners['lyric-opening-ready']({ sender: webContents }, epoch);
    expect(await showing).toBe(true); expect(win.show).toHaveBeenCalledTimes(1);
    await listeners['lyric-opening-ready']({ sender: webContents }, epoch);
    expect(win.show).toHaveBeenCalledTimes(1); expect(capturePage).not.toHaveBeenCalled();
    listeners['lyric-data']({}, { type: 'color', color: { r: 42, g: 146, b: 166 }, colorReady: true });
    listeners['lyric-data']({}, { type: 'time', t: 55, playing: false });
    listeners['lyric-data']({}, { type: 'settings', settings: { lyricSize: 32, progressColorEnabled: true, progressColor: '#2468ac' }, colorReady: true });
    send.mockClear(); listeners['lyric-request-state']({ sender: webContents });
    expect(send).toHaveBeenCalledExactlyOnceWith('lyric-update', expect.objectContaining({ type: 'snapshot', openingEpoch: epoch, songKey: 'current.mp3', lrc: snapshot.lrc,
      info: snapshot.info, color: { r: 42, g: 146, b: 166 }, colorReady: true, t: 55, locked: true,
      settings: { lyricSize: 32, progressColorEnabled: true, progressColor: '#2468ac' } }));
  });
  it('a hide cancels a pending opening and a late acknowledgement cannot show the window', async () => {
    const { listeners, handlers, send, win, webContents, capturePage } = fixture();
    const showing = handlers['lyric-toggle']({}, true, snapshot);
    const epoch = send.mock.calls[0][1].openingEpoch;
    expect(await handlers['lyric-toggle']({}, false)).toBe(false);
    expect(await showing).toBe(false); expect(win.hide).toHaveBeenCalledTimes(1);
    await listeners['lyric-opening-ready']({ sender: webContents }, epoch);
    expect(win.show).not.toHaveBeenCalled();
    expect(capturePage).not.toHaveBeenCalled();
  });
  it('a newer open cancels the old request and requires its own epoch before showing', async () => {
    const { listeners, handlers, send, win, webContents, capturePage } = fixture();
    const old = handlers['lyric-toggle']({}, true, snapshot), oldEpoch = send.mock.calls[0][1].openingEpoch;
    const current = handlers['lyric-toggle']({}, true, { ...snapshot, songKey: 'new.mp3' });
    const epoch = send.mock.calls.at(-1)![1].openingEpoch;
    expect(epoch).toBeGreaterThan(oldEpoch); expect(await old).toBe(false);
    await listeners['lyric-opening-ready']({ sender: webContents }, oldEpoch);
    expect(capturePage).not.toHaveBeenCalled(); expect(win.show).not.toHaveBeenCalled();
    await listeners['lyric-opening-ready']({ sender: webContents }, epoch);
    expect(await current).toBe(true); expect(win.show).toHaveBeenCalledTimes(1);
  });
  it('destroy cancels a pending opening and a native show failure resolves false', async () => {
    const first = fixture();
    const showing = first.handlers['lyric-toggle']({}, true, snapshot);
    first.module.exports.destroyDesktopLyricWindow();
    expect(await showing).toBe(false);
    await first.listeners['lyric-opening-ready']({ sender: first.webContents }, first.send.mock.calls[0][1].openingEpoch);
    expect(first.capturePage).not.toHaveBeenCalled(); expect(first.win.show).not.toHaveBeenCalled();
    const next = fixture(); next.win.show.mockImplementation(() => { throw new Error('Show failed'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = next.handlers['lyric-toggle']({}, true, snapshot);
    await next.listeners['lyric-opening-ready']({ sender: next.webContents }, next.send.mock.calls[0][1].openingEpoch);
    expect(await failed).toBe(false); expect(next.win.show).toHaveBeenCalledTimes(1);
    expect(next.capturePage).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it('keeps classic receivers on their existing message format and clears caches when the old window is destroyed', async () => {
    const { listeners, handlers, send, webContents, module, recreate, win, capturePage } = fixture('file:///D:/Wuu-main/renderer/desktop-lyric.html');
    await handlers['lyric-toggle']({}, true, snapshot);
    expect(win.show).toHaveBeenCalledTimes(1); expect(capturePage).not.toHaveBeenCalled();
    const legacy = send.mock.calls.map(call => call[1]);
    expect(legacy.map(payload => payload.type)).toEqual(['settings', 'color', 'lock', 'info', 'data', 'time']);
    expect(legacy.every(payload => !('songKey' in payload) && !('colorReady' in payload) && !('openingEpoch' in payload))).toBe(true);
    send.mockClear(); listeners['lyric-request-state']({ sender: webContents });
    expect(send.mock.calls.map(call => call[1])).toEqual(legacy);
    module.exports.destroyDesktopLyricWindow();
    recreate('file:///D:/Wuu-main/desktop_UI/dist/index.html?window=lyrics');
    send.mockClear(); listeners['lyric-request-state']({ sender: webContents });
    expect(send).not.toHaveBeenCalled();
    listeners['lyric-data']({}, { ...snapshot, songKey: 'replacement.mp3', info: { title: 'Replacement', artist: '' } });
    send.mockClear(); listeners['lyric-request-state']({ sender: webContents });
    expect(send).toHaveBeenCalledExactlyOnceWith('lyric-update', expect.objectContaining({ songKey: 'replacement.mp3', info: { title: 'Replacement', artist: '' } }));
  });
});
