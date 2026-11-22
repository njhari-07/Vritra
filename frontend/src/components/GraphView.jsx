import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';

// "Case File Night" entity colours, shared with the 3D views.
const NODE_THEMES = {
  Person: { bg: '#5AA9FF', border: '#2F7FD6', highlight: '#8EC5FF', shape: 'dot', size: 22 },
  Account: { bg: '#F2B544', border: '#C88E1F', highlight: '#F8CF7E', shape: 'box', size: 14 },
  Phone: { bg: '#3DD6B5', border: '#22A88B', highlight: '#7FF0D6', shape: 'dot', size: 14 },
  Transaction: { bg: '#8D87B3', border: '#5E5986', highlight: '#A59FC4', shape: 'dot', size: 8 },
  Case: { bg: '#EDF2FA', border: '#A59FC4', highlight: '#FFFFFF', shape: 'diamond', size: 26 },
  Location: { bg: '#A98BFF', border: '#7A5CE0', highlight: '#C7B4FF', shape: 'dot', size: 16 },
  Organization: { bg: '#C9C3E8', border: '#8D87B3', highlight: '#E3DFF5', shape: 'square', size: 18 },
  Document: { bg: '#4A5B7C', border: '#233350', highlight: '#6B7DA0', shape: 'box', size: 12 }
};

const EDGE_STYLES = {
  TRANSACTED_WITH: { color: '#F2B544', width: 1.8, dashes: false, arrow: true },
  SENT_FROM: { color: '#C88E1F', width: 1, dashes: false, arrow: true },
  SENT_TO: { color: '#C88E1F', width: 1, dashes: false, arrow: true },
  OWNS_ACCOUNT: { color: '#5AA9FF', width: 2.2, dashes: false, arrow: true },
  COMMUNICATED_WITH: { color: '#3DD6B5', width: 2, dashes: [5, 4], arrow: false },
  INVOLVED_IN_CASE: { color: '#C9C3E8', width: 1.6, dashes: [4, 4], arrow: true },
  LOCATED_AT: { color: '#A98BFF', width: 1.2, dashes: false, arrow: true },
  MENTIONED_IN: { color: '#3A4D72', width: 0.8, dashes: [2, 3], arrow: false },
  FILED_UNDER: { color: '#3A4D72', width: 0.8, dashes: [2, 3], arrow: false }
};

