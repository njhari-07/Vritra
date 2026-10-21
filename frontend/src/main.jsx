import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import '@dotlottie/player-component';
import './style.css';

const colors = {
  Person: '#d29b4e',
  Account: '#5d8999',
  Transaction: '#95aaa1',
  Case: '#344c49',
  Location: '#b28094',
  Organization: '#8b88a8',
  Document: '#b5b2a6'
};

function Graph({ graph, onSelect }) {
  const el = useRef();
  useEffect(() => {
    if (!graph || !graph.nodes) return;
    const n = new Network(
      el.current,
      {
        nodes: new DataSet(
          graph.nodes.map(x => ({
            id: x.id,
            label: x.label.length > 24 ? x.label.slice(0, 23) + '…' : x.label,
            color: colors[x.type] || '#889988',
            shape: x.type === 'Case' ? 'diamond' : 'dot',
            size: x.type === 'Person' ? 15 : 8,
            title: x.type,
            font: { size: 11, color: '#293f3d' }
          }))
        ),
        edges: new DataSet(
          graph.edges.map((e, i) => ({
            id: i,
            from: e.source,
            to: e.target,
            title: e.type,
            color: { color: '#c7d2ce' },
            width: 0.7
          }))
        )
      },
      {
        interaction: { hover: true },
        physics: { stabilization: { iterations: 100 }, barnesHut: { gravitationalConstant: -2600 } },
        nodes: { borderWidth: 0 },
        edges: { smooth: false }
      }
    );
    n.on('selectNode', e => {
      const x = graph.nodes.find(x => x.id === e.nodes[0]);
      if (x) onSelect(x);
    });
    return () => n.destroy();
  }, [graph]);
  return <div className="network" ref={el} aria-label="Interactive evidence graph" />;
}

