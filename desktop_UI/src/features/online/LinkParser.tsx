import { useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge, subscribe } from '../../api';
import { useAppStore } from '../../store';
import { playerService } from '../../services/player';
import { notify } from '../../ui';
import { Cover, Progress, stages } from './common';
import OverwriteDialog, { type OverwriteDecision, type OverwriteRequest } from './OverwriteDialog';

type ParseStatus = 'parsing' | 'parsed' | 'exists' | 'downloading' | 'done' | 'skipped' | 'failed';
interface ParsedItem { input: string; inputKind?: 'links' | 'json'; status: ParseStatus; info?: Record<string, any>; selected: boolean; exists?: boolean; items?: OverwriteRequest['items']; folder?: string; audioPath?: string; message?: string }
const statusText: Record<ParseStatus, string> = { parsing: '解析中', parsed: '已解析', exists: '已存在', downloading: '下载中', done: '已添加', skipped: '已跳过', failed: '失败' };
const selectable = (item: ParsedItem) => !!item.info && item.status !== 'parsing' && item.status !== 'downloading';
let streamInProgress = false;
function jsonEntries(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(item => Array.isArray(item?.musics) ? item.musics : item?.url ? [item] : []);
  if (Array.isArray(value?.musics)) return value.musics;
  if (value?.url) return [value];
  throw new Error('JSON 必须是歌曲对象、歌曲数组或包含 musics 的歌单');
}

