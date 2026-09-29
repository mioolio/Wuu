import { useEffect, useRef, useState } from 'react';
import { overwriteAll, type Overwrite } from './common';

export interface OverwriteDecision { action: 'skip' | 'update'; overwrite: Overwrite; applyAll: boolean }
export interface OverwriteRequest { folder: string; items: Record<string, { diff?: boolean; hasOld?: boolean; hasNew?: boolean }>; resolve: (decision: OverwriteDecision) => void }
const labels: [keyof Overwrite, string][] = [['audio', '音频'], ['cover', '封面'], ['lrc', '歌词'], ['info', '歌曲信息'], ['krc', '逐字歌词']];

export default function OverwriteDialog({ request }: { request: OverwriteRequest }) {
  const dialog = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<Overwrite>(() => Object.fromEntries(labels.map(([key]) => [key, !!request.items[key]?.diff])) as Overwrite);
  const [applyAll, setApplyAll] = useState(false);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
  const finish = (action: OverwriteDecision['action'], overwrite = selected) => request.resolve({ action, overwrite, applyAll });
  return <div className="modal-backdrop" role="presentation"><section className="modal-card" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="overwrite-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); finish('skip'); }
    if (event.key === 'Tab') {
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button, input');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <h2 id="overwrite-title">歌曲已存在</h2><p className="muted">{request.folder} · 选择需要更新的文件</p>
    {labels.map(([key, label]) => { const item = request.items[key]; const status = !item || (!item.hasOld && !item.hasNew) ? '无' : !item.hasOld ? '新增' : item.diff ? '不同' : '相同'; return <label className="row" key={key}><input type="checkbox" checked={selected[key]} onChange={event => setSelected(value => ({ ...value, [key]: event.target.checked }))} />{label}<span className="badge">{status}</span></label>; })}
    <label className="row"><input type="checkbox" checked={applyAll} onChange={event => setApplyAll(event.target.checked)} />对本次剩余歌曲应用相同选择</label>
    <div className="toolbar"><button className="button" onClick={() => finish('skip')}>跳过</button><button className="button danger" onClick={() => finish('update', overwriteAll)}>全部覆盖</button><button className="button primary" onClick={() => finish('update')}>更新选中项</button></div>
  </section></div>;
}
