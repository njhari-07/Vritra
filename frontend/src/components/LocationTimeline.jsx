import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { caseTimeInput, caseTimeWithOffset, formatCaseTime } from '../case-time';
import './location-timeline.css';

const SOURCES = { gps: 'GPS', cell_tower: 'Cell tower', photo_exif: 'Claimed photo EXIF', manual: 'Manual entry' };
const metresPerDegree = 111195;
const label = row => `${row.subject_id} · ${SOURCES[row.source_kind]}`;
const inWindow = (time, start, end) => time >= start && time <= end;
const startOfCaseDay = value => Date.parse(caseTimeWithOffset(`${value.slice(0, 10)}T00:00:00`));

function eventOverlaps(event, start, end) {
  const last = event.end_time || event.event_time;
  if (event.time_basis === 'date_only') {
    return startOfCaseDay(event.event_time) <= end && startOfCaseDay(last) + 86_400_000 > start;
  }
  return Date.parse(event.event_time) <= end && Date.parse(last) >= start;
}

function CoordinateGrid({ rows, visible, selected, onSource }) {
  const { positions, extent } = useMemo(() => {
    const origin = rows[0];
    const positions = new Map();
    let edge = 40;
    for (const row of rows) {
      const longitude = ((row.longitude - origin.longitude + 540) % 360) - 180;
      const x = longitude * metresPerDegree * Math.cos(origin.latitude * Math.PI / 180);
      const y = (row.latitude - origin.latitude) * metresPerDegree;
      positions.set(row.id, { x, y });
      edge = Math.max(edge, Math.abs(x) + row.accuracy_m, Math.abs(y) + row.accuracy_m);
    }
    return { positions, extent: edge * 2.25 };
  }, [rows]);
  const layers = [...visible].sort((a, b) => b.accuracy_m - a.accuracy_m);
  return <figure className="location-figure">
    <div className="location-grid" aria-label="Offline coordinate grid with reported location areas">
      <span className="location-north" aria-hidden="true">N ↑</span>
      {layers.map(row => {
        const { x, y } = positions.get(row.id);
        const size = `${200 * row.accuracy_m / extent}%`;
        return <button key={row.id} type="button" className="location-area" data-source={row.source_kind}
          aria-pressed={selected === row.id} aria-label={`Open source for ${label(row)}, ${row.accuracy_m} metre radius`}
          style={{ left: `${50 + x / extent * 100}%`, top: `${50 - y / extent * 100}%`, width: size, height: size }}
          onClick={() => onSource(row)} />;
      })}
      {!layers.length && <p>No observations in this view.</p>}
    </div>
    <figcaption>Approx. {Math.round(extent / 5).toLocaleString()} m per grid square.
      <span className="location-legend">{Object.entries(SOURCES).map(([kind, name]) => (
        <span key={kind}><i data-source={kind} aria-hidden="true" />{name}</span>
      ))}</span>
    </figcaption>
  </figure>;
}

