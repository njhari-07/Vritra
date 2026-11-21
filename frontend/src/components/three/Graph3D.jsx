import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';

// "Case File Night": each colour names one kind of entity, shared with the 2D GraphView
// and the landing scene. Coral is reserved for money that loops.
const TYPES = {
  Person:       { color: '#5AA9FF', size: 3.2, shape: 'sphere' },
  Account:      { color: '#F2B544', size: 2.4, shape: 'box' },
  Phone:        { color: '#3DD6B5', size: 2.2, shape: 'sphere' },
  Location:     { color: '#A98BFF', size: 2.4, shape: 'sphere' },
  Case:         { color: '#EDF2FA', size: 4.6, shape: 'octa' },
  Organization: { color: '#C9C3E8', size: 2.8, shape: 'ico' },
  Transaction:  { color: '#8D87B3', size: 1.2, shape: 'sphere' },
  Document:     { color: '#4A5B7C', size: 1.8, shape: 'box' }
};
const FALLBACK = { color: '#8D87B3', size: 2, shape: 'sphere' };
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

/* Money loops, using the same rule as the backend's fund-flow finding (maha/analytics.py):
   a chain of transfers that returns to its starting account within four hops, where every
   hop is later than the previous one and stays in the same currency and time basis.
   Returns the set of transfer edges that lie on at least one such loop. */
function chronoLoops(edges, maxHops = 4, limit = 50, budget = 20000) {
  const bySource = new Map();
  edges.forEach(e => {
    const a = e.attrs || {};
    if (e.type !== 'TRANSACTED_WITH' || !a.event_time || a.payment_currency !== a.receiving_currency) return;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  });
  bySource.forEach(list => list.sort((x, y) => (x.attrs.event_time < y.attrs.event_time ? -1 : 1)));
  const onLoop = new Set();
  let found = 0, explored = 0;
  const visit = (origin, current, path, seen) => {
    if (found >= limit || explored >= budget || path.length >= maxHops) return;
    for (const e of bySource.get(current) || []) {
      explored++;
      const prev = path[path.length - 1];
      if (prev) {
        if (new Date(e.attrs.event_time) <= new Date(prev.attrs.event_time)) continue;
        if (e.attrs.payment_currency !== prev.attrs.payment_currency || e.attrs.time_basis !== prev.attrs.time_basis) continue;
      }
      const next = [...path, e];
      if (e.target === origin && next.length >= 2) { next.forEach(x => onLoop.add(x)); found++; }
      else if (!seen.has(e.target)) visit(origin, e.target, next, new Set(seen).add(e.target));
      if (found >= limit || explored >= budget) return;
    }
  };
  for (const origin of [...bySource.keys()].sort()) {
    visit(origin, origin, [], new Set([origin]));
    if (found >= limit || explored >= budget) break;
  }
  return onLoop;
}

const DEFAULT_TYPES = { Person: true, Account: true, Case: true, Location: true, Organization: true, Transaction: false, Document: false };

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

