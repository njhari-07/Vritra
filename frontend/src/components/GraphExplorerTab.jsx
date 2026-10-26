import React from 'react';
import GraphView from './GraphView';

/**
 * GraphExplorerTab — full-screen interactive graph with entity search
 * and entity spotlight via vis-network / ForceAtlas2.
 */
export default function GraphExplorerTab({ graph, activeCase, search, setSearch, setSelected, darkMode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Authorized source graph ({activeCase})</h2>
        <input
          aria-label="Search graph"
          placeholder="Find an entity…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {search && (
        <div className="search-results">
          {graph?.nodes
            ?.filter(n => n.label.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 10)
            .map(n => (
              <button key={n.id} onClick={() => setSelected(n)}>
                {n.label}
              </button>
            ))}
        </div>
      )}
      <GraphView graph={graph} onSelect={setSelected} darkMode={darkMode} height="650px" />
      <div className="legend">
        Select a node to inspect its assertions and evidence. Documents are excluded from structural
        metrics.
      </div>
    </section>
  );
}
