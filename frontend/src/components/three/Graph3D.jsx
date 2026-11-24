import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceZ } from 'd3-force-3d';
import { PanelRightClose, PanelRightOpen, RotateCcw, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { findMoneyLoops, edgeTime, groupKey, groupLabel, groupCentres } from './graphData';
import GraphPanel, { TimelineBar } from './GraphPanel';
import { iconTexture, typeThumb } from './entityIcons';
import CaseCorridor from './CaseCorridor';
import './graph3d-timeline.css';

// "Case File Night": each colour names one kind of entity, shared with the 2D GraphView
// and the landing scene. Coral is reserved for money that loops.
export const TYPES = {
  Person:       { color: '#5AA9FF', size: 3.2, shape: 'sphere' },
  Account:      { color: '#F2B544', size: 2.4, shape: 'box' },
  Phone:        { color: '#3DD6B5', size: 2.2, shape: 'sphere' },
  Location:     { color: '#A98BFF', size: 2.4, shape: 'sphere' },
  Case:         { color: '#EDF2FA', size: 4.6, shape: 'octa' },
  Organization: { color: '#C9C3E8', size: 2.8, shape: 'ico' },
  Transaction:  { color: '#8D87B3', size: 1.2, shape: 'sphere' },
  Document:     { color: '#4A5B7C', size: 1.8, shape: 'box' }
};
export const FALLBACK = { color: '#8D87B3', size: 2, shape: 'sphere' };
const LOOP = '#FF6B5B';
const EDGE_COLORS = {
  TRANSACTED_WITH: '#F2B544', SENT_FROM: '#F2B544', SENT_TO: '#F2B544', OWNS_ACCOUNT: '#5AA9FF',
  COMMUNICATED_WITH: '#3DD6B5', INVOLVED_IN_CASE: '#C9C3E8', LOCATED_AT: '#A98BFF',
  MENTIONED_IN: '#3A4D72', FILED_UNDER: '#3A4D72', RELATED_TO: '#5AA9FF'
};
const edgeColor = l => (l.loop ? LOOP : EDGE_COLORS[l.type] || '#3A4D72');
// Edges that carry something between entities: animated as moving particles.
const FLOW = { TRANSACTED_WITH: '#FFD27A', COMMUNICATED_WITH: '#7FF0D6', SENT_TO: '#FFD27A', SENT_FROM: '#FFD27A' };
const flowColor = l => (l.loop ? LOOP : FLOW[l.type]);
const DEFAULT_TYPES = { Person: true, Account: true, Case: true, Location: true, Organization: true, Phone: true, Transaction: false, Document: false };


const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();

function nodeScale(n) {
  const t = TYPES[n.type] || FALLBACK;
  return t.size * (1 + Math.min(n.degree, 24) * 0.045);
}
// Entities are drawn as Ayaana's icons (entityIcons.js); this is the sprite's size in world units.
const iconSize = n => Math.max(12, nodeScale(n) * 4.2);

/* Relationship lines bend like the prototype: calls arc up, money sags down, the rest dip a little.
   Each link gets a fixed sideways offset (l.ph) so parallel links fan out. */
const SAG = { COMMUNICATED_WITH: 16, TRANSACTED_WITH: -18, SENT_TO: -18, SENT_FROM: -18 };
function curvePoint(l, u, bend, out) {
  const a = l.source, b = l.target;
  const ax = a.x || 0, ay = a.y || 0, az = a.z || 0, bx = b.x || 0, by = b.y || 0, bz = b.z || 0;
  if (!bend) return out.set(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);
  const cx = (ax + bx) / 2 + ((l.ph ?? 0.5) - 0.5) * 30, cy = (ay + by) / 2 + (SAG[l.type] ?? -6), cz = (az + bz) / 2;
  const m = (1 - u) * (1 - u), k = 2 * (1 - u) * u, q = u * u;
  return out.set(m * ax + k * cx + q * bx, m * ay + k * cy + q * by, m * az + k * cz + q * bz);
}

// A link is hidden by the timeline when it has a date later than the cutoff.
const hiddenAt = (l, cutoff) => cutoff != null && l.time != null && l.time > cutoff;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ */
/* Timeline layout: depth (z) = time, height = entity layer.           */
/* ------------------------------------------------------------------ */
const LAYER_Y = { Case: 52, Person: 30, Organization: 16, Account: 0, Phone: -14, Transaction: -8, Document: -24, Location: -34 };
const LEAD = 80;            // how far in front of the camera the "current moment" sits
const CAM_START = -110;     // camera z at the very beginning of the timeline
const CORRIDOR_W = 170;     // half width of the time corridor
const FLOOR_Y = -60, CEIL_Y = 100;
const railRange = tl => [CAM_START, Math.max(CAM_START + 50, tl.L - 45)]; // stop short of the last events so they stay in view

const TIME_KEYS = ['event_time', 'filed_date', 'first_seen', 'start_time', 'timestamp', 'date'];
const toMs = v => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const firstTime = attrs => {
  for (const k of TIME_KEYS) { const t = toMs(attrs?.[k]); if (t != null) return t; }
  return null;
};

/* Works out when each entity was first seen. Transfers and calls carry a timestamp; entities
   with no date of their own take the earliest date among their neighbours. If a case has no
   dates at all, graph distance from the case node is used so the timeline still unfolds. */
function buildTimeline(graph) {
  const nodes = graph?.nodes || [], edges = graph?.edges || [];
  const time = new Map();
  const adj = new Map(nodes.map(n => [n.id, []]));
  const seen = (id, t) => { if (adj.has(id) && (!time.has(id) || t < time.get(id))) time.set(id, t); };
  nodes.forEach(n => { const t = firstTime(n.attrs); if (t != null) time.set(n.id, t); });
  edges.forEach(e => {
    adj.get(e.source)?.push(e.target); adj.get(e.target)?.push(e.source);
    const t = firstTime(e.attrs);
    if (t != null) { seen(e.source, t); seen(e.target, t); }
  });
  for (let round = 0; round < 4; round++) {
    let changed = false;
    nodes.forEach(n => {
      if (time.has(n.id)) return;
      const ts = adj.get(n.id).map(id => time.get(id)).filter(t => t != null);
      if (ts.length) { time.set(n.id, Math.min(...ts)); changed = true; }
    });
    if (!changed) break;
  }

  let mode = 'time';
  if (new Set(time.values()).size < 2) {
    mode = 'depth'; time.clear();
    const roots = nodes.filter(n => n.type === 'Case').map(n => n.id);
    if (!roots.length && nodes.length) roots.push([...nodes].sort((a, b) => adj.get(b.id).length - adj.get(a.id).length)[0].id);
    roots.forEach(r => time.set(r, 0));
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift();
      adj.get(id).forEach(nb => { if (!time.has(nb)) { time.set(nb, time.get(id) + 1); queue.push(nb); } });
    }
  }
  const known = nodes.map(n => time.get(n.id)).filter(t => t != null).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  nodes.forEach(n => { if (!time.has(n.id)) time.set(n.id, median); });

  const all = nodes.map(n => time.get(n.id)).sort((a, b) => a - b);
  const min = all[0] ?? 0, max = all[all.length - 1] ?? 0, span = max - min;
  const L = Math.min(900, Math.max(260, nodes.length * 7));
  // Half real time, half order of events: bursts of activity on one day stay readable.
  const rankOf = new Map();
  all.forEach((t, i) => { if (!rankOf.has(t)) rankOf.set(t, i); });
  const denom = Math.max(1, all.length - 1);
  const z = new Map(), byTime = new Map();
  nodes.forEach(n => {
    const t = time.get(n.id);
    const lin = span ? (t - min) / span : 0;
    const zz = L * (0.5 * lin + 0.5 * (rankOf.get(t) / denom));
    z.set(n.id, zz); byTime.set(t, zz);
  });
  const marks = [...byTime].map(([t, zz]) => [zz, t]).sort((a, b) => a[0] - b[0]);
  return { z, time, L, marks, mode, span };
}

