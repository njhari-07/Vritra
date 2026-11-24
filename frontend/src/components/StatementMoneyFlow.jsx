import React, { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatementRowReview from './StatementRowReview';
import './statement-money-flow.css';

const StatementFlowScene = lazy(() => import('./three/StatementFlowScene'));
const PAGE_SIZE = 25;
const MAX_VISIBLE_LINKS = 24;
const DEFAULTS = { account: '', start: '', end: '', direction: 'all', status: 'completed' };
const money = (value, currency) => value + ' ' + currency;

class SceneBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <p>3D rendering is unavailable. Use the payment links and source rows below.</p> : this.props.children;
  }
}

function SourceTransaction({ row, api }) {
  const [evidence, setEvidence] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setOpen(!open);
    if (open || evidence || loading) return;
    setLoading(true);
    setError('');
    try {
      setEvidence(await api(`/evidence/${encodeURIComponent(row.evidence_id)}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return <>
    <tr>
      <td>{row.locator.sheet || `Page ${row.locator.page}`} · Row {row.locator.row}
        {row.locator.continuation && <small>Continued on page {row.locator.continuation.page}</small>}
      </td>
      <td>{row.event_time.slice(0, 10)}{row.printed_time && <small>{row.printed_time}</small>}</td>
      <td>{row.fields.sender || '—'}</td><td>{row.fields.receiver || '—'}</td><td>{row.fields.narration || '—'}</td>
      <td>{row.fields.reference || '—'}</td><td>{row.direction === 'credit' ? 'Incoming' : 'Outgoing'}</td>
      <td>{money(row.amount, row.currency)}</td><td>{row.fields.status || row.payment_status}</td>
      <td><Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={toggle}>{open ? 'Close row' : 'Open source row'}</Button></td>
    </tr>
    {open && <tr><td colSpan={10}>
      {loading && <p role="status">Loading source evidence…</p>}
      {error && <p role="alert">{error}</p>}
      {evidence && <StatementRowReview evidence={evidence} api={api} />}
    </td></tr>}
  </>;
}

function AccountOwner({ account, people, api, path, onSaved }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await api(path + '/owner', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: account.key, name: form.get('name'), person_id: form.get('person') || null }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="statement-flow-owner">
      <summary>{account.owner ? `Account owner · ${account.owner.name}` : 'Identify the account owner'}</summary>
      <form onSubmit={save}>
        <label>Owner name<input name="name" defaultValue={account.owner?.name || ''} required maxLength={100} /></label>
        <label>Link to a person in this case
          <select name="person" defaultValue={account.owner?.person_id || ''}>
            <option value="">Keep as a statement owner label</option>
            {people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}
          </select>
        </label>
        <Button size="sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Confirm owner'}</Button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export default function StatementMoneyFlow({ importId, api, people, activeCase, darkMode, onBack, onOwnerSaved }) {
  const [filters, setFilters] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [group, setGroup] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const path = `/quality/${encodeURIComponent(importId)}/money-flow`;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(Object.entries({ ...filters, group, offset }).filter(([, value]) => value !== ''));
    setLoading(true);
    setError('');
    api(`${path}?${params}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setResult(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, path, filters, group, offset, refresh]);

  function updateFilter(event) {
    const { name, value } = event.target;
    setFilters(previous => ({ ...previous, [name]: value }));
    setGroup('');
    setLinkSearch('');
    setOffset(0);
  }

  function selectGroup(key) {
    setGroup(key);
    setOffset(0);
  }

  const account = result?.accounts.find(item => item.key === result.account);
  const activeGroup = result?.groups.find(item => item.key === group);
  const search = linkSearch.trim().toLowerCase();
  const listed = result?.groups.filter(item => item.key === group || item.label.toLowerCase().includes(search)) || [];
  const visible = result?.groups.slice(0, MAX_VISIBLE_LINKS) || [];
  if (activeGroup && !visible.includes(activeGroup)) visible[visible.length - 1] = activeGroup;

  return (
    <main className={`statement-flow-page ${darkMode ? 'dark-theme' : ''}`}>
      <header className="statement-flow-header">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft />Back to Quality</Button>
        <div><h1>{result?.name || 'Statement money flow'}</h1><p>Financial transaction explorer{result?.case_id && ` · ${result.case_id}`}</p></div>
      </header>
      {loading && <p role="status">Loading saved transactions…</p>}
      {error && <p role="alert" className="error">{error} <Button variant="outline" size="sm" onClick={() => { setFilters(DEFAULTS); setLinkSearch(''); selectGroup(''); setRefresh(value => value + 1); }}>Reset filters</Button></p>}
      {result && <>
        <section className="statement-flow-controls" aria-label="Filter transactions">
          <label>Account<select name="account" value={filters.account || result.account || ''} onChange={updateFilter}>
            {result.accounts.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>
          <label>From<input type="date" name="start" value={filters.start} onChange={updateFilter} /></label>
          <label>Through<input type="date" name="end" value={filters.end} onChange={updateFilter} /></label>
          <label>Direction<select name="direction" value={filters.direction} onChange={updateFilter}>
            <option value="all">Both directions</option><option value="credit">Incoming</option><option value="debit">Outgoing</option>
          </select></label>
          <label>Status<select name="status" value={filters.status} onChange={updateFilter}>
            <option value="completed">Completed</option><option value="all">All statuses</option><option value="pending">Pending</option>
            <option value="failed">Failed</option><option value="reversed">Reversed</option><option value="unknown">Unknown</option>
          </select></label>
        </section>
        {account && <AccountOwner key={account.key} account={account} people={result.case_id === activeCase ? people : []}
          api={api} path={path} onSaved={() => { setRefresh(value => value + 1); onOwnerSaved(); }} />}
        <dl className="statement-flow-totals" aria-label="Completed payment totals">
          <div><dt><ArrowDownLeft />Incoming</dt><dd>{money(result.totals.credit, result.currency)}</dd></div>
          <div><dt><ArrowUpRight />Outgoing</dt><dd>{money(result.totals.debit, result.currency)}</dd></div>
          <div><dt><Banknote />Net movement</dt><dd>{money(result.totals.net, result.currency)}</dd></div>
        </dl>
        <div className="statement-flow-scene" aria-label="3D graph of completed payments">
          {account && <div className="statement-flow-account">{account.owner?.name || account.label}</div>}
          {visible.length && account ? (
            <SceneBoundary>
              <Suspense fallback={<p role="status">Loading 3D view…</p>}>
                <StatementFlowScene groups={visible} active={group} onSelect={selectGroup} />
              </Suspense>
            </SceneBoundary>
          ) : <p>No completed payment links match these filters.</p>}
        </div>
        <section className="statement-flow-rows" aria-label="Transaction evidence">
          <div className="statement-flow-legend"><span>Blue · Selected account</span><span>Green · Incoming</span><span>Amber · Outgoing</span>
            <span>Diamonds · Printed UPI labels to review</span><span>Squares · Payment channels</span>
            {result.groups.length > MAX_VISIBLE_LINKS && <span>{visible.length} of {result.groups.length} links displayed in 3D.</span>}
          </div>
          <div className="statement-flow-link-controls">
            {result.groups.length > 12 && <label>Search payment links
              <input type="search" value={linkSearch} onChange={event => setLinkSearch(event.target.value)} />
            </label>}
            <label>Payment link<select value={group} onChange={event => selectGroup(event.target.value)}>
              <option value="">All matching transactions</option>
              {listed.map(item => <option key={item.key} value={item.key}>
                {item.direction === 'credit' ? 'Incoming' : 'Outgoing'} · {item.label}{item.kind === 'narration' ? ' (review)' : ''} · {item.count} · {money(item.total, result.currency)}
              </option>)}
            </select></label>
          </div>
          {activeGroup && <p className="statement-flow-link-basis">{activeGroup.basis}</p>}
          <h2>{result.row_count} {result.row_count === 1 ? 'transaction' : 'transactions'}</h2>
          <div className="statement-preview-table" role="region" aria-label="Saved source rows" tabIndex={0}>
            <table>
              <thead><tr>{['Source', 'Date and printed time', 'Sender', 'Receiver', 'Details', 'Reference', 'Direction', 'Amount', 'Status', 'Evidence'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{result.rows.map(row => <SourceTransaction key={row.evidence_id} row={{ ...row, currency: result.currency }} api={api} />)}</tbody>
            </table>
          </div>
          {result.row_count > PAGE_SIZE && <div className="statement-ledger-paging">
            <span>{offset + 1}–{offset + result.rows.length} of {result.row_count}</span>
            <Button variant="outline" size="sm" disabled={loading || offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={loading || offset + PAGE_SIZE >= result.row_count} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>}
        </section>
      </>}
    </main>
  );
}
