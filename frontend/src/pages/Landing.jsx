import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { clerkEnabled } from '../auth';
import BrandMark from '../components/BrandMark';
import '../landing.css';

const HeroScene = lazy(() => import('../components/three/HeroScene'));

// Entity colour key: the same meanings are used in the 3D scenes and the workspace graph.
const KEY = [
  ['Person', '#5AA9FF'], ['Account', '#F2B544'], ['Phone', '#3DD6B5'], ['Place', '#A98BFF'], ['Case', '#EDF2FA']
];

/* ---------- "How it works": five real pipeline stages, each with a worked example ---------- */
const STEPS = [
  {
    title: 'Import', hint: 'Bring every record into one case',
    body: 'Upload the records an investigation already has. Each file is stored exactly as received, with its hash, so every later finding can point back to the original bytes.',
    demo: () => (
      <div className="lp-files">
        {[['transactions.csv', 'Bank transfers · 120 rows'], ['narratives.json', 'Case notes · 24 documents'], ['calls.csv', 'Call records'], ['history.csv', 'Prior case history'], ['statement.pdf', 'Fixed-layout bank statement']].map(([f, d]) => (
          <div className="lp-file" key={f}><b>{f}</b><span>{d}</span></div>
        ))}
      </div>
    )
  },
  {
    title: 'Extract', hint: 'Find who and what is mentioned',
    body: 'Language models and explicit rules pull people, accounts, phones and places out of the text. Every mention keeps its exact character position in the source.',
    demo: () => (
      <p className="lp-text">
        <span className="lp-tag" data-t="person">Arun Mehta</span> was recorded at <span className="lp-tag" data-t="place">Andheri East</span> and
        owns account <span className="lp-tag" data-t="account">BANK 011 / B06671AD1</span>. He called <span className="lp-tag" data-t="phone">+91 98xx xx4410</span> twice on 14 March.
      </p>
    )
  },
  {
    title: 'Resolve', hint: 'Decide which records are the same person',
    body: 'Matching identifiers link automatically. Names alone never do: similar names wait for a reviewer, and every decision can be undone.',
    demo: () => (
      <>
        <div className="lp-match">
          <div><b>A. Mehta</b><span>narratives.json · doc 7</span></div>
          <div className="lp-score"><strong>0.93</strong>name similarity</div>
          <div><b>Arun Mehta</b><span>narratives.json · doc 19</span></div>
        </div>
        <div className="lp-decision">
          <span className="lp-chip violet">Needs review</span>
          <span className="lp-chip">No shared ID, so no automatic merge</span>
        </div>
      </>
    )
  },
  {
    title: 'Connect', hint: 'Build the network across cases',
    body: 'Everything becomes one graph of people, accounts, phones, places and cases. Transfers that run in a loop, in time order and the same currency, are marked in coral.',
    demo: () => (
      <svg className="lp-mini-graph" viewBox="0 0 520 230" role="img" aria-label="Example network with a money loop between three accounts">
        <line className="edge link" x1="70" y1="60" x2="190" y2="70" />
        <line className="edge link" x1="70" y1="60" x2="80" y2="170" />
        <line className="edge link" x1="190" y1="70" x2="300" y2="50" />
        <line className="edge" x1="80" y1="170" x2="190" y2="70" />
        <line className="edge link" x1="440" y1="170" x2="390" y2="190" />
        <path className="loop" d="M300 50 L430 80 L360 160 Z" />
        <circle cx="70" cy="60" r="11" fill="#5AA9FF" /><text x="52" y="38">person</text>
        <circle cx="80" cy="170" r="8" fill="#A98BFF" /><text x="60" y="198">place</text>
        <circle cx="190" cy="70" r="9" fill="#3DD6B5" /><text x="172" y="100">phone</text>
        <rect x="290" y="40" width="20" height="20" rx="4" fill="#F2B544" />
        <rect x="420" y="70" width="20" height="20" rx="4" fill="#F2B544" />
        <rect x="350" y="150" width="20" height="20" rx="4" fill="#F2B544" />
        <text x="290" y="30">account</text>
        <polygon points="440,155 455,170 440,185 425,170" fill="#EDF2FA" /><text x="452" y="205">case</text>
        <text x="336" y="108" style={{ fill: '#FF6B5B' }}>money loop</text>
      </svg>
    )
  },
  {
    title: 'Review', hint: 'Check every finding against its source',
    body: 'Connections and unusual transactions are listed separately, as leads to review rather than conclusions. Open any finding to see the exact passage, row or PDF cell behind it.',
    demo: () => (
      <div className="lp-finding">
        <div className="lp-finding-head"><b>Arun Mehta appears in 2 cases</b><span className="lp-chip teal">Source verified</span></div>
        <div className="lp-source">
          <span>narratives.json · DEMO-C02 · chars 1204–1288</span>
          <q>Person Arun Mehta [ID:P-118] is referenced in this case as a witness.</q>
        </div>
        <span className="lp-chip">Documented role: witness. A case link is not suspicion.</span>
      </div>
    )
  }
];

