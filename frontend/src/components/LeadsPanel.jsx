import React from 'react';

/**
 * LeadsPanel — renders Connections and Flagged behavior tabs.
 * Displays investigative leads with inline review access.
 */
export default function LeadsPanel({ leads, graph, search, setSearch, setSelected }) {
  const filtered = leads.filter(l =>
    (l.reason + ' ' + l.subject_ids
      .map(id => graph?.nodes?.find(n => n.id === id)?.label)
      .join(' ')).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{leads.length} findings</h2>
        <input
          aria-label="Search findings"
          placeholder="Search entities or findings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {filtered.map(l => (
        <article className="lead" key={l.id}>
          <div>
            <span className={'tag ' + (l.category === 'connection' ? '' : 'amber')}>
              {l.techniques.join(' · ')}
            </span>
            <h3>
              {l.subject_ids
                .map(id => graph?.nodes?.find(n => n.id === id)?.label || id)
                .join(' → ')}
            </h3>
            <p>{l.reason}</p>
            <small>
              {l.evidence_ids.length} source references · {l.review_state}
            </small>
          </div>
          <button className="quiet" onClick={() => setSelected(l)}>
            Review evidence →
          </button>
        </article>
      ))}
      {!filtered.length && <p className="empty">No findings match this view.</p>}
    </section>
  );
}
