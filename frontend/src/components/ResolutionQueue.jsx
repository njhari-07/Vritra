import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import './place-evidence.css';

const nameKey = value => value.trim().toLowerCase().replace(/\s+/g, ' ');

function Sources({ label, entries, onSource }) {
  if (!entries.length) return null;
  return <div className="resolution-side">
    <strong>{label}</strong>
    {entries.slice(0, 3).map(item => <button key={item.id} className="quiet" type="button" onClick={() => onSource(item.id, label)}>
      {item.source}{item.page ? ` · Page ${item.page}` : item.document ? ` · Document ${item.document}` : ''}
      {item.event_time ? ` · ${item.event_time.slice(0, 10)}` : ''}
    </button>)}
    {entries.length > 3 && <small>{entries.length - 3} more sources in the evidence drawer</small>}
  </div>;
}

function MatchGroup({ items, busy, onDecision, onSource, onEvidence }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(20);
  const first = items[0];
  const label = nameKey(first.left_name) === nameKey(first.right_name) ? first.left_name : `${first.left_name} ↔ ${first.right_name}`;
  const mentions = new Set(items.flatMap(item => [item.left, item.right]));
  return <details className="resolution-group" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{label}</strong> <span>{mentions.size} mentions · {items.length} pairs</span></summary>
    {open && items.slice(0, limit).map((candidate, index) => <article className="lead" key={candidate.id}>
      <div>
        <h3>Pair {index + 1}</h3>
        <p>{(candidate.similarity * 100).toFixed(1)}% name similarity · {candidate.state}</p>
        <div className="resolution-sources">
          <Sources label={candidate.left_name} entries={candidate.left_sources} onSource={onSource} />
          <Sources label={candidate.right_name} entries={candidate.right_sources} onSource={onSource} />
        </div>
        <button className="quiet" type="button" onClick={() => onEvidence(candidate)}>All source references</button>
      </div>
      <div className="place-actions">
        {candidate.state === 'accepted' ? (
          <Button size="sm" disabled={busy} onClick={() => onDecision(candidate, 'revoked')}>Undo match</Button>
        ) : <>
          <Button size="sm" disabled={busy} onClick={() => onDecision(candidate, 'accepted')}>Accept match</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision(candidate, 'rejected')}>Reject</Button>
        </>}
      </div>
    </article>)}
    {open && limit < items.length && <button type="button" className="quiet" onClick={() => setLimit(limit + 20)}>Show more pairs</button>}
  </details>;
}

export default function ResolutionQueue({ caseId, matches, busy, onDecision, onSource, onEvidence }) {
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const item of matches) {
      const key = JSON.stringify([nameKey(item.left_name), nameKey(item.right_name)].sort());
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return [...grouped];
  }, [matches]);
  return <section className="panel" aria-label="Case identity matches">
    <div className="panel-head"><h2>Candidate identity matches</h2><span>{caseId}</span></div>
    {groups.length > 0 && <p>Compare the records on each side before deciding whether the mentions refer to the same person.</p>}
    {groups.map(([key, items]) => <MatchGroup key={key} items={items} busy={busy} onDecision={onDecision}
      onSource={onSource} onEvidence={onEvidence} />)}
    {!groups.length && <p className="empty">No candidate matches in this case.</p>}
  </section>;
}
