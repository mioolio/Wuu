export interface Song {
  audioPath: string;
  songName: string;
  artist: string;
  album?: string;
  genre?: string[];
  coverPath?: string | null;
  lrcPath?: string | null;
  lyricPath?: string | null;
  rawPath?: string | null;
  realDuration?: number;
  duration?: number;
  trackId?: string;
  [key: string]: any;
}

export interface PreviewSong {
  name: string;
  artist: string;
  url: string;
  cover?: string;
  lyric?: string;
  mediaType?: string;
  source?: string;
  original?: any;
  queue?: PreviewSong[];
  onSave?: () => Promise<void>;
  resolve?: () => Promise<PreviewSong>;
}

export interface Collection {
  id: string;
  name: string;
  songs: string[];
  createdAt: number;
}

export interface ListeningDay { plays: number; duration: number }
export interface SongStats { plays: number; duration: number; recentDays?: Record<string, ListeningDay> }
export type View = 'home' | 'list' | 'liked' | 'player' | 'import' | 'free-music' | 'repair' | 'stats' | 'playlist' | 'management' | 'settings';

export interface Settings {
  interfaceMode: 'modern' | 'classic';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  playMode: number;
  volume: number;
  playbackRate: number;
  fadePause: boolean;
  glassOpacity: number;
  discCover: boolean;
  colorIntensity: number;
  lyricDone: number;
  lyricWait: number;
  lyricSize: number;
  currentLyricSize: number;
  themeFollowCover: boolean;
  progressColorEnabled: boolean;
  progressColor: string;
  progressColor2: string;
  simulateLrcProgress: boolean;
  showFloatListBtn: boolean;
  artistGroupMode: string;
  desktopLyricPersist: boolean;
  desktopLyricBounds: number[] | null;
  desktopLyricLocked: boolean;
  marqueeEnabled: boolean;
  marqueeSpeed: number;
  marqueeThreshold: number;
  marqueePause: number;
  serverEnabled: boolean;
  serverPort: number;
  serverBindIP: string;
  serverWhitelist: string[];
  serverRateLimit: number;
  serverAccessLog: boolean;
  mobileEnabled: boolean;
  coverUnify: boolean;
  publicHostMode: string;
  publicHost: string;
  publicPort: number;
  audioFx?: any;
  [key: string]: any;
}

export interface PlayerState {
  song: Song | null;
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  loading: boolean;
  lyricText: string;
  preview: PreviewSong | null;
  error: string;
  desktopLyricOn: boolean;
}
