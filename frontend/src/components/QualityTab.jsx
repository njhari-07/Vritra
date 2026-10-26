import React from 'react';

/**
 * QualityTab — import quality ledger showing acceptance/quarantine stats.
 */
export default function QualityTab({ list }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Import quality ledger</h2>
      </div>
      {list.map(r => (
        <article className="lead" key={r.id}>
          <div>
            <h3>
              {r.case_id} · {r.id.slice(0, 8)}
            </h3>
            <p>
              {r.summary.rows_seen} records · {r.summary.accepted_new} accepted ·{' '}
              {r.summary.recognized_repeat} repeats · {r.summary.quarantined} quarantined
            </p>
            {r.summary.issues.map((x, i) => (
              <p key={i} className="error">
                {JSON.stringify(x.locator)}: {x.reason}
              </p>
            ))}
          </div>
          <time>{new Date(r.created).toLocaleString()}</time>
        </article>
      ))}
      {!list.length && <p className="empty">No imports recorded yet.</p>}
    </section>
  );
}