function ProximitySearch({ api, path, subjects, from, to, onSource }) {
  const [mode, setMode] = useState('near-place');
  const [matches, setMatches] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function check(event) {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(event.currentTarget));
    params.set('start', caseTimeWithOffset(from));
    params.set('end', caseTimeWithOffset(to));
    setPending(true);
    setError('');
    setMatches(null);
    try {
      setMatches(await api(`${path}/${mode}?${params}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return <details className="location-search">
    <summary>Check proximity in this time window</summary>
    <form onSubmit={check} className="location-controls">
      <label>Compare<select value={mode} disabled={pending} onChange={event => {
        setMode(event.target.value); setMatches(null); setError('');
      }}>
        <option value="near-place">Observations near a coordinate</option>
        <option value="near-pair">Two reported subjects</option>
      </select></label>
      {mode === 'near-place' ? <>
        <label>Latitude<input type="number" name="latitude" step="any" min="-90" max="90" defaultValue="0" required /></label>
        <label>Longitude<input type="number" name="longitude" step="any" min="-180" max="180" defaultValue="0" required /></label>
      </> : <>
        <label>First subject<select name="subject" defaultValue={subjects[0]} required>
          {subjects.map(subject => <option key={subject}>{subject}</option>)}
        </select></label>
        <label>Second subject<select name="other" defaultValue={subjects[1]} required>
          {subjects.map(subject => <option key={subject}>{subject}</option>)}
        </select></label>
        <label>Time tolerance in seconds<input type="number" name="tolerance_seconds" min="0" max="3600" defaultValue="60" required /></label>
      </>}
      <label>Radius in metres<input type="number" name="radius_m" min="1" max="6371008" defaultValue="100" required /></label>
      <Button size="sm" disabled={pending || (mode === 'near-pair' && subjects.length < 2)}>{pending ? 'Checking…' : 'Check proximity'}</Button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {matches?.length === 0 && <p role="status">No matching observations in this window.</p>}
    {matches?.map(match => <article className="location-match" key={match.observations.map(row => row.id).join('-')}>
      <strong>{match.classification === 'within_radius' ? 'Within radius under stated accuracy' : 'Possible overlap'}</strong>
      <span>Estimated separation under reported accuracy · {match.minimum_m}–{match.maximum_m} m</span>
      {match.observations.map(row => <Button key={row.id} type="button" variant="outline" size="sm" onClick={() => onSource(row)}>
        {label(row)} source
      </Button>)}
    </article>)}
  </details>;
}

export default function LocationTimeline({ events, caseId, api, onEvent, onEvidence, onChanged }) {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState(null);
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const path = `/locations/${encodeURIComponent(caseId)}`;

  useEffect(() => {
    if (!caseId) return undefined;
    const controller = new AbortController();
    api(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setRows(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [api, path, caseId, revision]);

  const subjects = [...new Set(rows.map(row => row.subject_id))].sort();
  const times = [...new Set([...rows.map(row => Date.parse(row.event_time)), ...events.flatMap(event =>
    event.time_basis === 'date_only' ? [] : [Date.parse(event.event_time), Date.parse(event.end_time)])])]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const start = from || (times.length ? caseTimeInput(times[0]) : '');
  const end = to || (times.length ? caseTimeInput(Math.ceil(times.at(-1) / 1000) * 1000) : '');
  const startMs = from ? Date.parse(caseTimeWithOffset(from)) : -Infinity;
  const endMs = to ? Date.parse(caseTimeWithOffset(to)) : Infinity;
  const steps = times.filter(time => inWindow(time, startMs, endMs));
  const index = Math.min(cursor ?? steps.length - 1, steps.length - 1);
  const through = cursor === null ? endMs : (steps[index] ?? endMs);
  const visible = rows.filter(row => inWindow(Date.parse(row.event_time), startMs, through) && (!subject || row.subject_id === subject));
  const visibleById = new Map(visible.map(row => [row.id, row]));
  const timeline = !rows.length ? events : events.filter(event => event.kind === 'location' ? visibleById.has(event.observation_id)
    : eventOverlaps(event, startMs, through));

  async function save(body, demo = false) {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = await api(demo ? path + '/demo' : path, { method: 'POST', body });
      setNotice(`${result.accepted_new} saved · ${result.recognized_repeat} repeats · ${result.quarantined} quarantined. See Quality for import details.`);
      setRevision(value => value + 1);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadTemplate() {
    try {
      const response = await api(path + '/template', { raw: true });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'synthetic-location-template.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message);
    }
  }

  function open(row) {
    setSelected(row.id);
    onEvidence(row.id, label(row));
  }

  return <div className="location-timeline">
    <details className="panel synthetic-location-tools">
      <summary>Synthetic coordinate tools</summary>
      <p>Synthetic observations only. Circles show reported accuracy areas. Subject labels come from the source.</p>
      <form className="location-upload" onSubmit={event => {
        event.preventDefault();
        if (confirmed) save(event.currentTarget.elements.locations.files[0]);
      }}>
        <label>Synthetic location CSV<input type="file" name="locations" accept=".csv,text/csv" required /></label>
        <label className="location-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm the rows are synthetic</label>
        <div className="location-actions">
          <Button size="sm" type="submit" disabled={!caseId || saving || !confirmed}>Import CSV</Button>
          <Button size="sm" type="button" variant="outline" onClick={downloadTemplate} disabled={!caseId}>Download template</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => save(undefined, true)} disabled={!caseId || saving}>Load synthetic scenario</Button>
        </div>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {rows.length > 0 && <>
        <div className="location-controls">
          <label>Subject<select value={subject} onChange={event => setSubject(event.target.value)}>
            <option value="">All subjects</option>{subjects.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label>From (IST)<input type="datetime-local" step="1" value={from} onChange={event => { setFrom(event.target.value); setCursor(null); }} /></label>
          <label>Through (IST)<input type="datetime-local" step="1" value={to} onChange={event => { setTo(event.target.value); setCursor(null); }} /></label>
        </div>
        {steps.length > 0 && <label className="location-slider">Timeline cursor · {formatCaseTime(steps[index])}
          <input type="range" min="0" max={steps.length - 1} value={index} onChange={event => setCursor(Number(event.target.value))} />
        </label>}
        <CoordinateGrid rows={rows} visible={visible} selected={selected} onSource={open} />
        <ProximitySearch key={`${start}/${end}/${revision}`} api={api} path={path} subjects={subjects} from={start} to={end} onSource={open} />
      </>}
    </details>
    <section className="panel" id="recorded-event-list" aria-label="Recorded events">
      <div className="panel-head"><h2>Recorded events ({caseId})</h2></div>
      {timeline.map(event => <article className="lead" key={event.id} data-selected={selected === event.id}>
        <span><time dateTime={event.event_time}>{formatCaseTime(event.event_time, event.time_basis)}</time>
          {event.end_time && <> – <time dateTime={event.end_time}>{formatCaseTime(event.end_time, event.time_basis)}</time></>}
        </span>
        <strong>{event.label}{event.end_time && <small className="location-range">Reported time range</small>}</strong>
        <button className="quiet" onClick={() => {
          if (event.kind === 'location' && visibleById.has(event.observation_id)) open(visibleById.get(event.observation_id));
          else if (event.kind) onEvidence(event.evidence_ids[0], event.label);
          else onEvent(event);
        }}>View source</button>
      </article>)}
      {!timeline.length && <p className="empty">No dated events in this view.</p>}
    </section>
  </div>;
}
