import React, { useId, useState } from 'react';

const modes = [
  { id: 'paste', label: 'Paste text', icon: 'text' },
  { id: 'upload', label: 'Upload file', icon: 'upload' }
];

export function IntakeIcon({ type }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {type === 'text'
        ? <path d="M8 7h8M8 11h8m-8 4h5M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
        : <path d="M12 15V4m-4 4 4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />}
    </svg>
  );
}

export default function RecordIntakeModes({ children }) {
  const [active, setActive] = useState(0);
  const id = useId();

  function moveFocus(event, index) {
    const { key, currentTarget } = event;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const last = modes.length - 1;
    const next = key === 'Home' ? 0 : key === 'End' ? last
      : (index + (key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length;
    setActive(next);
    currentTarget.parentElement.children[next].focus();
  }

  return (
    <div className="record-mode-picker tw:min-w-0">
      <div className="record-tabs tw:grid tw:grid-cols-2 tw:gap-1 tw:p-1" role="tablist" aria-label="Import method">
        {modes.map((mode, index) => (
          <button key={mode.id} id={id + '-tab-' + mode.id} type="button" role="tab"
            className="record-tab tw:motion-safe:transition-colors"
            aria-controls={id + '-panel-' + mode.id} aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)} onKeyDown={event => moveFocus(event, index)}>
            <IntakeIcon type={mode.icon} />
            {mode.label}
          </button>
        ))}
      </div>
      {modes.map((mode, index) => (
        <div key={mode.id} id={id + '-panel-' + mode.id} role="tabpanel"
          aria-labelledby={id + '-tab-' + mode.id} hidden={index !== active}>
          {children[index]}
        </div>
      ))}
    </div>
  );
}
