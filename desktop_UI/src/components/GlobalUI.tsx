import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../ui';

function Dialog() {
  const dialog = useUIStore(state => state.dialog)!;
  const [value, setValue] = useState(dialog.defaultValue || '');
  const card = useRef<HTMLFormElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const finish = (result: string | boolean | null) => { useUIStore.setState({ dialog: null }); dialog.resolve(result); };
  useEffect(() => {
    (card.current?.querySelector('input,button') as HTMLElement)?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
      if (event.key === 'Tab' && card.current) {
        const elements = [...card.current.querySelectorAll<HTMLElement>('button:not(:disabled),input')];
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previousFocus.current?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) finish(null); }}>
    <form className="modal-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={event => { event.preventDefault(); finish(dialog.kind === 'prompt' ? value.trim() : true); }}>
      <h2 id="dialog-title">{dialog.title}</h2>
      {dialog.message && <p className="muted">{dialog.message}</p>}
      {dialog.kind === 'prompt' && <input aria-label={dialog.title} value={value} onChange={event => setValue(event.target.value)} />}
      <div className="toolbar end"><button type="button" onClick={() => finish(null)}>取消</button><button className={dialog.danger ? 'danger' : 'primary'} type="submit" disabled={dialog.kind === 'prompt' && !dialog.allowEmpty && !value.trim()}>{dialog.confirmText || '确定'}</button></div>
    </form>
  </div>;
}

export default function GlobalUI() {
  const toast = useUIStore(state => state.toast);
  const dialog = useUIStore(state => state.dialog);
  return <>{toast && <div className={`toast ${toast.type}`} role="status">{toast.message}</div>}{dialog && <Dialog key={dialog.title} />}</>;
}
