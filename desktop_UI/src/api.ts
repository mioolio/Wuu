import type { Song } from './types';

export type Unsubscribe = () => void;
export type Bridge = Record<string, (...args: any[]) => any>;
export type BridgeName = 'musicAPI' | 'windowAPI' | 'desktopLyric' | 'lyricReceiver' | 'parseAPI' | 'repairAPI' | 'stateAPI' | 'freeMusicAPI' | 'kugouAPI' | 'qishuiAPI' | 'neteaseAPI' | 'playlistAPI';

declare global {
  interface Window {
    musicAPI: Bridge & { getSongs: () => Promise<Song[]> };
    windowAPI: Bridge;
    desktopLyric: Bridge;
    lyricReceiver: Bridge;
    parseAPI: Bridge;
    repairAPI: Bridge;
    stateAPI: Bridge;
    freeMusicAPI: Bridge;
    kugouAPI: Bridge;
    qishuiAPI: Bridge;
    neteaseAPI: Bridge;
    playlistAPI: Bridge;
  }
}

export function getBridge(name: BridgeName): Bridge {
  const bridge = window[name];
  if (!bridge) throw new Error('请在 Wuu 桌面应用中打开此页面。');
  return bridge;
}

export function subscribe(name: BridgeName, method: string, listener: (...args: any[]) => void): Unsubscribe {
  const dispose = getBridge(name)[method](listener);
  return typeof dispose === 'function' ? dispose : () => {};
}

export function mediaUrl(path?: string | null): string {
  if (!path) return '';
  if (/^(https?:|file:|music:|data:|blob:)/i.test(path)) return path;
  return 'music:///' + path.replace(/\\/g, '/').split('/').map((part, index) => index === 0 ? part : encodeURIComponent(part)).join('/');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
}
