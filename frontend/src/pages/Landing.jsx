import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { clerkEnabled } from '../auth';
import BrandMark from '../components/BrandMark';
import DynamicBrand from '../components/DynamicBrand';
import GraphStory from '../components/landing/GraphStory';
import { cn } from '../lib/utils';

const HeroScene = lazy(() => import('../components/three/HeroScene'));

/* Shared class lists (Tailwind, prefixed `tw:`). Colours follow "Case File Night":
   gold = evidence/CTAs/accounts, blue = people/links/focus, coral = money loops only,
   teal = phones/verified, violet = places/needs review. */
// Legacy CSS styles every <button>/<a>; these classes override what matters.
const BTN = 'tw:inline-flex tw:min-h-11 tw:items-center tw:justify-center tw:gap-2 tw:rounded-[10px] tw:border tw:border-transparent tw:px-5 tw:py-0 tw:text-[15px] tw:font-semibold tw:no-underline tw:transition-[translate,box-shadow,background-color,border-color] tw:duration-200 tw:hover:-translate-y-0.5';
const BTN_PRIMARY = 'tw:bg-gold tw:text-night tw:shadow-[0_10px_30px_-12px_rgb(242_181_68/70%)] tw:hover:shadow-[0_16px_38px_-12px_rgb(242_181_68/85%)]';
const BTN_GHOST = 'tw:border-line tw:bg-surface/70 tw:text-ink tw:hover:border-blue';
const EYEBROW = 'tw:m-0 tw:mb-[18px] tw:inline-flex tw:items-center tw:gap-2.5 tw:font-mono tw:text-xs tw:tracking-[0.12em] tw:text-gold tw:uppercase';
const H2 = 'tw:m-0 tw:font-display tw:font-bold tw:tracking-[-0.03em] tw:text-balance';
const CHIP = 'tw:rounded-full tw:border tw:border-line tw:px-2.5 tw:py-1 tw:text-xs tw:text-ink-3';
const TAG = {
  person: 'tw:text-blue tw:border-blue/45 tw:bg-blue/10',
  account: 'tw:text-gold tw:border-gold/45 tw:bg-gold/10',
  place: 'tw:text-violet tw:border-violet/45 tw:bg-violet/10',
  phone: 'tw:text-teal tw:border-teal/45 tw:bg-teal/10'
};
const Tag = ({ t, children }) => <span className={cn('tw:rounded-md tw:border tw:px-1.5 tw:py-0.5 tw:whitespace-nowrap', TAG[t])}>{children}</span>;

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
      <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] tw:gap-2.5">
        {[['transactions.csv', 'Bank transfers · 120 rows'], ['narratives.json', 'Case notes · 24 documents'], ['calls.csv', 'Call records'], ['history.csv', 'Prior case history'], ['statement.pdf', 'Fixed-layout bank statement']].map(([f, d]) => (
          <div className="tw:grid tw:gap-0.5 tw:rounded-[10px] tw:border tw:border-line tw:p-3" key={f}>
            <b className="tw:font-medium tw:text-ink">{f}</b><span className="tw:text-xs tw:text-ink-4">{d}</span>
          </div>
        ))}
      </div>
    )
  },
  {
    title: 'Extract', hint: 'Find who and what is mentioned',
    body: 'Language models and explicit rules pull people, accounts, phones and places out of the text. Every mention keeps its exact character position in the source.',
    demo: () => (
      <p className="tw:m-0 tw:font-sans tw:text-[15px] tw:leading-[1.9] tw:text-ink-2">
        <Tag t="person">Arun Mehta</Tag> was recorded at <Tag t="place">Andheri East</Tag> and
        owns account <Tag t="account">BANK 011 / B06671AD1</Tag>. He called <Tag t="phone">+91 98xx xx4410</Tag> twice on 14 March.
      </p>
    )
  },
  {
    title: 'Resolve', hint: 'Decide which records are the same person',
    body: 'Matching identifiers link automatically. Names alone never do: similar names wait for a reviewer, and every decision can be undone.',
    demo: () => (
      <>
        <div className="tw:grid tw:grid-cols-[1fr_auto_1fr] tw:items-center tw:gap-3 tw:max-sm:grid-cols-1">
          <div className="tw:grid tw:gap-0.5 tw:rounded-[10px] tw:border tw:border-line tw:p-3"><b className="tw:font-medium tw:text-blue">A. Mehta</b><span>narratives.json · doc 7</span></div>
          <div className="tw:text-center tw:text-xs tw:text-violet"><strong className="tw:block tw:text-xl tw:text-ink">0.93</strong>name similarity</div>
          <div className="tw:grid tw:gap-0.5 tw:rounded-[10px] tw:border tw:border-line tw:p-3"><b className="tw:font-medium tw:text-blue">Arun Mehta</b><span>narratives.json · doc 19</span></div>
        </div>
        <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <span className={cn(CHIP, 'tw:border-violet/50 tw:text-violet')}>Needs review</span>
          <span className={CHIP}>No shared ID, so no automatic merge</span>
        </div>
      </>
    )
  },
  {
    title: 'Connect', hint: 'Build the network across cases',
    body: 'Everything becomes one graph of people, accounts, phones, places and cases. Transfers that run in a loop, in time order and the same currency, are marked in coral.',
    demo: () => (
      <svg className="tw:block tw:h-auto tw:max-h-60 tw:w-full tw:font-mono tw:text-[10px]" viewBox="0 0 520 230" role="img" aria-label="Example network with a money loop between three accounts">
        <g strokeWidth="1.5">
          <line stroke="rgb(90 169 255 / 55%)" x1="70" y1="60" x2="190" y2="70" />
          <line stroke="rgb(90 169 255 / 55%)" x1="70" y1="60" x2="80" y2="170" />
          <line stroke="rgb(90 169 255 / 55%)" x1="190" y1="70" x2="300" y2="50" />
          <line stroke="#233350" x1="80" y1="170" x2="190" y2="70" />
          <line stroke="rgb(90 169 255 / 55%)" x1="440" y1="170" x2="390" y2="190" />
        </g>
        <path className="tw:animate-lp-dash" d="M300 50 L430 80 L360 160 Z" fill="none" stroke="#FF6B5B" strokeWidth="2.2" strokeDasharray="7 6" />
        <g fill="#A59FC4">
          <circle cx="70" cy="60" r="11" fill="#5AA9FF" /><text x="52" y="38">person</text>
          <circle cx="80" cy="170" r="8" fill="#A98BFF" /><text x="60" y="198">place</text>
          <circle cx="190" cy="70" r="9" fill="#3DD6B5" /><text x="172" y="100">phone</text>
          <rect x="290" y="40" width="20" height="20" rx="4" fill="#F2B544" />
          <rect x="420" y="70" width="20" height="20" rx="4" fill="#F2B544" />
          <rect x="350" y="150" width="20" height="20" rx="4" fill="#F2B544" />
          <text x="290" y="30">account</text>
          <polygon points="440,155 455,170 440,185 425,170" fill="#EDF2FA" /><text x="452" y="205">case</text>
          <text x="336" y="108" fill="#FF6B5B">money loop</text>
        </g>
      </svg>
    )
  },
  {
    title: 'Review', hint: 'Check every finding against its source',
    body: 'Connections and unusual transactions are listed separately, as leads to review rather than conclusions. Open any finding to see the exact passage, row or PDF cell behind it.',
    demo: () => (
      <div className="tw:grid tw:gap-2.5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <b className="tw:font-sans tw:text-sm tw:font-semibold tw:text-ink">Arun Mehta appears in 2 cases</b>
          <span className={cn(CHIP, 'tw:border-teal/50 tw:text-teal')}>Source verified</span>
        </div>
        <div className="tw:grid tw:gap-1 tw:rounded-r-lg tw:border-l-2 tw:border-gold tw:bg-gold/6 tw:px-3 tw:py-2.5">
          <span className="tw:text-xs tw:text-gold">narratives.json · DEMO-C02 · chars 1204–1288</span>
          <q className="tw:font-sans tw:text-sm tw:text-ink-2">Person Arun Mehta [ID:P-118] is referenced in this case as a witness.</q>
        </div>
        <span className={CHIP}>Documented role: witness. A case link is not suspicion.</span>
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
    el.querySelectorAll('.tw\\:reveal').forEach(n => io.observe(n));
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
    <div className={cn('tw:grid tw:grid-cols-[minmax(0,340px)_minmax(0,1fr)] tw:items-start tw:gap-7 tw:max-[1000px]:grid-cols-1', auto && 'autoplay')}
      style={{ '--dur': `${STEP_MS}ms` }}>
      <ol className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0 tw:max-[1000px]:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]" role="tablist" aria-label="How VRITRA works">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button type="button" role="tab" id={`step-tab-${i}`} aria-selected={i === active} aria-controls="step-panel" onClick={() => pick(i)}
              className="tw:group tw:grid tw:min-h-0 tw:w-full tw:cursor-pointer tw:grid-cols-[36px_1fr] tw:items-center tw:gap-x-3.5 tw:gap-y-1 tw:rounded-xl tw:border tw:border-transparent tw:bg-transparent tw:px-4 tw:py-3.5 tw:text-left tw:text-base tw:leading-[1.6] tw:font-normal tw:text-ink-3 tw:transition-colors tw:hover:transform-none tw:hover:bg-surface/60 tw:hover:text-ink tw:hover:opacity-100 tw:aria-selected:border-line tw:aria-selected:bg-surface tw:aria-selected:text-ink">
              <span className="tw:row-span-2 tw:grid tw:size-9 tw:place-items-center tw:rounded-[10px] tw:border tw:border-line tw:font-mono tw:text-[13px] tw:text-ink-3 tw:transition-all tw:group-aria-selected:border-gold tw:group-aria-selected:bg-gold tw:group-aria-selected:text-night">
                {String(i + 1).padStart(2, '0')}
              </span>
              <b className="tw:font-display tw:text-[17px] tw:tracking-[-0.01em]">{s.title}</b>
              <small className="tw:text-[13px] tw:text-ink-4 tw:max-[1000px]:hidden">{s.hint}</small>
              <span className="tw:col-start-2 tw:mt-1.5 tw:hidden tw:h-0.5 tw:overflow-hidden tw:rounded-sm tw:bg-line tw:group-aria-selected:block" aria-hidden="true">
                <span key={active} className="tw:block tw:h-full tw:w-0 tw:bg-gold tw:in-[.autoplay]:lp-fill" />
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div key={active} id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${active}`}
        className="tw:grid tw:min-h-[420px] tw:origin-[30%_30%] tw:animate-lp-spring tw:gap-[18px] tw:rounded-[18px] tw:border tw:border-line tw:bg-surface tw:p-[clamp(20px,3vw,34px)] tw:max-sm:min-h-0">
        <span className={EYEBROW}>Step {active + 1} of {STEPS.length}</span>
        <h3 className={cn(H2, 'tw:text-[clamp(22px,2.4vw,30px)]')}>{step.title}: {step.hint.toLowerCase()}</h3>
        <p className="tw:m-0 tw:max-w-[62ch] tw:text-ink-2">{step.body}</p>
        <div className="tw:overflow-x-auto tw:rounded-xl tw:border tw:border-line tw:bg-night tw:p-[18px] tw:font-mono tw:text-[13px] tw:text-ink-2">

          {step.demo()}
        </div>
      </div>
    </div>
  );
}

const SECTION = 'tw:mx-auto tw:max-w-[1240px] tw:pt-[clamp(72px,9vw,120px)] tw:px-[max(16px,4vw)]';
const SECTION_HEAD = 'tw:reveal tw:mb-10 tw:grid tw:max-w-[760px] tw:gap-3.5';

export default function Landing() {
  const primary = clerkEnabled ? '/sign-in' : '/app';
  const root = useReveal();
  return (
    <div ref={root}
      className="landing tw:relative tw:min-h-screen tw:overflow-x-clip tw:font-sans tw:text-base tw:leading-[1.6] tw:text-ink tw:lp-bg tw:[&>*]:relative tw:[&_a]:text-inherit tw:[&_a]:no-underline tw:[&_:focus-visible]:rounded-md tw:[&_:focus-visible]:outline-2 tw:[&_:focus-visible]:outline-offset-[3px] tw:[&_:focus-visible]:outline-blue">
      <div aria-hidden="true" className="tw:pointer-events-none tw:absolute! tw:inset-0 tw:lp-dotgrid" />

      <header className="tw:fixed! tw:inset-x-0 tw:top-0 tw:z-30 tw:m-0 tw:flex tw:items-center tw:justify-between tw:gap-4 tw:border-0 tw:px-[max(16px,4vw)] tw:py-3.5 tw:shadow-none tw:backdrop-blur-[8px] tw:lp-nav-fade">
        <Link to="/" className="tw:inline-flex tw:items-center tw:text-ink tw:no-underline"><DynamicBrand size={22} textClassName="tw:font-display tw:text-[19px] tw:font-bold tw:tracking-[0.04em] tw:text-white" /></Link>
        <nav className="tw:flex tw:gap-7 tw:text-sm tw:text-ink-3 tw:max-sm:hidden tw:[&_a]:transition-colors tw:[&_a:hover]:text-ink" aria-label="Sections">
          <a href="#story">The story</a>
          <a href="#how">How it works</a>
          <a href="#finds">What it finds</a>
          <a href="#principles">Principles</a>
        </nav>
        <Link to={primary} className={cn(BTN, BTN_PRIMARY, 'tw:min-h-[38px] tw:px-4 tw:text-sm')}>{clerkEnabled ? 'Sign in' : 'Open workspace'}</Link>
      </header>

      <section className="tw:grid tw:min-h-[min(100vh,920px)] tw:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] tw:items-center tw:gap-6 tw:px-[max(16px,5vw)] tw:pt-[110px] tw:pb-14 tw:max-[1000px]:min-h-0 tw:max-[1000px]:grid-cols-1 tw:max-[1000px]:pt-24">
        <div className="tw:z-[2] tw:max-w-[600px]">
          <p className={EYEBROW}><span className="tw:size-2 tw:rounded-full tw:bg-teal tw:shadow-[0_0_12px_#3DD6B5] tw:animate-lp-pulse" /> Criminal-network analysis · evidence first</p>
          <h1 className={cn(H2, 'tw:mb-[22px] tw:text-[clamp(40px,5.6vw,76px)] tw:leading-[1.02]')}>
            Turn scattered case files into <em className="tw:text-gold tw:not-italic">one network</em> you can check.
          </h1>
          <p className="tw:m-0 tw:mb-[30px] tw:max-w-[540px] tw:text-[clamp(16px,1.45vw,19px)] tw:text-ink-2">
            VRITRA reads bank transfers, case notes, call records and statements, connects the people,
            accounts, phones and places in them, and shows where money loops. Every link points back
            to the exact record it came from.
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-3">
            <Link to={primary} className={cn(BTN, BTN_PRIMARY)}>Explore the demo cases →</Link>
            <a href="#how" className={cn(BTN, BTN_GHOST)}>See how it works</a>
          </div>
          <ul className="tw:m-0 tw:mt-[30px] tw:flex tw:list-none tw:flex-wrap tw:gap-x-4 tw:gap-y-2 tw:p-0 tw:font-mono tw:text-xs tw:text-ink-3" aria-label="Colour key">
            {KEY.map(([k, c]) => (
              <li key={k} className="tw:inline-flex tw:items-center tw:gap-[7px]">
                <i className="tw:size-[9px] tw:rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{k}
              </li>
            ))}
            <li className="tw:inline-flex tw:items-center tw:gap-[7px]"><i className="tw:h-0.5 tw:w-[18px] tw:lp-dash-key" />Money loop</li>
          </ul>
          {!clerkEnabled && <p className="tw:m-0 tw:mt-[18px] tw:text-[13px] tw:text-ink-4">Dev mode: sign-in is off until a Clerk key is set in <code className="tw:font-mono">frontend/.env.local</code>.</p>}
        </div>
        <div aria-hidden="true"
          className="tw:relative tw:h-[min(68vh,640px)] tw:min-h-[380px] tw:[&>div:first-child]:lp-stage-fade tw:[&_canvas]:block tw:max-[1000px]:order-first tw:max-[1000px]:-mx-[max(16px,5vw)] tw:max-[1000px]:h-[340px] tw:max-[1000px]:min-h-0 tw:max-sm:h-[280px]">
          <Suspense fallback={null}><HeroScene /></Suspense>
        </div>
      </section>

      <section aria-label="Project figures"
        className="tw:grid tw:grid-cols-4 tw:border-y tw:border-line tw:bg-surface/45 tw:max-[1000px]:grid-cols-2">
        {[['5.08M', 'IBM AML transfers profiled'], ['203,769', 'Elliptic transactions benchmarked'], ['100%', 'of shown findings link to a source'], ['0', 'risk scores about people']].map(([v, l], i) => (
          <div key={l} style={stagger(i)}
            className="tw:reveal tw:grid tw:gap-1 tw:border-l tw:border-line tw:px-[max(16px,2vw)] tw:py-[22px] tw:first:border-l-0 tw:max-[1000px]:nth-3:border-l-0 tw:max-[1000px]:nth-[n+3]:border-t">
            <strong className="tw:font-display tw:text-[clamp(24px,2.6vw,34px)] tw:font-bold tw:tracking-[-0.02em] tw:tabular-nums">{v}</strong>
            <span className="tw:text-[13px] tw:text-ink-3">{l}</span>
          </div>
        ))}
      </section>

      {/* Records → network, scrubbed by scroll (sticky stage). The 3D hero above is unchanged. */}
      <GraphStory />

      <section id="how" className={SECTION}>
        <div className={SECTION_HEAD}>
          <p className={cn(EYEBROW, 'tw:mb-0')}>How it works</p>
          <h2 className={cn(H2, 'tw:text-[clamp(30px,3.8vw,48px)] tw:leading-[1.08]')}>From a pile of records to leads you can verify</h2>
          <p className="tw:m-0 tw:max-w-[640px] tw:text-[17px] tw:text-ink-2">Five steps, each one recorded. Pick a step to see what it does to a case.</p>
        </div>
        <div className="tw:reveal"><Stepper /></div>
      </section>

      <section id="finds" className={SECTION}>
        <div className={SECTION_HEAD}>
          <p className={cn(EYEBROW, 'tw:mb-0')}>What it finds</p>
          <h2 className={cn(H2, 'tw:text-[clamp(30px,3.8vw,48px)] tw:leading-[1.08]')}>Built for checking, not guessing</h2>
          <p className="tw:m-0 tw:max-w-[640px] tw:text-[17px] tw:text-ink-2">Hover a card to see how each result is checked before you see it.</p>
        </div>
        <div className="tw:grid tw:grid-cols-3 tw:items-start tw:gap-4 tw:max-[1000px]:grid-cols-2 tw:max-sm:grid-cols-1">
          {FEATURES.map(([icon, t, d, check], i) => (
            <article key={t} tabIndex={0} style={stagger(i)}
              className="tw:group tw:reveal tw:grid tw:content-start tw:gap-3 tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6 tw:transition-[translate,border-color,box-shadow] tw:duration-300 tw:ease-out tw:hover:-translate-y-2 tw:hover:border-blue tw:hover:shadow-[0_0_0_1px_rgb(90_169_255/25%),0_24px_50px_-18px_rgb(90_169_255/45%)] tw:focus-within:-translate-y-2 tw:focus-within:border-blue tw:focus:-translate-y-2 tw:focus:border-blue">
              <span className="tw:grid tw:size-11 tw:place-items-center tw:rounded-xl tw:border tw:border-line tw:bg-night tw:text-ink-3 tw:transition-colors tw:duration-300 tw:group-hover:border-gold/45 tw:group-hover:text-gold tw:group-focus:border-gold/45 tw:group-focus:text-gold">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="tw:size-[22px] tw:fill-none tw:stroke-current tw:[stroke-linecap:round] tw:[stroke-linejoin:round] tw:[stroke-width:1.7]">{ICONS[icon]}</svg>
              </span>
              <h3 className={cn(H2, 'tw:text-[19px] tw:tracking-[-0.015em]')}>{t}</h3>
              <p className="tw:m-0 tw:text-[15px] tw:text-ink-2">{d}</p>
              <div className="tw:grid tw:grid-rows-[0fr] tw:transition-[grid-template-rows] tw:duration-400 tw:group-hover:grid-rows-[1fr] tw:group-focus:grid-rows-[1fr] tw:group-focus-within:grid-rows-[1fr]">
                <div className="tw:overflow-hidden">
                  <p className="tw:m-0 tw:mt-1 tw:border-0 tw:border-t tw:border-dashed tw:border-line tw:pt-3 tw:font-mono tw:text-[12.5px] tw:text-ink-3">
                    <span className="tw:text-teal">How it’s checked · </span>{check}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="principles" className={SECTION}>
        <div className="tw:grid tw:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] tw:items-start tw:gap-[clamp(24px,5vw,64px)] tw:max-[1000px]:grid-cols-1">
          <div className="tw:reveal">
            <p className={EYEBROW}>Principles</p>
            <h2 className={cn(H2, 'tw:text-[clamp(32px,4.4vw,56px)] tw:leading-[1.04]')}>Decision support, <em className="tw:text-gold tw:not-italic">never a verdict.</em></h2>
          </div>
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-3.5 tw:p-0">
            {RULES.map(([c, t, d], i) => (
              <li key={t} style={stagger(i)} className="tw:reveal tw:grid tw:grid-cols-[10px_1fr] tw:gap-3.5 tw:rounded-xl tw:border tw:border-line tw:bg-surface/55 tw:px-[18px] tw:py-4">
                <i className="tw:mt-[7px] tw:size-2.5 tw:rounded-full" style={{ background: c }} />
                <div><b className="tw:block tw:font-semibold">{t}</b><span className="tw:text-[15px] tw:text-ink-3">{d}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="tw:reveal tw:mx-[max(16px,4vw)] tw:mt-[clamp(72px,9vw,120px)] tw:flex tw:max-w-[1240px] tw:flex-wrap tw:items-center tw:justify-between tw:gap-6 tw:rounded-[22px] tw:border tw:border-line tw:p-[clamp(28px,5vw,56px)] tw:lp-final-bg tw:min-[1320px]:mx-auto">
        <div>
          <h2 className={cn(H2, 'tw:text-[clamp(26px,3vw,38px)]')}>See it on the demo cases</h2>
          <p className="tw:m-0 tw:mt-2 tw:text-ink-2">Three synthetic investigations, one cross-case witness and a money loop to trace.</p>
        </div>
        <Link to={primary} className={cn(BTN, BTN_PRIMARY)}>Explore the demo cases →</Link>
      </section>

      <footer className="tw:mt-[72px] tw:flex tw:flex-wrap tw:justify-between tw:gap-3 tw:border-t tw:border-line tw:px-[max(16px,4vw)] tw:py-[26px] tw:text-[13px] tw:text-ink-4">
        <span className="tw:inline-flex tw:items-center tw:gap-2"><BrandMark /> VRITRA evidence workspace · BAI506 academic prototype</span>
        <span className="tw:inline-flex tw:items-center tw:gap-2 tw:font-mono">FastAPI · React · three.js · SQLite ledger · Neo4j</span>
      </footer>
    </div>
  );
}
