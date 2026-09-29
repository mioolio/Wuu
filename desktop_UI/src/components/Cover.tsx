import { useEffect, useState } from 'react';
import { mediaUrl } from '../api';
import Icon from './Icon';
export default function Cover({ path, className = '' }: { path?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  return <span className={`cover-thumb ${className}`}>{path && !failed ? <img src={mediaUrl(path)} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Icon name="music" />}</span>;
}
