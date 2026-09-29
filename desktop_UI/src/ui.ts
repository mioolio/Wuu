import { create } from 'zustand';

interface DialogOptions { title: string; message?: string; defaultValue?: string; confirmText?: string; danger?: boolean; allowEmpty?: boolean }
interface Dialog extends DialogOptions { kind: 'confirm' | 'prompt'; resolve: (value: string | boolean | null) => void }
interface UIState { toast: { message: string; type: string } | null; dialog: Dialog | null }
export const useUIStore = create<UIState>(() => ({ toast: null, dialog: null }));
let toastTimer: ReturnType<typeof setTimeout>;

export function notify(message: string, type = 'info') {
  clearTimeout(toastTimer);
  useUIStore.setState({ toast: { message, type } });
  toastTimer = setTimeout(() => useUIStore.setState({ toast: null }), 3500);
}

function ask(kind: Dialog['kind'], options: DialogOptions): Promise<string | boolean | null> {
  const pending = useUIStore.getState().dialog;
  if (pending) pending.resolve(null);
  return new Promise(resolve => useUIStore.setState({ dialog: { ...options, kind, resolve } }));
}
export async function confirmAction(options: DialogOptions): Promise<boolean> { return (await ask('confirm', options)) === true; }
export async function promptText(options: DialogOptions): Promise<string | null> { const value = await ask('prompt', options); return typeof value === 'string' ? value : null; }

export function formatTime(value = 0): string {
  const time = Math.max(0, Number.isFinite(value) ? value : 0);
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}
export function formatDuration(seconds = 0): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}
