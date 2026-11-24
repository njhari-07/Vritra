import React, { useState } from 'react';

export default function StatementRowReview({ evidence, api }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const encrypted = evidence.source_locator.encrypted;
  const [storedHeaders, storedCells] = JSON.parse(evidence.passage);
  const headers = result?.headers ?? storedHeaders;
  const cells = result?.cells ?? storedCells;

  async function verify(event) {
    event.preventDefault();
    const form = event.currentTarget, body = new FormData(form);
    if (!body.has('password')) body.set('password', '');
    form.reset();
    setChecking(true);
    setError('');
    setResult(null);
    try {
      setResult(await api('/evidence/' + encodeURIComponent(evidence.id) + '/statement-row', {
        method: 'POST',
        body,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="statement-review">
      <h4>{result ? 'Row read from the original file' : 'Extracted statement row'}</h4>
      <dl className="statement-row-fields">
        {cells.map((cell, index) => (
          <div key={index}>
            <dt>{headers[index] || 'Column ' + (index + 1)}</dt>
            <dd>{cell || '—'}</dd>
          </div>
        ))}
      </dl>
      <form onSubmit={verify}>
        {encrypted && (
          <label>Original file password
            <input type="password" name="password" autoComplete="off" maxLength={1024} required />
          </label>
        )}
        <button type="submit" className="quiet" disabled={checking}>
          {checking ? 'Checking…' : 'Re-check original row'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result.matches_ingested
        ? 'The original row matches the stored evidence.'
        : 'The original row differs from the stored evidence.'}</p>}
    </div>
  );
}
