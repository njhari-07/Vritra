import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import { Button } from '@/components/ui/button';
import { formatCaseTime } from '../case-time';
import './report-intake.css';

const PAGE_SIZE = 35;
const GRAPH_CALL_LIMIT = 180;

function CallGraph({ calls, onNumber, darkMode }) {
  const canvas = useRef(null);
  const network = useRef(null);
  const data = useMemo(() => {
    const connections = new Map();
    const numbers = new Set();
    for (const call of calls.slice(-GRAPH_CALL_LIMIT)) {
      const id = JSON.stringify([call.caller, call.callee]);
      if (!connections.has(id)) connections.set(id, { id, from: call.caller, to: call.callee, label: 0 });
      connections.get(id).label++;
      numbers.add(call.caller);
      numbers.add(call.callee);
    }
    return {
      nodes: [...numbers].map(number => ({ id: number, label: number })),
      edges: [...connections.values()].map(item => ({ ...item, label: String(item.label) })),
    };
  }, [calls]);

  useEffect(() => {
    const view = new Network(canvas.current, { nodes: new DataSet(), edges: new DataSet() }, {
      nodes: { shape: 'dot', size: 12, color: '#4486d5', font: { color: darkMode ? '#d8e6f9' : '#20344a' } },
      edges: { arrows: 'to', color: '#4e9ac5', smooth: { type: 'curvedCW', roundness: .2 },
        font: { color: darkMode ? '#cde4fb' : '#20344a', strokeWidth: 0 } },
      layout: { randomSeed: 4, improvedLayout: false },
      physics: { stabilization: { iterations: 80 } },
    });
    view.on('selectNode', event => onNumber(event.nodes[0]));
    network.current = view;
    return () => { view.destroy(); network.current = null; };
  }, [darkMode, onNumber]);

  useEffect(() => {
    network.current?.setData({ nodes: new DataSet(data.nodes), edges: new DataSet(data.edges) });
  }, [data, darkMode]);

  return <div ref={canvas} className="call-report-graph" aria-label="Directed caller-to-callee graph" />;
}

function SavedCallSource({ call, api }) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let url;
    api(`/evidence/${encodeURIComponent(call.id)}/source-page`, { raw: true, signal: abort.signal })
      .then(response => response.blob())
      .then(blob => { if (!abort.signal.aborted) setSource(url = URL.createObjectURL(blob)); })
      .catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [api, call.id]);
  return <div className="call-report-source">
    <h3>Source page {call.locator.page} · Table {call.locator.table} · Row {call.locator.row}</h3>
    {source ? <img src={source} alt={`Call report source page ${call.locator.page}`} /> : <p role={error ? 'alert' : 'status'}>{error || 'Loading original page…'}</p>}
  </div>;
}

export default function CallReportExplorer({ importId, api, onBack, darkMode }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [cursor, setCursor] = useState(null);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState(null);

  useEffect(() => {
    const abort = new AbortController();
    api(`/quality/${encodeURIComponent(importId)}/call-report`, { signal: abort.signal })
      .then(data => { if (!abort.signal.aborted) setReport(data); })
      .catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => abort.abort();
  }, [api, importId]);

  const times = useMemo(() => [...new Set(report?.calls.map(call => call.time))], [report]);
  const step = cursor ?? Math.max(0, times.length - 1);
  const calls = useMemo(() => report?.calls.filter(call => call.time <= times[step] &&
    (!number || call.caller.includes(number) || call.callee.includes(number))) || [], [report, times, step, number]);
  const selectNumber = React.useCallback(value => {
    setNumber(value);
    setPage(0);
    setSource(null);
  }, []);
  const paged = calls.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).reverse();

  return <main className="call-report-page">
    <div className="call-report-header">
      <Button variant="outline" onClick={onBack}>Back to Quality</Button>
      <div><h1>Call report explorer</h1>{report && <p>{report.case_id} · {report.calls.length} saved calls</p>}</div>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {!report && !error && <p role="status">Loading call records…</p>}
    {report && <section className="panel">
      <h2>Call network</h2>
      <p>Arrows point from caller to callee. Labels count calls along each connection.</p>
      <label className="call-report-range">Filter by phone number
        <input type="search" value={number} onChange={event => selectNumber(event.target.value)} />
      </label>
      {times.length > 0 && <label className="call-report-range">Through {formatCaseTime(times[step])}
        <input type="range" min="0" max={times.length - 1} value={step} onChange={event => {
          setCursor(Number(event.target.value)); setPage(0); setSource(null);
        }} />
      </label>}
      {calls.length > GRAPH_CALL_LIMIT && <p>Showing the latest {GRAPH_CALL_LIMIT} matching calls in the graph.</p>}
      {calls.length ? <CallGraph calls={calls} onNumber={selectNumber} darkMode={darkMode} /> : <p>No calls match these filters.</p>}
    </section>}
    {report && <section className="panel call-report-timeline">
      <h2>Call timeline · {calls.length} matching</h2>
      <div className="statement-preview-table" role="region" aria-label="Call timeline records" tabIndex={0}>
        <table><thead><tr>{['Time', 'Caller', 'Callee', 'Duration', 'Source'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{paged.map(call => <tr key={call.id}>
            <td><time dateTime={call.time}>{formatCaseTime(call.time)}</time></td><td>{call.caller}</td><td>{call.callee}</td><td>{call.duration_seconds} s</td>
            <td><Button size="sm" variant="outline" onClick={() => setSource(call)}>Page {call.locator.page} · Row {call.locator.row}</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {calls.length > PAGE_SIZE && <div className="call-report-actions">
        <Button variant="outline" disabled={!page} onClick={() => { setPage(page - 1); setSource(null); }}>Previous</Button>
        <Button variant="outline" disabled={(page + 1) * PAGE_SIZE >= calls.length} onClick={() => { setPage(page + 1); setSource(null); }}>Next</Button>
      </div>}
      {source && <SavedCallSource key={source.id} call={source} api={api} />}
    </section>}
  </main>;
}
