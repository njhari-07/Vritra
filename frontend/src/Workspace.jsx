import React, { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import GraphView from './components/GraphView';
import JudgmentReview from './components/JudgmentReview';
import SourcePage from './components/SourcePage';
import RecordIntakeModes from './components/RecordIntakeModes';
import RecordFilePicker from './components/RecordFilePicker';
import StatementRowReview from './components/StatementRowReview';
import LeadsPanel from './components/LeadsPanel';
import ResolutionTab from './components/ResolutionTab';
import TimelineTab from './components/TimelineTab';
import ImportRecordsTab from './components/ImportRecordsTab';
import QualityTab from './components/QualityTab';
import AuditTab from './components/AuditTab';
import BenchmarksTab from './components/BenchmarksTab';
import EvidenceDrawer from './components/EvidenceDrawer';
import GraphExplorerTab from './components/GraphExplorerTab';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// Styles (style.css, record-intake.css, Tailwind) are loaded once from index.css in main.jsx.

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
  const [uploadKind, setUploadKind] = useState('ibm');
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const uploading = uploadFeedback?.status === 'pending';

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
    if (uploading) return;
    const form = e.currentTarget;
    const f = new FormData(form),
      file = f.get('file');
    if (!file?.size) {
      setUploadFeedback({ status: 'error', message: 'Choose a file that is not empty.' });
      return;
    }
    const kind = f.get('kind'), caseId = f.get('case');
    const statement = kind === 'bank-statement';
    if (statement) {
      form.elements.password.value = '';
      f.delete('kind');
      f.delete('case');
    }
    setBusy(true);
    setUploadFeedback({ status: 'pending', message: statement ? 'Reading statement rows… This may take a moment.' : 'Importing records…' });
    try {
      const r = await api(`/import/${kind}/${encodeURIComponent(caseId)}`, {
        method: 'POST',
        body: statement ? f : file
      });
      if (token !== sessionToken.current) return;
      setUploadFeedback({
        status: 'success',
        message: `${r.accepted_new} accepted · ${r.recognized_repeat} repeated · ${r.quarantined} quarantined${statement ? '. Open Quality to review statement rows.' : ''}`,
      });
      await load(caseId);
    } catch (e) {
      if (token === sessionToken.current) setUploadFeedback({ status: 'error', message: e.message });
    } finally {
      if (token === sessionToken.current) setBusy(false);
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
    ['witness', 'Witnesses in source records', s => s.source_roles?.some(role => /\bwitness\b/i.test(role))],
    ['other', 'Other people in case records', s => !s.source_roles?.some(role => /\bwitness\b/i.test(role))]
  ];
  const filteredSuspects = suspects.filter(s =>
    [s.name, s.role, s.authoritative_id].join(' ').toLowerCase().includes(search.toLowerCase())
  );

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
              setUploadFeedback(null);
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
                : tab === 'Import records'
                ? 'Add source evidence from a file or paste case text for extraction.'
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

                <div className="case-actions">
                  <button className="quiet" onClick={() => setTab('Import records')}>Open Import records</button>
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
                    <button className="btn-sample" onClick={handleLoadSample} disabled={isTraining || busy}>
                      1-Click Load Sample Package
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
                {dossierGroups.map(([key, label, matches]) => {
                  const dossiers = filteredSuspects.filter(matches);
                  if (!dossiers.length) return null;
                  return (
                    <section key={key} className={`dossier-group dossier-group--${key}`}>
                      <div className="dossier-group-heading"><h3>{label}</h3><span>{dossiers.length}</span></div>
                      {dossiers.map(dossier => (
                        <article className="suspect-card" key={dossier.id}>
                          <h3>{dossier.name}</h3>
                          <p>{dossier.role || 'No explicit source role recorded'}</p>
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
            analysis={analysis}
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
                <time>{n.time_basis === 'date_only' ? n.event_time.slice(0, 10) : new Date(n.event_time).toLocaleString()}</time>
                <strong>{n.label}</strong>
                <button className="quiet" onClick={() => selectItem(n)}>
                  View source →
                </button>
              </article>
            ))}
          </section>
        )}

        {tab === 'Import records' && (
          <div className="record-intake tw:grid tw:min-w-0 tw:items-start tw:gap-5 tw:min-[1160px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <RecordIntakeModes>
              <section className="record-card record-paste" aria-labelledby="record-paste-title">
                <h2 id="record-paste-title">Paste case text</h2>
                <p>
                  Extract mentions from English case text and review them in Quality.
                </p>
                <div className="record-presets tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
                  <span>Try an example</span>
                  <button
                    type="button"
                    className="record-chip"
                    onClick={() => {
                      setRawSynthetic(true);
                      setRawSourceType('police_fir');
                      setRawTitle('ED-PMLA-COMPLAINT-142');
                      setRawText(`IN THE SPECIAL COURT FOR PMLA OFFENSES: Directorate of Enforcement vs. Vikram Singhania [ID:P001] & Ors.\nPrime Accused Vikram Singhania operates HDFC Bank account 001928374 for layering procurement fraud kickbacks of ₹14,200,000.\nCo-conspirator Rajesh Sharma operates ICICI Bank account 009847261 as hawala mule routing pass-through tranches.\nCharges registered under PMLA Section 3 & 4 and IPC Section 420 and 120B.\nNon-Bailable Warrant issued by EOW.`);
                    }}
                  >
                    Procurement FIR
                  </button>
                  <button
                    type="button"
                    className="record-chip"
                    onClick={() => {
                      setRawSynthetic(true);
                      setRawSourceType('police_fir');
                      setRawTitle('CYBER-PS-FIR-204');
                      setRawText(`CYBER CRIME POLICE STATION: State vs. Dev Shah [ID:P003] & Associates.\nAccused Dev Shah operates darknet crypto conversion infrastructure and Axis Bank account 005511223.\nMule coordinator Vikas Agarwal routed funds through Axis Bank and ICICI Bank.\nFIR No. 204/2023 under IT Act Section 66D and IPC Section 420. Look-Out Circular (LOC) active at international airports.`);
                    }}
                  >
                    Cyber fraud FIR
                  </button>
                  <button
                    type="button"
                    className="record-chip"
                    onClick={() => {
                      setRawSynthetic(true);
                      setRawSourceType('police_fir');
                      setRawTitle(`EOW-FIR-144-${activeCase}`);
                      setRawText(`POLICE STATION: Economic Offenses Wing (EOW), Mandir Marg, New Delhi\nFIR No: 144/2026 | Date: 12-03-2026\nActs & Sections: Section 420 IPC (Cheating), Section 120B IPC (Criminal Conspiracy), read with Section 3 & 4 of Prevention of Money Laundering Act, 2002 (PMLA).\n(i) Accused Vikram Malhotra [ID:P101], Managing Director, Zenith Health Ventures Ltd. Role: Prime Syndicate Mastermind and beneficial owner of destination fund accounts.\n(ii) Accused Sanjay Agarwal [ID:P102], Financial Consultant & Hawala Remittance Mule Coordinator. Operates account ACC-AGARWAL-882 at Bank 010.\n(iii) Accused Karan Singhania [ID:P103], Dummy Director, Apex Logistics Front Corp. Operates account ACC-APEXSHELL-993 at Bank 010.\n(iv) Accused Rohit Verma [ID:P104], Operator of unauthorized digital escrow and crypto mixing channels, account ACC-VERMA-104 at Bank 010.\nAllegations: Accused Vikram Malhotra [ID:P101] utilized shell corporate vehicles to route approximately $750,000 USD of misappropriated funds through closed-loop layering transfers. Primary layering was executed through bank account 010 / ACC-MALHOTRA-771 into mule account 010 / ACC-AGARWAL-882, which was then layered into shell account 010 / ACC-APEXSHELL-993 before returning into primary beneficiary accounts under the guise of dividend reinvestment.`);
                    }}
                  >
                    Zenith healthcare FIR
                  </button>
                </div>
                <div className="record-fields tw:grid tw:gap-3 tw:sm:grid-cols-2">
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
                  <label className="record-check tw:col-span-full tw:flex tw:items-center tw:gap-2"><input type="checkbox" checked={rawSynthetic}
                    onChange={event => setRawSynthetic(event.target.checked)} /> Synthetic example</label>
                </div>
                <div className="record-text-meta tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-3">
                  <label htmlFor="import-case-text">Case text</label>
                  <span>{rawText.length.toLocaleString()} / 50,000 characters</span>
                </div>
                <textarea
                  id="import-case-text"
                  className="record-textarea tw:block tw:min-h-[238px] tw:w-full tw:resize-y"
                  maxLength={50000}
                  placeholder="Paste an FIR, judgment, or other case text here…"
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                />
                <div className="record-actions tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
                  <span className="record-scope">Active case <strong>{activeCase || 'No case selected'}</strong></span>
                  <button
                    type="button"
                    className="record-primary"
                    disabled={!rawText.trim() || busy}
                    onClick={handleRawTextImport}
                  >
                    Extract mentions
                  </button>
                </div>
              </section>
              <section className="record-card record-upload" aria-labelledby="record-upload-title">
                <h2 id="record-upload-title">Upload a file</h2>
                <p>Select the case and format before uploading. Scanned English FIRs and judgments use local OCR.</p>
                <form className="tw:grid tw:gap-4" onSubmit={upload}
                  onChange={() => { if (!uploading) setUploadFeedback(null); }}>
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
                    <select name="kind" aria-label="Record format" value={uploadKind}
                      onChange={event => setUploadKind(event.target.value)}>
                      <option value="ibm">IBM HI-Small CSV</option>
                      <option value="bank-statement">Bank statement (PDF or Excel .xlsx)</option>
                      <option value="narrative">Synthetic narrative JSON</option>
                      <option value="judgment">English Indian court judgment (.txt)</option>
                      <option value="judgment-document">English Indian court judgment (PDF or image)</option>
                      <option value="fir-document">English police FIR (PDF or image)</option>
                      <option value="cdr">Synthetic CDR CSV</option>
                      <option value="history">Synthetic case-history CSV</option>
                      <option value="pdf">MAHA fixed-layout PDF v1</option>
                    </select>
                  </label>
                  {uploadKind === 'bank-statement' && (
                    <>
                      <div className="record-fields tw:grid tw:gap-3 tw:sm:grid-cols-2">
                        <label>Statement currency
                          <select name="currency" defaultValue="INR">
                            {['INR', 'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF']
                              .map(code => <option key={code}>{code}</option>)}
                          </select>
                        </label>
                        <label>Numeric date order
                          <select name="date_order" defaultValue="DMY">
                            <option value="DMY">Day / month / year</option>
                            <option value="MDY">Month / day / year</option>
                          </select>
                        </label>
                      </div>
                      <label>PDF pages (optional)
                        <input type="text" name="pdf_pages" placeholder="e.g. 1-10" maxLength={32}
                          aria-describedby="statement-pages-hint" />
                        <small id="statement-pages-hint">Leave blank to read the whole file. For PDFs, enter a page or range to import only those pages.</small>
                      </label>
                      <label>File password (if protected)
                        <input type="password" name="password" autoComplete="off" maxLength={1024}
                          aria-describedby="statement-password-hint" />
                        <small id="statement-password-hint">Used for one upload. Re-enter it before retrying a protected file.</small>
                      </label>
                    </>
                  )}
                  <RecordFilePicker name="file"
                    accept={uploadKind === 'bank-statement' ? '.pdf,.xlsx' : '.csv,.json,.pdf,.txt,.png,.jpeg,.jpg'}
                    label="Source file" required />
                  <button className="record-primary" disabled={!activeCase || busy || uploading}>
                    {uploading ? 'Importing…' : 'Validate and import'}
                  </button>
                  {uploadFeedback && (
                    <div className="record-upload-feedback" data-status={uploadFeedback.status}
                      role={uploadFeedback.status === 'error' ? 'alert' : 'status'}>
                      {uploadFeedback.message}
                    </div>
                  )}
                </form>
              </section>
            </RecordIntakeModes>
            <section className="record-shortcuts tw:min-w-0" aria-labelledby="record-quick-title">
              <h2 id="record-quick-title">Structured imports</h2>
              <p>Files selected here import directly into the active case. Download a template for the format you need.</p>
              <div className="tw:grid tw:grid-cols-1 tw:gap-3 tw:sm:grid-cols-2">
                {/* 1. Court Cases */}
                <div className="record-card record-quick tw:flex tw:min-w-0 tw:flex-col tw:justify-between tw:gap-4">
                  <div>
                    <div className="record-quick-heading">

                      <div>
                        <h3>Court proceedings</h3>
                        <span className="record-format">Synthetic narrative</span>
                      </div>
                    </div>
                    <p>
                      Legal narratives in the synthetic case format.
                    </p>
                  </div>
                  <div>

                    <div className="tw:grid tw:min-w-0 tw:gap-2">
                      <RecordFilePicker accept=".json" label="Upload court proceedings JSON"
                        onPick={file => handleDirectUpload('narrative', file)} />
                      <button
                        type="button"
                        className="record-secondary"
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
                        Download template
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Financial Transactions */}
                <div className="record-card record-quick tw:flex tw:min-w-0 tw:flex-col tw:justify-between tw:gap-4">
                  <div>
                    <div className="record-quick-heading">

                      <div>
                        <h3>Financial wires</h3>
                        <span className="record-format">IBM HI-Small</span>
                      </div>
                    </div>
                    <p>
                      Transactions in the IBM HI-Small CSV layout.
                    </p>
                  </div>
                  <div>

                    <div className="tw:grid tw:min-w-0 tw:gap-2">
                      <RecordFilePicker accept=".csv" label="Upload financial wires CSV"
                        onPick={file => handleDirectUpload('ibm', file)} />
                      <button
                        type="button"
                        className="record-secondary"
                        onClick={() => {
                          downloadFile(
                            'transactions_template.csv',
                            "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n2026/03/10 10:15,DEMO,A,DEMO,B,100000.00,US Dollar,100000.00,US Dollar,ACH,1\n2026/03/10 11:30,DEMO,B,DEMO,C,107000.00,US Dollar,107000.00,US Dollar,ACH,1\n2026/03/10 12:45,DEMO,C,DEMO,A,114000.00,US Dollar,114000.00,US Dollar,ACH,1\n",
                            'csv'
                          );
                        }}
                      >
                        Download template
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Crime FIR History */}
                <div className="record-card record-quick tw:flex tw:min-w-0 tw:flex-col tw:justify-between tw:gap-4">
                  <div>
                    <div className="record-quick-heading">

                      <div>
                        <h3>FIR history</h3>
                        <span className="record-format">History Registry CSV</span>
                      </div>
                    </div>
                    <p>
                      Structured prior records with a status and date.
                    </p>
                  </div>
                  <div>

                    <div className="tw:grid tw:min-w-0 tw:gap-2">
                      <RecordFilePicker accept=".csv" label="Upload FIR history CSV"
                        onPick={file => handleDirectUpload('history', file)} />
                      <button
                        type="button"
                        className="record-secondary"
                        onClick={() => {
                          downloadFile(
                            'crime_firs_template.csv',
                            `record_id,person_id,case_id,record_date,record_status,text,synthetic\nFIR-01,P001,${activeCase},2026-01-14,Active Charge-Sheet,FIR No. 44/2026 under IPC 420/120B and PMLA Section 3 for syndicate fraud,true\nFIR-02,P002,${activeCase},2026-02-02,Look Out Circular,LOC Issued at International Airports for evasion of summons,true\n`,
                            'csv'
                          );
                        }}
                      >
                        Download template
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4. Telecom CDR */}
                <div className="record-card record-quick tw:flex tw:min-w-0 tw:flex-col tw:justify-between tw:gap-4">
                  <div>
                    <div className="record-quick-heading">

                      <div>
                        <h3>Telecom calls</h3>
                        <span className="record-format">Synthetic CDR</span>
                      </div>
                    </div>
                    <p>
                      Caller, callee, timestamp, and call duration.
                    </p>
                  </div>
                  <div>

                    <div className="tw:grid tw:min-w-0 tw:gap-2">
                      <RecordFilePicker accept=".csv" label="Upload telecom CDR CSV"
                        onPick={file => handleDirectUpload('cdr', file)} />
                      <button
                        type="button"
                        className="record-secondary"
                        onClick={() => {
                          downloadFile(
                            'cdr_calls_template.csv',
                            "record_id,caller_person_id,callee_person_id,start_time,duration_seconds,synthetic\nCALL-101,P001,P002,2026-03-10T09:45:00+00:00,420,true\nCALL-102,P002,P003,2026-03-10T12:10:00+00:00,185,true\nCALL-103,P003,P001,2026-03-10T15:00:00+00:00,310,true\n",
                            'csv'
                          );
                        }}
                      >
                        Download template
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
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
                  {r.summary.statement_rows?.length > 0 && (
                    <details>
                      <summary>Bank statement · {r.summary.statement_settings.currency} · Review first {r.summary.statement_rows.length} rows</summary>
                      {r.summary.statement_rows.map(({ evidence_id, label }) => (
                        <button key={evidence_id} className="source-button" onClick={() => {
                          selectItem({ label, reason: 'Bank statement transaction as recorded in the source' });
                          evidence(evidence_id);
                        }}>{label}</button>
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
              {ev.extraction_method === 'bank-statement-row' ? (
                <>
                  <button className="quiet" onClick={() => downloadOriginal(ev)}>Download original statement</button>
                  <StatementRowReview key={ev.id} evidence={ev} api={api} />
                </>
              ) : <blockquote>{ev.passage}</blockquote>}
              <small>
                {ev.extraction_method} · v{ev.extraction_version}
                <br />
                Event: {ev.time_basis === 'date_only' ? ev.event_time.slice(0, 10) + ' (date only)' : ev.event_time || 'Not supplied'}
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

      {/* Create New Case dialog (shadcn) */}
      <Dialog open={showNewCaseModal} onOpenChange={setShowNewCaseModal}>
        <DialogContent className={`tw:sm:max-w-[440px] ${darkMode ? 'dark-theme' : ''}`}>
          <DialogHeader>
            <DialogTitle>Create a new investigation case</DialogTitle>
            <DialogDescription>
              The case starts empty, with no facts and no analysis run yet.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCase} className="tw:grid tw:gap-5">
            <label className="tw:grid tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-foreground">
              Case ID
              <input
                placeholder="e.g. CASE-2026-X1"
                value={newCaseInput}
                onChange={e => setNewCaseInput(e.target.value)}
                required
                autoFocus
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNewCaseModal(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>Create case</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Data templates dialog (shadcn) */}
      <Dialog open={Boolean(showTemplateModal && templates)} onOpenChange={setShowTemplateModal}>
        <DialogContent className={`tw:sm:max-w-2xl ${darkMode ? 'dark-theme' : ''}`}>
          <DialogHeader>
            <DialogTitle>Import formats and templates</DialogTitle>
            <DialogDescription>
              Use these exact file formats and headers to import real or synthetic records for court hearings, bank transactions, police FIRs and telecom calls.
            </DialogDescription>
          </DialogHeader>
          {Object.entries(templates || {}).map(([key, t]) => (
            <div className="template-item" key={key}>
              <h4>
                <span>{t.title}</span>
                <Button variant="outline" size="sm" className="tw:h-7 tw:min-h-0 tw:text-[11px]"
                  onClick={() => downloadFile(t.filename, t.content, t.format)}>
                  Download {t.filename}
                </Button>
              </h4>
              <p>{t.description}</p>
              <pre>{t.content.slice(0, 320) + (t.content.length > 320 ? '\n...' : '')}</pre>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
