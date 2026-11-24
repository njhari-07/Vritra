import React, { useMemo, useState } from 'react';
import { cn } from '../lib/utils';

/* Findings review (Findings design): leads grouped by technique, each one a self-contained card.
   Every line of text is built from fields the backend returned. Nothing is inferred or invented.
   Colours use theme tokens, so the panel follows the workspace's light and dark modes:
   review (violet) = isolation forest, loop (coral) = fund-flow loops only,
   trust (blue) = cross-case, signal (teal) = centrality, evidence (gold) = sources and primary action. */

const KIND = {
  isolation_forest: {
    title: 'Unusual amount or time', tech: 'ISOLATION FOREST', tone: 'review',
    blurb: 'Transfers whose size and hour stand out from the rest of their set.',
    icon: 'M3 12h4l3-8 4 16 3-8h4'
  },
  fund_flow: {
    title: 'Possible money loops', tech: 'FUND FLOW', tone: 'loop',
    blurb: 'Date-ordered, same-currency transfers that come back to where they started.',
    icon: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4'
  },
  cross_case: {
    title: 'Seen in more than one case', tech: 'CROSS-CASE', tone: 'trust',
    blurb: 'The same entity referenced in cases your token can open.',
    icon: 'M8 12a4 4 0 1 0 0-.01M16 12a4 4 0 1 0 0-.01'
  },
  centrality: {
    title: 'Central in the network', tech: 'CENTRALITY · COMMUNITY', tone: 'signal',
    blurb: 'Structural context only: who sits between many others. Never a score of guilt.',
    icon: 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3.2 5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M17.2 5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M3.2 19a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M17.2 19a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M6.4 6.4l4.2 4.2M17.6 6.4l-4.2 4.2M6.4 17.6l4.2-4.2M17.6 17.6l-4.2-4.2'
  }
};
// Static class names per tone (Tailwind needs them spelled out).
const TONE = {
  review: { text: 'tw:text-review', soft: 'tw:bg-review/12', bar: 'tw:bg-review', ring: 'tw:border-review/50' },
  loop: { text: 'tw:text-loop', soft: 'tw:bg-loop/12', bar: 'tw:bg-loop', ring: 'tw:border-loop/50' },
  trust: { text: 'tw:text-trust', soft: 'tw:bg-trust/12', bar: 'tw:bg-trust', ring: 'tw:border-trust/50' },
  signal: { text: 'tw:text-signal', soft: 'tw:bg-signal/12', bar: 'tw:bg-signal', ring: 'tw:border-signal/50' }
};
const STATE = {
  pending: { label: 'PENDING', cls: 'tw:border tw:border-border tw:text-muted-foreground' },
  relevant: { label: '✓ RELEVANT', cls: 'tw:bg-signal/14 tw:text-signal' },
  insufficient_evidence: { label: 'NEEDS EVIDENCE', cls: 'tw:border tw:border-dashed tw:border-evidence/60 tw:text-evidence' },
  not_relevant: { label: 'NOT RELEVANT', cls: 'tw:bg-muted tw:text-muted-foreground tw:line-through' }
};
const DECISIONS = [['relevant', 'Relevant'], ['insufficient_evidence', 'Need evidence'], ['not_relevant', 'Not relevant']];
const DECISION_ON = {
  relevant: 'tw:bg-signal/16 tw:text-signal',
  insufficient_evidence: 'tw:bg-evidence/16 tw:text-evidence',
  not_relevant: 'tw:bg-muted tw:text-foreground'
};

const kindOf = l => (l.techniques.includes('isolation_forest') ? 'isolation_forest'
  : l.techniques.includes('fund_flow') ? 'fund_flow'
    : l.techniques.includes('cross_case') ? 'cross_case' : 'centrality');
const money = (v, cur) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + (cur ? ' ' + cur : '');
};
const hh = h => (h == null ? '—' : String(h).padStart(2, '0') + ':00 UTC');
const day = t => (t ? new Date(t).toISOString().slice(0, 10) : '—');
const ref = l => 'F-' + l.id.slice(0, 6).toUpperCase();
const scopeLabel = s => (s ? s.replace(':', ' · ') : '');