export default function LinkParser() {
  const [mode, setMode] = useState<'links' | 'json'>('links');
  const [text, setText] = useState('');
  const [list, setList] = useState<ParsedItem[]>([]);
  const listRef = useRef<ParsedItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const parsingRef = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const downloadingRef = useRef(false);
  const abort = useRef(false);
  const requestId = useRef(0);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState({ text: '', pct: 0 });
  const [overwrite, setOverwrite] = useState<OverwriteRequest | null>(null);
  const overwriteRef = useRef<OverwriteRequest | null>(null);
  const update = (next: ParsedItem[] | ((value: ParsedItem[]) => ParsedItem[])) => {
    const value = typeof next === 'function' ? next(listRef.current) : next;
    listRef.current = value; setList(value);
  };
  const patch = (index: number, value: Partial<ParsedItem>) => update(items => items.map((item, idx) => idx === index ? { ...item, ...value } : item));

  useEffect(() => {
    const offParse = subscribe('parseAPI', 'onParseProgress', async (event: any) => {
      if (!parsingRef.current || !listRef.current[event.idx]) return;
      const run = requestId.current;
      if (!event.ok) { patch(event.idx, { status: 'failed', message: event.message }); return; }
      patch(event.idx, { status: 'parsed', info: event.data, selected: true });
      setMessage(`正在解析 ${event.done}/${event.total}`);
      try {
        const check = await getBridge('parseAPI').checkExists(event.data);
        if (run === requestId.current && check.ok && check.data?.exists) patch(event.idx, { status: 'exists', exists: true, items: check.data.items, folder: check.data.folder });
      } catch (error) { if (run === requestId.current) patch(event.idx, { message: `检查本地文件失败：${errorMessage(error)}` }); }
    });
    const offDownload = subscribe('parseAPI', 'onDownloadProgress', (event: any) => {
      if (downloadingRef.current) setProgress(value => ({ text: `${value.text.split(' · ')[0]} · ${stages[event.stage] || event.stage} ${Math.round(event.pct || 0)}%`, pct: event.pct || 0 }));
    });
    return () => { offParse(); offDownload(); requestId.current++; abort.current = true; overwriteRef.current?.resolve({ action: 'skip', overwrite: { audio: false, cover: false, lrc: false, info: false, krc: false }, applyAll: true }); };
  }, []);

  async function parse() {
    if (parsingRef.current || downloadingRef.current) return;
    if (streamInProgress) { notify('上一批解析仍在进行，请等待完成后再解析'); return; }
    let entries: string[];
    try {
      entries = mode === 'json' ? jsonEntries(JSON.parse(text)).map(item => JSON.stringify(item)) : [...new Set(text.match(/https:\/\/[^\s"'<>\\]+/g) || [])];
      if (!entries.length) throw new Error(mode === 'json' ? 'JSON 中没有可解析的歌曲' : '请粘贴有效的 https:// 分享链接');
    } catch (error) { notify(errorMessage(error), 'error'); return; }
    const run = ++requestId.current;
    streamInProgress = true; parsingRef.current = true; setParsing(true); setMessage(`正在解析 ${entries.length} 个项目`);
    update(entries.map(input => ({ input, inputKind: mode, status: 'parsing', selected: false })));
    try {
      const api = getBridge('parseAPI');
      const result = mode === 'json' ? await api.parseKugouJsonStream(text) : await api.parseStream(entries);
      if (run !== requestId.current) return;
      if (result?.ok === false) throw new Error(result.message);
      const failed = listRef.current.filter(item => item.status === 'failed').length;
      setMessage(`解析完成：成功 ${entries.length - failed} 首，失败 ${failed} 首`);
    } catch (error) {
      if (run !== requestId.current) return;
      update(items => items.map(item => item.status === 'parsing' ? { ...item, status: 'failed', message: errorMessage(error) } : item));
      setMessage(errorMessage(error));
    } finally { streamInProgress = false; if (run === requestId.current) { parsingRef.current = false; setParsing(false); } }
  }
  async function retry(index: number) {
    if (parsingRef.current || downloadingRef.current) return;
    const item = listRef.current[index];
    if (!item) return;
    if (item.info) { patch(index, { status: item.exists ? 'exists' : 'parsed', message: '', selected: true }); return; }
    if (item.inputKind === 'json') { setMode('json'); setText(item.input); notify('已将失败项目放回输入框，可重新解析'); return; }
    const run = requestId.current;
    const current = () => run === requestId.current && listRef.current[index]?.input === item.input;
    patch(index, { status: 'parsing', message: '' });
    try {
      const result = await getBridge('parseAPI').parse(item.input);
      if (!current()) return;
      if (!result.ok) throw new Error(result.message);
      const check = await getBridge('parseAPI').checkExists(result.data);
      if (!current()) return;
      patch(index, { info: result.data, selected: true, status: check.data?.exists ? 'exists' : 'parsed', exists: !!check.data?.exists, items: check.data?.items, folder: check.data?.folder });
    } catch (error) { if (current()) patch(index, { status: 'failed', message: errorMessage(error) }); }
  }
  const askOverwrite = (item: ParsedItem): Promise<OverwriteDecision> => new Promise(resolve => {
    const request: OverwriteRequest = { folder: item.folder || item.info?.title || '歌曲', items: item.items || {}, resolve: decision => { setOverwrite(null); overwriteRef.current = null; resolve(decision); } };
    overwriteRef.current = request; setOverwrite(request);
  });
  async function download(indices: number[], fixedItems?: ParsedItem[]) {
    if (downloadingRef.current || (parsingRef.current && !fixedItems) || !indices.length) { notify('正在处理另一批歌曲，请稍后保存'); return; }
    const targets = indices.map((index, position) => ({ index, item: fixedItems ? fixedItems[position] : listRef.current[index] }));
    const patchTarget = (index: number, target: ParsedItem, value: Partial<ParsedItem>) => {
      const current = listRef.current[index];
      if (current?.input === target.input && current?.info === target.info) patch(index, value);
    };
    downloadingRef.current = true; setDownloading(true); abort.current = false;
    let cached: OverwriteDecision | null = null;
    let success = 0; let skipped = 0; let failed = 0;
    try {
      for (let n = 0; n < indices.length; n++) {
        if (abort.current) break;
        const { index, item: target } = targets[n]; let item = target;
        if (!item?.info) continue;
        try {
          const check = await getBridge('parseAPI').checkExists(item.info);
          if (!check.ok) throw new Error(check.message || '无法检查已存在文件');
          item = { ...item, exists: !!check.data?.exists, items: check.data?.items, folder: check.data?.folder };
          let decision: OverwriteDecision | null = null;
          if (item.exists) {
            decision = cached || await askOverwrite(item);
            if (decision.applyAll) cached = decision;
            if (abort.current || decision.action === 'skip' || !Object.values(decision.overwrite).some(Boolean)) { skipped++; patchTarget(index, target, { status: 'skipped' }); continue; }
          }
          patchTarget(index, target, { status: 'downloading', message: '' });
          setProgress({ text: `[${n + 1}/${indices.length}] ${item.info!.title}`, pct: 0 });
          const result = await getBridge('parseAPI').download(item.info, decision?.overwrite || null);
          if (!result.ok) throw new Error(result.message);
          success++; patchTarget(index, target, { status: 'done', exists: true, folder: result.data?.folder, audioPath: result.data?.audioPath });
        } catch (error) { failed++; patchTarget(index, target, { status: 'failed', message: errorMessage(error) }); }
      }
      if (success) await useAppStore.getState().reloadSongs();
      const summary = `已添加 ${success} 首，跳过 ${skipped} 首，失败 ${failed} 首${abort.current ? '（已停止）' : ''}`;
      setMessage(summary); notify(summary, failed ? 'error' : 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { downloadingRef.current = false; setDownloading(false); setProgress({ text: '', pct: 0 }); }
  }
  async function preview(item: ParsedItem) {
    if (item.audioPath) {
      try { await useAppStore.getState().reloadSongs(); const local = useAppStore.getState().songs.find(song => song.audioPath === item.audioPath); if (local) { await playerService.playSong(local); return; } }
      catch (error) { notify(errorMessage(error), 'error'); return; }
    }
    if (!item.info?.url) { notify('此解析结果没有试听地址', 'error'); return; }
    const index = listRef.current.indexOf(item);
    try { await playerService.playPreview({ name: item.info.title || '未知歌曲', artist: item.info.artist || '', url: item.info.url, cover: item.info.cover, lyric: item.info.rawText || item.info.lrc || '', source: item.info.source || 'parsed', original: item.info, onSave: () => download([index], [item]) }); }
    catch (error) { notify(errorMessage(error), 'error'); }
  }
  const eligible = list.filter(selectable);
  const allSelected = eligible.length > 0 && eligible.every(item => item.selected);
  const selected = list.map((item, index) => item.selected && selectable(item) ? index : -1).filter(index => index >= 0);
  return <section className="panel">
    <div className="toolbar"><button className={`button ${mode === 'links' ? 'primary' : ''}`} disabled={parsing || downloading} onClick={() => setMode('links')}>分享链接</button><button className={`button ${mode === 'json' ? 'primary' : ''}`} disabled={parsing || downloading} onClick={() => setMode('json')}>酷狗代理 JSON</button></div>
    <p className="muted">{mode === 'links' ? '粘贴分享链接，支持多行批量解析。每首解析完成后立即显示结果。' : '粘贴包含 name、url、pic、Am1 / Am2 的歌曲 JSON，支持 musics 歌单和数组。'}</p>
    <textarea className="field" aria-label={mode === 'links' ? '分享链接' : '歌曲 JSON'} rows={5} value={text} onChange={event => setText(event.target.value)} placeholder={mode === 'links' ? 'https://…' : '{ "name": "歌手 - 歌曲", "url": "https://…" }'} onKeyDown={event => { if (mode === 'links' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void parse(); } }} />
    <div className="toolbar"><button className="button primary" disabled={parsing || downloading || !text.trim()} onClick={() => void parse()}>{parsing ? '解析中…' : '解析'}</button><button className="button" onClick={() => void useAppStore.getState().reloadSongs().then(() => notify('歌库已刷新')).catch(error => notify(errorMessage(error), 'error'))}>刷新歌库</button></div>
    {message && <p role="status">{message}</p>}
    {list.length > 0 && <><div className="toolbar"><label className="row"><input type="checkbox" checked={allSelected} disabled={parsing || downloading} onChange={() => update(items => items.map(item => selectable(item) ? { ...item, selected: !allSelected } : item))} />全选</label><span className="muted">解析结果 {list.length} 首</span><button className="button primary" disabled={parsing || downloading || !selected.length} onClick={() => void download(selected)}>添加选中到歌库 ({selected.length})</button>{downloading && <button className="button danger" onClick={() => { abort.current = true; }}>停止后续下载</button>}</div>
      <div className="online-song-list">{list.map((item, index) => <div className="card row" key={`${index}:${item.input}`}><input type="checkbox" aria-label={`选择 ${item.info?.title || index + 1}`} checked={item.selected} disabled={!selectable(item) || parsing || downloading} onChange={event => patch(index, { selected: event.target.checked })} /><Cover src={item.info?.cover} /><div className="online-song-info"><strong>{item.info?.title || (item.status === 'parsing' ? '解析中…' : '未知歌曲')}</strong><p className="muted">{item.info?.artist || item.input}</p>{item.message && <small className="error-text">{item.message}</small>}</div><span className="badge">{statusText[item.status]}</span>{item.info && <button className="button" onClick={() => void preview(item)}>试听</button>}{item.status === 'failed' && <button className="button" disabled={parsing || downloading} onClick={() => void retry(index)}>重试</button>}</div>)}</div></>}
    {progress.text && <Progress {...progress} />}
    {overwrite && <OverwriteDialog key={overwrite.folder} request={overwrite} />}
  </section>;
}