function timeAtZ(tl, z) {
  const m = tl.marks;
  if (!m.length) return 0;
  if (z <= m[0][0]) return m[0][1];
  for (let i = 1; i < m.length; i++) {
    if (z <= m[i][0]) {
      const [z0, t0] = m[i - 1], [z1, t1] = m[i];
      return z1 === z0 ? t1 : t0 + ((t1 - t0) * (z - z0)) / (z1 - z0);
    }
  }
  return m[m.length - 1][1];
}

function fmtTime(t, tl) {
  if (tl.mode === 'depth') return 'Hop ' + Math.round(t);
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return '';
  const short = tl.span < 36 * 3600e3;
  const opts = short
    ? { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' };
  return d.toLocaleString('en-GB', opts) + (short ? ' UTC' : '');
}

/* Every entity as a camera-facing icon (Ayaana's artwork): ring = share of the busiest entity's
   links (coral when a finding names it), "!" badge = named in a finding. */
function IconLayer({ nodes, focus, hoveredId, onHover, onPick, flagged, maxDegree, minFrac = 0 }) {
  const refs = useRef([]);
  // minFrac keeps icons readable when the camera is far away (Network view): never smaller than
  // that share of the distance to the camera, so they stay about the same size on screen.
  useFrame(({ camera }) => {
    nodes.forEach((n, i) => {
      const s = refs.current[i];
      if (!s) return;
      s.position.set(n.x || 0, n.y || 0, n.z || 0);
      const k = Math.max(iconSize(n), minFrac ? camera.position.distanceTo(s.position) * minFrac : 0) * (n.id === hoveredId ? 1.3 : 1);
      s.scale.set(k, k, 1);
    });
  });
  return nodes.map((n, i) => {
    const lit = !focus || focus.has(n.id);
    const tex = iconTexture(n, (TYPES[n.type] || FALLBACK).color, { ring: n.degree / maxDegree, flagged: flagged.has(n.id) });
    return (
      <sprite key={n.id} ref={el => { refs.current[i] = el; }}
        onClick={e => { e.stopPropagation(); if (e.delta > 6) return; onPick(n); }}
        onPointerMove={e => { e.stopPropagation(); onHover(n); }}
        onPointerOut={() => onHover(null)}>
        <spriteMaterial map={tex} transparent alphaTest={0.03} depthWrite={false} toneMapped={false} fog={!minFrac}
          opacity={lit ? 1 : 0.13} color={n.id === hoveredId ? '#ffffff' : '#c8c8c8'} />
      </sprite>
    );
  });
}

/* All relationships as one line batch. `litLinks` (indices) overrides node-based focus,
   `currentLink` is the hop being traced, `cutoff` hides links dated after it. */
function Edges({ links, focus, litLinks, currentLink, cutoff, bend = false }) {
  const SEG = bend ? 12 : 1;           // line pieces per link
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * SEG * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(links.length * SEG * 6), 3));
    return g;
  }, [links, SEG]);

  useLayoutEffect(() => {
    const col = geo.attributes.color.array;
    const dimmed = Boolean(litLinks || focus);
    links.forEach((l, k) => {
      const lit = litLinks ? litLinks.has(k)
        : !focus || (focus.has(l.source.id ?? l.source) && focus.has(l.target.id ?? l.target));
      const boost = k === currentLink ? 3 : lit ? (dimmed ? 1.6 : 0.9) : 0.07;
      tmpC.set(edgeColor(l)).multiplyScalar(boost);
      for (let j = 0; j < SEG * 2; j++) tmpC.toArray(col, (k * SEG * 2 + j) * 3);
    });
    geo.attributes.color.needsUpdate = true;
  }, [geo, links, focus, litLinks, currentLink, SEG]);

  useFrame(() => {
    const pos = geo.attributes.position.array;
    links.forEach((l, k) => {
      // Collapsing a link onto its source hides it without rebuilding the batch.
      const hide = hiddenAt(l, cutoff);
      for (let j = 0; j < SEG; j++) {
        const o = (k * SEG + j) * 6;
        curvePoint(l, hide ? 0 : j / SEG, bend, tmpV).toArray(pos, o);
        curvePoint(l, hide ? 0 : (j + 1) / SEG, bend, tmpV).toArray(pos, o + 3);
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  });

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.55} toneMapped={false} />
    </lineSegments>
  );
}