const Pill = ({ className, children }) => (
  <span className={cn('tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:px-2.5 tw:py-1 tw:font-mono tw:text-[11px] tw:tracking-[0.04em] tw:whitespace-nowrap', className)}>{children}</span>
);
const Bar = ({ pct, className }) => (
  <div className="tw:h-2 tw:overflow-hidden tw:rounded tw:bg-muted">
    <div className={cn('tw:h-full tw:rounded tw:transition-[width] tw:duration-500', className)} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
  </div>
);
const Icon = ({ d, className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('tw:size-5 tw:fill-none tw:stroke-current tw:[stroke-linecap:round] tw:[stroke-linejoin:round] tw:[stroke-width:1.9]', className)}><path d={d} /></svg>
);

/* ---------- per-technique card bodies ---------- */

function IsolationBody({ l, ctx }) {
  const t = ctx.node(l.subject_ids[0]);
  const a = t?.attrs || {};
  const cur = a.payment_currency || l.score_scope?.split(':')[1];
  const amount = a.amount_paid ?? (l.model_inputs ? Math.expm1(l.model_inputs.log1p_amount_paid) : null);
  const hour = l.model_inputs?.hour_utc;
  const g = ctx.group;
  const amounts = g.items.map(x => Number(ctx.node(x.subject_ids[0])?.attrs?.amount_paid)).filter(Number.isFinite);
  const n = Number(amount);
  const sizeNote = amounts.length > 1 && n === Math.max(...amounts) ? 'Largest flagged in this set'
    : amounts.length > 1 && n === Math.min(...amounts) ? 'Smallest flagged in this set' : null;
  const offHours = hour != null && (hour < 9 || hour >= 18);
  return (
    <div className="tw:grid tw:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] tw:items-end tw:gap-x-7 tw:gap-y-4 tw:max-sm:grid-cols-1">
      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <span className="tw:text-xs tw:text-muted-foreground">Transaction amount</span>
        <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
          <strong className="tw:font-display tw:text-[28px] tw:leading-tight tw:font-bold tw:tracking-[-0.02em] tw:text-foreground tw:tabular-nums">{money(amount)}</strong>
          <span className="tw:font-mono tw:text-[13px] tw:text-muted-foreground">{cur}</span>
        </span>
        <span className="tw:text-[13px] tw:text-muted-foreground">
          Sent {day(a.event_time)} at {hh(hour)}{a.payment_format ? ` · ${a.payment_format}` : ''}
        </span>
      </div>
      <div className="tw:grid tw:gap-2">
        <div className="tw:flex tw:justify-between tw:gap-2 tw:text-xs">
          <span className="tw:whitespace-nowrap tw:text-muted-foreground">Unusual in this set</span>
          <span className="tw:font-mono tw:whitespace-nowrap tw:text-review">{l.behavior_score?.toFixed(2)} · #{ctx.rank} of {g.items.length}</span>
        </div>
        <Bar pct={(l.behavior_score ?? 0) * 100} className="tw:bg-review" />
        <div className="tw:flex tw:flex-wrap tw:gap-1.5">
          <Pill className="tw:bg-muted tw:text-foreground/80">{hh(hour)}{offHours ? ' · outside 09–18' : ''}</Pill>
          {sizeNote && <Pill className="tw:bg-muted tw:text-foreground/80">{sizeNote}</Pill>}
        </div>
      </div>
    </div>
  );
}

