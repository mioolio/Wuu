export interface RGB { r: number; g: number; b: number }
export interface CoverPalette {
  color: string;
  rgb: string;
  accent: string;
  secondary: string;
  ink: string;
  glow: string;
}

export const DEFAULT_COVER_COLOR: RGB = { r: 251, g: 114, b: 153 };

/** Electron returns a weighted palette; older bridges may return one RGB object. */
export function normalizeCoverColor(value: unknown): RGB | null {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const color = normalizeCoverColor(candidate);
      if (color) return color;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RGB>;
  if (![candidate.r, candidate.g, candidate.b].every(channel => typeof channel === 'number' && Number.isFinite(channel))) return null;
  const channel = (number: number) => Math.round(Math.max(0, Math.min(255, number)));
  return { r: channel(candidate.r!), g: channel(candidate.g!), b: channel(candidate.b!) };
}

function mix(color: RGB, target: number, amount: number): RGB {
  return { r: Math.round(color.r + (target - color.r) * amount), g: Math.round(color.g + (target - color.g) * amount), b: Math.round(color.b + (target - color.b) * amount) };
}

export function luminance(color: RGB): number {
  const linear = (value: number) => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; };
  return linear(color.r) * 0.2126 + linear(color.g) * 0.7152 + linear(color.b) * 0.0722;
}

export function contrastRatio(foreground: RGB, background: RGB): number {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readable(color: RGB, background: RGB, target: number): RGB {
  if (contrastRatio(color, background) >= 4.5) return color;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(color, target, middle), background) >= 4.5) high = middle;
    else low = middle;
  }
  return mix(color, target, high);
}

export function createCoverPalette(value: unknown): CoverPalette {
  const color = normalizeCoverColor(value) || DEFAULT_COVER_COLOR;
  const accent = readable(color, { r: 40, g: 40, b: 48 }, 255);
  const ink = readable(color, { r: 250, g: 248, b: 253 }, 0);
  const css = (rgb: RGB) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  return {
    color: css(color), rgb: `${color.r}, ${color.g}, ${color.b}`,
    accent: css(accent), secondary: css(mix(accent, 255, 0.24)), ink: css(ink),
    glow: `rgba(${color.r}, ${color.g}, ${color.b}, 0.3)`,
  };
}

/** Window surfaces keep their contrast while following the sleeve's actual hue. */
export function createShellPalette(value: unknown, follow: boolean, intensity: number) {
  const color = normalizeCoverColor(value);
  const strength = follow && color ? Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0.85)) : 0;
  const tint = (base: RGB, amount: number) => {
    const channel = (name: keyof RGB) => Math.round(base[name] + ((color?.[name] ?? base[name]) - base[name]) * amount);
    return `rgb(${channel('r')}, ${channel('g')}, ${channel('b')})`;
  };
  const atmosphere = tint({ r: 23, g: 23, b: 25 }, strength * 0.30).replace('rgb(', 'rgba(').replace(')', `, ${strength * 0.18})`);
  return {
    surface: tint({ r: 23, g: 23, b: 25 }, strength * 0.24),
    chrome: tint({ r: 20, g: 20, b: 23 }, strength * 0.26),
    atmosphere: color && strength ? atmosphere : 'rgba(0, 0, 0, 0)',
    muted: strength ? '#c8c8d2' : '#aaaab4',
  };
}

export interface LyricAppearanceSettings {
  progressColorEnabled?: boolean;
  progressColor?: string;
  progressColor2?: string;
  lyricDone?: number;
  lyricWait?: number;
  lyricSize?: number;
}

/** Explicit user colors take precedence over artwork, including late palette updates. */
export function resolveLyricAppearance(color: unknown, settings: LyricAppearanceSettings = {}) {
  const palette = createCoverPalette(color);
  const validColor = (value?: string) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const custom = settings.progressColorEnabled && validColor(settings.progressColor);
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const done = bounded(settings.lyricDone, 0.9, 0.3, 1);
  return {
    color: custom ? settings.progressColor! : palette.accent,
    secondary: custom ? validColor(settings.progressColor2) ? settings.progressColor2! : settings.progressColor! : palette.secondary,
    done,
    wait: Math.min(done, bounded(settings.lyricWait, 0.55, 0.1, 0.9)),
    size: bounded(settings.lyricSize, 20, 12, 48),
  };
}
