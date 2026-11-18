import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { clerkEnabled } from '../auth';
import BrandMark from '../components/BrandMark';
import '../landing.css';

const HeroScene = lazy(() => import('../components/three/HeroScene'));

const PIPELINE = [
  ['01', 'Import', 'Transaction CSVs, case narratives, call records, history files and fixed-layout PDF statements. The original bytes are kept.'],
  ['02', 'Extract', 'Pretrained NER and explicit relation rules turn records into people, accounts, places and links, each tied to its source.'],
  ['03', 'Resolve', 'Exact identifiers merge automatically. Name-only matches wait for a reviewer, and every decision can be undone.'],
  ['04', 'Connect', 'A typed graph across cases: ownership, transfers, communications, locations and case participation.'],
  ['05', 'Review', 'Connections and flagged behaviour stay separate. Every finding opens to the exact row, text span or PDF cell behind it.']
];

const FEATURES = [
  ['Evidence on every finding', 'Leads that cannot be traced back to a source record are blocked, not shown.'],
  ['Cross-case linkage', 'See when the same entity appears in more than one authorised case, even without money moving.'],
  ['Fund-flow cycles', 'Chronological, same-currency transfer loops up to four hops, shown as possible routes rather than proof.'],
  ['Network structure', 'Degree, betweenness, PageRank and Louvain communities give context without scoring anyone.'],
  ['Case-scoped access', 'Each token sees only its own cases. Results from other cases disappear when access does.'],
  ['Audit trail', 'Imports, reviews and identity decisions are logged with who made them and when.']
];

export default function Landing() {
  const primary = clerkEnabled ? '/sign-in' : '/app';
  return (
    <div className="landing">
      <header className="lp-nav">
        <Link to="/" className="lp-brand"><BrandMark /> MAHA</Link>
        <nav className="lp-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Capabilities</a>
          <a href="#principles">Principles</a>
        </nav>
        <Link to={primary} className="lp-btn lp-btn-ghost">{clerkEnabled ? 'Sign in' : 'Open workspace'}</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-canvas" aria-hidden="true">
          <Suspense fallback={null}><HeroScene /></Suspense>
        </div>
        <div className="lp-hero-copy">
          <p className="lp-eyebrow"><span className="lp-live" /> Criminal-network analysis · BAI506 prototype</p>
          <h1>See the network<br /><span>behind the case.</span></h1>
          <p className="lp-lead">
            MAHA turns case records, transactions and call logs into one evidence-linked graph,
            so investigators can trace connections and check every finding against its source.
          </p>
          <div className="lp-cta">
            <Link to={primary} className="lp-btn lp-btn-primary">{clerkEnabled ? 'Get started' : 'Open workspace'} →</Link>
            <a href="#how" className="lp-btn lp-btn-ghost">How it works</a>
          </div>
          {!clerkEnabled && (
            <p className="lp-devnote">Dev mode: sign-in is off until a Clerk key is set in <code>frontend/.env.local</code>.</p>
          )}
        </div>
        <a href="#how" className="lp-scroll" aria-label="Scroll to how it works"><span /></a>
      </section>

      <section className="lp-stats" aria-label="Project figures">
        {[
          ['5.08M', 'IBM AML transfers profiled'],
          ['203,769', 'Elliptic transactions benchmarked'],
          ['100%', 'of shown findings link to a source'],
          ['0', 'person risk scores']
        ].map(([v, l]) => (
          <div key={l}><strong>{v}</strong><span>{l}</span></div>
        ))}
      </section>

      <section id="how" className="lp-section">
        <p className="lp-eyebrow">How it works</p>
        <h2>From raw records to reviewable leads</h2>
        <ol className="lp-pipeline">
          {PIPELINE.map(([n, t, d]) => (
            <li key={n}><span className="lp-step">{n}</span><h3>{t}</h3><p>{d}</p></li>
          ))}
        </ol>
      </section>

      <section id="features" className="lp-section">
        <p className="lp-eyebrow">Capabilities</p>
        <h2>Built for checking, not guessing</h2>
        <div className="lp-grid">
          {FEATURES.map(([t, d]) => (
            <article key={t} className="lp-card"><h3>{t}</h3><p>{d}</p></article>
          ))}
        </div>
      </section>

      <section id="principles" className="lp-section lp-principle">
        <h2>Decision support, never a verdict.</h2>
        <p>
          A connection is not suspicion, and a witness is not a suspect. MAHA runs on synthetic
          demonstration data and public benchmarks. It is an academic prototype, not an
          operational policing system or an assessment of real people.
        </p>
        <Link to={primary} className="lp-btn lp-btn-primary">Explore the demo cases →</Link>
      </section>

      <footer className="lp-footer">
        <span><BrandMark /> MAHA evidence workspace</span>
        <span>FastAPI · React · three.js · SQLite ledger · Neo4j</span>
      </footer>
    </div>
  );
}
