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
      {evidence.source_locator.layout?.includes('balance-verified') && (
        <p>Column mapping was inferred from matching running balances.</p>
      )}
      {evidence.source_locator.header_page && (
        <p>Column headings read from page {evidence.source_locator.header_page}.</p>
      )}
      {evidence.source_locator.recovered_layout && (
        <p>A second reader recovered this row after matching another transaction on the same page.</p>
      )}
      <dl className="statement-row-fields">
        {cells.map((cell, index) => (
          <div key={index}>
            <dt>{headers[index] || 'Column ' + (index + 1)}</dt>
            <dd>{cell || '—'}</dd>
          </div>
        ))}
      </dl>
      {evidence.statement_correction && (
        <section>
          <h4>Reviewer corrections</h4>
          <dl className="statement-row-fields">
            {Object.entries(evidence.statement_correction.fields).map(([field, values]) => (
              <div key={field}><dt>{field}</dt><dd>{values.extracted || '—'} → {values.corrected || '—'}</dd></div>
            ))}
          </dl>
          <p>{evidence.statement_correction.actor} · {new Date(evidence.statement_correction.at).toLocaleString()}</p>
        </section>
      )}
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