function Edges({ links, focus }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    return g;
  }, [links]);

  useLayoutEffect(() => {
    const col = geo.attributes.color.array;
    links.forEach((l, k) => {
      const lit = !focus || (focus.has(l.source.id ?? l.source) && focus.has(l.target.id ?? l.target));
      tmpC.set(edgeColor(l)).multiplyScalar(lit ? (focus ? 1.6 : 0.9) : 0.08);
      tmpC.toArray(col, k * 6); tmpC.toArray(col, k * 6 + 3);
    });
    geo.attributes.color.needsUpdate = true;
  }, [geo, links, focus]);

  useFrame(() => {
    const pos = geo.attributes.position.array;
    links.forEach((l, k) => {
      const a = l.source, b = l.target;
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
function FlowParticles({ links, focus }) {
  const ref = useRef();
  const per = 2;
  const flows = useMemo(() => links.filter(l => flowColor(l)), [links]);
  const phase = useMemo(() => flows.flatMap((_, i) => Array.from({ length: per }, (_, j) => ((i * 0.37) + j / per) % 1)), [flows]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach((l, i) => {
      const lit = !focus || (focus.has(l.source.id) && focus.has(l.target.id));
      for (let j = 0; j < per; j++) mesh.setColorAt(i * per + j, tmpC.set(flowColor(l)).multiplyScalar(lit ? 3 : 0.1));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flows, focus]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    flows.forEach((l, i) => {
      // SENT_FROM points transaction -> account, so money moves target -> source.
      const [a, b] = l.type === 'SENT_FROM' ? [l.target, l.source] : [l.source, l.target];
      for (let j = 0; j < per; j++) {
        const k = i * per + j;
        phase[k] = (phase[k] + dt * 0.35) % 1;
        tmpV.set(a.x || 0, a.y || 0, a.z || 0).lerp({ x: b.x || 0, y: b.y || 0, z: b.z || 0 }, phase[k]);
        tmpM.makeScale(0.75, 0.75, 0.75).setPosition(tmpV);
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

/* Projects label anchors to screen space each frame and moves plain DOM nodes,
   so labels track the physics without React re-renders or nested roots. */
function LabelProjector({ items, els }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    items.forEach(({ key, node }) => {
      const el = els.current[key];
      if (!el) return;
      v.set(node.x || 0, (node.y || 0) + nodeScale(node) + 1.5, node.z || 0).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.opacity = visible ? '' : '0';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    });
  });
  return null;
}

/* Runs the physics, fits the camera once it settles, and flies to a focused node. */
function Rig({ sim, nodes, flyTo, fitToken, autoRotate }) {
  const { camera, controls } = useThree();
  const fit = useRef({ token: -1, frames: 0 });
  const aim = useRef(null);

  useEffect(() => { aim.current = flyTo ? { node: flyTo, frames: 50 } : null; }, [flyTo]);

  useFrame(() => {
    if (sim.alpha() > sim.alphaMin()) sim.tick();
    if (!controls) return;
    controls.autoRotate = autoRotate && !aim.current;

    if (fit.current.token !== fitToken && nodes.length) {
      if (++fit.current.frames > 40 || sim.alpha() < 0.2) {
        const box = new THREE.Box3();
        nodes.forEach(n => box.expandByPoint(tmpV.set(n.x || 0, n.y || 0, n.z || 0)));
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 30);
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0.35, 0.25, 1).normalize().multiplyScalar(radius * 2.3));
        camera.far = radius * 20; camera.updateProjectionMatrix();
        fit.current = { token: fitToken, frames: 0 };
      }
    }

    if (aim.current) {
      const { node } = aim.current;
      const target = tmpV.set(node.x || 0, node.y || 0, node.z || 0);
      controls.target.lerp(target, 0.12);
      const offset = camera.position.clone().sub(controls.target).setLength(70);
      camera.position.lerp(target.clone().add(offset), 0.08);
      if (--aim.current.frames <= 0) aim.current = null;
    }
    controls.update();
  });
  return null;
}

export default function Graph3D({ graph, onSelect, height = '650px', focusId = null }) {
  const [enabled, setEnabled] = useState(DEFAULT_TYPES);
  const [showFlow, setShowFlow] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [fitToken, setFitToken] = useState(0);
  const labelEls = useRef({});

  const typeCounts = useMemo(() => {
    const c = {};
    graph?.nodes?.forEach(n => { c[n.type] = (c[n.type] || 0) + 1; });
    return c;
  }, [graph]);

  // Copies, because d3 writes positions onto nodes and swaps link ids for objects.
  const { nodes, links, sim, neighbors, loopCount } = useMemo(() => {
    const nodes = (graph?.nodes || []).filter(n => enabled[n.type] ?? true)
      .map(n => ({ id: n.id, type: n.type, label: n.label || n.id, raw: n, degree: 0 }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const loopEdges = chronoLoops(graph?.edges || []);
    const links = (graph?.edges || [])
      .filter(e => e.source !== e.target && byId.has(e.source) && byId.has(e.target))
      .map(e => ({ source: e.source, target: e.target, type: e.type, loop: loopEdges.has(e) }));
    const neighbors = new Map(nodes.map(n => [n.id, new Set([n.id])]));
    links.forEach(l => {
      byId.get(l.source).degree++; byId.get(l.target).degree++;
      neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source);
    });
    const loopCount = links.filter(l => l.loop).length;
    const sim = forceSimulation(nodes, 3)
      .force('link', forceLink(links).id(d => d.id).distance(l => (l.type === 'INVOLVED_IN_CASE' ? 45 : 22)).strength(0.6))
      .force('charge', forceManyBody().strength(-55).distanceMax(400))
      .force('center', forceCenter())
      .stop();
    for (let i = 0; i < 25; i++) sim.tick(); // start partly unfolded, then animate the rest
    return { nodes, links, sim, neighbors, loopCount };
  }, [graph, enabled]);

  useEffect(() => () => sim.stop(), [sim]);
  useEffect(() => { setSelectedId(null); setFitToken(t => t + 1); }, [nodes]);
  useEffect(() => { if (focusId && neighbors.has(focusId)) setSelectedId(focusId); }, [focusId, neighbors]);

  const selected = nodes.find(n => n.id === selectedId) || null;
  const focus = selected ? neighbors.get(selected.id) : null;
  const byType = useMemo(() => {
    const g = {};
    nodes.forEach(n => { (g[n.type] ||= []).push(n); });
    return g;
  }, [nodes]);
  const hubs = useMemo(() => {
    // Name cases and the best-connected people/organisations; account numbers stay unlabelled.
    const cases = nodes.filter(n => n.type === 'Case');
    const top = nodes.filter(n => n.type === 'Person' || n.type === 'Organization')
      .sort((a, b) => b.degree - a.degree).slice(0, 4);
    return [...cases, ...top].slice(0, 7);
  }, [nodes]);

  const labels = [
    ...(!selected ? hubs.map(n => ({ key: 'hub:' + n.id, node: n, variant: 'hub' })) : []),
    ...(selected ? [{ key: 'sel:' + selected.id, node: selected, variant: 'selected' }] : []),
    ...(hovered && hovered.id !== selectedId ? [{ key: 'hov:' + hovered.id, node: hovered, variant: 'hover' }] : [])
  ];

  const pick = n => {
    setSelectedId(n.id);
    onSelect?.(n.raw);
  };

  if (!graph) return <div className="g3d-empty" style={{ height }}>Loading graph…</div>;

  return (
    <div className="g3d" style={{ height }}>
      <Canvas
        camera={{ position: [0, 0, 260], fov: 50, near: 0.5, far: 5000 }}
        dpr={[1, 1.75]}
        onPointerMissed={() => setSelectedId(null)}
        style={{ cursor: hovered ? 'pointer' : 'grab' }}
      >
        <color attach="background" args={['#0A1020']} />
        <fog attach="fog" args={['#0A1020', 300, 1400]} />
        <Stars radius={900} depth={200} count={2500} factor={18} fade speed={0.3} />
        <Rig sim={sim} nodes={nodes} flyTo={selected} fitToken={fitToken} autoRotate={autoRotate} />
        <Edges links={links} focus={focus} />
        {showFlow && <FlowParticles links={links} focus={focus} />}
        {Object.entries(byType).map(([type, list]) => (
          <NodeLayer key={type} type={type} nodes={list} focus={focus}
            hoveredId={hovered?.id} onHover={setHovered} onPick={pick} />
        ))}
        <LabelProjector items={labels} els={labelEls} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotateSpeed={0.5}
          onStart={() => setAutoRotate(false)} />
        <EffectComposer>
          <Bloom intensity={1.1} luminanceThreshold={0.3} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div className="g3d-labels" aria-hidden="true">
        {labels.map(({ key, node, variant }) => (
          <div key={key} ref={el => { if (el) labelEls.current[key] = el; else delete labelEls.current[key]; }}
            className={`g3d-label g3d-label-${variant}`}>
            <b>{node.label}</b>
            {variant !== 'hub' && <span>{node.type} · {node.degree} links</span>}
          </div>
        ))}
      </div>

      <div className="g3d-toolbar" role="toolbar" aria-label="3D graph controls">
        <div className="g3d-chips">
          {Object.keys(TYPES).filter(t => typeCounts[t]).map(t => (
            <button key={t} type="button" aria-pressed={!!enabled[t]}
              className={`g3d-chip ${enabled[t] ? 'on' : ''}`}
              style={{ '--chip': TYPES[t].color }}
              onClick={() => setEnabled(s => ({ ...s, [t]: !s[t] }))}>
              <i />{t} <small>{typeCounts[t]}</small>
            </button>
          ))}
        </div>
        <div className="g3d-actions">
          <button type="button" className={`g3d-chip ${showFlow ? 'on' : ''}`} style={{ '--chip': '#7dd3fc' }}
            aria-pressed={showFlow} onClick={() => setShowFlow(v => !v)}><i />Flow</button>
          <button type="button" className={`g3d-chip ${autoRotate ? 'on' : ''}`} style={{ '--chip': '#a78bfa' }}
            aria-pressed={autoRotate} onClick={() => setAutoRotate(v => !v)}><i />Orbit</button>
          <button type="button" className="g3d-chip" onClick={() => { setSelectedId(null); setFitToken(t => t + 1); }}>Reset view</button>
        </div>
      </div>

      {selected && (
        <aside className="g3d-card" aria-live="polite">
          <span className="g3d-card-type" style={{ color: (TYPES[selected.type] || FALLBACK).color }}>{selected.type}</span>
          <h4>{selected.label}</h4>
          <p>{selected.degree} direct links · {focus.size - 1} neighbours highlighted</p>
          <button type="button" onClick={() => setSelectedId(null)}>Clear focus</button>
        </aside>
      )}

      <div className="g3d-hint">
        Drag to orbit · scroll to zoom · click an entity to focus it · {nodes.length} entities, {links.length} links
        {showFlow && ' · gold lights = money, teal = calls'}
        {loopCount > 0 && <> · <span className="g3d-loop-note">coral = money loop ({loopCount} transfers)</span></>}
      </div>
    </div>
  );
}
