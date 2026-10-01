import { describe, expect, it } from 'vitest';
import { contrastRatio, createCoverPalette, createShellPalette, normalizeCoverColor, resolveLyricAppearance, type RGB } from './coverPalette';

const rgb = (css: string): RGB => {
  const [r, g, b] = css.match(/[\d.]+/g)!.map(Number);
  return { r, g, b };
};

describe('cover palette wire format and readable colors', () => {
  it('accepts the actual weighted array from Electron as well as the legacy RGB object', () => {
    const dominant = { r: 206, g: 76, b: 87, weight: 0.7 };
    expect(normalizeCoverColor([dominant, { r: 20, g: 90, b: 120, weight: 0.3 }])).toEqual({ r: 206, g: 76, b: 87 });
    expect(normalizeCoverColor(dominant)).toEqual({ r: 206, g: 76, b: 87 });
    expect(normalizeCoverColor([{ r: NaN }, { r: 300, g: -4, b: 21.6 }])).toEqual({ r: 255, g: 0, b: 22 });
  });
  it('falls back consistently for missing, malformed and empty palettes', () => {
    for (const source of [null, undefined, [], [{ r: 'red', g: 0, b: 0 }], { r: Infinity, g: 0, b: 0 }]) {
      expect(createCoverPalette(source)).toEqual(createCoverPalette(null));
      expect(createCoverPalette(source).color).not.toContain('undefined');
    }
  });
  it('keeps artwork hue while providing readable accents for dark and light surfaces', () => {
    for (const source of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 15, g: 16, b: 91 }, { r: 206, g: 76, b: 87 }, { r: 42, g: 146, b: 166 }]) {
      const palette = createCoverPalette(source);
      expect(contrastRatio(rgb(palette.accent), { r: 40, g: 40, b: 48 })).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(rgb(palette.ink), { r: 250, g: 248, b: 253 })).toBeGreaterThanOrEqual(4.5);
      expect(palette.color).toBe(`rgb(${source.r}, ${source.g}, ${source.b})`);
    }
  });
  it('preserves manual colors across cover changes and restores artwork when disabled', () => {
    const settings = { progressColorEnabled: true, progressColor: '#f3bd47', progressColor2: '#d48721', lyricDone: 0.8, lyricWait: 0.4, lyricSize: 26 };
    for (const source of [{ r: 206, g: 76, b: 87 }, { r: 42, g: 146, b: 166 }, null]) {
      expect(resolveLyricAppearance(source, settings)).toEqual({ color: '#f3bd47', secondary: '#d48721', done: 0.8, wait: 0.4, size: 26 });
      expect(resolveLyricAppearance(source, { ...settings, progressColorEnabled: false }).color).toBe(createCoverPalette(source).accent);
    }
  });
  it('uses neutral window surfaces when cover following is off, unavailable or has no intensity', () => {
    const neutral = createShellPalette(null, true, 1);
    expect(neutral).toEqual({ surface: 'rgb(23, 23, 25)', chrome: 'rgb(20, 20, 23)', atmosphere: 'rgba(0, 0, 0, 0)', muted: '#aaaab4' });
    for (const source of [{ r: 206, g: 76, b: 87 }, { r: 42, g: 146, b: 166 }]) {
      expect(createShellPalette(source, false, 1)).toEqual(neutral);
      expect(createShellPalette(source, true, 0)).toEqual(neutral);
    }
  });
  it('tints surfaces from real artwork while keeping foreground and secondary text readable', () => {
    for (const source of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 206, g: 76, b: 87 }, { r: 42, g: 146, b: 166 }, { r: 255, g: 255, b: 0 }]) {
      const shell = createShellPalette(source, true, 1);
      for (const background of [shell.surface, shell.chrome]) {
        expect(contrastRatio({ r: 242, g: 242, b: 245 }, rgb(background))).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio({ r: 200, g: 200, b: 210 }, rgb(background))).toBeGreaterThanOrEqual(4.5);
      }
      const [r, g, b, alpha] = shell.atmosphere.match(/[\d.]+/g)!.map(Number);
      let background = rgb(shell.surface);
      // Both the global and listening-page atmosphere can overlap at their centers.
      for (let layer = 0; layer < 2; layer++) {
        background = { r: Math.round(background.r * (1 - alpha) + r * alpha), g: Math.round(background.g * (1 - alpha) + g * alpha), b: Math.round(background.b * (1 - alpha) + b * alpha) };
      }
      expect(contrastRatio({ r: 242, g: 242, b: 245 }, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio({ r: 200, g: 200, b: 210 }, background)).toBeGreaterThanOrEqual(4.5);
    }
    const red = createShellPalette({ r: 206, g: 76, b: 87 }, true, 1);
    const blue = createShellPalette({ r: 42, g: 146, b: 166 }, true, 1);
    expect(red.surface).not.toBe(blue.surface); expect(red.chrome).not.toBe(blue.chrome);
  });
});
