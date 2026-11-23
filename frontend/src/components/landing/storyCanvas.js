/* Canvas renderer for the landing "story" graph (port of the GraphStory design prototype).
   Five phases driven by ctl.pt (0–5):
     0–1 documents appear · 1–2 entities lift out · 2–3 duplicates merge
     3–4 links draw in, one person bridges two cases · 4–5 a money loop lights up with its source rows.
   All names, accounts and amounts are synthetic. No React in here. */

const COL = ['#5AA9FF', '#F2B544', '#3DD6B5', '#A98BFF'];
const TYPE = ['PERSON', 'ACCOUNT', 'PHONE', 'PLACE'];
const CORAL = '#FF6B5B';

function buildStory() {
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const docs = [
    { name: 'transactions.csv', tag: 'CSV', col: '#F2B544', p: [-3.6, 1.7, 0.4] },
    { name: 'narrative_017.txt', tag: 'TXT', col: '#5AA9FF', p: [-1.3, 2.5, -0.8] },
    { name: 'call_log.csv', tag: 'CDR', col: '#3DD6B5', p: [1.3, 2.3, 0.2] },
    { name: 'history.json', tag: 'JSON', col: '#EDF2FA', p: [3.6, 1.2, -0.4] },
    { name: 'statement_0412.pdf', tag: 'PDF', col: CORAL, p: [0.2, -2.4, 0.6] }
  ];
  docs.forEach(d => { d.lines = [0.9, 0.7, 0.82, 0.55].map(w => w * (0.8 + rand() * 0.2)); });
  const CASES = [{ c: [-1.75, 0.05, 0], label: 'CASE 2025/114' }, { c: [1.75, -0.1, 0.2], label: 'CASE 2026/031' }];
  const PEOPLE = ['S. Kapoor', 'A. Iyer', 'N. Shah', 'P. Rao', 'K. Das', 'M. Khan', 'T. Bose', 'L. Pillai', 'D. Nair', 'R. Gupta', 'V. Sen', 'J. Thomas'];
  const CITIES = ['Pune', 'Nashik', 'Mumbai', 'Thane', 'Nagpur', 'Surat'];
  const docFor = [[1, 0], [0, 4], [2, 2], [3, 1]];
  const nodes = [];
  let pi = 0, ci = 0;
  const srcOf = d => docs[d].name + (docs[d].tag === 'TXT' ? ' · line ' : ' · row ') + (2 + Math.floor(rand() * 240));
  const sphere = r => { let x, y, z; do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while (x * x + y * y + z * z > 1); return [x * r, y * r * 0.85, z * r]; };
  const add = o => { o.s = rand(); nodes.push(o); return nodes.length - 1; };
  const pattern = [0, 1, 2, 0, 1, 3, 1, 0, 2, 1, 0, 3, 1, 2, 0, 1, 0, 2, 1, 3];
  for (let c = 0; c < 2; c++) {
    pattern.forEach(t => {
      const off = sphere(1.3), C = CASES[c].c;
      const d = docFor[t][Math.floor(rand() * 2)];
      const label = t === 0 ? PEOPLE[pi++ % PEOPLE.length] : t === 1 ? 'XX-' + (1000 + Math.floor(rand() * 9000)) : t === 2 ? '+91 98•• ••' + (10 + Math.floor(rand() * 89)) : CITIES[ci++ % CITIES.length];
      add({ t, c, label, cases: CASES[c].label, doc: d, src: srcOf(d), fin: [C[0] + off[0], C[1] + off[1], C[2] + off[2]] });
    });
  }
  const bridge = add({ t: 0, c: 2, label: 'Ravi Menon', cases: 'Both cases', doc: 1, src: 'narrative_017.txt · line 4', fin: [0, 0.2, 0.3], bridge: true });
  const loop = [
    add({ t: 1, c: 1, label: 'XX-7781', cases: CASES[1].label, doc: 4, src: 'statement_0412.pdf · p2 · row 12', fin: [0.95, 1.1, 0.5], loop: true }),
    add({ t: 1, c: 1, label: 'XX-2093', cases: CASES[1].label, doc: 4, src: 'statement_0412.pdf · p2 · row 14', fin: [2.6, 0.75, -0.2], loop: true }),
    add({ t: 1, c: 1, label: 'XX-5520', cases: CASES[1].label, doc: 4, src: 'statement_0412.pdf · p2 · row 19', fin: [1.7, -0.8, 0.7], loop: true })
  ];
  // Duplicates that merge in phase 3.
  [[bridge, 'R. Menon', 0], [2, null, 4], [24, null, 0], [10, null, 1]].forEach(([tw, lab, d]) => {
    const T = nodes[tw];
    add({ t: T.t, c: T.c, label: lab || T.label, cases: T.cases, doc: d, src: srcOf(d), fin: T.fin, dupOf: tw });
  });
  nodes.forEach(n => {
    const D = docs[n.doc].p;
    n.start = [D[0] + (rand() - 0.5) * 1.1, D[1] + (rand() - 0.5) * 0.5, D[2] + 0.05];
    const j = sphere(0.7);
    n.ext = [n.fin[0] * 1.3 + j[0], n.fin[1] * 1.3 + j[1], n.fin[2] * 1.3 + j[2]];
  });
  nodes.forEach((n, i) => {
    if (n.dupOf == null) return;
    const T = nodes[n.dupOf], o = sphere(1);
    n.ext = [T.ext[0] + o[0] * 0.9, T.ext[1] + o[1] * 0.9, T.ext[2] + o[2] * 0.9];
    T.hasDup = i;
  });
  const edges = [], seen = new Set();
  const link = (a, b) => { const k = a < b ? a + '-' + b : b + '-' + a; if (a === b || seen.has(k)) return; seen.add(k); edges.push({ a, b, s: rand() }); };
  const real = nodes.map((n, i) => i).filter(i => nodes[i].dupOf == null);
  const dist = (a, b) => Math.hypot(nodes[a].fin[0] - nodes[b].fin[0], nodes[a].fin[1] - nodes[b].fin[1], nodes[a].fin[2] - nodes[b].fin[2]);
  real.forEach(i => {
    if (nodes[i].bridge) return;
    real.filter(j => j !== i && nodes[j].c === nodes[i].c).sort((x, y) => dist(i, x) - dist(i, y)).slice(0, 2).forEach(j => link(i, j));
  });
  [0, 1].forEach(c => real.filter(j => nodes[j].c === c).sort((x, y) => dist(bridge, x) - dist(bridge, y)).slice(0, 3).forEach(j => link(bridge, j)));
  const nb = nodes.map(() => new Set());
  edges.forEach(e => { nb[e.a].add(e.b); nb[e.b].add(e.a); });
  for (let q = 0; q < 3; q++) { nb[loop[q]].add(loop[(q + 1) % 3]); nb[loop[(q + 1) % 3]].add(loop[q]); }
  const stars = []; for (let i = 0; i < 160; i++) stars.push([rand(), rand(), rand() * 1.1 + 0.3, rand() * 6.28]);
  return { docs, CASES, nodes, bridge, loop, edges, nb, stars };
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function sprite(col) {
  const sp = document.createElement('canvas'); sp.width = sp.height = 64;
  const g = sp.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, col + 'ff'); gr.addColorStop(0.3, col + '66'); gr.addColorStop(0.65, col + '18'); gr.addColorStop(1, col + '00');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return sp;
}

