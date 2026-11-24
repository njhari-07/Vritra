import React, { lazy, Suspense, useState } from 'react';
import { Box, Network } from 'lucide-react';
import GraphView from './GraphView';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// three.js is loaded only when the 3D view is opened.
const Graph3D = lazy(() => import('./three/Graph3D'));

/**
 * GraphExplorerTab — interactive case graph with a 3D (three.js) and a 2D (vis-network) view.
 * In 3D, clicking an entity opens the details panel; its "View sources" button opens the evidence drawer.
 */
export default function GraphExplorerTab({ graph, analysis, activeCase, search, setSearch, setSelected, darkMode }) {
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
          <Tabs value={mode} onValueChange={switchMode}>
            <TabsList aria-label="Graph view">
              <TabsTrigger value="3d" className="tw:min-h-0"><Box />3D network</TabsTrigger>
              <TabsTrigger value="2d" className="tw:min-h-0"><Network />2D map</TabsTrigger>
            </TabsList>
          </Tabs>
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
              <button key={n.id} onClick={() => (mode === '3d' ? setFocusId(n.id) : setSelected(n))}>
                {n.label}
              </button>
            ))}
        </div>
      )}
      {mode === '3d' ? (
        <Suspense fallback={<div className="g3d-empty" style={{ height: '680px' }}>Loading 3D view…</div>}>
          <Graph3D graph={graph} analysis={analysis} onSelect={setSelected} focusId={focusId} height="680px" />
        </Suspense>
      ) : (
        <GraphView graph={graph} onSelect={setSelected} darkMode={darkMode} height="650px" />
      )}
      <div className="legend">
        {mode === '3d'
          ? 'Click an entity for its connections and findings. Use Loops to trace money hop by hop, Timeline to replay activity by date, and Groups to arrange the network by community or case.'
          : 'Select a node to inspect its assertions and evidence.'}{' '}
        Documents are excluded from structural metrics. Position in the layout carries no meaning on its own.
      </div>
    </section>
  );
}
