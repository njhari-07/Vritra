import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import StatementPageCoverage from './StatementPageCoverage';
import StatementReconciliation from './StatementReconciliation';

const PAGE_SIZE = 25;
const display = value => value?.trim() && !/^[-–—]$/.test(value.trim()) ? value : '—';
export const PAYMENT_COLUMNS = [['time', 'Printed time'], ['bank', 'Bank'], ['account', 'Account'],
  ['sender', 'Sender'], ['receiver', 'Receiver'], ['payment_type', 'Pay / Collect'], ['status', 'Payment status']];

function StatementTable({ rows, onEvidence }) {
  const paymentColumns = PAYMENT_COLUMNS.filter(([key]) => rows.some(row => key in row.fields));
  return (
    <div className="statement-preview-table statement-ledger-table" role="region"
      aria-label={onEvidence ? 'Accepted statement transactions' : 'Saved statement preview'} tabIndex={0}>
      <table>
        <thead><tr>
          <th scope="col">Source</th><th scope="col">Posting / transaction date</th><th scope="col">Value date</th>
          <th scope="col">Details</th><th scope="col">Reference</th>
          {paymentColumns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}
          <th scope="col">Debit</th>
          <th scope="col">Credit</th><th scope="col">Balance</th><th scope="col">{onEvidence ? 'Evidence' : 'Validation'}</th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const { locator, fields, normalized, evidence_id } = row;
          const source = locator.sheet || `Page ${locator.page}`;
          return <tr key={evidence_id || row.candidate_id || locator.row}>
            <td>{source}<small>Row {locator.row}</small>
              {locator.continuation && <small>Continued on page {locator.continuation.page}</small>}
            </td>
            <td>{display(fields.post_date || fields.date || row.event_time?.slice(0, 10))}</td>
            <td>{display(fields.value_date)}</td>
            <td>{display(fields.narration)}</td>
            <td>{display(fields.reference)}</td>
            {paymentColumns.map(([key]) => <td key={key}>{display(key === 'time' ? row.printed_time || fields[key] : fields[key])}</td>)}
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
        <StatementReconciliation result={preview.reconciliation} />
        {preview.recovered_layout_rows > 0 && <p>A second reader recovered {preview.recovered_layout_rows} {preview.recovered_layout_rows === 1 ? 'row' : 'rows'}.</p>}
        {preview.rows.length > 0 && <StatementTable rows={preview.rows} />}
        {encrypted && preview.accepted > 0 && <p>Re-enter the original password to import this page.</p>}
      </>}
    </details>
  );
}

function StatementActions({ batch, api, onChanged, onOpenFlow }) {
  const name = batch.summary.statement_name || 'Bank statement';
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const path = `/quality/${encodeURIComponent(batch.id)}/statement`;

  async function update(options) {
    setSaving(true);
    setError('');
    try {
      const result = await api(path, options);
      setRenaming(false);
      onChanged(options.method === 'DELETE'
        ? `Statement deleted · ${result.deleted_rows} saved rows removed`
        : 'Statement name saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return <>
    <div className="statement-ledger-paging">
      <Button type="button" size="sm" disabled={saving} onClick={onOpenFlow}>Open 3D money flow</Button>
      <Button type="button" variant="outline" size="sm" disabled={saving || renaming} onClick={() => setRenaming(true)}>Rename</Button>
      <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => {
        if (window.confirm(`Delete “${name}” from ${batch.case_id}? This removes all saved transaction rows and recovered pages for this statement from the case. This action cannot be undone.`)) {
          update({ method: 'DELETE' });
        }
      }}>Delete statement</Button>
    </div>
    {renaming && <form className="statement-recovery-form" onSubmit={event => {
      event.preventDefault();
      const nextName = event.currentTarget.elements.statement_name.value.trim();
      update({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nextName }) });
    }}>
      <label>Statement name
        <input type="text" name="statement_name" required maxLength={100} defaultValue={name} disabled={saving} autoFocus />
      </label>
      <div className="statement-ledger-paging">
        <Button type="submit" size="sm" disabled={saving}>Save name</Button>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setRenaming(false)}>Cancel</Button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

export default function StatementImportRows({ batch, api, onEvidence, onChanged, onOpenFlow }) {
  const [result, setResult] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const { currency } = batch.summary.statement_settings;
  const source = result?.rows[0]?.locator;
  const recoverable = ['pdf', 'tiff'].includes(source?.format);

  async function readRows(from) {
    setLoading(true);
    setError('');
    try {
      setResult(await api(`/quality/${encodeURIComponent(batch.id)}/statement-rows?offset=${from}&all_rows=true`));
      setOffset(from);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setPublishError('');
    try {
      const outcome = await api(`/quality/${encodeURIComponent(batch.id)}/publish-statement`, { method: 'POST' });
      onChanged(`Published ${outcome.published_rows} transactions to the case graph`);
    } catch (err) {
      setPublishError(err.message);
      await readRows(offset);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <StatementActions batch={batch} api={api} onChanged={onChanged} onOpenFlow={onOpenFlow} />
      <details className="statement-import-review" onToggle={event => {
        if (event.currentTarget.open && !result && !loading && !error) readRows(0);
      }}>
        <summary>Bank statement · {currency} · Review transactions</summary>
        {loading && <p role="status">Loading statement rows…</p>}
        {error && <div role="alert" className="error">
          {error} <Button variant="outline" size="sm" onClick={() => readRows(offset)}>Retry</Button>
        </div>}
        {result && <>
          <p>{result.accepted} saved {result.accepted === 1 ? 'transaction' : 'transactions'} for this statement</p>
          {result.unpublished_rows > 0 && (
            <div className="statement-ledger-paging">
              <span>{result.unpublished_rows} saved rows available to publish to the case graph.</span>
              <Button type="button" size="sm" variant="outline" disabled={publishing || loading || !result.publication_impact?.fits}
                onClick={publish}>{publishing ? 'Publishing…' : 'Publish to case graph'}</Button>
              {!result.publication_impact?.fits && <span>Publishing all saved rows would exceed the case graph limit.</span>}
            </div>
          )}
          {publishError && <p className="error" role="alert">{publishError}</p>}
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
          {result.pages[0]?.page > 1 && <p>No transactions are saved from page 1.</p>}
          <StatementPageCoverage pages={result.scope?.coverage} pageRange={result.scope?.requested} />
          <StatementReconciliation result={result.saved_reconciliation} saved />
          {!result.saved_reconciliation && <p>No printed summary is saved for comparison. Compare the saved rows with the original statement.</p>}
          {recoverable && (
            <StatementPageRecovery batchId={batch.id} initialPage={result.next_page || 1} encrypted={source.encrypted}
              api={api} onRecovered={onChanged} />
          )}
          {result.rows.length > 0 ? <StatementTable rows={result.rows} onEvidence={onEvidence} />
            : <p>No transactions are saved for this statement.</p>}
          {result.accepted > PAGE_SIZE && (
            <div className="statement-ledger-paging">
              <span>{offset + 1}–{offset + result.rows.length} of {result.accepted} saved rows</span>
              <Button variant="outline" size="sm" disabled={loading || !offset} onClick={() => readRows(offset - PAGE_SIZE)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={loading || offset + PAGE_SIZE >= result.accepted} onClick={() => readRows(offset + PAGE_SIZE)}>Next</Button>
            </div>
          )}
        </>}
      </details>
    </>
  );
}
