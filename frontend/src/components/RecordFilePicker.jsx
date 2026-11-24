import React, { useId, useRef, useState } from 'react';
import { IntakeIcon } from './RecordIntakeModes';

export default function RecordFilePicker({ accept, label, name, required, disabled, onPick, onClear }) {
  const input = useRef(null);
  const hint = useId();
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');

  function changeFile(event) {
    const file = event.currentTarget.files[0];
    setFileName(file?.name ?? '');
    if (file) onPick?.(file);
  }

  function clearFile() {
    input.current.value = '';
    input.current.focus();
    setFileName('');
    onClear?.();
  }

  return (
    <div className="tw:min-w-0">
      <label className="record-dropzone tw:relative tw:grid tw:min-w-0 tw:justify-items-center tw:gap-2 tw:text-center"
        data-dragging={dragging}
        onDragEnter={event => {
          if (event.dataTransfer.types.includes('Files')) setDragging(true);
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
        }}
        onDrop={() => setDragging(false)}>
        <span className="record-upload-mark"><IntakeIcon type="upload" /></span>
        <strong>{dragging ? 'Release to select' : label}</strong>
        <span id={hint} className="record-upload-hint">
          {name ? 'Browse or drop one file · Up to 25 MiB' : 'Browse or drop one file'}
        </span>
        <input ref={input} type="file" accept={accept} name={name} required={required} disabled={disabled}
          aria-label={label} aria-describedby={hint} onChange={changeFile} />
      </label>
      {fileName && (
        <div className="record-file-selection tw:mt-2 tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2">
          <span className="tw:min-w-0 tw:truncate" title={fileName} role="status">{fileName}</span>
          {name && <button type="button" className="record-secondary" onClick={clearFile} disabled={disabled}>Remove</button>}
        </div>
      )}
    </div>
  );
}