/* ---------- capabilities ---------- */
const ICONS = {
  source: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" />,
  cases: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="12" cy="17" r="3" /><path d="M9.5 8.5l1.5 6M14.5 8.5l-1.5 6" /></>,
  loop: <><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
  graph: <><circle cx="12" cy="12" r="2.5" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="18" r="2" /><path d="M6 7l4 3.5M18 7l-4 3.5M6.5 17.5l4-4M17.5 16.5l-4-3" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  log: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>
};
const FEATURES = [
  ['source', 'Evidence on every finding', 'Each lead links to the exact record it came from. Leads without a traceable source are blocked, not shown.', 'Every evidence ID is looked up in the ledger before a finding is displayed.'],
  ['cases', 'Links across cases', 'See when the same person or account appears in more than one case, even when no money moves between them.', 'Only exact identifiers and reviewer-approved matches join records across cases.'],
  ['loop', 'Money that loops', 'Find transfers that return to where they started within four hops, in time order and the same currency.', 'Each step must be later than the one before it; the full path and its rows are shown.'],
  ['graph', 'Network structure', 'Centrality and communities show who connects groups, as context for the investigator.', 'Structure is never turned into a score about a person.'],
  ['lock', 'Case-scoped access', 'Each investigator sees only the cases they are cleared for. Results from other cases disappear with access.', 'Every request is checked against the token’s case list on the server.'],
  ['log', 'Full audit trail', 'Imports, reviews and identity decisions are recorded with who made them and when.', 'Decisions are stored as events, so the history can be replayed or reversed.']
];

const RULES = [
  ['#F2B544', 'Every claim has a source', 'If a finding can’t be traced to a record, it isn’t shown.'],
  ['#A98BFF', 'People review, the system suggests', 'Name matches and leads wait for a human decision.'],
  ['#5AA9FF', 'A connection is not guilt', 'Witnesses and associates stay labelled by their documented role.'],
  ['#3DD6B5', 'Synthetic data only', 'This academic prototype runs on generated cases and public benchmarks.']
];

function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.add('lp-js');
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    el.querySelectorAll('.reveal').forEach(n => io.observe(n));
    return () => io.disconnect();
  }, []);
  return root;
}

// Staggered reveal delay for the n-th item in a group.
const stagger = i => ({ '--delay': `${(i % 3) * 90}ms` });

