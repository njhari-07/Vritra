import React from 'react';

/**
 * ResolutionTab — candidate identity resolution view.
 * Displays name-similarity matches for human accept/reject/revoke.
 */
export default function ResolutionTab({ list, decide, setSelected }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Candidate identity matches</h2>
        <span className="badge">HUMAN REVIEW REQUIRED</span>
      </div>
      {list.map(c => (
        <article className="lead" key={c.id}>
          <div>
            <h3>
              {c.left_name} ↔ {c.right_name}
            </h3>
            <p>
              Name similarity {(c.similarity * 100).toFixed(1)}% · {c.state}
            </p>
            <small>Similarity does not establish identity.</small>
            <button className="quiet" onClick={() => setSelected(c)}>
              Source evidence
            </button>
          </div>
          <div>
            {c.state === 'accepted' ? (
              <button onClick={() => decide(c, 'revoked')}>Undo match</button>
            ) : (
              <>
                <button onClick={() => decide(c, 'accepted')}>Accept match</button>
                <button className="quiet" onClick={() => decide(c, 'rejected')}>
                  Reject
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {!list.length && <p className="empty">No candidate matches in your case scope.</p>}
    </section>
  );
}
