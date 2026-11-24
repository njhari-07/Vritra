import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import StatementPageCoverage from './StatementPageCoverage';

const PAGE_SIZE = 25;
const display = value => value?.trim() && !/^[-–—]$/.test(value.trim()) ? value : '—';

function StatementTable({ rows, onEvidence }) {
  return (
    <div className="statement-preview-table statement-ledger-table" role="region"
      aria-label={onEvidence ? 'Accepted statement transactions' : 'Saved statement preview'} tabIndex={0}>
      <table>
        <thead><tr>
          <th scope="col">Source</th><th scope="col">Posting / transaction date</th><th scope="col">Value date</th>
          <th scope="col">Details</th><th scope="col">Reference</th><th scope="col">Debit</th>
          <th scope="col">Credit</th><th scope="col">Balance</th><th scope="col">{onEvidence ? 'Evidence' : 'Validation'}</th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const { locator, fields, normalized, evidence_id } = row;
          const source = locator.sheet || `Page ${locator.page}`;
          return <tr key={evidence_id || row.candidate_id || locator.row}>
            <td>{source}<small>Row {locator.row}</small></td>
            <td>{display(fields.post_date || fields.date || row.event_time?.slice(0, 10))}</td>
            <td>{display(fields.value_date)}</td>
            <td>{display(fields.narration)}</td>
            <td>{display(fields.reference)}</td>
            <td className="statement-ledger-amount">{display(normalized?.debit || fields.debit)}</td>
            <td className="statement-ledger-amount">{display(normalized?.credit || fields.credit)}</td>
            <td className="statement-ledger-amount">{display(fields.balance)}</td>
            <td>
              {onEvidence ? (
                <Button variant="outline" size="sm" onClick={() => onEvidence(evidence_id, `${source} · row ${locator.row}`)}>
                  Open row
                </Button>
              ) : row.error || row.balance_check}
              {row.corrected && <small>Reviewed correction</small>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function StatementPageRecovery({ batchId, initialPage, encrypted, api, onRecovered }) {
  const [page, setPage] = useState(String(initialPage));
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function recover(event) {
    event.preventDefault();
    if (pending) return;
    const importing = event.nativeEvent.submitter?.value === 'import';
    if (importing && (!preview?.accepted || preview.page_range?.[0] !== Number(page))) return;
    const form = event.currentTarget;
    const body = new FormData();
    body.set('password', form.elements.password?.value || '');
    if (form.elements.password) form.elements.password.value = '';
    setPending(true);
    setError('');
    setNotice('');
    if (!importing) setPreview(null);
    try {
      const result = await api(`/quality/${encodeURIComponent(batchId)}/statement-page?page=${encodeURIComponent(page)}&preview=${!importing}`, {
        method: 'POST', body,
      });
      if (importing) {
        setPreview(null);
        setNotice(`Page ${page} · ${result.accepted_new} accepted · ${result.recognized_repeat} repeats · ${result.quarantined} quarantined`);
        onRecovered?.();
      } else {
        setPreview(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="statement-page-coverage">
      <summary>Recover another page from this statement</summary>
      <form className="statement-recovery-form" onSubmit={recover}>
        <label>Source page
          <input type="number" min="1" max="10000" required value={page} disabled={pending}
            onChange={event => { setPage(event.target.value); setPreview(null); setNotice(''); setError(''); }} />
        </label>
        {encrypted && <label>Original file password
          <input name="password" type="password" autoComplete="off" maxLength={1024} required disabled={pending} />
        </label>}
        <div className="statement-ledger-paging">
          <Button type="submit" value="preview" variant="outline" size="sm" disabled={pending}>Preview saved page</Button>
          {preview?.accepted > 0 && (
            <Button type="submit" value="import" size="sm" disabled={pending}>Import previewed page</Button>
          )}
        </div>
      </form>
      {pending && <p role="status">Reading page {page}…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {preview && <>
        <p role="status">{preview.accepted} valid · {preview.rejected} rejected · Showing {preview.rows.length} candidates</p>
        <StatementPageCoverage pages={preview.page_coverage} pageRange={preview.page_range} />
        {preview.recovered_layout_rows > 0 && <p>A second reader recovered {preview.recovered_layout_rows} {preview.recovered_layout_rows === 1 ? 'row' : 'rows'}.</p>}
        {preview.rows.length > 0 && <StatementTable rows={preview.rows} />}
        {encrypted && preview.accepted > 0 && <p>Re-enter the original password to import this page.</p>}
      </>}
    </details>
  );
}

export default function StatementImportRows({ batch, api, onEvidence, onRecovered }) {
  const [result, setResult] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { currency } = batch.summary.statement_settings;
  const source = result?.rows[0]?.locator;
  const recoverable = ['pdf', 'tiff'].includes(source?.format);

  async function readRows(from) {
    setLoading(true);
    setError('');
    try {
      setResult(await api(`/quality/${encodeURIComponent(batch.id)}/statement-rows?offset=${from}`));
      setOffset(from);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="statement-import-review" onToggle={event => {
      if (event.currentTarget.open && !result && !loading && !error) readRows(0);
    }}>
      <summary>Bank statement · {currency} · Review transactions</summary>
      {loading && <p role="status">Loading statement rows…</p>}
      {error && <div role="alert" className="error">
        {error} <Button variant="outline" size="sm" onClick={() => readRows(offset)}>Retry</Button>
      </div>}
      {result && <>
        {result.pages.length > 0 && (
          <div className="statement-coverage" aria-label="Accepted transactions by source page">
            {result.pages.map(({ page, count }) => (
              <span key={page}>Page {page} · {count} {count === 1 ? 'transaction' : 'transactions'}</span>
            ))}
          </div>
        )}
        {result.scope?.requested && (
          <p>{result.scope.requested[0] === result.scope.requested[1]
            ? `Selected page ${result.scope.requested[0]}.`
            : `Selected pages ${result.scope.requested.join('–')}.`}</p>
        )}
        {result.pages[0]?.page > 1 && <p>Page 1 has no newly accepted transactions in this batch.</p>}
        <StatementPageCoverage pages={result.scope?.coverage} pageRange={result.scope?.requested} />
        {recoverable && (
          <StatementPageRecovery batchId={batch.id} initialPage={result.next_page || 1} encrypted={source.encrypted}
            api={api} onRecovered={onRecovered} />
        )}
        {result.repeats > 0 && <p>{result.repeats} rows already appear in earlier imports.</p>}
        {result.rows.length > 0 ? <StatementTable rows={result.rows} onEvidence={onEvidence} />
          : <p>No new transactions were recorded in this batch.</p>}
        {result.accepted > PAGE_SIZE && (
          <div className="statement-ledger-paging">
            <span>{offset + 1}–{offset + result.rows.length} of {result.accepted} accepted rows</span>
            <Button variant="outline" size="sm" disabled={loading || !offset} onClick={() => readRows(offset - PAGE_SIZE)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={loading || offset + PAGE_SIZE >= result.accepted} onClick={() => readRows(offset + PAGE_SIZE)}>Next</Button>
          </div>
        )}
      </>}
    </details>
  );
}
