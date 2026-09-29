import { useEffect, useRef, useState } from 'react';
import { getBridge, subscribe } from '../api';
import Icon from './Icon';

interface Character { offset:number; dur:number; text:string }
interface Line { start?:number; time?:number; duration?:number; text?:string; chars?:Character[] }
interface LyricData { raw:boolean; lines:Line[] }
function lineText(line?:Line) { return line?.chars?.map(char => char.text).join('') || line?.text || ''; }
function lineTime(line:Line) { return line.start ?? line.time ?? 0; }

export default function DesktopLyrics() {
  const [data,setData] = useState<LyricData>({ raw:false,lines:[] });
  const [index,setIndex] = useState(-1);
  const [info,setInfo] = useState({ title:'',artist:'' });
  const [locked,setLocked] = useState(false);
  const [color,setColor] = useState('#ffffff');
  const model = useRef({ data,simulate:false,lastTime:0,lastWall:0,playing:false,index:-1,marquee:true,threshold:1,speed:60,pause:1.5 });
  const track = useRef<HTMLSpanElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const interactive = useRef(false);
  const changeInteractive = (on:boolean) => { if (interactive.current === on) return; interactive.current = on; void getBridge('desktopLyric').setInteractive(on); };
  useEffect(() => {
    const unsubscribe = subscribe('lyricReceiver','onUpdate',(payload:any) => {
      if (payload.type === 'data') { model.current.data = payload.lrc || { raw:false,lines:[] }; model.current.simulate = payload.simulate === true; model.current.index = -2; setData(model.current.data); setIndex(-1); }
      else if (payload.type === 'clear') { model.current.data = { raw:false,lines:[] }; model.current.index = -2; setData(model.current.data); setIndex(-1); }
      else if (payload.type === 'time') { model.current.lastTime = Number(payload.t) || 0; model.current.lastWall = performance.now(); model.current.playing = payload.playing === true; }
      else if (payload.type === 'info') { setInfo(payload.info || { title:'',artist:'' }); }
      else if (payload.type === 'lock') { setLocked(payload.locked === true); }
      else if (payload.type === 'color') {
        const rgb = payload.color; if (rgb == null) setColor('#ffffff'); else if (typeof rgb === 'string') setColor(rgb); else if (rgb && typeof rgb.r === 'number') setColor(`rgb(${rgb.r},${rgb.g},${rgb.b})`);
      } else if (payload.type === 'settings') {
        const options = payload.settings || {};
        model.current.marquee = options.marqueeEnabled !== false;
        model.current.threshold = options.marqueeThreshold ?? 1;
        model.current.speed = options.marqueeSpeed ?? 60;
        model.current.pause = options.marqueePause ?? 1.5;
      }
    });
    let raf = 0, lastIndex = -2;
    const update = () => {
      const current = model.current;
      const time = current.lastTime + (current.playing ? Math.max(0,performance.now()-current.lastWall)/1000 : 0);
      let active = -1;
      for (let i=0;i<current.data.lines.length;i++) { if (lineTime(current.data.lines[i]) <= time) active=i; else break; }
      if (active !== lastIndex || current.index === -2) { lastIndex=active; current.index=active; setIndex(active); }
      const line = current.data.lines[active];
      const element = track.current;
      if (element && line) {
        const local = time-lineTime(line);
        const chars = element.querySelectorAll<HTMLSpanElement>('[data-char]');
        let filled = 0;
        if (current.data.raw && line.chars?.length) {
          line.chars.forEach((char,i) => { const ratio=Math.max(0,Math.min(1,(local-char.offset)/Math.max(0.01,char.dur))); const span=chars[i]; if (span) { span.style.setProperty('--fill',`${ratio*100}%`); filled+=span.offsetWidth*ratio; } });
        } else {
          const duration = line.duration || ((current.data.lines[active+1] ? lineTime(current.data.lines[active+1])-lineTime(line) : 4));
          const ratio = current.simulate ? Math.max(0,Math.min(1,local/Math.max(duration,0.01))) : 1;
          element.style.setProperty('--fill',`${ratio*100}%`); filled=element.scrollWidth*ratio;
        }
        const available = row.current?.clientWidth || 860;
        const width = element.scrollWidth;
        const offset = current.marquee && width > available*current.threshold ? Math.min(Math.max(0,width-available),Math.max(0,filled-available*0.7)) : 0;
        element.style.transform = `translateX(${-offset}px)`;
      }
      raf=requestAnimationFrame(update);
    };
    raf=requestAnimationFrame(update);
    return () => { unsubscribe(); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    const leave = () => { if (locked) changeInteractive(false); };
    document.documentElement.addEventListener('mouseleave',leave);
    return () => document.documentElement.removeEventListener('mouseleave',leave);
  }, [locked]);
  const current = data.lines[index];
  const text = lineText(current);
  return <div className="desktop-lyrics" style={{ '--lyric-color':color } as React.CSSProperties}>
    <div className="desktop-lyric-controls" onMouseEnter={() => { if (locked) changeInteractive(true); }} onMouseLeave={() => { if (locked) changeInteractive(false); }}>
      <button aria-label={locked ? '解锁歌词' : '锁定歌词'} title={locked ? '解锁' : '锁定（鼠标穿透）'} onClick={async () => { const next=!locked; await getBridge('desktopLyric').lock(next); setLocked(next); getBridge('desktopLyric').notifyLockChanged(next); if (next) changeInteractive(false); }}>{locked ? '🔒' : '🔓'}</button>
      <button aria-label="关闭桌面歌词" onClick={async () => { await getBridge('desktopLyric').toggle(false); getBridge('desktopLyric').notifyClosed(); }}><Icon name="close" size={14} /></button>
    </div>
    <div className="desktop-current-row" ref={row}><span className={`desktop-lyric-track ${data.raw ? 'raw' : ''}`} ref={track} key={`${index}:${text}`}>
      {current ? data.raw && current.chars?.length ? current.chars.map((char,i) => <span data-char="true" className="desktop-char" key={i}>{char.text}</span>) : text : info.title ? `${info.title}${info.artist ? ` · ${info.artist}` : ''}` : 'Wuu 音乐 · 桌面歌词'}
    </span></div>
    <div className="desktop-next-row" key={`${index+1}:${lineText(data.lines[index+1])}`}>{lineText(data.lines[index+1])}</div>
  </div>;
}
