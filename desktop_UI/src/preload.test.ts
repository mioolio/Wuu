import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe,expect,it,vi } from 'vitest';

describe('React IPC 订阅生命周期',() => {
  it('allows a newly mounted lyric receiver to request the latest cached state', () => {
    const apis: Record<string, any> = {};
    const send = vi.fn();
    runInNewContext(readFileSync(new URL('../../preload.js', import.meta.url), 'utf8'), { require: () => ({
      contextBridge: { exposeInMainWorld: (name: string, api: any) => { apis[name] = api; } },
      ipcRenderer: { send },
    }) });
    apis.lyricReceiver.requestState();
    expect(send).toHaveBeenCalledWith('lyric-request-state');
  });
  it('卸载一个页面只清理它自己的监听，保留其他页面订阅',() => {
    const apis:Record<string,any>={};
    const listeners=new Map<string,Set<(...args:any[])=>void>>();
    const ipcRenderer={on:(channel:string,listener:(...args:any[])=>void) => { const list=listeners.get(channel)||new Set(); list.add(listener); listeners.set(channel,list); },removeListener:(channel:string,listener:(...args:any[])=>void) => listeners.get(channel)?.delete(listener),invoke:()=>Promise.resolve(),send:()=>{},sendSync:()=>{}};
    const contextBridge={exposeInMainWorld:(name:string,api:any) => { apis[name]=api; }};
    runInNewContext(readFileSync(new URL('../../preload.js',import.meta.url),'utf8'),{require:()=>({contextBridge,ipcRenderer})});
    const received:string[]=[];
    const disposeImport=apis.kugouAPI.onDownloadProgress(() => received.push('import'));
    const disposeShare=apis.playlistAPI.onDownloadProgress(() => received.push('share'));
    expect(typeof disposeImport).toBe('function'); expect(listeners.get('parse-download-progress')?.size).toBe(2);
    disposeImport(); for (const listener of listeners.get('parse-download-progress')||[]) listener({}, {pct:50});
    expect(received).toEqual(['share']); disposeShare(); expect(listeners.get('parse-download-progress')?.size).toBe(0);
  });
});