/* Glowing particles travelling along money and communication links. */
function FlowParticles({ links, focus, litLinks, cutoff, bend = false }) {
  const ref = useRef();
  const per = 2;
  const flows = useMemo(() => links.map((l, k) => ({ l, k })).filter(({ l }) => flowColor(l)), [links]);
  const phase = useMemo(() => flows.flatMap((_, i) => Array.from({ length: per }, (_, j) => ((i * 0.37) + j / per) % 1)), [flows]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach(({ l, k }, i) => {
      const lit = litLinks ? litLinks.has(k) : !focus || (focus.has(l.source.id) && focus.has(l.target.id));
      for (let j = 0; j < per; j++) mesh.setColorAt(i * per + j, tmpC.set(flowColor(l)).multiplyScalar(lit ? (bend ? 1.4 : 3) : 0.1));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flows, focus, litLinks, bend]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach(({ l }, i) => {
      const hide = hiddenAt(l, cutoff);
      // SENT_FROM points transaction -> account, so money moves target -> source.
      const back = l.type === 'SENT_FROM';
      for (let j = 0; j < per; j++) {
        const k = i * per + j;
        phase[k] = (phase[k] + dt * 0.35) % 1;
        curvePoint(l, back ? 1 - phase[k] : phase[k], bend, tmpV);
        const s = hide ? 0 : bend ? 0.4 : 0.75;
        tmpM.makeScale(s, s, s).setPosition(tmpV);
        mesh.setMatrixAt(k, tmpM);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!flows.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, flows.length * per]} raycast={() => null}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* Soft translucent region around each group, following its members as they move.
   Sized to the bulk of the group (not its farthest outlier) and drawn from the inside
   (BackSide) so it never blocks the view when the camera flies into it.
   Neutral colour on purpose: in this palette hue already means entity type. */
function GroupRegions({ groups, active }) {
  const meshes = useRef([]);
  useFrame(() => {
    groups.forEach((g, i) => {
      const m = meshes.current[i];
      if (!m) return;
      let x = 0, y = 0, z = 0;
      g.members.forEach(n => { x += n.x || 0; y += n.y || 0; z += n.z || 0; });
      const c = g.members.length || 1;
      x /= c; y /= c; z /= c;
      const d = g.members.map(n => Math.hypot((n.x || 0) - x, (n.y || 0) - y, (n.z || 0) - z)).sort((a, b) => a - b);
      const r = Math.min(d[d.length - 1] || 0, (d[Math.floor(d.length * 0.75)] || 0) * 1.3) + 6;
      g.centre = { x, y, z, r };
      m.position.set(x, y, z);
      m.scale.setScalar(r);
    });
  });
  return groups.map((g, i) => (
    <mesh key={g.key} ref={el => { meshes.current[i] = el; }} raycast={() => null}>
      <sphereGeometry args={[1, 32, 24]} />
      <meshBasicMaterial color={active === g.key ? '#5AA9FF' : '#C9C3E8'} transparent side={THREE.BackSide}
        opacity={active === g.key ? 0.07 : 0.025} depthWrite={false} toneMapped={false} />
    </mesh>
  ));
}

/* Projects label anchors to screen space each frame and moves plain DOM nodes,
   so labels track the physics without React re-renders or nested roots. */
function LabelProjector({ items, els }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    items.forEach(item => {
      const el = els.current[item.key];
      if (!el) return;
      if (item.node) v.set(item.node.x || 0, (item.node.y || 0) + iconSize(item.node) * 0.55 + 1, item.node.z || 0);
      else if (item.group?.centre) v.set(item.group.centre.x, item.group.centre.y + item.group.centre.r, item.group.centre.z);
      else return;
      v.project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.opacity = visible ? '' : '0';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    });
  });
  return null;
}

/* Runs the physics, fits the camera once it settles, and flies to a focused node. */
function Rig({ sim, nodes, flyTo, fitToken, autoRotate, closeness = 70, rightInset = 0, navRef, setFitToken }) {
  const { camera, controls, size } = useThree();

  // Centre the picture in the area not covered by the side panel.
  useEffect(() => {
    if (rightInset > 0 && size.width > rightInset * 1.6) camera.setViewOffset(size.width, size.height, rightInset / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, rightInset]);
  const fit = useRef({ token: -1, frames: 0, settled: true });
  const aim = useRef(null);

  useEffect(() => { aim.current = flyTo ? { node: flyTo, frames: 55 } : null; }, [flyTo]);

  useEffect(() => {
    if (!navRef) return;
    navRef.current = {
      pan: (dx, dy) => {
        if (!controls) return;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());
        const factor = Math.max(0.06, camera.position.distanceTo(controls.target) * 0.002);
        const move = new THREE.Vector3().addScaledVector(right, dx * factor).addScaledVector(up, dy * factor);
        camera.position.add(move);
        controls.target.add(move);
        controls.update();
      },
      zoom: factor => {
        if (!controls) return;
        camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).multiplyScalar(factor));
        controls.update();
      },
      reset: () => setFitToken?.(token => token + 1),
    };
    return () => { navRef.current = {}; };
  }, [camera, controls, navRef, setFitToken]);

  useFrame(() => {
    if (sim.alpha() > sim.alphaMin()) sim.tick();
    if (!controls) return;
    controls.autoRotate = autoRotate && !aim.current;

    const early = fit.current.token !== fitToken && (++fit.current.frames > 40 || sim.alpha() < 0.2);
    const settledNow = fit.current.token === fitToken && !fit.current.settled && sim.alpha() < 0.03 && !aim.current && autoRotate; // skip if the user has moved the camera
    if (nodes.length && (early || settledNow)) {
      {
        const box = new THREE.Box3();
        nodes.forEach(n => box.expandByPoint(tmpV.set(n.x || 0, n.y || 0, n.z || 0)));
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 30);
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0.35, 0.25, 1).normalize().multiplyScalar(radius * 2.3));
        camera.far = radius * 20; camera.updateProjectionMatrix();
        fit.current = { token: fitToken, frames: 0, settled: settledNow };
      }
    }

    if (aim.current) {
      const { node } = aim.current;
      const target = tmpV.set(node.x || 0, node.y || 0, node.z || 0);
      controls.target.lerp(target, 0.12);
      const offset = camera.position.clone().sub(controls.target).setLength(closeness);
      camera.position.lerp(target.clone().add(offset), 0.08);
      if (--aim.current.frames <= 0) aim.current = null;
    }
    controls.update();
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Timeline camera: scroll, keys, drag-to-look, slider and autoplay.   */
/* All input only changes the `rail` object; this component flies the  */
/* camera along it and writes the date / counter straight into the DOM. */
/* ------------------------------------------------------------------ */
function TimelineRig({ tl, sim, nodes, rail, ui, flyTo, resetToken, onPlayState, rightInset = 0 }) {
  const { camera, gl, size } = useThree();
  const tlRef = useRef(tl); tlRef.current = tl;
  const keys = useRef({});
  const hover = useRef(false);
  const shown = useRef({ label: '', ahead: -1 });

  useEffect(() => {
    camera.near = 0.5; camera.far = tl.L + 3500; camera.updateProjectionMatrix();
  }, [camera, tl.L]);
  // Centre the picture in the area not covered by the details panel (same as the Network layout).
  useEffect(() => {
    if (rightInset > 0 && size.width > rightInset * 1.6) camera.setViewOffset(size.width, size.height, rightInset / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, rightInset]);

  const home = () => {
    const r = rail.current;
    r.z = r.tz = CAM_START; r.vz = 0; r.x = r.tx = 0; r.y = r.ty = 12; r.yaw = r.pitch = 0;
  };
  useEffect(() => { home(); rail.current.playing = false; onPlayState(false); }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!resetToken) return;
    const r = rail.current;
    r.tz = CAM_START; r.tx = 0; r.ty = 12; r.yaw = r.pitch = 0; r.vz = 0;
  }, [resetToken, rail]);
  useEffect(() => {
    if (!flyTo) return;
    const r = rail.current, [a, b] = railRange(tlRef.current);
    r.tz = clamp(flyTo.z - 60, a, b); r.tx = flyTo.x; r.ty = flyTo.y + 8; r.yaw = r.pitch = 0;
    r.playing = false; onPlayState(false);
  }, [flyTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = gl.domElement, r = rail.current;
    const hideCue = () => ui.current.cue?.classList.add('gone');

    const onWheel = e => {
      const [a, b] = railRange(tlRef.current);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const settled = Math.abs(r.vz) < 0.5;
      // at either end, let the page scroll on as normal
      if (settled && ((r.tz <= a + 0.5 && dy < 0) || (r.tz >= b - 0.5 && dy > 0))) return;
      e.preventDefault();
      r.playing = false; onPlayState(false);
      r.vz = clamp(r.vz + dy * 0.02, -9, 9); // ~17 world units per wheel notch, with inertia
      hideCue();
    };
    const onDown = e => { if (e.button === 0) r.drag = { x: e.clientX, y: e.clientY }; };
    const onMove = e => {
      if (!r.drag) return;
      r.yaw = clamp(r.yaw + (e.clientX - r.drag.x) * 0.004, -1.1, 1.1);
      r.pitch = clamp(r.pitch + (e.clientY - r.drag.y) * 0.003, -0.6, 0.6);
      r.drag = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { r.drag = null; };
    const onEnter = () => { hover.current = true; };
    const onLeave = () => { hover.current = false; };
    const onKey = e => {
      if (!hover.current || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
      if (e.code === 'Space') {
        e.preventDefault(); r.playing = !r.playing;
        if (r.playing) { const [a, b] = railRange(tlRef.current); if (r.tz >= b - 1) r.tz = a; } // replay from the start
        onPlayState(r.playing); hideCue(); return;
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      keys.current[e.code] = true; hideCue();
    };
    const onKeyUp = e => { keys.current[e.code] = false; };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, rail, ui, onPlayState]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (sim.alpha() > sim.alphaMin()) sim.tick();
    const r = rail.current, k = keys.current, T = tlRef.current, [a, b] = railRange(T);

    const sp = (k.ShiftLeft || k.ShiftRight ? 170 : 70) * dt;
    if (k.KeyW || k.ArrowUp) { r.tz += sp; if (r.playing) { r.playing = false; onPlayState(false); } }
    if (k.KeyS || k.ArrowDown) { r.tz -= sp; if (r.playing) { r.playing = false; onPlayState(false); } }
    if (k.KeyA || k.ArrowLeft) r.tx += sp * 0.6;
    if (k.KeyD || k.ArrowRight) r.tx -= sp * 0.6;
    if (k.KeyQ) r.ty -= sp * 0.5;
    if (k.KeyE) r.ty += sp * 0.5;
    if (r.playing) {
      r.tz += ((b - a) / 28) * dt;
      if (r.tz >= b) { r.tz = b; r.playing = false; onPlayState(false); }
    }
    r.tz += r.vz; r.vz *= 0.88; if (Math.abs(r.vz) < 0.02) r.vz = 0;
    r.tz = clamp(r.tz, a, b); r.tx = clamp(r.tx, -400, 400); r.ty = clamp(r.ty, FLOOR_Y + 8, CEIL_Y + 200);

    const ease = 1 - Math.exp(-dt * 6);
    r.z += (r.tz - r.z) * ease; r.x += (r.tx - r.x) * ease; r.y += (r.ty - r.y) * ease;
    camera.position.set(r.x, r.y, r.z);
    const cp = Math.cos(r.pitch);
    camera.lookAt(r.x + Math.sin(r.yaw) * cp * 100, r.y + Math.sin(r.pitch) * 100, r.z + Math.cos(r.yaw) * cp * 100);

    // heads-up display, written directly to the DOM (no React re-render per frame)
    const U = ui.current, focus = r.z + LEAD;
    const text = fmtTime(timeAtZ(T, focus), T);
    if (U.date && text !== shown.current.label) { shown.current.label = text; U.date.textContent = text; }
    if (U.slider && !r.sliding) U.slider.value = String(Math.round(clamp((r.z - a) / (b - a), 0, 1) * 1000));
    let ahead = 0;
    for (const n of nodes) if (n.fz > focus) ahead++;
    if (U.ahead && ahead !== shown.current.ahead) { shown.current.ahead = ahead; U.ahead.textContent = ahead + ' entities ahead'; }
  });
  return null;
}

/* Floor grid, time gates and rails: the corridor the timeline runs through. */
function Corridor({ L }) {
  const grid = useRef();
  const { rings, rails } = useMemo(() => {
    const W = CORRIDOR_W, y0 = FLOOR_Y, y1 = CEIL_Y, step = L / 12, z0 = -step * 2, z1 = L + step * 3;
    const rings = [], rails = [];
    for (let z = z0; z <= z1; z += step) rings.push(-W, y0, z, W, y0, z, W, y0, z, W, y1, z, W, y1, z, -W, y1, z, -W, y1, z, -W, y0, z);
    [[-W, y0], [W, y0], [W, y1], [-W, y1]].forEach(([x, y]) => rails.push(x, y, z0, x, y, z1));
    return { rings: new Float32Array(rings), rails: new Float32Array(rails) };
  }, [L]);
  useEffect(() => {
    const m = grid.current?.material;
    (Array.isArray(m) ? m : [m]).filter(Boolean).forEach(x => { x.transparent = true; x.opacity = 0.5; x.toneMapped = false; });
  }, [L]);
  const size = L + 1600;
  return (
    <group>
      <gridHelper ref={grid} args={[size, Math.round(size / 28), '#1c3aa8', '#10205a']} position={[0, FLOOR_Y, L / 2]} />
      <lineSegments>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[rings, 3]} /></bufferGeometry>
        <lineBasicMaterial color="#3f64ff" transparent opacity={0.26} toneMapped={false} />
      </lineSegments>
      <lineSegments>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[rails, 3]} /></bufferGeometry>
        <lineBasicMaterial color="#4d6dff" transparent opacity={0.32} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/* Date labels standing on the floor along the corridor. */
function TickLabels({ ticks, els }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    ticks.forEach(({ key, z }) => {
      const el = els.current[key];
      if (!el) return;
      v.set(-CORRIDOR_W, FLOOR_Y + 1, z).project(camera);
      const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.opacity = visible ? '' : '0';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    });
  });
  return null;
}