function App() {
  const defaultToken = 'WT49DfCpDyYerqLF_cQI-hkzH7Et7UXGZNUrb_EcneA';
  const [token, setToken] = useState(() => localStorage.getItem('maha_token') || defaultToken);
  const [input, setInput] = useState(() => localStorage.getItem('maha_token') || defaultToken);
  const [me, setMe] = useState(null);

  // Dark Canvas / Theme Mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('maha_theme');
    if (saved) return saved === 'dark';
    return false;
  });

  useEffect(() => {
    localStorage.setItem('maha_theme', darkMode ? 'dark' : 'light');
    if (darkMode) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [darkMode]);
  const [casesList, setCasesList] = useState([]);
  const [activeCase, setActiveCase] = useState('');
  const [graph, setGraph] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ev, setEv] = useState(null);
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [notice, setNotice] = useState('');

  // AI Copilot
  const [copilotQuery, setCopilotQuery] = useState('');
  const [copilotResult, setCopilotResult] = useState(null);
  const [copilotBusy, setCopilotBusy] = useState(false);

  // Model Training Pipeline State
  const [isTraining, setIsTraining] = useState(false);
  const [trainStep, setTrainStep] = useState(0);
  const [showTrainingStudio, setShowTrainingStudio] = useState(false);

  // Feature 1: Hop-by-Hop Fund Trail Visualizer
  const [expandedTrail, setExpandedTrail] = useState(null);

  // Feature 3: Raw Free-Text Ingestor
  const [rawText, setRawText] = useState('');
  const [rawTitle, setRawTitle] = useState('FIR-CRIME-REGISTRY-01');
  const [rawSourceType, setRawSourceType] = useState('police_fir');

  // Feature 4: ML Tuning & Weights
  const [showTuning, setShowTuning] = useState(false);
  const [contamination, setContamination] = useState(0.05);
  const [wFinancial, setWFinancial] = useState(35);
  const [wCourt, setWCourt] = useState(30);
  const [wCentrality, setWCentrality] = useState(20);
  const [wCrossCase, setWCrossCase] = useState(15);

  // Modals
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [newCaseInput, setNewCaseInput] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState(null);

  const api = async (path, options = {}) => {
    const r = await fetch('/api' + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...options.headers }
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({ detail: r.statusText }));
      throw Error(d.detail || 'Request failed');
    }
    return r.json();
  };

  const load = async targetCase => {
    setBusy(true);
    setError('');
    try {
      const m = await api('/me');
      setMe(m);
      const cList = await api('/cases');
      setCasesList(cList);
      const selCase = targetCase || activeCase || (cList[0] ? cList[0].case_id : m.cases[0] || 'DEMO-C01');
      setActiveCase(selCase);
      const [g, a] = await Promise.all([
        api('/graph?case=' + encodeURIComponent(selCase)),
        api('/analysis?case=' + encodeURIComponent(selCase))
      ]);
      setGraph(g);
      setAnalysis(a);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  useEffect(() => {
    setSelected(null);
    setEv(null);
    setList([]);
    if (!me) return;
    const paths = {
      Resolution: '/candidates',
      Timeline: '/timeline',
      Quality: '/quality',
      Audit: '/audit',
      Benchmarks: '/benchmarks'
    };
    if (paths[tab]) api(paths[tab]).then(setList).catch(e => setError(e.message));
  }, [tab, me]);

  const changeCase = cId => {
    setActiveCase(cId);
    setShowTrainingStudio(false);
    load(cId);
  };

  const handleCreateCase = async e => {
    e.preventDefault();
    const cId = newCaseInput.trim().toUpperCase();
    if (!cId) return;
    setBusy(true);
    try {
      await api('/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: cId })
      });
      setShowNewCaseModal(false);
      setNewCaseInput('');
      setNotice(`Case "${cId}" created. Ingest investigation data or load sample package to begin.`);
      await load(cId);
      setTab('Suspects');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetCase = async () => {
    if (!window.confirm(`Are you sure you want to reset case "${activeCase}"? All ingested evidence records, graph nodes, and trained suspect models for this case will be permanently cleared.`)) return;
    setBusy(true);
    try {
      await api(`/cases/${encodeURIComponent(activeCase)}/reset`, { method: 'POST' });
      setNotice(`Case "${activeCase}" reset. All records cleared. Ready for fresh data.`);
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSample = async () => {
    setBusy(true);
    try {
      await api(`/cases/${encodeURIComponent(activeCase)}/load-sample`, { method: 'POST' });
      setNotice(`Sample Evidence Package loaded into ${activeCase} (3 Court Cases, 3 Crime FIRs, 3 CDR Calls, 3-hop Money Loop). Ready for ML Model Training!`);
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleTrainModels = async () => {
    setIsTraining(true);
    setTrainStep(1);
    try {
      // Animated stepper progression
      await new Promise(r => setTimeout(r, 600));
      setTrainStep(2);
      await new Promise(r => setTimeout(r, 700));
      setTrainStep(3);
      await new Promise(r => setTimeout(r, 700));
      setTrainStep(4);
      await new Promise(r => setTimeout(r, 800));
      setTrainStep(5);

      const res = await api(`/cases/${encodeURIComponent(activeCase)}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contamination: parseFloat(contamination),
          weight_financial: parseFloat(wFinancial),
          weight_court: parseFloat(wCourt),
          weight_centrality: parseFloat(wCentrality),
          weight_cross_case: parseFloat(wCrossCase)
        })
      });

      await new Promise(r => setTimeout(r, 500));
      setNotice(`⚡ ML Models Trained Successfully! Extracted ${res.suspects.length} ranked suspects with provenance seals.`);
      setShowTrainingStudio(false);
      await load(activeCase);
      setTab('Suspects');
    } catch (e) {
      setError(e.message);
    } finally {
      setIsTraining(false);
      setTrainStep(0);
    }
  };

  const handleDirectUpload = async (kind, file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api(`/import/${kind}/${encodeURIComponent(activeCase)}`, {
        method: 'POST',
        body: file
      });
      setNotice(`Evidence accepted into ${activeCase}: ${r.accepted_new} new records · ${r.recognized_repeat} repeats · ${r.quarantined} quarantined.`);
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRawTextImport = async () => {
    if (!rawText.trim()) return;
    setBusy(true);
    try {
      const res = await api(`/import/raw-text/${encodeURIComponent(activeCase)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: rawText.trim(),
          title: rawTitle.trim() || 'FREE-TEXT-FIR',
          source_type: rawSourceType
        })
      });
      setNotice(`Zero-Shot NLP parsed ${res.records_parsed} entities & assertions from raw text into ${activeCase}.`);
      setRawText('');
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openTemplateModal = async () => {
    try {
      const t = await api('/templates?case=' + encodeURIComponent(activeCase));
      setTemplates(t);
      setShowTemplateModal(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const downloadFile = (filename, content, type) => {
    const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded template: ${filename}`);
  };

  const evidence = async id => {
    try {
      setEv(await api('/evidence/' + id));
    } catch (e) {
      setError(e.message);
    }
  };

  const exportReport = async () => {
    try {
      const data = await api('/report');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `investigator-review-${activeCase}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Evidence-linked report exported');
    } catch (e) {
      setError(e.message);
    }
  };

  const review = async (lead, state) => {
    const reason = window.prompt('Record your review rationale');
    if (!reason) return;
    try {
      await api('/leads/' + lead.id + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, reason })
      });
      setNotice('Review saved');
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    }
  };

  const decide = async (c, state) => {
    const reason = window.prompt('Reason for this identity decision');
    if (!reason) return;
    try {
      await api('/candidates/' + c.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, reason })
      });
      await load(activeCase);
      setList(await api('/candidates'));
      setNotice('Resolution decision saved');
    } catch (e) {
      setError(e.message);
    }
  };

  const upload = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      file = f.get('file');
    if (!file?.size) return;
    setBusy(true);
    try {
      const r = await api(`/import/${f.get('kind')}/${encodeURIComponent(f.get('case'))}`, {
        method: 'POST',
        body: file
      });
      setNotice(`${r.accepted_new} accepted · ${r.recognized_repeat} repeated · ${r.quarantined} quarantined`);
      await load(f.get('case'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const askCopilot = async qText => {
    const q = (qText || copilotQuery).trim();
    if (!q) return;
    setCopilotBusy(true);
    try {
      const res = await api('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      setCopilotResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setCopilotBusy(false);
    }
  };

  const downloadDossier = async s => {
    try {
      const d = await api('/dossier/' + s.id + '?case=' + encodeURIComponent(activeCase));
      const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `prosecution-dossier-${s.authoritative_id || s.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Official prosecution dossier exported with SHA-256 seal for ${s.name}`);
    } catch (e) {
      setError(e.message);
    }
  };

  const isolateInGraph = s => {
    setTab('Graph explorer');
    setSearch(s.name);
    const n = graph?.nodes?.find(n => n.id === s.id);
    if (n) setSelected(n);
  };

  if (!me)
    return (
      <main className={`login ${darkMode ? 'dark-theme' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setDarkMode(prev => !prev)}
            title={darkMode ? "Switch to light canvas" : "Switch to dark canvas"}
          >
            <span>{darkMode ? '☀️' : '🌙'}</span> {darkMode ? 'Light Canvas' : 'Dark Canvas'}
          </button>
        </div>
        <div className="wordmark">
          M<span>✳</span>HA
        </div>
        <p className="eyebrow">INVESTIGATION WORKSPACE / LOCAL PROTOTYPE</p>
        <h1>
          Follow the evidence.
          <br />
          Understand the connections.
        </h1>
        <p>Enter your local access token to open your authorized cases.</p>
        <form
          onSubmit={e => {
            e.preventDefault();
            localStorage.setItem('maha_token', input);
            if (input === token) load();
            else setToken(input);
          }}
        >
          <input
            type="password"
            aria-label="Access token"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Local access token"
            required
          />
          <button disabled={busy}>{busy ? 'Opening…' : 'Open workspace →'}</button>
        </form>
        <div style={{ marginTop: '10px' }}>
          <button
            type="button"
            className="quiet"
            style={{ fontSize: '11px', padding: '6px 12px' }}
            onClick={() => {
              setInput(defaultToken);
              setToken(defaultToken);
              localStorage.setItem('maha_token', defaultToken);
            }}
          >
            ⚡ Auto-Fill Local Investigator Token
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <small>
          Token file: data/private/runtime/access.json
          <br />
          Synthetic demonstration · Decision support, never a verdict
        </small>
      </main>
    );

  const activeStatus = casesList.find(c => c.case_id === activeCase) || {
    case_id: activeCase,
    facts_count: graph?.nodes?.length || 0,
    is_trained: analysis?.is_trained || false
  };

  const isTrained = analysis?.is_trained && (analysis?.suspects?.length > 0);
  const connections = analysis?.leads?.filter(l => l.category === 'connection') || [];
  const behavior = analysis?.leads?.filter(l => l.category === 'flagged_behavior') || [];
  const suspects = analysis?.suspects || [];

  const leads = tab === 'Flagged behavior' ? behavior : connections;
  const filtered = leads.filter(l =>
    (l.reason + ' ' + l.subject_ids.map(id => graph?.nodes?.find(n => n.id === id)?.label).join(' ')).toLowerCase().includes(search.toLowerCase())
  );

  const filteredSuspects = suspects.filter(s => {
    const matchText = (s.name + ' ' + s.title + ' ' + (s.role || '') + ' ' + s.why_flagged.join(' ')).toLowerCase().includes(search.toLowerCase());
    const matchRisk = riskFilter === 'ALL' || s.risk_level === riskFilter;
    return matchText && matchRisk;
  });

  return (
    <div className={`shell ${darkMode ? 'dark-theme' : ''}`}>
      <aside className="sidebar">
        <div className="wordmark">
          M<span>✳</span>HA
        </div>
        <p className="eyebrow">EVIDENCE WORKSPACE</p>
        <nav>
          {[
            'Overview',
            'Suspects',
            'Connections',
            'Flagged behavior',
            'Graph explorer',
            'Resolution',
            'Timeline',
            'Import records',
            'Quality',
            'Audit',
            'Benchmarks'
          ].map((name, i) => (
            <button
              key={name}
              className={tab === name ? 'active' : ''}
              onClick={() => {
                setTab(name);
                setSearch('');
              }}
            >
              <span className="nav-icon">{['◈', '⚡', '⌘', '⚑', '◎', '⇄', '◷', '＋', '☷', '☰', '▥'][i]}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="theme-toggle-btn"
            style={{ width: '100%', justifyContent: 'center', marginBottom: '14px' }}
            onClick={() => setDarkMode(prev => !prev)}
            title={darkMode ? "Switch to light canvas" : "Switch to dark canvas"}
          >
            <span>{darkMode ? '☀️' : '🌙'}</span> {darkMode ? 'Light Canvas' : 'Dark Canvas'}
          </button>
          <span className="dot" /> Local workspace
          <p>
            {me.name} · {casesList.length} cases
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('maha_token');
              setMe(null);
              setToken('');
              setInput('');
              setGraph(null);
              setAnalysis(null);
            }}
          >
            Lock workspace ↗
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header>
          <span>
            Workspace <b>/ {tab}</b>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={() => setDarkMode(prev => !prev)}
              title={darkMode ? "Switch to light canvas" : "Switch to dark canvas"}
            >
              <span>{darkMode ? '☀️' : '🌙'}</span> {darkMode ? 'Light Canvas' : 'Dark Canvas'}
            </button>
            <span className="badge">{tab === 'Benchmarks' ? 'SEPARATE BENCHMARKS' : 'SYNTHETIC DEMO'}</span>
            <button className="quiet" onClick={exportReport}>
              Export report ↗
            </button>
          </div>
        </header>

        {/* Dynamic Case Selector & Intake Management Bar */}
        <section className="case-bar">
          <div className="case-bar-left">
            <span className="case-label">Active Investigation:</span>
            <select
              className="case-select"
              value={activeCase}
              onChange={e => changeCase(e.target.value)}
              aria-label="Active Case"
            >
              {casesList.map(c => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} ({c.facts_count} facts · {c.is_trained ? 'Trained' : 'Untrained'})
                </option>
              ))}
            </select>

            <span className={`case-status-pill ${isTrained ? 'status-trained' : 'status-untrained'}`}>
              {isTrained ? `● ML Models Trained (${suspects.length} Suspects)` : `○ Untrained · Awaiting ML Execution`}
            </span>
          </div>

          <div className="case-actions">
            <button className="btn-new-case" onClick={() => setShowNewCaseModal(true)}>
              + New Case
            </button>
            <button className="btn-reset-case" onClick={handleResetCase}>
              ↺ Reset Case
            </button>
            <button className="btn-tmpl" onClick={openTemplateModal}>
              📥 Data Templates
            </button>
            <button
              className="btn-new-case"
              style={{
                background: showTrainingStudio ? '#b09459' : '#174c44',
                color: showTrainingStudio ? '#102822' : '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              onClick={() => {
                setTab('Suspects');
                setShowTrainingStudio(!showTrainingStudio);
              }}
            >
              {showTrainingStudio ? '▲ View Ranked Suspects' : '➕ Add Evidence & Ingest Data'}
            </button>
          </div>
        </section>

        <section className="heading">
          <div>
            <p className="eyebrow">CASE INTELLIGENCE / {new Date().getFullYear()}</p>
            <h1>
              {tab === 'Overview'
                ? 'An evidence-first perspective.'
                : tab === 'Suspects'
                ? isTrained && !showTrainingStudio
                  ? 'Ranked Suspect Intelligence Dossiers'
                  : 'Investigation Intake & Model Training Studio'
                : tab}
            </h1>
            <p>
              {tab === 'Overview'
                ? 'Explore relationships. Review unusual activity. Keep every source within reach.'
                : tab === 'Suspects'
                ? isTrained && !showTrainingStudio
                  ? 'Synthesized across judicial proceedings, financial layering cycles, prior FIR records, and telecom communications.'
                  : 'Ingest multi-modal evidence across Court Proceedings, Financial Transactions, Crime Records, and Telecom CDR calls. Train the ML models to dynamically synthesize connections and identify suspects.'
                : 'Findings are for investigator review. A connection does not establish wrongdoing.'}
            </p>
          </div>
          <button className="quiet" onClick={() => load(activeCase)} disabled={busy}>
            {busy ? 'Updating…' : '↻ Refresh'}
          </button>
        </section>

        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice" onClick={() => setNotice('')}>
            {notice} ×
          </div>
        )}

        {/* OVERVIEW TAB */}
        {tab === 'Overview' && (
          <>
            {!isTrained && (
              <div
                style={{
                  background: '#fcf8ee',
                  border: '1px solid #ebd9a2',
                  borderRadius: '10px',
                  padding: '20px 24px',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <strong style={{ color: '#8a5e12', fontSize: '14px', display: 'block', marginBottom: '4px' }}>
                    ⚡ Investigation Case "{activeCase}" Requires ML Training
                  </strong>
                  <p style={{ margin: 0, fontSize: '12px', color: '#68501e' }}>
                    Suspects are withheld until the model is trained on case evidence. You have {activeStatus.facts_count} facts recorded in this case. Ingest records and trigger the ML pipeline to extract suspect dossiers.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-sample" style={{ color: '#173d32', background: '#fff', borderColor: '#ebd9a2' }} onClick={handleLoadSample}>
                    ⚡ Load Sample Package
                  </button>
                  <button
                    className="btn-train-primary"
                    style={{ padding: '10px 18px', fontSize: '12px' }}
                    onClick={() => {
                      setTab('Suspects');
                      setShowTrainingStudio(true);
                    }}
                  >
                    Open Training Studio →
                  </button>
                </div>
              </div>
            )}

            <section className="stats">
              {[
                [casesList.length, 'Authorized cases'],
                [suspects.length, isTrained ? 'Ranked suspects' : 'Suspects (Awaiting Train)'],
                [connections.length, 'Connection findings'],
                [behavior.length, 'Behavior findings']
              ].map(([v, l]) => (
                <div key={l}>
                  <span>{l}</span>
                  <strong>{v.toString().padStart(2, '0')}</strong>
                  <small>
                    {l.includes('Ranked suspects')
                      ? 'Composite risk scored (0-100)'
                      : l.includes('Behavior findings')
                      ? 'Review signals, not conclusions'
                      : `Case: ${activeCase}`}
                  </small>
                </div>
              ))}
            </section>

            <div className="overview-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">CONNECTED EVIDENCE</p>
                    <h2>The investigation network ({activeCase})</h2>
                  </div>
                  <button className="quiet" onClick={() => setTab('Graph explorer')}>
                    Explore ↗
                  </button>
                </div>
                <Graph graph={graph} onSelect={setSelected} />
                <div className="legend">
                  {Object.entries(colors).map(([k, v]) => (
                    <span key={k}>
                      <i style={{ background: v }} />
                      {k}
                    </span>
                  ))}
                </div>
              </section>

              <section className="panel review-panel">
                <p className="eyebrow">PRIORITY TARGETS</p>
                <h2>Suspects of interest</h2>
                {isTrained ? (
                  <>
                    <p>Top ranked suspects synthesized across court records and fund flows.</p>
                    {suspects.slice(0, 3).map(s => (
                      <button className="mini-lead" key={s.id} onClick={() => { setTab('Suspects'); setSelected(s); }}>
                        <span>⚡</span>
                        <div>
                          <strong>{s.title}: {s.name}</strong>
                          <p>{s.role} · Risk {s.risk_score} ({s.risk_level})</p>
                        </div>
                        <b>→</b>
                      </button>
                    ))}
                    <button className="quiet" style={{ marginTop: '12px', width: '100%' }} onClick={() => setTab('Suspects')}>
                      View all {suspects.length} suspect dossiers →
                    </button>
                  </>
                ) : (
                  <div style={{ padding: '20px 0' }}>
                    <p style={{ color: '#8c6827' }}>
                      No suspects shown yet. The model has not been trained on this case data.
                    </p>
                    <button
                      className="btn-train-primary"
                      style={{ width: '100%', marginTop: '8px', fontSize: '12px', padding: '12px' }}
                      onClick={() => setTab('Suspects')}
                    >
                      ⚡ Train Model on Data →
                    </button>
                  </div>
                )}
                <div className="note">
                  <strong>Context stays separate.</strong>
                  <p>Network position explains connections. Behavioral models flag unusual records. Neither is a guilt assessment.</p>
                </div>
              </section>
            </div>
          </>
        )}

        {/* SUSPECTS TAB */}
        {tab === 'Suspects' && (
          <>
            {/* If Untrained OR User clicked 'Ingest & Retrain', render the INTAKE & TRAINING STUDIO */}
            {(!isTrained || showTrainingStudio) && (
              <section className="intake-studio">
                <div className="intake-hero">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <h2>Investigation Evidence Intake & ML Training Studio</h2>
                      <p>
                        Feed real or synthetic multi-modal data into case <strong>{activeCase}</strong> across Judicial Proceedings, Financial Wires, Police FIRs, and Telecom CDR calls. When ready, execute the ML training pipeline to extract ranked suspect intelligence dossiers.
                      </p>
                    </div>
                    {isTrained && (
                      <button className="quiet" onClick={() => setShowTrainingStudio(false)}>
                        View Current Suspects ({suspects.length}) →
                      </button>
                    )}
                  </div>
                </div>

                {/* Feature 3: Raw Free-Text FIR / Court Judgment Zero-Shot Ingestor */}
                <div className="raw-text-panel">
                  <h3><span>📝</span> Raw Free-Text FIR / Court Judgment Zero-Shot Ingestor</h3>
                  <p>
                    Paste raw, unformatted police FIR text, interrogation transcripts, or judicial orders. The Zero-Shot NLP parser automatically extracts accused persons, bank accounts, and statutory sections without requiring JSON.
                  </p>
                  <div className="raw-text-presets">
                    <span style={{ fontSize: '11px', color: '#557063', alignSelf: 'center' }}>Sample Presets:</span>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawTitle('ED-PMLA-COMPLAINT-142');
                        setRawText(`IN THE SPECIAL COURT FOR PMLA OFFENSES: Directorate of Enforcement vs. Vikram Singhania [ID:P001] & Ors.\nPrime Accused Vikram Singhania operates HDFC Bank account 001928374 for layering procurement fraud kickbacks of ₹14,200,000.\nCo-conspirator Rajesh Sharma operates ICICI Bank account 009847261 as hawala mule routing pass-through tranches.\nCharges registered under PMLA Section 3 & 4 and IPC Section 420 and 120B.\nNon-Bailable Warrant issued by EOW.`);
                      }}
                    >
                      ⚡ Preset 1: PMLA Procurement FIR
                    </button>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawTitle('CYBER-PS-FIR-204');
                        setRawText(`CYBER CRIME POLICE STATION: State vs. Dev Shah [ID:P003] & Associates.\nAccused Dev Shah operates darknet crypto conversion infrastructure and Axis Bank account 005511223.\nMule coordinator Vikas Agarwal routed funds through Axis Bank and ICICI Bank.\nFIR No. 204/2023 under IT Act Section 66D and IPC Section 420. Look-Out Circular (LOC) active at international airports.`);
                      }}
                    >
                      ⚡ Preset 2: Cyber Financial Fraud FIR
                    </button>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawTitle(`EOW-FIR-144-${activeCase}`);
                        setRawText(`POLICE STATION: Economic Offenses Wing (EOW), Mandir Marg, New Delhi\nFIR No: 144/2026 | Date: 12-03-2026\nActs & Sections: Section 420 IPC (Cheating), Section 120B IPC (Criminal Conspiracy), read with Section 3 & 4 of Prevention of Money Laundering Act, 2002 (PMLA).\n(i) Accused Vikram Malhotra [ID:P101], Managing Director, Zenith Health Ventures Ltd. Role: Prime Syndicate Mastermind and beneficial owner of destination fund accounts.\n(ii) Accused Sanjay Agarwal [ID:P102], Financial Consultant & Hawala Remittance Mule Coordinator. Operates account ACC-AGARWAL-882 at Bank 010.\n(iii) Accused Karan Singhania [ID:P103], Dummy Director, Apex Logistics Front Corp. Operates account ACC-APEXSHELL-993 at Bank 010.\n(iv) Accused Rohit Verma [ID:P104], Operator of unauthorized digital escrow and crypto mixing channels, account ACC-VERMA-104 at Bank 010.\nAllegations: Accused Vikram Malhotra [ID:P101] utilized shell corporate vehicles to route approximately $750,000 USD of misappropriated funds through closed-loop layering transfers. Primary layering was executed through bank account 010 / ACC-MALHOTRA-771 into mule account 010 / ACC-AGARWAL-882, which was then layered into shell account 010 / ACC-APEXSHELL-993 before returning into primary beneficiary accounts under the guise of dividend reinvestment.`);
                      }}
                    >
                      ⚡ Preset 3: Zenith Healthcare Syndicate (P101/P102/P103)
                    </button>
                  </div>
                  <textarea
                    className="raw-text-area"
                    placeholder="Paste raw police FIR, prosecution complaint, or interrogation transcript here..."
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                  />
                  <div className="raw-text-footer">
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Case Scope: <strong style={{ color: '#0f172a' }}>{activeCase}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn-parse-nlp"
                      disabled={!rawText.trim() || busy}
                      onClick={handleRawTextImport}
                    >
                      ⚡ Parse & Ingest with Zero-Shot NLP →
                    </button>
                  </div>
                </div>

                {/* 4 Modality Intake Cards */}
                <div className="intake-grid">
                  {/* 1. Court Cases */}
                  <div className="intake-card">
                    <div>
                      <div className="intake-card-top">
                        <span className="intake-card-icon">🏛️</span>
                        <div>
                          <h3 className="intake-card-title">Court Proceedings</h3>
                          <span className="intake-card-format">Legal Narrative JSON</span>
                        </div>
                      </div>
                      <p className="intake-card-desc">
                        Judicial orders, charge sheets, bail transcripts, and legal proceedings mentioning accused parties.
                      </p>
                    </div>
                    <div>
                      <span className="intake-card-count">Case Scope: {activeCase}</span>
                      <div className="intake-card-actions">
                        <label className="file-upload-btn">
                          <span>↑ Upload JSON</span>
                          <input
                            type="file"
                            accept=".json"
                            onChange={e => {
                              if (e.target.files[0]) handleDirectUpload('narrative', e.target.files[0]);
                            }}
                          />
                        </label>
                        <button
                          className="btn-tmpl"
                          onClick={() => {
                            downloadFile(
                              'court_cases_template.json',
                              JSON.stringify([
                                {
                                  document_id: `COURT-${activeCase}-01`,
                                  case_id: activeCase,
                                  filed_date: '2026-03-15',
                                  synthetic: true,
                                  text: `In the Special Court for PMLA Offenses: Directorate of Enforcement vs. Vikram Singhania [ID:P001]. Accused P001 operated account DEMO/A as primary layering pool.`
                                }
                              ], null, 2),
                              'json'
                            );
                          }}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 2. Financial Transactions */}
                  <div className="intake-card">
                    <div>
                      <div className="intake-card-top">
                        <span className="intake-card-icon">💳</span>
                        <div>
                          <h3 className="intake-card-title">Financial Wires</h3>
                          <span className="intake-card-format">Transactions CSV</span>
                        </div>
                      </div>
                      <p className="intake-card-desc">
                        High-velocity bank transfers, RTGS/NEFT wires, foreign remittances, and hawala smurfing logs.
                      </p>
                    </div>
                    <div>
                      <span className="intake-card-count">Case Scope: {activeCase}</span>
                      <div className="intake-card-actions">
                        <label className="file-upload-btn">
                          <span>↑ Upload CSV</span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={e => {
                              if (e.target.files[0]) handleDirectUpload('ibm', e.target.files[0]);
                            }}
                          />
                        </label>
                        <button
                          className="btn-tmpl"
                          onClick={() => {
                            downloadFile(
                              'transactions_template.csv',
                              "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n2026/03/10 10:15,DEMO,A,DEMO,B,100000.00,US Dollar,100000.00,US Dollar,ACH,1\n2026/03/10 11:30,DEMO,B,DEMO,C,107000.00,US Dollar,107000.00,US Dollar,ACH,1\n2026/03/10 12:45,DEMO,C,DEMO,A,114000.00,US Dollar,114000.00,US Dollar,ACH,1\n",
                              'csv'
                            );
                          }}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 3. Crime FIR History */}
                  <div className="intake-card">
                    <div>
                      <div className="intake-card-top">
                        <span className="intake-card-icon">🚨</span>
                        <div>
                          <h3 className="intake-card-title">Crime FIR Records</h3>
                          <span className="intake-card-format">History Registry CSV</span>
                        </div>
                      </div>
                      <p className="intake-card-desc">
                        Police station FIRs, Look Out Circulars (LOC), prior arrest records, and CBI/ED charges.
                      </p>
                    </div>
                    <div>
                      <span className="intake-card-count">Case Scope: {activeCase}</span>
                      <div className="intake-card-actions">
                        <label className="file-upload-btn">
                          <span>↑ Upload CSV</span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={e => {
                              if (e.target.files[0]) handleDirectUpload('history', e.target.files[0]);
                            }}
                          />
                        </label>
                        <button
                          className="btn-tmpl"
                          onClick={() => {
                            downloadFile(
                              'crime_firs_template.csv',
                              `record_id,person_id,case_id,record_date,record_status,text,synthetic\nFIR-01,P001,${activeCase},2026-01-14,Active Charge-Sheet,FIR No. 44/2026 under IPC 420/120B and PMLA Section 3 for syndicate fraud,true\nFIR-02,P002,${activeCase},2026-02-02,Look Out Circular,LOC Issued at International Airports for evasion of summons,true\n`,
                              'csv'
                            );
                          }}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 4. Telecom CDR */}
                  <div className="intake-card">
                    <div>
                      <div className="intake-card-top">
                        <span className="intake-card-icon">📞</span>
                        <div>
                          <h3 className="intake-card-title">Telecom CDR Calls</h3>
                          <span className="intake-card-format">CDR Intercepts CSV</span>
                        </div>
                      </div>
                      <p className="intake-card-desc">
                        Encrypted burner phone call logs, durations, tower timestamps, and syndicate communications.
                      </p>
                    </div>
                    <div>
                      <span className="intake-card-count">Case Scope: {activeCase}</span>
                      <div className="intake-card-actions">
                        <label className="file-upload-btn">
                          <span>↑ Upload CSV</span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={e => {
                              if (e.target.files[0]) handleDirectUpload('cdr', e.target.files[0]);
                            }}
                          />
                        </label>
                        <button
                          className="btn-tmpl"
                          onClick={() => {
                            downloadFile(
                              'cdr_calls_template.csv',
                              "record_id,caller_person_id,callee_person_id,start_time,duration_seconds,synthetic\nCALL-101,P001,P002,2026-03-10T09:45:00+00:00,420,true\nCALL-102,P002,P003,2026-03-10T12:10:00+00:00,185,true\nCALL-103,P003,P001,2026-03-10T15:00:00+00:00,310,true\n",
                              'csv'
                            );
                          }}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Feature 4: ML Tuning & Custom Risk Weights */}
                <div className="tuning-box">
                  <div className="tuning-head" onClick={() => setShowTuning(!showTuning)}>
                    <h4>
                      <span>🎛️</span> Model Hyperparameters & Investigative Risk Weights Policy
                    </h4>
                    <span className="tuning-toggle-btn">
                      {showTuning ? '▲ Hide Tuning' : '▼ Customize Weights & Anomaly Sensitivity'}
                    </span>
                  </div>
                  {showTuning && (
                    <>
                      <div className="tuning-grid">
                        <div className="tuning-item">
                          <div className="tuning-label">
                            <span>Isolation Forest Contamination:</span> <strong>{(contamination * 100).toFixed(0)}%</strong>
                          </div>
                          <input
                            type="range"
                            className="tuning-slider"
                            min="0.01"
                            max="0.15"
                            step="0.01"
                            value={contamination}
                            onChange={e => setContamination(parseFloat(e.target.value))}
                          />
                          <small>Proportion of transactions flagged as anomalous.</small>
                        </div>
                        <div className="tuning-item">
                          <div className="tuning-label">
                            <span>Financial Layering Weight:</span> <strong>{wFinancial} pts</strong>
                          </div>
                          <input
                            type="range"
                            className="tuning-slider"
                            min="10"
                            max="60"
                            step="1"
                            value={wFinancial}
                            onChange={e => setWFinancial(parseInt(e.target.value))}
                          />
                          <small>Multi-hop loops and Isolation Forest score.</small>
                        </div>
                        <div className="tuning-item">
                          <div className="tuning-label">
                            <span>Court & Crime Charges Weight:</span> <strong>{wCourt} pts</strong>
                          </div>
                          <input
                            type="range"
                            className="tuning-slider"
                            min="10"
                            max="50"
                            step="1"
                            value={wCourt}
                            onChange={e => setWCourt(parseInt(e.target.value))}
                          />
                          <small>PMLA, IPC 420/120B, warrants and LOCs.</small>
                        </div>
                        <div className="tuning-item">
                          <div className="tuning-label">
                            <span>Network Centrality Weight:</span> <strong>{wCentrality} pts</strong>
                          </div>
                          <input
                            type="range"
                            className="tuning-slider"
                            min="5"
                            max="40"
                            step="1"
                            value={wCentrality}
                            onChange={e => setWCentrality(parseInt(e.target.value))}
                          />
                          <small>Betweenness, PageRank, and CDR degree.</small>
                        </div>
                        <div className="tuning-item">
                          <div className="tuning-label">
                            <span>Cross-Jurisdiction Scope:</span> <strong>{wCrossCase} pts</strong>
                          </div>
                          <input
                            type="range"
                            className="tuning-slider"
                            min="5"
                            max="30"
                            step="1"
                            value={wCrossCase}
                            onChange={e => setWCrossCase(parseInt(e.target.value))}
                          />
                          <small>Multi-case involvement & alias identity.</small>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-tuning-reset"
                          onClick={() => {
                            setContamination(0.05);
                            setWFinancial(35);
                            setWCourt(30);
                            setWCentrality(20);
                            setWCrossCase(15);
                          }}
                        >
                          ↺ Reset to Standard Weights (35/30/20/15)
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Training Trigger Box */}
                <div className="train-box" style={{ marginTop: '16px' }}>
                  <div className="train-box-info">
                    <h3>⚡ Ready to Train Machine Learning Models</h3>
                    <p>
                      Current Case Facts: <strong>{activeStatus.facts_count} records</strong> in SQLite ledger.
                      <br />
                      Models to train: Isolation Forest (AML Anomaly Detector), Graph Layering Cycle Classifier, and NLP Entity Resolver.
                    </p>
                  </div>
                  <div className="train-box-actions">
                    <button className="btn-sample" onClick={handleLoadSample} disabled={isTraining || busy}>
                      ⚡ 1-Click Load Sample Package
                    </button>
                    <button
                      className="btn-train-primary"
                      onClick={handleTrainModels}
                      disabled={isTraining || busy || activeStatus.facts_count === 0}
                    >
                      {isTraining ? 'Training in Progress…' : '⚡ Train ML Models & Extract Suspects'}
                    </button>
                  </div>
                </div>

                {/* Training Stepper Progress */}
                {isTraining && (
                  <div className="training-stepper">
                    <div className="stepper-head">
                      <span className="step-spin" />
                      <span>Machine Learning Training Pipeline in Execution:</span>
                    </div>
                    <div className="stepper-steps">
                      {[
                        'Ingesting Multi-Modal Evidence & Assertions (Court, Trans, Crime, CDR)...',
                        'Fitting Isolation Forest AML Anomaly Detection Model...',
                        'Detecting Closed Graph Layering Cycles & Hawala Hop Flow...',
                        'Running NLP Spacy Entity Resolution & Statutory Charge Extraction...',
                        'Synthesizing Multi-Factor Risk Scores (0-100) & Digital Provenance Seals...'
                      ].map((stepName, sIdx) => {
                        const stepNum = sIdx + 1;
                        let stateClass = 'pending';
                        let icon = '○';
                        if (trainStep === stepNum) {
                          stateClass = 'active';
                          icon = '⚡';
                        } else if (trainStep > stepNum) {
                          stateClass = 'done';
                          icon = '✓';
                        }
                        return (
                          <div key={sIdx} className={`step-row ${stateClass}`}>
                            <span>{icon}</span>
                            <span>
                              Stage {stepNum}: {stepName}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* If TRAINED, render the RANKED SUSPECT DOSSIERS */}
            {isTrained && !showTrainingStudio && (
              <section className="panel" style={{ padding: '24px' }}>
                {/* Persistent Action Bar for Ingesting More Records */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f8f2', border: '1px solid #d8e5d3', borderRadius: '8px', padding: '14px 20px', marginBottom: '22px', flexWrap: 'wrap', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '20px', background: '#e3ece0', borderRadius: '6px', padding: '6px 10px' }}>📂</span>
                    <div>
                      <strong style={{ fontSize: '13px', color: '#163d33', display: 'block' }}>Active Evidence Base: {activeStatus.facts_count} facts stored in {activeCase}</strong>
                      <span style={{ fontSize: '11px', color: '#556d61' }}>Need to add more court documents, banking transactions, FIRs, or CDR call logs?</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-new-case"
                      style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', border: '1px solid #334155', color: '#fff', fontSize: '12px', padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                      onClick={() => setShowTrainingStudio(true)}
                    >
                      ➕ Ingest More Records & Retrain →
                    </button>
                    <button
                      type="button"
                      className="btn-sample"
                      style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', fontSize: '11px', padding: '9px 14px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}
                      onClick={openTemplateModal}
                    >
                      📥 Download Templates
                    </button>
                  </div>
                </div>

                {/* AI Investigator Copilot */}
                <div className="copilot-container">
                  <div className="copilot-header">
                    <h3>
                      <span className="copilot-lottie-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', flexShrink: 0, overflow: 'hidden' }}>
                        <iframe
                          src="https://lottie.host/embed/1f50be53-bbab-4714-9203-ee03f8fe47cf/DDNJAaolxB.lottie"
                          style={{ width: '44px', height: '44px', border: 'none', background: 'transparent', pointerEvents: 'none', overflow: 'hidden' }}
                          title="AI Investigator Copilot Animation"
                        />
                      </span>
                      AI Investigator Copilot / Query Assistant
                    </h3>
                    <span className="copilot-badge">NCRB PS 26189 · EVIDENCE-GROUNDED</span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 12px' }}>
                    Ask forensic queries across judicial records, financial layering loops, and communication networks:
                  </p>
                  <div className="copilot-chips">
                    {[
                      `Who is the prime accused in ${activeCase}?`,
                      'Show closed layering fund-flow cycles',
                      'Active Look-Out Circulars (LOC) and police warrants',
                      'CDR call intercepts between suspects'
                    ].map(chip => (
                      <button
                        key={chip}
                        className="chip-btn"
                        onClick={() => {
                          setCopilotQuery(chip);
                          askCopilot(chip);
                        }}
                      >
                        ⚡ {chip}
                      </button>
                    ))}
                  </div>
                  <div className="copilot-input-row">
                    <input
                      className="copilot-input"
                      placeholder="Type forensic query (e.g., 'Who is the mastermind?', 'Accounts in money loop'…)"
                      value={copilotQuery}
                      onChange={e => setCopilotQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') askCopilot();
                      }}
                    />
                    <button className="copilot-btn" onClick={() => askCopilot()} disabled={copilotBusy}>
                      {copilotBusy ? 'Analyzing…' : 'Ask Evidence →'}
                    </button>
                  </div>
                  {copilotResult && (
                    <div className="copilot-result">
                      <div className="copilot-summary">
                        <strong>Analysis:</strong> {copilotResult.summary}
                      </div>
                      <div className="copilot-findings">
                        {copilotResult.findings.map((f, fi) => (
                          <div className="copilot-finding-item" key={fi}>
                            <strong>{f.title}</strong>
                            <p>{f.detail}</p>
                            {f.evidence_ids?.length > 0 && (
                              <button
                                className="quiet"
                                style={{ marginTop: '6px', fontSize: '10px', padding: '4px 8px' }}
                                onClick={() => evidence(f.evidence_ids[0])}
                              >
                                View Source Evidence ({f.evidence_ids.length}) →
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Banner & Filter Bar */}
                <div className="suspect-banner">
                  <div>
                    <strong>Multi-Factor Suspect Prioritization Engine ({activeCase})</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#526b5d' }}>
                      Combines Financial Layering & Anomalies ({wFinancial}%) · Court & Criminal Charges ({wCourt}%) · Network Centrality ({wCentrality}%) · Cross-Jurisdiction Scope ({wCrossCase}%).
                    </p>
                  </div>
                  <div className="suspect-filters">
                    <span>Risk level:</span>
                    {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'EVALUATING'].map(lvl => (
                      <button
                        key={lvl}
                        className={`filter-btn ${riskFilter === lvl ? 'active' : ''}`}
                        onClick={() => setRiskFilter(lvl)}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="panel-head" style={{ padding: '0 0 20px', borderBottom: '1px solid #edf0e9' }}>
                  <h2>{filteredSuspects.length} Ranked Suspects Generated by Model</h2>
                  <input
                    aria-label="Search suspects"
                    placeholder="Search by name, role, FIR, or charge…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ minWidth: '280px' }}
                  />
                </div>

                <div style={{ marginTop: '20px' }}>
                  {filteredSuspects.map(s => (
                    <article className="suspect-card" key={s.id}>
                      <div className="suspect-top">
                        <div className="suspect-identity">
                          <span className="suspect-rank">{s.title}</span>
                          <h3 className="suspect-name">{s.name}</h3>
                          <span className="suspect-auth">ID: {s.authoritative_id}</span>
                          {s.role && <span className="suspect-role">{s.role}</span>}
                          {s.syndicate_tier && (
                            <span
                              className={`tier-badge ${
                                s.syndicate_tier.startsWith('Tier-1')
                                  ? 'tier-1'
                                  : s.syndicate_tier.startsWith('Tier-2')
                                  ? 'tier-2'
                                  : 'tier-3'
                              }`}
                            >
                              {s.syndicate_tier}
                            </span>
                          )}
                        </div>
                        <div>
                          <span className={`risk-pill risk-${s.risk_level.toLowerCase()}`}>
                            ⚡ Risk {s.risk_score} / 100 · {s.risk_level} RISK
                          </span>
                        </div>
                      </div>

                      {s.modus_operandi && (
                        <div className="mo-box">
                          <strong>Modus Operandi (M.O.) Analysis</strong>
                          <p>{s.modus_operandi}</p>
                        </div>
                      )}

                      <div className="risk-breakdown-bar">
                        <div className="breakdown-item">
                          <span className="breakdown-label">Financial Layering / IF</span>
                          <span className="breakdown-value">{s.risk_breakdown.financial_anomaly} / {wFinancial} pts</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="breakdown-label">Court & Crime Charges</span>
                          <span className="breakdown-value">{s.risk_breakdown.court_criminal} / {wCourt} pts</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="breakdown-label">Network Centrality</span>
                          <span className="breakdown-value">{s.risk_breakdown.network_centrality} / {wCentrality} pts</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="breakdown-label">Cross-Case / Aliases</span>
                          <span className="breakdown-value">{s.risk_breakdown.cross_case_identity} / {wCrossCase} pts</span>
                        </div>
                      </div>

                      <div className="suspect-section-title">
                        <span>⚑</span> WHY FLAGGED BY INVESTIGATION ENGINE
                      </div>
                      <ul className="why-flagged-list">
                        {s.why_flagged.map((why, idx) => {
                          const tagMatch = why.match(/^\[(.*?)\]\s*(.*)$/);
                          return (
                            <li className="why-flagged-item" key={idx}>
                              {tagMatch ? (
                                <>
                                  <span className="why-tag">{tagMatch[1]}</span>
                                  <span>{tagMatch[2]}</span>
                                </>
                              ) : (
                                <span>{why}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                      {/* Feature 1: Hop-by-Hop Fund Trail Visualizer */}
                      {expandedTrail === s.id && (
                        <div className="fund-trail-box">
                          <div className="fund-trail-title">
                            <strong><span>🌊</span> Hop-by-Hop Financial Fund Flow Trail ({s.fund_trail?.length || 0} Hops)</strong>
                            <span style={{ fontSize: '10px', color: '#527264' }}>Closed Loop Layering Analysis</span>
                          </div>
                          {s.fund_trail?.length > 0 ? (
                            <div className="trail-hops-grid">
                              {s.fund_trail.map((hop, hidx) => (
                                <div className="trail-hop-item" key={hidx}>
                                  <span className="hop-badge">HOP #{hop.hop}</span>
                                  <div className="hop-flow">
                                    <span className="hop-account">{hop.from_account}</span>
                                    <span className="hop-arrow">➔</span>
                                    <span className="hop-account">{hop.to_account}</span>
                                    <span className="hop-amount">{hop.amount}</span>
                                    <span style={{ fontSize: '10px', color: '#77887e' }}>via {hop.payment_format}</span>
                                  </div>
                                  <div className="hop-meta">
                                    <span className={`hop-flag ${hop.is_laundering ? 'flag-laundering' : 'flag-normal'}`}>{hop.flag}</span>
                                    <span style={{ fontSize: '10px', color: '#688073' }}>{hop.stage}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p style={{ margin: 0, fontSize: '11px', color: '#798d81' }}>No direct account layering cycles identified for this profile.</p>
                          )}
                        </div>
                      )}

                      <div className="suspect-section-title">
                        <span>☰</span> KEY INVESTIGATIVE DETAILS
                      </div>
                      <div className="details-grid">
                        <div className="detail-box">
                          <strong>Associated Accounts ({s.key_details.accounts.length})</strong>
                          {s.key_details.accounts.length ? (
                            s.key_details.accounts.map((ac, ai) => (
                              <div key={ai} style={{ margin: '2px 0' }}>
                                <span>
                                  {ac.bank} / {ac.account_number}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span style={{ color: '#8a968e', fontWeight: 400 }}>No domestic accounts linked</span>
                          )}
                        </div>
                        <div className="detail-box">
                          <strong>Cross-Case Scope ({s.key_details.case_ids.length})</strong>
                          <span>{s.key_details.case_ids.join(', ') || 'Single case'}</span>
                        </div>
                        <div className="detail-box">
                          <strong>Criminal & FIR Records</strong>
                          {s.key_details.crime_records.length ? (
                            <span>{s.key_details.crime_records.map(cr => cr.record).join('; ')}</span>
                          ) : (
                            <span style={{ color: '#8a968e', fontWeight: 400 }}>No prior convictions in registry</span>
                          )}
                        </div>
                        <div className="detail-box">
                          <strong>CDR Phone Intercepts</strong>
                          {s.key_details.communications?.length ? (
                            <span>
                              {s.key_details.communications.length} calls recorded · Contact:{' '}
                              {s.key_details.communications[0].partner_name}
                            </span>
                          ) : (
                            <span style={{ color: '#8a968e', fontWeight: 400 }}>No direct calls recorded</span>
                          )}
                        </div>
                      </div>

                      {s.recommended_actions?.length > 0 && (
                        <div className="action-box">
                          <strong style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#846c31' }}>
                            Recommended Investigative Actions
                          </strong>
                          <ul className="action-list">
                            {s.recommended_actions.map((act, ai) => (
                              <li key={ai}>
                                <span>⚡</span> {act}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {s.provenance_seal && (
                        <div className="seal-bar" title={s.provenance_seal}>
                          <span>🔒</span> <strong>Digital Provenance Seal (SHA-256):</strong> <span>{s.provenance_seal}</span>
                        </div>
                      )}

                      <div className="suspect-actions-footer">
                        <small>{s.evidence_ids.length} linked evidentiary sources in SQLite ledger</small>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Feature 1: Hop-by-Hop Trail Toggle Button */}
                          <button
                            className="btn-ego"
                            onClick={() => setExpandedTrail(expandedTrail === s.id ? null : s.id)}
                          >
                            🌊 {expandedTrail === s.id ? 'Hide Fund Trail' : `Trace Fund Flow Trail (${s.fund_trail?.length || 0} Hops)`}
                          </button>

                          {/* Feature 2: Prosecution Charge Sheet */}
                          <button
                            className="btn-charge-sheet"
                            onClick={() => window.open(`/api/charge-sheet/${s.id}?case=${encodeURIComponent(activeCase)}`, '_blank')}
                          >
                            🏛️ Court Charge Sheet ↗
                          </button>

                          <button className="btn-dossier" onClick={() => downloadDossier(s)}>
                            📄 Court Dossier JSON ⬇
                          </button>

                          <button className="btn-ego" onClick={() => isolateInGraph(s)}>
                            ◎ Focus in Graph
                          </button>

                          <button className="quiet" onClick={() => setSelected(s)}>
                            Inspect Sources ({s.evidence_ids.length}) →
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!filteredSuspects.length && <p className="empty">No suspects match this search or filter criteria.</p>}
                </div>
              </section>
            )}
          </>
        )}

        {/* OTHER TABS */}
        {['Connections', 'Flagged behavior'].includes(tab) && (
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
                  <span className={'tag ' + (l.category === 'connection' ? '' : 'amber')}>{l.techniques.join(' · ')}</span>
                  <h3>{l.subject_ids.map(id => graph?.nodes?.find(n => n.id === id)?.label || id).join(' → ')}</h3>
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
        )}

        {tab === 'Graph explorer' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Authorized source graph ({activeCase})</h2>
              <input aria-label="Search graph" placeholder="Find an entity…" value={search} onChange={e => setSearch(e.target.value)} />
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
            <Graph graph={graph} onSelect={setSelected} />
            <div className="legend">Select a node to inspect its assertions and evidence. Documents are excluded from structural metrics.</div>
          </section>
        )}

        {tab === 'Resolution' && (
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
        )}

        {tab === 'Timeline' && (
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
          </section>
        )}

        {tab === 'Import records' && (
          <section className="panel import-panel">
            <h2>Add evidence to a case</h2>
            <p>Prototype intake accepts synthetic records only. Maximum file size: 25 MiB.</p>
            <form onSubmit={upload}>
              <label>
                Authorized case
                <select name="case" defaultValue={activeCase}>
                  {casesList.map(c => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Record format
                <select name="kind">
                  <option value="ibm">IBM HI-Small CSV</option>
                  <option value="narrative">Synthetic narrative JSON</option>
                  <option value="cdr">Synthetic CDR CSV</option>
                  <option value="history">Synthetic case-history CSV</option>
                  <option value="pdf">MAHA fixed-layout PDF v1</option>
                </select>
              </label>
              <label>
                Source file
                <input name="file" type="file" accept=".csv,.json,.pdf" required />
              </label>
              <button disabled={busy}>Validate and import →</button>
            </form>
          </section>
        )}

        {tab === 'Quality' && (
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
                    {r.summary.rows_seen} records · {r.summary.accepted_new} accepted · {r.summary.recognized_repeat} repeats · {r.summary.quarantined} quarantined
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
          </section>
        )}

        {tab === 'Benchmarks' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Temporal evaluation</h2>
              <span className="badge">DATASETS REPORTED SEPARATELY</span>
            </div>
            {list.map(r => (
              <article className="benchmark" key={r.dataset}>
                <h2>{r.dataset}</h2>
                <p>{r.scope}</p>
                <span className="tag">{r.synthetic ? 'SYNTHETIC · ILLUSTRATIVE' : 'REAL TRANSACTION BENCHMARK'}</span>
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
                <small>Classification metrics only. These do not validate person identity, case links, or investigative conclusions.</small>
              </article>
            ))}
            {!list.length && <p className="empty">Run the benchmark commands to populate this view.</p>}
          </section>
        )}

        {tab === 'Audit' && (
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
          </section>
        )}

        <footer>
          MAHA / Evidence workspace <span>{graph?.backend} · Projection v0.1 · Evidence coverage is not evidence correctness</span>
        </footer>
      </main>

      {/* Detail Drawer */}
      {selected && (
        <div className="drawer">
          <button
            className="close"
            onClick={() => {
              setSelected(null);
              setEv(null);
            }}
            aria-label="Close evidence panel"
          >
            ×
          </button>
          <p className="eyebrow">EVIDENCE DETAIL</p>
          <h2>{selected.title ? `${selected.title}: ${selected.name}` : selected.label || selected.left_name || selected.name || 'Finding for review'}</h2>
          <p>{selected.role ? `${selected.role} · Risk Score: ${selected.risk_score} (${selected.risk_level})` : selected.reason || selected.type || 'Candidate identity match'}</p>
          {selected.structural_context && <pre>{JSON.stringify(selected.structural_context, null, 2)}</pre>}
          {selected.behavior_score != null && (
            <p>
              Model score: {selected.behavior_score.toFixed(4)}
              <br />
              <small>{selected.score_scope}</small>
            </p>
          )}
          {selected.assertions && (
            <details>
              <summary>{selected.assertions.length} preserved assertions</summary>
              <pre>{JSON.stringify(selected.assertions, null, 2)}</pre>
            </details>
          )}
          <h3>Source references</h3>
          {selected.evidence_ids?.map((id, i) => (
            <button className="source-button" key={id} onClick={() => evidence(id)}>
              ↗ Source {i + 1} <small>{id.slice(0, 10)}</small>
            </button>
          ))}
          {ev && (
            <div className="evidence">
              <span className="tag">{ev.synthetic ? 'SYNTHETIC' : 'BENCHMARK'}</span>
              <h3>{ev.source}</h3>
              <p>{JSON.stringify(ev.source_locator)}</p>
              <blockquote>{ev.passage}</blockquote>
              <small>
                {ev.extraction_method} · v{ev.extraction_version}
                <br />
                Event: {ev.event_time || 'Not supplied'}
                <br />
                Imported: {ev.ingestion_time}
              </small>
            </div>
          )}
          {selected.category && (
            <div className="review-actions">
              <h3>Record your review</h3>
              <button onClick={() => review(selected, 'relevant')}>Relevant</button>
              <button className="quiet" onClick={() => review(selected, 'not_relevant')}>
                Not relevant
              </button>
              <button className="quiet" onClick={() => review(selected, 'insufficient_evidence')}>
                Insufficient evidence
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create New Case Modal */}
      {showNewCaseModal && (
        <div className="modal-overlay" onClick={() => setShowNewCaseModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-head">
              <h3>Create New Investigation Case</h3>
              <button className="close" style={{ position: 'static' }} onClick={() => setShowNewCaseModal(false)}>
                ×
              </button>
            </div>
            <p style={{ fontSize: '12px', color: '#556d61', marginBottom: '16px' }}>
              Create an isolated investigation container. The case will start completely clean with 0 facts and un-trained models.
            </p>
            <form onSubmit={handleCreateCase}>
              <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#173f35' }}>
                Case Identifier / Number:
                <input
                  placeholder="e.g. CASE-2026-X1"
                  value={newCaseInput}
                  onChange={e => setNewCaseInput(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="quiet" onClick={() => setShowNewCaseModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={busy}>
                  Create Case →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Templates Modal */}
      {showTemplateModal && templates && (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Evidence Modality Schemas & Downloadable Templates</h3>
              <button className="close" style={{ position: 'static' }} onClick={() => setShowTemplateModal(false)}>
                ×
              </button>
            </div>
            <p style={{ fontSize: '12px', color: '#556d61', marginBottom: '20px' }}>
              Use these exact file formats and headers to ingest real or synthetic records for court hearings, bank transactions, police FIRs, and telecom calls.
            </p>

            {Object.entries(templates).map(([key, t]) => (
              <div className="template-item" key={key}>
                <h4>
                  <span>{t.title}</span>
                  <button
                    className="quiet"
                    style={{ fontSize: '10px', padding: '4px 10px' }}
                    onClick={() => downloadFile(t.filename, t.content, t.format)}
                  >
                    ⬇ Download {t.filename}
                  </button>
                </h4>
                <p>{t.description}</p>
                <pre>{t.content.slice(0, 320) + (t.content.length > 320 ? '\n...' : '')}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
