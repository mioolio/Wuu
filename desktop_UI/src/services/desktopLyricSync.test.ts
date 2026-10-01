import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('desktop lyric state replay after a delayed React subscription', () => {
  it('replays cached colors, settings, lyrics and paused time only to the real lyric window', () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const send = vi.fn();
    let destroyed = false;
    const webContents = { send, isDestroyed: () => destroyed };
    const win = { webContents, isDestroyed: () => destroyed };
    const state = { getLyricWin: () => win, sendToLyric: vi.fn() };
    runInNewContext(readFileSync(new URL('../../../window/desktop-lyric.js', import.meta.url), 'utf8'), {
      module: { exports: {} }, console, require: (name: string) => {
        if (name === 'electron') return { ipcMain: { on: (channel: string, fn: (...args: any[]) => void) => { listeners[channel] = fn; }, handle() {} } };
        if (name === '../core/state') return state;
        return {};
      },
    });
    const payloads = [{ type: 'color', color: { r: 42, g: 146, b: 166 } }, { type: 'settings', settings: { lyricSize: 28 } },
      { type: 'data', lrc: { raw: false, lines: [{ time: 48, text: '日落之后还有星光' }] } }, { type: 'time', t: 48.35, playing: false }];
    for (const payload of payloads) listeners['lyric-data']({}, payload);
    listeners['lyric-request-state']({ sender: { send } });
    expect(send).not.toHaveBeenCalled();
    listeners['lyric-request-state']({ sender: webContents });
    expect(send.mock.calls.map(call => call[1])).toEqual(payloads);
    send.mockClear(); destroyed = true;
    listeners['lyric-request-state']({ sender: webContents });
    expect(send).not.toHaveBeenCalled();
  });
});
