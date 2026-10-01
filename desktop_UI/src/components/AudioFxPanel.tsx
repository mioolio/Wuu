import { useState } from 'react';
import { useAppStore } from '../store';
import { notify } from '../ui';
import { configToCustom, DEFAULT_FX_PARAMS, EQ_FREQUENCIES, FX_PARAMETERS, FX_PRESETS, normalizeFxSettings, resolveFxConfig, type FxParams, type FxSettings } from '../services/audioFx';
import Icon from './Icon';

export default function AudioFxPanel({ onClose }: { onClose?: () => void }) {
  const saved = useAppStore(state => state.settings.audioFx);
  const settings = normalizeFxSettings(saved);
  const config = resolveFxConfig(settings);
  const [name, setName] = useState('');
  const [band, setBand] = useState(0);
  const save = (next: FxSettings) => useAppStore.getState().setSettings({ audioFx: next });
  const edit = (mutate: (draft: FxSettings) => void) => {
    const base = configToCustom(config);
    const next = { ...settings, ...base, preset: 'custom' };
    mutate(next); save(next);
  };
  const storePreset = () => {
    const custom = { ...configToCustom(config), name: name.trim() || `方案 ${settings.customs.length + 1}` };
    const next = { ...settings, customs: [...settings.customs, custom], preset: `custom:${settings.customs.length}` };
    save(next); setName(''); notify(`音效方案「${custom.name}」已保存`, 'success');
  };
  const deletePreset = (index: number) => {
    const current = settings.preset.startsWith('custom:') ? Number(settings.preset.slice(7)) : -1;
    save({ ...settings, customs: settings.customs.filter((_, i) => i !== index), preset: current === index ? 'off' : current > index ? `custom:${current - 1}` : settings.preset });
  };
  const frequencies = config.eqFreqs || EQ_FREQUENCIES;
  const qs = config.eqQs || EQ_FREQUENCIES.map(() => 1.1);
  return <div className="audio-fx-panel panel">
    <header className="page-header"><div><h2>音效与均衡器</h2><p className="muted">{config.name || '自定义'} · 10 段均衡器</p></div>{onClose && <button className="icon-button" aria-label="关闭音效" onClick={onClose}><Icon name="close" size={18} /></button>}</header>
    <div className="toolbar fx-presets" role="group" aria-label="音效预设">{Object.entries(FX_PRESETS).map(([key, preset]) => <button key={key} className={`button ${settings.preset === key ? 'active' : ''}`} aria-pressed={settings.preset === key} onClick={() => save({ ...settings, preset: key })}>{preset.name}</button>)}<button className={`button ${settings.preset === 'custom' ? 'active' : ''}`} aria-pressed={settings.preset === 'custom'} onClick={() => save({ ...settings, ...configToCustom(config), preset: 'custom' })}>自定义</button></div>
    {!!settings.customs.length && <div className="toolbar" role="group" aria-label="已保存的音效方案">{settings.customs.map((custom, index) => <span className="row" key={`${index}:${custom.name}`}><button className={`button ${settings.preset === `custom:${index}` ? 'active' : ''}`} aria-pressed={settings.preset === `custom:${index}`} onClick={() => save({ ...settings, preset: `custom:${index}` })}>{custom.name}</button><button className="icon-button danger" aria-label={`删除音效方案 ${custom.name}`} onClick={() => deletePreset(index)}><Icon name="close" size={16} /></button></span>)}</div>}
    <div className="fx-equalizer" style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 8 }}>
      {config.eq.map((value, index) => <label className={`fx-band ${band === index ? 'selected' : ''}`} key={index} onClick={() => setBand(index)} onFocus={() => setBand(index)}>
        <output>{value > 0 ? '+' : ''}{value.toFixed(1)} dB</output>
        <input aria-label={`均衡器频段 ${index + 1} 增益`} aria-valuetext={`${value > 0 ? '+' : ''}${value.toFixed(1)} dB`} type="range" min={-12} max={12} step={0.5} value={value} style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 120, width: 22 }} onChange={event => { setBand(index); edit(draft => { draft.eq[index] = Number(event.target.value); }); }} />
        <span>{frequencies[index] >= 1000 ? `${(frequencies[index] / 1000).toFixed(1)}k` : frequencies[index]} Hz</span>
      </label>)}
    </div>
    <div className="card fx-band-detail"><strong>频段 {band + 1}</strong><label className="field">中心频率 <output>{Math.round(frequencies[band])} Hz</output><input aria-label="均衡器中心频率" type="range" min={20} max={20000} step={1} value={frequencies[band]} onChange={event => edit(draft => { draft.eqFreqs[band] = Number(event.target.value); })} /></label><label className="field">Q 值 <output>{qs[band].toFixed(2)}</output><input aria-label="均衡器 Q 值" type="range" min={0.1} max={6} step={0.05} value={qs[band]} onChange={event => edit(draft => { draft.eqQs[band] = Number(event.target.value); })} /></label></div>
    <div className="fx-parameters">{FX_PARAMETERS.map(def => <label className="field" key={def.key}>{def.name}<output>{config[def.key].toFixed(def.step < 1 ? 2 : 0)} {def.unit}</output><input aria-label={def.name} type="range" min={def.min} max={def.max} step={def.step} value={config[def.key]} onChange={event => edit(draft => { draft.params[def.key as keyof FxParams] = Number(event.target.value); })} /></label>)}</div>
    <div className="toolbar"><input aria-label="音效方案名称" placeholder="保存当前音效方案…" maxLength={60} value={name} onChange={event => setName(event.target.value)} /><button className="button primary" onClick={storePreset}>保存方案</button><button className="button" onClick={() => save({ ...settings, preset: 'custom', eq: EQ_FREQUENCIES.map(() => 0), eqFreqs: [...EQ_FREQUENCIES], eqQs: EQ_FREQUENCIES.map(() => 1.1), params: { ...DEFAULT_FX_PARAMS } })}>重置</button></div>
  </div>;
}
