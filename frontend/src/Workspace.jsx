import React, { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import GraphView from './components/GraphView';
import RecordIntakeModes from './components/RecordIntakeModes';
import RecordFilePicker from './components/RecordFilePicker';
import { ReportSettings, ReportPreview, SavedWireRows } from './components/ReportImport';
import StatementImportRows, { PAYMENT_COLUMNS } from './components/StatementImportRows';
import StatementPageCoverage from './components/StatementPageCoverage';
import StatementReconciliation from './components/StatementReconciliation';
import BrandMark from './components/BrandMark';
import DynamicBrand from './components/DynamicBrand';
import LeadsPanel from './components/LeadsPanel';
import ResolutionQueue from './components/ResolutionQueue';
import LocationTimeline from './components/LocationTimeline';
import DocumentPlaces from './components/DocumentPlaces';
import ImportRecordsTab from './components/ImportRecordsTab';
import QualityTab from './components/QualityTab';
import AuditTab from './components/AuditTab';
import BenchmarksTab from './components/BenchmarksTab';
import EvidenceDrawer from './components/EvidenceDrawer';
import FindingsReview from './components/FindingsReview';
import GraphExplorerTab from './components/GraphExplorerTab';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// Styles (style.css, record-intake.css, Tailwind) are loaded once from index.css in main.jsx.

const HeroScene = lazy(() => import('./components/three/HeroScene'));
const StatementMoneyFlow = lazy(() => import('./components/StatementMoneyFlow'));
const CallReportExplorer = lazy(() => import('./components/CallReportExplorer'));

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
  const navigate = useNavigate();
  const moneyFlow = useMatch('/app/statement-flow/:importId');
  const callFlow = useMatch('/app/call-flow/:importId');
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
  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [samplePackages, setSamplePackages] = useState([]);
  const [sampleDataset, setSampleDataset] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [selected, setSelected] = useState(null);
  const [ev, setEv] = useState(null);
  const [search, setSearch] = useState('');
  // Rows for the Resolution / Timeline / Quality / Audit / Benchmarks tabs, tagged with the tab they were
  // loaded for. Each tab only renders its own rows, so switching tabs never draws another tab's data.
  const [listState, setListState] = useState({ tab: null, rows: [] });
  const list = listState.tab === tab && Array.isArray(listState.rows) ? listState.rows : [];
  const [notice, setNotice] = useState('');
  const sessionToken = useRef('');
  const caseRequest = useRef(null);
  const casePreference = useRef(Promise.resolve());
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
  const [rawIsExample, setRawIsExample] = useState(false);
  const [uploadKind, setUploadKind] = useState('');
  const [intakeProfile, setIntakeProfile] = useState(null);
  const intakeForm = useRef(null);
  const intakeRequest = useRef(null);
  const manualIntakeKind = useRef('');
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const [statementPage, setStatementPage] = useState(null);
  const [statementDividers, setStatementDividers] = useState('');
  const [statementCorrections, setStatementCorrections] = useState({});
  const uploading = uploadFeedback?.status === 'pending';
  const statementPaymentColumns = PAYMENT_COLUMNS.filter(([key]) => uploadFeedback?.rows?.some(row => key in row.fields));

  useEffect(() => {
    if (!statementPage) return;
    return () => URL.revokeObjectURL(statementPage.url);
  }, [statementPage]);

  useEffect(() => {
    setStatementPage(null);
    setStatementCorrections({});
    setUploadFeedback(null);
    setIntakeProfile(null);
    return () => intakeRequest.current?.abort();
  }, [activeCase, tab, token]);

  // Feature 4: ML Tuning & Weights

  // Modals
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [newCaseInput, setNewCaseInput] = useState('');

  const api = useCallback(async (path, { raw = false, ...options } = {}) => {
    const r = await fetch('/api' + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...options.headers }
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({ detail: r.statusText }));
      throw Error(d.detail || 'Request failed');
    }
    return raw ? r : r.json();
  }, [token]);

  const inspectFile = async file => {
    const caseId = intakeForm.current?.elements.case.value;
    if (!caseId) return;
    intakeRequest.current?.abort();
    const controller = new AbortController();
    intakeRequest.current = controller;
    setUploadKind(manualIntakeKind.current);
    setIntakeProfile({ loading: true });
    try {
      const profile = await api(`/intake/${encodeURIComponent(caseId)}/inspect`, {
        method: 'POST', body: file, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setIntakeProfile(profile);
      if (!manualIntakeKind.current && profile.kind) setUploadKind(profile.kind);
    } catch (err) {
      if (!controller.signal.aborted) setIntakeProfile({ error: err.message });
    }
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
      const preferred = targetCase || m.active_case || activeCase;
      const selCase = cList.find(item => item.case_id === preferred)?.case_id || cList[0]?.case_id || '';
      if (selCase && selCase !== m.active_case) {
        // Queue writes so switching cases cannot leave an older choice saved last.
        const save = casePreference.current.catch(() => {}).then(async () => {
          if (!controller.signal.aborted) {
            await api('/workspace/case', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ case_id: selCase }),
            });
          }
        });
        casePreference.current = save;
        await save;
      }
      if (controller.signal.aborted) return;
      setMe({ ...m, active_case: selCase || null });
      setCasesList(cList);
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
      if (event.key === 'Escape' && close?.closest('.evidence-drawer')?.contains(document.activeElement)) {
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
    setListState({ tab: null, rows: [] });
    if (!me || !activeCase) return;
    let current = true;
    const paths = {
      Resolution: '/candidates?case=' + encodeURIComponent(activeCase),
      Timeline: '/timeline?case=' + encodeURIComponent(activeCase),
      Quality: '/quality?case=' + encodeURIComponent(activeCase),
      Audit: '/audit?case=' + encodeURIComponent(activeCase),
      Benchmarks: '/benchmarks'
    };
    if (paths[tab]) api(paths[tab]).then(data => { if (current) setListState({ tab, rows: data }); })
      .catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [tab, me, activeCase]);

  const changeCase = cId => {
    selectItem(null);
    setGraph(null);
    setAnalysis(null);
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

  const openSamplePicker = async () => {
    setSampleError('');
    setShowSamplePicker(true);
    if (samplePackages.length) return;
    try {
      const packages = await api('/sample-datasets');
      setSamplePackages(packages);
      setSampleDataset(packages[0]?.id || '');
    } catch (e) {
      setSampleError(e.message);
    }
  };

  const handleLoadSample = async event => {
    event.preventDefault();
    if (!activeCase || !sampleDataset || busy) return;
    setBusy(true);
    setSampleError('');
    try {
      const result = await api(
        `/cases/${encodeURIComponent(activeCase)}/load-sample?dataset=${encodeURIComponent(sampleDataset)}`,
        { method: 'POST' }
      );
      setShowSamplePicker(false);
      const outcome = [
        `${result.accepted_new} evidence records added`,
        result.recognized_repeat && `${result.recognized_repeat} already present`,
        result.quarantined && `${result.quarantined} quarantined`,
      ].filter(Boolean).join(' · ');
      setNotice(`${result.title} loaded into ${activeCase}. ${outcome}.`);
      await load(activeCase);
    } catch (e) {
      setSampleError(e.message);
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
          synthetic: rawIsExample
        })
      });
      setNotice(`${res.summary.accepted_new} new evidence records · ${res.summary.recognized_repeat} repeats. Open Quality to inspect them.`);
      setRawText('');
      setRawIsExample(false);
      await load(activeCase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    try {
      await api('/candidates/' + encodeURIComponent(c.id) + '?case=' + encodeURIComponent(activeCase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, reason })
      });
      await load(activeCase);
      setNotice('Resolution decision saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
    if (!kind || intakeProfile?.loading) return;
    if (kind === 'calls-document' || kind === 'wires-document') {
      const save = e.nativeEvent.submitter?.value === 'save-report';
      const pendingReview = uploadFeedback?.report;
      const params = new URLSearchParams();
      for (const name of ['first', 'last', 'offset', 'date_order', 'dividers']) {
        const value = f.get('report_' + name)?.trim();
        if (value) params.set(name, value);
      }
      const mapping = [...f.entries()].filter(([name, value]) => name.startsWith('report_column_') && value !== '')
        .map(([name, value]) => name.slice('report_column_'.length) + ':' + value);
      if (mapping.length) params.set('mapping', mapping.join(','));
      if (save) {
        if (!pendingReview?.accepted || pendingReview.file !== file || pendingReview.caseId !== caseId) return;
        params.set('review_digest', pendingReview.review_digest);
        params.set('accept_partial', String(f.has('report_partial')));
      }
      setBusy(true);
      setUploadFeedback({ report: pendingReview, status: 'pending', message: save ? 'Saving reviewed records…' : 'Reading the report…' });
      try {
        const type = kind === 'calls-document' ? 'calls' : 'wires';
        const result = await api(`/report-intake/${type}/${encodeURIComponent(caseId)}?${params}`, { method: 'POST', body: file });
        if (token !== sessionToken.current) return;
        if (save) {
          setUploadFeedback({
            status: 'success',
            message: `${result.accepted_new} accepted · ${result.recognized_repeat} repeated · ${result.quarantined} quarantined. See Quality for the import record.`,
            callImportId: type === 'calls' ? result.import_id : null,
          });
          await load(caseId);
        } else if (form.elements.file.files[0] === file && form.elements.case.value === caseId && form.elements.kind.value === kind) {
          setUploadFeedback({ status: 'preview', message: 'Compare the rows against the source pages, then save reviewed records.',
            report: { ...result, file, caseId } });
        } else {
          setUploadFeedback(null);
        }
      } catch (error) {
        if (token === sessionToken.current) setUploadFeedback({ report: pendingReview, status: 'error', message: error.message });
      } finally {
        if (token === sessionToken.current) setBusy(false);
      }
      return;
    }
    const statement = kind === 'bank-statement';
    const preview = statement && e.nativeEvent.submitter?.value === 'statement-preview';
    const viewPage = statement && e.nativeEvent.submitter?.value === 'statement-page';
    const evidenceOnly = statement && e.nativeEvent.submitter?.value === 'statement-evidence';
    const selectedFile = form.elements.file.files[0];
    const savedPreview = uploadFeedback?.rows ? uploadFeedback : null;
    if (statement) {
      const columns = {};
      for (const [name, value] of [...f.entries()]) {
        if (name.startsWith('map_column_')) {
          if (value !== '') columns[name.slice('map_column_'.length)] = Number(value);
          f.delete(name);
        }
      }
      const dividers = f.get('map_dividers')?.trim();
      f.delete('map_dividers');
      if (!viewPage && (Object.keys(columns).length || dividers)) {
        const separators = dividers ? dividers.split(',').map(value => Number(value.trim())) : [];
        f.set('column_mapping', JSON.stringify({ columns, separators }));
      }
      if (!viewPage && Object.keys(statementCorrections).length) {
        f.set('row_corrections', JSON.stringify(statementCorrections));
      }
      form.elements.password.value = '';
      f.delete('kind');
      f.delete('case');
    }
    setBusy(true);
    setUploadFeedback({ ...savedPreview, status: 'pending', message: viewPage ? 'Rendering statement page…' : statement ? 'Reading statement rows… This may take a moment.' : 'Importing records…' });
    try {
      const action = viewPage ? '?layout_page=true' : preview ? '?preview=true' : evidenceOnly ? '?destination=evidence' : '';
      const r = await api(`/import/${kind}/${encodeURIComponent(caseId)}${action}`, {
        method: 'POST',
        body: statement ? f : file,
        raw: viewPage,
      });
      if (token !== sessionToken.current) return;
      if (viewPage) {
        const image = await r.blob();
        if (token !== sessionToken.current) return;
        if (form.isConnected && form.elements.file.files[0] === selectedFile && form.elements.case.value === caseId
          && form.elements.pdf_pages?.value === f.get('pdf_pages')) {
          setStatementPage({ url: URL.createObjectURL(image), number: r.headers.get('X-Statement-Page') });
        }
        setUploadFeedback(savedPreview);
        return;
      }
      if (preview) {
        setUploadFeedback({
          status: 'preview',
          message: `${r.accepted} valid · ${r.rejected} rejected · Showing ${r.rows.length} candidates. Nothing imported.`,
          rows: r.rows,
          accepted: r.accepted,
          graphImpact: r.graph_impact,
          inferredPages: r.balance_inferred_pages,
          inferredSheets: r.balance_inferred_sheets,
          pageCoverage: r.page_coverage,
          pageRange: r.page_range,
          balanceChecks: r.balance_checks,
          reconciliation: r.reconciliation,
          recoveredLayoutRows: r.recovered_layout_rows,
        });
        return;
      }
      setUploadFeedback({
        status: 'success',
        message: `${statement ? `${r.statement_name} · ` : ''}${r.accepted_new} accepted · ${r.recognized_repeat} repeated · ${r.quarantined} quarantined${evidenceOnly ? ' · Saved as statement evidence' : ''}${statement ? '. Open Quality to verify saved rows.' : ''}`,
        pageCoverage: r.statement_scope?.coverage,
        pageRange: r.statement_scope?.requested,
        reconciliation: r.statement_scope?.reconciliation,
      });
      setStatementCorrections({});
      await load(caseId);
    } catch (e) {
      if (token === sessionToken.current) setUploadFeedback({ ...savedPreview, status: 'error', message: e.message });
    } finally {
      if (token === sessionToken.current) setBusy(false);
    }
  };

  function statementField(row, field, label, fallback) {
    if (!row.repairable?.includes(field)) return fallback || '—';
    return <input type="text" maxLength={64} data-statement-edit="true"
      className="statement-preview-input" aria-label={`${label} for source row ${row.locator.row}`}
      disabled={uploading} value={statementCorrections[row.candidate_id]?.[field] ?? row.fields[field] ?? ''}
      onChange={event => {
        const value = event.target.value;
        setStatementCorrections(previous => ({
          ...previous, [row.candidate_id]: { ...previous[row.candidate_id], [field]: value },
        }));
      }} />;
  }

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
          <DynamicBrand size={28} />
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

  if (moneyFlow) return (
    <Suspense fallback={<main className="workspace" role="status">Loading financial explorer…</main>}>
      <StatementMoneyFlow key={moneyFlow.params.importId} importId={moneyFlow.params.importId} api={api}
        activeCase={activeCase} people={graph?.nodes?.filter(item => item.type === 'Person') || []} darkMode={darkMode}
        onBack={() => { setTab('Quality'); navigate('/app'); }} onOwnerSaved={() => load(activeCase)} />
    </Suspense>
  );

  if (callFlow) return (
    <Suspense fallback={<main className="workspace" role="status">Loading call report explorer…</main>}>
      <CallReportExplorer key={callFlow.params.importId} importId={callFlow.params.importId} api={api}
        darkMode={darkMode} onBack={() => { setTab('Quality'); navigate('/app'); }} />
    </Suspense>
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
          <DynamicBrand size={28} />
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
              setStatementPage(null);
              setStatementDividers('');
              setStatementCorrections({});
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
            <button className="btn-tmpl" onClick={openSamplePicker} disabled={!activeCase || busy}>
              Sample datasets
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
                    <button className="quiet" onClick={openSamplePicker} disabled={!activeCase || busy}>Load sample</button>
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
                    <button className="btn-sample" onClick={openSamplePicker} disabled={!activeCase || isTraining || busy}>
                      Load sample
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
          <FindingsReview
            leads={leads}
            allLeads={analysis?.leads}
            graph={graph}
            analysis={analysis}
            tabLabel={tab === 'Flagged behavior' ? 'Flagged behaviour' : 'Connections'}
            search={search}
            setSearch={setSearch}
            onReview={review}
            onOpen={selectItem}
          />
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
          <ResolutionQueue key={activeCase} caseId={activeCase} matches={list} busy={busy} onDecision={decide}
            onEvidence={selectItem} onSource={(id, label) => {
              selectItem({ label, reason: 'Candidate identity source', evidence_ids: [id] });
              evidence(id);
            }} />
        )}

        {tab === 'Timeline' && (() => {
          const openSource = (id, label) => {
            selectItem({ label, reason: 'Timeline source', evidence_ids: [id] });
            evidence(id);
          };
          return <>
            <DocumentPlaces key={'places-' + activeCase} caseId={activeCase} api={api} onSource={openSource}
              onChanged={() => load(activeCase)} people={(graph?.nodes || []).filter(item => item.type === 'Person')}
              darkMode={darkMode} />
            <LocationTimeline key={activeCase} events={list} caseId={activeCase} api={api} onEvent={selectItem}
              onEvidence={openSource} onChanged={() => load(activeCase)} />
          </>;
        })()}

        {tab === 'Import records' && (
          <div className="record-intake tw:grid tw:min-w-0 tw:items-start tw:gap-5">
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
                      setRawIsExample(true);
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
                      setRawIsExample(true);
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
                      setRawIsExample(true);
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
                  onChange={event => {
                    setRawText(event.target.value);
                    setRawIsExample(false);
                  }}
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
                <p>Upload your original PDF or scan. MAHA reads the document locally and suggests an import type.</p>
                <form ref={intakeForm} className="tw:grid tw:gap-4" onSubmit={upload}
                  onChange={event => {
                    if (event.target.name === 'password' || event.target.dataset.statementEdit || event.target.dataset.reportUi) return;
                    if (event.target.name === 'case') {
                      intakeRequest.current?.abort();
                      const file = event.currentTarget.elements.file.files[0];
                      if (file) inspectFile(file);
                    }
                    if (!uploading) setUploadFeedback(null);
                    setStatementCorrections({});
                    if (['case', 'file', 'kind', 'pdf_pages'].includes(event.target.name)) setStatementPage(null);
                  }}>
                  <label>
                    Authorized case
                    <select key={activeCase} name="case" aria-label="Authorized case" defaultValue={activeCase} disabled={busy}>
                      {casesList.map(c => (
                        <option key={c.case_id} value={c.case_id}>
                          {c.case_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RecordFilePicker name="file" accept=".pdf,.xlsx,.xls,.csv,.json,.txt,.png,.jpeg,.jpg,.tif,.tiff"
                    label="Source file" disabled={busy} onPick={file => { manualIntakeKind.current = ''; inspectFile(file); }} onClear={() => {
                      intakeRequest.current?.abort(); setIntakeProfile(null); setUploadKind(manualIntakeKind.current);
                      setStatementPage(null); setUploadFeedback(null); setStatementCorrections({});
                    }} required />
                  {intakeProfile && <p role={intakeProfile.error ? 'alert' : 'status'}>
                    {intakeProfile.loading ? 'Inspecting the file…' : intakeProfile.error ||
                      `${intakeProfile.file_type} detected. ${intakeProfile.kind ? 'Check the record format below.' : 'Choose a record format to continue.'}`}
                  </p>}
                  <label>
                    Record format
                    <select name="kind" aria-label="Record format" value={uploadKind} disabled={busy}
                      onChange={event => {
                        manualIntakeKind.current = event.target.value;
                        setUploadKind(event.target.value || intakeProfile?.kind || '');
                      }}>
                      <option value="">Identify from file</option>
                      <option value="bank-statement">Bank statement (PDF, Excel, or scan)</option>
                      <option value="calls-document">Call detail report (PDF or scan)</option>
                      <option value="wires-document">Wire transfer report (PDF or scan)</option>
                      <option value="judgment-document">English Indian court judgment (PDF or image)</option>
                      <option value="fir-document">English police FIR (PDF or image)</option>
                      {['ibm', 'narrative', 'judgment', 'cdr', 'history', 'pdf'].includes(uploadKind) &&
                        <option value={uploadKind}>Recognized structured file</option>}
                    </select>
                  </label>
                  {['calls-document', 'wires-document'].includes(uploadKind) &&
                    <ReportSettings key={uploadKind} kind={uploadKind} disabled={busy} />}
                  {uploadKind === 'bank-statement' && (
                    <>
                      <label>Statement name
                        <input name="statement_name" type="text" required maxLength={100}
                          placeholder="e.g. Harish bank statement year 25-26" />
                      </label>
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
                      <label>PDF or TIFF pages (optional)
                        <input type="text" name="pdf_pages" placeholder="e.g. 1-10" maxLength={32}
                          aria-describedby="statement-pages-hint" />
                        <small id="statement-pages-hint">Leave blank to read the whole file. Enter a page or range to read only those pages.</small>
                      </label>
                      <label>File password (if protected)
                        <input type="password" name="password" autoComplete="off" maxLength={1024}
                          aria-describedby="statement-password-hint" />
                        <small id="statement-password-hint">Used for one upload. Re-enter it before retrying a protected file.</small>
                      </label>
                      <details className="statement-column-mapping">
                        <summary>Map columns manually</summary>
                        <p>Count columns left to right from 1. Enter the transaction date and either both debit and credit columns or a signed amount column. Leave all fields blank for automatic detection.</p>
                        <div className="record-fields grid gap-3 sm:grid-cols-3">
                          {[
                            ['date', 'Transaction date'], ['debit', 'Debit'], ['credit', 'Credit'],
                            ['amount', 'Signed amount'], ['direction', 'Debit or credit indicator'],
                            ['value_date', 'Value date'], ['narration', 'Details'],
                            ['reference', 'Reference'], ['balance', 'Running balance'],
                            ...PAYMENT_COLUMNS,
                          ].map(([field, label]) => (
                            <label key={field}>{label}
                              <input name={`map_column_${field}`} type="number" min="1" max="48" placeholder="Column number" />
                            </label>
                          ))}
                        </div>
                        <button type="submit" className="record-secondary" value="statement-page" disabled={!activeCase || busy || uploading}>View PDF or scan page</button>
                        {statementPage && (
                          <figure className="statement-layout-view">
                            <figcaption>Page {statementPage.number}. Click between columns to place a divider, or enter the percentages below.</figcaption>
                            <div className="statement-layout-page" onClick={event => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const percentage = Math.round(1000 * (event.clientX - rect.left) / rect.width) / 10;
                              if (uploading || percentage <= 0 || percentage >= 100) return;
                              const values = statementDividers.split(',').map(Number).filter(value => value > 0 && value < 100);
                              if (values.length < 47) {
                                setStatementDividers([...new Set([...values, percentage])].sort((a, b) => a - b).join(', '));
                                setUploadFeedback(null);
                                setStatementCorrections({});
                              }
                            }}>
                              <img src={statementPage.url} alt={`Statement page ${statementPage.number}`} draggable={false} />
                              {statementDividers.split(',').map(Number).filter(value => value > 0 && value < 100).map((value, index) => (
                                <span key={index} className="statement-layout-divider" style={{ left: `${value}%` }} aria-hidden />
                              ))}
                            </div>
                          </figure>
                        )}
                        <label>PDF or image column dividers (optional)
                          <input name="map_dividers" type="text" maxLength={300} value={statementDividers}
                            onChange={event => setStatementDividers(event.target.value)} placeholder="e.g. 12, 24, 61, 74, 87" aria-describedby="statement-dividers-hint" />
                          <small id="statement-dividers-hint">For borderless tables, enter each divider as a percentage of the page width from the left. Leave blank when the table has visible borders.</small>
                        </label>
                      </details>
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {uploadKind === 'bank-statement' && (
                      <button className="record-secondary" value="statement-preview" disabled={!activeCase || busy || uploading || intakeProfile?.loading}>
                        Preview transactions
                      </button>
                    )}
                    {uploadKind === 'bank-statement' && uploadFeedback?.accepted > 0 && (
                      <button className={uploadFeedback.graphImpact?.fits ? 'record-secondary' : 'record-primary'}
                        value="statement-evidence" disabled={!activeCase || busy || uploading}>
                        Save as statement evidence
                      </button>
                    )}
                    <button className="record-primary" value="preview-report" disabled={!activeCase || !uploadKind || busy || uploading || intakeProfile?.loading || uploadFeedback?.graphImpact?.fits === false}>
                      {uploading ? 'Reading…' : ['calls-document', 'wires-document'].includes(uploadKind) ? 'Review extracted rows'
                        : uploadKind === 'bank-statement' ? 'Import to case graph' : 'Validate and import'}
                    </button>
                  </div>
                  {uploadFeedback && (
                    <div className="record-upload-feedback" data-status={uploadFeedback.status}
                      role={uploadFeedback.status === 'error' ? 'alert' : 'status'}>
                      {uploadFeedback.message}
                    </div>
                  )}
                  {uploadFeedback?.report && ['calls-document', 'wires-document'].includes(uploadKind) && (
                    <>
                      <ReportPreview key={uploadFeedback.report.review_digest} preview={uploadFeedback.report} api={api} kind={uploadKind} />
                      <button className="record-primary" value="save-report" disabled={busy || !uploadFeedback.report.accepted}>
                        Save reviewed records
                      </button>
                    </>
                  )}
                  {uploadFeedback?.callImportId && <button type="button" className="record-secondary"
                    onClick={() => navigate(`/app/call-flow/${encodeURIComponent(uploadFeedback.callImportId)}`)}>Open call report explorer</button>}
                  {uploadFeedback?.graphImpact && (
                    <p className="statement-graph-impact">
                      Case graph · {uploadFeedback.graphImpact.nodes.current.toLocaleString()} current nodes · {uploadFeedback.graphImpact.nodes.projected.toLocaleString()} after import · {uploadFeedback.graphImpact.nodes.limit.toLocaleString()} limit.
                      {uploadFeedback.graphImpact.fits === false && ' Save as statement evidence to review the full file in Quality and the financial explorer.'}
                    </p>
                  )}
                  {uploadFeedback?.inferredPages?.length > 0 && (
                    <p>Column mapping was inferred from matching running balances on {uploadFeedback.inferredPages.length > 1 ? 'pages' : 'page'} {uploadFeedback.inferredPages.join(', ')}.</p>
                  )}
                  <StatementPageCoverage pages={uploadFeedback?.pageCoverage} pageRange={uploadFeedback?.pageRange} />
                  <StatementReconciliation result={uploadFeedback?.reconciliation} />
                  {uploadFeedback?.balanceChecks && (
                    <p>Running balances · {uploadFeedback.balanceChecks.matched} matched · {uploadFeedback.balanceChecks.mismatched} mismatched · {uploadFeedback.balanceChecks.unverified} unverified</p>
                  )}
                  {uploadFeedback?.recoveredLayoutRows > 0 && (
                    <p>Another reader recovered {uploadFeedback.recoveredLayoutRows} {uploadFeedback.recoveredLayoutRows === 1 ? 'row' : 'rows'} after checking for agreement with the first reader.</p>
                  )}
                  {uploadFeedback?.inferredSheets?.length > 0 && (
                    <p>Column mapping was inferred from matching running balances in {uploadFeedback.inferredSheets.join(', ')}.</p>
                  )}
                  {!!Object.keys(statementCorrections).length && (
                    <div className="statement-ledger-paging">
                      <span>{Object.keys(statementCorrections).length} rows edited. Preview again to check the changes.</span>
                      <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => {
                        setStatementCorrections({});
                        setUploadFeedback(null);
                      }}>Clear edits</Button>
                    </div>
                  )}
                  {uploadFeedback?.rows?.length > 0 && (
                    <div className="statement-preview-table" role="region" aria-label="Statement transaction preview" tabIndex={0}>
                      <table>
                        <thead><tr>{['Source', 'Transaction date', 'Value date', 'Details', 'Reference',
                          ...statementPaymentColumns.map(([, label]) => label), 'Debit', 'Credit', 'Raw amount', 'Balance', 'Review'].map(label => (
                          <th key={label} scope="col">{label}</th>
                        ))}</tr></thead>
                        <tbody>{uploadFeedback.rows.map((row, index) => {
                          const { locator, fields, normalized, error, balance_check, corrected } = row;
                          return (
                          <tr key={index}>
                            <td>{locator.sheet || `Page ${locator.page}`} · row {locator.row}
                              {locator.header_page && <div>Headings from page {locator.header_page}</div>}
                              {locator.continuation && <div>Continued on page {locator.continuation.page}</div>}
                            </td>
                            <td>{statementField(row, 'date', 'Transaction date', fields.date)}</td>
                            <td>{fields.value_date || '—'}</td>
                            <td>{fields.narration || '—'}</td>
                            <td>{fields.reference || '—'}</td>
                            {statementPaymentColumns.map(([key]) => <td key={key}>{fields[key] || '—'}</td>)}
                            <td>{statementField(row, 'debit', 'Debit', normalized?.debit ?? fields.debit)}</td>
                            <td>{statementField(row, 'credit', 'Credit', normalized?.credit ?? fields.credit)}</td>
                            <td>{statementField(row, 'amount', 'Amount', fields.amount)}
                              {row.repairable?.includes('direction') && (
                                <div>{statementField(row, 'direction', 'Debit or credit indicator', fields.direction)}</div>
                              )}
                            </td>
                            <td>{fields.balance || '—'}</td>
                            <td>{error || balance_check}{corrected && <small>Reviewed correction</small>}</td>
                          </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  )}
                </form>
              </section>
            </RecordIntakeModes>
          </div>
        )}

        {tab === 'Quality' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Import quality ledger</h2>
            </div>
            {list.filter((r, index) => !r.summary.statement_settings || list.findIndex(prior => (
              prior.summary.statement_settings && prior.case_id === r.case_id && prior.source_id === r.source_id
            )) === index).map(r => (
              <article className={r.summary.statement_settings ? 'lead statement-import-card' : 'lead'} key={r.id}>
                <div>
                  <h3>
                    {r.summary.statement_settings ? r.summary.statement_name || 'Bank statement' : `${r.case_id} · ${r.id.slice(0, 8)}`}
                  </h3>
                  <p>
                    {r.summary.statement_settings && `${r.case_id} · Latest import · `}{r.summary.rows_seen} records · {r.summary.accepted_new} accepted · {r.summary.recognized_repeat} repeats · {r.summary.quarantined} quarantined
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
                  {r.summary.statement_settings && (
                    <StatementImportRows batch={r} api={api} onOpenFlow={() => {
                      navigate(`/app/statement-flow/${encodeURIComponent(r.id)}`);
                    }} onEvidence={(id, label) => {
                      selectItem({ label, reason: 'Bank statement transaction as recorded in the source' });
                      evidence(id);
                    }} onChanged={message => {
                      if (sessionToken.current === token) {
                        if (message) setNotice(message);
                        selectItem(null);
                        load(activeCase);
                      }
                    }} />
                  )}
                  {r.summary.report_review?.kind === 'calls' && (
                    <button className="quiet" onClick={() => navigate(`/app/call-flow/${encodeURIComponent(r.id)}`)}>
                      Open call report explorer
                    </button>
                  )}
                  {r.summary.report_review?.kind === 'wires' && <SavedWireRows importId={r.id} api={api}
                    onEvidence={id => {
                      selectItem({ label: 'Wire transfer', reason: 'Reviewed wire report row' });
                      evidence(id);
                    }} />}
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
              <article className="lead tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1" key={r.id}>
                <strong className="tw:capitalize">{(r.action || '').replaceAll('_', ' ')}</strong>
                <span className="tw:font-mono tw:text-[13px] tw:opacity-75">
                  {r.actor} · {r.case_id}
                </span>
                <time className="tw:ml-auto tw:text-[13px] tw:opacity-75 tw:tabular-nums">{new Date(r.at).toLocaleString()}</time>
              </article>
            ))}
          </section>
        )}

        <footer>
          VRITRA / Evidence workspace <span>{graph?.backend} · Projection v0.1 · Evidence coverage is not evidence correctness</span>
        </footer>
      </main>

      {selected && <EvidenceDrawer selected={selected} ev={ev} closeRef={drawerClose}
        api={api} token={token} downloadOriginal={downloadOriginal} onEvidenceLoad={evidence}
        onReview={review} onClose={() => {
          drawerClose.current.dataset.restoreFocus = 'true';
          selectItem(null);
        }} />}

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

      <Dialog open={showSamplePicker} onOpenChange={open => { if (!busy) setShowSamplePicker(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sample datasets</DialogTitle>
            <DialogDescription>Load fictional court, incident, call, and transaction records into {activeCase}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleLoadSample} className="tw:grid tw:gap-4">
            <label className="tw:grid tw:gap-2">
              Dataset
              <select value={sampleDataset} onChange={event => setSampleDataset(event.target.value)}
                disabled={!samplePackages.length || busy} required>
                {!samplePackages.length && <option value="">{sampleError ? 'Datasets unavailable' : 'Loading datasets…'}</option>}
                {samplePackages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            {activeStatus.evidence_count > 0 && <p>Select an empty case or create a new one to load a sample.</p>}
            {sampleError && <p role="alert" className="error">{sampleError}</p>}
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setShowSamplePicker(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={!activeCase || !sampleDataset || busy || activeStatus.evidence_count > 0}>
                {busy ? 'Loading sample…' : 'Load into case'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
