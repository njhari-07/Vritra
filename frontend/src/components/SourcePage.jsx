import React, { useEffect, useState } from 'react';

export default function SourcePage({ evidence, token }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let preview;
    fetch('/api/evidence/' + encodeURIComponent(evidence.id) + '/source-page', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal
    }).then(async response => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.detail || 'Source page unavailable.');
      }
      const image = await response.blob();
      if (controller.signal.aborted) return;
      preview = URL.createObjectURL(image);
      setUrl(preview);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => {
      controller.abort();
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [open, evidence.id, token]);

  return (
    <div>
      <button className="quiet" aria-expanded={open} onClick={() => {
        setUrl(null);
        setError('');
        setOpen(value => !value);
      }}>{open ? 'Hide source page' : 'View source page'}</button>
      {open && (error ? <p role="alert">{error}</p> : url
        ? <img className="source-page-preview" src={url} alt={`Original page ${evidence.source_locator.page}`} />
        : <p role="status">Rendering source page…</p>)}
    </div>
  );
}
