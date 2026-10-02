import { describe, expect, it } from 'vitest';
import { activeLyricIndex, hasLyricContent, lineText, lyricCredits, parseLyrics } from './lyrics';

describe('LRC metadata and readable lyric content', () => {
  it('does not expose adjacent named headers as untimed lyrics or extra credits', () => {
    const text = '[ti:唯一][ar:告五人]\n[id:provider-123][by:上传者]\n[作词：作者甲][作曲:作者乙]';
    expect(hasLyricContent(text)).toBe(false);
    expect(parseLyrics(text).lines.map(lineText)).toEqual(['纯音乐，请欣赏']);
    expect(lyricCredits(text)).toEqual({ lyricist: '作者甲', composer: '作者乙' });
  });

  it('retains real untimed lyrics and literal named brackets inside the lyric', () => {
    const text = '[ti:唯一][ar:歌手]\n唯一\n你是我的唯一 [ti:这是歌词里的文字]\n下一句';
    expect(hasLyricContent(text)).toBe(true);
    expect(parseLyrics(text).lines.map(lineText)).toEqual(['唯一', '你是我的唯一 [ti:这是歌词里的文字]', '下一句']);
    expect(lyricCredits('歌词中提到 [作词:一个人]')).toEqual({ lyricist: '', composer: '' });
  });

  it('strips metadata before real timestamps while keeping offsets and bilingual groups', () => {
    const text = '[ti:唯一][offset:-500]\n[id:123][00:10]你是我的唯一\n[00:10]You are the only one\n[00:20]下一句';
    const data = parseLyrics(text);
    expect(data.lines.map(lineText)).toEqual(['你是我的唯一', 'You are the only one', '下一句']);
    expect(activeLyricIndex(data.lines, 9.49)).toBe(-1);
    expect(activeLyricIndex(data.lines, 9.5)).toBe(1);
    expect(activeLyricIndex(data.lines, 19.5)).toBe(2);
    expect(activeLyricIndex(data.lines, 9.5), 'backward seeks restore the same bilingual group').toBe(1);
  });

  it('keeps every word and the tail of long KRC and enhanced lines after metadata stripping', () => {
    const long = '这是一句很长的歌词，换行时开头和结尾都要保留，没有任何省略，直到最后一个字';
    const raw = parseLyrics(`[id:123][1000,2000]<0,500,0>${long}<500,500,0>。\n[3000,1000]<0,500,0>下一句`);
    expect(raw.raw).toBe(true);
    expect(raw.lines.map(lineText)).toEqual([`${long}。`, '下一句']);
    const enhanced = parseLyrics('[language:zh][00:10.00]开头[00:10.30]中间[00:10.70]结尾\n[00:10.00]Translation');
    expect(enhanced.raw).toBe(true);
    expect(enhanced.lines.map(lineText)).toEqual(['开头中间结尾', 'Translation']);
  });

  it('skips whitespace-only RAW rows so the previous real lyric keeps focus until the next one', () => {
    const data = parseLyrics('[1000,500]<0,500,0>First\n[3000,3000]<0,1000,0> <1000,1000,0>\n[9000,1000]<0,500,0>Next');
    expect(data.lines.map(lineText)).toEqual(['First', 'Next']);
    expect(activeLyricIndex(data.lines, 5)).toBe(0);
    expect(activeLyricIndex(data.lines, 8.999)).toBe(0);
    expect(activeLyricIndex(data.lines, 9)).toBe(1);
    expect(activeLyricIndex(data.lines, 2), 'rewind restores the first real line').toBe(0);
    expect(parseLyrics('[0,1000]<0,500,0>Keep <500,500,0>spaces').lines.map(lineText)).toEqual(['Keep spaces']);
  });

  it('extracts timed credits into two footer fields and excludes production rows from singing', () => {
    const text = '[ti:唯一]\n[00:00.00]作词 : 作者甲\n[00:01.00]曲：作者乙\n[00:02.00]编曲:丙\n[00:03.00]制作人:丁\n[00:04.00]混音：戊\n[00:05.00]母带:己\n[00:06.00]录音:庚\n[00:10.00]唯一\n[00:10.00]The only one\n[00:20.00]你是我的唯一';
    const data = parseLyrics(text);
    expect(data.lines.map(lineText)).toEqual(['唯一', 'The only one', '你是我的唯一']);
    expect(activeLyricIndex(data.lines, 9)).toBe(-1);
    expect(activeLyricIndex(data.lines, 10)).toBe(1);
    expect(lyricCredits(text)).toEqual({ lyricist: '作者甲', composer: '作者乙' });
  });

  it('handles standalone and combined credits, with named header values taking precedence', () => {
    const text = '[作词:头部作者]\n作词 / 作曲 ： 正文作者\n和声:其他人\nRecording:Engineer\n你听见了吗';
    expect(parseLyrics(text).lines.map(lineText)).toEqual(['你听见了吗']);
    expect(lyricCredits(text)).toEqual({ lyricist: '头部作者', composer: '正文作者' });
    expect(lyricCredits('词曲：同一作者')).toEqual({ lyricist: '同一作者', composer: '同一作者' });
    expect(lyricCredits('[Lyrics:头部词作者][Music:头部曲作者]\n作词/作曲:后来的作者')).toEqual({ lyricist: '头部词作者', composer: '头部曲作者' });
    expect(lyricCredits('[词曲:共同作者]')).toEqual({ lyricist: '共同作者', composer: '共同作者' });
    expect(hasLyricContent('作词：\n[00:00]编曲：某人\n录音:')).toBe(false);
  });

  it('recognizes credits after RAW or enhanced character fragments are joined', () => {
    const raw = '[0,1200]<0,300,0>作<300,300,0>词：<600,300,0>作者甲\n[1200,1200]<0,300,0>作曲：<300,300,0>作者乙\n[2400,1200]<0,300,0>混音：<300,300,0>制作人员\n[5000,1000]<0,300,0>唯一<300,300,0>的歌';
    expect(parseLyrics(raw).lines.map(lineText)).toEqual(['唯一的歌']);
    expect(lyricCredits(raw)).toEqual({ lyricist: '作者甲', composer: '作者乙' });
    const enhanced = '[00:00.00]词[00:00.30]：[00:00.60]作者甲\n[00:01.00]作[00:01.30]曲:[00:01.60]作者乙\n[00:10.00]唯一[00:10.30]的歌';
    expect(parseLyrics(enhanced).lines.map(lineText)).toEqual(['唯一的歌']);
    expect(lyricCredits(enhanced)).toEqual({ lyricist: '作者甲', composer: '作者乙' });
  });

  it('preserves ordinary sentences, labels without colons, and labels occurring mid-lyric', () => {
    const text = '[00:01]你是我的唯一\n[00:02]我为你作词：写下心事\n[00:03]作词的人：站在雨里\n[00:04]词曲写在心里\n[00:05]我想听你录音:每一个呼吸';
    expect(parseLyrics(text).lines.map(lineText)).toEqual(['你是我的唯一', '我为你作词：写下心事', '作词的人：站在雨里', '词曲写在心里', '我想听你录音:每一个呼吸']);
    expect(lyricCredits(text)).toEqual({ lyricist: '', composer: '' });
  });
});
