import Icon from './Icon';

type WindowAction = 'close' | 'minimize' | 'toggleMaximize';
interface Props {
  appleStyle: boolean;
  position: 'left' | 'right';
  maximized: boolean;
  onControl: (action: WindowAction) => void;
}

export default function WindowControls({ appleStyle, position, maximized, onControl }: Props) {
  const actions: WindowAction[] = appleStyle && position === 'left' ? ['close', 'minimize', 'toggleMaximize'] : ['minimize', 'toggleMaximize', 'close'];
  return <div className="window-controls" role="group" aria-label="窗口控制">
    {actions.map(action => {
      const label = action === 'close' ? '关闭窗口' : action === 'minimize' ? '最小化' : maximized ? '还原窗口' : '最大化';
      const name = action === 'toggleMaximize' ? 'maximize' : action;
      return <button key={action} type="button" className={`window-${name}`} aria-label={label} title={label} onClick={() => onControl(action)}>
        {appleStyle && action === 'toggleMaximize' ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={maximized ? 'M3 7h4V3M7 7L3 3M13 9H9v4M9 9l4 4' : 'M7 3H3v4M3 3l5 5M9 13h4V9m0 4-5-5'} />
        </svg> : <Icon name={name} size={appleStyle ? 10 : action === 'toggleMaximize' ? 15 : 16} />}
      </button>;
    })}
  </div>;
}
