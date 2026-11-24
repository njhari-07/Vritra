import React, { useEffect, useState } from 'react';
import './report-intake.css';

const timeFields = [['timestamp', 'Combined date and time'], ['date', 'Date'], ['time', 'Time']];
const fields = {
  'calls-document': [...timeFields, ['caller', 'Caller'], ['callee', 'Callee'], ['duration', 'Duration']],
  'wires-document': [...timeFields, ['from_bank', 'Sender bank'], ['from_account', 'Sender account'],
    ['to_bank', 'Receiver bank'], ['to_account', 'Receiver account'], ['amount', 'Amount'],
    ['currency', 'Currency'], ['received_amount', 'Receiving amount'], ['received_currency', 'Receiving currency'],
    ['reference', 'Reference']],
};

export function ReportSettings({ kind, disabled }) {
  return <>
    <div className="report-settings">
      <label>Report timezone (if missing)
        <input name="report_offset" placeholder="e.g. +05:30 or UTC" maxLength={6} disabled={disabled} />
      </label>
      <label>Numeric date order
        <select name="report_date_order" defaultValue="DMY" disabled={disabled}>
          <option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option>
        </select>
      </label>
      <label>First PDF page<input name="report_first" type="number" min="1" max="10000" placeholder="1" disabled={disabled} /></label>
      <label>Last PDF page<input name="report_last" type="number" min="1" max="10000" placeholder="End of report" disabled={disabled} /></label>
    </div>
    <details className="report-mapping">
      <summary>Adjust column mapping</summary>
      <p>Use column numbers from the left, starting at 1. Leave these blank to detect the headings automatically.</p>
      <div className="report-settings">
        {fields[kind].map(([key, label]) => <label key={key}>{label}
          <input name={'report_column_' + key} type="number" min="1" max="48" disabled={disabled} />
        </label>)}
      </div>
      <label>Column dividers for borderless tables (optional)
        <input name="report_dividers" maxLength={250} placeholder="e.g. 18, 43, 67" disabled={disabled} />
        <small>Enter divider positions as percentages from the left edge of the page.</small>
      </label>
    </details>
  </>;
}

export function ReportPreview({ preview, api, kind }) {
  const { caseId, file, pages, rows, accepted, rejected } = preview;
  const [page, setPage] = useState(pages[0].page);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const current = pages.find(item => item.page === page);
  const hasSkips = rejected > 0 || pages.some(item => item.issue);

  useEffect(() => {
    const abort = new AbortController();
    let url;
    setImage('');
    setError('');
    api(`/report-intake/${encodeURIComponent(caseId)}/source-page/${page}`, { method: 'POST', body: file, signal: abort.signal, raw: true })
      .then(response => response.blob())
      .then(blob => { if (!abort.signal.aborted) setImage(url = URL.createObjectURL(blob)); })
      .catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [api, caseId, file, page]);

  const pageRows = rows.filter(row => row.locator.page === page);
  const columns = fields[kind].filter(([field]) => pageRows.some(row => field in row.fields));

  return <section className="report-review" aria-label="Report review">
    <h3>Review extracted records</h3>
    <p>{accepted} valid · {rejected} rows need review · {pages.length} pages read</p>
    <label>Source page
      <select data-report-ui="true" value={page} onChange={event => setPage(Number(event.target.value))}>
        {pages.map(item => <option key={item.page} value={item.page}>Page {item.page} · {item.candidates} rows{item.issue ? ' · review' : ''}</option>)}
      </select>
    </label>
    {current.issue && <p className="error">{current.issue}</p>}
    <div className="report-side-by-side">
      <div className="report-original">
        {image ? <img src={image} alt={`Original report, page ${page}`} /> : <p role={error ? 'alert' : 'status'}>{error || 'Loading source page…'}</p>}
      </div>
      {pageRows.length > 0 && <div className="statement-preview-table" tabIndex={0} aria-label="Extracted report rows" role="region">
        <table><thead><tr><th scope="col">Source row</th>{columns.map(([key, title]) => <th scope="col" key={key}>{title}</th>)}
          <th scope="col">Saved time</th><th scope="col">Review</th></tr></thead>
          <tbody>{pageRows.map(row => <tr key={`${row.locator.table}/${row.locator.row}`}>
            <td>{row.locator.table}.{row.locator.row}</td>
            {columns.map(([key]) => <td key={key}>{row.fields[key] || '—'}</td>)}
            <td>{row.time_basis === 'date_only' ? row.event_time.slice(0, 10) + ' (date only)'
              : row.event_time?.replace('T', ' ').replace('+00:00', ' UTC') || '—'}</td>
            <td>{row.error || 'Ready'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
    {hasSkips && accepted > 0 && <label className="report-confirm">
      <input name="report_partial" type="checkbox" data-report-ui="true" />
      Save valid rows and retain the skipped pages and rows in Quality
    </label>}
  </section>;
}

export function SavedWireRows({ importId, api, onEvidence }) {
  const [opened, setOpened] = useState(false);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setResult(null);
    setError('');
    api(`/quality/${encodeURIComponent(importId)}/wire-report?offset=${offset}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [api, importId, offset, opened]);

  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Review saved transfers</summary>
    {opened && !result && <p role={error ? 'alert' : 'status'}>{error || 'Loading transfers…'}</p>}
    {result?.rows.map(row => <button className="source-button" key={row.id} type="button"
      onClick={() => onEvidence(row.id)}>
      Page {row.locator.page} · Row {row.locator.row} · {row.fields.amount} {row.fields.currency}
    </button>)}
    {result?.count > 25 && <div className="call-report-actions">
      <button className="quiet" type="button" disabled={!offset} onClick={() => setOffset(offset - 25)}>Previous</button>
      <button className="quiet" type="button" disabled={offset + 25 >= result.count} onClick={() => setOffset(offset + 25)}>Next</button>
    </div>}
  </details>;
}