function Stepper() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const STEP_MS = 7000;
  useEffect(() => {
    if (!auto || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setActive(a => (a + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [active, auto]);
  const pick = i => { setAuto(false); setActive(i); };
  const step = STEPS[active];
  return (
    <div className={`lp-stepper ${auto ? 'autoplay' : ''}`} style={{ '--dur': `${STEP_MS}ms` }}>
      <ol className="lp-steps" role="tablist" aria-label="How MAHA works">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button type="button" role="tab" id={`step-tab-${i}`} aria-selected={i === active} aria-controls="step-panel"
              className="lp-step" onClick={() => pick(i)}>
              <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
              <b>{s.title}</b>
              <small>{s.hint}</small>
              <span className="lp-step-bar" aria-hidden="true"><span key={active} /></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="lp-panel" key={active} id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${active}`}>
        <span className="lp-eyebrow">Step {active + 1} of {STEPS.length}</span>
        <h3>{step.title}: {step.hint.toLowerCase()}</h3>
        <p>{step.body}</p>
        <div className="lp-demo"><span className="lp-demo-label">Illustrative example · synthetic data</span>{step.demo()}</div>
      </div>
    </div>
  );
}

export default function Landing() {
  const primary = clerkEnabled ? '/sign-in' : '/app';
  const root = useReveal();
  return (
    <div className="landing" ref={root}>
      <header className="lp-nav">
        <Link to="/" className="lp-brand"><BrandMark /> MAHA</Link>
        <nav className="lp-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#finds">What it finds</a>
          <a href="#principles">Principles</a>
        </nav>
        <Link to={primary} className="lp-btn lp-btn-primary lp-btn-sm">{clerkEnabled ? 'Sign in' : 'Open workspace'}</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow"><span className="lp-live" /> Criminal-network analysis · evidence first</p>
          <h1>Turn scattered case files into <em>one network</em> you can check.</h1>
          <p className="lp-lead">
            MAHA reads bank transfers, case notes, call records and statements, connects the people,
            accounts, phones and places in them, and shows where money loops. Every link points back
            to the exact record it came from.
          </p>
          <div className="lp-cta">
            <Link to={primary} className="lp-btn lp-btn-primary">Explore the demo cases →</Link>
            <a href="#how" className="lp-btn lp-btn-ghost">See how it works</a>
          </div>
          <ul className="lp-key" aria-label="Colour key">
            {KEY.map(([k, c]) => <li key={k}><i style={{ '--c': c }} />{k}</li>)}
            <li><i className="dash" />Money loop</li>
          </ul>
          {!clerkEnabled && <p className="lp-devnote">Dev mode: sign-in is off until a Clerk key is set in <code>frontend/.env.local</code>.</p>}
        </div>
        <div className="lp-hero-stage" aria-hidden="true">
          <Suspense fallback={null}><HeroScene /></Suspense>
          <span className="lp-stage-caption">Illustrative network · synthetic</span>
        </div>
      </section>

      <section className="lp-figures" aria-label="Project figures">
        {[['5.08M', 'IBM AML transfers profiled'], ['203,769', 'Elliptic transactions benchmarked'], ['100%', 'of shown findings link to a source'], ['0', 'risk scores about people']].map(([v, l], i) => (
          <div key={l} className="reveal" style={stagger(i)}><strong>{v}</strong><span>{l}</span></div>
        ))}
      </section>

      <section id="how" className="lp-section">
        <div className="lp-section-head reveal">
          <p className="lp-eyebrow">How it works</p>
          <h2>From a pile of records to leads you can verify</h2>
          <p>Five steps, each one recorded. Pick a step to see what it does to a case.</p>
        </div>
        <div className="reveal"><Stepper /></div>
      </section>

      <section id="finds" className="lp-section">
        <div className="lp-section-head reveal">
          <p className="lp-eyebrow">What it finds</p>
          <h2>Built for checking, not guessing</h2>
          <p>Hover a card to see how each result is checked before you see it.</p>
        </div>
        <div className="lp-grid">
          {FEATURES.map(([icon, t, d, check], i) => (
            <article key={t} className="lp-card reveal" style={stagger(i)} tabIndex={0}>
              <span className="lp-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg></span>
              <h3>{t}</h3>
              <p>{d}</p>
              <div className="lp-check"><div><p>{check}</p></div></div>
            </article>
          ))}
        </div>
      </section>

      <section id="principles" className="lp-section">
        <div className="lp-principles">
          <div className="reveal">
            <p className="lp-eyebrow">Principles</p>
            <h2>Decision support, <em>never a verdict.</em></h2>
          </div>
          <ul className="lp-rules">
            {RULES.map(([c, t, d], i) => (
              <li key={t} className="reveal" style={stagger(i)}><i style={{ '--c': c }} /><div><b>{t}</b><span>{d}</span></div></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-final reveal">
        <div>
          <h2>See it on the demo cases</h2>
          <p>Three synthetic investigations, one cross-case witness and a money loop to trace.</p>
        </div>
        <Link to={primary} className="lp-btn lp-btn-primary">Explore the demo cases →</Link>
      </section>

      <footer className="lp-footer">
        <span><BrandMark /> MAHA evidence workspace · BAI506 academic prototype</span>
        <span className="lp-mono">FastAPI · React · three.js · SQLite ledger · Neo4j</span>
      </footer>
    </div>
  );
}
