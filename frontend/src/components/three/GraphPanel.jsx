import React, { useMemo } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FileSearch, Pause, Play, Repeat, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { RELATION_LABELS, fmtAmount, fmtDate, fmtDay } from './graphData';

// Entity colours, kept in sync with TYPES in Graph3D.jsx.
const TYPE_COLOR = {
  Person: '#5AA9FF', Account: '#F2B544', Phone: '#3DD6B5', Location: '#A98BFF', Case: '#EDF2FA',
  Organization: '#C9C3E8', Transaction: '#8D87B3', Document: '#4A5B7C'
};

const Dot = ({ type, className }) => (
  <span aria-hidden="true" className={cn('tw:inline-block tw:size-2 tw:shrink-0 tw:rounded-full', className)}
    style={{ background: TYPE_COLOR[type] || '#8D87B3', boxShadow: `0 0 8px ${TYPE_COLOR[type] || '#8D87B3'}` }} />
);

const SectionLabel = ({ children }) => (
  <p className="tw:m-0 tw:font-mono tw:text-[11px] tw:tracking-[0.1em] tw:text-muted-foreground tw:uppercase">{children}</p>
);

/* ---------------- Entity tab ---------------- */
function EntityDetails({ selected, adjacency, byId, analysis, onSelectNode, onViewSources }) {
  const findings = useMemo(
    () => (analysis?.leads || []).filter(l => l.subject_ids?.includes(selected?.id)),
    [analysis, selected]
  );
  const relations = useMemo(() => {
    const groups = new Map();
    // One row per neighbour and relation; repeated records of the same link are counted.
    (adjacency.get(selected?.id) || []).forEach(a => {
      if (!groups.has(a.type)) groups.set(a.type, new Map());
      const rows = groups.get(a.type);
      if (rows.has(a.other) && !a.link.edge?.attrs?.amount_paid) rows.get(a.other).count++;
      else rows.set(rows.has(a.other) ? a.other + ':' + rows.size : a.other, { ...a, count: 1 });
    });
    return [...groups.entries()].map(([t, rows]) => [t, [...rows.values()]]).sort((a, b) => b[1].length - a[1].length);
  }, [adjacency, selected]);

  if (!selected) {
    return (
      <div className="tw:grid tw:gap-2 tw:py-6 tw:text-center">
        <p className="tw:m-0 tw:text-sm tw:text-foreground">Click an entity in the graph</p>
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">You'll see its connections, any findings that mention it, and a link to its sources.</p>
      </div>
    );
  }

  const metrics = analysis?.metrics?.[selected.id];
  return (
    <div className="tw:grid tw:gap-4">
      <div className="tw:grid tw:gap-1.5">
        <span className="tw:inline-flex tw:items-center tw:gap-2 tw:font-mono tw:text-[11px] tw:tracking-[0.1em] tw:uppercase" style={{ color: TYPE_COLOR[selected.type] }}>
          <Dot type={selected.type} />{selected.type}
        </span>
        <h3 className="tw:m-0 tw:font-display tw:text-lg tw:leading-tight tw:font-bold tw:tracking-tight tw:break-words tw:text-foreground">{selected.label}</h3>
      </div>

      <dl className="tw:m-0 tw:grid tw:grid-cols-3 tw:gap-2">
        {[
          ['Links', selected.degree],
          ['Community', metrics?.community != null ? metrics.community + 1 : '—'],
          ['Cases', selected.cases.length || '—']
        ].map(([k, v]) => (
          <div key={k} className="tw:rounded-lg tw:border tw:border-border tw:bg-background/60 tw:px-2.5 tw:py-2">
            <dt className="tw:text-[11px] tw:text-muted-foreground">{k}</dt>
            <dd className="tw:m-0 tw:font-display tw:text-base tw:font-bold tw:tabular-nums tw:text-foreground">{v}</dd>
          </div>
        ))}
      </dl>

      <Button size="sm" onClick={() => onViewSources(selected)}><FileSearch />View sources</Button>

      <Separator />
      <div className="tw:grid tw:gap-2">
        <SectionLabel>Findings · {findings.length}</SectionLabel>
        {findings.length === 0 && <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">No findings mention this entity{analysis?.leads ? '' : ' yet. Run case analysis to generate findings'}.</p>}
        {findings.slice(0, 6).map(f => (
          <div key={f.id} className="tw:grid tw:gap-1.5 tw:rounded-lg tw:border tw:border-border tw:bg-background/60 tw:p-2.5">
            <div className="tw:flex tw:flex-wrap tw:gap-1.5">
              <Badge variant="outline" className={f.category === 'connection' ? 'tw:text-trust' : 'tw:text-review'}>
                {f.category === 'connection' ? 'Connection' : 'Flagged behaviour'}
              </Badge>
              {(f.techniques || []).map(t => <Badge key={t} variant="secondary" className="tw:font-mono tw:text-[10px]">{t.replace('_', ' ')}</Badge>)}
            </div>
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-secondary-foreground">{f.reason}</p>
          </div>
        ))}
      </div>

      <Separator />
      <div className="tw:grid tw:gap-3">
        <SectionLabel>Connections · {selected.degree}</SectionLabel>
        {relations.map(([type, items]) => (
          <div key={type} className="tw:grid tw:gap-1">
            <p className="tw:m-0 tw:text-xs tw:font-medium tw:text-foreground">{RELATION_LABELS[type] || type} <span className="tw:text-muted-foreground">· {items.length}</span></p>
            <ul className="tw:m-0 tw:grid tw:list-none tw:gap-0.5 tw:p-0">
              {items.slice(0, 8).map((a, i) => {
                const other = byId.get(a.other);
                const attrs = a.link.edge?.attrs || {};
                return (
                  <li key={a.other + i}>
                    <button type="button" onClick={() => onSelectNode(a.other)}
                      className="tw:flex tw:min-h-0 tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-1.5 tw:text-left tw:text-xs tw:text-secondary-foreground tw:shadow-none tw:hover:bg-accent tw:hover:text-foreground">
                      <Dot type={other?.type} />
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate">{other?.label || a.other}</span>
                      {a.count > 1 && <span className="tw:shrink-0 tw:font-mono tw:text-[10px] tw:text-muted-foreground" title={`${a.count} source records`}>×{a.count}</span>}
                      {attrs.amount_paid && <span className={cn('tw:shrink-0 tw:font-mono tw:text-[10px]', a.link.loop ? 'tw:text-loop' : 'tw:text-evidence')}>{fmtAmount(attrs.amount_paid, attrs.payment_currency)}</span>}
                      {!attrs.amount_paid && a.link.time && <span className="tw:shrink-0 tw:font-mono tw:text-[10px] tw:text-muted-foreground">{fmtDay(a.link.time)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {items.length > 8 && <p className="tw:m-0 tw:pl-2 tw:text-[11px] tw:text-muted-foreground">+ {items.length - 8} more</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Money loops tab ---------------- */
function LoopsTab({ loops, trace, setTrace, byId }) {
  const label = id => byId.get(id)?.label || id.split(':').pop();
  if (!loops.length) {
    return (
      <p className="tw:m-0 tw:py-6 tw:text-center tw:text-xs tw:text-muted-foreground">
        No money loops in this case. A loop is a chain of transfers, in time order and the same currency, that returns to its starting account within four hops.
      </p>
    );
  }
  if (trace) {
    const i = loops.indexOf(trace.loop);
    const go = step => setTrace({ ...trace, step: (step + trace.loop.length) % trace.loop.length, playing: false });
    return (
      <div className="tw:grid tw:gap-3">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
          <div>
            <p className="tw:m-0 tw:font-display tw:text-base tw:font-bold tw:text-foreground">Loop {i + 1}</p>
            <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">Hop {trace.step + 1} of {trace.loop.length}</p>
          </div>
          <div className="tw:flex tw:gap-1">
            <Button variant="outline" size="icon" className="tw:size-8 tw:min-h-0" aria-label="Previous hop" onClick={() => go(trace.step - 1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" className="tw:size-8 tw:min-h-0" aria-label={trace.playing ? 'Pause' : 'Play'}
              onClick={() => setTrace({ ...trace, playing: !trace.playing })}>{trace.playing ? <Pause /> : <Play />}</Button>
            <Button variant="outline" size="icon" className="tw:size-8 tw:min-h-0" aria-label="Next hop" onClick={() => go(trace.step + 1)}><ChevronRight /></Button>
            <Button variant="outline" size="icon" className="tw:size-8 tw:min-h-0" aria-label="Stop tracing" onClick={() => setTrace(null)}><Square /></Button>
          </div>
        </div>
        <ol className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:p-0">
          {trace.loop.map((e, k) => {
            const a = e.attrs || {};
            const current = k === trace.step;
            return (
              <li key={k}>
                <button type="button" onClick={() => setTrace({ ...trace, step: k, playing: false })}
                  className={cn('tw:grid tw:min-h-0 tw:w-full tw:cursor-pointer tw:gap-1 tw:rounded-lg tw:border tw:bg-background/60 tw:p-2.5 tw:text-left tw:shadow-none tw:transition-colors',
                    current ? 'tw:border-loop tw:bg-loop/10' : 'tw:border-border tw:hover:border-ring')}>
                  <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-foreground">
                    <span className="tw:font-mono tw:text-[10px] tw:text-muted-foreground">{k + 1}</span>
                    <span className="tw:truncate">{label(e.source)}</span>
                    <ArrowRight className="tw:size-3 tw:shrink-0 tw:text-loop" />
                    <span className="tw:truncate">{label(e.target)}</span>
                  </span>
                  <span className="tw:flex tw:justify-between tw:gap-2 tw:font-mono tw:text-[10px]">
                    <span className="tw:text-loop">{fmtAmount(a.amount_paid, a.payment_currency)}</span>
                    <span className="tw:text-muted-foreground">{fmtDate(Date.parse(a.event_time))}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="tw:m-0 tw:text-[11px] tw:text-muted-foreground">A possible route only: matching amounts and timing do not prove the same funds moved.</p>
      </div>
    );
  }
  return (
    <div className="tw:grid tw:gap-2">
      <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">Pick a loop to trace it hop by hop. The camera follows each transfer.</p>
      {loops.map((loop, i) => {
        const first = Date.parse(loop[0].attrs.event_time);
        const last = Date.parse(loop[loop.length - 1].attrs.event_time);
        return (
          <button key={i} type="button" onClick={() => setTrace({ loop, step: 0, playing: true })}
            className="tw:grid tw:min-h-0 tw:w-full tw:cursor-pointer tw:gap-1 tw:rounded-lg tw:border tw:border-border tw:bg-background/60 tw:p-3 tw:text-left tw:shadow-none tw:transition-colors tw:hover:border-loop">
            <span className="tw:flex tw:items-center tw:justify-between tw:gap-2">
              <span className="tw:inline-flex tw:items-center tw:gap-2 tw:font-display tw:text-sm tw:font-bold tw:text-foreground"><Repeat className="tw:size-3.5 tw:text-loop" />Loop {i + 1}</span>
              <Badge variant="outline" className="tw:font-mono tw:text-[10px] tw:text-loop">{loop.length} hops · {loop[0].attrs.payment_currency}</Badge>
            </span>
            <span className="tw:truncate tw:text-xs tw:text-secondary-foreground">{[...loop.map(e => label(e.source)), label(loop[0].source)].join(' → ')}</span>
            <span className="tw:font-mono tw:text-[10px] tw:text-muted-foreground">{fmtDay(first)} → {fmtDay(last)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Groups tab ---------------- */
function GroupsTab({ groupMode, setGroupMode, hasCommunities, groups, activeGroup, setActiveGroup }) {
  return (
    <div className="tw:grid tw:gap-3">
      <div className="tw:grid tw:gap-1.5">
        <SectionLabel>Arrange by</SectionLabel>
        <div className="tw:grid tw:grid-cols-3 tw:gap-1 tw:rounded-lg tw:bg-muted tw:p-[3px]" role="radiogroup" aria-label="Group the network by">
          {[['none', 'None'], ['community', 'Community'], ['case', 'Case']].map(([m, l]) => (
            <button key={m} type="button" role="radio" aria-checked={groupMode === m}
              disabled={m === 'community' && !hasCommunities} onClick={() => setGroupMode(m)}
              className={cn('tw:min-h-0 tw:cursor-pointer tw:rounded-md tw:border tw:border-transparent tw:bg-transparent tw:px-2 tw:py-1.5 tw:text-xs tw:font-medium tw:text-muted-foreground tw:shadow-none tw:disabled:cursor-not-allowed tw:disabled:opacity-40',
                groupMode === m && 'tw:border-input tw:bg-background tw:text-foreground')}>{l}</button>
          ))}
        </div>
        <p className="tw:m-0 tw:text-[11px] tw:text-muted-foreground">
          {hasCommunities
            ? 'Communities are clusters found by the case analysis (Louvain). Grouping changes the layout only, never the data.'
            : 'Communities appear after the case analysis finishes loading.'}
        </p>
      </div>
      {groupMode !== 'none' && (
        <div className="tw:grid tw:gap-1.5">
          <SectionLabel>{groups.length} groups</SectionLabel>
          {groups.map(g => {
            const counts = {};
            g.members.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });
            const active = activeGroup === g.key;
            return (
              <button key={g.key} type="button" aria-pressed={active} onClick={() => setActiveGroup(active ? null : g.key)}
                className={cn('tw:grid tw:min-h-0 tw:w-full tw:cursor-pointer tw:gap-1.5 tw:rounded-lg tw:border tw:bg-background/60 tw:p-2.5 tw:text-left tw:shadow-none tw:transition-colors',
                  active ? 'tw:border-trust tw:bg-trust/10' : 'tw:border-border tw:hover:border-ring')}>
                <span className="tw:flex tw:items-center tw:justify-between tw:text-xs tw:font-medium tw:text-foreground">{g.label}<span className="tw:font-mono tw:text-muted-foreground">{g.members.length}</span></span>
                <span className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
                  {Object.entries(counts).map(([t, c]) => (
                    <span key={t} className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:text-muted-foreground"><Dot type={t} className="tw:size-1.5" />{c} {t}</span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Panel shell ---------------- */
export default function GraphPanel(props) {
  const { tab, onTab, onClose, loops, trace, stats } = props;
  return (
    <aside aria-label="Graph details"
      className="dark-theme tw:absolute tw:top-3 tw:right-3 tw:bottom-3 tw:z-10 tw:flex tw:w-80 tw:max-w-[calc(100%-1.5rem)] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card/90 tw:text-card-foreground tw:shadow-2xl tw:backdrop-blur-md">
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-border tw:px-4 tw:py-3">
        <div className="tw:min-w-0">
          <p className="tw:m-0 tw:font-display tw:text-sm tw:font-bold tw:text-foreground">Graph details</p>
          <p className="tw:m-0 tw:font-mono tw:text-[10px] tw:text-muted-foreground">{stats.nodes} entities · {stats.links} links · {stats.loopLinks} loop transfers</p>
        </div>
        <Button variant="ghost" size="icon" className="tw:size-7 tw:min-h-0" aria-label="Hide panel" onClick={onClose}><X /></Button>
      </div>
      <Tabs value={tab} onValueChange={onTab} className="tw:min-h-0 tw:flex-1 tw:gap-0">
        <TabsList className="tw:mx-3 tw:mt-3 tw:w-[calc(100%-1.5rem)]">
          <TabsTrigger value="entity" className="tw:min-h-0">Entity</TabsTrigger>
          <TabsTrigger value="loops" className="tw:min-h-0">Loops{loops.length ? ` · ${loops.length}` : ''}{trace ? ' ●' : ''}</TabsTrigger>
          <TabsTrigger value="groups" className="tw:min-h-0">Groups</TabsTrigger>
        </TabsList>
        <ScrollArea className="tw:min-h-0 tw:flex-1">
          <div className="tw:p-4">
            <TabsContent value="entity"><EntityDetails {...props} /></TabsContent>
            <TabsContent value="loops"><LoopsTab {...props} /></TabsContent>
            <TabsContent value="groups"><GroupsTab {...props} /></TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

/* ---------------- Timeline bar ---------------- */
export function TimelineBar({ range, timeline, setTimeline, links, cutoff, className }) {
  const shown = links.filter(l => l.time != null && l.time <= cutoff).length;
  const step = Math.max(1, (range.max - range.min) / 400);
  return (
    <div className={cn('dark-theme tw:absolute tw:bottom-3 tw:left-3 tw:right-3 tw:z-10 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:border tw:border-border tw:bg-card/90 tw:px-3 tw:py-2.5 tw:text-card-foreground tw:shadow-xl tw:backdrop-blur-md', className)}
      role="group" aria-label="Timeline playback">
      <Button size="icon" className="tw:size-8 tw:min-h-0 tw:shrink-0" aria-label={timeline.playing ? 'Pause timeline' : 'Play timeline'}
        onClick={() => setTimeline(tl => ({ ...tl, playing: !tl.playing, t: tl.t >= range.max ? range.min : tl.t }))}>
        {timeline.playing ? <Pause /> : <Play />}
      </Button>
      <div className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1.5">
        <Slider min={range.min} max={range.max} step={step} value={[cutoff]} aria-label="Show links up to this date"
          onValueChange={([v]) => setTimeline(tl => ({ ...tl, t: v, playing: false }))} />
        <div className="tw:flex tw:justify-between tw:gap-2 tw:font-mono tw:text-[10px] tw:text-muted-foreground">
          <span>{fmtDay(range.min)}</span>
          <span className="tw:text-foreground">{fmtDate(cutoff)} · {shown} of {range.dated} dated links</span>
          <span>{fmtDay(range.max)}</span>
        </div>
      </div>
    </div>
  );
}
