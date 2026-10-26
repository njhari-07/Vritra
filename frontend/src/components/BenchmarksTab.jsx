import React from 'react';

/**
 * BenchmarksTab — temporal evaluation results for Elliptic and IBM datasets.
 * Classification metrics only; do not interpret as person-level guilt indicators.
 */
export default function BenchmarksTab({ list }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Temporal evaluation</h2>
        <span className="badge">DATASETS REPORTED SEPARATELY</span>
      </div>
      {list.map(r => (
        <article className="benchmark" key={r.dataset}>
          <h2>{r.dataset}</h2>
          <p>{r.scope}</p>
          <span className="tag">
            {r.synthetic ? 'SYNTHETIC · ILLUSTRATIVE' : 'REAL TRANSACTION BENCHMARK'}
          </span>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Average precision</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.metrics).map(([name, m]) => (
                <tr key={name}>
                  <td>{name.replaceAll('_', ' ')}</td>
                  <td>{(m.precision * 100).toFixed(1)}%</td>
                  <td>{(m.recall * 100).toFixed(1)}%</td>
                  <td>{m.average_precision.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{r.synthetic ? r.selection : r.features}</p>
          <small>
            Classification metrics only. These do not validate person identity, case links, or
            investigative conclusions.
          </small>
        </article>
      ))}
      {!list.length && <p className="empty">Run the benchmark commands to populate this view.</p>}
    </section>
  );
}