/* Background: a deep gradient sky, soft aurora glows, drifting dust and stars.
   Everything follows the camera, so it works in both Timeline and Network layouts. */
function Backdrop() {
  const dome = useRef(), sky = useRef(), starsRef = useRef(), dust = useRef();
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#3a2a8f') }, mid: { value: new THREE.Color('#101c4a') }, bot: { value: new THREE.Color('#04060f') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5; vec3 c = h > 0.5 ? mix(mid, top, (h - 0.5) * 2.0) : mix(bot, mid, h * 2.0); gl_FragColor = vec4(c, 1.0); }'
  }), []);
  const glowTex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const glows = useMemo(() => [
    { dir: [-0.55, 0.45, 0.7], color: '#5b3fe0', s: 0.8 }, { dir: [0.75, 0.15, 0.65], color: '#1a8fd6', s: 0.7 },
    { dir: [0.05, 0.85, -0.5], color: '#c02a8c', s: 0.65 }, { dir: [-0.6, 0.2, -0.75], color: '#2f56d9', s: 0.7 }
  ], []);
  const DUST = 420;
  const dustPos = useMemo(() => {
    const a = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) { a[i * 3] = (Math.random() - 0.5) * 260; a[i * 3 + 1] = (Math.random() - 0.5) * 160; a[i * 3 + 2] = (Math.random() - 0.5) * 260; }
    return a;
  }, []);

  useFrame(({ camera, clock }, delta) => {
    const R = Math.max(80, camera.far * 0.45);
    if (dome.current) { dome.current.position.copy(camera.position); dome.current.scale.setScalar(R); }
    if (sky.current) {
      sky.current.position.copy(camera.position);
      sky.current.children.forEach((s, i) => {
        const g = glows[i];
        s.position.set(g.dir[0] * R * 0.9, g.dir[1] * R * 0.9, g.dir[2] * R * 0.9);
        s.scale.setScalar(R * g.s);
        s.material.opacity = 0.3 + Math.sin(clock.elapsedTime * 0.3 + i * 1.7) * 0.08;
      });
    }
    if (starsRef.current) starsRef.current.position.copy(camera.position);
    if (dust.current) {
      dust.current.position.copy(camera.position);
      const arr = dust.current.geometry.attributes.position.array, dt = Math.min(delta, 0.05);
      for (let i = 0; i < DUST; i++) { arr[i * 3 + 1] += dt * 3; if (arr[i * 3 + 1] > 80) arr[i * 3 + 1] = -80; }
      dust.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      <mesh ref={dome} renderOrder={-100} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 20]} />
        <primitive object={material} attach="material" />
      </mesh>
      <group ref={sky}>
        {glows.map((g, i) => (
          <sprite key={i} renderOrder={-90}>
            <spriteMaterial map={glowTex} color={g.color} transparent depthWrite={false} blending={THREE.AdditiveBlending}
              fog={false} toneMapped={false} opacity={0.3} />
          </sprite>
        ))}
      </group>
      <group ref={starsRef}>
        <Stars radius={900} depth={200} count={2500} factor={18} fade speed={0.3} />
      </group>
      <points ref={dust} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[dustPos, 3]} /></bufferGeometry>
        <pointsMaterial size={1.3} color="#8fb4ff" transparent opacity={0.5} depthWrite={false}
          blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation fog={false} />
      </points>
    </>
  );
}

