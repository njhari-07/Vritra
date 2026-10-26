import React from 'react';

/**
 * EvidenceDrawer — slide-out panel for inspecting entity assertions,
 * source passages, and lead review decisions.
 */
export default function EvidenceDrawer({ selected, ev, onClose, onEvidenceLoad, onReview }) {
  if (!selected) return null;

  return (
    <div className="drawer">
      <button
        className="close"
        onClick={onClose}
        aria-label="Close evidence panel"
      >
        ×
      </button>
      <p className="eyebrow">EVIDENCE DETAIL</p>
      <h2>
        {selected.title
          ? `${selected.title}: ${selected.name}`
          : selected.label || selected.left_name || selected.name || 'Finding for review'}
      </h2>
      <p>
        {selected.role
          ? `${selected.role} · Risk Score: ${selected.risk_score} (${selected.risk_level})`
          : selected.reason || selected.type || 'Candidate identity match'}
      </p>

      {selected.structural_context && (
        <pre>{JSON.stringify(selected.structural_context, null, 2)}</pre>
      )}

      {selected.behavior_score != null && (
        <p>
          Model score: {selected.behavior_score.toFixed(4)}
          <br />
          <small>{selected.score_scope}</small>
        </p>
      )}

      {selected.assertions && (
        <details>
          <summary>{selected.assertions.length} preserved assertions</summary>
          <pre>{JSON.stringify(selected.assertions, null, 2)}</pre>
        </details>
      )}

      <h3>Source references</h3>
      {selected.evidence_ids?.map((id, i) => (
        <button className="source-button" key={id} onClick={() => onEvidenceLoad(id)}>
          ↗ Source {i + 1} <small>{id.slice(0, 10)}</small>
        </button>
      ))}

      {ev && (
        <div className="evidence">
          <span className="tag">{ev.synthetic ? 'SYNTHETIC' : 'BENCHMARK'}</span>
          <h3>{ev.source}</h3>
          <p>{JSON.stringify(ev.source_locator)}</p>
          <blockquote>{ev.passage}</blockquote>
          <small>
            {ev.extraction_method} · v{ev.extraction_version}
            <br />
            Event: {ev.event_time || 'Not supplied'}
            <br />
            Imported: {ev.ingestion_time}
          </small>
        </div>
      )}

      {selected.category && (
        <div className="review-actions">
          <h3>Record your review</h3>
          <button onClick={() => onReview(selected, 'relevant')}>Relevant</button>
          <button className="quiet" onClick={() => onReview(selected, 'not_relevant')}>
            Not relevant
          </button>
          <button className="quiet" onClick={() => onReview(selected, 'insufficient_evidence')}>
            Insufficient evidence
          </button>
        </div>
      )}
    </div>
  );
}
