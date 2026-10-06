import type { LyricAppearanceSettings, RGB } from './coverPalette';
import { normalizeCoverColor } from './coverPalette';

export interface DesktopLyricCharacter { offset: number; dur: number; text: string }
export interface DesktopLyricLine { start?: number; time?: number; duration?: number; text?: string; chars?: DesktopLyricCharacter[] }
export interface DesktopLyricData { raw: boolean; lines: DesktopLyricLine[] }
export interface DesktopLyricModel {
  data: DesktopLyricData; dataKey: string; revision: number; simulate: boolean;
  info: { title: string; artist: string }; settings: LyricAppearanceSettings & Record<string, unknown>;
  color: RGB | null; colorReady: boolean; snapshotSeen: boolean; ready: boolean; locked: boolean;
  songKey: string; openingEpoch: number; lastTime: number; lastWall: number; playing: boolean; playbackRate: number;
}
export function desktopLineText(line?: DesktopLyricLine): string { return line?.chars?.map(char => char.text).join('') || line?.text || ''; }
export function desktopLineTime(line: DesktopLyricLine): number { return line.start ?? line.time ?? 0; }
export function desktopLyricTime(model: DesktopLyricModel, now: number): number {
  return model.lastTime + (model.playing ? Math.max(0, now - model.lastWall) / 1000 * model.playbackRate : 0);
}
export function desktopNextIndex(lines: DesktopLyricLine[], index: number): number {
  if (index < 0) return lines.length ? 0 : -1;
  if (!lines[index]) return -1;
  let next = index + 1;
  while (next < lines.length && desktopLineTime(lines[next]) === desktopLineTime(lines[index])) next++;
  return next < lines.length ? next : -1;
}
export function desktopLyricIndex(lines: DesktopLyricLine[], time: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) { if (desktopLineTime(lines[i]) <= time) index = i; else break; }
  while (index > 0 && desktopLineTime(lines[index - 1]) === desktopLineTime(lines[index])) index--;
  return index;
}
export function createDesktopLyricModel(): DesktopLyricModel {
  return { data: { raw: false, lines: [] }, dataKey: '', revision: 0, simulate: false, info: { title: '', artist: '' }, settings: {},
    color: null, colorReady: false, snapshotSeen: false, ready: false, locked: false, songKey: '', openingEpoch: 0, lastTime: 0, lastWall: 0, playing: false, playbackRate: 1 };
}

/** Apply the clock before deriving a frame: data never introduces a title frame at index -1. */
export function applyDesktopLyricPayload(model: DesktopLyricModel, payload: any, now: number) {
  let reset = false, seek = false, appearance = false, content = false, opening = false;
  const replaceData = (value: any) => {
    const data: DesktopLyricData = { raw: value?.raw === true, lines: Array.isArray(value?.lines) ? value.lines : [] };
    const key = JSON.stringify(data);
    if (key === model.dataKey) return;
    model.data = data; model.dataKey = key; model.revision++; reset = true; content = true;
  };
  const setTime = () => {
    const estimated = desktopLyricTime(model, now);
    const time = payload.t != null && Number.isFinite(Number(payload.t)) ? Math.max(0, Number(payload.t)) : estimated;
    seek = Math.abs(time - estimated) > 0.35;
    model.lastTime = time; model.lastWall = now; model.playing = payload.playing === true;
    if (payload.playbackRate != null) {
      const rate = Number(payload.playbackRate);
      model.playbackRate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
    }
  };
  if (payload.type === 'snapshot') {
    if (Number.isSafeInteger(payload.openingEpoch) && payload.openingEpoch > 0 && payload.openingEpoch !== model.openingEpoch) {
      model.openingEpoch = payload.openingEpoch; model.ready = false; opening = true; reset = true;
    }
    setTime(); replaceData(payload.lrc); model.simulate = payload.simulate === true;
    const key = typeof payload.songKey === 'string' ? payload.songKey : '';
    if (key !== model.songKey) { model.songKey = key; reset = true; }
    model.info = { title: payload.info?.title || '', artist: payload.info?.artist || '' };
    model.settings = payload.settings || {}; model.color = normalizeCoverColor(payload.color);
    model.colorReady = payload.colorReady !== false; model.locked = payload.locked === true;
    model.snapshotSeen = true; appearance = true; content = true;
  } else if (payload.type === 'data' || payload.type === 'clear') {
    replaceData(payload.type === 'data' ? payload.lrc : null); model.simulate = payload.simulate === true;
  } else if (payload.type === 'time') setTime();
  else if (payload.type === 'info') { model.info = { title: payload.info?.title || '', artist: payload.info?.artist || '' }; content = true; }
  else if (payload.type === 'settings') { model.settings = payload.settings || {}; if (typeof payload.colorReady === 'boolean') model.colorReady = payload.colorReady; appearance = true; }
  else if (payload.type === 'color') { model.color = normalizeCoverColor(payload.color); model.colorReady = payload.colorReady !== false; appearance = true; }
  else if (payload.type === 'lock') { model.locked = payload.locked === true; appearance = true; }
  const custom = model.settings.progressColorEnabled && typeof model.settings.progressColor === 'string' && /^#[\da-f]{6}$/i.test(model.settings.progressColor);
  // Once visible, retain the current palette while a new sleeve is being read.
  model.ready ||= model.snapshotSeen && (model.colorReady || !!custom);
  return { reset, seek, appearance, content, opening };
}

/** Only the immediate following timestamp group receives a decorative handoff. */
export function desktopLyricHandoff(lines: DesktopLyricLine[], previous: number, next: number, continuous: boolean, reduced: boolean): boolean {
  if (!continuous || reduced || previous < 0 || next <= previous || !lines[previous] || !lines[next]) return false;
  return desktopNextIndex(lines, previous) === next;
}

export function desktopLineRatio(data: DesktopLyricData, index: number, time: number, simulate: boolean): number {
  const line = data.lines[index];
  if (!line || !simulate) return 1;
  let next = index + 1;
  while (next < data.lines.length && desktopLineTime(data.lines[next]) === desktopLineTime(line)) next++;
  const duration = line.duration || (data.lines[next] ? desktopLineTime(data.lines[next]) - desktopLineTime(line) : 4);
  return Math.max(0, Math.min(1, (time - desktopLineTime(line)) / Math.max(duration, 0.01)));
}