export default function Graph3D({ graph, analysis, onSelect, height = '650px', focusId = null }) {
  const [enabled, setEnabled] = useState(DEFAULT_TYPES);
  const [showFlow, setShowFlow] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [dragMode, setDragMode] = useState('orbit');
  const [hovered, setHovered] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [fitToken, setFitToken] = useState(0);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900);
  const [panelTab, setPanelTab] = useState('entity');
  const hasCommunities = Boolean(analysis?.metrics && Object.keys(analysis.metrics).length);
  const [groupMode, setGroupMode] = useState('none');
  const [activeGroup, setActiveGroup] = useState(null);
  const [trace, setTrace] = useState(null);            // { loop, step, playing }
  const [timeline, setTimeline] = useState({ on: false, t: null, playing: false });
  const labelEls = useRef({});
  const containerRef = useRef(null);
  const navRef = useRef({});
  // Layout: "timeline" (depth = time, scroll to travel) or "network" (force layout + orbit).
  const [layout, setLayout] = useState(() => {
    try { return localStorage.getItem('maha_graph_layout') || 'timeline'; } catch { return 'timeline'; }
  });
  const corridor = layout === 'timeline';
  const [playing, setPlaying] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const tickEls = useRef({});
  const ui = useRef({});
  const rail = useRef({ z: CAM_START, tz: CAM_START, vz: 0, x: 0, tx: 0, y: 12, ty: 12, yaw: 0, pitch: 0, playing: false, sliding: false, drag: null });
  const switchLayout = m => {
    setLayout(m);
    setTimeline({ on: false, t: null, playing: false }); // the time filter belongs to the Network layout
    try { localStorage.setItem('maha_graph_layout', m); } catch { /* storage unavailable */ }
  };

  // Default to community grouping once the analysis (with communities) arrives.
  const groupDefaulted = useRef(false);
  useEffect(() => {
    if (hasCommunities && !groupDefaulted.current) { groupDefaulted.current = true; setGroupMode('community'); }
  }, [hasCommunities]);

  const typeCounts = useMemo(() => {
    const c = {};
    graph?.nodes?.forEach(n => { c[n.type] = (c[n.type] || 0) + 1; });
    return c;
  }, [graph]);

  // When each entity was first seen; keeps its place on the time axis whichever types are switched on.
  const tl = useMemo(() => buildTimeline(graph), [graph]);
  const ticks = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const z = (tl.L * i) / 5;
    return { key: 't' + i, z, text: fmtTime(timeAtZ(tl, z), tl) };
  }), [tl]);

  // Money loops, computed on the full graph so they match the backend's finding.
  const loops = useMemo(() => findMoneyLoops(graph?.edges || []), [graph]);

  // Copies, because d3 writes positions onto nodes and swaps link ids for objects.
  const data = useMemo(() => {
    const metrics = analysis?.metrics || {};
    const nodes = (graph?.nodes || []).filter(n => enabled[n.type] ?? true).map(n => ({
      id: n.id, type: n.type, label: n.label || n.id, raw: n, degree: 0,
      community: metrics[n.id]?.community ?? null, cases: n.case_ids || [],
      // Timeline layout pins every entity to its moment in time (z); physics only spreads x and y.
      ...(corridor ? { z: tl.z.get(n.id) ?? 0, fz: tl.z.get(n.id) ?? 0 } : {})
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const loopEdges = new Set(loops.flat());
    const linkIndex = new Map();                        // original edge -> link index
    const links = [];
    (graph?.edges || []).forEach(e => {
      if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) return;
      linkIndex.set(e, links.length);
      links.push({ source: e.source, target: e.target, type: e.type, loop: loopEdges.has(e), time: edgeTime(e), edge: e, ph: (links.length * 0.618) % 1 });
    });
    const neighbors = new Map(nodes.map(n => [n.id, new Set([n.id])]));
    const adjacency = new Map(nodes.map(n => [n.id, []]));
    links.forEach(l => {
      byId.get(l.source).degree++; byId.get(l.target).degree++;
      neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source);
      adjacency.get(l.source).push({ other: l.target, type: l.type, out: true, link: l });
      adjacency.get(l.target).push({ other: l.source, type: l.type, out: false, link: l });
    });

    // Groups (community or case) pull their members together around a ring of centres.
    const groupMap = new Map();
    nodes.forEach(n => {
      const k = groupKey(n, groupMode);
      if (!k) return;
      if (!groupMap.has(k)) groupMap.set(k, []);
      groupMap.get(k).push(n);
    });
    const groups = [...groupMap.entries()]
      .map(([key, members]) => ({ key, label: groupLabel(key), members }))
      .sort((a, b) => b.members.length - a.members.length);
    // Only groups of 3+ get their own spot on the ring; pairs and singletons stay near the middle.
    const centres = groupCentres(groups.filter(g => g.members.length >= 3).map(g => g.key));

    const sim = corridor
      ? forceSimulation(nodes, 3)
        .force('link', forceLink(links).id(d => d.id).distance(30).strength(0.12))
        .force('charge', forceManyBody().strength(-80).distanceMax(160))
        .force('x', forceX(0).strength(0.03))
        .force('y', forceY(d => LAYER_Y[d.type] ?? 0).strength(0.14))
      : forceSimulation(nodes, 3)
      .force('link', forceLink(links).id(d => d.id).distance(l => (l.type === 'INVOLVED_IN_CASE' ? 45 : 22)).strength(l => {
        if (groupMode === 'none') return 0.6;
        // Links across groups pull weakly, so each group can settle into its own region.
        return groupKey(l.source, groupMode) === groupKey(l.target, groupMode) ? 0.5 : 0.04;
      }))
      .force('charge', forceManyBody().strength(-55).distanceMax(400));
    if (corridor) { /* time pins z; layers set y */ }
    else if (groupMode === 'none' || groups.length < 2) sim.force('center', forceCenter());
    else {
      const at = (n, axis) => centres.get(groupKey(n, groupMode))?.[axis] ?? 0;
      const pull = n => (centres.has(groupKey(n, groupMode)) ? 0.2 : 0.02);
      sim.force('gx', forceX(n => at(n, 'x')).strength(pull))
        .force('gy', forceY(n => at(n, 'y')).strength(pull))
        .force('gz', forceZ(n => at(n, 'z')).strength(pull));
    }
    sim.stop();
    // Ungrouped: start partly unfolded and animate the rest. Grouped: settle most of the
    // layout up front, so communities open already separated (cheap for case-sized graphs).
    const warmup = corridor ? 90 : groupMode === 'none' ? 25 : 220;
    for (let i = 0; i < warmup; i++) sim.tick();

    const times = links.map(l => l.time).filter(t => t != null);
    const range = times.length ? { min: Math.min(...times), max: Math.max(...times), dated: times.length } : null;
    return { nodes, byId, links, linkIndex, neighbors, adjacency, groups: groups.filter(g => g.members.length >= 3), allGroups: groups, sim, range };
  }, [graph, enabled, loops, analysis, groupMode, corridor, tl]);

  const { nodes, byId, links, linkIndex, neighbors, adjacency, groups, allGroups, sim, range } = data;
  const loopLinkCount = links.filter(l => l.loop).length;

  useEffect(() => () => sim.stop(), [sim]);
  useEffect(() => { setFitToken(t => t + 1); }, [sim]);
  useEffect(() => { if (focusId && byId.has(focusId)) { setTrace(null); setSelectedId(focusId); setPanelTab('entity'); setPanelOpen(true); } }, [focusId, byId]);
  useEffect(() => { if (selectedId && !byId.has(selectedId)) setSelectedId(null); }, [byId, selectedId]);

  // Trace autoplay: step through the hops of the traced loop.
  useEffect(() => {
    if (!trace?.playing) return;
    const id = setTimeout(() => setTrace(t => t && ({ ...t, step: (t.step + 1) % t.loop.length })), 2200);
    return () => clearTimeout(id);
  }, [trace]);

  // Timeline playback: sweep the cutoff from the first to the last dated link in ~20 s.
  useEffect(() => {
    if (!timeline.on || !timeline.playing || !range) return;
    const id = setInterval(() => setTimeline(tl => {
      const next = (tl.t ?? range.min) + (range.max - range.min) / 200;
      return next >= range.max ? { ...tl, t: range.max, playing: false } : { ...tl, t: next };
    }), 100);
    return () => clearInterval(id);
  }, [timeline.on, timeline.playing, range]);

  const selected = selectedId ? byId.get(selectedId) || null : null;
  const cutoff = timeline.on && range ? (timeline.t ?? range.max) : null;

  // What is highlighted: a traced loop wins, then a selected entity, then a picked group.
  const traceInfo = useMemo(() => {
    if (!trace) return null;
    const idx = trace.loop.map(e => linkIndex.get(e)).filter(i => i != null);
    const nodeIds = new Set(trace.loop.flatMap(e => [e.source, e.target]));
    const hop = trace.loop[trace.step];
    return { litLinks: new Set(idx), nodeIds, currentLink: linkIndex.get(hop), flyTo: byId.get(hop?.source) || null };
  }, [trace, linkIndex, byId]);
  const groupFocus = useMemo(() => {
    if (!activeGroup) return null;
    const g = allGroups.find(x => x.key === activeGroup);
    return g ? new Set(g.members.map(n => n.id)) : null;
  }, [activeGroup, allGroups]);
  const focus = traceInfo ? traceInfo.nodeIds : selected ? neighbors.get(selected.id) : groupFocus;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || corridor) return;
    const onKeyDown = event => {
      const pan = navRef.current.pan;
      if (event.key === 'ArrowLeft') { event.preventDefault(); pan?.(-45, 0); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); pan?.(45, 0); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); pan?.(0, 45); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); pan?.(0, -45); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); navRef.current.zoom?.(0.82); }
      else if (event.key === '-') { event.preventDefault(); navRef.current.zoom?.(1.22); }
      else if (event.key === 'Home') { event.preventDefault(); clearFocus(); setFitToken(token => token + 1); }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [corridor]);

  const handleWheel = event => {
    if (!corridor && (dragMode === 'pan' || event.shiftKey || Math.abs(event.deltaX) > 6)) {
      event.preventDefault();
      navRef.current.pan?.(event.deltaX * 0.75, -event.deltaY * 0.75);
    }
  };

  // Entities named in at least one finding get the "!" badge and a coral ring.
  const flagged = useMemo(() => new Set((analysis?.leads || []).flatMap(l => l.subject_ids || [])), [analysis]);
  const maxDegree = useMemo(() => Math.max(1, ...nodes.map(n => n.degree)), [nodes]);
  const hubs = useMemo(() => {
    // Name cases and the best-connected people/organisations; account numbers stay unlabelled.
    const cases = nodes.filter(n => n.type === 'Case');
    const top = nodes.filter(n => n.type === 'Person' || n.type === 'Organization').sort((a, b) => b.degree - a.degree).slice(0, 4);
    return [...cases, ...top].slice(0, 7);
  }, [nodes]);

  const labels = [
    ...(!selected && !trace ? hubs.map(n => ({ key: 'hub:' + n.id, node: n, variant: 'hub' })) : []),
    ...(trace ? [...traceInfo.nodeIds].map(id => byId.get(id)).filter(Boolean).map(n => ({ key: 'trace:' + n.id, node: n, variant: 'hub' })) : []),
    ...(selected && !trace ? [{ key: 'sel:' + selected.id, node: selected, variant: 'selected' }] : []),
    ...(hovered && hovered.id !== selectedId ? [{ key: 'hov:' + hovered.id, node: hovered, variant: 'hover' }] : []),
    ...(groupMode !== 'none' ? groups.slice(0, 5).map(g => ({ key: 'grp:' + g.key, group: g, variant: 'group', text: `${g.label} · ${g.members.length}` })) : [])
  ];

  const selectNode = id => {
    setTrace(null);
    setSelectedId(id);
    setPanelTab('entity');
    setPanelOpen(true);
  };
  const clearFocus = () => { setSelectedId(null); setTrace(null); setActiveGroup(null); };

  if (!graph) return <div className="g3d-empty" style={{ height }}>Loading graph…</div>;
  // Timeline layout = Ayaana's full prototype view (depth = time, icons, legend, radar, story panel).
  if (corridor) {
    return <CaseCorridor graph={graph} analysis={analysis} onSelect={onSelect} onLayout={switchLayout}
      height={`max(${height}, 760px)`} />;
  }

  const flyTo = traceInfo ? traceInfo.flyTo : selected;
  // Keep toolbar and hint clear of the docked panel (w-80 = 20rem, plus its 0.75rem inset).
  const besidePanel = panelOpen ? 'tw:right-[21.5rem]' : '';

  return (
    <div ref={containerRef} className="g3d" style={{ height }} tabIndex={0} onWheel={handleWheel}>
      <Canvas
        camera={{ position: [0, 0, 260], fov: 50, near: 0.5, far: 5000 }}
        dpr={[1, 1.75]}
        onPointerMissed={clearFocus}
        style={{ cursor: hovered ? 'pointer' : !corridor && dragMode === 'pan' ? 'move' : 'grab' }}
      >
        <color attach="background" args={['#0A1020']} />
        <fog attach="fog" args={['#0A1020', 300, 1400]} />
        <Backdrop />
        {corridor ? (
          <>
            <TimelineRig tl={tl} sim={sim} nodes={nodes} rail={rail} ui={ui} flyTo={flyTo}
              resetToken={resetToken} onPlayState={setPlaying} rightInset={panelOpen ? 344 : 0} />
            <Corridor L={tl.L} />
            <TickLabels ticks={ticks} els={tickEls} />
          </>
        ) : (
          <Rig sim={sim} nodes={nodes} flyTo={flyTo} fitToken={fitToken} autoRotate={autoRotate && !trace} closeness={trace ? 95 : 70} rightInset={panelOpen ? 344 : 0} navRef={navRef} setFitToken={setFitToken} />
        )}
        {groupMode !== 'none' && !corridor && <GroupRegions groups={groups} active={activeGroup} />}
        <Edges links={links} focus={focus} litLinks={traceInfo?.litLinks} currentLink={traceInfo?.currentLink} cutoff={cutoff} bend={corridor} />
        {showFlow && <FlowParticles links={links} focus={focus} litLinks={traceInfo?.litLinks} cutoff={cutoff} bend={corridor} />}
        <IconLayer nodes={nodes} focus={focus} flagged={flagged} maxDegree={maxDegree} minFrac={corridor ? 0 : 0.04}
          hoveredId={hovered?.id} onHover={setHovered} onPick={n => selectNode(n.id)} />
        <LabelProjector items={labels} els={labelEls} />
        <OrbitControls makeDefault enabled={!corridor} enableDamping dampingFactor={0.08} enablePan={!corridor} screenSpacePanning={!corridor} panSpeed={1.5} zoomSpeed={1.2} autoRotateSpeed={0.5} onStart={() => setAutoRotate(false)} mouseButtons={{ LEFT: !corridor && dragMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
        <EffectComposer>
          <Bloom intensity={1.1} luminanceThreshold={0.3} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div className="g3d-labels" aria-hidden="true">
        {labels.map(item => (
          <div key={item.key} ref={el => { if (el) labelEls.current[item.key] = el; else delete labelEls.current[item.key]; }}
            className={`g3d-label g3d-label-${item.variant}`}>
            {item.variant === 'group' ? <span>{item.text}</span> : <b>{item.node.label}</b>}
            {(item.variant === 'selected' || item.variant === 'hover') && (
              <span>{item.node.type} · {item.node.degree} links
                {corridor && tl.time.has(item.node.id) && <> · first seen {fmtTime(tl.time.get(item.node.id), tl)}</>}</span>
            )}
          </div>
        ))}
        {corridor && ticks.map(t => (
          <div key={t.key} ref={el => { if (el) tickEls.current[t.key] = el; else delete tickEls.current[t.key]; }}
            className="g3d-tick">{t.text}</div>
        ))}
      </div>

      <div className={`g3d-toolbar ${besidePanel}`} role="toolbar" aria-label="3D graph controls">
        <div className="g3d-chips">
          {Object.keys(TYPES).filter(t => typeCounts[t]).map(t => (
            <button key={t} type="button" aria-pressed={!!enabled[t]}
              className={`g3d-chip ${enabled[t] ? 'on' : ''}`} style={{ '--chip': TYPES[t].color }}
              onClick={() => setEnabled(s => ({ ...s, [t]: !s[t] }))}>
              <img className="g3d-chip-ico" src={typeThumb(t, TYPES[t].color)} alt="" />{t} <small>{typeCounts[t]}</small>
            </button>
          ))}
        </div>
        <div className="g3d-actions">
          {[['timeline', 'Timeline'], ['network', 'Network']].map(([m, label]) => (
            <button key={m} type="button" className={`g3d-chip ${layout === m ? 'on' : ''}`} style={{ '--chip': '#5AA9FF' }}
              aria-pressed={layout === m} onClick={() => switchLayout(m)}><i />{label}</button>
          ))}
          {!corridor && <>
            <button type="button" className={`g3d-chip ${dragMode === 'orbit' ? 'on' : ''}`} style={{ '--chip': '#60a5fa' }}
              aria-pressed={dragMode === 'orbit'} onClick={() => setDragMode('orbit')}><i />Orbit</button>
            <button type="button" className={`g3d-chip ${dragMode === 'pan' ? 'on' : ''}`} style={{ '--chip': '#38bdf8' }}
              aria-pressed={dragMode === 'pan'} onClick={() => setDragMode('pan')}><i />Pan</button>
          </>}
          <button type="button" className={`g3d-chip ${showFlow ? 'on' : ''}`} style={{ '--chip': '#FFD27A' }}
            aria-pressed={showFlow} onClick={() => setShowFlow(v => !v)}><i />Flow</button>
          {!corridor && (
            <button type="button" className={`g3d-chip ${autoRotate ? 'on' : ''}`} style={{ '--chip': '#A98BFF' }}
              aria-pressed={autoRotate} onClick={() => setAutoRotate(v => !v)}><i />Orbit</button>
          )}
          {range && !corridor && (
            <button type="button" className={`g3d-chip ${timeline.on ? 'on' : ''}`} style={{ '--chip': '#3DD6B5' }}
              aria-pressed={timeline.on}
              onClick={() => setTimeline(tl => (tl.on ? { on: false, t: null, playing: false } : { on: true, t: range.min, playing: true }))}>
              <History className="tw:size-3.5" />Time filter
            </button>
          )}
          <Button variant="outline" size="sm" className="tw:h-7 tw:min-h-0 tw:rounded-full tw:px-3 tw:text-xs"
            onClick={() => { clearFocus(); setFitToken(t => t + 1); setResetToken(t => t + 1); }}>
            <RotateCcw />Reset
          </Button>
          <Button variant="outline" size="sm" className="tw:h-7 tw:min-h-0 tw:rounded-full tw:px-3 tw:text-xs"
            aria-expanded={panelOpen} onClick={() => setPanelOpen(o => !o)}>
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}{panelOpen ? 'Hide panel' : 'Details'}
          </Button>
        </div>
      </div>

      {!corridor && (
        <div className="g3d-navpad" aria-label="Camera navigation">
          <div className="g3d-navpad-dpad">
            <button type="button" className="g3d-nav-btn up" title="Pan up" onClick={() => navRef.current.pan?.(0, 45)}>▲</button>
            <div className="g3d-navpad-row">
              <button type="button" className="g3d-nav-btn left" title="Pan left" onClick={() => navRef.current.pan?.(-45, 0)}>◀</button>
              <button type="button" className="g3d-nav-btn center" title="Reset view" onClick={() => { clearFocus(); setFitToken(token => token + 1); }}>⌖</button>
              <button type="button" className="g3d-nav-btn right" title="Pan right" onClick={() => navRef.current.pan?.(45, 0)}>▶</button>
            </div>
            <button type="button" className="g3d-nav-btn down" title="Pan down" onClick={() => navRef.current.pan?.(0, -45)}>▼</button>
          </div>
          <div className="g3d-navpad-zoom">
            <button type="button" className="g3d-nav-btn zoom-in" title="Zoom in" onClick={() => navRef.current.zoom?.(0.8)}>＋</button>
            <button type="button" className="g3d-nav-btn zoom-out" title="Zoom out" onClick={() => navRef.current.zoom?.(1.25)}>－</button>
          </div>
        </div>
      )}

      {panelOpen && (
        <GraphPanel
          tab={panelTab} onTab={setPanelTab}
          selected={selected} adjacency={adjacency} byId={byId} analysis={analysis}
          onSelectNode={selectNode} onViewSources={n => onSelect?.(n.raw)} onClose={() => setPanelOpen(false)}
          loops={loops} trace={trace} setTrace={t => { setSelectedId(null); setTrace(t); }}
          groupMode={groupMode} setGroupMode={m => { setActiveGroup(null); setGroupMode(m); }} hasCommunities={hasCommunities}
          groups={allGroups} activeGroup={activeGroup} setActiveGroup={k => { setSelectedId(null); setTrace(null); setActiveGroup(k); }}
          stats={{ nodes: nodes.length, links: links.length, loopLinks: loopLinkCount }}
        />
      )}

      {timeline.on && range && (
        <TimelineBar range={range} timeline={timeline} setTimeline={setTimeline} links={links} cutoff={cutoff} className={besidePanel} />
      )}

      {corridor && (
        <div className={`g3d-timebar ${besidePanel}`}>
          <button type="button" className="g3d-play" aria-label={playing ? 'Pause' : 'Play through time'}
            onClick={() => {
              const r = rail.current; r.playing = !r.playing;
              if (r.playing) { const [a, b] = railRange(tl); if (r.tz >= b - 1) r.tz = a; } // replay from the start
              setPlaying(r.playing);
              ui.current.cue?.classList.add('gone');
            }}>
            {playing ? '❚❚' : '▶'}
          </button>
          <input ref={el => { ui.current.slider = el; }} type="range" min="0" max="1000" defaultValue="0"
            aria-label="Scrub through time"
            onPointerDown={() => { rail.current.sliding = true; }}
            onPointerUp={() => { rail.current.sliding = false; }}
            onPointerCancel={() => { rail.current.sliding = false; }}
            onChange={e => {
              const [a, b] = railRange(tl), r = rail.current;
              r.playing = false; setPlaying(false); r.vz = 0;
              r.tz = a + (e.target.value / 1000) * (b - a);
            }} />
          <div className="g3d-timeread">
            <b ref={el => { ui.current.date = el; }} />
            <small ref={el => { ui.current.ahead = el; }} />
          </div>
        </div>
      )}
      {corridor && nodes.length > 0 && (
        <div className="g3d-cue" ref={el => { ui.current.cue = el; }}><i /><span>Scroll to travel through time</span></div>
      )}
      {!graph.nodes?.length && (
        <div className={`tw:pointer-events-none tw:absolute tw:inset-x-3 tw:top-1/2 tw:z-[2] tw:-translate-y-1/2 tw:text-center ${besidePanel}`}>
          <p className="tw:m-0 tw:font-display tw:text-lg tw:font-semibold tw:text-ink">No entities in this case yet</p>
          <p className="tw:m-0 tw:mt-1 tw:text-sm tw:text-ink-3">Import records or load the sample data to see its timeline.</p>
        </div>
      )}

      {!timeline.on && (
        <div className={`g3d-hint ${besidePanel}`}>
          {corridor
            ? 'Scroll to travel through time · drag to look · W/S move · A/D strafe · Space plays · click an entity for details · '
            : 'Drag to orbit · scroll to zoom · click an entity for details · '}
          {nodes.length} entities, {links.length} links
          {showFlow && ' · gold lights = money, teal = calls'}
          {loopLinkCount > 0 && <> · <span className="g3d-loop-note">coral = money loop ({loopLinkCount} transfers)</span></>}
        </div>
      )}
    </div>
  );
}
