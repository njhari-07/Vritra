import React from 'react';

/**
 * TimelineTab — chronological event view for dated entities and calls.
 */
export default function TimelineTab({ list, activeCase, setSelected }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recorded events ({activeCase})</h2>
      </div>
      {list.map(n => (
        <article className="lead" key={n.id}>
          <time>{new Date(n.event_time).toLocaleString()}</time>
          <strong>{n.label}</strong>
          <button className="quiet" onClick={() => setSelected(n)}>
            View source →
          </button>
        </article>
      ))}
      {!list.length && <p className="empty">No dated events in the current case scope.</p>}
    </section>
  );
}
