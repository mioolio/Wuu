import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PreviewSong, Song } from '../types';

const fixture = vi.hoisted(() => ({ state: {
  player: { song: null as Song | null, preview: null as PreviewSong | null, playing: false, lyricText: '', error: '' },
  settings: { discCover: false },
} }));
vi.mock('../store', () => ({ useAppStore: (select: (state: typeof fixture.state) => unknown) => select(fixture.state) }));
vi.mock('../services/player', () => ({ playerService: { media: {} }, isVideo: (song: Song | null) => song?.audioPath.endsWith('.mp4') || false }));
vi.mock('./RecordArtwork', () => ({ default: () => <div className="record-sleeve" /> }));
vi.mock('./LyricsView', () => ({ default: () => <section className="lyrics-panel" /> }));
vi.mock('./SongActions', () => ({ default: () => <div className="player-actions" /> }));
import PlayerView from './PlayerView';

const render = () => renderToStaticMarkup(<PlayerView />);
const creditText = (html: string) => html.match(/<div class="record-credits" aria-label="词曲信息">(.*?)<\/div>/)?.[1] || '';
function expectTitleCredits(html: string) {
  expect(html).toMatch(/<\/h1><div class="record-credits" aria-label="词曲信息">/);
  expect(html).toMatch(/<\/div><p title="Fixture Artist">Fixture Artist<\/p>/);
  expect(html.match(/aria-label="词曲信息"/g)).toHaveLength(1);
  expect(html).toContain('<div class="player-lyrics-column"><section class="lyrics-panel"></section></div>');
  expect(html).not.toContain('<footer');
}

beforeEach(() => {
  fixture.state.player.song = { audioPath: 'isolated/song.wav', songName: 'Fixture Title', artist: 'Fixture Artist' };
  fixture.state.player.preview = null;
  fixture.state.player.lyricText = '[00:00]真正的歌词';
});

describe('song credits belong immediately below the title', () => {
  it('shows trimmed actual song authors before the artist, without repeating lyric-header authors', () => {
    Object.assign(fixture.state.player.song!, { lyricist: '  Actual Writer  ', composer: 'Actual Composer' });
    fixture.state.player.lyricText = '[lyricist:Header Writer]\n[composer:Header Composer]\n[00:00]真正的歌词';
    const html = render();
    expectTitleCredits(html);
    expect(creditText(html)).toContain('作词 Actual Writer');
    expect(creditText(html)).toContain('作曲 Actual Composer');
    expect(html).not.toContain('Header Writer');
    expect(html).not.toContain('Header Composer');
  });

  it('uses genuine lyric credits when song fields contain only whitespace', () => {
    Object.assign(fixture.state.player.song!, { lyricist: ' \n ', composer: ' ' });
    fixture.state.player.lyricText = '[00:00]作词：歌词作者\n[00:01]作曲：旋律作者\n[00:10]真正的歌词';
    const html = render();
    expectTitleCredits(html);
    expect(creditText(html)).toContain('作词 歌词作者');
    expect(creditText(html)).toContain('作曲 旋律作者');
  });

  it('combines equal author values once while retaining both roles', () => {
    Object.assign(fixture.state.player.song!, { lyricist: '同一作者', composer: '同一作者' });
    const html = render();
    expectTitleCredits(html);
    expect(creditText(html)).toBe('<span title="作词 / 作曲 同一作者">作词 / 作曲 同一作者</span>');
  });

  it('omits the entire credit block when no real authors exist, and adds it when lyrics arrive', () => {
    expect(render()).not.toContain('record-credits');
    fixture.state.player.lyricText = '[lyricist:Late Writer]\n[00:00]真正的歌词';
    const html = render();
    expectTitleCredits(html);
    expect(creditText(html)).toContain('作词 Late Writer');
    expect(creditText(html)).not.toContain('作曲');
    fixture.state.player.song = { audioPath: 'isolated/another.wav', songName: 'Another', artist: 'Fixture Artist' };
    fixture.state.player.lyricText = '[00:00]新歌';
    expect(render()).not.toContain('record-credits');
  });

  it('keeps full long author names in title attributes and places video credits under its title', () => {
    const writer = '非常长的真实作词作者'.repeat(10);
    Object.assign(fixture.state.player.song!, { audioPath: 'isolated/video.mp4', lyricist: writer });
    const html = render();
    expect(html).toMatch(/<\/h1><div class="record-credits" aria-label="词曲信息">/);
    expect(creditText(html)).toContain(`title="作词 ${writer}"`);
    expect(html).not.toContain('player-lyrics-column');
    expect(html).not.toContain('<footer');
  });
});