export default function GraphView({ graph, onSelect, darkMode = false, height = '560px' }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const nodesDataSetRef = useRef(null);
  const edgesDataSetRef = useRef(null);

  // View & Filter States
  const [viewMode, setViewMode] = useState('clean'); // 'clean' (Entities & Flow) vs 'full' (All Nodes)
  const [layoutMode, setLayoutMode] = useState('forceAtlas2'); // 'forceAtlas2', 'hierarchical', 'barnesHut'
  const [physicsActive, setPhysicsActive] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [minDegree, setMinDegree] = useState(0); // 0 = show all, 1 = hide isolated, 2+ = show hubs

  // Available node types with counts in current graph
  const typeCounts = useMemo(() => {
    if (!graph || !graph.nodes) return {};
    const counts = {};
    graph.nodes.forEach(n => {
      counts[n.type] = (counts[n.type] || 0) + 1;
    });
    return counts;
  }, [graph]);

  // Active type filter selections
  const [enabledTypes, setEnabledTypes] = useState({
    Person: true,
    Account: true,
    Case: true,
    Location: true,
    Organization: true,
    Document: false,
    Transaction: false
  });

  // When switching viewMode, toggle default type filters
  useEffect(() => {
    if (viewMode === 'clean') {
      setEnabledTypes({
        Person: true,
        Account: true,
        Case: true,
        Location: true,
        Organization: true,
        Document: false,
        Transaction: false
      });
    } else {
      setEnabledTypes({
        Person: true,
        Account: true,
        Case: true,
        Location: true,
        Organization: true,
        Document: true,
        Transaction: true
      });
    }
  }, [viewMode]);

  const toggleType = type => {
    setEnabledTypes(prev => ({ ...prev, [type]: !prev[type] }));
  };

  // Calculate degrees to support degree filtering
  const degreeMap = useMemo(() => {
    if (!graph || !graph.edges) return {};
    const deg = {};
    graph.edges.forEach(e => {
      deg[e.source] = (deg[e.source] || 0) + 1;
      deg[e.target] = (deg[e.target] || 0) + 1;
    });
    return deg;
  }, [graph]);

  // Filtered nodes and edges based on mode, types, and degree
  const filteredData = useMemo(() => {
    if (!graph || !graph.nodes || !graph.edges) return { nodes: [], edges: [] };

    // In clean mode, exclude Transaction and Document nodes by default
    let candidateNodes = graph.nodes.filter(n => {
      if (!enabledTypes[n.type]) return false;
      if (viewMode === 'clean' && (n.type === 'Transaction' || n.type === 'Document')) return false;
      const deg = degreeMap[n.id] || 0;
      if (minDegree > 0 && deg < minDegree && n.type !== 'Person' && n.type !== 'Case') return false;
      return true;
    });

    const candidateNodeIds = new Set(candidateNodes.map(n => n.id));

    // Edges
    let candidateEdges = graph.edges.filter(e => {
      if (!candidateNodeIds.has(e.source) || !candidateNodeIds.has(e.target)) return false;
      if (viewMode === 'clean') {
        // In clean mode, skip SENT_FROM and SENT_TO because transactions connect via direct TRANSACTED_WITH
        if (e.type === 'SENT_FROM' || e.type === 'SENT_TO') return false;
      }
      return true;
    });

    // Formatting Vis nodes
    const visNodes = candidateNodes.map(n => {
      const base = NODE_THEMES[n.type] || { bg: '#8D87B3', border: '#5E5986', shape: 'dot', size: 10 };
      // Case nodes are white on the dark canvas; on the light canvas they switch to navy to stay visible.
      const theme = !darkMode && n.type === 'Case' ? { ...base, bg: '#0A1020', border: '#0A1020', highlight: '#233350' } : base;
      const isSelected = selectedNode && selectedNode.id === n.id;
      const isPerson = n.type === 'Person';
      const isCase = n.type === 'Case';

      let labelText = n.label || n.id;
      if (labelText.length > 24) labelText = labelText.slice(0, 22) + '…';

      return {
        id: n.id,
        label: labelText,
        title: `${n.type}: ${n.label} (${n.id})`,
        shape: theme.shape,
        size: isSelected ? theme.size * 1.3 : theme.size,
        color: {
          background: theme.bg,
          border: isSelected ? '#ffffff' : theme.border,
          highlight: {
            background: theme.highlight,
            border: '#ffffff'
          }
        },
        borderWidth: isSelected ? 4 : isPerson ? 2.5 : 1.5,
        font: {
          size: isPerson || isCase ? 12 : 10,
          bold: isPerson || isCase,
          color: darkMode ? '#f8fafc' : '#0f172a',
          background: darkMode ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.85)',
          strokeWidth: 0
        },
        shadow: isPerson ? { enabled: true, color: 'rgba(245,158,11,0.3)', size: 8 } : false,
        raw: n
      };
    });

    // Formatting Vis edges
    const visEdges = candidateEdges.map((e, idx) => {
      const style = EDGE_STYLES[e.type] || { color: '#94a3b8', width: 1, dashes: false, arrow: false };
      let edgeTitle = e.type;
      if (e.attrs && e.attrs.amount_paid) {
        edgeTitle += `: ${e.attrs.payment_currency || ''} ${Number(e.attrs.amount_paid).toLocaleString()}`;
      }

      return {
        id: `e-${idx}`,
        from: e.source,
        to: e.target,
        title: edgeTitle,
        color: {
          color: style.color,
          highlight: '#38bdf8',
          hover: '#38bdf8',
          opacity: 0.85
        },
        width: style.width,
        dashes: style.dashes,
        arrows: style.arrow ? { to: { enabled: true, scaleFactor: 0.6 } } : undefined,
        smooth: {
          enabled: true,
          type: 'curvedCW',
          roundness: 0.18
        }
      };
    });

    return { nodes: visNodes, edges: visEdges };
  }, [graph, enabledTypes, viewMode, minDegree, selectedNode, darkMode, degreeMap]);

  // Initialize and update Vis Network
  useEffect(() => {
    if (!containerRef.current) return;

    const nodesDataSet = new DataSet(filteredData.nodes);
    const edgesDataSet = new DataSet(filteredData.edges);
    nodesDataSetRef.current = nodesDataSet;
    edgesDataSetRef.current = edgesDataSet;

    let layoutConfig = {};
    let physicsConfig = {};

    if (layoutMode === 'hierarchical') {
      layoutConfig = {
        hierarchical: {
          enabled: true,
          direction: 'LR',
          sortMethod: 'directed',
          levelSeparation: 190,
          nodeSpacing: 110,
          treeSpacing: 160
        }
      };
      physicsConfig = { enabled: false };
    } else if (layoutMode === 'barnesHut') {
      layoutConfig = { hierarchical: false };
      physicsConfig = {
        enabled: physicsActive,
        solver: 'barnesHut',
        barnesHut: {
          gravitationalConstant: -18000,
          centralGravity: 0.03,
          springLength: 150,
          springConstant: 0.04,
          damping: 0.4,
          avoidOverlap: 0.75
        },
        stabilization: { iterations: 120 }
      };
    } else {
      // Default: forceAtlas2Based
      layoutConfig = { hierarchical: false };
      physicsConfig = {
        enabled: physicsActive,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -130,
          centralGravity: 0.007,
          springLength: 140,
          springConstant: 0.05,
          damping: 0.45,
          avoidOverlap: 0.85
        },
        stabilization: { iterations: 140, updateInterval: 25 }
      };
    }

    const options = {
      interaction: {
        hover: true,
        tooltipDelay: 150,
        zoomView: true,
        dragView: true,
        selectConnectedEdges: true,
        navigationButtons: true,
        keyboard: true
      },
      layout: layoutConfig,
      physics: physicsConfig
    };

    const network = new Network(containerRef.current, { nodes: nodesDataSet, edges: edgesDataSet }, options);
    networkRef.current = network;

    // Node Click & Selection Handling with Spotlight effect
    network.on('click', params => {
      if (params.nodes.length > 0) {
        const clickedId = params.nodes[0];
        const rawNode = graph.nodes.find(n => n.id === clickedId);
        setSelectedNode(rawNode || null);
        if (rawNode && onSelect) onSelect(rawNode);

        // Spotlight: highlight 1-hop connected neighbors, dim distant nodes
        const connectedNodeIds = new Set(network.getConnectedNodes(clickedId));
        connectedNodeIds.add(clickedId);

        const updateNodes = [];
        nodesDataSet.forEach(node => {
          if (connectedNodeIds.has(node.id)) {
            updateNodes.push({ id: node.id, opacity: 1 });
          } else {
            updateNodes.push({ id: node.id, opacity: 0.15 });
          }
        });
        nodesDataSet.update(updateNodes);
      } else {
        // Reset spotlight on background click
        setSelectedNode(null);
        const resetNodes = [];
        nodesDataSet.forEach(node => {
          resetNodes.push({ id: node.id, opacity: 1 });
        });
        nodesDataSet.update(resetNodes);
      }
    });

    return () => {
      if (network) network.destroy();
    };
  }, [filteredData, layoutMode, physicsActive]);

  // Search & Focus function
  const handleSearch = e => {
    e.preventDefault();
    if (!searchQuery.trim() || !networkRef.current) return;
    const q = searchQuery.toLowerCase().trim();
    const match = graph.nodes.find(
      n => n.id.toLowerCase().includes(q) || (n.label && n.label.toLowerCase().includes(q))
    );
    if (match) {
      networkRef.current.focus(match.id, {
        scale: 1.25,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' }
      });
      networkRef.current.selectNodes([match.id]);
      setSelectedNode(match);
      if (onSelect) onSelect(match);
    }
  };

  // Fit View / Center
  const handleFitView = () => {
    if (networkRef.current) {
      networkRef.current.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }
  };

  // Toggle Physics Play/Pause
  const togglePhysics = () => {
    const nextState = !physicsActive;
    setPhysicsActive(nextState);
    if (networkRef.current) {
      networkRef.current.setOptions({ physics: { enabled: nextState } });
    }
  };

  return (
    <div className="graph-view-wrapper">
      {/* Top Toolbar */}
      <div className="graph-view-toolbar">
        <div className="toolbar-left">
          {/* View Mode Switcher */}
          <div className="segmented-control" role="group" aria-label="Graph View Mode">
            <button
              className={`segmented-btn ${viewMode === 'clean' ? 'active' : ''}`}
              onClick={() => setViewMode('clean')}
              title="Untangled view showing direct person-to-person and account flows"
            >
              Key Entities & Flows ({filteredData.nodes.length})
            </button>
            <button
              className={`segmented-btn ${viewMode === 'full' ? 'active' : ''}`}
              onClick={() => setViewMode('full')}
              title="Complete forensic topology including all raw transaction and document nodes"
            >
              Full Forensic Topology
            </button>
          </div>

          {/* Layout Selector */}
          <select
            className="graph-select"
            value={layoutMode}
            onChange={e => setLayoutMode(e.target.value)}
            title="Graph Physics & Layout Algorithm"
          >
            <option value="forceAtlas2">Clustered (ForceAtlas2)</option>
            <option value="hierarchical">Flow Hierarchy (Tree L→R)</option>
            <option value="barnesHut">Organic Spread (Barnes-Hut)</option>
          </select>
        </div>

        <div className="toolbar-right">
          {/* Quick Node Search */}
          <form onSubmit={handleSearch} className="graph-search-form">
            <input
              type="text"
              placeholder="Find entity (e.g., Mehta, 8000EBD30)…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="graph-search-input"
            />
            <button type="submit" className="graph-icon-btn" title="Focus entity">
              Search
            </button>
          </form>

          {/* Physics Play / Pause */}
          <button
            onClick={togglePhysics}
            className={`graph-icon-btn ${!physicsActive ? 'paused' : ''}`}
            title={physicsActive ? 'Freeze physics positions' : 'Resume layout physics'}
          >
            {physicsActive ? '⏸ Freeze' : '▶ Relax'}
          </button>

          {/* Fit View */}
          <button onClick={handleFitView} className="graph-icon-btn" title="Zoom to fit all nodes">
            ⛶ Fit View
          </button>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="graph-filter-bar">
        <span className="filter-label">Filter Entities:</span>
        {Object.entries(NODE_THEMES).map(([type, theme]) => {
          const count = typeCounts[type] || 0;
          if (count === 0) return null;
          const isEnabled = !!enabledTypes[type];
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`type-pill ${isEnabled ? 'active' : 'disabled'}`}
              style={{
                borderColor: isEnabled ? theme.border : 'transparent',
                backgroundColor: isEnabled ? ('var(--bg-subtle)') : 'transparent'
              }}
            >
              <span className="type-dot" style={{ backgroundColor: theme.bg }} />
              <span className="type-name">{type}</span>
              <span className="type-badge">{count}</span>
            </button>
          );
        })}

        {/* Degree filter slider */}
        <div className="degree-filter">
          <label title="Filter out peripheral accounts with few connections">
            Min Connections: <strong>{minDegree}+</strong>
          </label>
          <input
            type="range"
            min="0"
            max="4"
            step="1"
            value={minDegree}
            onChange={e => setMinDegree(Number(e.target.value))}
            className="degree-slider"
          />
        </div>
      </div>

      {/* Vis Canvas Container */}
      <div
        ref={containerRef}
        className="graph-canvas-container"
        style={{ height }}
        aria-label="Interactive forensic network canvas"
      />

      {/* Footer Legend */}
      <div className="graph-footer-legend">
        <div className="legend-items">
          <span><i style={{ background: '#F2B544' }} /> Transacted With / Fund Flow</span>
          <span><i style={{ background: '#5AA9FF' }} /> Owns Account</span>
          <span><i style={{ background: '#3DD6B5', borderStyle: 'dashed' }} /> Call Intercept</span>
          <span><i style={{ background: '#C9C3E8' }} /> Case Link</span>
        </div>
        <div className="legend-tip">
          Click any node to spotlight its direct network · Click background to reset
        </div>
      </div>
    </div>
  );
}
