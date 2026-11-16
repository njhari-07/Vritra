import React, { lazy, Suspense, useState } from 'react';
import GraphView from './GraphView';

// three.js is loaded only when the 3D view is opened.
const Graph3D = lazy(() => import('./three/Graph3D'));

/**
 * GraphExplorerTab — interactive case graph with a 3D (three.js) and a 2D (vis-network) view.
 */
export default function GraphExplorerTab({ graph, activeCase, search, setSearch, setSelected, darkMode }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('maha_graph_mode') || '3d'; } catch { return '3d'; }
  });
  const [focusId, setFocusId] = useState(null);

  const switchMode = m => {
    setMode(m);
    try { localStorage.setItem('maha_graph_mode', m); } catch { /* storage unavailable */ }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Authorized source graph ({activeCase})</h2>
        <div className="graph-head-tools">
          <div className="view-switch" role="group" aria-label="Graph view">
            {[['3d', '3D network'], ['2d', '2D map']].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m}
                className={mode === m ? 'active' : ''} onClick={() => switchMode(m)}>{label}</button>
            ))}
          </div>
          <input
            aria-label="Search graph"
            placeholder="Find an entity…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      {search && (
        <div className="search-results">
          {graph?.nodes
            ?.filter(n => n.label.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 10)
            .map(n => (
              <button key={n.id} onClick={() => { setSelected(n); setFocusId(n.id); }}>
                {n.label}
              </button>
            ))}
        </div>
      )}
      {mode === '3d' ? (
        <Suspense fallback={<div className="g3d-empty" style={{ height: '650px' }}>Loading 3D view…</div>}>
          <Graph3D graph={graph} onSelect={setSelected} focusId={focusId} height="650px" />
        </Suspense>
      ) : (
        <GraphView graph={graph} onSelect={setSelected} darkMode={darkMode} height="650px" />
      )}
      <div className="legend">
        Select a node to inspect its assertions and evidence. Documents are excluded from structural
        metrics. Position in the layout carries no meaning on its own.
      </div>
    </section>
  );
}
