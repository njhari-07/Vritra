/* The "walk through the case" timeline view, ported from Ayaana's prototype
   (index3d.html, Sample v2/v3). The drawing code is hers: a 2D canvas with its own perspective
   maths, depth = time, height = entity layer, icons with rings and badges, curved dashed links
   with travelling dots and labels, wireframe buildings for locations, a radar mini-map, a
   legend, a story panel and a play / scrub bar.
   What changed: it reads the real case graph instead of hard-coded demo cases, every name is
   escaped before it goes into HTML, keyboard and wheel only act while the pointer is over the
   scene, and it cleans up after itself so React can mount and unmount it. */
import { ICON, iconKind, genderOf, hash } from './entityIcons';

const NT = {
  case: { c: '#b388ff', n: 'Case' },
  doc: { c: '#8fa8ff', n: 'Evidence' },
  person: { c: '#4cc9f0', n: 'Person' },
  account: { c: '#ffb703', n: 'Account' },
  device: { c: '#f72585', n: 'Device' },
  place: { c: '#80ed99', n: 'Location' }
};
const ET = {
  phone: { c: '#4cc9f0', n: 'Related / shared', d: [] },
  money: { c: '#ffb703', n: 'Money', d: [12, 0] },
  device: { c: '#f72585', n: 'Same device', d: [3, 7] },
  seen: { c: '#80ed99', n: 'Seen at', d: [12, 6] },
  comm: { c: '#b388ff', n: 'Communicated / case', d: [2, 6] },
  doc: { c: '#8fa8ff', n: 'Mentioned in evidence', d: [1, 5] }
};
const DZ = 70, FY = -170, CE = 220, XW = 500, NEAR = 30;
const TIER = { case: 150, doc: 104, person: 62, account: -8, device: -62 };
const TIERS = [['case', TIER.case, 'CASE'], ['doc', TIER.doc, 'EVIDENCE'], ['person', TIER.person, 'PEOPLE'], ['account', TIER.account, 'ACCOUNTS'], ['device', TIER.device, 'DEVICES'], ['place', FY, 'LOCATIONS']];
const BD = { hub: [130, 90, 46], tower: [56, 56, 120], depot: [120, 70, 34] };
const FLAG = { c: '#ff4d6d', g: '!', n: 'Named in a finding' };
const TYPE = { Person: 'person', Account: 'account', Phone: 'device', Location: 'place', Organization: 'place', Document: 'doc', Case: 'case' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rrp = (c, x, y, w, h, r) => { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); };

