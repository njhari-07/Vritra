import React, { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import GraphView from './components/GraphView';
import JudgmentReview from './components/JudgmentReview';
import SourcePage from './components/SourcePage';
import LeadsPanel from './components/LeadsPanel';
import ResolutionTab from './components/ResolutionTab';
import TimelineTab from './components/TimelineTab';
import ImportRecordsTab from './components/ImportRecordsTab';
import QualityTab from './components/QualityTab';
import AuditTab from './components/AuditTab';
import BenchmarksTab from './components/BenchmarksTab';
import EvidenceDrawer from './components/EvidenceDrawer';
import GraphExplorerTab from './components/GraphExplorerTab';
import './style.css';

const HeroScene = lazy(() => import('./components/three/HeroScene'));

const colors = {
  Person: '#5AA9FF',
  Account: '#F2B544',
  Transaction: '#8D87B3',
  Case: '#EDF2FA',
  Location: '#A98BFF',
  Organization: '#C9C3E8',
  Document: '#4A5B7C'
};

function Graph({ graph, onSelect, darkMode = false, height = '520px' }) {
  return <GraphView graph={graph} onSelect={onSelect} darkMode={darkMode} height={height} />;
}

// userSlot: account controls from the auth layer (Clerk UserButton), shown in the sidebar.
export default function App({ userSlot = null }) {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [me, setMe] = useState(null);

  // Dark Canvas / Theme Mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('maha_theme');
    if (saved) return saved === 'dark';
    return true; // Default to sleek dark cyber-intelligence theme
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ev, setEv] = useState(null);
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [notice, setNotice] = useState('');
  const sessionToken = useRef('');
  const caseRequest = useRef(null);
  const evidenceRequest = useRef(null);
  const drawerClose = useRef(null);

  // AI Copilot
  const [copilotQuery, setCopilotQuery] = useState('');
  const [copilotResult, setCopilotResult] = useState(null);
  const [copilotBusy, setCopilotBusy] = useState(false);

  // Model Training Pipeline State
  const [isTraining, setIsTraining] = useState(false);
  const [showTrainingStudio, setShowTrainingStudio] = useState(false);

  // Feature 1: Hop-by-Hop Fund Trail Visualizer

  // Feature 3: Raw Free-Text Ingestor
  const [rawText, setRawText] = useState('');
  const [rawTitle, setRawTitle] = useState('FIR-CRIME-REGISTRY-01');
  const [rawSourceType, setRawSourceType] = useState('police_fir');
  const [rawSynthetic, setRawSynthetic] = useState(false);

  // Feature 4: ML Tuning & Weights

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
    if (!token || token !== sessionToken.current) return;
    caseRequest.current?.abort();
    const controller = new AbortController();
    caseRequest.current = controller;
    const options = { signal: controller.signal };
    setBusy(true);
    setError('');
    try {
      const [m, cList] = await Promise.all([api('/me', options), api('/cases', options)]);
      if (controller.signal.aborted) return;
      setMe(m);
      setCasesList(cList);
      const preferred = targetCase || activeCase;
      const selCase = cList.find(item => item.case_id === preferred)?.case_id || cList[0]?.case_id || '';
      setActiveCase(selCase);
      if (selCase !== activeCase || !selCase) {
        setGraph(null);
        setAnalysis(null);
      }
      if (!selCase) return;
      const [g, a] = await Promise.all([
        api('/graph?case=' + encodeURIComponent(selCase), options),
        api('/analysis?case=' + encodeURIComponent(selCase), options)
      ]);
      if (controller.signal.aborted) return;
      setGraph(g);
      setAnalysis(a);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const selectItem = useCallback(item => {
    evidenceRequest.current?.abort();
    setEv(null);
    setSelected(item);
  }, []);

  const drawerOpen = Boolean(selected);
  useEffect(() => {
    if (!drawerOpen) return;
    const opener = document.activeElement;
    const close = drawerClose.current;
    close?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape' && close?.parentElement?.contains(document.activeElement)) {
        event.preventDefault();
        close?.click();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (close?.dataset.restoreFocus === 'true' && opener?.isConnected) opener.focus();
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (token) load();
  }, [token]);

  useEffect(() => {
    selectItem(null);
    setList([]);
    if (!me || !activeCase) return;
    let current = true;
    const paths = {
      Resolution: '/candidates',
      Timeline: '/timeline?case=' + encodeURIComponent(activeCase),
      Quality: '/quality?case=' + encodeURIComponent(activeCase),
      Audit: '/audit?case=' + encodeURIComponent(activeCase),
      Benchmarks: '/benchmarks'
    };
    if (paths[tab]) api(paths[tab]).then(data => { if (current) setList(data); })
      .catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [tab, me, activeCase]);

  const changeCase = cId => {
    selectItem(null);
    setGraph(null);
    setAnalysis(null);
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
      setTab('Dossiers');
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

  const handleLoadSample = async (dataset = 'the_exchange') => {
    setBusy(true);
    try {
      await api(`/cases/${encodeURIComponent(activeCase)}/load-sample?dataset=${dataset}`, { method: 'POST' });
      setNotice(`Sample Evidence Package (${dataset === 'the_exchange' ? "The Exchange: Libyan Hostage Syndicate" : "Standard"}) loaded into ${activeCase}. Ready for Case Analysis!`);
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleTrainModels = async () => {
    setIsTraining(true);
    try {
      const res = await api(`/cases/${encodeURIComponent(activeCase)}/train`, {
        method: 'POST'
      });

      setNotice(`Analysis complete. ${res.suspects.length} dossiers available for review.`);
      setShowTrainingStudio(false);
      await load(activeCase);
      setTab('Dossiers');
    } catch (e) {
      setError(e.message);
    } finally {
      setIsTraining(false);
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
          text: rawText,
          title: rawTitle.trim() || 'FREE-TEXT-FIR',
          source_type: rawSourceType,
          synthetic: rawSynthetic
        })
      });
      setNotice(`${res.summary.accepted_new} new evidence records · ${res.summary.recognized_repeat} repeats. Open Quality to inspect them.`);
      setRawText('');
      setRawSynthetic(false);
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

  const downloadOriginal = async source => {
    try {
      const response = await fetch('/api/source/' + encodeURIComponent(source.source_id), {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!response.ok) throw Error('Original source is unavailable for this account.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = source.source;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error.message);
    }
  };

  const evidence = async id => {
    evidenceRequest.current?.abort();
    const controller = new AbortController();
    evidenceRequest.current = controller;
    setEv(null);
    try {
      const item = await api('/evidence/' + encodeURIComponent(id), { signal: controller.signal });
      if (!controller.signal.aborted) setEv(item);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    }
  };

  const exportReport = async () => {
    try {
      const data = await api('/report?case=' + encodeURIComponent(activeCase));
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
      await api('/leads/' + lead.id + '/review?case=' + encodeURIComponent(activeCase), {
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
      const res = await api('/copilot?case=' + encodeURIComponent(activeCase), {
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
      const d = await api('/dossier/' + encodeURIComponent(s.id) + '?case=' + encodeURIComponent(activeCase));
      const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence-dossier-${s.authoritative_id || s.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Evidence dossier exported for ${s.name}`);
    } catch (e) {
      setError(e.message);
    }
  };

  const isolateInGraph = s => {
    setTab('Graph explorer');
    setSearch(s.name);
    const n = graph?.nodes?.find(n => n.id === s.id);
    if (n) selectItem(n);
  };

  if (!me)
    return (
      <div className="login-stage">
        <div className="login-stage-bg" aria-hidden="true">
          <Suspense fallback={null}><HeroScene dim /></Suspense>
        </div>
        <main className={`login ${darkMode ? 'dark-theme' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <Link to="/" className="login-back">← Home</Link>
            {userSlot && <div className="clerk-user-slot">{userSlot}</div>}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={() => setDarkMode(prev => !prev)}
              title={darkMode ? "Switch to light canvas" : "Switch to dark canvas"}
            >
              {darkMode ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className="badge" style={{ background: 'rgba(56,189,248,0.12)', color: 'var(--accent-cyan)', borderColor: 'rgba(56,189,248,0.3)' }}>
              NCRB PS 26189 · PMLA 2002
            </span>
            <span className="badge" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--accent-emerald)', borderColor: 'rgba(16,185,129,0.3)' }}>
              ● LEDGER ONLINE
            </span>
          </div>
          <div className="wordmark">
            <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 18L12 5l7 13H5Z" />
              <circle cx="5" cy="18" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="18" r="2" />
            </svg> MAHA
          </div>
          <p className="eyebrow">LOCAL EVIDENCE WORKSPACE</p>
          <h1>
            Open your workspace
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', margin: '0 0 24px' }}>
            Explore case records, trace connections, and review source evidence.
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              sessionToken.current = input;
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
      </div>
    );

  const activeStatus = casesList.find(c => c.case_id === activeCase) || {
    case_id: activeCase,
    facts_count: graph?.nodes?.length || 0,
    is_trained: analysis?.is_trained || false
  };

  const isTrained = Boolean(activeStatus.is_trained);
  const caseStatus = !activeCase ? "Create a case to begin" : isTrained ? "Analysis complete" : activeStatus.facts_count ? "Ready to analyze" : "No graph evidence yet";
  const connections = analysis?.leads?.filter(l => l.category === 'connection') || [];
  const behavior = analysis?.leads?.filter(l => l.category === 'flagged_behavior') || [];
  const suspects = analysis?.suspects || [];

  const leads = tab === 'Flagged behavior' ? behavior : connections;
  const filtered = leads.filter(l =>
    (l.reason + ' ' + l.subject_ids.map(id => graph?.nodes?.find(n => n.id === id)?.label).join(' ')).toLowerCase().includes(search.toLowerCase())
  );

  const dossierGroups = [
    ['kingpin', '👑 Prime Syndicate Mastermind (Kingpin Detected)', s => s.is_kingpin],
    ['syndicate', '⚡ Syndicate Operatives & Conduits', s => !s.is_kingpin && !s.is_witness && (s.kingpin_score >= 25 || (s.findings && s.findings.length > 0))],
    ['witness', '👁️ Witnesses & Exonerated Persons', s => s.is_witness || s.source_roles?.some(role => /\bwitness\b/i.test(role))],
    ['other', 'Connected Persons', s => !s.is_kingpin && !s.is_witness && (!s.findings || s.findings.length === 0) && (s.kingpin_score || 0) < 25]
  ];
  const filteredSuspects = suspects.filter(s =>
    [s.name, s.role, s.authoritative_id, s.syndicate_role].join(' ').toLowerCase().includes(search.toLowerCase())
  );
  const detectedKingpin = suspects.find(s => s.is_kingpin);

  return (
    <div className={`shell ${darkMode ? 'dark-theme' : ''}`}>
      <aside className="sidebar">
        <div className="wordmark">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 18L12 5l7 13H5Z" />
            <circle cx="5" cy="18" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="18" r="2" />
          </svg> MAHA
        </div>
        <p className="eyebrow">EVIDENCE WORKSPACE</p>
        <nav>
          {[
            'Overview',
            'Dossiers',
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
              aria-current={tab === name ? 'page' : undefined}
              onClick={() => {
                setTab(name);
                setSearch('');
              }}
            >
              <span className="nav-icon" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
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
            {darkMode ? 'Light mode' : 'Dark mode'}
          </button>
          {userSlot && <div className="clerk-user-slot">{userSlot}</div>}
          <span className="dot" /> Local workspace
          <p>
            {me.name} · {casesList.length} cases
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('maha_token');
              sessionToken.current = '';
              caseRequest.current?.abort();
              selectItem(null);
              setMe(null);
              setToken('');
              setInput('');
              setGraph(null);
              setAnalysis(null);
              setActiveCase('');
              setCasesList([]);
              setBusy(false);
              setError('');
              setNotice('');
              setRawText('');
              setCopilotQuery('');
              setCopilotResult(null);
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
              {darkMode ? 'Light mode' : 'Dark mode'}
            </button>
            <span className="badge">{tab === 'Benchmarks' ? 'BENCHMARKS' : 'LOCAL WORKSPACE'}</span>
            <button className="quiet" onClick={exportReport} disabled={!activeCase || busy}>
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
              disabled={!activeCase || busy}
            >
              {!activeCase && <option value="">No cases assigned</option>}
              {casesList.map(c => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} · {c.facts_count} facts
                </option>
              ))}
            </select>

            <span className={`case-status-pill ${isTrained ? 'status-trained' : 'status-untrained'}`}>
              {caseStatus}
            </span>
          </div>

          <div className="case-actions">
            <button className="btn-new-case" onClick={() => setShowNewCaseModal(true)}>
              + New Case
            </button>
            <button className="btn-reset-case" onClick={handleResetCase} disabled={!activeCase || busy}>
              ↺ Reset Case
            </button>
            <button className="btn-tmpl" onClick={openTemplateModal} disabled={!activeCase || busy}>
              Data Templates
            </button>
            <button className="btn-train-primary" onClick={() => setTab('Import records')} disabled={!activeCase || busy}>
              Add evidence
            </button>
          </div>
        </section>

        <section className="heading">
          <div>
            <p className="eyebrow">CASE INTELLIGENCE / {new Date().getFullYear()}</p>
            <h1>
              {tab === 'Overview'
                ? 'Case overview'
                : tab === 'Dossiers'
                  ? isTrained && !showTrainingStudio
                    ? 'Dossiers'
                    : 'Case analysis'
                  : tab}
            </h1>
            <p>
              {tab === 'Overview'
                ? 'Explore relationships. Review unusual activity. Keep every source within reach.'
                : tab === 'Dossiers'
                  ? isTrained && !showTrainingStudio
                    ? 'Synthesized across judicial proceedings, financial layering cycles, prior FIR records, and telecom communications.'
                    : 'Import structured evidence and run case analysis.'
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
              <section className="case-next">
                <div>
                  <strong>{caseStatus}</strong>
                  <p>{activeStatus.facts_count
                    ? 'Run case analysis to review connections and transaction patterns.'
                    : 'Import records to build the case graph, or load a sample package.'}</p>
                </div>
                <div className="case-actions">
                  {!activeStatus.facts_count && (
                    <button className="quiet" onClick={handleLoadSample} disabled={busy}>Load sample</button>
                  )}
                  <button className="btn-train-primary" onClick={() => {
                    if (activeStatus.facts_count) {
                      setShowTrainingStudio(true);
                      setTab('Dossiers');
                    } else {
                      setTab('Import records');
                    }
                  }}>{activeStatus.facts_count ? 'Open case analysis' : 'Import records'}</button>
                </div>
              </section>
            )}

            <section className="stats">
              {[
                [casesList.length, 'Authorized cases'],
                [suspects.length, 'Dossiers'],
                [connections.length, 'Connection findings'],
                [behavior.length, 'Behavior findings']
              ].map(([v, l]) => (
                <div key={l}>
                  <span>{l}</span>
                  <strong>{v.toString().padStart(2, '0')}</strong>
                  <small>
                    {l.includes('Behavior findings')
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
                <Graph graph={graph} onSelect={selectItem} darkMode={darkMode} height="500px" />
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
                <p className="eyebrow">REVIEW QUEUE</p>
                <h2>Case dossiers</h2>
                {isTrained ? (
                  <>
                    <p>People with source references in the selected case.</p>
                    {suspects.slice(0, 3).map(s => (
                      <button className="mini-lead" key={s.id} onClick={() => { setTab('Dossiers'); selectItem(s); }}>

                        <div>
                          <strong>{s.title}: {s.name}</strong>
                          <p>{s.role || 'Role unspecified'}</p>
                        </div>
                        <b>→</b>
                      </button>
                    ))}
                    <button className="quiet" style={{ marginTop: '12px', width: '100%' }} onClick={() => setTab('Dossiers')}>
                      View all {suspects.length} person dossiers →
                    </button>
                  </>
                ) : (
                  <div style={{ padding: '20px 0' }}>
                    <p >
                      Run case analysis to see available dossiers.
                    </p>
                    <button
                      className="btn-train-primary"
                      style={{ width: '100%', marginTop: '8px', fontSize: '12px', padding: '12px' }}
                      onClick={() => setTab('Dossiers')}
                    >
                      Open case analysis
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
        {tab === 'Dossiers' && (
          <>
            {/* If Untrained OR User clicked 'Ingest & Retrain', render the INTAKE & TRAINING STUDIO */}
            {(!isTrained || showTrainingStudio) && (
              <section className="intake-studio">
                <div className="intake-hero">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <h2>Evidence intake</h2>
                      <p>
                        Import court, transaction, incident, and call records for <strong>{activeCase}</strong>.
                      </p>
                    </div>
                    {isTrained && (
                      <button className="quiet" onClick={() => setShowTrainingStudio(false)}>
                        View dossiers ({suspects.length}) →
                      </button>
                    )}
                  </div>
                </div>

                {/* Feature 3: Paste case text */}
                <div className="raw-text-panel">
                  <h3>Paste case text</h3>
                  <p>
                    Choose the document type. Judgment text uses legal entity extraction. FIR and other text use general entity extraction. Review the results under Quality.
                  </p>
                  <div className="raw-text-presets">
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', alignSelf: 'center' }}>Sample Presets:</span>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawSynthetic(true);
                        setRawSourceType('police_fir');
                        setRawTitle('ED-PMLA-COMPLAINT-142');
                        setRawText(`IN THE SPECIAL COURT FOR PMLA OFFENSES: Directorate of Enforcement vs. Vikram Singhania [ID:P001] & Ors.\nPrime Accused Vikram Singhania operates HDFC Bank account 001928374 for layering procurement fraud kickbacks of ₹14,200,000.\nCo-conspirator Rajesh Sharma operates ICICI Bank account 009847261 as hawala mule routing pass-through tranches.\nCharges registered under PMLA Section 3 & 4 and IPC Section 420 and 120B.\nNon-Bailable Warrant issued by EOW.`);
                      }}
                    >
                      Preset 1: PMLA Procurement FIR
                    </button>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawSynthetic(true);
                        setRawSourceType('police_fir');
                        setRawTitle('CYBER-PS-FIR-204');
                        setRawText(`CYBER CRIME POLICE STATION: State vs. Dev Shah [ID:P003] & Associates.\nAccused Dev Shah operates darknet crypto conversion infrastructure and Axis Bank account 005511223.\nMule coordinator Vikas Agarwal routed funds through Axis Bank and ICICI Bank.\nFIR No. 204/2023 under IT Act Section 66D and IPC Section 420. Look-Out Circular (LOC) active at international airports.`);
                      }}
                    >
                      Preset 2: Cyber Financial Fraud FIR
                    </button>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawSynthetic(true);
                        setRawSourceType('police_fir');
                        setRawTitle(`EOW-FIR-144-${activeCase}`);
                        setRawText(`POLICE STATION: Economic Offenses Wing (EOW), Mandir Marg, New Delhi\nFIR No: 144/2026 | Date: 12-03-2026\nActs & Sections: Section 420 IPC (Cheating), Section 120B IPC (Criminal Conspiracy), read with Section 3 & 4 of Prevention of Money Laundering Act, 2002 (PMLA).\n(i) Accused Vikram Malhotra [ID:P101], Managing Director, Zenith Health Ventures Ltd. Role: Prime Syndicate Mastermind and beneficial owner of destination fund accounts.\n(ii) Accused Sanjay Agarwal [ID:P102], Financial Consultant & Hawala Remittance Mule Coordinator. Operates account ACC-AGARWAL-882 at Bank 010.\n(iii) Accused Karan Singhania [ID:P103], Dummy Director, Apex Logistics Front Corp. Operates account ACC-APEXSHELL-993 at Bank 010.\n(iv) Accused Rohit Verma [ID:P104], Operator of unauthorized digital escrow and crypto mixing channels, account ACC-VERMA-104 at Bank 010.\nAllegations: Accused Vikram Malhotra [ID:P101] utilized shell corporate vehicles to route approximately $750,000 USD of misappropriated funds through closed-loop layering transfers. Primary layering was executed through bank account 010 / ACC-MALHOTRA-771 into mule account 010 / ACC-AGARWAL-882, which was then layered into shell account 010 / ACC-APEXSHELL-993 before returning into primary beneficiary accounts under the guise of dividend reinvestment.`);
                      }}
                    >
                      Preset 3: Zenith Healthcare Syndicate (P101/P102/P103)
                    </button>
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => {
                        setRawSynthetic(true);
                        setRawSourceType('court_judgment');
                        setRawTitle(`SDNY-EXCHANGE-RANSOM-${activeCase}`);
                        setRawText(`UNITED STATES DISTRICT COURT FOR THE SOUTHERN DISTRICT OF NEW YORK // SPECIAL GRAND JURY INDICTMENT.\nCRIMINAL DOCKET NO. CR-2026-9944: UNITED STATES OF AMERICA v. MUSTAFA AL-KHATIB, NOURA AL-FASSI, BAYKAN LANNAK ET AL.\n1. Person Mustafa Al-Khatib [ID:P601] is named as Prime Accused and head of the Saharan militant hostage syndicate in this case.\n2. Person Mustafa Al-Khatib [ID:P601] owns account [Bank:010; Account:ACC-KHATIB-LIBYA-TRIPOLI].\n3. Person Mustafa Al-Khatib [ID:P601] owns account [Bank:010; Account:ACC-SAHARA-HOLDINGS].\n4. Person Noura Al-Fassi [ID:P602] is named as Co-Accused and extortion negotiator in this case.\n5. Person Noura Al-Fassi [ID:P602] owns account [Bank:010; Account:ACC-NOURA-TANGIER].\n6. Person Baykan Lannak [ID:P603] is named as Co-Accused and construction kickback conduit in this case.\n7. Person Baykan Lannak [ID:P603] owns account [Bank:010; Account:ACC-LANNAK-ISTANBUL].\n8. Person Baykan Lannak [ID:P603] owns account [Bank:010; Account:ACC-LANNAK-GENEVA].\n9. Person Tariq Ben-Zaid [ID:P608] is named as Co-Accused and tactical desert convoy coordinator in this case.\n10. Person Tariq Ben-Zaid [ID:P608] owns account [Bank:010; Account:ACC-BENZAID-TRIPOLI].\n11. Person Mitchell Y McDeere [ID:P604] owns account [Bank:010; Account:ACC-SCULLY-ESCROW-NY] and is referenced in this case as a witness and designated ransom courier.\n12. Person Giovanna Sandroni [ID:P605] owns account [Bank:010; Account:ACC-GIOVANNA-ROME] and is referenced in this case as an abducted associate attorney and primary victim.\n13. Accused Mustafa Al-Khatib [ID:P601] demanded $100,000,000 USD ransom following the Great Gaddafi Bridge ambush, routing funds from Scully & Pershing New York escrow into Geneva Swiss accounts, Tangier, and Sahara Holdings.`);
                      }}
                    >
                      Preset 4: The Exchange (Libyan Hostage Extortion)
                    </button>
                  </div>
                  <div className="case-actions">
                    <label>Document type
                      <select value={rawSourceType} onChange={event => setRawSourceType(event.target.value)}>
                        <option value="police_fir">Police FIR</option>
                        <option value="court_judgment">English Indian court judgment</option>
                        <option value="other">Other English text</option>
                      </select>
                    </label>
                    <label>Source title
                      <input value={rawTitle} maxLength={120} onChange={event => setRawTitle(event.target.value)} />
                    </label>
                    <label><input type="checkbox" checked={rawSynthetic}
                      onChange={event => setRawSynthetic(event.target.checked)} /> Synthetic example</label>
                  </div>
                  <textarea
                    className="raw-text-area"
                    aria-label="Case text"
                    maxLength={50000}
                    placeholder="Paste raw police FIR, prosecution complaint, or interrogation transcript here..."
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                  />
                  <div className="raw-text-footer">
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Case Scope: <strong style={{ color: 'var(--text-primary)' }}>{activeCase}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn-parse-nlp"
                      disabled={!rawText.trim() || busy}
                      onClick={handleRawTextImport}
                    >
                      Extract mentions
                    </button>
                  </div>
                </div>

                {/* 4 Modality Intake Cards */}
                <div className="intake-grid">
                  {/* 1. Court Cases */}
                  <div className="intake-card">
                    <div>
                      <div className="intake-card-top">

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

                  <div className="case-actions" style={{ marginTop: '12px' }}>
                    <button className="quiet" onClick={() => setTab('Import records')}>Open Import records</button>
                  </div>
                </div>

                {/* Training Trigger Box */}
                <div className="train-box" style={{ marginTop: '16px' }}>
                  <div className="train-box-info">
                    <h3>Run case analysis</h3>
                    <p>
                      Current Case Facts: <strong>{activeStatus.facts_count} records</strong> in SQLite ledger.
                      <br />
                      Checks graph connections and fund-flow cycles. Fits Isolation Forest when a transaction group has enough records.
                    </p>
                  </div>
                  <div className="train-box-actions">
                    <button className="btn-sample" onClick={() => handleLoadSample('the_exchange')} disabled={isTraining || busy}>
                      1-Click Load "The Exchange" Dataset
                    </button>
                    <button
                      className="btn-train-primary"
                      onClick={handleTrainModels}
                      disabled={isTraining || busy || activeStatus.facts_count === 0}
                    >
                      {isTraining ? 'Analyzing…' : 'Run analysis'}
                    </button>
                  </div>
                </div>

                {isTraining && (
                  <div className="training-stepper" role="status">
                    <div className="stepper-head"><span className="step-spin" /> Analyzing case evidence…</div>
                  </div>
                )}
              </section>
            )}

            {isTrained && !showTrainingStudio && (
              <section className="panel">
                <div className="panel-head">
                  <h2>{filteredSuspects.length} person dossiers</h2>
                  <input aria-label="Search dossiers" placeholder="Search names, roles, or IDs"
                    value={search} onChange={event => setSearch(event.target.value)} />
                  <button className="quiet" onClick={() => setShowTrainingStudio(true)}>Open case analysis</button>
                </div>

                {detectedKingpin && (
                  <div className="kingpin-hero-card" style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(185, 28, 28, 0.04) 100%)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          background: '#ef4444',
                          color: '#fff',
                          fontSize: '11px',
                          fontWeight: '700',
                          letterSpacing: '0.04em',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>👑 KINGPIN IDENTIFIED</span>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>{detectedKingpin.name}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>({detectedKingpin.authoritative_id || detectedKingpin.id})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Mastermind Risk Index:</span>
                        <strong style={{ fontSize: '18px', color: '#ef4444' }}>{detectedKingpin.kingpin_score?.toFixed(1)} / 100</strong>
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>
                      Hierarchy: <strong style={{ color: '#ef4444' }}>{detectedKingpin.syndicate_role}</strong>
                      {detectedKingpin.role && <span> · Formally: {detectedKingpin.role}</span>}
                    </p>

                    {detectedKingpin.kingpin_breakdown && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', marginTop: '2px' }}>
                        <span style={{ padding: '3px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                          ⚖️ Judicial: <strong>{detectedKingpin.kingpin_breakdown.judicial} / 30</strong>
                        </span>
                        <span style={{ padding: '3px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                          💸 Laundering Cycles: <strong>{detectedKingpin.kingpin_breakdown.financial} / 30</strong>
                        </span>
                        <span style={{ padding: '3px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                          🚨 Crime Warrants: <strong>{detectedKingpin.kingpin_breakdown.crime} / 25</strong>
                        </span>
                        <span style={{ padding: '3px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                          📞 Telecom C2: <strong>{detectedKingpin.kingpin_breakdown.telecom} / 15</strong>
                        </span>
                        <span style={{ padding: '3px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                          🌐 Centrality: <strong>{detectedKingpin.kingpin_breakdown.network} / 10</strong>
                        </span>
                      </div>
                    )}

                    {detectedKingpin.kingpin_reasons && detectedKingpin.kingpin_reasons.length > 0 && (
                      <ul style={{ margin: '2px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {detectedKingpin.kingpin_reasons.map((r, i) => (
                          <li key={i} style={{ marginBottom: '2px' }}>{r}</li>
                        ))}
                      </ul>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button className="quiet" onClick={() => selectItem(detectedKingpin)}>Review Kingpin Dossier ({detectedKingpin.evidence_ids?.length} sources) →</button>
                      <button className="quiet" onClick={() => isolateInGraph(detectedKingpin)}>Focus Kingpin in Graph</button>
                    </div>
                  </div>
                )}

                {dossierGroups.map(([key, label, matches]) => {
                  const dossiers = filteredSuspects.filter(matches);
                  if (!dossiers.length) return null;
                  return (
                    <section key={key} className={`dossier-group dossier-group--${key}`}>
                      <div className="dossier-group-heading"><h3>{label}</h3><span>{dossiers.length}</span></div>
                      {dossiers.map(dossier => (
                        <article className="suspect-card" key={dossier.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {dossier.is_kingpin && (
                                <span style={{ background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '3px' }}>
                                  KINGPIN #1
                                </span>
                              )}
                              {dossier.role_badge && !dossier.is_kingpin && (
                                <span style={{
                                  background: dossier.is_witness ? '#10b981' : dossier.role_badge === 'LIEUTENANT' ? '#f59e0b' : '#6b7280',
                                  color: '#fff', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '3px'
                                }}>
                                  {dossier.role_badge}
                                </span>
                              )}
                              <h3 style={{ margin: 0 }}>{dossier.name}</h3>
                            </div>
                            {dossier.kingpin_score !== undefined && (
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: dossier.is_kingpin ? '#ef4444' : 'var(--text-secondary)' }}>
                                Risk Index: {dossier.kingpin_score.toFixed(1)}/100
                              </span>
                            )}
                          </div>
                          <p style={{ margin: '2px 0 8px', fontSize: '12px' }}>
                            <strong>{dossier.syndicate_role || dossier.role || 'No explicit source role recorded'}</strong>
                            {dossier.role && dossier.syndicate_role && <span style={{ color: 'var(--text-secondary)' }}> · Formally: {dossier.role}</span>}
                          </p>
                          {['connection', 'flagged_behavior'].map(category => {
                            const findings = (dossier.findings || []).filter(finding => finding.category === category);
                            return findings.length > 0 && (
                              <div key={category}>
                                <h4>{category === 'connection' ? 'Connections' : 'Transaction findings'}</h4>
                                <ul>{findings.map(finding => (
                                  <li key={finding.id}><button className="quiet"
                                    onClick={() => { selectItem(finding); }}>{finding.reason}</button></li>
                                ))}</ul>
                              </div>
                            );
                          })}
                          <div className="case-actions">
                            <button className="quiet" onClick={() => { selectItem(dossier); }}>Inspect sources ({dossier.evidence_ids.length})</button>
                            <button className="quiet" onClick={() => isolateInGraph(dossier)}>Focus in graph</button>
                            <button className="quiet" onClick={() => downloadDossier(dossier)}>Download evidence dossier</button>
                          </div>
                        </article>
                      ))}
                    </section>
                  );
                })}
                {!filteredSuspects.length && <p className="empty">No person dossiers match this search.</p>}
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
                <button className="quiet" onClick={() => selectItem(l)}>
                  Review evidence →
                </button>
              </article>
            ))}
            {!filtered.length && <p className="empty">No findings match this view.</p>}
          </section>
        )}

        {tab === 'Graph explorer' && (
          <GraphExplorerTab
            graph={graph}
            activeCase={activeCase}
            search={search}
            setSearch={setSearch}
            setSelected={selectItem}
            darkMode={darkMode}
          />
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
                  <button className="quiet" onClick={() => selectItem(c)}>
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
                <button className="quiet" onClick={() => selectItem(n)}>
                  View source →
                </button>
              </article>
            ))}
          </section>
        )}

        {tab === 'Import records' && (
          <section className="panel import-panel">
            <h2>Add evidence to a case</h2>
            <p>Upload English FIRs and judgments as PDF or images. Scanned pages use local OCR. Demo formats are for synthetic records. Maximum file size: 25 MiB.</p>
            <form onSubmit={upload}>
              <label>
                Authorized case
                <select key={activeCase} name="case" aria-label="Authorized case" defaultValue={activeCase}>
                  {casesList.map(c => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Record format
                <select name="kind" aria-label="Record format">
                  <option value="ibm">IBM HI-Small CSV</option>
                  <option value="narrative">Synthetic narrative JSON</option>
                  <option value="judgment">English Indian court judgment (.txt)</option>
                  <option value="judgment-document">English Indian court judgment (PDF or image)</option>
                  <option value="fir-document">English police FIR (PDF or image)</option>
                  <option value="cdr">Synthetic CDR CSV</option>
                  <option value="history">Synthetic case-history CSV</option>
                  <option value="pdf">MAHA fixed-layout PDF v1</option>
                </select>
              </label>
              <label>
                Source file
                <input name="file" type="file" accept=".csv,.json,.pdf,.txt,.png,.jpeg,.jpg" required />
              </label>
              <button disabled={!activeCase || busy}>Validate and import →</button>
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
                  {r.summary.legal_mentions?.length > 0 && (
                    <details>
                      <summary>{r.summary.legal_mentions.length} legal mentions to review</summary>
                      {r.summary.legal_mentions.map(({ evidence_id, label }) => (
                        <button key={evidence_id} className="source-button" onClick={() => {
                          selectItem({ label, reason: 'Original model extraction from this judgment' });
                          evidence(evidence_id);
                        }}>{label} ↗</button>
                      ))}
                    </details>
                  )}
                  {r.summary.text_mentions?.length > 0 && (
                    <details>
                      <summary>{r.summary.text_mentions.length} text observations</summary>
                      {r.summary.text_mentions.map(({ evidence_id, label }) => (
                        <button key={evidence_id} className="source-button" onClick={() => {
                          selectItem({ label, reason: 'Source observation from pasted text' });
                          evidence(evidence_id);
                        }}>{label} ↗</button>
                      ))}
                    </details>
                  )}
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
              <h2>Benchmark results</h2>
              <span className="badge">DATASETS REPORTED SEPARATELY</span>
            </div>
            {list.filter(report => report.layers).map(report => (
              <article className="benchmark" key={report.dataset}>
                <h2>{report.dataset}</h2>
                <p>{report.scope}. {report.shared_nodes} nodes appear in both layers.</p>
                {Object.entries(report.layers).map(([name, layer]) => (
                  <div key={name}>
                    <h3>{name.replaceAll('_', ' ')}</h3>
                    <p>{layer.nodes} nodes, {layer.edges} ties, {layer.communities} communities.
                      Clan agreement (adjusted Rand index) {layer.clan_adjusted_rand_index?.toFixed(3) ?? 'unavailable'} across {layer.clan_labeled_nodes} labeled nodes.</p>
                    <table>
                      <thead><tr><th>Metric</th><th>Boss median rank</th><th>Member median rank</th><th>Bosses ranked 10 or better</th></tr></thead>
                      <tbody>
                        {Object.entries(layer.ranks).map(([metric, ranks]) => (
                          <tr key={metric}><td>{metric}</td><td>{ranks.boss_median_rank ?? '—'}</td>
                            <td>{ranks.member_median_rank ?? '—'}</td><td>{ranks.bosses_ranked_at_most_10} / {layer.bosses}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <p>Ranks use explicit role labels from the release. Results describe one observed network.</p>
              </article>
            ))}
            {list.filter(r => r.metrics).map(r => (
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
        <aside className="drawer" aria-label="Evidence detail">
          <button
            className="close"
            ref={drawerClose}
            onClick={() => {
              drawerClose.current.dataset.restoreFocus = 'true';
              selectItem(null);
            }}
            aria-label="Close evidence panel"
          >
            ×
          </button>
          <p className="eyebrow">EVIDENCE DETAIL</p>
          <h2>{selected.title ? `${selected.title}: ${selected.name}` : selected.label || selected.left_name || selected.name || 'Finding for review'}</h2>
          <p>{selected.role || selected.reason || selected.type || 'Inspect the source references below.'}</p>
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
              <span className="tag">{ev.synthetic ? 'SYNTHETIC' : ev.dataset_id === 'court-judgment' ? 'LEGAL MENTION' : 'SOURCE EVIDENCE'}</span>
              <h3>{ev.source}</h3>
              {ev.source_locator?.text_method && (
                <p>Page {ev.source_locator.page} · {ev.source_locator.text_method === 'pdf-text' ? 'Embedded PDF text' : 'Local OCR'}
                  {' · '}Characters {ev.source_locator.char_start}–{ev.source_locator.char_end}</p>
              )}
              {!ev.source_locator?.text_method && <p>{JSON.stringify(ev.source_locator)}</p>}
              {ev.source_locator?.text_method && (
                <div className="document-source-actions">
                  <SourcePage key={ev.id} evidence={ev} token={token} />
                  <button className="quiet" onClick={() => downloadOriginal(ev)}>Download original document</button>
                </div>
              )}
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
          {ev?.dataset_id === 'court-judgment' && ev.extraction_method === 'en_legal_ner_sm' && (
            <JudgmentReview key={ev.id} evidenceId={ev.id} api={api} />
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
        </aside>
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
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Create an isolated investigation container. The case will start completely clean with 0 facts and un-trained models.
            </p>
            <form onSubmit={handleCreateCase}>
              <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
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
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
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
                    Download {t.filename}
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
