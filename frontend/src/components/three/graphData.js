/* Data helpers for the 3D graph explorer. No rendering code here. */

/**
 * Money loops, using the same rule as the backend's fund-flow finding (maha/analytics.py):
 * a chain of transfers that returns to its starting account within `maxHops`, where every
 * hop is later than the previous one and stays in the same currency and time basis.
 * Returns each loop as an ordered list of the original transfer edges.
 */
export function findMoneyLoops(edges, maxHops = 4, limit = 50, budget = 20000) {
  const bySource = new Map();
  edges.forEach(e => {
    const a = e.attrs || {};
    if (e.type !== 'TRANSACTED_WITH' || !a.event_time || a.payment_currency !== a.receiving_currency) return;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  });
  bySource.forEach(list => list.sort((x, y) => (x.attrs.event_time < y.attrs.event_time ? -1 : 1)));
  const loops = [];
  let explored = 0;
  const visit = (origin, current, path, seen) => {
    if (loops.length >= limit || explored >= budget || path.length >= maxHops) return;
    for (const e of bySource.get(current) || []) {
      explored++;
      const prev = path[path.length - 1];
      if (prev) {
        if (new Date(e.attrs.event_time) <= new Date(prev.attrs.event_time)) continue;
        if (e.attrs.payment_currency !== prev.attrs.payment_currency || e.attrs.time_basis !== prev.attrs.time_basis) continue;
      }
      const next = [...path, e];
      if (e.target === origin && next.length >= 2) loops.push(next);
      else if (!seen.has(e.target)) visit(origin, e.target, next, new Set(seen).add(e.target));
      if (loops.length >= limit || explored >= budget) return;
    }
  };
  for (const origin of [...bySource.keys()].sort()) {
    visit(origin, origin, [], new Set([origin]));
    if (loops.length >= limit || explored >= budget) break;
  }
  return loops;
}

/** Epoch ms for an edge's event time, or null when the relationship has no date. */
export function edgeTime(e) {
  const t = e.attrs?.event_time;
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** Group key for a node under the chosen grouping mode. */
export function groupKey(node, mode) {
  if (mode === 'community') return node.community == null ? null : `community:${node.community}`;
  if (mode === 'case') return node.cases?.[0] ? `case:${node.cases[0]}` : null;
  return null;
}

export function groupLabel(key) {
  if (!key) return 'Ungrouped';
  const [kind, id] = key.split(':');
  return kind === 'community' ? `Community ${Number(id) + 1}` : id;
}

/** Places group centres evenly on a ring sized to the number of groups. The ring faces
 *  the camera (x/y plane); a flat ring in x/z would be seen edge-on and look stacked. */
export function groupCentres(keys) {
  const n = keys.length;
  const radius = n <= 1 ? 0 : 55 + 22 * Math.sqrt(n);
  const centres = new Map();
  keys.forEach((k, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2;
    centres.set(k, { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z: ((i % 3) - 1) * 18 });
  });
  return centres;
}

export const fmtDate = ms => (ms == null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
export const fmtDay = ms => (ms == null ? '—' : new Date(ms).toISOString().slice(0, 10));
export function fmtAmount(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value ? `${value} ${currency || ''}`.trim() : '—';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}

export const RELATION_LABELS = {
  TRANSACTED_WITH: 'Transfers', SENT_FROM: 'Sent from', SENT_TO: 'Sent to', OWNS_ACCOUNT: 'Owns account',
  COMMUNICATED_WITH: 'Calls', INVOLVED_IN_CASE: 'Case', LOCATED_AT: 'Location', MENTIONED_IN: 'Mentioned in',
  FILED_UNDER: 'Filed under', RELATED_TO: 'Related to'
};
