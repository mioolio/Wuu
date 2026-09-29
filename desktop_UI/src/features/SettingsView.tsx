import { useEffect, useState } from 'react';
import { errorMessage, getBridge } from '../api';
import { defaultSettings, persistNow, useAppStore } from '../store';
import { confirmAction, notify } from '../ui';
import type { Settings } from '../types';
import AudioFxPanel from '../components/AudioFxPanel';

function Toggle({ label, description, checked, onChange, disabled = false }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="setting-row"><span><strong>{label}</strong>{description && <small className="muted">{description}</small>}</span><input className="switch" type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /></label>;
}
function Range({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="setting-row"><span>{label}<small className="muted">{Number(value.toFixed(2))}{unit}</small></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

export default function SettingsView() {
  const settings = useAppStore(state => state.settings);
  const setSettings = useAppStore(state => state.setSettings);
  const [network, setNetwork] = useState(settings);
  const [whitelist, setWhitelist] = useState(settings.serverWhitelist.join('\n'));
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const refresh = async () => {
    const result = await getBridge('playlistAPI').serverStatus(); setRunning(result.running === true);
  };
  useEffect(() => { void refresh().catch(error => notify(errorMessage(error),'error')); }, [settings.serverEnabled,settings.mobileEnabled,settings.serverPort]);
  useEffect(() => {
    setNetwork(settings); setWhitelist(settings.serverWhitelist.join('\n'));
  }, [settings.serverPort,settings.serverBindIP,settings.serverWhitelist,settings.serverRateLimit,settings.serverAccessLog,settings.publicHostMode,settings.publicHost,settings.publicPort]);
  const applyNetwork = async (patch: Partial<Settings>, restart = true) => {
    setBusy(true);
    const previous = useAppStore.getState().settings;
    const next = { ...previous, ...patch };
    const api = getBridge('playlistAPI');
    let restore = false;
    try {
      if (restart) {
        const status = await api.serverStatus();
        const stop = await api.stopServer(); if (!stop.ok) throw new Error(stop.message);
        restore = status.running === true;
      }
      if (next.serverEnabled || next.mobileEnabled) {
        const result = await api.startServer(next.serverPort,next.serverBindIP,next.serverWhitelist,next.serverRateLimit,next.serverAccessLog);
        if (!result.ok) throw new Error(result.message || '启动服务失败');
      } else { const stop = await api.stopServer(); if (!stop.ok) throw new Error(stop.message); }
      restore = false;
      setSettings(patch); setNetwork(next); if (!await persistNow()) throw new Error('网络设置已应用，但写入配置文件失败'); await refresh();
      notify('网络设置已应用','success');
    } catch (error) {
      if (restore) {
        try { await api.startServer(previous.serverPort,previous.serverBindIP,previous.serverWhitelist,previous.serverRateLimit,previous.serverAccessLog); } catch {}
      }
      notify(errorMessage(error),'error'); await refresh().catch(() => {});
    }
    finally { setBusy(false); }
  };
  const readLogs = async () => {
    try { const result = await getBridge('playlistAPI').getAccessLogs(); if (!result.ok) throw new Error(result.message); setLogs(result.logs || []); }
    catch (error) { notify(errorMessage(error),'error'); }
  };
  return <section className="panel settings-page">
    <header className="page-header"><div><h1>设置</h1><p className="muted">播放、外观、歌词与网络服务</p></div><button onClick={async () => { if (await confirmAction({ title: '恢复默认设置', message: '恢复播放、外观和歌词设置？歌单、歌曲与播放统计会保留。' })) { const { serverEnabled, mobileEnabled, serverPort, serverBindIP, serverWhitelist, serverRateLimit, serverAccessLog, publicHost, publicHostMode, publicPort } = settings; setSettings({ ...defaultSettings, serverEnabled, mobileEnabled, serverPort, serverBindIP, serverWhitelist, serverRateLimit, serverAccessLog, publicHost, publicHostMode, publicPort }); notify('已恢复默认设置','success'); } }}>恢复默认</button></header>
    <div className="settings-grid">
      <section className="card"><h2>播放与外观</h2>
        <Toggle label="暂停时淡出音量" description="暂停前平滑降低音量" checked={settings.fadePause} onChange={value => setSettings({ fadePause:value })} />
        <Toggle label="圆盘封面" checked={settings.discCover} onChange={value => setSettings({ discCover:value })} />
        <Toggle label="全局背景跟随封面" checked={settings.themeFollowCover} onChange={value => setSettings({ themeFollowCover:value })} />
        <Toggle label="换源时保留封面" checked={settings.coverUnify} onChange={value => setSettings({ coverUnify:value })} />
        <Toggle label="显示播放队列按钮" checked={settings.showFloatListBtn} onChange={value => setSettings({ showFloatListBtn:value })} />
        <Range label="界面透明度" value={settings.glassOpacity} min={0.3} max={0.95} step={0.01} onChange={value => setSettings({ glassOpacity:value })} />
        <Range label="封面背景强度" value={settings.colorIntensity} min={0} max={1} step={0.01} onChange={value => setSettings({ colorIntensity:value })} />
        <label className="setting-row"><span>歌手分组方式</span><select value={settings.artistGroupMode} onChange={event => setSettings({ artistGroupMode:event.target.value })}><option value="bucket">保留合作歌手组合</option><option value="split">拆分为各个歌手</option></select></label>
        <Toggle label="自定义进度条颜色" checked={settings.progressColorEnabled} onChange={value => setSettings({ progressColorEnabled:value })} />
        {settings.progressColorEnabled && <div className="row"><label>起始颜色 <input type="color" value={settings.progressColor} onChange={event => setSettings({ progressColor:event.target.value })} /></label><label>结束颜色 <input type="color" value={settings.progressColor2} onChange={event => setSettings({ progressColor2:event.target.value })} /></label></div>}
      </section>
      <section className="card"><h2>歌词</h2>
        <Toggle label="启动时打开桌面歌词" checked={settings.desktopLyricPersist} onChange={value => setSettings({ desktopLyricPersist:value })} />
        <Toggle label="普通歌词模拟逐字进度" checked={settings.simulateLrcProgress} onChange={value => setSettings({ simulateLrcProgress:value })} />
        <Range label="歌词字号" value={settings.lyricSize} min={12} max={36} unit=" px" onChange={value => setSettings({ lyricSize:value })} />
        <Range label="已唱歌词亮度" value={settings.lyricDone} min={0.3} max={1} step={0.01} onChange={value => setSettings({ lyricDone:value, lyricWait:Math.min(settings.lyricWait,value-0.1) })} />
        <Range label="未唱歌词亮度" value={settings.lyricWait} min={0.1} max={Math.max(0.1,settings.lyricDone-0.1)} step={0.01} onChange={value => setSettings({ lyricWait:value })} />
        <Toggle label="长歌词滚动" checked={settings.marqueeEnabled} onChange={value => setSettings({ marqueeEnabled:value })} />
        <Range label="滚动速度" value={settings.marqueeSpeed} min={30} max={150} unit=" px/s" onChange={value => setSettings({ marqueeSpeed:value })} />
        <Range label="滚动触发阈值" value={settings.marqueeThreshold} min={0.8} max={2} step={0.1} unit=" 倍" onChange={value => setSettings({ marqueeThreshold:value })} />
        <Range label="两端停留时间" value={settings.marqueePause} min={0.5} max={5} step={0.1} unit=" 秒" onChange={value => setSettings({ marqueePause:value })} />
        <button onClick={() => { setSettings({ desktopLyricBounds:null }); void getBridge('desktopLyric').setPosition(null).then(() => notify('桌面歌词位置已重置','success')).catch((error: unknown) => notify(errorMessage(error),'error')); }}>重置桌面歌词位置</button>
      </section>
      <section className="card full-width"><h2>音效</h2><AudioFxPanel /></section>
      <section className="card full-width"><h2>网络服务 <span className={`badge ${running ? 'success' : ''}`}>{running ? '运行中' : '已停止'}</span></h2>
        <Toggle label="歌单分享服务" checked={settings.serverEnabled} disabled={busy} onChange={value => void applyNetwork({ serverEnabled:value },false)} />
        <Toggle label="手机版服务" description="通过手机浏览器访问本机地址，使用移动端播放器" checked={settings.mobileEnabled} disabled={busy} onChange={value => void applyNetwork({ mobileEnabled:value },false)} />
        {running && <p className="muted">本机地址：http://127.0.0.1:{settings.serverPort}/mobile/ · 手机请使用此电脑的局域网 IP</p>}
        <form onSubmit={event => { event.preventDefault(); if (!Number.isInteger(network.serverPort) || network.serverPort < 1 || network.serverPort > 65535) { notify('端口范围为 1–65535','error'); return; } void applyNetwork({ serverPort:network.serverPort,serverBindIP:network.serverBindIP.trim() || '0.0.0.0',serverWhitelist:whitelist.split('\n').map(line => line.trim()).filter(Boolean),serverRateLimit:network.serverRateLimit,serverAccessLog:network.serverAccessLog,publicHostMode:network.publicHostMode,publicHost:network.publicHost.trim().replace(/^https?:\/\//i,'').replace(/\/.*$/,'').replace(/:\d+$/,''),publicPort:network.publicPort }); }}>
          <div className="grid"><label className="field">服务端口<input type="number" min={1} max={65535} required value={network.serverPort} onChange={event => setNetwork({ ...network,serverPort:Number(event.target.value) })} /></label><label className="field">绑定 IP<input value={network.serverBindIP} onChange={event => setNetwork({ ...network,serverBindIP:event.target.value })} /></label>
            <label className="field">每分钟请求上限（0 为不限）<input type="number" min={0} max={10000} required value={network.serverRateLimit} onChange={event => setNetwork({ ...network,serverRateLimit:Number(event.target.value) })} /></label><label className="field">分享地址<select value={network.publicHostMode} onChange={event => setNetwork({ ...network,publicHostMode:event.target.value })}><option value="auto">自动获取本机地址</option><option value="manual">手动指定公网地址</option></select></label>
            <label className="field">对外 IP / 域名<input disabled={network.publicHostMode !== 'manual'} value={network.publicHost} onChange={event => setNetwork({ ...network,publicHost:event.target.value })} placeholder="example.com" /></label><label className="field">对外端口（0 使用服务端口）<input type="number" min={0} max={65535} required value={network.publicPort} onChange={event => setNetwork({ ...network,publicPort:Number(event.target.value) })} /></label>
          </div>
          <label className="field">客户端 IP 白名单（每行一条，留空允许所有）<textarea rows={3} value={whitelist} onChange={event => setWhitelist(event.target.value)} placeholder="192.168.*.*" /></label>
          <Toggle label="记录访问日志" checked={network.serverAccessLog} onChange={value => setNetwork({ ...network,serverAccessLog:value })} />
          <div className="toolbar"><button className="primary" type="submit" disabled={busy}>{busy ? '应用中…' : '应用网络设置'}</button><button type="button" onClick={() => void readLogs()}>查看访问日志</button><button type="button" onClick={async () => { if (await confirmAction({ title:'清空访问日志',message:'清空已记录的访问日志？' })) { await getBridge('playlistAPI').clearAccessLogs(); setLogs([]); } }}>清空日志</button></div>
        </form>
        {logs.length > 0 && <div className="log-list">{logs.map((log,index) => <div key={index} className="row muted"><time>{log.time || log.ts || ''}</time><span>{log.ip}</span><span>{log.type || log.action}</span><span>{log.path || log.detail || ''}</span></div>)}</div>}
      </section>
    </div>
  </section>;
}
