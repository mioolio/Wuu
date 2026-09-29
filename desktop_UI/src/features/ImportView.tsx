import { useState } from 'react';
import LinkParser from './online/LinkParser';
import PlatformImporter from './online/PlatformImporter';
import { platforms, type Platform } from './online/common';
import './online/online.css';

export default function ImportView() {
  const [platform, setPlatform] = useState<Platform | 'links'>('qishui');
  const [visited, setVisited] = useState<Set<Platform | 'links'>>(new Set(['qishui']));
  const activate = (value: Platform | 'links') => { setPlatform(value); setVisited(items => new Set([...items, value])); };
  return <div className="panel online-area"><div className="page-header"><div><h1>导入音乐</h1><p className="muted">从平台账号、歌单或分享链接，将音乐添加到本地歌库。</p></div></div>
    <div className="toolbar">{(Object.keys(platforms) as Platform[]).map(value => <button className={`button ${platform === value ? 'primary' : ''}`} key={value} onClick={() => activate(value)}>{platforms[value].name}</button>)}<button className={`button ${platform === 'links' ? 'primary' : ''}`} onClick={() => activate('links')}>链接 / JSON 解析</button></div>
    {[...visited].map(value => <div key={value} hidden={platform !== value}>{value === 'links' ? <LinkParser /> : <PlatformImporter platform={value} />}</div>)}
  </div>;
}
