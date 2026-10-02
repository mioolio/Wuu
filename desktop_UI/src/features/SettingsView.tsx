import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { errorMessage, getBridge } from '../api';
import { defaultSettings, persistNow, useAppStore } from '../store';
import { confirmAction, notify } from '../ui';
import type { Settings } from '../types';
import AudioFxPanel from '../components/AudioFxPanel';
import { playerService } from '../services/player';
import Icon from '../components/Icon';
import './settings.css';

const categories = [
  { id: 'appearance', label: '外观', icon: 'disc', description: '界面版本、封面与颜色' },
  { id: 'playback', label: '播放', icon: 'play', description: '播放行为与音乐库' },
  { id: 'lyrics', label: '歌词', icon: 'lyrics', description: '阅读、滚动与桌面歌词' },
  { id: 'audio', label: '音效', icon: 'equalizer', description: '预设、均衡器与声音细节' },
  { id: 'network', label: '网络服务', icon: 'share', description: '歌单分享与手机访问' },
] as const;
type Category = typeof categories[number]['id'];

function Toggle({ label, description, checked, onChange, disabled = false }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="setting-row"><span><strong>{label}</strong>{description && <small className="muted">{description}</small>}</span><input className="switch" type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /></label>;
}
function Range({ label, value, min, max, step = 1, unit = '', disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className={`setting-row ${disabled ? 'setting-disabled' : ''}`}><span><strong>{label}</strong></span><span className="setting-range"><output>{Number(value.toFixed(2))}{unit}</output><input aria-label={label} aria-valuetext={`${Number(value.toFixed(2))}${unit}`} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} /></span></label>;
}
function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="settings-group"><header><h3>{title}</h3>{description && <p className="muted">{description}</p>}</header>{children}</section>;
}
function Advanced({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <details className="settings-advanced"><summary><span><strong>{title}</strong><small>{description}</small></span><Icon name="arrow" size={16} /></summary><div className="settings-advanced-content">{children}</div></details>;
}

export default function SettingsView() {
  const settings = useAppStore(state => state.settings);
  const setSettings = useAppStore(state => state.setSettings);
  const [category, setCategory] = useState<Category>('appearance');
  const [switching, setSwitching] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [network, setNetwork] = useState(settings);
  const [whitelist, setWhitelist] = useState(settings.serverWhitelist.join('\n'));
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const refresh = async () => {
    const result = await getBridge('playlistAPI').serverStatus(); setRunning(result.running === true);
  };
  useEffect(() => { void refresh().catch(error => notify(errorMessage(error), 'error')); }, [settings.serverEnabled, settings.mobileEnabled, settings.serverPort]);
  useEffect(() => {
    setNetwork(settings); setWhitelist(settings.serverWhitelist.join('\n'));
  }, [settings.serverPort, settings.serverBindIP, settings.serverWhitelist, settings.serverRateLimit, settings.serverAccessLog, settings.publicHostMode, settings.publicHost, settings.publicPort]);
  const selectCategory = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % categories.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + categories.length) % categories.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = categories.length - 1;
    else return;
    event.preventDefault(); setCategory(categories[next].id); tabRefs.current[next]?.focus();
  };
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
        const result = await api.startServer(next.serverPort, next.serverBindIP, next.serverWhitelist, next.serverRateLimit, next.serverAccessLog);
        if (!result.ok) throw new Error(result.message || '启动服务失败');
      } else { const stop = await api.stopServer(); if (!stop.ok) throw new Error(stop.message); }
      restore = false;
      setSettings(patch); setNetwork(next); if (!await persistNow()) throw new Error('网络设置已应用，但写入配置文件失败'); await refresh();
      notify('网络设置已应用', 'success');
    } catch (error) {
      if (restore) {
        try { await api.startServer(previous.serverPort, previous.serverBindIP, previous.serverWhitelist, previous.serverRateLimit, previous.serverAccessLog); } catch {}
      }
      notify(errorMessage(error), 'error'); await refresh().catch(() => {});
    }
    finally { setBusy(false); }
  };
  const readLogs = async () => {
    try { const result = await getBridge('playlistAPI').getAccessLogs(); if (!result.ok) throw new Error(result.message); setLogs(result.logs || []); setLogsLoaded(true); }
    catch (error) { notify(errorMessage(error), 'error'); }
  };
  const activeCategory = categories.find(item => item.id === category)!;
  const switchToClassic = async () => {
    if (switching) return;
    setSwitching(true);
    const playing = useAppStore.getState().player.playing;
    try {
      playerService.prepareInterfaceSwitch();
      setSettings({ interfaceMode: 'classic' });
      if (!await persistNow()) throw new Error('界面偏好保存失败');
      const result = await getBridge('windowAPI').switchInterface('classic', { playing });
      if (!result?.ok) throw new Error(result?.message || '旧版界面加载失败');
    } catch (error) { setSettings({ interfaceMode: 'modern' }); await persistNow(); setSwitching(false); notify(errorMessage(error),'error'); }
  };
  return <section className="panel settings-page">
    <header className="page-header settings-header"><div><h1>设置</h1><p className="muted">按你的习惯，调整每一次聆听。</p></div><button onClick={async () => { if (await confirmAction({ title: '恢复默认设置', message: '恢复播放、外观和歌词设置？歌单、歌曲与播放统计会保留。' })) { const { serverEnabled, mobileEnabled, serverPort, serverBindIP, serverWhitelist, serverRateLimit, serverAccessLog, publicHost, publicHostMode, publicPort } = settings; setSettings({ ...defaultSettings, serverEnabled, mobileEnabled, serverPort, serverBindIP, serverWhitelist, serverRateLimit, serverAccessLog, publicHost, publicHostMode, publicPort }); notify('已恢复默认设置', 'success'); } }}>恢复默认</button></header>
    <div className="settings-layout">
      <div className="settings-navigation" role="tablist" aria-label="设置分类" aria-orientation="vertical">
        {categories.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} ref={element => { tabRefs.current[index] = element; }} role="tab" type="button" aria-selected={category === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={category === item.id ? 0 : -1} onClick={() => setCategory(item.id)} onKeyDown={event => selectCategory(event, index)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </div>
      <div className="settings-content">
        <header className="settings-category-header"><div className="settings-location"><span>设置</span><span aria-hidden="true">/</span><span>{activeCategory.label}</span></div><h2>{activeCategory.label}</h2><p className="muted">{activeCategory.description}</p></header>
        <div id="settings-panel-appearance" className="settings-category" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={category !== 'appearance'}>
          <Group title="界面版本" description="歌曲、歌单与播放记录共用，切换后恢复本地歌曲进度。">
            <div className="setting-row"><span><strong>当前使用新版界面</strong><small className="muted">旧版使用原来的导航、播放器和歌词界面，可随时返回新版。</small></span><button disabled={switching} onClick={() => void switchToClassic()}>{switching ? '正在切换…' : '切换到旧版界面'}</button></div>
          </Group>
          <Group title="封面与背景">
            <Toggle label="圆盘封面" description="在播放页面使用唱片样式" checked={settings.discCover} onChange={value => setSettings({ discCover: value })} />
            <Toggle label="全局背景跟随封面" description="让整个界面随当前歌曲封面变色" checked={settings.themeFollowCover} onChange={value => setSettings({ themeFollowCover: value })} />
            <Range label="界面透明度" value={settings.glassOpacity * 100} min={12} max={100} unit="% 不透明" onChange={value => setSettings({ glassOpacity: value / 100 })} />
            <Advanced title="背景细节" description="调整封面颜色在背景中的强度">
              <Range label="封面背景强度" value={settings.colorIntensity} min={0} max={1} step={0.01} onChange={value => setSettings({ colorIntensity: value })} />
            </Advanced>
          </Group>
          <Group title="侧栏">
            <Toggle label="收起侧栏" description="仅显示图标，给歌曲和歌词留出更多空间" checked={settings.sidebarCollapsed} onChange={value => setSettings({ sidebarCollapsed: value })} />
            <Range label="展开后的侧栏宽度" value={settings.sidebarWidth} min={152} max={260} unit=" px" onChange={value => setSettings({ sidebarWidth: value })} />
          </Group>
          <Group title="播放进度颜色">
            <Toggle label="自定义进度条颜色" description="关闭时使用当前封面的颜色" checked={settings.progressColorEnabled} onChange={value => setSettings({ progressColorEnabled: value })} />
            {settings.progressColorEnabled && <div className="settings-color-fields"><label>起始颜色<input type="color" value={settings.progressColor} onChange={event => setSettings({ progressColor: event.target.value })} /></label><label>结束颜色<input type="color" value={settings.progressColor2} onChange={event => setSettings({ progressColor2: event.target.value })} /></label></div>}
          </Group>
        </div>
        <div id="settings-panel-playback" className="settings-category" role="tabpanel" aria-labelledby="settings-tab-playback" hidden={category !== 'playback'}>
          <Group title="播放行为">
            <Toggle label="暂停时淡出音量" description="暂停前平滑降低音量" checked={settings.fadePause} onChange={value => setSettings({ fadePause: value })} />
            <Toggle label="显示播放队列按钮" description="在播放器中快速查看接下来播放的歌曲" checked={settings.showFloatListBtn} onChange={value => setSettings({ showFloatListBtn: value })} />
          </Group>
          <Group title="音乐库与换源">
            <label className="setting-row"><span><strong>歌手分组方式</strong><small className="muted">决定合作作品在音乐库中的归属</small></span><select aria-label="歌手分组方式" value={settings.artistGroupMode} onChange={event => setSettings({ artistGroupMode: event.target.value })}><option value="bucket">保留合作歌手组合</option><option value="split">拆分为各个歌手</option></select></label>
            <Toggle label="换源时保留封面" description="切换音源后继续使用原有封面" checked={settings.coverUnify} onChange={value => setSettings({ coverUnify: value })} />
          </Group>
        </div>
        <div id="settings-panel-lyrics" className="settings-category" role="tabpanel" aria-labelledby="settings-tab-lyrics" hidden={category !== 'lyrics'}>
          <Group title="歌词阅读" description="唱到当前一句时放大，唱完立即恢复普通字号。">
            <Range label="当前歌词字号" value={settings.currentLyricSize} min={settings.lyricSize} max={60} unit=" px" onChange={value => setSettings({ currentLyricSize: value })} />
            <Advanced title="普通歌词字号" description="已唱、未唱与未同步歌词使用此字号">
              <Range label="普通歌词字号" value={settings.lyricSize} min={12} max={36} unit=" px" onChange={value => setSettings({ lyricSize: value })} />
            </Advanced>
            <Toggle label="普通歌词模拟逐字进度" description="为没有逐字时间的歌词添加播放进度" checked={settings.simulateLrcProgress} onChange={value => setSettings({ simulateLrcProgress: value })} />
            <Advanced title="歌词亮度" description="未唱亮度用于桌面歌词窗口；播放页未唱歌词保持白色">
              <Range label="已唱歌词亮度" value={settings.lyricDone} min={0.3} max={1} step={0.01} onChange={value => setSettings({ lyricDone: value, lyricWait: Math.min(settings.lyricWait, value - 0.1) })} />
              <Range label="未唱歌词亮度" value={settings.lyricWait} min={0.1} max={Math.max(0.1, settings.lyricDone - 0.1)} step={0.01} onChange={value => setSettings({ lyricWait: value })} />
            </Advanced>
          </Group>
          <Group title="桌面歌词滚动" description="独立歌词窗口的滚动行为；播放页长句完整换行">
            <Toggle label="长歌词滚动" description="桌面歌词超出可见宽度时自动横向滚动" checked={settings.marqueeEnabled} onChange={value => setSettings({ marqueeEnabled: value })} />
            <Advanced title="滚动细节" description="速度、触发长度与两端停留">
              <Range label="滚动速度" value={settings.marqueeSpeed} min={30} max={150} unit=" px/s" disabled={!settings.marqueeEnabled} onChange={value => setSettings({ marqueeSpeed: value })} />
              <Range label="滚动触发阈值" value={settings.marqueeThreshold} min={0.8} max={2} step={0.1} unit=" 倍" disabled={!settings.marqueeEnabled} onChange={value => setSettings({ marqueeThreshold: value })} />
              <Range label="两端停留时间" value={settings.marqueePause} min={0.5} max={5} step={0.1} unit=" 秒" disabled={!settings.marqueeEnabled} onChange={value => setSettings({ marqueePause: value })} />
            </Advanced>
          </Group>
          <Group title="桌面歌词">
            <Toggle label="启动时打开桌面歌词" checked={settings.desktopLyricPersist} onChange={value => setSettings({ desktopLyricPersist: value })} />
            <div className="setting-row"><span><strong>桌面歌词位置</strong><small className="muted">将歌词窗口放回默认位置</small></span><button onClick={() => { setSettings({ desktopLyricBounds: null }); void getBridge('desktopLyric').setPosition(null).then(() => notify('桌面歌词位置已重置', 'success')).catch((error: unknown) => notify(errorMessage(error), 'error')); }}>重置位置</button></div>
          </Group>
        </div>
        <div id="settings-panel-audio" className="settings-category" role="tabpanel" aria-labelledby="settings-tab-audio" hidden={category !== 'audio'}>
          <Group title="均衡器与预设" description="选择适合当前音乐的音效，或保存自己的声音方案。"><AudioFxPanel /></Group>
        </div>
        <div id="settings-panel-network" className="settings-category" role="tabpanel" aria-labelledby="settings-tab-network" hidden={category !== 'network'}>
          <Group title="服务开关">
            <div className="settings-server-status"><span className={`badge ${running ? 'success' : ''}`} role="status">{running ? '运行中' : '已停止'}</span>{running && <span className="muted">本机地址：http://127.0.0.1:{settings.serverPort}/mobile/</span>}</div>
            <Toggle label="歌单分享服务" checked={settings.serverEnabled} disabled={busy} onChange={value => void applyNetwork({ serverEnabled: value }, false)} />
            <Toggle label="手机版服务" description="通过手机浏览器访问此电脑的局域网 IP，使用移动端播放器" checked={settings.mobileEnabled} disabled={busy} onChange={value => void applyNetwork({ mobileEnabled: value }, false)} />
          </Group>
          <form onSubmit={event => { event.preventDefault(); if (!Number.isInteger(network.serverPort) || network.serverPort < 1 || network.serverPort > 65535) { notify('端口范围为 1–65535', 'error'); return; } void applyNetwork({ serverPort: network.serverPort, serverBindIP: network.serverBindIP.trim() || '0.0.0.0', serverWhitelist: whitelist.split('\n').map(line => line.trim()).filter(Boolean), serverRateLimit: network.serverRateLimit, serverAccessLog: network.serverAccessLog, publicHostMode: network.publicHostMode, publicHost: network.publicHost.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, ''), publicPort: network.publicPort }); }}>
            <Group title="连接与分享地址" description="修改网络参数后，点击「应用网络设置」生效。">
              <div className="settings-form-grid"><label className="field">服务端口<input type="number" min={1} max={65535} required value={network.serverPort} onChange={event => setNetwork({ ...network, serverPort: Number(event.target.value) })} /></label><label className="field">分享地址<select value={network.publicHostMode} onChange={event => setNetwork({ ...network, publicHostMode: event.target.value })}><option value="auto">自动获取本机地址</option><option value="manual">手动指定公网地址</option></select></label></div>
              {network.publicHostMode === 'manual' && <div className="settings-form-grid"><label className="field">对外 IP / 域名<input value={network.publicHost} onChange={event => setNetwork({ ...network, publicHost: event.target.value })} placeholder="example.com" /></label><label className="field">对外端口（0 使用服务端口）<input type="number" min={0} max={65535} required value={network.publicPort} onChange={event => setNetwork({ ...network, publicPort: Number(event.target.value) })} /></label></div>}
              <Advanced title="访问控制" description="绑定 IP、请求上限、白名单与日志">
                <div className="settings-form-grid"><label className="field">绑定 IP<input value={network.serverBindIP} onChange={event => setNetwork({ ...network, serverBindIP: event.target.value })} /></label><label className="field">每分钟请求上限（0 为不限）<input type="number" min={0} max={10000} required value={network.serverRateLimit} onChange={event => setNetwork({ ...network, serverRateLimit: Number(event.target.value) })} /></label></div>
                <label className="field">客户端 IP 白名单<small className="muted">每行一条，留空允许所有客户端</small><textarea rows={3} value={whitelist} onChange={event => setWhitelist(event.target.value)} placeholder="192.168.*.*" /></label>
                <Toggle label="记录访问日志" checked={network.serverAccessLog} onChange={value => setNetwork({ ...network, serverAccessLog: value })} />
              </Advanced>
              <div className="settings-network-actions"><button className="primary" type="submit" disabled={busy}>{busy ? '应用中…' : '应用网络设置'}</button></div>
            </Group>
          </form>
          <Group title="服务记录">
            <Advanced title="访问日志" description="查看与清理已记录的访问">
              <div className="toolbar"><button type="button" onClick={() => void readLogs()}>查看访问日志</button><button type="button" onClick={async () => { if (await confirmAction({ title: '清空访问日志', message: '清空已记录的访问日志？' })) { try { await getBridge('playlistAPI').clearAccessLogs(); setLogs([]); setLogsLoaded(true); } catch (error) { notify(errorMessage(error), 'error'); } } }}>清空日志</button></div>
              {logsLoaded && logs.length === 0 && <p className="muted" role="status">暂无访问日志</p>}
              {logs.length > 0 && <div className="log-list">{logs.map((log, index) => <div key={index} className="row muted"><time>{log.time || log.ts || ''}</time><span>{log.ip}</span><span>{log.type || log.action}</span><span>{log.path || log.detail || ''}</span></div>)}</div>}
            </Advanced>
          </Group>
        </div>
        {category !== 'network' && <p className="settings-save-hint muted">更改会自动保存</p>}
      </div>
    </div>
  </section>;
}
