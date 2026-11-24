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

const GEOMETRIES = {
  sphere: () => new THREE.SphereGeometry(1, 20, 20),
  box: () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
  octa: () => new THREE.OctahedronGeometry(1.25),
  ico: () => new THREE.IcosahedronGeometry(1.15)
};

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();

function nodeScale(n) {
  const t = TYPES[n.type] || FALLBACK;
  return t.size * (1 + Math.min(n.degree, 24) * 0.045);
}

// A link is hidden by the timeline when it has a date later than the cutoff.
const hiddenAt = (l, cutoff) => cutoff != null && l.time != null && l.time > cutoff;

/* One instanced mesh per entity type: cheap to animate, still clickable per instance. */
function NodeLayer({ type, nodes, focus, hoveredId, onHover, onPick }) {
  const ref = useRef();
  const spec = TYPES[type] || FALLBACK;
  const geometry = useMemo(() => GEOMETRIES[spec.shape](), [spec.shape]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    nodes.forEach((n, i) => {
      const lit = !focus || focus.has(n.id);
      const boost = n.id === hoveredId ? 2.6 : lit ? 1.5 : 0.12;
      mesh.setColorAt(i, tmpC.set(spec.color).multiplyScalar(boost));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [nodes, focus, hoveredId, spec.color]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    nodes.forEach((n, i) => {
      const s = nodeScale(n) * (n.id === hoveredId ? 1.35 : 1);
      tmpM.makeRotationY(spec.shape === 'sphere' ? 0 : t * 0.4 + i);
      tmpM.scale(tmpV.set(s, s, s)).setPosition(n.x || 0, n.y || 0, n.z || 0);
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  if (!nodes.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, nodes.length]}
      onClick={e => { e.stopPropagation(); onPick(nodes[e.instanceId]); }}
      onPointerMove={e => { e.stopPropagation(); onHover(nodes[e.instanceId]); }}
      onPointerOut={() => onHover(null)}
    >
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* All relationships as one line batch. `litLinks` (indices) overrides node-based focus,
   `currentLink` is the hop being traced, `cutoff` hides links dated after it. */
function Edges({ links, focus, litLinks, currentLink, cutoff }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    return g;
  }, [links]);

  useLayoutEffect(() => {
    const col = geo.attributes.color.array;
    const dimmed = Boolean(litLinks || focus);
    links.forEach((l, k) => {
      const lit = litLinks ? litLinks.has(k)
        : !focus || (focus.has(l.source.id ?? l.source) && focus.has(l.target.id ?? l.target));
      const boost = k === currentLink ? 3 : lit ? (dimmed ? 1.6 : 0.9) : 0.07;
      tmpC.set(edgeColor(l)).multiplyScalar(boost);
      tmpC.toArray(col, k * 6); tmpC.toArray(col, k * 6 + 3);
    });
    geo.attributes.color.needsUpdate = true;
  }, [geo, links, focus, litLinks, currentLink]);

  useFrame(() => {
    const pos = geo.attributes.position.array;
    links.forEach((l, k) => {
      const a = l.source;
      // Collapsing both ends onto one point hides a link without rebuilding the batch.
      const b = hiddenAt(l, cutoff) ? a : l.target;
      pos[k * 6] = a.x || 0; pos[k * 6 + 1] = a.y || 0; pos[k * 6 + 2] = a.z || 0;
      pos[k * 6 + 3] = b.x || 0; pos[k * 6 + 4] = b.y || 0; pos[k * 6 + 5] = b.z || 0;
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
function FlowParticles({ links, focus, litLinks, cutoff }) {
  const ref = useRef();
  const per = 2;
  const flows = useMemo(() => links.map((l, k) => ({ l, k })).filter(({ l }) => flowColor(l)), [links]);
  const phase = useMemo(() => flows.flatMap((_, i) => Array.from({ length: per }, (_, j) => ((i * 0.37) + j / per) % 1)), [flows]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach(({ l, k }, i) => {
      const lit = litLinks ? litLinks.has(k) : !focus || (focus.has(l.source.id) && focus.has(l.target.id));
      for (let j = 0; j < per; j++) mesh.setColorAt(i * per + j, tmpC.set(flowColor(l)).multiplyScalar(lit ? 3 : 0.1));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flows, focus, litLinks]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach(({ l }, i) => {
      const hide = hiddenAt(l, cutoff);
      // SENT_FROM points transaction -> account, so money moves target -> source.
      const [a, b] = l.type === 'SENT_FROM' ? [l.target, l.source] : [l.source, l.target];
      for (let j = 0; j < per; j++) {
        const k = i * per + j;
        phase[k] = (phase[k] + dt * 0.35) % 1;
        tmpV.set(a.x || 0, a.y || 0, a.z || 0).lerp({ x: b.x || 0, y: b.y || 0, z: b.z || 0 }, phase[k]);
        const s = hide ? 0 : 0.75;
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
      if (item.node) v.set(item.node.x || 0, (item.node.y || 0) + nodeScale(item.node) + 1.5, item.node.z || 0);
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

/* Runs the physics, fits the camera once it settles, flies to a focused node, and exposes pan/zoom/reset controls. */
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

  // Expose precise pan, zoom, and reset functions to external UI and event handlers
  useEffect(() => {
    if (!navRef) return;
    navRef.current = {
      pan: (dx, dy) => {
        if (!controls) return;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());
        const dist = camera.position.distanceTo(controls.target);
        const factor = Math.max(0.06, dist * 0.002);
        const move = new THREE.Vector3()
          .addScaledVector(right, dx * factor)
          .addScaledVector(up, dy * factor);
        camera.position.add(move);
        controls.target.add(move);
        controls.update();
      },
      zoom: (factor) => {
        if (!controls) return;
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
      reset: () => {
        setFitToken(t => t + 1);
      }
    };
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

export default function Graph3D({ graph, analysis, onSelect, height = '650px', focusId = null }) {
  const [enabled, setEnabled] = useState(DEFAULT_TYPES);
  const [showFlow, setShowFlow] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [dragMode, setDragMode] = useState('orbit'); // 'orbit' or 'pan'
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
  const navRef = useRef({ pan: () => {}, zoom: () => {}, reset: () => {} });

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

  // Money loops, computed on the full graph so they match the backend's finding.
  const loops = useMemo(() => findMoneyLoops(graph?.edges || []), [graph]);

  // Copies, because d3 writes positions onto nodes and swaps link ids for objects.
  const data = useMemo(() => {
    const metrics = analysis?.metrics || {};
    const nodes = (graph?.nodes || []).filter(n => enabled[n.type] ?? true).map(n => ({
      id: n.id, type: n.type, label: n.label || n.id, raw: n, degree: 0,
      community: metrics[n.id]?.community ?? null, cases: n.case_ids || []
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const loopEdges = new Set(loops.flat());
    const linkIndex = new Map();                        // original edge -> link index
    const links = [];
    (graph?.edges || []).forEach(e => {
      if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) return;
      linkIndex.set(e, links.length);
      links.push({ source: e.source, target: e.target, type: e.type, loop: loopEdges.has(e), time: edgeTime(e), edge: e });
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

    const sim = forceSimulation(nodes, 3)
      .force('link', forceLink(links).id(d => d.id).distance(l => (l.type === 'INVOLVED_IN_CASE' ? 45 : 22)).strength(l => {
        if (groupMode === 'none') return 0.6;
        // Links across groups pull weakly, so each group can settle into its own region.
        return groupKey(l.source, groupMode) === groupKey(l.target, groupMode) ? 0.5 : 0.04;
      }))
      .force('charge', forceManyBody().strength(-55).distanceMax(400));
    if (groupMode === 'none' || groups.length < 2) sim.force('center', forceCenter());
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
    const warmup = groupMode === 'none' ? 25 : 220;
    for (let i = 0; i < warmup; i++) sim.tick();

    const times = links.map(l => l.time).filter(t => t != null);
    const range = times.length ? { min: Math.min(...times), max: Math.max(...times), dated: times.length } : null;
    return { nodes, byId, links, linkIndex, neighbors, adjacency, groups: groups.filter(g => g.members.length >= 3), allGroups: groups, sim, range };
  }, [graph, enabled, loops, analysis, groupMode]);

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

  // Keyboard navigation for directional scrolling and zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') navRef.current.pan?.(-45, 0);
        else if (e.key === 'ArrowRight') navRef.current.pan?.(45, 0);
        else if (e.key === 'ArrowUp') navRef.current.pan?.(0, 45);
        else if (e.key === 'ArrowDown') navRef.current.pan?.(0, -45);
        else if (e.key === '+' || e.key === '=') navRef.current.zoom?.(0.82);
        else if (e.key === '-') navRef.current.zoom?.(1.22);
        else if (e.key === 'Home') { setSelectedId(null); setFitToken(t => t + 1); }
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, []);

  // Wheel handling: horizontal/vertical pan when in Pan mode, with Shift, or horizontal trackpad swipe
  const handleWheel = (e) => {
    if (dragMode === 'pan' || e.shiftKey || Math.abs(e.deltaX) > 6) {
      e.preventDefault();
      e.stopPropagation();
      navRef.current.pan?.(e.deltaX * 0.75, -e.deltaY * 0.75);
    }
  };
  const byType = useMemo(() => {
    const g = {};
    nodes.forEach(n => { (g[n.type] ||= []).push(n); });
    return g;
  }, [nodes]);
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

  const flyTo = traceInfo ? traceInfo.flyTo : selected;
  // Keep toolbar and hint clear of the docked panel (w-80 = 20rem, plus its 0.75rem inset).
  const besidePanel = panelOpen ? 'tw:right-[21.5rem]' : '';

  return (
    <div
      ref={containerRef}
      className="g3d"
      style={{ height }}
      tabIndex={0}
      onWheel={handleWheel}
      onContextMenu={e => e.preventDefault()}
    >
      <Canvas
        camera={{ position: [0, 0, 260], fov: 50, near: 0.5, far: 5000 }}
        dpr={[1, 1.75]}
        onPointerMissed={clearFocus}
        style={{ cursor: hovered ? 'pointer' : dragMode === 'pan' ? 'move' : 'grab' }}
      >
        <color attach="background" args={['#0A1020']} />
        <fog attach="fog" args={['#0A1020', 300, 1400]} />
        <Stars radius={900} depth={200} count={2500} factor={18} fade speed={0.3} />
        <Rig
          sim={sim}
          nodes={nodes}
          flyTo={flyTo}
          fitToken={fitToken}
          autoRotate={autoRotate && !trace}
          closeness={trace ? 95 : 70}
          rightInset={panelOpen ? 344 : 0}
          navRef={navRef}
          setFitToken={setFitToken}
        />
        {groupMode !== 'none' && <GroupRegions groups={groups} active={activeGroup} />}
        <Edges links={links} focus={focus} litLinks={traceInfo?.litLinks} currentLink={traceInfo?.currentLink} cutoff={cutoff} />
        {showFlow && <FlowParticles links={links} focus={focus} litLinks={traceInfo?.litLinks} cutoff={cutoff} />}
        {Object.entries(byType).map(([type, list]) => (
          <NodeLayer key={type} type={type} nodes={list} focus={focus}
            hoveredId={hovered?.id} onHover={setHovered} onPick={n => selectNode(n.id)} />
        ))}
        <LabelProjector items={labels} els={labelEls} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan={true}
          screenSpacePanning={true}
          panSpeed={1.5}
          zoomSpeed={1.2}
          autoRotateSpeed={0.5}
          onStart={() => setAutoRotate(false)}
          mouseButtons={{
            LEFT: dragMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
          }}
        />
        <EffectComposer>
          <Bloom intensity={1.1} luminanceThreshold={0.3} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div className="g3d-labels" aria-hidden="true">
        {labels.map(item => (
          <div key={item.key} ref={el => { if (el) labelEls.current[item.key] = el; else delete labelEls.current[item.key]; }}
            className={`g3d-label g3d-label-${item.variant}`}>
            {item.variant === 'group' ? <span>{item.text}</span> : <b>{item.node.label}</b>}
            {(item.variant === 'selected' || item.variant === 'hover') && <span>{item.node.type} · {item.node.degree} links</span>}
          </div>
        ))}
      </div>

      <div className={`g3d-toolbar ${besidePanel}`} role="toolbar" aria-label="3D graph controls">
        <div className="g3d-chips">
          {Object.keys(TYPES).filter(t => typeCounts[t]).map(t => (
            <button key={t} type="button" aria-pressed={!!enabled[t]}
              className={`g3d-chip ${enabled[t] ? 'on' : ''}`} style={{ '--chip': TYPES[t].color }}
              onClick={() => setEnabled(s => ({ ...s, [t]: !s[t] }))}>
              <i />{t} <small>{typeCounts[t]}</small>
            </button>
          ))}
        </div>
        <div className="g3d-actions">
          <button
            type="button"
            className={`g3d-chip ${dragMode === 'orbit' ? 'on' : ''}`}
            style={{ '--chip': '#60a5fa' }}
            onClick={() => setDragMode('orbit')}
            title="Orbit Mode: Left-drag to rotate in 3D, Right-drag to pan"
          >
            <i />Orbit
          </button>
          <button
            type="button"
            className={`g3d-chip ${dragMode === 'pan' ? 'on' : ''}`}
            style={{ '--chip': '#38bdf8' }}
            onClick={() => setDragMode('pan')}
            title="Pan Mode: Left-drag & wheel to scroll horizontally and vertically"
          >
            <i />Pan / Scroll
          </button>
          <button type="button" className={`g3d-chip ${showFlow ? 'on' : ''}`} style={{ '--chip': '#FFD27A' }}
            aria-pressed={showFlow} onClick={() => setShowFlow(v => !v)}><i />Flow</button>
          <button type="button" className={`g3d-chip ${autoRotate ? 'on' : ''}`} style={{ '--chip': '#A98BFF' }}
            aria-pressed={autoRotate} onClick={() => setAutoRotate(v => !v)}><i />Spin</button>
          {range && (
            <button type="button" className={`g3d-chip ${timeline.on ? 'on' : ''}`} style={{ '--chip': '#3DD6B5' }}
              aria-pressed={timeline.on}
              onClick={() => setTimeline(tl => (tl.on ? { on: false, t: null, playing: false } : { on: true, t: range.min, playing: true }))}>
              <History className="tw:size-3.5" />Timeline
            </button>
          )}
          <Button variant="outline" size="sm" className="tw:h-7 tw:min-h-0 tw:rounded-full tw:px-3 tw:text-xs"
            onClick={() => { clearFocus(); setFitToken(t => t + 1); }}>
            <RotateCcw />Reset
          </Button>
          <Button variant="outline" size="sm" className="tw:h-7 tw:min-h-0 tw:rounded-full tw:px-3 tw:text-xs"
            aria-expanded={panelOpen} onClick={() => setPanelOpen(o => !o)}>
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}{panelOpen ? 'Hide panel' : 'Details'}
          </Button>
        </div>
      </div>

      {/* Floating On-Screen Directional Pan & Zoom D-Pad */}
      <div className="g3d-navpad" aria-label="Camera navigation">
        <div className="g3d-navpad-dpad">
          <button
            type="button"
            className="g3d-nav-btn up"
            title="Scroll Up (Pan Up) · Shortcut: ↑"
            onClick={() => navRef.current.pan?.(0, 45)}
          >
            ▲
          </button>
          <div className="g3d-navpad-row">
            <button
              type="button"
              className="g3d-nav-btn left"
              title="Scroll Left (Pan Left) · Shortcut: ←"
              onClick={() => navRef.current.pan?.(-45, 0)}
            >
              ◀
            </button>
            <button
              type="button"
              className="g3d-nav-btn center"
              title="Center / Reset View · Shortcut: Home"
              onClick={() => { clearFocus(); setFitToken(t => t + 1); }}
            >
              ⌖
            </button>
            <button
              type="button"
              className="g3d-nav-btn right"
              title="Scroll Right (Pan Right) · Shortcut: →"
              onClick={() => navRef.current.pan?.(45, 0)}
            >
              ▶
            </button>
          </div>
          <button
            type="button"
            className="g3d-nav-btn down"
            title="Scroll Down (Pan Down) · Shortcut: ↓"
            onClick={() => navRef.current.pan?.(0, -45)}
          >
            ▼
          </button>
        </div>
        <div className="g3d-navpad-zoom">
          <button
            type="button"
            className="g3d-nav-btn zoom-in"
            title="Zoom In · Shortcut: +"
            onClick={() => navRef.current.zoom?.(0.8)}
          >
            ＋
          </button>
          <button
            type="button"
            className="g3d-nav-btn zoom-out"
            title="Zoom Out · Shortcut: -"
            onClick={() => navRef.current.zoom?.(1.25)}
          >
            －
          </button>
        </div>
      </div>

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

      {!timeline.on && (
        <div className={`g3d-hint ${besidePanel}`}>
          {dragMode === 'pan'
            ? 'Pan Mode: Left-drag or wheel to scroll horizontal & vertical · ＋/－ or pinch to zoom'
            : 'Orbit Mode: Left-drag to rotate · Right-drag, Shift-drag or D-pad to scroll H/V · Scroll to zoom'}
          {' · Arrow keys: Scroll · click an entity for details'}
          {showFlow && ' · gold lights = money, teal = calls'}
          {loopLinkCount > 0 && <> · <span className="g3d-loop-note">coral = money loop ({loopLinkCount} transfers)</span></>}
        </div>
      )}
    </div>
  );
}
