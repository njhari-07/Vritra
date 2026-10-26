import React from 'react';

/**
 * AuditTab — activity history log showing all system/user events.
 */
export default function AuditTab({ list }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Activity history</h2>
      </div>
      {list.map(r => (
        <article className="lead" key={r.id}>
          <strong>{r.action.replaceAll('_', ' ')}</strong>
          <span>
            {r.actor} · {r.case_id}
          </span>
          <time>{new Date(r.at).toLocaleString()}</time>
        </article>
      ))}
      {!list.length && <p className="empty">No audit events recorded.</p>}
    </section>
  );
}
