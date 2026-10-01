import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function decoder(pixels: number[], native = false) {
  const exported = { exports: {} as { extractColorFromBuffer: (buffer: Uint8Array) => { r: number; g: number; b: number; weight: number }[] } };
  const source = readFileSync(new URL('../../../cover/color.js', import.meta.url), 'utf8');
  const bitmap = Uint8Array.from(pixels);
  const electron = { ipcMain: { handle() {} }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, resize: () => ({ toBitmap: () => bitmap }) }) } };
  runInNewContext(source, { module: exported, console, Uint8Array, require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === 'jpeg-js') return { decode: () => { if (native) throw new Error('Not JPEG'); return { width: pixels.length / 4, height: 1, data: bitmap }; } };
    return {};
  } });
  return exported.exports.extractColorFromBuffer(new Uint8Array());
}

describe('actual cover extraction module', () => {
  it('retains saturated covers when no grayscale bucket exists', () => {
    expect(decoder([206, 76, 87, 255])[0]).toEqual({ r: 206, g: 76, b: 87, weight: 1 });
    expect(decoder([42, 146, 166, 255])[0]).toEqual({ r: 42, g: 146, b: 166, weight: 1 });
  });
  it('normalizes NativeImage BGRA and jpeg-js RGBA to the same RGB', () => {
    expect(decoder([87, 76, 206, 255], true)).toEqual(decoder([206, 76, 87, 255]));
    expect(decoder([166, 146, 42, 255], true)).toEqual(decoder([42, 146, 166, 255]));
  });
  it('neutralizes only the grayscale bucket and preserves colored buckets beside it', () => {
    const result = decoder([100, 101, 102, 255, 206, 76, 87, 255]);
    expect(result).toContainEqual({ r: 101, g: 101, b: 101, weight: 0.5 });
    expect(result).toContainEqual({ r: 206, g: 76, b: 87, weight: 0.5 });
  });
});