/* ---------------- real case graph -> the prototype's world ---------------- */
const TIME_KEYS = ['event_time', 'filed_date', 'first_seen', 'start_time', 'timestamp', 'date'];
const toMs = v => { if (v == null || v === '') return null; const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
const firstTime = a => { for (const k of TIME_KEYS) { const t = toMs(a?.[k]); if (t != null) return t; } return null; };

const amount = a => {
  const v = Number(a?.amount_paid ?? a?.amount);
  if (!Number.isFinite(v)) return '';
  const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[a.payment_currency] || '';
  const s = v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(0);
  return sym ? sym + s : s + ' ' + (a.payment_currency || '');
};
function edgeKind(e, ta, tb) {
  switch (e.type) {
    case 'TRANSACTED_WITH': case 'SENT_FROM': case 'SENT_TO': case 'OWNS_ACCOUNT': return 'money';
    case 'COMMUNICATED_WITH': case 'INVOLVED_IN_CASE': return 'comm';
    case 'LOCATED_AT': return 'seen';
    case 'MENTIONED_IN': case 'FILED_UNDER': return 'doc';
    default: return ta === 'device' || tb === 'device' ? 'device' : 'phone';
  }
}
function edgeLabel(e) {
  const a = e.attrs || {};
  switch (e.type) {
    case 'TRANSACTED_WITH': return (amount(a) || 'Money') + ' transfer';
    case 'SENT_FROM': return 'Paid from';
    case 'SENT_TO': return 'Paid to';
    case 'OWNS_ACCOUNT': return 'Owns account';
    case 'COMMUNICATED_WITH': return a.duration_seconds ? `Call · ${Math.max(1, Math.round(a.duration_seconds / 60))} min` : 'Communicated';
    case 'LOCATED_AT': return 'Seen at';
    case 'INVOLVED_IN_CASE': return 'Named in case';
    case 'MENTIONED_IN': return 'Mentioned in';
    case 'FILED_UNDER': return 'Filed under case';
    default: return String(e.type || 'Linked').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }
}

export function buildWorld(graph, analysis) {
  const all = (graph?.nodes || []).filter(n => TYPE[n.type]);            // transactions live on as money links
  const byId = new Map(all.map(n => [n.id, n]));
  const edges = (graph?.edges || []).filter(e => e.source !== e.target && byId.has(e.source) && byId.has(e.target));
  const flagged = new Set((analysis?.leads || []).flatMap(l => l.subject_ids || []));

  // first-seen time per entity (same rule as the 3D timeline)
  const time = new Map(), adj = new Map(all.map(n => [n.id, []]));
  const seen = (id, t) => { if (!time.has(id) || t < time.get(id)) time.set(id, t); };
  all.forEach(n => { const t = firstTime(n.attrs); if (t != null) time.set(n.id, t); });
  (graph?.edges || []).forEach(e => {
    const t = firstTime(e.attrs);
    // a transfer via a Transaction node still dates the accounts on either side
    if (t != null) { if (byId.has(e.source)) seen(e.source, t); if (byId.has(e.target)) seen(e.target, t); }
  });
  edges.forEach(e => { adj.get(e.source).push(e.target); adj.get(e.target).push(e.source); });
  for (let round = 0; round < 4; round++) {
    let changed = false;
    all.forEach(n => {
      if (time.has(n.id)) return;
      const ts = adj.get(n.id).map(id => time.get(id)).filter(t => t != null);
      if (ts.length) { time.set(n.id, Math.min(...ts)); changed = true; }
    });
    if (!changed) break;
  }
  let mode = 'time';
  if (new Set(time.values()).size < 2) {                                  // no dates: hops from the case
    mode = 'depth'; time.clear();
    const roots = all.filter(n => n.type === 'Case').map(n => n.id);
    if (!roots.length && all.length) roots.push([...all].sort((a, b) => adj.get(b.id).length - adj.get(a.id).length)[0].id);
    roots.forEach(r => time.set(r, 0));
    const q = [...roots];
    while (q.length) { const id = q.shift(); adj.get(id).forEach(nb => { if (!time.has(nb)) { time.set(nb, time.get(id) + 1); q.push(nb); } }); }
  }
  const known = [...time.values()].sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  all.forEach(n => { if (!time.has(n.id)) time.set(n.id, median); });

  // time -> "day" 0..30 along the corridor: half real time, half order of events
  const ts = all.map(n => time.get(n.id)).sort((a, b) => a - b);
  const min = ts[0] ?? 0, max = ts[ts.length - 1] ?? 0, span = max - min;
  const rank = new Map(); ts.forEach((t, i) => { if (!rank.has(t)) rank.set(t, i); });
  const den = Math.max(1, ts.length - 1);
  const dayOfKnown = t => 30 * (0.5 * (span ? (t - min) / span : 0) + 0.5 * ((rank.get(t) ?? 0) / den));
  const marks = [...new Set(ts)].map(t => [dayOfKnown(t), t]);            // [day, time], sorted
  const timeAt = d => {
    if (!marks.length) return 0;
    if (d <= marks[0][0]) return marks[0][1];
    for (let i = 1; i < marks.length; i++) if (d <= marks[i][0]) { const [d0, t0] = marks[i - 1], [d1, t1] = marks[i]; return d1 === d0 ? t1 : t0 + (t1 - t0) * (d - d0) / (d1 - d0); }
    return marks[marks.length - 1][1];
  };
  const dayAt = t => {
    if (!marks.length) return 0;
    if (t <= marks[0][1]) return marks[0][0];
    for (let i = 1; i < marks.length; i++) if (t <= marks[i][1]) { const [d0, t0] = marks[i - 1], [d1, t1] = marks[i]; return t1 === t0 ? d1 : d0 + (d1 - d0) * (t - t0) / (t1 - t0); }
    return marks[marks.length - 1][0];
  };
  const short = span < 36 * 3600e3;
  const fmt = t => {
    if (mode === 'depth') return 'Hop ' + Math.round(t);
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('en-US', short ? { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { timeZone: 'UTC', month: 'short', day: 'numeric' });
  };

  const degree = new Map(all.map(n => [n.id, 0]));
  edges.forEach(e => { degree.set(e.source, degree.get(e.source) + 1); degree.set(e.target, degree.get(e.target) + 1); });
  const maxDeg = Math.max(1, ...degree.values());

  const N = all.map((n, i) => {
    const type = TYPE[n.type];
    const kind = iconKind({ id: n.id, type: n.type, label: n.label, raw: n });
    const k = kind.art === 'file' ? 'file' : kind.art;
    const sub = n.type === 'Account' ? (n.attrs?.bank ? 'Bank ' + n.attrs.bank : 'Account') : n.type === 'Document' ? 'Evidence document' : n.type === 'Case' ? 'Case file' : n.type;
    return {
      id: i, gid: n.id, raw: n, name: n.label || n.id, type, t: dayOfKnown(time.get(n.id)), time: time.get(n.id),
      w: Math.round((degree.get(n.id) / maxDeg) * 100), deg: degree.get(n.id), k, sub,
      g: n.type === 'Person' ? genderOf({ label: n.label, raw: n }) : null, flag: flagged.has(n.id), fileLabel: kind.fileLabel,
      x: 0, y: 0, vx: 0, vy: 0, z: dayOfKnown(time.get(n.id)) * DZ, photo: null, seed: hash(n.id)
    };
  });
  const idx = new Map(N.map(n => [n.gid, n]));
  const E = edges.map((e, i) => {
    const s = idx.get(e.source), t = idx.get(e.target);
    const et = toMs(e.attrs?.event_time);
    const day = et != null && mode === 'time' ? dayAt(et) : Math.max(s.t, t.t);
    return { s, t, type: edgeKind(e, s.type, t.type), time: day, when: et, label: edgeLabel(e), ph: ((i * 0.618) % 1), raw: e };
  });

  // the prototype's 2D force layout across x (and a scratch y), then y = entity layer
  N.forEach((n, j) => { n.x = Math.cos(j * 2.4) * 150; n.y = Math.sin(j * 2.4) * 150; });
  const iters = N.length > 120 ? 220 : 400;
  for (let k = 0; k < iters; k++) {
    for (const a of N) for (const b of N) if (a !== b) { const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1, f = 4000 / (d * d); a.vx += dx / d * f; a.vy += dy / d * f; }
    for (const e of E) { const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.hypot(dx, dy) || 1, f = (d - 130) * 0.012; e.s.vx += dx / d * f; e.s.vy += dy / d * f; e.t.vx -= dx / d * f; e.t.vy -= dy / d * f; }
    for (const n of N) { n.vx -= n.x * 0.01; n.vy -= n.y * 0.01; n.x += n.vx; n.y += n.vy; n.vx *= 0.8; n.vy *= 0.8; }
  }
  const spread = Math.max(1, ...N.map(n => Math.abs(n.x)));
  const fit = Math.min(1.1, (XW * 0.85) / spread);
  N.forEach(n => {
    n.x *= fit;
    // her height offset came from risk; here a small fixed jitter keeps one layer from lining up flat
    n.y = n.type === 'place' ? FY + BD[n.k === 'tower' || n.k === 'hub' || n.k === 'depot' ? n.k : 'hub'][2] + 46 : TIER[n.type] + ((n.seed % 100) - 50) * 0.35;
  });
  return { N, E, fmt, timeAt, mode, empty: !N.length };
}

/* ---------------- her renderer ---------------- */
export function startCorridor(root, world, { onPick, onLayout } = {}) {
  const $ = s => root.querySelector(s);
  const stage = $('.cc-stage'), cv = $('.cc-c'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { N, E, fmt, timeAt } = world;
  N.forEach(n => {
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const g = c.getContext('2d'); g.scale(1.5, 1.5);
    const col = NT[n.type].c;
    const bg = g.createLinearGradient(0, 0, 0, 128); bg.addColorStop(0, col + 'aa'); bg.addColorStop(1, '#0a1128'); g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    ICON[n.type === 'person' ? 'person' : n.k](g, { id: n.seed, name: n.name, g: n.g, role: null, fileLabel: n.fileLabel }, col);
    n.sprite = c;
  });

  let W = 0, H = 0, F = 1, sel = null, hov = null, playing = false, fly = null, sliding = false, sv = 0, raf = 0, over = false;
  const off = {}, offT = {};
  const cam = { x: 0, y: 30, z: -480, yaw: 0, pitch: 0 };
  const resize = () => {
    const r = stage.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); F = Math.min(W, H * 1.3);
    root.classList.toggle('cc-narrow', root.getBoundingClientRect().width < 900);
  };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  const toCam = p => { const dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch); const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy; return [x1, dy * cp - z1 * sp, dy * sp + z1 * cp]; };
  const pj = c => [W / 2 + c[0] * F / c[2], H / 2 - c[1] * F / c[2]];
  function seg(a, b) { let A = toCam(a), B = toCam(b); if (A[2] < NEAR && B[2] < NEAR) return; if (A[2] < NEAR) { const t = (NEAR - A[2]) / (B[2] - A[2]); A = A.map((v, i) => v + (B[i] - v) * t); } else if (B[2] < NEAR) { const t = (NEAR - B[2]) / (A[2] - B[2]); B = B.map((v, i) => v + (A[i] - v) * t); } const p = pj(A), q = pj(B); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
  const fog = z => Math.max(0.08, Math.min(1, 1 - (z - 500) / 1400)) * Math.min(1, Math.max(0, (z - NEAR) / 60));
  const R = n => 16 + n.w * 0.1;
  const non = n => !offT[n.type];
  const eon = e => !off[e.type] && non(e.s) && non(e.t);
  const nbr = n => E.filter(e => eon(e) && (e.s === n || e.t === n));
  let nbSet = null;
  const isNb = n => !sel || n === sel || nbSet.has(n);
  const subOf = n => (n.flag ? FLAG.n : n.sub);

  function shape(c, n, r) {
    const type = n.type; c.beginPath(); const P = (k, rad, o = 0) => [Math.cos(k + o) * rad, Math.sin(k + o) * rad];
    if (type === 'person') { for (let i = 0; i < 6; i++) { const [x, y] = P(i * Math.PI / 3, r, Math.PI / 6); if (i) c.lineTo(x, y); else c.moveTo(x, y); } }
    else if (type === 'device') { if (n.k === 'laptop') rrp(c, -r * 1.12, -r * 0.76, r * 2.24, r * 1.52, r * 0.12); else rrp(c, -r * 0.62, -r * 1.15, r * 1.24, r * 2.3, r * 0.2); }
    else if (type === 'account') { c.moveTo(-r, -r * 0.8); c.lineTo(r, -r * 0.8); c.lineTo(r, r * 0.1); c.quadraticCurveTo(r, r * 0.8, 0, r * 1.15); c.quadraticCurveTo(-r, r * 0.8, -r, r * 0.1); }
    else if (type === 'place') { c.arc(0, -r * 0.2, r * 0.85, Math.PI * 0.85, Math.PI * 0.15); c.lineTo(0, r * 1.3); c.lineTo(-r * 0.75, r * 0.45); }
    else { c.moveTo(-r * 1.15, -r * 0.95); c.lineTo(-r * 0.3, -r * 0.95); c.lineTo(-r * 0.08, -r * 0.7); c.lineTo(r * 1.15, -r * 0.7); c.lineTo(r * 1.15, r * 0.95); c.lineTo(-r * 1.15, r * 0.95); }
    c.closePath();
  }
  function curve(e, u) { const sag = e.type === 'comm' ? 50 : e.type === 'money' ? -60 : -20, m = (1 - u) * (1 - u), k = 2 * (1 - u) * u, q = u * u, cx = (e.s.x + e.t.x) / 2 + (e.ph - 0.5) * 90, cy = (e.s.y + e.t.y) / 2 + sag, cz = (e.s.z + e.t.z) / 2; return [m * e.s.x + k * cx + q * e.t.x, m * e.s.y + k * cy + q * e.t.y, m * e.s.z + k * cz + q * e.t.z]; }
  function drawEdge(e, now) {
    const c = ET[e.type].c, hot = !sel || e.s === sel || e.t === sel, mc = toCam(curve(e, 0.5)); if (mc[2] < NEAR) return;
    const a = fog(mc[2]) * (hot ? 0.95 : 0.07), s = F / mc[2];
    ctx.globalAlpha = a; ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, Math.min(4, s * 2.2)); ctx.setLineDash(ET[e.type].d.map(v => v * Math.max(0.5, Math.min(2, s * 2)))); ctx.shadowColor = c; ctx.shadowBlur = hot ? 10 : 0;
    ctx.beginPath(); let on = false; for (let i = 0; i <= 20; i++) { const cc = toCam(curve(e, i / 20)); if (cc[2] < NEAR) { on = false; continue; } const p = pj(cc); if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; } ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
    for (let k = 0; k < 2; k++) { const u = (now * 0.00022 + e.ph + k * 0.5) % 1, cc = toCam(curve(e, u)); if (cc[2] < NEAR) continue; const p = pj(cc); ctx.fillStyle = '#fff'; ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.5, Math.min(5, F / cc[2] * 3)), 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
    if (hot && (sel || mc[2] < 650)) { const p = pj(mc); ctx.font = '600 ' + Math.max(9, Math.min(14, s * 14)) + 'px sans-serif'; const w = ctx.measureText(e.label).width + 12; ctx.globalAlpha = a; ctx.fillStyle = '#070b16e6'; ctx.fillRect(p[0] - w / 2, p[1] - 9, w, 18); ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.fillText(e.label, p[0], p[1] + 4); }
    if (sel && hot) { ctx.globalAlpha = fog(mc[2]) * 0.3; ctx.setLineDash([3, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); let o2 = false; for (let i = 0; i <= 20; i++) { const q = curve(e, i / 20), cc = toCam([q[0], FY, q[2]]); if (cc[2] < NEAR) { o2 = false; continue; } const p = pj(cc); if (o2) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); o2 = true; } ctx.stroke(); ctx.setLineDash([]); }
    ctx.globalAlpha = 1;
  }
  function drawNode(n, now) {
    const c = NT[n.type].c, s = n.s, r = R(n) * s, dim = !isNb(n); ctx.save(); ctx.translate(n.sx, n.sy); ctx.globalAlpha = fog(n.cz) * (dim ? 0.15 : 1);
    ctx.lineWidth = Math.max(2, r * 0.12); ctx.strokeStyle = '#1b2a52'; ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, 7); ctx.stroke();
    // ring: share of the busiest entity's links (her prototype used a risk score, which the case data does not have)
    ctx.strokeStyle = n.flag ? FLAG.c : c; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, r * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.max(0.04, n.w / 100) * 6.283); ctx.stroke();
    if (n === sel) { const p = (now % 1600) / 1600; ctx.save(); ctx.globalAlpha *= (1 - p) * 0.7; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * (1.4 + p * 0.9), 0, 7); ctx.stroke(); ctx.restore(); }
    ctx.shadowColor = c; ctx.shadowBlur = n === hov || n === sel ? 40 : 18; shape(ctx, n, r); ctx.fillStyle = '#0a1128'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); shape(ctx, n, r); ctx.clip(); const k = r * 1.3, im = n.photo; if (im) { const w = im.naturalWidth, h = im.naturalHeight, m = Math.min(w, h); ctx.drawImage(im, (w - m) / 2, (h - m) / 2, m, m, -k, -k, 2 * k, 2 * k); } else ctx.drawImage(n.sprite, -k, -k, 2 * k, 2 * k); ctx.restore();
    shape(ctx, n, r); ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.stroke();
    if (n.flag) { const bx = r * 0.95, by = -r * 0.95, br = Math.max(6, r * 0.32); ctx.fillStyle = FLAG.c; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill(); ctx.strokeStyle = '#070b16'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#070b16'; ctx.font = '800 ' + br * 1.25 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FLAG.g, bx, by + 1); ctx.textBaseline = 'alphabetic'; }
    if (r > 9) {
      const ly = r * 1.3 + Math.max(13, r * 0.5); ctx.fillStyle = '#dbe4ff'; ctx.font = '600 ' + Math.max(9, Math.min(15, r * 0.42)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(n.name, 0, ly);
      if (r > 14) { ctx.fillStyle = '#7d8fc4'; ctx.font = '500 ' + Math.max(8, Math.min(12, r * 0.3)) + 'px sans-serif'; ctx.fillText(subOf(n), 0, ly + Math.max(11, r * 0.36)); }
    }
    ctx.restore();
  }
  function building(n, cz) {
    const [w, d, h] = BD[n.k] || BD.hub, x0 = n.x - w / 2, x1 = n.x + w / 2, z0 = n.z - d / 2, z1 = n.z + d / 2, y0 = FY, y1 = FY + h, a = fog(cz) * 0.6; ctx.strokeStyle = NT.place.c; ctx.lineWidth = 1.4; ctx.globalAlpha = a;
    const ring = y => { seg([x0, y, z0], [x1, y, z0]); seg([x1, y, z0], [x1, y, z1]); seg([x1, y, z1], [x0, y, z1]); seg([x0, y, z1], [x0, y, z0]); };
    ring(y0); ring(y1); [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(p => seg([p[0], y0, p[1]], [p[0], y1, p[1]]));
    if (n.k === 'tower') { ctx.globalAlpha = a * 0.4; for (let y = y0 + 16; y < y1; y += 16) ring(y); }
    if (n.k === 'hub') { const ry = y1 + 16; seg([x0, y1, z0], [n.x, ry, z0]); seg([x1, y1, z0], [n.x, ry, z0]); seg([x0, y1, z1], [n.x, ry, z1]); seg([x1, y1, z1], [n.x, ry, z1]); seg([n.x, ry, z0], [n.x, ry, z1]); }
    if (n.k === 'depot') { ctx.globalAlpha = a * 0.6; for (let i = 1; i < 3; i++) { const x = x0 + w * i / 3; seg([x, y0, z0], [x, y1, z0]); } }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  const STARS = Array.from({ length: 380 }, () => [(Math.random() - 0.5) * 3600, CE + 60 + Math.random() * 1300, -1500 + Math.random() * 4900, Math.random() * 1.6 + 0.4, Math.random() * 6.28, Math.random()]);
  const DUST = Array.from({ length: 140 }, () => [(Math.random() - 0.5) * XW * 2, FY + Math.random() * (CE - FY), -600 + Math.random() * 2900, Math.random() * 0.25 + 0.05]);
  function backdrop(now) {
    const hg = ctx.createLinearGradient(0, H * 0.35, 0, H * 0.8); hg.addColorStop(0, '#5b7cff00'); hg.addColorStop(0.55, '#5b7cff1a'); hg.addColorStop(1, '#5b7cff00'); ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    for (const st of STARS) { const cc = toCam([cam.x * 0.92 + st[0], st[1], cam.z * 0.92 + st[2]]); if (cc[2] < NEAR) continue; const p = pj(cc); if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue; const tw = 0.55 + 0.45 * Math.sin(now * 0.002 * (0.4 + st[5]) + st[4]); ctx.globalAlpha = Math.min(1, 0.18 + tw * 0.65) * Math.min(1, cc[2] / 300); ctx.fillStyle = st[5] > 0.8 ? '#ffd9a8' : st[5] > 0.5 ? '#a8c4ff' : '#ffffff'; const r = st[3] * (0.6 + 0.6 * Math.min(1, 600 / cc[2])); ctx.fillRect(p[0], p[1], r, r); }
    ctx.fillStyle = '#8fb4ff';
    for (const d of DUST) { d[1] += d[3]; if (d[1] > CE) d[1] = FY; const cc = toCam([d[0], d[1], d[2]]); if (cc[2] < NEAR) continue; const p = pj(cc); ctx.globalAlpha = fog(cc[2]) * 0.5; const r = Math.max(0.8, Math.min(3, F / cc[2] * 2.2)); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1; backdrop(now);
    for (let d = -8; d <= 33; d++) { ctx.strokeStyle = d % 5 ? '#16264a' : '#2b4688'; seg([-XW, FY, d * DZ], [XW, FY, d * DZ]); }
    ctx.strokeStyle = '#1b2f5c'; for (let x = -XW; x <= XW; x += 100) seg([x, FY, -600], [x, FY, 2300]);
    for (let d = 0; d <= 30; d += 5) { const cc = toCam([-XW - 40, FY, d * DZ]); if (cc[2] < NEAR) continue; const p = pj(cc); ctx.globalAlpha = fog(cc[2]); ctx.fillStyle = '#6f8fe0'; ctx.font = '600 ' + Math.max(8, Math.min(20, F / cc[2] * 16)) + 'px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(fmt(timeAt(d)), p[0], p[1]); ctx.globalAlpha = 1; }
    ctx.strokeStyle = '#1f3a78'; ctx.globalAlpha = 0.55; for (const sx of [-XW, XW]) { seg([sx, CE, -600], [sx, CE, 2300]); seg([sx, FY, -600], [sx, CE, -600]); }
    for (let d = 0; d <= 30; d += 5) { const z = d * DZ; seg([-XW, FY, z], [-XW, CE, z]); seg([-XW, CE, z], [XW, CE, z]); seg([XW, CE, z], [XW, FY, z]); } ctx.globalAlpha = 1;
    for (const [k, y, l] of TIERS) {
      if (!N.some(n => n.type === k)) continue;
      const col = NT[k].c; ctx.strokeStyle = col; ctx.globalAlpha = 0.22; ctx.setLineDash([6, 8]); seg([-XW, y, -600], [-XW, y, 2300]); seg([XW, y, -600], [XW, y, 2300]); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const lz = Math.max(-520, Math.min(2200, cam.z + 190)), cc = toCam([-XW - 10, y, lz]); if (cc[2] > NEAR) { const p = pj(cc); ctx.globalAlpha = Math.min(1, fog(cc[2]) + 0.2); ctx.fillStyle = col; ctx.font = '700 ' + Math.max(8, Math.min(15, F / cc[2] * 12)) + 'px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(l, p[0], p[1] + 4); ctx.globalAlpha = 1; }
    }
    if (sel) { const z = sel.z, c = NT[sel.type].c; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.shadowColor = c; ctx.shadowBlur = 12; seg([-XW, FY, z], [XW, FY, z]); seg([XW, FY, z], [XW, CE, z]); seg([XW, CE, z], [-XW, CE, z]); seg([-XW, CE, z], [-XW, FY, z]); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.lineWidth = 1; }
    const items = [];
    for (const n of N) {
      n.vis = false; if (!non(n)) continue;
      const cc = toCam([n.x, n.y, n.z]); n.cz = cc[2];
      if (n.type === 'place') building(n, Math.max(cc[2], NEAR + 60));
      if (cc[2] < NEAR) continue; const p = pj(cc); n.sx = p[0]; n.sy = p[1]; n.s = F / cc[2]; n.vis = true;
      const fc = toCam([n.x, FY, n.z]); if (fc[2] > NEAR) { const q = pj(fc), rr_ = R(n) * n.s * 1.2; ctx.globalAlpha = fog(cc[2]) * 0.2; ctx.fillStyle = NT[n.type].c; ctx.beginPath(); ctx.ellipse(q[0], q[1], rr_, rr_ * 0.25, 0, 0, 7); ctx.fill(); ctx.strokeStyle = NT[n.type].c; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      items.push({ z: cc[2], f: () => drawNode(n, now) });
    }
    for (const e of E) if (eon(e)) { const mc = toCam(curve(e, 0.5)); items.push({ z: mc[2], f: () => drawEdge(e, now) }); }
    items.sort((a, b) => b.z - a.z); items.forEach(i => i.f());
  }
  // top-down radar
  const mc_ = $('.cc-mini'), mx = mc_.getContext('2d');
  function mini() {
    const w = 560, h = 240, U = z => 14 + (z + 600) / 2900 * (w - 28), V = x => h / 2 + x / (XW * 1.3) * (h / 2 - 22);
    mx.clearRect(0, 0, w, h); mx.fillStyle = '#0b1222e6'; mx.fillRect(0, 0, w, h);
    mx.font = '600 14px sans-serif'; mx.fillStyle = '#7d8fc4'; mx.textAlign = 'left'; mx.fillText('TOP-DOWN RADAR · click to jump', 12, 20);
    mx.strokeStyle = '#1d2c52'; mx.lineWidth = 1; mx.font = '13px sans-serif'; mx.textAlign = 'center'; for (let d = 0; d <= 30; d += 5) { const u = U(d * DZ); mx.beginPath(); mx.moveTo(u, 28); mx.lineTo(u, h - 18); mx.stroke(); mx.fillStyle = '#4b62a0'; mx.fillText(fmt(timeAt(d)), u, h - 4); }
    for (const e of E) if (eon(e)) { mx.strokeStyle = ET[e.type].c; mx.globalAlpha = sel && e.s !== sel && e.t !== sel ? 0.08 : 0.45; mx.beginPath(); mx.moveTo(U(e.s.z), V(e.s.x)); mx.lineTo(U(e.t.z), V(e.t.x)); mx.stroke(); } mx.globalAlpha = 1;
    for (const n of N) {
      if (!non(n)) continue;
      const u = U(n.z), v = V(n.x), rad = 4 + n.w * 0.04; mx.fillStyle = NT[n.type].c; mx.globalAlpha = isNb(n) ? 1 : 0.25;
      if (n.type === 'place') mx.fillRect(u - rad, v - rad, rad * 2, rad * 2); else { mx.beginPath(); mx.arc(u, v, rad, 0, 7); mx.fill(); }
      if (n === sel) { mx.strokeStyle = '#fff'; mx.lineWidth = 2; mx.beginPath(); mx.arc(u, v, rad + 4, 0, 7); mx.stroke(); } mx.globalAlpha = 1;
    }
    const u = U(cam.z), v = V(cam.x); mx.fillStyle = '#5b7cff55'; mx.beginPath(); mx.moveTo(u, v); mx.arc(u, v, 70, cam.yaw - 0.6, cam.yaw + 0.6); mx.closePath(); mx.fill();
    mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(u, v, 5, 0, 7); mx.fill();
  }
  mc_.onclick = e => { const r = mc_.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * 560, py = (e.clientY - r.top) / r.height * 240; fly = { x: (py - 120) / 98 * XW * 1.3, z: (px - 14) / 532 * 2900 - 600 }; playing = false; setPlay(); };

  // input: only while the pointer is over the scene, so typing elsewhere in the app is untouched
  const keys = {};
  const cue = $('.cc-cue'), hideCue = () => { cue.style.opacity = 0; };
  const playBtn = $('.cc-play');
  const setPlay = () => { playBtn.textContent = playing ? '❚❚' : '▶'; };
  const onKeyDown = e => {
    if (!over || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '') && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'PageDown') { e.preventDefault(); sv += 26; }
    if (e.key === 'PageUp') { e.preventDefault(); sv -= 26; }
    if (/^Arrow/.test(e.key)) e.preventDefault();
    hideCue(); keys[e.key.toLowerCase()] = 1; fly = null; playing = false; setPlay();
  };
  const onKeyUp = e => { keys[e.key.toLowerCase()] = 0; };
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  function move() {
    const sp = keys.shift ? 9 : 3.5, fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    if (keys.w || keys.arrowup) { cam.x += fx * sp; cam.z += fz * sp; } if (keys.s || keys.arrowdown) { cam.x -= fx * sp; cam.z -= fz * sp; }
    if (keys.d || keys.arrowright) { cam.x += fz * sp; cam.z -= fx * sp; } if (keys.a || keys.arrowleft) { cam.x -= fz * sp; cam.z += fx * sp; }
    if (keys.e) cam.y += sp; if (keys.q) cam.y -= sp;
    if (sv) { cam.z += sv; sv *= 0.88; if (Math.abs(sv) < 0.05) sv = 0; }
    if (playing) { cam.z += 1.8; cam.x *= 0.98; cam.y += (40 - cam.y) * 0.02; cam.yaw *= 0.96; cam.pitch *= 0.96; if (cam.z > DZ * 32) { playing = false; setPlay(); } }
    if (fly) { let done = true; for (const k in fly) { const d = fly[k] - cam[k]; cam[k] += d * 0.07; if (Math.abs(d) > 0.5) done = false; } if (done) fly = null; }
    cam.z = Math.max(-600, Math.min(2300, cam.z)); cam.y = Math.max(FY + 20, Math.min(600, cam.y)); cam.x = Math.max(-900, Math.min(900, cam.x));
  }
  let drag = null, moved = 0;
  const hit = (x, y) => N.filter(n => n.vis && Math.hypot(n.sx - x, n.sy - y) < R(n) * n.s * 1.3).sort((a, b) => a.cz - b.cz)[0];
  const tip = $('.cc-tip');
  cv.onmousedown = e => { drag = { x: e.offsetX, y: e.offsetY }; moved = 0; cv.style.cursor = 'grabbing'; fly = null; };
  const onUp = () => { if (drag && moved < 4) { const n = hit(drag.x, drag.y); if (n) pick(n); else { sel = null; nbSet = null; panel(); } } drag = null; cv.style.cursor = 'grab'; };
  window.addEventListener('mouseup', onUp);
  cv.onmousemove = e => {
    if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; moved += Math.abs(dx) + Math.abs(dy); cam.yaw -= dx * 0.004; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + dy * 0.004)); drag.x = e.offsetX; drag.y = e.offsetY; }
    hov = hit(e.offsetX, e.offsetY);
    if (hov) { tip.style.display = 'block'; tip.style.left = e.offsetX + 16 + 'px'; tip.style.top = e.offsetY + 8 + 'px'; tip.textContent = `${hov.name} · ${subOf(hov)} · ${hov.deg} links`; } else tip.style.display = 'none';
  };
  stage.onmouseenter = () => { over = true; };
  stage.onmouseleave = () => { over = false; hov = null; tip.style.display = 'none'; };
  const onWheel = e => {
    // at either end of the timeline the page scrolls on as normal
    if (Math.abs(sv) < 0.5 && ((cam.z <= -599 && e.deltaY < 0) || (cam.z >= 2299 && e.deltaY > 0))) return;
    e.preventDefault(); fly = null; playing = false; setPlay(); sv = Math.max(-60, Math.min(60, sv + e.deltaY * 0.14)); hideCue();
  };
  stage.addEventListener('wheel', onWheel, { passive: false });
  cv.ondragover = e => e.preventDefault();
  cv.ondrop = e => { e.preventDefault(); const n = hit(e.offsetX, e.offsetY) || sel; if (n && e.dataTransfer.files[0]) { sel = n; photoFile(e.dataTransfer.files[0]); } };
  function photoFile(f) { if (!f || !sel || !/^image\//.test(f.type)) return; const target = sel; const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { target.photo = im; panel(); }; im.src = r.result; }; r.readAsDataURL(f); }
  function pick(n) { sel = n; nbSet = new Set(nbr(n).flatMap(e => [e.s, e.t])); fly = { x: n.x, y: n.y + 6, z: n.z - 260, yaw: 0, pitch: 0 }; playing = false; setPlay(); panel(); }

  // legend
  const legend = $('.cc-legend');
  const thumbs = t => { const seen = {}, out = []; N.filter(n => n.type === t).forEach(n => { const key = t === 'person' ? n.g : n.k; if (seen[key] || out.length >= 3) return; seen[key] = 1; out.push(`<img src="${n.sprite.toDataURL()}" alt="" style="width:24px;height:24px;border-radius:6px;border:1px solid ${NT[t].c}">`); }); return out.join(''); };
  function buildLegend() {
    const types = Object.entries(NT).filter(([k]) => N.some(n => n.type === k));
    const rels = Object.entries(ET).filter(([k]) => E.some(e => e.type === k));
    legend.innerHTML = '<h4>Entities (click to hide)</h4>' + types.map(([k, v]) => `<div class="cc-row${offT[k] ? ' off' : ''}" data-t="${k}" style="justify-content:space-between"><span style="color:${v.c}">${v.n}</span><span style="display:flex;gap:3px">${thumbs(k)}</span></div>`).join('')
      + '<h4>Relationships (click to filter)</h4>' + rels.map(([k, v]) => `<div class="cc-row${off[k] ? ' off' : ''}" data-k="${k}"><span class="cc-line" style="border-color:${v.c};border-top-style:${v.d.length ? (v.d[0] < 3 ? 'dotted' : 'dashed') : 'solid'}"></span>${v.n}</div>`).join('')
      + `<div class="cc-muted" style="margin-top:8px">Ring = share of links · Depth = time<br>Height = entity layer · Buildings = locations<br>Waves up = comms · Cables down = money<br>Badge: <span style="color:${FLAG.c}">! named in a finding</span></div>`;
  }
  legend.onclick = e => {
    const r = e.target.closest('.cc-row'); if (!r) return;
    if (r.dataset.k) off[r.dataset.k] = !off[r.dataset.k];
    if (r.dataset.t) offT[r.dataset.t] = !offT[r.dataset.t];
    if (sel && !non(sel)) { sel = null; nbSet = null; }
    if (sel) nbSet = new Set(nbr(sel).flatMap(x => [x.s, x.t]));
    buildLegend(); panel();
  };
  $('.cc-ticks').innerHTML = E.slice(0, 400).map(e => `<i style="left:${(e.time + 8) / 41 * 100}%;height:${8 + Math.round(e.time) % 3 * 3}px;background:${ET[e.type].c}"></i>`).join('');
  const range = $('.cc-range');
  range.oninput = e => { sliding = true; cam.z = +e.target.value * DZ; fly = null; playing = false; setPlay(); hideCue(); };
  range.onchange = () => { sliding = false; };
  function togglePlay() { playing = !playing; fly = null; sv = 0; if (playing && cam.z > DZ * 30) cam.z = -480; setPlay(); hideCue(); }
  playBtn.onclick = togglePlay;
  const sbar = $('.cc-sbar'), sthumb = $('.cc-sthumb');
  sbar.onclick = e => { const r = sbar.getBoundingClientRect(); fly = { z: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * DZ * 30 }; playing = false; sv = 0; setPlay(); hideCue(); };
  root.querySelectorAll('.cc-layout button').forEach(b => { b.onclick = () => onLayout?.(b.dataset.layout); });

  // side panel
  const pnl = $('.cc-panel');
  const src = n => (n.photo ? n.photo.src : n.sprite.toDataURL());
  const when = e => (e.when != null ? fmt(e.when) : fmt(timeAt(e.time)));
  function panel() {
    if (!sel) {
      const flaggedList = N.filter(n => n.flag && non(n));
      const top = (flaggedList.length ? flaggedList : [...N].filter(non).sort((a, b) => b.deg - a.deg)).slice(0, 4);
      const ev = E.filter(eon).sort((a, b) => a.time - b.time);
      pnl.innerHTML = `<h2>Case overview</h2><div class="cc-muted">You are inside the case. Walk forward to move through time; each entity type has its own layer. Click an entity to fly to it.</div><h4 class="cc-muted">${flaggedList.length ? 'NAMED IN FINDINGS' : 'MOST CONNECTED'}</h4>`
        + top.map(n => `<div class="cc-card" data-pick="${n.id}" style="display:flex;gap:10px;align-items:center"><img src="${src(n)}" width="38" alt="" style="border-radius:8px"><div><b style="color:${NT[n.type].c}">${esc(n.name)}</b><div class="cc-muted">${esc(subOf(n))} · ${n.deg} links</div></div></div>`).join('')
        + `<h4 class="cc-muted">STORY SO FAR (click to fly)</h4>`
        + ev.slice(0, 80).map(e => `<div class="cc-card" data-pick="${e.t.id}"><span style="color:${ET[e.type].c}">●</span> ${esc(e.label)}<div class="cc-muted">${esc(e.s.name)} → ${esc(e.t.name)} · ${esc(when(e))}</div></div>`).join('')
        + (ev.length > 80 ? `<div class="cc-muted">…and ${ev.length - 80} more. Walk forward to see them.</div>` : '');
      return;
    }
    const c = NT[sel.type].c, l = nbr(sel).sort((a, b) => a.time - b.time);
    pnl.innerHTML = `<img src="${src(sel)}" width="84" alt="" style="border-radius:14px;border:2px solid ${c};float:right"><h2>${esc(sel.name)}</h2><span class="cc-tag" style="color:${c};border-color:${c}">${esc(sel.sub)}</span> ${sel.flag ? `<span class="cc-tag" style="color:${FLAG.c};border-color:${FLAG.c}">${FLAG.g} ${FLAG.n}</span> ` : ''}<span class="cc-tag" style="color:#9fb0e0;border-color:#3a4d72">${sel.deg} links</span><p class="cc-muted">First seen ${esc(fmt(sel.time))} · ${l.length} connections</p><div class="cc-btn" data-sources="1">View sources</div><label class="cc-btn cc-btn-ghost">📷 Upload real photo<input type="file" accept="image/*" hidden></label><div class="cc-muted" style="margin-bottom:6px">(or drag an image onto the entity; it stays in this browser tab only)</div><h4 class="cc-muted">WHY IT'S CONNECTED (chronological)</h4>`
      + l.map(e => { const o = e.s === sel ? e.t : e.s; return `<div class="cc-card" data-pick="${o.id}"><span style="color:${ET[e.type].c}">● ${ET[e.type].n}</span><div>${esc(e.label)}</div><div class="cc-muted">${e.s === sel ? '→' : '←'} ${esc(o.name)} · ${esc(when(e))}</div></div>`; }).join('')
      + `<div class="cc-card" data-clear="1" style="text-align:center">✕ Clear selection</div>`;
    pnl.querySelector('input[type=file]').onchange = ev => photoFile(ev.target.files[0]);
  }
  pnl.onclick = e => {
    const p = e.target.closest('[data-pick]'); if (p) { pick(N[+p.dataset.pick]); return; }
    if (e.target.closest('[data-clear]')) { sel = null; nbSet = null; panel(); }
    if (e.target.closest('[data-sources]') && sel) onPick?.(sel.raw);
  };

  const dateEl = $('.cc-date'), cntEl = $('.cc-cnt');
  function loop(now) {
    move(); draw(now); mini();
    const d = Math.max(0, Math.min(30, cam.z / DZ));
    dateEl.textContent = fmt(timeAt(d));
    cntEl.textContent = N.filter(n => non(n) && n.z >= cam.z - 60).length + ' entities ahead';
    if (!sliding) range.value = cam.z / DZ;
    const pg = Math.max(0, Math.min(1, cam.z / (DZ * 30))); sthumb.style.top = 'calc(' + pg * 100 + '% - ' + pg * 36 + 'px)';
    raf = requestAnimationFrame(loop);
  }
  buildLegend(); panel(); raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect();
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('mouseup', onUp);
    stage.removeEventListener('wheel', onWheel);
  };
}