/**
 * Starts drawing into `cv`. `ctl` is shared with the React component:
 *   { pt, playing, hold, scrubAt, visible }. `onStep(i)` fires when the visible step changes.
 * Returns a cleanup function.
 */
export function startStory(cv, ctl, onStep, reduced) {
  const ctx = cv.getContext('2d');
  const { docs, CASES, nodes, bridge, loop, edges, nb, stars } = buildStory();
  const SP = COL.map(sprite), SPC = sprite(CORAL);

  let W = 0, H = 0, dpr = 1;
  const resize = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(cv);
  const ptr = { x: 0, y: 0, mx: -1, my: -1 };
  const onMove = e => { const r = cv.getBoundingClientRect(); ptr.mx = (e.clientX - r.left) * (W / r.width); ptr.my = (e.clientY - r.top) * (H / r.height); ptr.x = ptr.mx / W * 2 - 1; ptr.y = -(ptr.my / H * 2 - 1); };
  const onLeave = () => { ptr.mx = ptr.my = -1; ptr.x = ptr.y = 0; };
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerleave', onLeave);

  let p = ctl.pt, last = performance.now(), time = 0, ry = 0, rx = 0, lastStep = -1, raf = 0;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const pill = (x, y, text, col, bg) => {
    ctx.font = '500 11px "JetBrains Mono", monospace';
    const w = ctx.measureText(text).width + 22;
    x = clamp(x, w / 2 + 8, W - w / 2 - 8);
    rr(x - w / 2, y - 13, w, 26, 13); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5); ctx.textAlign = 'left';
  };

  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    if (!ctl.visible) return; // off screen: keep the loop alive but skip all work
    time += dt;
    // Autoplay only while idle: a scroll scrub in the last 2.5 s takes over.
    if (ctl.playing && now - ctl.scrubAt > 2500) {
      if (ctl.pt < 5) ctl.pt = Math.min(5, ctl.pt + dt / 3.6);
      else { ctl.hold += dt; if (ctl.hold > 6) { ctl.hold = 0; ctl.pt = 0; p = 0; } }
    }
    p += (ctl.pt - p) * Math.min(1, dt * 3.2);
    const P = reduced ? 5 : clamp(p, 0, 5);
    const si = Math.min(4, Math.floor(P));
    if (si !== lastStep) { lastStep = si; onStep(si); }

    if (!reduced) {
      ry += ((0.28 * Math.sin(time * 0.11) + ptr.x * 0.25) - ry) * 0.05;
      rx += ((0.1 * Math.sin(time * 0.08) + ptr.y * 0.14) - rx) * 0.05;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const st of stars) { ctx.globalAlpha = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(time * 1.2 + st[3])); ctx.fillStyle = '#C3CEDF'; ctx.fillRect(st[0] * W, st[1] * H, st[2], st[2]); }
    ctx.globalAlpha = 1;
    // Desktop: graph sits right of the caption. Narrow screens: caption on top, graph centred below.
    const narrow = W < 900;
    // Desktop: centre the graph in the free area right of the caption and size it to fit there.
    const left = narrow ? 0 : Math.min(W * 0.5, ctl.leftEdge || W * 0.36);
    const avail = W - left;
    const F = narrow ? Math.min(W * 1.05, H * 0.8) : Math.min(avail * 0.92, H * 1.2);
    const cx = narrow ? W * 0.5 : left + avail / 2, cy = narrow ? H * 0.54 : H * 0.46;
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
    const proj = v => {
      const x1 = v[0] * cY + v[2] * sY, z1 = -v[0] * sY + v[2] * cY;
      const y1 = v[1] * cX - z1 * sX, z2 = v[1] * sX + z1 * cX;
      const k = F / (z2 + 9);
      return [cx + x1 * k, cy - y1 * k, k, z2];
    };

    // Documents
    const fade = ease((P - 1.05) * 1.1);
    docs.forEach((d, i) => {
      const a = ease(P * 1.7 - i * 0.2) * (1 - 0.88 * fade);
      if (a < 0.01) return;
      const q = proj([d.p[0], d.p[1] + (1 - ease(P * 1.7 - i * 0.2)) * -0.6, d.p[2] - fade * 2.5]);
      const w = 1.55 * q[2], h = 0.95 * q[2], x = q[0] - w / 2, y = q[1] - h / 2;
      ctx.globalAlpha = a;
      rr(x, y, w, h, 10); ctx.fillStyle = 'rgba(19,30,53,0.92)'; ctx.fill(); ctx.strokeStyle = '#2F4266'; ctx.lineWidth = 1; ctx.stroke();
      const u = w / 160;
      ctx.font = `500 ${Math.max(8, 10 * u)}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(d.tag).width + 12 * u;
      rr(x + 10 * u, y + 10 * u, tw, 18 * u, 4 * u); ctx.fillStyle = d.col + '2a'; ctx.fill();
      ctx.fillStyle = d.col; ctx.textBaseline = 'middle'; ctx.fillText(d.tag, x + 16 * u, y + 19.5 * u);
      ctx.fillStyle = '#C3CEDF'; ctx.font = `500 ${Math.max(8, 11 * u)}px Inter, sans-serif`; ctx.fillText(d.name, x + 18 * u + tw, y + 19.5 * u);
      d.lines.forEach((lw, li) => { ctx.fillStyle = '#233350'; rr(x + 10 * u, y + (40 + li * 13) * u, (w - 20 * u) * lw, 6 * u, 3 * u); ctx.fill(); });
    });
    ctx.globalAlpha = 1;

    // Node positions
    const tr = ease(P - 4);
    const pos = nodes.map(n => {
      const e1 = ease((P - 1) * 1.5 - n.s * 0.5);
      let b = lerp3(n.start, n.ext, e1), a = e1, m = 0;
      if (n.dupOf != null) {
        m = ease((P - 2) * 1.5 - n.s * 0.4);
        b = lerp3(b, nodes[n.dupOf].ext, m);
        a *= 1 - clamp((m - 0.85) / 0.15);
      }
      const l = ease((P - 3) * 1.3 - n.s * 0.3);
      const v = lerp3(b, n.fin, l);
      const breathe = P >= 4.95 && !reduced ? 1 + 0.06 * Math.sin(time * 1.6 + n.s * 9) : 1;
      return { q: proj(v), a, m, breathe };
    });

    // Hover pick
    let hov = -1;
    if (ptr.mx >= 0) {
      let best = 18;
      nodes.forEach((n, i) => { if (pos[i].a < 0.6) return; const d = Math.hypot(pos[i].q[0] - ptr.mx, pos[i].q[1] - ptr.my); if (d < best) { best = d; hov = i; } });
    }
    cv.style.cursor = hov >= 0 ? 'pointer' : 'default';
    const focus = i => hov < 0 || i === hov || nb[hov].has(i);

    // Edges draw in
    ctx.lineWidth = 1;
    edges.forEach(e => {
      const d = clamp((P - 3) * 1.6 - e.s * 0.6);
      if (d <= 0) return;
      const A = pos[e.a].q, B = pos[e.b].q;
      const hot = hov >= 0 && (e.a === hov || e.b === hov);
      const br = nodes[e.a].bridge || nodes[e.b].bridge;
      let al = (br ? 0.55 : 0.3) * (1 - 0.5 * tr);
      if (hov >= 0) al = hot ? 0.9 : al * 0.25;
      ctx.globalAlpha = al;
      ctx.strokeStyle = hot ? '#EDF2FA' : (br ? '#5AA9FF' : COL[nodes[e.a].t]);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + (B[0] - A[0]) * d, A[1] + (B[1] - A[1]) * d); ctx.stroke();
    });
    // Money loop
    if (tr > 0) {
      ctx.globalAlpha = tr; ctx.strokeStyle = CORAL; ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 9]); ctx.lineDashOffset = reduced ? 0 : -time * 26;
      ctx.beginPath(); loop.forEach((li, q) => { const Q = pos[li].q; if (q) ctx.lineTo(Q[0], Q[1]); else ctx.moveTo(Q[0], Q[1]); }); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }

    // Nodes, back to front: glow pass then solid pass
    const order = nodes.map((n, i) => i).sort((a, b) => pos[b].q[3] - pos[a].q[3]);
    const radius = (n, o, i) => (n.bridge ? 0.12 : n.loop ? 0.1 : 0.065) * o.q[2] * o.breathe * (i === hov ? 1.5 : 1);
    ctx.globalCompositeOperation = 'lighter';
    order.forEach(i => {
      const n = nodes[i], o = pos[i]; if (o.a <= 0.01) return;
      const dim = n.loop || n.bridge ? 1 : 1 - 0.5 * tr;
      ctx.globalAlpha = o.a * dim * (focus(i) ? 1 : 0.18) * 0.55;
      const d = radius(n, o, i) * 3.6; ctx.drawImage(n.loop && tr > 0.5 ? SPC : SP[n.t], o.q[0] - d, o.q[1] - d, d * 2, d * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
    order.forEach(i => {
      const n = nodes[i], o = pos[i]; if (o.a <= 0.01) return;
      const dim = n.loop || n.bridge ? 1 : 1 - 0.5 * tr;
      ctx.globalAlpha = o.a * dim * (focus(i) ? 1 : 0.18);
      const r = Math.max(1.5, radius(n, o, i) * 0.75);
      ctx.fillStyle = COL[n.t]; ctx.beginPath(); ctx.arc(o.q[0], o.q[1], r, 0, 6.283); ctx.fill();
      if (n.loop && tr > 0) { ctx.globalAlpha = tr; ctx.strokeStyle = CORAL; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.q[0], o.q[1], r + 4, 0, 6.283); ctx.stroke(); }
    });
    // Merge flashes (teal = verified merge)
    nodes.forEach((n, i) => {
      if (n.dupOf == null) return;
      const m = pos[i].m;
      if (m > 0.7 && m < 1) { const T = pos[n.dupOf].q, k = (m - 0.7) / 0.3; ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#3DD6B5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(T[0], T[1], 6 + k * 26, 0, 6.283); ctx.stroke(); }
    });
    // Comet pulses on the loop
    if (tr > 0.05 && !reduced) {
      for (let q = 0; q < 3; q++) {
        for (let tail = 0; tail < 10; tail++) {
          const t = (((time - tail * 0.025) * 0.32 + q / 3) % 1 + 1) % 1, seg = Math.floor(t * 3), u = t * 3 - seg;
          const A = pos[loop[seg]].q, B = pos[loop[(seg + 1) % 3]].q;
          ctx.globalAlpha = tr * (1 - tail / 10) * 0.9; ctx.fillStyle = tail ? CORAL : '#FFE2DD';
          ctx.beginPath(); ctx.arc(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, 3.4 - tail * 0.25, 0, 6.283); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Labels
    const la = ease((P - 3.3) * 2) * (1 - 0.4 * tr);
    if (la > 0.01 && hov < 0) {
      CASES.forEach(C => { const q = proj([C.c[0], C.c[1] + 1.75, C.c[2]]); ctx.globalAlpha = la; pill(q[0], q[1], C.label, '#9DABC2', 'rgba(13,21,39,0.85)'); });
    }
    const ba = ease((P - 3.6) * 2);
    if (ba > 0.01 && hov < 0) { const q = pos[bridge].q; ctx.globalAlpha = ba; pill(q[0], q[1] + 34, 'APPEARS IN BOTH CASES', '#5AA9FF', 'rgba(13,21,39,0.9)'); }
    const merged = ease((P - 2.2) * 2) * (1 - ease((P - 3.2) * 2));
    if (merged > 0.01) { const q = pos[bridge].q; ctx.globalAlpha = merged; pill(q[0], q[1] - 30, 'R. MENON = RAVI MENON · SAME ACCOUNT', '#3DD6B5', 'rgba(13,21,39,0.9)'); }
    if (tr > 0.3 && hov < 0) { const q = pos[loop[1]].q; ctx.globalAlpha = ease((tr - 0.3) * 2); pill(q[0], q[1] - 32, 'POSSIBLE ROUTE · 3 HOPS · 9 DAYS', CORAL, 'rgba(13,21,39,0.92)'); }

    // Source card for the loop
    if (tr > 0.05) {
      const N = pos[loop[2]].q, w = 268, h = 128;
      let x = N[0] + 46, y = N[1] + 18 + (1 - tr) * 20;
      if (narrow) { x = (W - w) / 2; y = H - h - 150 + (1 - tr) * 20; } // phones: dock above the step buttons
      if (x + w > W - 12) x = Math.max(12, W - w - 12);
      if (y + h > H - 12) y = Math.max(12, N[1] - h - 30);
      ctx.globalAlpha = tr;
      ctx.strokeStyle = '#F2B544'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(N[0] + 8, N[1] + 4); ctx.lineTo(x, y + 24); ctx.stroke(); ctx.setLineDash([]);
      rr(x, y, w, h, 12); ctx.fillStyle = 'rgba(19,30,53,0.96)'; ctx.fill(); ctx.strokeStyle = '#2F4266'; ctx.stroke();
      ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#F2B544'; ctx.fillText('SOURCE', x + 14, y + 18);
      ctx.fillStyle = '#C3CEDF'; ctx.fillText('statement_0412.pdf · page 2', x + 70, y + 18);
      const rows = [['03-12', '7781 → 2093', '₹4,80,000'], ['03-16', '2093 → 5520', '₹4,62,000'], ['03-21', '5520 → 7781', '₹4,40,000']];
      rows.forEach((r, k) => {
        const ry2 = y + 42 + k * 26;
        if (k === 1) {
          ctx.globalAlpha = tr * (reduced ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 2.4)));
          rr(x + 8, ry2 - 11, w - 16, 22, 6); ctx.fillStyle = 'rgba(242,181,68,0.22)'; ctx.fill(); ctx.globalAlpha = tr;
        }
        ctx.fillStyle = k === 1 ? '#FFD483' : '#C3CEDF';
        ctx.fillText(r[0], x + 16, ry2); ctx.fillText(r[1], x + 74, ry2); ctx.fillText(r[2], x + 178, ry2);
      });
    }

    // Hover tooltip: the dot's source line
    if (hov >= 0) {
      const n = nodes[hov], q = pos[hov].q;
      const lines = [n.cases, 'Source: ' + n.src];
      ctx.font = '500 12px "JetBrains Mono", monospace';
      const w = Math.max(200, ...lines.map(t => ctx.measureText(t).width)) + 28, h = 92;
      let x = q[0] + 18, y = q[1] - h - 10; if (x + w > W - 16) x = q[0] - w - 18; if (x < 8) x = 8; if (y < 16) y = q[1] + 16;
      ctx.globalAlpha = 1; rr(x, y, w, h, 12); ctx.fillStyle = 'rgba(19,30,53,0.97)'; ctx.fill(); ctx.strokeStyle = COL[n.t]; ctx.lineWidth = 1; ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COL[n.t]; ctx.beginPath(); ctx.arc(x + 18, y + 20, 4, 0, 6.283); ctx.fill();
      ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillText(n.bridge ? 'PERSON · LINKS 2 CASES' : n.loop ? 'ACCOUNT · IN MONEY LOOP' : TYPE[n.t], x + 30, y + 20);
      ctx.fillStyle = '#EDF2FA'; ctx.font = '600 16px "Space Grotesk", sans-serif'; ctx.fillText(n.label, x + 14, y + 44);
      ctx.fillStyle = '#9DABC2'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillText(lines[0] + ' · ' + nb[hov].size + ' links', x + 14, y + 64);
      ctx.fillStyle = '#FFD483'; ctx.fillText(lines[1], x + 14, y + 80);
    }
    ctx.globalAlpha = 1;
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerleave', onLeave);
  };
}
