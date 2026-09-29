import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm12-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
  import: 'M12 3v12m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  repair: 'm14.7 6.3 3 3 3-3a6 6 0 0 1-7.5 7.5l-7.7 7.7a2.1 2.1 0 0 1-3-3l7.7-7.7a6 6 0 0 1 7.5-7.5Z',
  stats: 'M4 21V13m8 8V3m8 18V8',
  share: 'M18 5a3 3 0 1 1 0 .01Zm-12 7a3 3 0 1 1 0 .01Zm12 7a3 3 0 1 1 0 .01ZM8.6 10.5l6.8-4m-6.8 7 6.8 4',
  dislike: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 19.7 9ZM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
  settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM9 2h6l1 3 3 1 3 3v6l-3 1-1 3-3 3H9l-1-3-3-1-3-3V9l3-1 1-3Z',
  plus: 'M12 5v14M5 12h14', back: 'm15 5-7 7 7 7', close: 'm6 6 12 12M6 18 18 6',
  minimize: 'M5 12h14', maximize: 'M5 5h14v14H5Z', refresh: 'M20 7v5h-5M4 17v-5h5M5.4 8a7 7 0 0 1 11.5-4L20 7M4 17l3.1 3A7 7 0 0 0 18.6 16',
  play: 'm8 5 11 7-11 7Z', pause: 'M8 5v14M16 5v14', group: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 1a4 4 0 0 1 0 8m1 3a4 4 0 0 1 4 4v2',
  previous: 'M19 4 7 12l12 8V4ZM5 4v16', next: 'M5 4 17 12 5 20V4Zm14 0v16',
};
export default function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] || paths.music} /></svg>;
}