function LoopBody({ l, ctx }) {
  const hops = (l.transaction_ids || [])
    .map(id => ({ id, e: ctx.txEdge(id), t: ctx.node(id) }))
    .sort((x, y) => String(x.t?.attrs?.event_time || '').localeCompare(String(y.t?.attrs?.event_time || '')));
  const route = hops.length && hops[0].e ? [hops[0].e.source, ...hops.map(h => h.e?.target)] : [...l.subject_ids, l.subject_ids[0]];
  const label = id => ctx.node(id)?.label || id?.split(':').pop()?.slice(0, 8) || '?';
  return (
    <div className="tw:grid tw:gap-3.5">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
        {route.map((id, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true" className="tw:shrink-0 tw:text-loop">
                <path className="tw:animate-lp-dash" d="M1 6h19" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" fill="none" />
                <path d="M16 2l5 4-5 4" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            )}
            <span className={cn('tw:rounded-[10px] tw:border tw:bg-background tw:px-3 tw:py-1.5 tw:font-mono tw:text-[13px] tw:text-evidence',
              i === route.length - 1 && i > 0 ? 'tw:border-dashed tw:border-evidence/50' : 'tw:border-evidence/45')}>{label(id)}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] tw:gap-2">
        {hops.map((h, i) => (
          <div key={h.id} className="tw:grid tw:gap-0.5 tw:rounded-xl tw:border tw:border-border tw:bg-background tw:px-3 tw:py-2.5">
            <span className="tw:font-mono tw:text-[11px] tw:text-muted-foreground">HOP {i + 1} · {day(h.t?.attrs?.event_time)}</span>
            <strong className="tw:text-[15px] tw:text-foreground tw:tabular-nums">{money(h.t?.attrs?.amount_paid, h.t?.attrs?.payment_currency)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossBody({ l, ctx }) {
  const n = ctx.node(l.subject_ids[0]);
  const name = n?.label || l.subject_ids[0];
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
      <div className="tw:grid tw:size-14 tw:place-items-center tw:rounded-full tw:border-2 tw:border-trust tw:bg-trust/15 tw:font-display tw:font-semibold tw:text-foreground">
        {name.split(/\s+/).map(w => w[0]).join('').slice(0, 2)}
      </div>
      <div className="tw:grid tw:min-w-[200px] tw:flex-1 tw:gap-1.5">
        <strong className="tw:font-display tw:text-[22px] tw:text-foreground">{name}</strong>
        <div className="tw:flex tw:flex-wrap tw:gap-1.5">{l.case_ids.map(c => <Pill key={c} className="tw:bg-trust/14 tw:text-trust">{c}</Pill>)}</div>
      </div>
    </div>
  );
}

function CentralityBody({ l, ctx }) {
  const n = ctx.node(l.subject_ids[0]);
  const s = l.structural_context || {};
  const max = ctx.maxMetric;
  const metrics = [['Degree', 'degree'], ['Betweenness', 'betweenness'], ['PageRank', 'pagerank']];
  return (
    <div className="tw:grid tw:gap-3.5">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2.5">
        <strong className="tw:font-display tw:text-[22px] tw:text-foreground">{n?.label || l.subject_ids[0]}</strong>
        <span className="tw:text-[13px] tw:text-muted-foreground">{n?.type || 'Entity'}{s.community != null ? ` · community ${s.community + 1}` : ''}</span>
      </div>
      <div className="tw:grid tw:grid-cols-3 tw:gap-3 tw:max-sm:grid-cols-1">
        {metrics.map(([k, key]) => (
          <div key={key} className="tw:grid tw:gap-1.5">
            <span className="tw:flex tw:justify-between tw:text-xs"><span className="tw:text-muted-foreground">{k}</span><span className="tw:font-mono tw:text-signal">{(s[key] ?? 0).toFixed(3)}</span></span>
            <Bar pct={max[key] ? ((s[key] ?? 0) / max[key]) * 100 : 0} className="tw:bg-signal" />
          </div>
        ))}
      </div>
    </div>
  );
}

const BODY = { isolation_forest: IsolationBody, fund_flow: LoopBody, cross_case: CrossBody, centrality: CentralityBody };

function details(l, kind, ctx) {
  if (kind === 'isolation_forest') return [
    ['Model', l.model], ['Inputs', l.model_inputs ? `log1p(amount) = ${l.model_inputs.log1p_amount_paid.toFixed(2)} · hour = ${l.model_inputs.hour_utc}` : '—'],
    ['Scope', scopeLabel(l.score_scope)], ['Score meaning', 'Rank within this set only, not a probability']];
  if (kind === 'fund_flow') return [
    ['Rule', 'Chronological, same currency, ≤ 4 hops'], ['Transactions', String(l.transaction_ids?.length ?? 0)],
    ['Accounts', l.subject_ids.map(id => ctx.node(id)?.label || id).join(', ')], ['Meaning', 'Possible route, not proof of identical funds']];
  if (kind === 'centrality') return [
    ['Community', l.structural_context?.community != null ? `Louvain #${l.structural_context.community + 1}` : '—'],
    ['Cases', l.case_ids.join(', ')], ['Excluded', 'Documents and evidence nodes'], ['Meaning', 'Position, not suspicion']];
  return [['Cases', l.case_ids.join(', ')], ['Visible because', 'Your token covers these cases']];
}

function FindingCard({ l, kind, ctx, open, onToggle, onReview, onOpen }) {
  const k = KIND[kind], tone = TONE[k.tone], st = STATE[l.review_state] || STATE.pending;
  const Body = BODY[kind];
  return (
    <article aria-label={`${k.tech} finding ${ref(l)}`}
      className={cn(
        'tw:relative tw:grid tw:grid-rows-[auto_1fr_auto] tw:overflow-hidden tw:rounded-[18px] tw:border tw:border-border tw:bg-card tw:transition-[translate,border-color,box-shadow] tw:duration-300 tw:ease-out tw:hover:-translate-y-0.5 tw:hover:border-trust/45 tw:hover:shadow-[0_24px_50px_-30px_rgb(0_0_0/60%)]',
        open && 'tw:border-trust/70 tw:shadow-[0_0_0_1px_var(--trust)]',
        l.review_state === 'relevant' && 'tw:border-signal/50',
        l.review_state === 'not_relevant' && 'tw:opacity-65'
      )}>
      <span aria-hidden="true" className={cn('tw:absolute tw:inset-y-0 tw:left-0 tw:w-[3px]', tone.bar)} />
      {/* header strip */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-border tw:bg-muted/35 tw:py-3 tw:pr-4 tw:pl-5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Pill className={cn(tone.soft, tone.text)}>{k.tech}</Pill>
          <span className="tw:font-mono tw:text-[11.5px] tw:text-muted-foreground">{ref(l)}</span>
        </div>
        <Pill className={st.cls}>{st.label}</Pill>
      </div>
      {/* body */}
      <div className="tw:grid tw:content-start tw:gap-3.5 tw:py-[18px] tw:pr-5 tw:pl-6">
        <Body l={l} ctx={ctx} />
        <p className="tw:m-0 tw:text-[13px] tw:leading-normal tw:text-foreground/75">{l.reason}</p>
        {open && (
          <dl className="tw:m-0 tw:grid tw:animate-lp-rise tw:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] tw:gap-x-5 tw:gap-y-3 tw:rounded-xl tw:border tw:border-border tw:bg-background tw:px-4 tw:py-3.5">
            {details(l, kind, ctx).map(([dt, dd]) => (
              <div key={dt} className="tw:grid tw:gap-0.5">
                <dt className="tw:text-[11.5px] tw:text-muted-foreground">{dt}</dt>
                <dd className="tw:m-0 tw:font-mono tw:text-[12.5px] tw:[overflow-wrap:anywhere] tw:text-foreground">{dd}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {/* footer: source · details · decision · open */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-t tw:border-border tw:py-3 tw:pr-4 tw:pl-5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
          <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-[13px] tw:text-evidence">
            <Icon d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4" className="tw:size-4" />
            {l.evidence_ids.length} source{l.evidence_ids.length === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={onToggle} aria-expanded={open}
            className="tw:min-h-9 tw:cursor-pointer tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-2 tw:py-0 tw:text-[13px] tw:font-medium tw:text-trust tw:hover:bg-trust/10">
            {open ? 'Hide details' : 'Why flagged?'}
          </button>
        </div>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
          <div role="group" aria-label="Your decision" className="tw:inline-flex tw:gap-0.5 tw:rounded-xl tw:border tw:border-border tw:bg-background tw:p-[3px]">
            {DECISIONS.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={l.review_state === s} onClick={() => onReview(l, s)}
                className={cn('tw:min-h-9 tw:cursor-pointer tw:rounded-[9px] tw:border-0 tw:bg-transparent tw:px-3 tw:py-0 tw:text-[12.5px] tw:font-medium tw:text-muted-foreground tw:shadow-none tw:hover:translate-y-0 tw:hover:bg-muted tw:hover:text-foreground',
                  l.review_state === s && DECISION_ON[s])}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onOpen(l)}
            className="tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-xl tw:border-0 tw:bg-evidence tw:px-4 tw:py-0 tw:text-[13.5px] tw:font-semibold tw:text-background tw:hover:shadow-[0_0_0_5px_rgb(242_181_68/16%)]">
            Review evidence <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export default function FindingsReview({ leads, allLeads, graph, analysis, tabLabel, search, setSearch, onReview, onOpen }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const ctx0 = useMemo(() => {
    const nodes = new Map((graph?.nodes || []).map(n => [n.id, n]));
    const byTx = new Map();
    (graph?.edges || []).forEach(e => { const t = e.attrs?.transaction_id; if (e.type === 'TRANSACTED_WITH' && t) byTx.set(t, e); });
    return { node: id => nodes.get(id), txEdge: id => byTx.get(id) };
  }, [graph]);

  const q = search.trim().toLowerCase();
  const visible = leads.filter(l => !q || (l.reason + ' ' + l.subject_ids.map(id => ctx0.node(id)?.label || id).join(' ')).toLowerCase().includes(q));

  // Groups: by technique; isolation forest also by score scope. Ranked by score inside each group.
  const groups = useMemo(() => {
    const map = new Map();
    visible.forEach(l => {
      const kind = kindOf(l);
      const key = kind === 'isolation_forest' ? `${kind}|${l.score_scope || ''}` : kind;
      if (!map.has(key)) map.set(key, { key, kind, scope: kind === 'isolation_forest' ? scopeLabel(l.score_scope) : '', items: [] });
      map.get(key).items.push(l);
    });
    const order = ['fund_flow', 'cross_case', 'isolation_forest', 'centrality'];
    return [...map.values()]
      .map(g => ({ ...g, items: [...g.items].sort((a, b) => (b.behavior_score ?? b.structural_context?.betweenness ?? 0) - (a.behavior_score ?? a.structural_context?.betweenness ?? 0)) }))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.items.length - a.items.length);
  }, [visible]);

  const kinds = [...new Set(groups.map(g => g.kind))];
  const shown = groups.filter(g => filter === 'all' || g.kind === filter);
  const maxMetric = useMemo(() => {
    const m = { degree: 0, betweenness: 0, pagerank: 0 };
    leads.forEach(l => Object.keys(m).forEach(k => { m[k] = Math.max(m[k], l.structural_context?.[k] ?? 0); }));
    return m;
  }, [leads]);

  const all = allLeads || leads;
  const count = s => all.filter(l => (l.review_state || 'pending') === s).length;
  const reviewed = all.length - count('pending');
  const coverage = analysis?.traceability_coverage;
  const blocked = analysis?.blocked_untraceable ?? 0;
  const tile = 'tw:grid tw:content-start tw:gap-2 tw:rounded-2xl tw:border tw:border-border tw:bg-card tw:px-5 tw:py-4';

  return (
    <section className="tw:grid tw:gap-6" aria-label={`${tabLabel} findings`}>
      {/* summary tiles */}
      <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(210px,1fr))] tw:gap-3.5">
        <div className={tile}>
          <span className="tw:text-xs tw:text-muted-foreground">Reviewed (all findings)</span>
          <div className="tw:flex tw:items-baseline tw:gap-2"><strong className="tw:font-display tw:text-[28px] tw:text-foreground">{reviewed}</strong><span className="tw:text-sm tw:text-muted-foreground">of {all.length}</span></div>
          <Bar pct={all.length ? (reviewed / all.length) * 100 : 0} className="tw:bg-evidence" />
        </div>
        <div className={tile}>
          <span className="tw:text-xs tw:text-muted-foreground">Your decisions</span>
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            <Pill className={STATE.relevant.cls}>{count('relevant')} relevant</Pill>
            <Pill className={STATE.insufficient_evidence.cls}>{count('insufficient_evidence')} need evidence</Pill>
            <Pill className="tw:bg-muted tw:text-muted-foreground">{count('not_relevant')} not relevant</Pill>
          </div>
        </div>
        <div className={tile}>
          <span className="tw:text-xs tw:text-muted-foreground">Traceable to a source</span>
          <strong className="tw:font-display tw:text-[28px] tw:text-signal">{coverage != null ? `${Math.round(coverage * 100)}%` : '—'}</strong>
          <span className="tw:text-xs tw:text-muted-foreground">{blocked} untraceable lead{blocked === 1 ? '' : 's'} blocked</span>
        </div>
        <div className={tile}>
          <span className="tw:text-xs tw:text-muted-foreground">Scores are</span>
          <strong className="tw:font-display tw:text-lg tw:leading-snug tw:text-foreground">descriptive, in-sample</strong>
          <span className="tw:text-xs tw:text-muted-foreground">Not a probability, not about guilt.</span>
        </div>
      </div>

      {/* search + filters */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
        <label className="tw:flex tw:min-h-11 tw:flex-[1_1_280px] tw:items-center tw:gap-2.5 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-3.5 tw:focus-within:border-trust">
          <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5" className="tw:size-[18px] tw:text-muted-foreground" />
          <span className="tw:sr-only">Search findings</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities, accounts or findings…"
            className="tw:m-0 tw:min-h-0 tw:w-full tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-foreground tw:shadow-none tw:outline-none tw:focus:shadow-none" />
        </label>
        {kinds.length > 1 && [['all', 'All', null], ...kinds.map(k => [k, KIND[k].title, KIND[k].tone])].map(([k, label, tone]) => {
          const n = k === 'all' ? visible.length : groups.filter(g => g.kind === k).reduce((s, g) => s + g.items.length, 0);
          const on = filter === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)}
              className={cn('tw:inline-flex tw:min-h-10 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3.5 tw:py-0 tw:text-[13px] tw:text-foreground/85 tw:shadow-none tw:hover:border-trust/60',
                on && 'tw:border-foreground tw:bg-foreground tw:font-semibold tw:text-background tw:hover:border-foreground')}>
              {tone && <i className={cn('tw:size-2 tw:rounded-full', TONE[tone].bar)} />}
              {label}<span className="tw:font-mono tw:text-[11px] tw:opacity-75">{n}</span>
            </button>
          );
        })}
      </div>

      {/* groups */}
      {shown.map(g => {
        const k = KIND[g.kind], tone = TONE[k.tone];
        // Open by default: every loop / cross-case / centrality group, and the first unusual-amount set.
        const firstIf = shown.find(x => x.kind === 'isolation_forest')?.key;
        const exp = q ? true : collapsed[g.key] === undefined ? (g.kind !== 'isolation_forest' || g.key === firstIf) : !collapsed[g.key];
        const ctxG = { ...ctx0, group: g, maxMetric };
        return (
          <section key={g.key} className="tw:grid tw:gap-3.5 tw:border-t tw:border-border tw:pt-5 tw:first-of-type:border-t-0 tw:first-of-type:pt-0">
            <button type="button" aria-expanded={exp} onClick={() => setCollapsed(c => ({ ...c, [g.key]: exp }))}
              className="tw:flex tw:min-h-0 tw:w-full tw:cursor-pointer tw:items-center tw:gap-3.5 tw:rounded-xl tw:border-0 tw:bg-transparent tw:px-1 tw:py-1.5 tw:text-left tw:shadow-none tw:hover:translate-y-0 tw:hover:bg-muted/50">
              <span className={cn('tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-xl', tone.soft, tone.text)}><Icon d={k.icon} /></span>
              <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
                <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
                  <span className="tw:font-display tw:text-lg tw:font-semibold tw:text-foreground">{k.title}</span>
                  <Pill className={cn(tone.soft, tone.text)}>{g.items.length} FINDING{g.items.length === 1 ? '' : 'S'}</Pill>
                  {g.scope && <span className="tw:font-mono tw:text-[11.5px] tw:text-muted-foreground">{g.scope}</span>}
                </span>
                <span className="tw:text-[13px] tw:text-muted-foreground">{k.blurb}</span>
              </span>
              <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-[13px] tw:text-muted-foreground">
                {exp ? 'Collapse' : `Show ${g.items.length}`}
                <Icon d="M6 9l6 6 6-6" className={cn('tw:size-4 tw:transition-transform tw:duration-200', exp && 'tw:rotate-180')} />
              </span>
            </button>
            {exp && (
              <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(min(100%,500px),1fr))] tw:gap-3.5">
                {g.items.map((l, i) => (
                  <FindingCard key={l.id} l={l} kind={g.kind} ctx={{ ...ctxG, rank: i + 1 }}
                    open={open === l.id} onToggle={() => setOpen(o => (o === l.id ? null : l.id))}
                    onReview={onReview} onOpen={onOpen} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {!shown.length && <p className="tw:m-0 tw:rounded-2xl tw:border tw:border-dashed tw:border-border tw:p-8 tw:text-center tw:text-sm tw:text-muted-foreground">No findings match this view.</p>}
      <p className="tw:m-0 tw:text-center tw:text-xs tw:text-muted-foreground">Synthetic demonstration data · Decision support, never a verdict</p>
    </section>
  );
}
